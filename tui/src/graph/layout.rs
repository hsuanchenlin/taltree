//! Layered (Sugiyama) layout of the plan, measured in terminal cells.
//!
//! Prerequisites sit above their dependents, rank orders are chosen by
//! barycentre to keep conduits from crossing, and an edge that spans more than
//! one rank is broken over dummy slots so its conduit gets reserved space
//! instead of running through whatever node happens to be in the way.
//!
//! Coordinates are cell coordinates: `(0, 0)` is the top-left cell of the
//! board, `x` grows right and `y` grows down.

use std::collections::HashMap;

use super::model::{GraphModel, GraphNode};

/// How much room a node gets on the board.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Density {
    /// One-row chips: the whole plan at a glance.
    Compact,
    /// Three-row boxes: easier to read, more panning.
    Expanded,
}

impl Density {
    pub fn toggled(self) -> Self {
        match self {
            Density::Compact => Density::Expanded,
            Density::Expanded => Density::Compact,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Density::Compact => "compact",
            Density::Expanded => "expanded",
        }
    }

    pub fn metrics(self) -> Metrics {
        match self {
            Density::Compact => Metrics {
                node_width: 24,
                node_height: 1,
                column_gap: 2,
                rank_gap: 2,
                component_gap: 3,
                row_gap: 2,
                margin: 1,
            },
            Density::Expanded => Metrics {
                node_width: 26,
                node_height: 3,
                column_gap: 2,
                rank_gap: 2,
                component_gap: 3,
                row_gap: 2,
                margin: 1,
            },
        }
    }
}

/// The cell budget every piece of the board is measured against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Metrics {
    pub node_width: u16,
    pub node_height: u16,
    pub column_gap: u16,
    /// Rows between one rank's bottom and the next rank's top. Two rows is the
    /// minimum a conduit needs: one to leave the node, one to travel sideways.
    pub rank_gap: u16,
    pub component_gap: u16,
    pub row_gap: u16,
    pub margin: u16,
}

/// What the caller wants from a layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutOptions {
    pub density: Density,
    /// Unconnected pieces of the plan wrap onto a new row past this width, so a
    /// plan of many roots stays reachable instead of running off to the right.
    pub target_row_width: u16,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        LayoutOptions {
            density: Density::Compact,
            target_row_width: 96,
        }
    }
}

/// A node with a place on the board.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlacedNode {
    pub id: String,
    pub original_index: usize,
    pub rank: usize,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

impl PlacedNode {
    pub fn center_x(&self) -> u16 {
        self.x + self.width / 2
    }

    pub fn center_y(&self) -> u16 {
        self.y + self.height / 2
    }

    pub fn contains(&self, x: u16, y: u16) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

/// A prerequisite edge as a run of orthogonal cell waypoints.
///
/// Consecutive points always share a row or a column, so the conduit renderer
/// can walk straight runs between them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutedEdge {
    pub from: String,
    pub to: String,
    pub illuminated: bool,
    pub points: Vec<(u16, u16)>,
}

/// The whole board: where every node sits and how every conduit runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaidOutGraph {
    pub nodes: Vec<PlacedNode>,
    pub edges: Vec<RoutedEdge>,
    pub width: u16,
    pub height: u16,
    pub metrics: Metrics,
}

impl LaidOutGraph {
    pub fn node(&self, id: &str) -> Option<&PlacedNode> {
        self.nodes.iter().find(|node| node.id == id)
    }

    /// The node whose box covers this cell, if any.
    pub fn node_at(&self, x: u16, y: u16) -> Option<&PlacedNode> {
        self.nodes.iter().find(|node| node.contains(x, y))
    }
}

