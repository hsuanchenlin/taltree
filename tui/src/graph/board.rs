//! The board: every cell of the talent tree as a character plus the ink it is
//! drawn in.
//!
//! Building the whole board as data - rather than painting straight into a
//! terminal buffer - is what lets the layout, the conduits, and the node chips
//! be tested by reading the picture back as text.

use unicode_width::UnicodeWidthChar;

use crate::domain::types::NodeKind;

use super::conduit::Conduits;
use super::layout::{Density, LaidOutGraph};
use super::model::GraphModel;

/// What a cell is, so the renderer can decide how to colour it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ink {
    Blank,
    Conduit,
    /// A conduit whose prerequisite is completed.
    LiveConduit,
    Node(NodeKind),
    /// The cost of eligible work that no longer fits today's budget.
    OverBudget,
    /// The node the person is standing on.
    Selected,
    /// A node matching the live search.
    SearchHit,
}

/// The second cell of a double-width character. It carries no character of its
/// own: the wide character beside it already covers the column.
pub const CONTINUATION: char = '\u{0}';

/// A grid of characters with their ink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Board {
    width: u16,
    height: u16,
    cells: Vec<(char, Ink)>,
}

impl Board {
    pub fn new(width: u16, height: u16) -> Self {
        Board {
            width,
            height,
            cells: vec![(' ', Ink::Blank); width as usize * height as usize],
        }
    }

    pub fn width(&self) -> u16 {
        self.width
    }

    pub fn height(&self) -> u16 {
        self.height
    }

    pub fn put(&mut self, x: u16, y: u16, ch: char, ink: Ink) {
        if let Some(index) = self.index(x, y) {
            self.cells[index] = (ch, ink);
        }
    }

    /// Write a string starting at `x`, advancing by each character's display
    /// width so a double-width character claims the two cells it will occupy.
    pub fn write(&mut self, x: u16, y: u16, text: &str, ink: Ink) {
        let mut column = x;
        for ch in text.chars() {
            let width = ch.width().unwrap_or(0) as u16;
            if width == 0 {
                continue;
            }
            self.put(column, y, ch, ink);
            for offset in 1..width {
                self.put(column.saturating_add(offset), y, CONTINUATION, ink);
            }
            column = column.saturating_add(width);
        }
    }

    pub fn cell(&self, x: u16, y: u16) -> (char, Ink) {
        self.index(x, y)
            .map(|index| self.cells[index])
            .unwrap_or((' ', Ink::Blank))
    }

    pub fn char_at(&self, x: u16, y: u16) -> char {
        self.cell(x, y).0
    }

    /// One row as characters and ink, for the renderer to turn into spans.
    pub fn row(&self, y: u16) -> &[(char, Ink)] {
        match self.index(0, y) {
            Some(start) => &self.cells[start..start + self.width as usize],
            None => &[],
        }
    }

    /// The whole board as text, for tests and for eyeballing a layout.
    ///
    /// Continuation cells are dropped, so a line's length in display columns
    /// matches the board's width.
    pub fn to_lines(&self) -> Vec<String> {
        (0..self.height)
            .map(|y| {
                self.row(y)
                    .iter()
                    .map(|(ch, _)| *ch)
                    .filter(|ch| *ch != CONTINUATION)
                    .collect()
            })
            .collect()
    }

    fn index(&self, x: u16, y: u16) -> Option<usize> {
        if x >= self.width || y >= self.height {
            return None;
        }
        Some(y as usize * self.width as usize + x as usize)
    }
}

/// What to highlight while drawing.
#[derive(Debug, Clone, Default)]
pub struct BoardHighlights<'a> {
    pub selected: Option<&'a str>,
    pub search_hits: &'a [String],
}

