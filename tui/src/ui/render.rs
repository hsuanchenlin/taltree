//! Painting the application.
//!
//! Everything worth asserting has already happened by the time this module
//! runs: the board is built in [`crate::graph::board`] and the strings in
//! [`super::format`], so this file is only geometry and colour.

use ratatui::layout::{Alignment, Constraint, Layout, Margin, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph};
use ratatui::Frame;

use crate::domain::types::NodeKind;
use crate::graph::board::{Board, Ink, CONTINUATION};
use crate::graph::camera::{Camera, Viewport};

use super::app::{App, Tone, ViewMode};
use super::format;
use super::help;
use super::mode::Mode;

/// Below this the inspector would squeeze the board out of usefulness.
const SIDEBAR_WIDTH: u16 = 34;
const SIDEBAR_MINIMUM_TOTAL: u16 = 74;

pub fn draw(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let rows = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(1),
    ])
    .split(area);

    draw_budget_bar(frame, rows[0], app);

    let (main, sidebar) = split_body(rows[1]);
    app.set_viewport(Viewport::new(main.width, main.height));
    match app.view_mode {
        ViewMode::Tree => draw_tree(frame, main, app),
        ViewMode::List => draw_list(frame, main, app),
    }
    if let Some(sidebar) = sidebar {
        draw_inspector(frame, sidebar, app);
    }

    draw_footer(frame, rows[2], app);

    if app.mode == Mode::Help {
        draw_help(frame, area, app);
    }
}

fn split_body(area: Rect) -> (Rect, Option<Rect>) {
    if area.width < SIDEBAR_MINIMUM_TOTAL {
        return (area, None);
    }
    let columns =
        Layout::horizontal([Constraint::Min(30), Constraint::Length(SIDEBAR_WIDTH)]).split(area);
    (columns[0], Some(columns[1]))
}

fn draw_budget_bar(frame: &mut Frame, area: Rect, app: &App) {
    let view = app.view();
    let spent = view.plan.spent_today > 0;
    let tone = if view.remaining == 0 && view.plan.daily_budget > 0 {
        Color::Yellow
    } else if spent {
        Color::Green
    } else {
        Color::Cyan
    };
    let line = Line::from(vec![
        Span::styled(
            format::budget_bar(view, &app.today()),
            Style::default().fg(tone).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  {}", view.plan.title),
            Style::default().fg(Color::DarkGray),
        ),
    ]);
    frame.render_widget(Paragraph::new(line), area);
}

