//! Importing the JSON plans the browser build of Taltree writes.
//!
//! The field names are already the same, so the import is a parse plus the same
//! validation a YAML load runs.

use crate::domain::types::{Plan, PlanError, PlanResult};

use super::validate::validate_plan;

pub fn from_json(text: &str) -> PlanResult<Plan> {
    let plan: Plan = serde_json::from_str(text).map_err(|error| {
        PlanError::invalid(format!("That file is not a valid Taltree plan: {error}"))
    })?;
    validate_plan(plan)
}

pub fn to_json(plan: &Plan) -> String {
    let mut text = serde_json::to_string_pretty(plan).expect("a plan is always serializable");
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::NodeStatus;

    /// Byte-for-byte shape of a plan exported by the browser build.
    const BROWSER_EXPORT: &str = r#"{
  "version": 1,
  "title": "A full Thursday",
  "dailyBudget": 8,
  "activeDate": "2026-08-31",
  "spentToday": 3,
  "nodes": [
    {
      "id": "receipts",
      "title": "Find last year's receipts",
      "cost": 2,
      "status": "completed",
      "deferredOn": null,
      "completedOn": "2026-08-31",
      "prerequisiteIds": []
    },
    {
      "id": "tax",
      "title": "Finish the tax packet",
      "cost": 5,
      "status": "open",
      "deferredOn": null,
      "completedOn": null,
      "prerequisiteIds": ["receipts"]
    }
  ]
}"#;

    #[test]
    fn a_browser_export_imports_unchanged() {
        let plan = from_json(BROWSER_EXPORT).expect("imports");
        assert_eq!(plan.title, "A full Thursday");
        assert_eq!(plan.spent_today, 3);
        assert_eq!(plan.nodes.len(), 2);
        assert_eq!(plan.node("receipts").unwrap().status, NodeStatus::Completed);
        assert_eq!(plan.node("receipts").unwrap().deferred_on, None);
        assert_eq!(plan.node("tax").unwrap().prerequisite_ids, vec!["receipts"]);
    }

    #[test]
    fn an_imported_plan_can_be_written_back_as_json() {
        let plan = from_json(BROWSER_EXPORT).expect("imports");
        assert_eq!(from_json(&to_json(&plan)).expect("round trip"), plan);
    }

    #[test]
    fn notes_round_trip_through_json() {
        let json = r#"{
  "version": 1,
  "title": "A full Thursday",
  "dailyBudget": 8,
  "activeDate": "2026-08-31",
  "spentToday": 0,
  "nodes": [
    {
      "id": "internet",
      "title": "Read about the internet",
      "cost": 1,
      "status": "open",
      "deferredOn": null,
      "completedOn": null,
      "prerequisiteIds": [],
      "notes": "Start here.\n- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)"
    }
  ]
}"#;
        let plan = from_json(json).expect("imports");
        let notes = plan
            .node("internet")
            .unwrap()
            .notes
            .as_deref()
            .expect("notes");
        assert!(notes.contains("The Internet"), "{notes}");
        assert_eq!(from_json(&to_json(&plan)).expect("round trip"), plan);
    }

    #[test]
    fn a_broken_file_is_refused_with_the_reason() {
        let error = from_json("{ not json").expect_err("broken");
        assert!(
            error
                .message
                .starts_with("That file is not a valid Taltree plan"),
            "{}",
            error.message
        );
    }
}
