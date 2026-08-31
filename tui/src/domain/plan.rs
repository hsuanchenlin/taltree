//! The rules. Eligibility, cycle rejection, budget, unlock and block
//! explanations, completion, defer, and rollover live here and nowhere else;
//! the UI reads [`inspect`] and applies command results.
//!
//! Every command takes a plan by reference and returns a new plan, so a refused
//! command cannot leave the document half-changed.

use std::collections::{HashMap, HashSet, VecDeque};

use super::clock::Clock;
use super::types::{
    BlockedDependent, ChoiceExplanation, NamedRef, NodeInput, NodeKind, NodeListing, NodePatch,
    NodeStatus, Plan, PlanError, PlanErrorCode, PlanNode, PlanResult, PlanView, MAX_BUDGET,
    MAX_COST, MAX_TITLE, PLAN_VERSION,
};

/// A plan with today's ledger and no work in it yet.
pub fn empty_plan(clock: &dyn Clock, title: &str) -> Plan {
    let trimmed = title.trim();
    Plan {
        version: PLAN_VERSION,
        title: if trimmed.is_empty() {
            "Untitled plan".to_string()
        } else {
            trimmed.to_string()
        },
        daily_budget: 8,
        active_date: clock.today(),
        spent_today: 0,
        nodes: Vec::new(),
    }
}

/// Roll the ledger forward to today: unspent budget expires, spending resets,
/// and yesterday's deferrals stop hiding work. Unfinished nodes stay put.
///
/// Deferrals are not erased from the document, only outlived: a node deferred
/// yesterday still carries yesterday's date and is eligible again today.
pub fn sync_day(plan: &Plan, clock: &dyn Clock) -> Plan {
    let today = clock.today();
    if plan.active_date == today {
        return plan.clone();
    }
    Plan {
        active_date: today,
        spent_today: 0,
        ..plan.clone()
    }
}

/// Daily budget minus points spent today, never below zero.
pub fn remaining_budget(plan: &Plan) -> u32 {
    plan.daily_budget.saturating_sub(plan.spent_today)
}

/// The whole plan as it stands today.
pub fn inspect(plan: &Plan, clock: &dyn Clock) -> PlanView {
    let synced = sync_day(plan, clock);
    let remaining = remaining_budget(&synced);
    let today = clock.today();
    let listings = synced
        .nodes
        .iter()
        .map(|node| listing_for(&synced, node, remaining, &today))
        .collect();
    PlanView {
        plan: synced,
        remaining,
        listings,
    }
}

/// What completing one node right now would cost and unlock.
pub fn explain_choice(
    plan: &Plan,
    node_id: &str,
    clock: &dyn Clock,
) -> PlanResult<ChoiceExplanation> {
    let synced = sync_day(plan, clock);
    let node = synced.node(node_id).ok_or_else(|| not_found(node_id))?;
    let today = clock.today();
    let remaining = remaining_budget(&synced);
    let waiting_on = open_prereqs(&synced, node);
    let kind = kind_of(node, &waiting_on, &today);

    let mut immediate_unlocks = Vec::new();
    let mut still_blocked_dependents = Vec::new();
    for dependent in synced.dependents_of(&node.id) {
        if dependent.is_completed() {
            continue;
        }
        let waiting_after: Vec<NamedRef> = open_prereqs(&synced, dependent)
            .into_iter()
            .filter(|reference| reference.id != node.id)
            .collect();
        if waiting_after.is_empty() {
            immediate_unlocks.push(NamedRef::from(dependent));
        } else {
            still_blocked_dependents.push(BlockedDependent {
                id: dependent.id.clone(),
                title: dependent.title.clone(),
                waiting_on: waiting_after,
            });
        }
    }

    Ok(ChoiceExplanation {
        node: node.clone(),
        kind,
        remaining_budget: remaining,
        fits_budget: node.cost <= remaining,
        over_by: node.cost.saturating_sub(remaining),
        immediate_unlocks,
        still_blocked_dependents,
        waiting_on,
    })
}

/// Add a node. Prerequisites must already exist; a new node cannot close a
/// cycle, because nothing depends on it yet.
pub fn create_node(
    plan: &Plan,
    input: &NodeInput,
    clock: &dyn Clock,
) -> PlanResult<(Plan, String)> {
    let mut synced = sync_day(plan, clock);
    let (title, cost) = parse_node_fields(&input.title, input.cost)?;
    let prerequisite_ids = unique(&input.prerequisite_ids);
    for id in &prerequisite_ids {
        if synced.node(id).is_none() {
            return Err(unknown_prereq(id));
        }
    }

    let id = next_node_id(&synced, &title);
    synced.nodes.push(PlanNode {
        id: id.clone(),
        title,
        cost,
        status: NodeStatus::Open,
        deferred_on: None,
        completed_on: None,
        prerequisite_ids,
        notes: None,
    });
    Ok((synced, id))
}