fn draw_tree(frame: &mut Frame, area: Rect, app: &App) {
    if app.laid().nodes.is_empty() {
        let empty = Paragraph::new(vec![
            Line::from(""),
            Line::from(Span::styled(
                "Nothing planned yet.",
                Style::default().add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from("Press a to add the first node, or ? for the keys."),
        ])
        .alignment(Alignment::Center);
        frame.render_widget(empty, area.inner(Margin::new(1, area.height / 3)));
        return;
    }
    let board = app.board();
    let lines = board_lines(&board, app.camera, area);
    frame.render_widget(Paragraph::new(lines), area);
}

/// The visible window of the board, as styled lines.
fn board_lines(board: &Board, camera: Camera, area: Rect) -> Vec<Line<'static>> {
    (0..area.height)
        .map(|row| {
            let y = camera.y.saturating_add(row);
            let mut spans: Vec<Span<'static>> = Vec::new();
            let mut text = String::new();
            let mut ink = Ink::Blank;
            for column in 0..area.width {
                let x = camera.x.saturating_add(column);
                let (mut ch, cell_ink) = board.cell(x, y);
                if ch == CONTINUATION {
                    // The wide character that owns this column is off screen to
                    // the left; a space keeps the row the right width.
                    if column > 0 {
                        continue;
                    }
                    ch = ' ';
                }
                if cell_ink != ink && !text.is_empty() {
                    spans.push(Span::styled(std::mem::take(&mut text), style_for(ink)));
                }
                ink = cell_ink;
                text.push(ch);
            }
            if !text.is_empty() {
                spans.push(Span::styled(text, style_for(ink)));
            }
            Line::from(spans)
        })
        .collect()
}

fn style_for(ink: Ink) -> Style {
    match ink {
        Ink::Blank => Style::default(),
        Ink::Conduit => Style::default().fg(Color::DarkGray),
        Ink::LiveConduit => Style::default()
            .fg(Color::Green)
            .add_modifier(Modifier::BOLD),
        Ink::Node(kind) => kind_style(kind),
        Ink::OverBudget => Style::default().fg(Color::Red),
        Ink::Selected => Style::default()
            .fg(Color::Black)
            .bg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
        Ink::SearchHit => Style::default().fg(Color::Black).bg(Color::Yellow),
    }
}

fn kind_style(kind: NodeKind) -> Style {
    match kind {
        NodeKind::Eligible => Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
        NodeKind::Completed => Style::default().fg(Color::Green),
        NodeKind::Blocked => Style::default().fg(Color::DarkGray),
        NodeKind::Deferred => Style::default().fg(Color::Yellow),
    }
}

fn draw_list(frame: &mut Frame, area: Rect, app: &App) {
    let view = app.view();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .title(" Nodes ");
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let selected_index = app
        .selected
        .as_deref()
        .and_then(|id| view.listings.iter().position(|item| item.node.id == id))
        .unwrap_or(0);
    let height = inner.height.max(1) as usize;
    let offset = selected_index.saturating_sub(height.saturating_sub(1) / 2);
    let offset = offset.min(view.listings.len().saturating_sub(height));

    let lines: Vec<Line<'static>> = view
        .listings
        .iter()
        .enumerate()
        .skip(offset)
        .take(height)
        .map(|(index, listing)| {
            let selected = index == selected_index;
            let reason = match listing.kind {
                NodeKind::Blocked => format!("waiting on {}", format::names(&listing.waiting_on)),
                NodeKind::Deferred => "deferred for today".to_string(),
                NodeKind::Completed => "done".to_string(),
                NodeKind::Eligible if listing.exceeds_budget => {
                    "eligible, over today's budget".to_string()
                }
                NodeKind::Eligible => "eligible".to_string(),
            };
            let text = truncate(
                &format!(
                    "{} {:<32} {:>3}  {reason}",
                    listing.kind.socket(),
                    truncate(&listing.node.title, 32),
                    listing.node.cost
                ),
                inner.width as usize,
            );
            let style = if selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                kind_style(listing.kind)
            };
            Line::from(Span::styled(text, style))
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

fn draw_inspector(frame: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .title(" Inspector ");
    let inner = block.inner(area);
    frame.render_widget(block, area);
    frame.render_widget(Paragraph::new(inspector_lines(app, inner.width)), inner);
}

fn inspector_lines(app: &App, width: u16) -> Vec<Line<'static>> {
    let width = width.max(8) as usize;
    let view = app.view();
    let Some(listing) = app.selected.as_deref().and_then(|id| view.listing(id)) else {
        return vec![Line::from(Span::styled(
            "Nothing selected.",
            Style::default().fg(Color::DarkGray),
        ))];
    };

    let mut lines: Vec<Line<'static>> = wrap(&listing.node.title, width)
        .into_iter()
        .map(|text| {
            Line::from(Span::styled(
                text,
                Style::default().add_modifier(Modifier::BOLD),
            ))
        })
        .collect();
    lines.extend([Line::from(vec![
        Span::styled(
            format!("{} {}", listing.kind.socket(), listing.kind.label()),
            kind_style(listing.kind),
        ),
        Span::raw(format!("  ·  {}", format::points(listing.node.cost))),
    ])]);

    if listing.exceeds_budget {
        for text in wrap(
            &format!("Over today's remaining {}.", format::points(view.remaining)),
            width,
        ) {
            lines.push(Line::from(Span::styled(
                text,
                Style::default().fg(Color::Red),
            )));
        }
    }
    lines.push(Line::from(""));

    let prerequisites: Vec<String> = listing
        .node
        .prerequisite_ids
        .iter()
        .filter_map(|id| view.listing(id))
        .map(|prerequisite| format!("{} {}", prerequisite.kind.socket(), prerequisite.node.title))
        .collect();
    lines.extend(section("Needs", &prerequisites, "nothing", width));

    let unlocks: Vec<String> = view
        .listings
        .iter()
        .filter(|other| {
            other
                .node
                .prerequisite_ids
                .iter()
                .any(|id| id == &listing.node.id)
        })
        .map(|other| format!("{} {}", other.kind.socket(), other.node.title))
        .collect();
    lines.extend(section("Unlocks", &unlocks, "nothing yet", width));

    if let Some(notes) = &listing.node.notes {
        lines.push(Line::from(Span::styled(
            "Notes",
            Style::default().add_modifier(Modifier::BOLD),
        )));
        for text in wrap(notes, width) {
            lines.push(Line::from(text));
        }
    }

    lines
}

fn section(title: &str, items: &[String], empty: &str, width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(Span::styled(
        title.to_string(),
        Style::default().add_modifier(Modifier::BOLD),
    ))];
    if items.is_empty() {
        lines.push(Line::from(Span::styled(
            format!("  {empty}"),
            Style::default().fg(Color::DarkGray),
        )));
    } else {
        for item in items {
            // Two spaces in, four for what wraps, so a long title reads as one
            // entry rather than starting a new one at the margin.
            for (index, text) in wrap(item, width.saturating_sub(4)).into_iter().enumerate() {
                lines.push(Line::from(format!(
                    "{}{text}",
                    if index == 0 { "  " } else { "    " }
                )));
            }
        }
    }
    lines.push(Line::from(""));
    lines
}

/// Break `text` at spaces so no line is wider than `width`. A word longer than
/// the width is cut rather than left to overflow.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return Vec::new();
    }
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if word.chars().count() > width {
            if !current.is_empty() {
                lines.push(std::mem::take(&mut current));
            }
            let mut rest: Vec<char> = word.chars().collect();
            while rest.len() > width {
                lines.push(rest.drain(..width).collect());
            }
            current = rest.into_iter().collect();
            continue;
        }
        let candidate = if current.is_empty() {
            word.chars().count()
        } else {
            current.chars().count() + 1 + word.chars().count()
        };
        if candidate > width && !current.is_empty() {
            lines.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn draw_footer(frame: &mut Frame, area: Rect, app: &App) {
    if let Some((prefix, input)) = prompt_line(app) {
        let text = format!("{prefix}{}", input.text());
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                text,
                Style::default().fg(Color::White),
            ))),
            area,
        );
        let column = area
            .x
            .saturating_add(prefix.chars().count() as u16 + input.cursor() as u16);
        frame.set_cursor_position((column.min(area.right().saturating_sub(1)), area.y));
        return;
    }

    if let Mode::Confirm(confirm) = &app.mode {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                confirm.question(),
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ))),
            area,
        );
        return;
    }

    let colour = match app.status.tone {
        Tone::Info => Color::DarkGray,
        Tone::Good => Color::Green,
        Tone::Warn => Color::Yellow,
        Tone::Error => Color::Red,
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            app.status.message.clone(),
            Style::default().fg(colour),
        ))),
        area,
    );
}