/// Lay the plan out on the board.
pub fn layout_graph(model: &GraphModel, options: LayoutOptions) -> LaidOutGraph {
    let metrics = options.density.metrics();
    if model.nodes.is_empty() {
        return LaidOutGraph {
            nodes: Vec::new(),
            edges: Vec::new(),
            width: metrics.margin * 2,
            height: metrics.margin * 2,
            metrics,
        };
    }

    let components = split_components(model);
    let laid: Vec<Component> = components
        .iter()
        .map(|component| layout_component(component, &metrics))
        .collect();
    pack(laid, &metrics, options.target_row_width)
}

/// One weakly connected piece of the plan.
struct Piece {
    nodes: Vec<GraphNode>,
    edges: Vec<(usize, usize, bool)>,
}

/// A laid-out piece, still in its own coordinate space.
struct Component {
    nodes: Vec<PlacedNode>,
    edges: Vec<RoutedEdge>,
    width: u16,
    height: u16,
}

fn split_components(model: &GraphModel) -> Vec<Piece> {
    let index_of: HashMap<&str, usize> = model
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.as_str(), index))
        .collect();

    let mut parent: Vec<usize> = (0..model.nodes.len()).collect();
    for edge in &model.edges {
        let (Some(&from), Some(&to)) = (
            index_of.get(edge.from.as_str()),
            index_of.get(edge.to.as_str()),
        ) else {
            continue;
        };
        union(&mut parent, from, to);
    }

    // Components keep the document order of their first node, so adding an
    // unrelated node never reshuffles the board.
    let mut order: Vec<usize> = Vec::new();
    let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
    for index in 0..model.nodes.len() {
        let root = find(&mut parent, index);
        members.entry(root).or_insert_with(|| {
            order.push(root);
            Vec::new()
        });
        members.get_mut(&root).expect("just inserted").push(index);
    }

    order
        .into_iter()
        .map(|root| {
            let indices = members.remove(&root).unwrap_or_default();
            let local_of: HashMap<usize, usize> = indices
                .iter()
                .enumerate()
                .map(|(local, &global)| (global, local))
                .collect();
            let nodes: Vec<GraphNode> = indices
                .iter()
                .map(|&global| model.nodes[global].clone())
                .collect();
            let edges = model
                .edges
                .iter()
                .filter_map(|edge| {
                    let from = index_of.get(edge.from.as_str())?;
                    let to = index_of.get(edge.to.as_str())?;
                    Some((*local_of.get(from)?, *local_of.get(to)?, edge.illuminated))
                })
                .collect();
            Piece { nodes, edges }
        })
        .collect()
}

fn find(parent: &mut [usize], index: usize) -> usize {
    let mut root = index;
    while parent[root] != root {
        root = parent[root];
    }
    let mut cursor = index;
    while parent[cursor] != root {
        let next = parent[cursor];
        parent[cursor] = root;
        cursor = next;
    }
    root
}

fn union(parent: &mut [usize], a: usize, b: usize) {
    let (ra, rb) = (find(parent, a), find(parent, b));
    if ra == rb {
        return;
    }
    // The lower document index wins, so component identity is stable.
    if ra < rb {
        parent[rb] = ra;
    } else {
        parent[ra] = rb;
    }
}

/// A slot in the layered graph: either a real node or a bend point reserved for
/// an edge that spans more than one rank.
struct Cell {
    rank: usize,
    width: i32,
    node: Option<usize>,
    x: i32,
}