/// Draw the laid-out plan: conduits first, then node chips over them.
pub fn build_board(
    laid: &LaidOutGraph,
    model: &GraphModel,
    density: Density,
    highlights: &BoardHighlights<'_>,
) -> Board {
    let mut board = Board::new(laid.width.max(1), laid.height.max(1));

    let mut conduits = Conduits::new(board.width(), board.height());
    for edge in &laid.edges {
        conduits.draw(&edge.points, edge.illuminated);
    }
    for y in 0..board.height() {
        for x in 0..board.width() {
            if let Some(glyph) = conduits.glyph_at(x, y) {
                let ink = if conduits.is_illuminated(x, y) {
                    Ink::LiveConduit
                } else {
                    Ink::Conduit
                };
                board.put(x, y, glyph, ink);
            }
        }
    }

    for placed in &laid.nodes {
        let Some(node) = model.node(&placed.id) else {
            continue;
        };
        let selected = highlights.selected == Some(placed.id.as_str());
        let hit = !selected
            && highlights
                .search_hits
                .iter()
                .any(|id| id.as_str() == placed.id.as_str());
        let ink = if selected {
            Ink::Selected
        } else if hit {
            Ink::SearchHit
        } else {
            Ink::Node(node.kind)
        };
        let cost_ink = if node.exceeds_budget && !selected && !hit {
            Ink::OverBudget
        } else {
            ink
        };

        match density {
            Density::Compact => {
                // A one-row chip has no frame to thicken, so the selection also
                // gets a marker in the gutter beside it: reverse video alone is
                // invisible on a terminal that does not paint it.
                if selected && placed.x > 0 && board.cell(placed.x - 1, placed.y).1 == Ink::Blank {
                    board.put(placed.x - 1, placed.y, '▌', Ink::Selected);
                }
                draw_chip(
                    &mut board,
                    placed.x,
                    placed.y,
                    placed.width,
                    node,
                    ink,
                    cost_ink,
                )
            }
            Density::Expanded => {
                draw_frame(&mut board, placed, ink, selected);
                draw_chip(
                    &mut board,
                    placed.x + 1,
                    placed.y + 1,
                    placed.width - 2,
                    node,
                    ink,
                    cost_ink,
                );
            }
        }
    }

    board
}

/// `( ) Triage inbox        1` - socket, title, cost, in exactly `width` cells.
fn draw_chip(
    board: &mut Board,
    x: u16,
    y: u16,
    width: u16,
    node: &super::model::GraphNode,
    ink: Ink,
    cost_ink: Ink,
) {
    let socket = node.kind.socket();
    let cost = format!("{:>2}", node.cost.min(99));
    let title_width = width.saturating_sub(socket.chars().count() as u16 + 2 + cost.len() as u16);
    board.write(x, y, socket, ink);
    board.write(x + socket.chars().count() as u16, y, " ", ink);
    let title_x = x + socket.chars().count() as u16 + 1;
    board.write(title_x, y, &fit(&node.title, title_width), ink);
    board.write(title_x + title_width, y, " ", ink);
    board.write(title_x + title_width + 1, y, &cost, cost_ink);
}

fn draw_frame(board: &mut Board, placed: &super::layout::PlacedNode, ink: Ink, selected: bool) {
    let (top_left, top_right, bottom_left, bottom_right, horizontal, vertical) = if selected {
        ('╔', '╗', '╚', '╝', '═', '║')
    } else {
        ('┌', '┐', '└', '┘', '─', '│')
    };
    let right = placed.x + placed.width - 1;
    let bottom = placed.y + placed.height - 1;
    board.put(placed.x, placed.y, top_left, ink);
    board.put(right, placed.y, top_right, ink);
    board.put(placed.x, bottom, bottom_left, ink);
    board.put(right, bottom, bottom_right, ink);
    for x in (placed.x + 1)..right {
        board.put(x, placed.y, horizontal, ink);
        board.put(x, bottom, horizontal, ink);
    }
    for y in (placed.y + 1)..bottom {
        board.put(placed.x, y, vertical, ink);
        board.put(right, y, vertical, ink);
        // Clear the inside so a conduit cannot show through the box.
        for x in (placed.x + 1)..right {
            board.put(x, y, ' ', ink);
        }
    }
}

