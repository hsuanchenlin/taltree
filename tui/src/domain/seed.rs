//! A first board worth looking at.
//!
//! A useful Thursday for an overloaded person: more eligible work than one
//! day's budget, with a few chains so choices have unlock consequences.

use super::clock::Clock;
use super::types::{Plan, PlanNode, PLAN_VERSION};

pub fn demo_plan(clock: &dyn Clock) -> Plan {
    Plan {
        version: PLAN_VERSION,
        title: "A full Thursday".to_string(),
        daily_budget: 8,
        active_date: clock.today(),
        spent_today: 0,
        nodes: vec![
            PlanNode::open("triage-inbox", "Triage inbox", 1),
            PlanNode::open("pay-the-bill", "Pay the overdue bill", 1),
            PlanNode::open("find-receipts", "Find last year's receipts", 2),
            PlanNode::open("tax-packet", "Finish the tax packet", 5).requiring(&["find-receipts"]),
            PlanNode::open("draft-proposal", "Draft the project proposal", 3),
            PlanNode::open("book-a-slot", "Block a 30-minute slot", 1),
            PlanNode::open("walk-the-proposal", "Walk the proposal with a teammate", 2)
                .requiring(&["draft-proposal", "book-a-slot"]),
            PlanNode::open("send-proposal", "Send the proposal", 1)
                .requiring(&["walk-the-proposal"]),
            PlanNode::open("grocery-run", "Grocery run", 2),
            PlanNode::open("cook-dinner", "Cook dinner", 2).requiring(&["grocery-run"]),
            PlanNode::open("thirty-minute-walk", "Thirty-minute walk", 1),
            PlanNode::open("school-email", "Read the school email", 1),
            PlanNode::open("rsvp", "RSVP to the school event", 1).requiring(&["school-email"]),
            PlanNode::open("pack-the-bag", "Pack tomorrow's bag", 1),
            PlanNode::open("call-the-dentist", "Call the dentist", 1),
            PlanNode::open("rewrite-the-talk", "Rewrite the guest talk", 6),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clock::FrozenClock;
    use crate::domain::plan::inspect;
    use crate::domain::types::NodeKind;

    #[test]
    fn the_demo_offers_more_eligible_work_than_one_day_of_budget() {
        let clock = FrozenClock::new("2026-08-31");
        let view = inspect(&demo_plan(&clock), &clock);
        let eligible_cost: u32 = view.frontier().map(|listing| listing.node.cost).sum();
        assert!(eligible_cost > view.plan.daily_budget);
    }

    #[test]
    fn the_demo_has_chains_so_choices_unlock_things() {
        let clock = FrozenClock::new("2026-08-31");
        let view = inspect(&demo_plan(&clock), &clock);
        let blocked = view
            .listings
            .iter()
            .filter(|listing| listing.kind == NodeKind::Blocked)
            .count();
        assert!(
            blocked >= 4,
            "expected chains, found {blocked} blocked nodes"
        );
    }

    #[test]
    fn every_demo_prerequisite_names_a_node_that_exists() {
        let clock = FrozenClock::new("2026-08-31");
        let plan = demo_plan(&clock);
        for node in &plan.nodes {
            for prereq in &node.prerequisite_ids {
                assert!(
                    plan.node(prereq).is_some(),
                    "{} names missing prerequisite {prereq}",
                    node.id
                );
            }
        }
    }
}
