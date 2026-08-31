use super::*;
use crate::domain::clock::FrozenClock;
use crate::domain::types::{NodeKind, NodeStatus};

fn today() -> FrozenClock {
    FrozenClock::new("2026-08-31")
}

fn tomorrow() -> FrozenClock {
    FrozenClock::new("2026-09-01")
}

/// receipts -> tax, and a standalone chore.
fn chain_plan() -> Plan {
    let clock = today();
    let mut plan = empty_plan(&clock, "Chain");
    plan.nodes = vec![
        PlanNode::open("receipts", "Find receipts", 2),
        PlanNode::open("tax", "File the tax packet", 5).requiring(&["receipts"]),
        PlanNode::open("walk", "Take a walk", 1),
    ];
    plan
}

#[test]
fn an_empty_plan_starts_on_today_with_nothing_spent() {
    let plan = empty_plan(&today(), "  ");
    assert_eq!(plan.title, "Untitled plan");
    assert_eq!(plan.active_date, "2026-08-31");
    assert_eq!(plan.spent_today, 0);
    assert_eq!(plan.daily_budget, 8);
}

#[test]
fn a_node_with_an_unfinished_prerequisite_is_blocked_and_says_why() {
    let view = inspect(&chain_plan(), &today());
    let tax = view.listing("tax").expect("tax listing");
    assert_eq!(tax.kind, NodeKind::Blocked);
    assert_eq!(
        tax.waiting_on
            .iter()
            .map(|r| r.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Find receipts"]
    );
}

#[test]
fn completing_the_prerequisite_moves_the_dependent_onto_the_frontier() {
    let plan = complete_node(&chain_plan(), "receipts", &today()).expect("complete");
    let view = inspect(&plan, &today());
    assert_eq!(view.listing("tax").unwrap().kind, NodeKind::Eligible);
    assert_eq!(view.listing("receipts").unwrap().kind, NodeKind::Completed);
}

#[test]
fn completing_spends_the_cost_into_todays_ledger() {
    let plan = complete_node(&chain_plan(), "receipts", &today()).expect("complete");
    assert_eq!(plan.spent_today, 2);
    assert_eq!(remaining_budget(&plan), 6);
}

#[test]
fn completing_is_allowed_over_budget_because_the_budget_informs_rather_than_polices() {
    let mut plan = chain_plan();
    plan.daily_budget = 1;
    let after = complete_node(&plan, "receipts", &today()).expect("complete over budget");
    assert_eq!(after.spent_today, 2);
    assert_eq!(
        remaining_budget(&after),
        0,
        "remaining never goes below zero"
    );
}

#[test]
fn completing_a_blocked_node_is_refused_and_names_the_prerequisite() {
    let error = complete_node(&chain_plan(), "tax", &today()).expect_err("blocked");
    assert_eq!(error.code, PlanErrorCode::Blocked);
    assert!(error.message.contains("Find receipts"), "{}", error.message);
    assert_eq!(error.waiting_on.len(), 1);
}

#[test]
fn completing_twice_is_refused() {
    let plan = complete_node(&chain_plan(), "walk", &today()).expect("complete");
    let error = complete_node(&plan, "walk", &today()).expect_err("already completed");
    assert_eq!(error.code, PlanErrorCode::Invalid);
}

#[test]
fn deferring_hides_a_node_from_todays_frontier_only() {
    let plan = defer_node(&chain_plan(), "walk", &today()).expect("defer");
    assert_eq!(
        inspect(&plan, &today()).listing("walk").unwrap().kind,
        NodeKind::Deferred
    );
    assert_eq!(
        inspect(&plan, &tomorrow()).listing("walk").unwrap().kind,
        NodeKind::Eligible,
        "a deferral is for one calendar day"
    );
}

#[test]
fn deferring_completed_work_is_refused() {
    let plan = complete_node(&chain_plan(), "walk", &today()).expect("complete");
    let error = defer_node(&plan, "walk", &today()).expect_err("refused");
    assert_eq!(error.code, PlanErrorCode::Invalid);
}

#[test]
fn undeferring_puts_a_node_back_on_todays_frontier() {
    let plan = defer_node(&chain_plan(), "walk", &today()).expect("defer");
    let plan = undefer_node(&plan, "walk", &today()).expect("undefer");
    assert_eq!(
        inspect(&plan, &today()).listing("walk").unwrap().kind,
        NodeKind::Eligible
    );
}

#[test]
fn crossing_midnight_expires_unspent_budget_and_keeps_unfinished_work() {
    let plan = complete_node(&chain_plan(), "receipts", &today()).expect("complete");
    assert_eq!(plan.spent_today, 2);

    let rolled = sync_day(&plan, &tomorrow());
    assert_eq!(rolled.active_date, "2026-09-01");
    assert_eq!(rolled.spent_today, 0, "unused points do not roll over");
    assert_eq!(rolled.nodes.len(), 3, "unfinished work rolls forward");
    assert_eq!(
        rolled.node("receipts").unwrap().status,
        NodeStatus::Completed,
        "finished work stays finished"
    );
}

#[test]
fn a_missed_day_punishes_nothing() {
    let plan = defer_node(&chain_plan(), "walk", &today()).expect("defer");
    let much_later = FrozenClock::new("2026-12-25");
    let view = inspect(&plan, &much_later);
    assert_eq!(view.remaining, 8);
    assert_eq!(view.frontier().count(), 2);
}

#[test]
fn inspect_reports_eligible_work_that_no_longer_fits_the_day() {
    let mut plan = chain_plan();
    plan.spent_today = 7;
    let view = inspect(&plan, &today());
    assert_eq!(view.remaining, 1);
    assert!(view.listing("receipts").unwrap().exceeds_budget);
    assert!(!view.listing("walk").unwrap().exceeds_budget);
}

#[test]
fn a_node_cannot_require_itself() {
    let error = cycle_if_added(&chain_plan(), "walk", "walk").expect("self cycle");
    assert_eq!(error.code, PlanErrorCode::Cycle);
    assert_eq!(error.path, vec!["walk"]);
}

#[test]
fn a_cycle_is_refused_with_the_path_that_would_close_it() {
    let error = cycle_if_added(&chain_plan(), "receipts", "tax").expect("cycle");
    assert_eq!(error.code, PlanErrorCode::Cycle);
    assert_eq!(error.path, vec!["tax", "receipts", "tax"]);
    assert!(
        error
            .message
            .contains("File the tax packet -> Find receipts -> File the tax packet"),
        "{}",
        error.message
    );
}

#[test]
fn a_long_cycle_names_every_node_on_the_way_round() {
    let clock = today();
    let mut plan = empty_plan(&clock, "Long");
    plan.nodes = vec![
        PlanNode::open("a", "A", 1),
        PlanNode::open("b", "B", 1).requiring(&["a"]),
        PlanNode::open("c", "C", 1).requiring(&["b"]),
    ];
    let error = cycle_if_added(&plan, "a", "c").expect("cycle");
    assert_eq!(error.path, vec!["c", "a", "b", "c"]);
}

#[test]
fn an_unrelated_edge_closes_no_cycle() {
    assert!(cycle_if_added(&chain_plan(), "tax", "walk").is_none());
}

#[test]
fn linking_a_prerequisite_toggles_it_off_again() {
    let (plan, added) = toggle_prerequisite(&chain_plan(), "walk", "receipts", &today()).unwrap();
    assert!(added);
    assert_eq!(
        plan.node("walk").unwrap().prerequisite_ids,
        vec!["receipts"]
    );

    let (plan, added) = toggle_prerequisite(&plan, "walk", "receipts", &today()).unwrap();
    assert!(!added);
    assert!(plan.node("walk").unwrap().prerequisite_ids.is_empty());
}

#[test]
fn linking_a_prerequisite_that_would_close_a_cycle_is_refused() {
    let error = toggle_prerequisite(&chain_plan(), "receipts", "tax", &today()).expect_err("cycle");
    assert_eq!(error.code, PlanErrorCode::Cycle);
}

#[test]
fn creating_a_node_derives_a_readable_id_and_keeps_it_unique() {
    let clock = today();
    let (plan, first) = create_node(
        &chain_plan(),
        &NodeInput {
            title: "  Water the plants  ".to_string(),
            cost: 1,
            prerequisite_ids: vec!["walk".to_string()],
        },
        &clock,
    )
    .expect("create");
    assert_eq!(first, "water-the-plants");
    assert_eq!(plan.node(&first).unwrap().title, "Water the plants");
    assert_eq!(plan.node(&first).unwrap().prerequisite_ids, vec!["walk"]);

    let (plan, second) = create_node(
        &plan,
        &NodeInput {
            title: "Water the plants".to_string(),
            cost: 1,
            prerequisite_ids: Vec::new(),
        },
        &clock,
    )
    .expect("create again");
    assert_eq!(second, "water-the-plants-2");
    assert_eq!(plan.nodes.len(), 5);
}

#[test]
fn creating_a_node_with_an_unknown_prerequisite_is_refused() {
    let error = create_node(
        &chain_plan(),
        &NodeInput {
            title: "Ghost".to_string(),
            cost: 1,
            prerequisite_ids: vec!["nope".to_string()],
        },
        &today(),
    )
    .expect_err("unknown prerequisite");
    assert_eq!(error.code, PlanErrorCode::NotFound);
}

#[test]
fn titles_and_costs_are_checked_before_anything_changes() {
    let blank = create_node(
        &chain_plan(),
        &NodeInput {
            title: "   ".to_string(),
            cost: 1,
            prerequisite_ids: Vec::new(),
        },
        &today(),
    )
    .expect_err("blank title");
    assert_eq!(blank.code, PlanErrorCode::Invalid);

    let pricey = create_node(
        &chain_plan(),
        &NodeInput {
            title: "Too big".to_string(),
            cost: MAX_COST + 1,
            prerequisite_ids: Vec::new(),
        },
        &today(),
    )
    .expect_err("cost too high");
    assert_eq!(pricey.code, PlanErrorCode::Invalid);
}

#[test]
fn editing_changes_only_the_named_fields() {
    let plan = edit_node(
        &chain_plan(),
        "walk",
        &NodePatch {
            cost: Some(3),
            ..NodePatch::default()
        },
        &today(),
    )
    .expect("edit");
    let walk = plan.node("walk").unwrap();
    assert_eq!(walk.cost, 3);
    assert_eq!(walk.title, "Take a walk");
}

#[test]
fn editing_can_clear_notes_by_writing_blank_ones() {
    let plan = edit_node(
        &chain_plan(),
        "walk",
        &NodePatch {
            notes: Some(Some("Around the block".to_string())),
            ..NodePatch::default()
        },
        &today(),
    )
    .expect("set notes");
    assert_eq!(
        plan.node("walk").unwrap().notes.as_deref(),
        Some("Around the block")
    );

    let plan = edit_node(
        &plan,
        "walk",
        &NodePatch {
            notes: Some(Some("   ".to_string())),
            ..NodePatch::default()
        },
        &today(),
    )
    .expect("clear notes");
    assert_eq!(plan.node("walk").unwrap().notes, None);
}

#[test]
fn deleting_a_node_also_removes_the_edges_that_named_it() {
    let plan = delete_node(&chain_plan(), "receipts", &today()).expect("delete");
    assert!(plan.node("receipts").is_none());
    assert!(plan.node("tax").unwrap().prerequisite_ids.is_empty());
    assert_eq!(
        inspect(&plan, &today()).listing("tax").unwrap().kind,
        NodeKind::Eligible
    );
}

#[test]
fn deleting_an_unknown_node_is_refused() {
    let error = delete_node(&chain_plan(), "ghost", &today()).expect_err("not found");
    assert_eq!(error.code, PlanErrorCode::NotFound);
}

#[test]
fn the_daily_budget_has_a_ceiling() {
    let plan = set_daily_budget(&chain_plan(), 12, &today()).expect("set budget");
    assert_eq!(plan.daily_budget, 12);
    let error = set_daily_budget(&plan, MAX_BUDGET + 1, &today()).expect_err("too high");
    assert_eq!(error.code, PlanErrorCode::Invalid);
}

#[test]
fn the_plan_title_cannot_be_blanked() {
    let error = set_title(&chain_plan(), "  ", &today()).expect_err("blank");
    assert_eq!(error.code, PlanErrorCode::Invalid);
}

#[test]
fn explaining_a_choice_names_what_it_unlocks_and_what_stays_blocked() {
    let clock = today();
    let mut plan = empty_plan(&clock, "Unlocks");
    plan.nodes = vec![
        PlanNode::open("draft", "Draft it", 3),
        PlanNode::open("slot", "Book a slot", 1),
        PlanNode::open("review", "Review together", 2).requiring(&["draft", "slot"]),
        PlanNode::open("notes", "Write notes", 1).requiring(&["draft"]),
    ];

    let explanation = explain_choice(&plan, "draft", &clock).expect("explain");
    assert_eq!(explanation.kind, NodeKind::Eligible);
    assert_eq!(explanation.remaining_budget, 8);
    assert!(explanation.fits_budget);
    assert_eq!(
        explanation
            .immediate_unlocks
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        vec!["notes"]
    );
    assert_eq!(explanation.still_blocked_dependents.len(), 1);
    assert_eq!(explanation.still_blocked_dependents[0].id, "review");
    assert_eq!(
        explanation.still_blocked_dependents[0].waiting_on[0].id,
        "slot"
    );
}

#[test]
fn explaining_a_choice_reports_how_far_over_budget_it_is() {
    let mut plan = chain_plan();
    plan.spent_today = 7;
    let explanation = explain_choice(&plan, "receipts", &today()).expect("explain");
    assert!(!explanation.fits_budget);
    assert_eq!(explanation.over_by, 1);
}

#[test]
fn explaining_an_unknown_node_is_refused() {
    let error = explain_choice(&chain_plan(), "ghost", &today()).expect_err("not found");
    assert_eq!(error.code, PlanErrorCode::NotFound);
}

#[test]
fn every_command_rolls_the_day_forward_before_it_acts() {
    let mut plan = chain_plan();
    plan.spent_today = 6;
    let after = complete_node(&plan, "walk", &tomorrow()).expect("complete tomorrow");
    assert_eq!(after.active_date, "2026-09-01");
    assert_eq!(after.spent_today, 1, "yesterday's spending does not follow");
}

#[test]
fn slugs_stay_readable_and_bounded() {
    assert_eq!(slugify("Pay the *overdue* bill!"), "pay-the-overdue-bill");
    assert_eq!(slugify("   "), "");
    assert_eq!(slugify("café"), "caf");
    assert!(slugify(&"word ".repeat(40)).chars().count() <= 32);
}
