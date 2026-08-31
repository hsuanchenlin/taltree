//! Prints the demo plan's board as text, for eyeballing layout changes:
//! `cargo run --example board_preview -- [width]`
use taltree::domain::clock::FrozenClock;
use taltree::domain::plan::{complete_node, defer_node, inspect};
use taltree::domain::seed::demo_plan;
use taltree::graph::board::{build_board, BoardHighlights};
use taltree::graph::layout::{layout_graph, Density, LayoutOptions};
use taltree::graph::model::build_graph;

fn main() {
    let width: u16 = std::env::args()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(96);
    let density = match std::env::args().nth(2).as_deref() {
        Some("expanded") => Density::Expanded,
        _ => Density::Compact,
    };
    let clock = FrozenClock::new("2026-08-31");
    let plan = demo_plan(&clock);
    let plan = complete_node(&plan, "find-receipts", &clock).expect("complete");
    let plan = complete_node(&plan, "draft-proposal", &clock).expect("complete");
    let plan = defer_node(&plan, "rewrite-the-talk", &clock).expect("defer");

    let model = build_graph(&inspect(&plan, &clock));
    let laid = layout_graph(
        &model,
        LayoutOptions {
            density,
            target_row_width: width,
        },
    );
    let board = build_board(
        &laid,
        &model,
        density,
        &BoardHighlights {
            selected: Some("tax-packet"),
            search_hits: &[],
        },
    );
    println!("board {}x{}", board.width(), board.height());
    for line in board.to_lines() {
        println!("{line}");
    }
}