fn layout_component(piece: &Piece, metrics: &Metrics) -> Component {
    let ranks = assign_ranks(piece);
    let max_rank = ranks.iter().copied().max().unwrap_or(0);

    let mut cells: Vec<Cell> = piece
        .nodes
        .iter()
        .enumerate()
        .map(|(index, _)| Cell {
            rank: ranks[index],
            width: metrics.node_width as i32,
            node: Some(index),
            x: 0,
        })
        .collect();

    let mut predecessors: Vec<Vec<usize>> = vec![Vec::new(); cells.len()];
    let mut successors: Vec<Vec<usize>> = vec![Vec::new(); cells.len()];
    let mut chains: Vec<Vec<usize>> = Vec::with_capacity(piece.edges.len());

    for &(from, to, _) in &piece.edges {
        let mut chain = vec![from];
        let (top, bottom) = (ranks[from], ranks[to]);
        for rank in (top + 1)..bottom {
            let dummy = cells.len();
            cells.push(Cell {
                rank,
                width: 1,
                node: None,
                x: 0,
            });
            predecessors.push(Vec::new());
            successors.push(Vec::new());
            chain.push(dummy);
        }
        chain.push(to);
        for pair in chain.windows(2) {
            successors[pair[0]].push(pair[1]);
            predecessors[pair[1]].push(pair[0]);
        }
        chains.push(chain);
    }

    let mut layers: Vec<Vec<usize>> = vec![Vec::new(); max_rank + 1];
    for (index, cell) in cells.iter().enumerate() {
        layers[cell.rank].push(index);
    }

    order_layers(&mut layers, &predecessors, &successors);
    assign_x(&mut cells, &layers, &predecessors, &successors, metrics);

    let shift = cells.iter().map(|cell| cell.x).min().unwrap_or(0);
    for cell in &mut cells {
        cell.x -= shift;
    }

    let rank_stride = (metrics.node_height + metrics.rank_gap) as i32;
    let placed: Vec<PlacedNode> = piece
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| PlacedNode {
            id: node.id.clone(),
            original_index: node.original_index,
            rank: ranks[index],
            x: clamp_u16(cells[index].x),
            y: clamp_u16(ranks[index] as i32 * rank_stride),
            width: metrics.node_width,
            height: metrics.node_height,
        })
        .collect();

    let edges = piece
        .edges
        .iter()
        .zip(chains.iter())
        .map(|(&(from, to, illuminated), chain)| RoutedEdge {
            from: piece.nodes[from].id.clone(),
            to: piece.nodes[to].id.clone(),
            illuminated,
            points: route(chain, &cells, metrics),
        })
        .collect();

    let width = placed
        .iter()
        .map(|node| node.x + node.width)
        .chain(cells.iter().map(|cell| clamp_u16(cell.x + cell.width)))
        .max()
        .unwrap_or(metrics.node_width);
    let height = clamp_u16(max_rank as i32 * rank_stride + metrics.node_height as i32);

    Component {
        nodes: placed,
        edges,
        width,
        height,
    }
}

/// Longest path from a root: a node sits one rank below its deepest prerequisite.
fn assign_ranks(piece: &Piece) -> Vec<usize> {
    let mut incoming: Vec<Vec<usize>> = vec![Vec::new(); piece.nodes.len()];
    for &(from, to, _) in &piece.edges {
        incoming[to].push(from);
    }

    let mut ranks = vec![usize::MAX; piece.nodes.len()];
    let mut visiting = vec![false; piece.nodes.len()];
    for index in 0..piece.nodes.len() {
        rank_of(index, &incoming, &mut ranks, &mut visiting);
    }
    ranks
}

fn rank_of(
    index: usize,
    incoming: &[Vec<usize>],
    ranks: &mut Vec<usize>,
    visiting: &mut Vec<bool>,
) -> usize {
    if ranks[index] != usize::MAX {
        return ranks[index];
    }
    // A validated plan has no cycles; this keeps a corrupt one from recursing
    // forever rather than trusting that.
    if visiting[index] {
        return 0;
    }
    visiting[index] = true;
    let rank = incoming[index]
        .iter()
        .map(|&parent| rank_of(parent, incoming, ranks, visiting) + 1)
        .max()
        .unwrap_or(0);
    visiting[index] = false;
    ranks[index] = rank;
    rank
}