fn prompt_line(app: &App) -> Option<(String, &super::mode::TextInput)> {
    match &app.mode {
        Mode::Command(input) => Some((":".to_string(), input)),
        Mode::Search(input) => Some(("/".to_string(), input)),
        Mode::Prompt(prompt) => Some((format!("{}: ", prompt.kind.label()), &prompt.input)),
        _ => None,
    }
}

/// The keybinding sheet, in as many columns as the screen has room for and
/// scrollable when even that is not enough.
fn draw_help(frame: &mut Frame, area: Rect, app: &mut App) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .title(" Keys · j k scroll · Esc closes ");
    let inner = block.inner(area);
    frame.render_widget(Clear, area);
    frame.render_widget(block, area);

    let inner = inner.inner(Margin::new(1, 0));
    if inner.width == 0 || inner.height == 0 {
        app.set_help_extent(0);
        return;
    }

    let columns = pack_help(inner.width, inner.height);
    let tallest = columns.iter().map(Vec::len).max().unwrap_or(0);
    app.set_help_extent((tallest.saturating_sub(inner.height as usize)) as u16);
    let scroll = app.help_scroll();

    let count = columns.len().max(1) as u32;
    let areas = Layout::horizontal(vec![Constraint::Ratio(1, count); count as usize]).split(inner);
    for (lines, column) in columns.into_iter().zip(areas.iter()) {
        frame.render_widget(Paragraph::new(lines).scroll((scroll, 0)), *column);
    }
}

