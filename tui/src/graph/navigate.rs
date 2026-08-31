//! Moving around the board with `h j k l`.
//!
//! Up and down follow the conduits first - `k` climbs to a prerequisite, `j`
//! drops to a dependent - because that is the relationship the board is drawn
//! to show. Only when there is no conduit that way does the move fall back to
//! the nearest node in that direction, so an unconnected part of the plan is
//! still reachable.

use super::layout::{LaidOutGraph, PlacedNode};
use super::model::GraphModel;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

/// The node `h j k l` lands on from `from`, or `None` when nothing lies that way.
pub fn step(
    laid: &LaidOutGraph,
    model: &GraphModel,
    from: &str,
    direction: Direction,
) -> Option<String> {
    let origin = laid.node(from)?;
    let along_conduit = match direction {
        Direction::Up => nearest_of(laid, origin, model.prerequisites_of(from)),
        Direction::Down => nearest_of(laid, origin, model.dependents_of(from)),
        _ => None,
    };
    along_conduit.or_else(|| nearest_in_direction(laid, origin, direction))
}

/// The first node on the board: where `g` goes.
pub fn first(laid: &LaidOutGraph) -> Option<String> {
    laid.nodes
        .iter()
        .min_by_key(|node| (node.rank, node.y, node.x, node.original_index))
        .map(|node| node.id.clone())
}

/// The last node on the board: where `G` goes when nothing is eligible.
pub fn last(laid: &LaidOutGraph) -> Option<String> {
    laid.nodes
        .iter()
        .max_by_key(|node| (node.rank, node.y, node.x, node.original_index))
        .map(|node| node.id.clone())
}

/// The node nearest `from` among `candidates`, by board distance.
pub fn nearest_among(
    laid: &LaidOutGraph,
    from: Option<&str>,
    candidates: &[String],
) -> Option<String> {
    let origin = from.and_then(|id| laid.node(id));
    let Some(origin) = origin else {
        return candidates
            .iter()
            .filter_map(|id| laid.node(id))
            .min_by_key(|node| (node.y, node.x, node.original_index))
            .map(|node| node.id.clone());
    };
    candidates
        .iter()
        .filter(|id| id.as_str() != origin.id.as_str())
        .filter_map(|id| laid.node(id))
        .min_by_key(|node| (distance(origin, node), node.original_index))
        .map(|node| node.id.clone())
}

fn nearest_of<'a>(
    laid: &LaidOutGraph,
    origin: &PlacedNode,
    candidates: impl Iterator<Item = &'a str>,
) -> Option<String> {
    candidates
        .filter_map(|id| laid.node(id))
        .min_by_key(|node| {
            (
                horizontal_distance(origin, node),
                node.y,
                node.original_index,
            )
        })
        .map(|node| node.id.clone())
}

/// The nearest node in a direction.
///
/// The two axes read differently because the board does: `j` and `k` cross
/// ranks, so the nearest row wins and the column only breaks ties; `h` and `l`
/// travel along a rank, so staying on the same row wins and the nearest column
/// breaks ties.
fn nearest_in_direction(
    laid: &LaidOutGraph,
    origin: &PlacedNode,
    direction: Direction,
) -> Option<String> {
    laid.nodes
        .iter()
        .filter(|node| node.id != origin.id)
        .filter(|node| lies(origin, node, direction))
        .min_by_key(|node| {
            let along = along(origin, node, direction);
            let across = across(origin, node, direction);
            match direction {
                Direction::Up | Direction::Down => (along, across, node.original_index),
                Direction::Left | Direction::Right => (across, along, node.original_index),
            }
        })
        .map(|node| node.id.clone())
}

fn lies(origin: &PlacedNode, other: &PlacedNode, direction: Direction) -> bool {
    match direction {
        Direction::Up => other.center_y() < origin.center_y(),
        Direction::Down => other.center_y() > origin.center_y(),
        Direction::Left => other.center_x() < origin.center_x(),
        Direction::Right => other.center_x() > origin.center_x(),
    }
}

fn along(origin: &PlacedNode, other: &PlacedNode, direction: Direction) -> u32 {
    match direction {
        Direction::Up | Direction::Down => gap(origin.center_y(), other.center_y()),
        Direction::Left | Direction::Right => gap(origin.center_x(), other.center_x()),
    }
}

fn across(origin: &PlacedNode, other: &PlacedNode, direction: Direction) -> u32 {
    match direction {
        Direction::Up | Direction::Down => gap(origin.center_x(), other.center_x()),
        Direction::Left | Direction::Right => gap(origin.center_y(), other.center_y()),
    }
}

fn horizontal_distance(origin: &PlacedNode, other: &PlacedNode) -> u32 {
    gap(origin.center_x(), other.center_x())
}

