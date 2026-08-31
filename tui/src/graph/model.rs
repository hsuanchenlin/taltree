//! The projection the board draws: nodes with the kind they wear today, and
//! the prerequisite edges between them.
//!
//! The tree UI reads this; it does not re-derive kinds or unlocks.

use crate::domain::types::{NodeKind, PlanView};

/// One node as the board needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub cost: u32,
    pub kind: NodeKind,
    /// Position in the plan document, the tiebreaker for every ordering.
    pub original_index: usize,
    pub exceeds_budget: bool,
}

/// A hard prerequisite, drawn from the prerequisite down to its dependent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    /// True once the prerequisite is completed: the conduit is live.
    pub illuminated: bool,
}

/// The whole plan, projected.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GraphModel {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

impl GraphModel {
    pub fn node(&self, id: &str) -> Option<&GraphNode> {
        self.nodes.iter().find(|node| node.id == id)
    }

    /// The ids this node depends on.
    pub fn prerequisites_of<'a>(&'a self, id: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.edges
            .iter()
            .filter(move |edge| edge.to == id)
            .map(|edge| edge.from.as_str())
    }

    /// The ids that depend on this node.
    pub fn dependents_of<'a>(&'a self, id: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.edges
            .iter()
            .filter(move |edge| edge.from == id)
            .map(|edge| edge.to.as_str())
    }
}

/// Project today's plan onto the board.
pub fn build_graph(view: &PlanView) -> GraphModel {
    let nodes: Vec<GraphNode> = view
        .listings
        .iter()
        .enumerate()
        .map(|(index, listing)| GraphNode {
            id: listing.node.id.clone(),
            title: listing.node.title.clone(),
            cost: listing.node.cost,
            kind: listing.kind,
            original_index: index,
            exceeds_budget: listing.exceeds_budget,
        })
        .collect();

    let mut edges = Vec::new();
    for listing in &view.listings {
        for prerequisite_id in &listing.node.prerequisite_ids {
            let Some(prerequisite) = view.listing(prerequisite_id) else {
                continue;
            };
            edges.push(GraphEdge {
                from: prerequisite_id.clone(),
                to: listing.node.id.clone(),
                illuminated: prerequisite.kind == NodeKind::Completed,
            });
        }
    }

    GraphModel { nodes, edges }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clock::FrozenClock;
    use crate::domain::plan::{complete_node, defer_node, empty_plan, inspect};
    use crate::domain::types::{Plan, PlanNode};

    fn view_of(plan: &Plan) -> PlanView {
        inspect(plan, &FrozenClock::new("2026-08-31"))
    }

    fn chain() -> Plan {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan = empty_plan(&clock, "Chain");
        plan.nodes = vec![
            PlanNode::open("a", "Alpha", 2),
            PlanNode::open("b", "Bravo", 3).requiring(&["a"]),
            PlanNode::open("c", "Charlie", 1).requiring(&["a"]),
        ];
        plan
    }

    #[test]
    fn every_node_carries_the_kind_it_wears_today() {
        let model = build_graph(&view_of(&chain()));
        assert_eq!(model.node("a").unwrap().kind, NodeKind::Eligible);
        assert_eq!(model.node("b").unwrap().kind, NodeKind::Blocked);
    }

    #[test]
    fn a_deferred_node_shows_as_deferred() {
        let clock = FrozenClock::new("2026-08-31");
        let plan = defer_node(&chain(), "a", &clock).expect("defer");
        let model = build_graph(&inspect(&plan, &clock));
        assert_eq!(model.node("a").unwrap().kind, NodeKind::Deferred);
    }

    #[test]
    fn edges_run_from_prerequisite_to_dependent() {
        let model = build_graph(&view_of(&chain()));
        assert_eq!(model.edges.len(), 2);
        assert!(model.edges.iter().all(|edge| edge.from == "a"));
        assert_eq!(model.dependents_of("a").collect::<Vec<_>>(), vec!["b", "c"]);
        assert_eq!(model.prerequisites_of("b").collect::<Vec<_>>(), vec!["a"]);
    }

    #[test]
    fn a_conduit_lights_up_once_its_prerequisite_is_done() {
        let clock = FrozenClock::new("2026-08-31");
        assert!(build_graph(&view_of(&chain()))
            .edges
            .iter()
            .all(|edge| !edge.illuminated));

        let plan = complete_node(&chain(), "a", &clock).expect("complete");
        let model = build_graph(&inspect(&plan, &clock));
        assert!(model.edges.iter().all(|edge| edge.illuminated));
    }

    #[test]
    fn eligible_work_that_no_longer_fits_the_day_is_flagged() {
        let mut plan = chain();
        plan.spent_today = 7;
        let model = build_graph(&view_of(&plan));
        assert!(model.node("a").unwrap().exceeds_budget);
    }

    #[test]
    fn an_empty_plan_projects_to_an_empty_board() {
        let clock = FrozenClock::new("2026-08-31");
        assert_eq!(
            build_graph(&inspect(&empty_plan(&clock, "Nothing"), &clock)),
            GraphModel::default()
        );
    }
}