/// Barycentre ordering: sweep down then up, placing each slot at the average
/// position of its neighbours in the rank just visited.
fn order_layers(layers: &mut [Vec<usize>], predecessors: &[Vec<usize>], successors: &[Vec<usize>]) {
    const SWEEPS: usize = 4;
    // Each rank is sorted against positions that the rank before it has just
    // changed, so the sweeps read and write `layers` by index rather than
    // iterating it.
    #[allow(clippy::needless_range_loop)]
    for _ in 0..SWEEPS {
        for rank in 1..layers.len() {
            let positions = positions_of(layers);
            sort_by_barycenter(&mut layers[rank], predecessors, &positions);
        }
        for rank in (0..layers.len().saturating_sub(1)).rev() {
            let positions = positions_of(layers);
            sort_by_barycenter(&mut layers[rank], successors, &positions);
        }
    }
}

fn positions_of(layers: &[Vec<usize>]) -> HashMap<usize, usize> {
    let mut positions = HashMap::new();
    for layer in layers {
        for (index, &cell) in layer.iter().enumerate() {
            positions.insert(cell, index);
        }
    }
    positions
}

fn sort_by_barycenter(
    layer: &mut [usize],
    neighbours: &[Vec<usize>],
    positions: &HashMap<usize, usize>,
) {
    let keys: Vec<f64> = layer
        .iter()
        .enumerate()
        .map(|(index, &cell)| {
            let found: Vec<f64> = neighbours[cell]
                .iter()
                .filter_map(|neighbour| positions.get(neighbour))
                .map(|&position| position as f64)
                .collect();
            if found.is_empty() {
                // Nothing to align with: stay where you are rather than drift.
                index as f64
            } else {
                found.iter().sum::<f64>() / found.len() as f64
            }
        })
        .collect();

    let mut paired: Vec<(f64, usize, usize)> = layer
        .iter()
        .enumerate()
        .map(|(index, &cell)| (keys[index], index, cell))
        .collect();
    paired.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    for (slot, (_, _, cell)) in layer.iter_mut().zip(paired) {
        *slot = cell;
    }
}

/// Pull each slot towards the average of its neighbours without letting any two
/// slots in a rank overlap.
fn assign_x(
    cells: &mut [Cell],
    layers: &[Vec<usize>],
    predecessors: &[Vec<usize>],
    successors: &[Vec<usize>],
    metrics: &Metrics,
) {
    let gap = metrics.column_gap as i32;
    for layer in layers {
        let mut cursor = 0i32;
        for &cell in layer {
            cells[cell].x = cursor;
            cursor += cells[cell].width + gap;
        }
    }

    const SWEEPS: usize = 4;
    #[allow(clippy::needless_range_loop)]
    for _ in 0..SWEEPS {
        for rank in 1..layers.len() {
            settle(cells, &layers[rank], predecessors, gap);
        }
        for rank in (0..layers.len().saturating_sub(1)).rev() {
            settle(cells, &layers[rank], successors, gap);
        }
    }
}

fn settle(cells: &mut [Cell], layer: &[usize], neighbours: &[Vec<usize>], gap: i32) {
    let desired: Vec<i32> = layer
        .iter()
        .map(|&cell| {
            let centers: Vec<i32> = neighbours[cell]
                .iter()
                .map(|&neighbour| center_of(&cells[neighbour]))
                .collect();
            if centers.is_empty() {
                center_of(&cells[cell])
            } else {
                centers.iter().sum::<i32>() / centers.len() as i32
            }
        })
        .collect();

    // Subtracting the room each slot needs turns "keep these apart" into "keep
    // these in order", which has an exact answer; packing greedily from the
    // left instead would shove a pair of prerequisites off to one side of the
    // dependent they share, and the next sweep would chase them.
    let mut offsets = vec![0i32; layer.len()];
    for index in 1..layer.len() {
        offsets[index] = offsets[index - 1] + cells[layer[index - 1]].width + gap;
    }
    let targets: Vec<i32> = layer
        .iter()
        .enumerate()
        .map(|(index, &cell)| desired[index] - cells[cell].width / 2 - offsets[index])
        .collect();

    for (index, (&cell, value)) in layer.iter().zip(isotonic(&targets)).enumerate() {
        cells[cell].x = value + offsets[index];
    }
}