/// Change a node's title, cost, prerequisites, or notes.
pub fn edit_node(
    plan: &Plan,
    node_id: &str,
    patch: &NodePatch,
    clock: &dyn Clock,
) -> PlanResult<Plan> {
    let synced = sync_day(plan, clock);
    let node = synced.node(node_id).ok_or_else(|| not_found(node_id))?;

    let title = patch.title.clone().unwrap_or_else(|| node.title.clone());
    let cost = patch.cost.unwrap_or(node.cost);
    let (title, cost) = parse_node_fields(&title, cost)?;

    let prerequisite_ids = match &patch.prerequisite_ids {
        Some(ids) => unique(ids),
        None => node.prerequisite_ids.clone(),
    };
    for id in &prerequisite_ids {
        if synced.node(id).is_none() {
            return Err(unknown_prereq(id));
        }
        if let Some(cycle) = cycle_if_added(&synced, node_id, id) {
            return Err(cycle);
        }
    }

    let notes = match &patch.notes {
        Some(value) => value.clone().filter(|text| !text.trim().is_empty()),
        None => node.notes.clone(),
    };

    let updated = PlanNode {
        title,
        cost,
        prerequisite_ids,
        notes,
        ..node.clone()
    };
    Ok(replace_node(&synced, updated))
}

/// Complete a node and spend its cost into today's ledger.
///
/// Completing is refused while a hard prerequisite is unfinished. It is not
/// refused for going over budget: the budget informs the choice, it does not
/// police it.
pub fn complete_node(plan: &Plan, node_id: &str, clock: &dyn Clock) -> PlanResult<Plan> {
    let synced = sync_day(plan, clock);
    let node = synced.node(node_id).ok_or_else(|| not_found(node_id))?;
    if node.is_completed() {
        return Err(PlanError::invalid(format!(
            "\"{}\" is already completed.",
            node.title
        )));
    }
    let waiting_on = open_prereqs(&synced, node);
    if !waiting_on.is_empty() {
        let names: Vec<String> = waiting_on
            .iter()
            .map(|reference| format!("\"{}\"", reference.title))
            .collect();
        let mut error = PlanError::new(
            PlanErrorCode::Blocked,
            format!(
                "Cannot complete \"{}\" yet. Waiting on {}.",
                node.title,
                names.join(", ")
            ),
        )
        .about(&node.id);
        error.waiting_on = waiting_on;
        return Err(error);
    }

    let cost = node.cost;
    let completed = PlanNode {
        status: NodeStatus::Completed,
        completed_on: Some(clock.today()),
        deferred_on: None,
        ..node.clone()
    };
    let mut next = replace_node(&synced, completed);
    next.spent_today = next.spent_today.saturating_add(cost);
    Ok(next)
}

/// Push a node off today's frontier. The deferral lasts for today only.
pub fn defer_node(plan: &Plan, node_id: &str, clock: &dyn Clock) -> PlanResult<Plan> {
    let synced = sync_day(plan, clock);
    let node = synced.node(node_id).ok_or_else(|| not_found(node_id))?;
    if node.is_completed() {
        return Err(PlanError::invalid("Completed work cannot be deferred."));
    }
    let deferred = PlanNode {
        deferred_on: Some(clock.today()),
        ..node.clone()
    };
    Ok(replace_node(&synced, deferred))
}

/// Bring a deferred node back onto today's frontier.
pub fn undefer_node(plan: &Plan, node_id: &str, clock: &dyn Clock) -> PlanResult<Plan> {
    let synced = sync_day(plan, clock);
    let node = synced.node(node_id).ok_or_else(|| not_found(node_id))?;
    let restored = PlanNode {
        deferred_on: None,
        ..node.clone()
    };
    Ok(replace_node(&synced, restored))
}

/// Remove a node, and with it every prerequisite edge naming it.
pub fn delete_node(plan: &Plan, node_id: &str, clock: &dyn Clock) -> PlanResult<Plan> {
    let mut synced = sync_day(plan, clock);
    if synced.node(node_id).is_none() {
        return Err(not_found(node_id));
    }
    synced.nodes.retain(|node| node.id != node_id);
    for node in &mut synced.nodes {
        node.prerequisite_ids.retain(|id| id != node_id);
    }
    Ok(synced)
}

