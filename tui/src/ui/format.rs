//! The short strings the chrome is made of.
//!
//! They live apart from the drawing code so what the person reads can be
//! asserted without a terminal.

use crate::domain::types::{NamedRef, PlanView};

/// Cells in the budget meter.
pub const METER_WIDTH: usize = 12;

/// `Budget: [██████░░░░░░] 4/8 remaining (4 spent) · 2 of 16 unlocked · 2026-08-31`
///
/// The meter fills with what is left rather than what is gone: the question the
/// bar answers is how much of today is still available.
pub fn budget_bar(view: &PlanView, today: &str) -> String {
    let budget = view.plan.daily_budget;
    let spent = view.plan.spent_today;
    let remaining = view.remaining;
    format!(
        "Budget: [{}] {remaining}/{budget} remaining ({spent} spent) · {} of {} unlocked · {today}",
        meter(remaining, budget),
        view.completed_count(),
        view.plan.nodes.len(),
    )
}

/// The filled and empty cells of the budget meter.
pub fn meter(remaining: u32, budget: u32) -> String {
    let filled = if budget == 0 {
        0
    } else {
        // Any budget left keeps at least one cell lit, so "nearly none" and
        // "none at all" never look the same.
        let exact = remaining as usize * METER_WIDTH / budget as usize;
        if remaining > 0 {
            exact.max(1)
        } else {
            0
        }
    };
    let filled = filled.min(METER_WIDTH);
    format!("{}{}", "█".repeat(filled), "░".repeat(METER_WIDTH - filled))
}

/// "Find receipts, Book a slot", for naming what a node waits on.
pub fn names(refs: &[NamedRef]) -> String {
    refs.iter()
        .map(|reference| reference.title.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// "3 points" / "1 point".
pub fn points(cost: u32) -> String {
    if cost == 1 {
        "1 point".to_string()
    } else {
        format!("{cost} points")
    }
}

/// The keys worth naming along the bottom of the screen.
pub const NORMAL_HINTS: &str =
    "hjkl move · c complete · d defer · a add · e edit · r link · D delete · / search · v view · ? help · q quit";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clock::FrozenClock;
    use crate::domain::plan::{complete_node, empty_plan, inspect};
    use crate::domain::types::{Plan, PlanNode};

    fn plan() -> Plan {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan = empty_plan(&clock, "Day");
        plan.nodes = vec![
            PlanNode::open("a", "Alpha", 4),
            PlanNode::open("b", "Bravo", 2),
        ];
        plan
    }

    #[test]
    fn the_budget_bar_says_what_is_left_what_is_done_and_what_day_it_is() {
        let clock = FrozenClock::new("2026-08-31");
        let done = complete_node(&plan(), "a", &clock).expect("complete");
        let view = inspect(&done, &clock);
        assert_eq!(
            budget_bar(&view, "2026-08-31"),
            "Budget: [██████░░░░░░] 4/8 remaining (4 spent) · 1 of 2 unlocked · 2026-08-31"
        );
    }

    #[test]
    fn the_meter_fills_with_what_is_left() {
        assert_eq!(meter(8, 8), "████████████");
        assert_eq!(meter(4, 8), "██████░░░░░░");
        assert_eq!(meter(0, 8), "░░░░░░░░░░░░");
    }

    #[test]
    fn a_nearly_spent_day_still_reads_as_not_quite_spent() {
        assert_eq!(meter(1, 40), "█░░░░░░░░░░░");
        assert_ne!(meter(1, 40), meter(0, 40));
    }

    #[test]
    fn a_budget_of_nothing_does_not_divide_by_zero() {
        assert_eq!(meter(0, 0), "░░░░░░░░░░░░");
    }

    #[test]
    fn points_are_counted_in_english() {
        assert_eq!(points(0), "0 points");
        assert_eq!(points(1), "1 point");
        assert_eq!(points(5), "5 points");
    }

    #[test]
    fn names_reads_as_a_list() {
        let refs = vec![
            NamedRef {
                id: "a".to_string(),
                title: "Find receipts".to_string(),
            },
            NamedRef {
                id: "b".to_string(),
                title: "Book a slot".to_string(),
            },
        ];
        assert_eq!(names(&refs), "Find receipts, Book a slot");
        assert_eq!(names(&[]), "");
    }
}
