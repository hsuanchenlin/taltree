//! What the terminal actually shows.
//!
//! These render the real widget tree into a test backend, so the chrome - the
//! budget bar, the inspector, the footer, the help sheet - is checked as text
//! rather than by eye.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::Terminal;

use taltree::domain::clock::FrozenClock;
use taltree::domain::plan::empty_plan;
use taltree::domain::types::{Plan, PlanNode};
use taltree::persist::store::MemoryStore;
use taltree::ui::app::App;
use taltree::ui::{keys, render};

const TODAY: &str = "2026-08-31";

fn plan() -> Plan {
    let mut plan = empty_plan(&FrozenClock::new(TODAY), "A full Thursday");
    plan.nodes = vec![
        PlanNode::open("receipts", "Find receipts", 2),
        PlanNode::open("tax", "File the tax packet", 5).requiring(&["receipts"]),
        PlanNode::open("walk", "Take a walk", 1),
    ];
    plan
}

struct Screen {
    terminal: Terminal<TestBackend>,
    app: App,
}

impl Screen {
    fn new(width: u16, height: u16) -> Self {
        Self::with_plan(plan(), width, height)
    }

    fn with_plan(plan: Plan, width: u16, height: u16) -> Self {
        Screen {
            terminal: Terminal::new(TestBackend::new(width, height)).expect("terminal"),
            app: App::new(
                plan,
                Box::new(FrozenClock::new(TODAY)),
                Box::new(MemoryStore::default()),
            ),
        }
    }