fn distance(origin: &PlacedNode, other: &PlacedNode) -> u32 {
    gap(origin.center_x(), other.center_x()) + gap(origin.center_y(), other.center_y())
}

fn gap(a: u16, b: u16) -> u32 {
    (a as i32 - b as i32).unsigned_abs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clock::FrozenClock;
    use crate::domain::plan::{empty_plan, inspect};
    use crate::domain::types::{Plan, PlanNode};
    use crate::graph::layout::{layout_graph, Density, LayoutOptions};
    use crate::graph::model::build_graph;

    struct Board {
        laid: LaidOutGraph,
        model: GraphModel,
    }

    fn board(nodes: Vec<PlanNode>) -> Board {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan: Plan = empty_plan(&clock, "Nav");
        plan.nodes = nodes;
        let model = build_graph(&inspect(&plan, &clock));
        let laid = layout_graph(
            &model,
            LayoutOptions {
                density: Density::Compact,
                target_row_width: 400,
            },
        );
        Board { laid, model }
    }

    fn tree() -> Board {
        board(vec![
            PlanNode::open("root", "Root", 1),
            PlanNode::open("left", "Left child", 1).requiring(&["root"]),
            PlanNode::open("right", "Right child", 1).requiring(&["root"]),
            PlanNode::open("leaf", "Grandchild", 1).requiring(&["left"]),
            PlanNode::open("lonely", "Unconnected", 1),
        ])
    }

    fn go(board: &Board, from: &str, direction: Direction) -> Option<String> {
        step(&board.laid, &board.model, from, direction)
    }

    #[test]
    fn down_follows_a_conduit_to_a_dependent() {
        let board = tree();
        let landed = go(&board, "root", Direction::Down).expect("a dependent");
        assert!(landed == "left" || landed == "right", "landed on {landed}");
    }

    #[test]
    fn up_follows_a_conduit_back_to_the_prerequisite() {
        let board = tree();
        assert_eq!(go(&board, "leaf", Direction::Up).as_deref(), Some("left"));
        assert_eq!(go(&board, "left", Direction::Up).as_deref(), Some("root"));
    }

    #[test]
    fn left_and_right_move_between_siblings() {
        let board = tree();
        let left_x = board.laid.node("left").unwrap().center_x();
        let right_x = board.laid.node("right").unwrap().center_x();
        let (west, east) = if left_x < right_x {
            ("left", "right")
        } else {
            ("right", "left")
        };
        assert_eq!(go(&board, west, Direction::Right).as_deref(), Some(east));
        assert_eq!(go(&board, east, Direction::Left).as_deref(), Some(west));
    }

    #[test]
    fn the_edge_of_the_board_is_the_end_of_the_road() {
        let board = tree();
        assert_eq!(go(&board, "root", Direction::Up), None);
        assert_eq!(go(&board, "leaf", Direction::Down), None);
    }

    #[test]
    fn a_node_with_no_conduit_that_way_falls_back_to_the_nearest_neighbour() {
        // "lonely" has no prerequisites, so k has no conduit to follow. It is
        // laid out beside the tree, so nothing is above it either.
        let board = tree();
        assert_eq!(go(&board, "lonely", Direction::Up), None);
        assert!(go(&board, "lonely", Direction::Left).is_some());
    }

    #[test]
    fn down_from_an_unconnected_node_reaches_the_row_below_it() {
        let board = board(vec![
            PlanNode::open("a", "Alpha", 1),
            PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
            PlanNode::open("free", "Free", 1),
        ]);
        assert_eq!(go(&board, "free", Direction::Down).as_deref(), Some("b"));
    }

    #[test]
    fn moving_from_a_node_that_is_not_on_the_board_lands_nowhere() {
        let board = tree();
        assert_eq!(go(&board, "ghost", Direction::Down), None);
    }

    #[test]
    fn g_goes_to_the_first_node_and_shift_g_to_the_last() {
        let board = tree();
        assert_eq!(first(&board.laid).as_deref(), Some("root"));
        assert_eq!(last(&board.laid).as_deref(), Some("leaf"));
    }

    #[test]
    fn an_empty_board_has_no_first_or_last_node() {
        let board = board(vec![]);
        assert_eq!(first(&board.laid), None);
        assert_eq!(last(&board.laid), None);
    }

    #[test]
    fn the_nearest_match_is_the_one_a_search_jumps_to() {
        let board = tree();
        let candidates = vec!["leaf".to_string(), "right".to_string()];
        assert_eq!(
            nearest_among(&board.laid, Some("root"), &candidates).as_deref(),
            Some("right")
        );
        assert_eq!(
            nearest_among(&board.laid, None, &candidates).as_deref(),
            Some("right")
        );
    }
}