/// `text` in exactly `width` display columns: truncated with an ellipsis when
/// it is too long, padded with spaces when it is too short.
pub fn fit(text: &str, width: u16) -> String {
    let width = width as usize;
    if width == 0 {
        return String::new();
    }
    let mut out = String::new();
    let mut used = 0usize;
    let mut truncated = false;
    for ch in text.chars() {
        let ch_width = ch.width().unwrap_or(0);
        if used + ch_width > width {
            truncated = true;
            break;
        }
        out.push(ch);
        used += ch_width;
    }
    if truncated {
        // Give the ellipsis room by dropping trailing characters.
        while used + 1 > width {
            match out.pop() {
                Some(ch) => used -= ch.width().unwrap_or(0),
                None => break,
            }
        }
        out.push('…');
        used += 1;
    }
    for _ in used..width {
        out.push(' ');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clock::FrozenClock;
    use crate::domain::plan::{complete_node, empty_plan, inspect};
    use crate::domain::types::{Plan, PlanNode};
    use crate::graph::layout::{layout_graph, LayoutOptions};
    use crate::graph::model::build_graph;

    fn board_of(plan: &Plan, density: Density, selected: Option<&str>) -> Board {
        let clock = FrozenClock::new("2026-08-31");
        let model = build_graph(&inspect(plan, &clock));
        let laid = layout_graph(
            &model,
            LayoutOptions {
                density,
                target_row_width: 200,
            },
        );
        build_board(
            &laid,
            &model,
            density,
            &BoardHighlights {
                selected,
                search_hits: &[],
            },
        )
    }

    fn chain() -> Plan {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan = empty_plan(&clock, "Chain");
        plan.nodes = vec![
            PlanNode::open("a", "Alpha", 2),
            PlanNode::open("b", "Bravo", 3).requiring(&["a"]),
        ];
        plan
    }

    #[test]
    fn a_compact_chip_is_socket_title_then_cost() {
        let board = board_of(&chain(), Density::Compact, None);
        assert_eq!(&board.to_lines()[1], " ( ) Alpha              2 ");
    }

    #[test]
    fn every_kind_wears_its_own_socket() {
        let clock = FrozenClock::new("2026-08-31");
        let plan = complete_node(&chain(), "a", &clock).expect("complete");
        let lines = board_of(&plan, Density::Compact, None).to_lines();
        assert!(lines[1].contains("[*] Alpha"), "{lines:?}");
        assert!(lines[4].contains("( ) Bravo"), "{lines:?}");

        let blocked = board_of(&chain(), Density::Compact, None).to_lines();
        assert!(blocked[4].contains("[ ] Bravo"), "{blocked:?}");
    }

    #[test]
    fn a_conduit_runs_from_the_prerequisite_down_to_its_dependent() {
        let lines = board_of(&chain(), Density::Compact, None).to_lines();
        assert_eq!(
            lines,
            vec![
                "                          ",
                " ( ) Alpha              2 ",
                "             │            ",
                "             │            ",
                " [ ] Bravo              3 ",
                "                          ",
            ]
        );
    }

    #[test]
    fn a_completed_prerequisite_lights_its_conduit() {
        let clock = FrozenClock::new("2026-08-31");
        let plan = complete_node(&chain(), "a", &clock).expect("complete");
        let lines = board_of(&plan, Density::Compact, None).to_lines();
        assert!(lines[2].contains('║'), "{lines:?}");
    }

    #[test]
    fn two_dependents_of_one_node_fork_out_of_a_single_conduit() {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan = empty_plan(&clock, "Fork");
        plan.nodes = vec![
            PlanNode::open("a", "Alpha", 1),
            PlanNode::open("b", "Bravo", 1).requiring(&["a"]),
            PlanNode::open("c", "Charlie", 1).requiring(&["a"]),
        ];
        let lines = board_of(&plan, Density::Compact, None).to_lines();
        assert!(
            lines[3].contains('┴'),
            "expected a fork:\n{}",
            lines.join("\n")
        );
    }

    #[test]
    fn two_prerequisites_of_one_node_merge_into_a_single_conduit() {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan = empty_plan(&clock, "Merge");
        plan.nodes = vec![
            PlanNode::open("a", "Alpha", 1),
            PlanNode::open("b", "Bravo", 1),
            PlanNode::open("c", "Charlie", 1).requiring(&["a", "b"]),
        ];
        let lines = board_of(&plan, Density::Compact, None).to_lines();
        assert!(
            lines[3].contains('┬'),
            "expected a merge:\n{}",
            lines.join("\n")
        );
    }

    #[test]
    fn an_expanded_node_is_a_three_row_box() {
        let lines = board_of(&chain(), Density::Expanded, None).to_lines();
        assert_eq!(&lines[1], " ┌────────────────────────┐ ");
        assert_eq!(&lines[2], " │( ) Alpha              2│ ");
        assert_eq!(&lines[3], " └────────────────────────┘ ");
    }

    #[test]
    fn the_selected_node_wears_a_double_frame_when_expanded() {
        let lines = board_of(&chain(), Density::Expanded, Some("a")).to_lines();
        assert_eq!(&lines[1], " ╔════════════════════════╗ ");
    }

    #[test]
    fn the_selected_node_is_inked_differently_when_compact() {
        let board = board_of(&chain(), Density::Compact, Some("a"));
        assert_eq!(board.cell(1, 1).1, Ink::Selected);
        assert_eq!(board.cell(1, 4).1, Ink::Node(NodeKind::Blocked));
    }

    #[test]
    fn a_compact_selection_is_marked_in_the_gutter_as_well_as_inked() {
        let board = board_of(&chain(), Density::Compact, Some("a"));
        assert_eq!(board.cell(0, 1), ('▌', Ink::Selected));
        assert_eq!(board.char_at(0, 4), ' ', "only the selected node is marked");
    }

    #[test]
    fn the_gutter_marker_never_paints_over_a_conduit() {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan = empty_plan(&clock, "Tight");
        plan.nodes = vec![
            PlanNode::open("a", "Alpha", 1),
            PlanNode::open("b", "Bravo", 1),
            PlanNode::open("c", "Charlie", 1).requiring(&["a", "b"]),
        ];
        let clean = board_of(&plan, Density::Compact, None);
        let marked = board_of(&plan, Density::Compact, Some("c"));
        let charlie_x = {
            let model = build_graph(&inspect(&plan, &clock));
            let laid = layout_graph(
                &model,
                LayoutOptions {
                    density: Density::Compact,
                    target_row_width: 200,
                },
            );
            laid.node("c").expect("charlie").x
        };
        let y = 4;
        if clean.cell(charlie_x - 1, y).1 != Ink::Blank {
            assert_eq!(
                marked.cell(charlie_x - 1, y),
                clean.cell(charlie_x - 1, y),
                "the marker overwrote something"
            );
        }
    }

    #[test]
    fn eligible_work_that_no_longer_fits_the_day_inks_its_cost() {
        let mut plan = chain();
        plan.spent_today = 7;
        let board = board_of(&plan, Density::Compact, None);
        assert_eq!(board.cell(24, 1).1, Ink::OverBudget);
        assert_eq!(board.cell(3, 1).1, Ink::Node(NodeKind::Eligible));
    }

    #[test]
    fn a_search_hit_is_inked_apart_from_its_neighbours() {
        let clock = FrozenClock::new("2026-08-31");
        let model = build_graph(&inspect(&chain(), &clock));
        let laid = layout_graph(&model, LayoutOptions::default());
        let hits = vec!["b".to_string()];
        let board = build_board(
            &laid,
            &model,
            Density::Compact,
            &BoardHighlights {
                selected: None,
                search_hits: &hits,
            },
        );
        assert_eq!(board.cell(1, 4).1, Ink::SearchHit);
    }

    #[test]
    fn an_empty_plan_draws_an_empty_board() {
        let clock = FrozenClock::new("2026-08-31");
        let board = board_of(&empty_plan(&clock, "Nothing"), Density::Compact, None);
        assert_eq!(board.to_lines(), vec!["  ", "  "]);
    }

    #[test]
    fn a_long_title_is_cut_with_an_ellipsis_rather_than_overflowing() {
        assert_eq!(fit("Rewrite the whole guest talk", 10), "Rewrite t…");
        assert_eq!(fit("Short", 10), "Short     ");
        assert_eq!(fit("Short", 0), "");
    }

    #[test]
    fn a_wide_character_never_overruns_the_cell_it_was_given() {
        assert_eq!(fit("日本語のタスク", 6), "日本… ");
        assert_eq!(fit("日本語", 5), "日本…");
    }

    #[test]
    fn a_double_width_character_claims_both_of_its_columns() {
        let mut board = Board::new(6, 1);
        board.write(0, 0, "日本語", Ink::Blank);
        assert_eq!(board.char_at(0, 0), '日');
        assert_eq!(board.char_at(1, 0), CONTINUATION);
        assert_eq!(board.char_at(2, 0), '本');
        assert_eq!(board.to_lines(), vec!["日本語".to_string()]);
    }

    #[test]
    fn a_wide_title_keeps_the_chip_exactly_as_wide_as_every_other_chip() {
        let clock = FrozenClock::new("2026-08-31");
        let mut plan = empty_plan(&clock, "Wide");
        plan.nodes = vec![
            PlanNode::open("a", "日本語のタスクをやる", 2),
            PlanNode::open("b", "Ordinary", 1),
        ];
        let board = board_of(&plan, Density::Compact, None);
        for line in board.to_lines() {
            assert_eq!(
                line.chars()
                    .map(|ch| ch.width().unwrap_or(0))
                    .sum::<usize>(),
                board.width() as usize,
                "{line}"
            );
        }
    }
}