    fn press(&mut self, ch: char) -> &mut Self {
        self.key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE))
    }

    fn key(&mut self, key: KeyEvent) -> &mut Self {
        let action = keys::map(&self.app.mode, key);
        self.app.apply(action);
        self
    }

    fn draw(&mut self) -> Vec<String> {
        let app = &mut self.app;
        self.terminal
            .draw(|frame| render::draw(frame, app))
            .expect("draw");
        let buffer = self.terminal.backend().buffer();
        (0..buffer.area.height)
            .map(|y| {
                (0..buffer.area.width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect()
    }

    fn text(&mut self) -> String {
        self.draw().join("\n")
    }
}

#[test]
fn the_top_line_is_the_budget_bar() {
    let mut screen = Screen::new(100, 24);
    let lines = screen.draw();
    assert_eq!(
        lines[0].trim_end(),
        "Budget: [████████████] 8/8 remaining (0 spent) · 0 of 3 unlocked · 2026-08-31  A full Thursday"
    );
}

#[test]
fn the_budget_bar_follows_what_was_spent() {
    let mut screen = Screen::new(100, 24);
    screen.app.selected = Some("receipts".to_string());
    screen.press('c');
    assert!(
        screen.draw()[0].contains("6/8 remaining (2 spent) · 1 of 3 unlocked"),
        "{}",
        screen.draw()[0]
    );
}

#[test]
fn the_board_draws_sockets_and_conduits() {
    let mut screen = Screen::new(100, 24);
    let text = screen.text();
    assert!(text.contains("( ) Find receipts"), "{text}");
    assert!(text.contains("[ ] File the tax pa"), "{text}");
    assert!(text.contains('│'), "no conduit drawn:\n{text}");
}

#[test]
fn a_completed_prerequisite_lights_its_conduit() {
    let mut screen = Screen::new(100, 24);
    screen.app.selected = Some("receipts".to_string());
    screen.press('c');
    let text = screen.text();
    assert!(text.contains("[*] Find receipts"), "{text}");
    assert!(text.contains('║'), "conduit did not light up:\n{text}");
}

#[test]
fn the_inspector_names_the_status_the_cost_and_the_links() {
    let mut screen = Screen::new(100, 24);
    screen.app.selected = Some("tax".to_string());
    let text = screen.text();
    assert!(text.contains("File the tax packet"), "{text}");
    assert!(text.contains("[ ] Blocked"), "{text}");
    assert!(text.contains("5 points"), "{text}");
    assert!(text.contains("Needs"), "{text}");
    assert!(text.contains("Unlocks"), "{text}");
}

#[test]
fn a_long_entry_in_the_inspector_wraps_with_a_hanging_indent() {
    let mut screen = Screen::new(100, 24);
    screen.app.selected = Some("receipts".to_string());
    let lines = screen.draw();
    let unlocks = lines
        .iter()
        .position(|line| line.contains("Unlocks"))
        .expect("an unlocks section");
    assert!(
        lines[unlocks + 1].contains("  [ ] File the tax packet"),
        "{:?}",
        lines[unlocks + 1]
    );
}

#[test]
fn the_inspector_shows_typed_resource_links_from_notes() {
    let mut plan = plan();
    plan.nodes[2].notes = Some(
        "Shoebox in the hall.\n- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)"
            .to_string(),
    );
    let mut screen = Screen::with_plan(plan, 100, 24);
    screen.app.selected = Some("walk".to_string());
    let text = screen.text();
    assert!(text.contains("Resources"), "{text}");
    assert!(text.contains("[article]"), "{text}");
    assert!(text.contains("The Internet"), "{text}");
    assert!(text.contains("Notes"), "{text}");
    assert!(text.contains("Shoebox"), "{text}");
}

#[test]
fn the_inspector_is_dropped_on_a_narrow_terminal_rather_than_squeezing_the_board() {
    let mut wide = Screen::new(100, 24);
    assert!(wide.text().contains("Inspector"));

    let mut narrow = Screen::new(60, 24);
    let text = narrow.text();
    assert!(!text.contains("Inspector"), "{text}");
    assert!(text.contains("( ) Find receipts"), "{text}");
}

#[test]
fn the_bottom_line_starts_out_naming_the_keys() {
    let mut screen = Screen::new(100, 24);
    let lines = screen.draw();
    let footer = lines.last().expect("a footer").clone();
    assert!(footer.starts_with("hjkl move · c complete"), "{footer}");
}

#[test]
fn the_command_line_shows_what_is_being_typed() {
    let mut screen = Screen::new(100, 24);
    screen.press(':').press('b').press('u').press('d');
    let lines = screen.draw();
    assert_eq!(lines.last().expect("a footer").trim_end(), ":bud");
}

#[test]
fn a_prompt_says_what_it_wants() {
    let mut screen = Screen::new(100, 24);
    screen.app.selected = Some("walk".to_string());
    screen.press('a');
    let lines = screen.draw();
    assert_eq!(
        lines.last().expect("a footer").trim_end(),
        "New node title:"
    );
}

#[test]
fn a_refusal_is_shown_along_the_bottom() {
    let mut screen = Screen::new(100, 24);
    screen.app.selected = Some("tax".to_string());
    screen.press('c');
    let lines = screen.draw();
    assert!(
        lines
            .last()
            .expect("a footer")
            .contains("Waiting on \"Find receipts\""),
        "{:?}",
        lines.last()
    );
}

#[test]
fn a_delete_asks_before_it_acts() {
    let mut screen = Screen::new(100, 24);
    screen.app.selected = Some("walk".to_string());
    screen.press('D');
    let lines = screen.draw();
    assert!(
        lines
            .last()
            .expect("a footer")
            .contains("Delete \"Take a walk\" and every link to it? (y/n)"),
        "{:?}",
        lines.last()
    );
}

#[test]
fn the_help_sheet_covers_the_screen_and_lists_the_keys() {
    let mut screen = Screen::new(100, 30);
    screen.press('?');
    let text = screen.text();
    assert!(text.contains("Keys · j k scroll · Esc closes"), "{text}");
    assert!(text.contains("h j k l"), "{text}");
    assert!(
        text.contains("move along the conduits, then to the nearest node"),
        "a description was cut off:\n{text}"
    );
    assert!(text.contains("complete the selected node"), "{text}");
}

#[test]
fn the_end_of_the_help_sheet_is_reachable_on_a_short_terminal() {
    let mut screen = Screen::new(100, 20);
    screen.press('?');
    assert!(
        !screen.text().contains("an illuminated conduit"),
        "the last section should start out below the fold"
    );

    for _ in 0..60 {
        screen.press('j');
        screen.draw();
    }
    let text = screen.text();
    assert!(
        text.contains("an illuminated conduit"),
        "scrolling never reached the last section:\n{text}"
    );
}

#[test]
fn a_wide_terminal_lays_the_help_sheet_out_in_columns() {
    let mut screen = Screen::new(160, 24);
    screen.press('?');
    let lines = screen.draw();
    let titles = ["Move", "Look", "Change", "Commands", "Sockets"];
    let two_up = lines
        .iter()
        .any(|line| titles.iter().filter(|title| line.contains(*title)).count() >= 2);
    assert!(
        two_up,
        "expected side-by-side sections:\n{}",
        lines.join("\n")
    );
}

#[test]
fn the_list_view_explains_every_node_in_one_column() {
    let mut screen = Screen::new(100, 24);
    screen.press('v');
    let text = screen.text();
    assert!(text.contains("( ) Find receipts"), "{text}");
    assert!(
        text.contains("waiting on Find recei"),
        "the list says why:\n{text}"
    );
    for line in screen.draw() {
        assert!(
            !line.contains("…│") || line.contains("│("),
            "a row ran into the border: {line}"
        );
    }
}

#[test]
fn the_list_view_rules_off_each_group_it_finds() {
    let mut plan = plan();
    plan.nodes[0] = plan.nodes[0].clone().grouped("Paperwork");
    plan.nodes[1] = plan.nodes[1].clone().grouped("Paperwork");
    let mut screen = Screen::with_plan(plan, 100, 24);
    screen.press('v');
    let lines = screen.draw();

    let header = lines
        .iter()
        .position(|line| line.contains("Paperwork"))
        .expect("a group header");
    assert!(
        lines[header].contains('─'),
        "the header should read as a boundary: {}",
        lines[header]
    );
    assert!(
        lines[header + 1].contains("Find receipts"),
        "the group's nodes follow it: {}",
        lines[header + 1]
    );
    let ungrouped = lines
        .iter()
        .position(|line| line.contains("Ungrouped"))
        .expect("leaving a group is headed too");
    assert!(
        lines[ungrouped + 1].contains("Take a walk"),
        "{}",
        lines[ungrouped + 1]
    );
    // The rule has to stop inside the panel, or it paints over the border.
    for line in [&lines[header], &lines[ungrouped]] {
        assert!(
            line.trim_end().ends_with('│'),
            "a header ran through the panel border: {line}"
        );
    }
}

#[test]
fn a_plan_with_no_groups_draws_no_headers() {
    let mut screen = Screen::new(100, 24);
    screen.press('v');
    let text = screen.text();
    assert!(!text.contains("Ungrouped"), "{text}");
}

#[test]
fn the_inspector_names_the_group_the_selection_belongs_to() {
    let mut plan = plan();
    plan.nodes[0] = plan.nodes[0].clone().grouped("Paperwork");
    let mut screen = Screen::with_plan(plan, 100, 24);
    screen.app.selected = Some("receipts".to_string());
    assert!(screen.text().contains("Paperwork"), "{}", screen.text());
}

#[test]
fn an_empty_plan_invites_a_first_node_instead_of_showing_a_blank_board() {
    let mut screen = Screen::new(100, 24);
    screen.app = App::new(
        empty_plan(&FrozenClock::new(TODAY), "Blank"),
        Box::new(FrozenClock::new(TODAY)),
        Box::new(MemoryStore::default()),
    );
    let text = screen.text();
    assert!(text.contains("Nothing planned yet."), "{text}");
    assert!(text.contains("Press a to add the first node"), "{text}");
}

#[test]
fn a_very_small_terminal_still_draws_without_panicking() {
    for (width, height) in [(20, 5), (10, 3), (40, 8), (1, 1)] {
        let mut screen = Screen::new(width, height);
        let lines = screen.draw();
        assert_eq!(lines.len(), height as usize);
    }
}

#[test]
fn the_selection_stays_on_screen_as_it_moves_down_a_tall_board() {
    let mut screen = Screen::new(60, 10);
    let mut plan = empty_plan(&FrozenClock::new(TODAY), "Deep");
    let mut previous: Option<String> = None;
    for index in 0..12 {
        let id = format!("n{index}");
        let mut node = PlanNode::open(&id, format!("Step {index}"), 1);
        if let Some(parent) = &previous {
            node = node.requiring(&[parent.as_str()]);
        }
        plan.nodes.push(node);
        previous = Some(id);
    }
    screen.app = App::new(
        plan,
        Box::new(FrozenClock::new(TODAY)),
        Box::new(MemoryStore::default()),
    );
    screen.draw();

    for _ in 0..11 {
        screen.press('j');
        screen.draw();
    }
    assert_eq!(screen.app.selected.as_deref(), Some("n11"));
    assert!(
        screen.text().contains("Step 11"),
        "the selection scrolled out of view:\n{}",
        screen.text()
    );
}