/// Add the prerequisite edge if it is missing, remove it if it is present.
pub fn toggle_prerequisite(
    plan: &Plan,
    dependent_id: &str,
    prerequisite_id: &str,
    clock: &dyn Clock,
) -> PlanResult<(Plan, bool)> {
    let synced = sync_day(plan, clock);
    let dependent = synced
        .node(dependent_id)
        .ok_or_else(|| not_found(dependent_id))?;
    if synced.node(prerequisite_id).is_none() {
        return Err(not_found(prerequisite_id));
    }
    if dependent
        .prerequisite_ids
        .iter()
        .any(|id| id == prerequisite_id)
    {
        let mut updated = dependent.clone();
        updated.prerequisite_ids.retain(|id| id != prerequisite_id);
        return Ok((replace_node(&synced, updated), false));
    }
    if let Some(cycle) = cycle_if_added(&synced, dependent_id, prerequisite_id) {
        return Err(cycle);
    }
    let mut updated = dependent.clone();
    updated.prerequisite_ids.push(prerequisite_id.to_string());
    Ok((replace_node(&synced, updated), true))
}

/// Set the points the person is willing to spend today.
pub fn set_daily_budget(plan: &Plan, daily_budget: u32, clock: &dyn Clock) -> PlanResult<Plan> {
    let mut synced = sync_day(plan, clock);
    if daily_budget > MAX_BUDGET {
        return Err(PlanError::invalid(format!(
            "Daily budget must be a whole number from 0 to {MAX_BUDGET}."
        )));
    }
    synced.daily_budget = daily_budget;
    Ok(synced)
}

/// Rename the plan.
pub fn set_title(plan: &Plan, title: &str, clock: &dyn Clock) -> PlanResult<Plan> {
    let mut synced = sync_day(plan, clock);
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(PlanError::invalid("Plan title cannot be empty."));
    }
    if trimmed.chars().count() > MAX_TITLE {
        return Err(PlanError::invalid(format!(
            "Plan title must be {MAX_TITLE} characters or fewer."
        )));
    }
    synced.title = trimmed.to_string();
    Ok(synced)
}

/// The cycle that adding `prerequisite_id` to `dependent_id` would close, if any.
///
/// The returned path reads prerequisite first and names every node on the way
/// back around, so the refusal can say which loop it found.
pub fn cycle_if_added(plan: &Plan, dependent_id: &str, prerequisite_id: &str) -> Option<PlanError> {
    if dependent_id == prerequisite_id {
        let title = plan
            .node(dependent_id)
            .map(|node| node.title.clone())
            .unwrap_or_else(|| "this node".to_string());
        let mut error = PlanError::new(
            PlanErrorCode::Cycle,
            format!("\"{title}\" cannot be a prerequisite of itself."),
        );
        error.path = vec![dependent_id.to_string()];
        return Some(error);
    }
    let dependent = plan.node(dependent_id)?;
    let prerequisite = plan.node(prerequisite_id)?;
    let path = path_from(plan, dependent_id, prerequisite_id)?;

    let mut cycle = vec![prerequisite_id.to_string()];
    cycle.extend(path);
    let titles: Vec<String> = cycle
        .iter()
        .map(|id| {
            plan.node(id)
                .map(|node| node.title.clone())
                .unwrap_or_else(|| id.clone())
        })
        .collect();
    let mut error = PlanError::new(
        PlanErrorCode::Cycle,
        format!(
            "Adding \"{}\" as a prerequisite of \"{}\" would create a cycle: {}.",
            prerequisite.title,
            dependent.title,
            titles.join(" -> ")
        ),
    );
    error.path = cycle;
    Some(error)
}

/// A stable, human-readable id derived from the title, unique within the plan.
pub fn next_node_id(plan: &Plan, title: &str) -> String {
    let base = slugify(title);
    let base = if base.is_empty() {
        "node".to_string()
    } else {
        base
    };
    if plan.node(&base).is_none() {
        return base;
    }
    let mut suffix = 2u32;
    loop {
        let candidate = format!("{base}-{suffix}");
        if plan.node(&candidate).is_none() {
            return candidate;
        }
        suffix += 1;
    }
}

/// Lowercase ASCII words joined by single dashes, capped so ids stay readable.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut pending_dash = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.push(ch.to_ascii_lowercase());
            if out.chars().count() >= 32 {
                break;
            }
        } else {
            pending_dash = true;
        }
    }
    out
}