/// Deal the sections into columns that each fit the height, up to as many
/// columns as the width allows. Anything left over lands in the last column and
/// scrolls.
fn pack_help(width: u16, height: u16) -> Vec<Vec<Line<'static>>> {
    let column = help::column_width().clamp(1, u16::MAX as usize) as u16 + 2;
    let allowed = (width / column).max(1) as usize;
    let heights = help::section_heights();

    let mut assignment = vec![0usize; heights.len()];
    let mut column = 0usize;
    let mut used = 0usize;
    for (index, section_height) in heights.iter().enumerate() {
        if used > 0 && used + section_height > height as usize && column + 1 < allowed {
            column += 1;
            used = 0;
        }
        assignment[index] = column;
        used += section_height;
    }

    let mut columns: Vec<Vec<Line<'static>>> = vec![Vec::new(); column + 1];
    let key_width = help::key_column_width();
    for (index, section) in help::SECTIONS.iter().enumerate() {
        let lines = &mut columns[assignment[index]];
        lines.push(Line::from(Span::styled(
            section.title.to_string(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )));
        for (keys, description) in section.rows {
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{keys:<key_width$}  "),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::styled((*description).to_string(), Style::default().fg(Color::Gray)),
            ]));
        }
        lines.push(Line::from(""));
    }
    columns
}

fn truncate(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        return text.to_string();
    }
    if width == 0 {
        return String::new();
    }
    let mut out: String = text.chars().take(width - 1).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrapping_breaks_at_spaces() {
        assert_eq!(
            wrap("Walk the proposal with a teammate", 14),
            vec!["Walk the", "proposal with", "a teammate"]
        );
    }

    #[test]
    fn a_word_longer_than_the_line_is_cut_rather_than_left_to_overflow() {
        assert_eq!(
            wrap("supercalifragilistic", 6),
            vec!["superc", "alifra", "gilist", "ic"]
        );
        assert_eq!(
            wrap("ok supercalifragilistic", 6),
            vec!["ok", "superc", "alifra", "gilist", "ic"]
        );
    }

    #[test]
    fn wrapping_nothing_still_yields_a_line() {
        assert_eq!(wrap("", 10), vec![String::new()]);
        assert!(wrap("anything", 0).is_empty());
    }

    #[test]
    fn truncating_marks_where_it_cut() {
        assert_eq!(truncate("Find receipts", 20), "Find receipts");
        assert_eq!(truncate("Find receipts", 8), "Find re…");
        assert_eq!(truncate("Find receipts", 0), "");
    }

    #[test]
    fn a_narrow_screen_gets_one_help_column_and_a_wide_one_gets_more() {
        assert_eq!(pack_help(80, 40).len(), 1);
        assert!(pack_help(400, 12).len() > 1);
    }

    #[test]
    fn every_section_lands_in_some_help_column() {
        for (width, height) in [(80u16, 40u16), (160, 24), (60, 8), (400, 10)] {
            let total: usize = pack_help(width, height).iter().map(Vec::len).sum();
            let expected: usize = help::section_heights().iter().sum();
            assert_eq!(total, expected, "at {width}x{height}");
        }
    }

    #[test]
    fn the_sidebar_appears_only_when_there_is_room_for_it() {
        let narrow = Rect::new(0, 0, SIDEBAR_MINIMUM_TOTAL - 1, 10);
        assert_eq!(split_body(narrow), (narrow, None));

        let wide = Rect::new(0, 0, 100, 10);
        let (main, sidebar) = split_body(wide);
        assert_eq!(sidebar.expect("a sidebar").width, SIDEBAR_WIDTH);
        assert_eq!(main.width, 100 - SIDEBAR_WIDTH);
    }

    #[test]
    fn every_ink_has_a_style_and_the_selection_stands_out() {
        assert_eq!(style_for(Ink::Blank), Style::default());
        assert_ne!(
            style_for(Ink::Selected),
            style_for(Ink::Node(NodeKind::Eligible))
        );
        assert_ne!(style_for(Ink::LiveConduit), style_for(Ink::Conduit));
        assert_ne!(
            style_for(Ink::OverBudget),
            style_for(Ink::Node(NodeKind::Eligible))
        );
    }
}
