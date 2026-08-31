//! The person-owned document on disk: YAML a person can read and edit.
//!
//! Optional fields are omitted rather than written as `null`, so a plain plan
//! stays a plain file.

use crate::domain::types::{Plan, PlanError, PlanResult};

use super::validate::validate_plan;

/// Written at the top of every saved plan so a file found later explains itself.
pub const HEADER: &str =
    "# Taltree plan. Edit by hand if you like: ids are stable references,\n# dates are YYYY-MM-DD, and costs are whole points.\n";

/// Render a plan as the YAML document Taltree writes.
pub fn to_yaml(plan: &Plan) -> String {
    let body = serde_norway::to_string(plan).expect("a plan is always serializable");
    format!("{HEADER}{body}")
}

/// Read a YAML document into a checked plan.
pub fn from_yaml(text: &str) -> PlanResult<Plan> {
    let plan: Plan = serde_norway::from_str(text).map_err(|error| {
        PlanError::invalid(format!("That file is not a valid Taltree plan: {error}"))
    })?;
    validate_plan(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clock::FrozenClock;
    use crate::domain::seed::demo_plan;
    use crate::domain::types::{NodeStatus, PlanNode, PLAN_VERSION};

    fn sample() -> Plan {
        Plan {
            version: PLAN_VERSION,
            title: "A full Thursday".to_string(),
            daily_budget: 8,
            active_date: "2026-08-31".to_string(),
            spent_today: 2,
            nodes: vec![
                PlanNode {
                    status: NodeStatus::Completed,
                    completed_on: Some("2026-08-31".to_string()),
                    notes: Some("Shoebox in the hall cupboard".to_string()),
                    ..PlanNode::open("receipts", "Find receipts", 2)
                },
                PlanNode::open("tax", "File the tax packet", 5).requiring(&["receipts"]),
            ],
        }
    }

    #[test]
    fn a_saved_plan_reads_the_way_a_person_would_write_it() {
        assert_eq!(
            to_yaml(&sample()),
            concat!(
                "# Taltree plan. Edit by hand if you like: ids are stable references,\n",
                "# dates are YYYY-MM-DD, and costs are whole points.\n",
                "version: 1\n",
                "title: A full Thursday\n",
                "dailyBudget: 8\n",
                "activeDate: 2026-08-31\n",
                "spentToday: 2\n",
                "nodes:\n",
                "- id: receipts\n",
                "  title: Find receipts\n",
                "  cost: 2\n",
                "  status: completed\n",
                "  completedOn: 2026-08-31\n",
                "  notes: Shoebox in the hall cupboard\n",
                "- id: tax\n",
                "  title: File the tax packet\n",
                "  cost: 5\n",
                "  status: open\n",
                "  prerequisiteIds:\n",
                "  - receipts\n",
            )
        );
    }

    #[test]
    fn a_plan_survives_the_round_trip() {
        let plan = sample();
        assert_eq!(from_yaml(&to_yaml(&plan)).expect("reads back"), plan);
    }

    #[test]
    fn the_demo_plan_survives_the_round_trip() {
        let plan = demo_plan(&FrozenClock::new("2026-08-31"));
        assert_eq!(from_yaml(&to_yaml(&plan)).expect("reads back"), plan);
    }

    #[test]
    fn a_hand_written_file_needs_only_the_fields_that_matter() {
        let plan = from_yaml(
            "version: 1\n\
             title: Minimal\n\
             dailyBudget: 4\n\
             activeDate: 2026-08-31\n\
             spentToday: 0\n\
             nodes:\n\
             \x20 - id: one\n\
             \x20   title: Just one thing\n\
             \x20   cost: 1\n\
             \x20   status: open\n",
        )
        .expect("reads");
        assert_eq!(plan.nodes.len(), 1);
        assert!(plan.nodes[0].prerequisite_ids.is_empty());
        assert_eq!(plan.nodes[0].notes, None);
    }

    #[test]
    fn comments_and_quoting_styles_are_accepted() {
        let plan = from_yaml(
            "# my plan\n\
             version: 1\n\
             title: \"Quoted title\"\n\
             dailyBudget: 4\n\
             activeDate: \"2026-08-31\"\n\
             spentToday: 0\n\
             nodes: []\n",
        )
        .expect("reads");
        assert_eq!(plan.title, "Quoted title");
        assert!(plan.nodes.is_empty());
    }

    #[test]
    fn a_broken_file_is_refused_with_the_reason() {
        let error = from_yaml("version: 1\ntitle: [not a string]\n").expect_err("broken");
        assert!(
            error
                .message
                .starts_with("That file is not a valid Taltree plan"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_document_that_breaks_the_rules_is_refused_on_load() {
        let error = from_yaml(
            "version: 1\n\
             title: Loop\n\
             dailyBudget: 4\n\
             activeDate: 2026-08-31\n\
             spentToday: 0\n\
             nodes:\n\
             \x20 - id: a\n\
             \x20   title: A\n\
             \x20   cost: 1\n\
             \x20   status: open\n\
             \x20   prerequisiteIds: [b]\n\
             \x20 - id: b\n\
             \x20   title: B\n\
             \x20   cost: 1\n\
             \x20   status: open\n\
             \x20   prerequisiteIds: [a]\n",
        )
        .expect_err("cycle");
        assert!(error.message.contains("cycle"), "{}", error.message);
    }
}