fn listing_for(plan: &Plan, node: &PlanNode, remaining: u32, today: &str) -> NodeListing {
    let waiting_on = open_prereqs(plan, node);
    let kind = kind_of(node, &waiting_on, today);
    NodeListing {
        node: node.clone(),
        kind,
        waiting_on,
        exceeds_budget: kind == NodeKind::Eligible && node.cost > remaining,
    }
}

fn kind_of(node: &PlanNode, waiting_on: &[NamedRef], today: &str) -> NodeKind {
    if node.is_completed() {
        return NodeKind::Completed;
    }
    if node.deferred_on.as_deref() == Some(today) {
        return NodeKind::Deferred;
    }
    if !waiting_on.is_empty() {
        return NodeKind::Blocked;
    }
    NodeKind::Eligible
}

/// The unfinished hard prerequisites currently blocking a node, named by title.
fn open_prereqs(plan: &Plan, node: &PlanNode) -> Vec<NamedRef> {
    node.prerequisite_ids
        .iter()
        .filter_map(|id| plan.node(id))
        .filter(|prereq| !prereq.is_completed())
        .map(NamedRef::from)
        .collect()
}

fn parse_node_fields(title: &str, cost: u32) -> PlanResult<(String, u32)> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(PlanError::invalid("Node title cannot be empty."));
    }
    if trimmed.chars().count() > MAX_TITLE {
        return Err(PlanError::invalid(format!(
            "Node title must be {MAX_TITLE} characters or fewer."
        )));
    }
    if cost > MAX_COST {
        return Err(PlanError::invalid(format!(
            "Cost must be a whole number from 0 to {MAX_COST} points."
        )));
    }
    Ok((trimmed.to_string(), cost))
}

/// Breadth-first walk along dependent edges, returning the ids from `from` to
/// `to` inclusive of `to` and exclusive of nothing else.
fn path_from(plan: &Plan, from_id: &str, to_id: &str) -> Option<Vec<String>> {
    let adjacency = dependent_adjacency(plan);
    let mut parent: HashMap<&str, Option<&str>> = HashMap::new();
    parent.insert(from_id, None);
    let mut queue: VecDeque<&str> = VecDeque::new();
    queue.push_back(from_id);

    while let Some(current) = queue.pop_front() {
        for next in adjacency.get(current).into_iter().flatten() {
            if parent.contains_key(next.as_str()) {
                continue;
            }
            parent.insert(next.as_str(), Some(current));
            if next == to_id {
                return Some(reconstruct(&parent, from_id, to_id));
            }
            queue.push_back(next.as_str());
        }
    }
    None
}

fn reconstruct(parent: &HashMap<&str, Option<&str>>, from_id: &str, to_id: &str) -> Vec<String> {
    let mut path = vec![to_id.to_string()];
    let mut cursor = to_id;
    while cursor != from_id {
        match parent.get(cursor).copied().flatten() {
            Some(previous) => {
                path.push(previous.to_string());
                cursor = previous;
            }
            None => break,
        }
    }
    path.reverse();
    path
}

/// prerequisite id -> the ids of the nodes that depend on it.
fn dependent_adjacency(plan: &Plan) -> HashMap<&str, Vec<String>> {
    let known: HashSet<&str> = plan.nodes.iter().map(|node| node.id.as_str()).collect();
    let mut adjacency: HashMap<&str, Vec<String>> = plan
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), Vec::new()))
        .collect();
    for node in &plan.nodes {
        for prereq_id in &node.prerequisite_ids {
            if !known.contains(prereq_id.as_str()) {
                continue;
            }
            if let Some(list) = adjacency.get_mut(prereq_id.as_str()) {
                list.push(node.id.clone());
            }
        }
    }
    adjacency
}

fn replace_node(plan: &Plan, node: PlanNode) -> Plan {
    let mut next = plan.clone();
    if let Some(index) = next.index_of(&node.id) {
        next.nodes[index] = node;
    }
    next
}

fn unique(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter()
        .filter(|id| seen.insert((*id).clone()))
        .cloned()
        .collect()
}

fn not_found(node_id: &str) -> PlanError {
    PlanError::new(
        PlanErrorCode::NotFound,
        format!("No node with id \"{node_id}\"."),
    )
    .about(node_id)
}

fn unknown_prereq(node_id: &str) -> PlanError {
    PlanError::new(
        PlanErrorCode::NotFound,
        format!("Unknown prerequisite \"{node_id}\"."),
    )
    .about(node_id)
}

#[cfg(test)]
#[path = "plan_tests.rs"]
mod tests;