/// The nearest non-decreasing sequence to `targets`, by pooling adjacent
/// violators: the least-squares answer, and the one that keeps a rank centred
/// under what it hangs from.
fn isotonic(targets: &[i32]) -> Vec<i32> {
    let mut blocks: Vec<(i64, i64)> = Vec::with_capacity(targets.len());
    for &target in targets {
        blocks.push((target as i64, 1));
        while blocks.len() >= 2 {
            let (sum, count) = blocks[blocks.len() - 1];
            let (previous_sum, previous_count) = blocks[blocks.len() - 2];
            if previous_sum * count <= sum * previous_count {
                break;
            }
            blocks.pop();
            blocks.pop();
            blocks.push((previous_sum + sum, previous_count + count));
        }
    }

    let mut out = Vec::with_capacity(targets.len());
    for (sum, count) in blocks {
        let value = sum.div_euclid(count) as i32;
        for _ in 0..count {
            out.push(value);
        }
    }
    out
}

fn center_of(cell: &Cell) -> i32 {
    cell.x + cell.width / 2
}

/// Turn a chain of slots into the orthogonal waypoints of one conduit.
fn route(chain: &[usize], cells: &[Cell], metrics: &Metrics) -> Vec<(u16, u16)> {
    let stride = (metrics.node_height + metrics.rank_gap) as i32;
    let height = metrics.node_height as i32;
    let rank_top = |rank: usize| rank as i32 * stride;
    // One row to leave the node, one row to travel sideways in.
    let stub_row = |rank: usize| rank_top(rank) + height;
    let channel_row = |rank: usize| rank_top(rank + 1) - 1;

    let mut points: Vec<(i32, i32)> = Vec::new();
    let push = |point: (i32, i32), points: &mut Vec<(i32, i32)>| {
        if points.last() != Some(&point) {
            points.push(point);
        }
    };

    for pair in chain.windows(2) {
        let (here, next) = (&cells[pair[0]], &cells[pair[1]]);
        let (x, next_x) = (center_of(here), center_of(next));
        push((x, stub_row(here.rank)), &mut points);
        push((x, channel_row(here.rank)), &mut points);
        push((next_x, channel_row(here.rank)), &mut points);
        if next.node.is_none() {
            push((next_x, rank_top(next.rank)), &mut points);
            push((next_x, rank_top(next.rank) + height - 1), &mut points);
        }
    }

    points
        .into_iter()
        .map(|(x, y)| (clamp_u16(x), clamp_u16(y)))
        .collect()
}

/// Place components left to right, wrapping onto a new row past the target width.
fn pack(components: Vec<Component>, metrics: &Metrics, target_row_width: u16) -> LaidOutGraph {
    let margin = metrics.margin as i32;
    let target = target_row_width.max(metrics.node_width) as i32;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut x = margin;
    let mut y = margin;
    let mut row_height = 0i32;
    let mut right_edge = margin;

    for component in components {
        let width = component.width as i32;
        if x > margin && x + width > margin + target {
            x = margin;
            y += row_height + metrics.row_gap as i32;
            row_height = 0;
        }
        for node in component.nodes {
            nodes.push(PlacedNode {
                x: clamp_u16(node.x as i32 + x),
                y: clamp_u16(node.y as i32 + y),
                ..node
            });
        }
        for edge in component.edges {
            edges.push(RoutedEdge {
                points: edge
                    .points
                    .iter()
                    .map(|&(px, py)| (clamp_u16(px as i32 + x), clamp_u16(py as i32 + y)))
                    .collect(),
                ..edge
            });
        }
        right_edge = right_edge.max(x + width);
        x += width + metrics.component_gap as i32;
        row_height = row_height.max(component.height as i32);
    }

    LaidOutGraph {
        width: clamp_u16(right_edge + margin),
        height: clamp_u16(y + row_height + margin),
        nodes,
        edges,
        metrics: *metrics,
    }
}

