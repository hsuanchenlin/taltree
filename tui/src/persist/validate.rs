//! Everything a deserialized document must satisfy before the rules touch it.
//!
//! A `tree.yaml` is a file a person edits by hand, so the checks here are the
//! difference between a typo and a corrupted board: they run once on load and
//! report the first problem in the file's own vocabulary.

use std::collections::HashSet;

use crate::domain::clock::normalize_iso_date;
use crate::domain::plan::cycle_if_added;
use crate::domain::types::{
    Plan, PlanError, PlanResult, MAX_BUDGET, MAX_COST, MAX_TITLE, PLAN_VERSION,
};

/// Check a freshly deserialized plan, normalising the parts that are safe to
/// normalise (trimmed titles, de-duplicated prerequisites).
pub fn validate_plan(mut plan: Plan) -> PlanResult<Plan> {
    if plan.version != PLAN_VERSION {
        return Err(PlanError::invalid(format!(
            "Unsupported plan version {}. This build reads version {PLAN_VERSION}.",
            plan.version
        )));
    }
    plan.title = plan.title.trim().to_string();
    if plan.title.is_empty() {
        return Err(PlanError::invalid("Plan title must be a non-empty string."));
    }
    if plan.title.chars().count() > MAX_TITLE {
        return Err(PlanError::invalid(format!(
            "Plan title must be {MAX_TITLE} characters or fewer."
        )));
    }
    if plan.daily_budget > MAX_BUDGET {
        return Err(PlanError::invalid(format!(
            "dailyBudget must be a whole number from 0 to {MAX_BUDGET}."
        )));
    }
    plan.active_date = normalize_iso_date(&plan.active_date)
        .ok_or_else(|| PlanError::invalid("activeDate must be a YYYY-MM-DD calendar date."))?;

    let mut ids: HashSet<String> = HashSet::new();
    for node in &mut plan.nodes {
        if node.id.trim().is_empty() {
            return Err(PlanError::invalid("Each node needs a non-empty id."));
        }
        node.title = node.title.trim().to_string();
        if node.title.is_empty() {
            return Err(PlanError::invalid(format!(
                "Node \"{}\" needs a non-empty title.",
                node.id
            )));
        }
        if node.title.chars().count() > MAX_TITLE {
            return Err(PlanError::invalid(format!(
                "Node titles must be {MAX_TITLE} characters or fewer."
            )));
        }
        node.group = node
            .group
            .take()
            .map(|label| label.trim().to_string())
            .filter(|label| !label.is_empty());
        if let Some(label) = &node.group {
            if label.chars().count() > MAX_TITLE {
                return Err(PlanError::invalid(format!(
                    "Node \"{}\" group must be {MAX_TITLE} characters or fewer.",
                    node.title
                )));
            }
        }
        if node.cost > MAX_COST {
            return Err(PlanError::invalid(format!(
                "Node \"{}\" cost must be a whole number from 0 to {MAX_COST}.",
                node.title
            )));
        }
        if let Some(date) = &node.deferred_on {
            node.deferred_on = Some(normalize_iso_date(date).ok_or_else(|| {
                PlanError::invalid(format!(
                    "Node \"{}\" deferredOn must be a YYYY-MM-DD date.",
                    node.title
                ))
            })?);
        }
        if let Some(date) = &node.completed_on {
            node.completed_on = Some(normalize_iso_date(date).ok_or_else(|| {
                PlanError::invalid(format!(
                    "Node \"{}\" completedOn must be a YYYY-MM-DD date.",
                    node.title
                ))
            })?);
        }
        let mut seen = HashSet::new();
        node.prerequisite_ids.retain(|id| seen.insert(id.clone()));
        if !ids.insert(node.id.clone()) {
            return Err(PlanError::invalid(format!(
                "Duplicate node id \"{}\".",
                node.id
            )));
        }
    }

    for node in &plan.nodes {
        for prereq_id in &node.prerequisite_ids {
            if !ids.contains(prereq_id) {
                return Err(PlanError::invalid(format!(
                    "\"{}\" lists unknown prerequisite \"{prereq_id}\".",
                    node.title
                )));
            }
        }
    }

    // A stored document can name a cycle no command would have allowed.
    for node in &plan.nodes {
        for prereq_id in &node.prerequisite_ids {
            if let Some(cycle) = cycle_if_added(&plan, &node.id, prereq_id) {
                return Err(cycle);
            }
        }
    }

    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::{PlanErrorCode, PlanNode};

    fn plan_with(nodes: Vec<PlanNode>) -> Plan {
        Plan {
            version: PLAN_VERSION,
            title: "Doc".to_string(),
            daily_budget: 8,
            active_date: "2026-08-31".to_string(),
            spent_today: 0,
            nodes,
        }
    }

    #[test]
    fn a_good_document_passes_and_is_trimmed() {
        let mut plan = plan_with(vec![PlanNode::open("a", "  Alpha  ", 1)]);
        plan.title = "  Doc  ".to_string();
        let checked = validate_plan(plan).expect("valid");
        assert_eq!(checked.title, "Doc");
        assert_eq!(checked.nodes[0].title, "Alpha");
    }

    #[test]
    fn an_unknown_version_is_refused() {
        let mut plan = plan_with(vec![]);
        plan.version = 2;
        let error = validate_plan(plan).expect_err("version");
        assert!(error.message.contains("version 2"), "{}", error.message);
    }

    #[test]
    fn hand_written_dates_are_padded_so_they_can_match_today() {
        let mut plan = plan_with(vec![PlanNode {
            deferred_on: Some("2026-9-1".to_string()),
            ..PlanNode::open("a", "Alpha", 1)
        }]);
        plan.active_date = "2026-8-31".to_string();
        let checked = validate_plan(plan).expect("valid");
        assert_eq!(checked.active_date, "2026-08-31");
        assert_eq!(checked.nodes[0].deferred_on.as_deref(), Some("2026-09-01"));
    }

    #[test]
    fn a_bad_active_date_is_refused() {
        let mut plan = plan_with(vec![]);
        plan.active_date = "31/08/2026".to_string();
        assert_eq!(
            validate_plan(plan).expect_err("date").code,
            PlanErrorCode::Invalid
        );
    }

    #[test]
    fn duplicate_ids_are_refused() {
        let plan = plan_with(vec![
            PlanNode::open("a", "One", 1),
            PlanNode::open("a", "Two", 1),
        ]);
        let error = validate_plan(plan).expect_err("duplicate");
        assert!(
            error.message.contains("Duplicate node id"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_dangling_prerequisite_is_refused() {
        let plan = plan_with(vec![PlanNode::open("a", "One", 1).requiring(&["ghost"])]);
        let error = validate_plan(plan).expect_err("dangling");
        assert!(error.message.contains("ghost"), "{}", error.message);
    }

    #[test]
    fn a_stored_cycle_is_refused_with_its_path() {
        let plan = plan_with(vec![
            PlanNode::open("a", "A", 1).requiring(&["b"]),
            PlanNode::open("b", "B", 1).requiring(&["a"]),
        ]);
        let error = validate_plan(plan).expect_err("cycle");
        assert_eq!(error.code, PlanErrorCode::Cycle);
        assert!(!error.path.is_empty());
    }

    #[test]
    fn a_group_label_is_trimmed_and_a_blank_one_is_dropped() {
        let plan = plan_with(vec![
            PlanNode::open("a", "A", 1).grouped("  Basics  "),
            PlanNode::open("b", "B", 1).grouped("   "),
            PlanNode::open("c", "C", 1),
        ]);
        let checked = validate_plan(plan).expect("valid");
        assert_eq!(checked.node("a").unwrap().group.as_deref(), Some("Basics"));
        assert_eq!(checked.node("b").unwrap().group, None);
        assert_eq!(checked.node("c").unwrap().group, None);
    }

    #[test]
    fn an_overlong_group_label_is_refused() {
        let plan = plan_with(vec![
            PlanNode::open("a", "A", 1).grouped("g".repeat(MAX_TITLE + 1))
        ]);
        let error = validate_plan(plan).expect_err("group");
        assert!(error.message.contains("group must be"), "{}", error.message);
    }

    #[test]
    fn repeated_prerequisites_collapse_instead_of_failing() {
        let plan = plan_with(vec![
            PlanNode::open("a", "A", 1),
            PlanNode::open("b", "B", 1).requiring(&["a", "a"]),
        ]);
        let checked = validate_plan(plan).expect("valid");
        assert_eq!(checked.node("b").unwrap().prerequisite_ids, vec!["a"]);
    }
}