fn clamp_u16(value: i32) -> u16 {
    value.clamp(0, u16::MAX as i32) as u16
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clock::FrozenClock;
    use crate::domain::plan::{empty_plan, inspect};
    use crate::domain::types::{Plan, PlanNode};
    use crate::graph::model::build_graph;

    fn lay(nodes: Vec<PlanNode>, options: LayoutOptions) -> LaidOutGraph {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan: Plan = empty_plan(&clock, "Layout");
        plan.nodes = nodes;
        layout_graph(&build_graph(&inspect(&plan, &clock)), options)
    }

    fn wide() -> LayoutOptions {
        LayoutOptions {
            density: Density::Compact,
            target_row_width: 400,
        }
    }

    #[test]
    fn a_prerequisite_sits_one_rank_above_its_dependent() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
                PlanNode::open("c", "Charlie", 1).requiring(&["b"]),
            ],
            wide(),
        );
        assert_eq!(laid.node("a").unwrap().rank, 0);
        assert_eq!(laid.node("b").unwrap().rank, 1);
        assert_eq!(laid.node("c").unwrap().rank, 2);
        assert!(laid.node("a").unwrap().y < laid.node("b").unwrap().y);
        assert!(laid.node("b").unwrap().y < laid.node("c").unwrap().y);
    }

    #[test]
    fn a_node_sits_below_its_deepest_prerequisite_not_its_shallowest() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
                PlanNode::open("c", "Charlie", 1).requiring(&["a", "b"]),
            ],
            wide(),
        );
        assert_eq!(laid.node("c").unwrap().rank, 2);
    }

    #[test]
    fn ranks_are_spaced_to_leave_two_rows_for_conduits() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
            ],
            wide(),
        );
        let (top, bottom) = (laid.node("a").unwrap(), laid.node("b").unwrap());
        assert_eq!(bottom.y - (top.y + top.height), laid.metrics.rank_gap);
    }

    #[test]
    fn nodes_in_one_rank_never_overlap() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1),
                PlanNode::open("c", "Charlie", 1),
                PlanNode::open("d", "Delta", 1).requiring(&["a", "b", "c"]),
            ],
            wide(),
        );
        let mut row: Vec<&PlacedNode> = laid.nodes.iter().filter(|node| node.rank == 0).collect();
        row.sort_by_key(|node| node.x);
        for pair in row.windows(2) {
            assert!(
                pair[0].x + pair[0].width + laid.metrics.column_gap <= pair[1].x,
                "{} overlaps {}",
                pair[0].id,
                pair[1].id
            );
        }
    }

    #[test]
    fn a_dependent_is_centred_under_the_prerequisites_it_joins() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1),
                PlanNode::open("c", "Charlie", 1).requiring(&["a", "b"]),
            ],
            wide(),
        );
        let middle = (laid.node("a").unwrap().center_x() + laid.node("b").unwrap().center_x()) / 2;
        let child = laid.node("c").unwrap().center_x();
        assert!(
            child.abs_diff(middle) <= 1,
            "child at {child}, parents centred on {middle}"
        );
    }

    #[test]
    fn an_edge_that_spans_two_ranks_is_routed_around_the_rank_between() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
                PlanNode::open("c", "Charlie", 1).requiring(&["a", "b"]),
            ],
            wide(),
        );
        let long = laid
            .edges
            .iter()
            .find(|edge| edge.from == "a" && edge.to == "c")
            .expect("the long edge");
        let bravo = laid.node("b").unwrap();
        for &(x, y) in &long.points {
            assert!(
                !bravo.contains(x, y),
                "conduit runs through Bravo at ({x}, {y})"
            );
        }
    }

    #[test]
    fn every_conduit_waypoint_shares_a_row_or_a_column_with_the_next() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
                PlanNode::open("c", "Charlie", 1).requiring(&["a"]),
                PlanNode::open("d", "Delta", 1).requiring(&["b", "c"]),
                PlanNode::open("e", "Echo", 1).requiring(&["a", "d"]),
            ],
            wide(),
        );
        for edge in &laid.edges {
            for pair in edge.points.windows(2) {
                assert!(
                    pair[0].0 == pair[1].0 || pair[0].1 == pair[1].1,
                    "{} -> {} bends diagonally between {:?} and {:?}",
                    edge.from,
                    edge.to,
                    pair[0],
                    pair[1]
                );
            }
        }
    }

    #[test]
    fn a_conduit_starts_below_its_prerequisite_and_ends_above_its_dependent() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
            ],
            wide(),
        );
        let edge = &laid.edges[0];
        let (top, bottom) = (laid.node("a").unwrap(), laid.node("b").unwrap());
        assert_eq!(
            edge.points.first().copied(),
            Some((top.center_x(), top.y + top.height))
        );
        assert_eq!(
            edge.points.last().copied(),
            Some((bottom.center_x(), bottom.y - 1))
        );
    }

    #[test]
    fn unconnected_pieces_wrap_onto_a_new_row_instead_of_running_off_to_the_right() {
        let nodes: Vec<PlanNode> = (0..6)
            .map(|index| PlanNode::open(format!("n{index}"), format!("Node {index}"), 1))
            .collect();
        let laid = lay(
            nodes,
            LayoutOptions {
                density: Density::Compact,
                target_row_width: 60,
            },
        );
        assert!(laid.width <= 62, "board is {} cells wide", laid.width);
        assert!(laid.nodes.iter().any(|node| node.y > 0), "nothing wrapped");
    }

    #[test]
    fn the_board_is_big_enough_for_everything_on_it() {
        let laid = lay(
            vec![
                PlanNode::open("a", "Alpha", 1),
                PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
                PlanNode::open("c", "Charlie", 1),
            ],
            wide(),
        );
        for node in &laid.nodes {
            assert!(node.x + node.width <= laid.width);
            assert!(node.y + node.height <= laid.height);
        }
        for edge in &laid.edges {
            for &(x, y) in &edge.points {
                assert!(
                    x < laid.width && y < laid.height,
                    "waypoint ({x}, {y}) is off the board"
                );
            }
        }
    }

    #[test]
    fn an_expanded_board_is_taller_than_a_compact_one() {
        let nodes = vec![
            PlanNode::open("a", "Alpha", 1),
            PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
        ];
        let compact = lay(nodes.clone(), wide());
        let expanded = lay(
            nodes,
            LayoutOptions {
                density: Density::Expanded,
                target_row_width: 400,
            },
        );
        assert!(expanded.height > compact.height);
        assert_eq!(expanded.node("a").unwrap().height, 3);
    }

    #[test]
    fn an_empty_plan_lays_out_to_an_empty_board() {
        let laid = lay(Vec::new(), wide());
        assert!(laid.nodes.is_empty());
        assert_eq!(laid.width, 2);
        assert_eq!(laid.height, 2);
    }

    #[test]
    fn the_layout_is_the_same_every_time_it_is_computed() {
        let nodes = vec![
            PlanNode::open("a", "Alpha", 1),
            PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
            PlanNode::open("c", "Charlie", 1).requiring(&["a"]),
            PlanNode::open("d", "Delta", 1).requiring(&["b", "c"]),
        ];
        assert_eq!(lay(nodes.clone(), wide()), lay(nodes, wide()));
    }

    #[test]
    fn node_hit_testing_finds_the_node_under_a_cell() {
        let laid = lay(vec![PlanNode::open("a", "Alpha", 1)], wide());
        let node = laid.node("a").unwrap().clone();
        assert_eq!(
            laid.node_at(node.x, node.y).map(|found| found.id.as_str()),
            Some("a")
        );
        assert_eq!(laid.node_at(node.x + node.width, node.y), None);
    }
}
