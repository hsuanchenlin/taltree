//! Driving the application the way a person does: keys in, plan file out.
//!
//! Every test here starts from a real plan file in a temporary directory and
//! ends by reading that file back, so a change that works on screen but never
//! reaches disk fails.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use taltree::domain::clock::{Clock, FrozenClock};
use taltree::domain::plan::empty_plan;
use taltree::domain::types::{NodeKind, Plan, PlanNode};
use taltree::persist::store::{load, FileStore, Loaded, MemoryStore};
use taltree::persist::yaml::from_yaml;
use taltree::ui::app::{App, Tone, ViewMode};
use taltree::ui::keys;
use taltree::ui::mode::Mode;

const TODAY: &str = "2026-08-31";

/// A clock a test can walk past midnight.
#[derive(Clone)]
struct StepClock(Arc<Mutex<String>>);

impl StepClock {
    fn new(day: &str) -> Self {
        StepClock(Arc::new(Mutex::new(day.to_string())))
    }

    fn set(&self, day: &str) {
        *self.0.lock().expect("clock") = day.to_string();
    }
}

impl Clock for StepClock {
    fn today(&self) -> String {
        self.0.lock().expect("clock").clone()
    }
}

struct Session {
    app: App,
    path: PathBuf,
    _dir: tempfile::TempDir,
}

impl Session {
    fn with_clock(plan: Plan, clock: Box<dyn Clock>) -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("tree.yaml");
        let app = App::new(plan, clock, Box::new(FileStore::new(&path)));
        Session {
            app,
            path,
            _dir: dir,
        }
    }

    fn new(plan: Plan) -> Self {
        Session::with_clock(plan, Box::new(FrozenClock::new(TODAY)))
    }

    /// Feed one key through the same mapping the event loop uses.
    fn key(&mut self, key: KeyEvent) -> &mut Self {
        let action = keys::map(&self.app.mode, key);
        self.app.apply(action);
        self
    }

    fn press(&mut self, ch: char) -> &mut Self {
        self.key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE))
    }

    fn type_text(&mut self, text: &str) -> &mut Self {
        for ch in text.chars() {
            self.press(ch);
        }
        self
    }

    fn code(&mut self, code: KeyCode) -> &mut Self {
        self.key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn enter(&mut self) -> &mut Self {
        self.code(KeyCode::Enter)
    }

    fn select(&mut self, id: &str) -> &mut Self {
        self.app.selected = Some(id.to_string());
        self
    }

    /// The plan as it was written to disk.
    fn saved(&self) -> Plan {
        let text = std::fs::read_to_string(&self.path).expect("the plan was saved");
        from_yaml(&text).expect("the saved plan reads back")
    }

    fn status(&self) -> &str {
        &self.app.status.message
    }

    fn kind_of(&self, id: &str) -> NodeKind {
        self.app.view().listing(id).expect("a listing").kind
    }
}

fn chain_plan() -> Plan {
    let mut plan = empty_plan(&FrozenClock::new(TODAY), "A full Thursday");
    plan.nodes = vec![
        PlanNode::open("receipts", "Find receipts", 2),
        PlanNode::open("tax", "File the tax packet", 5).requiring(&["receipts"]),
        PlanNode::open("walk", "Take a walk", 1),
    ];
    plan
}

#[test]
fn opening_a_plan_selects_the_first_node() {
    let session = Session::new(chain_plan());
    assert_eq!(session.app.selected.as_deref(), Some("receipts"));
    assert_eq!(session.app.view_mode, ViewMode::Tree);
}

#[test]
fn completing_a_node_spends_its_cost_and_writes_the_file() {
    let mut session = Session::new(chain_plan());
    session.select("receipts").press('c');

    assert_eq!(session.app.plan().spent_today, 2);
    let saved = session.saved();
    assert_eq!(saved.spent_today, 2);
    assert!(saved.node("receipts").expect("receipts").is_completed());
    assert_eq!(
        saved
            .node("receipts")
            .expect("receipts")
            .completed_on
            .as_deref(),
        Some(TODAY)
    );
}

#[test]
fn completing_a_node_says_what_it_unlocked() {
    let mut session = Session::new(chain_plan());
    session.select("receipts").press('c');
    assert_eq!(session.app.status.tone, Tone::Good);
    assert!(
        session.status().contains("Unlocked File the tax packet"),
        "{}",
        session.status()
    );
    assert_eq!(session.kind_of("tax"), NodeKind::Eligible);
}

#[test]
fn completing_a_blocked_node_is_refused_and_names_the_prerequisite() {
    let mut session = Session::new(chain_plan());
    session.select("tax").press('c');
    assert_eq!(session.app.status.tone, Tone::Error);
    assert!(
        session.status().contains("Find receipts"),
        "{}",
        session.status()
    );
    assert_eq!(session.app.plan().spent_today, 0);
}

#[test]
fn space_and_enter_complete_a_node_just_like_c() {
    for key in [' ', 'c'] {
        let mut session = Session::new(chain_plan());
        session.select("walk").press(key);
        assert_eq!(session.app.plan().spent_today, 1, "pressing {key:?}");
    }
    let mut session = Session::new(chain_plan());
    session.select("walk").enter();
    assert_eq!(session.app.plan().spent_today, 1);
}

#[test]
fn deferring_takes_a_node_off_todays_frontier_and_d_again_brings_it_back() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('d');
    assert_eq!(session.kind_of("walk"), NodeKind::Deferred);
    assert_eq!(
        session
            .saved()
            .node("walk")
            .expect("walk")
            .deferred_on
            .as_deref(),
        Some(TODAY)
    );

    session.press('d');
    assert_eq!(session.kind_of("walk"), NodeKind::Eligible);
}

#[test]
fn j_and_k_follow_the_conduits() {
    let mut session = Session::new(chain_plan());
    session.select("receipts").press('j');
    assert_eq!(session.app.selected.as_deref(), Some("tax"));
    session.press('k');
    assert_eq!(session.app.selected.as_deref(), Some("receipts"));
}

#[test]
fn a_blank_cost_takes_the_default_of_one_point() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('a');
    session.type_text("Breathe").enter();
    session.enter();
    assert_eq!(session.saved().node("breathe").expect("breathe").cost, 1);
}

#[test]
fn adding_a_node_asks_for_a_title_then_a_cost_and_links_the_selection() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('a');
    assert!(matches!(session.app.mode, Mode::Prompt(_)));

    session.type_text("Stretch afterwards").enter();
    session.type_text("2").enter();

    assert_eq!(session.app.mode, Mode::Normal);
    let saved = session.saved();
    let added = saved.node("stretch-afterwards").expect("the new node");
    assert_eq!(added.title, "Stretch afterwards");
    assert_eq!(added.cost, 2);
    assert_eq!(added.prerequisite_ids, vec!["walk"]);
    assert_eq!(session.app.selected.as_deref(), Some("stretch-afterwards"));
}

#[test]
fn a_cost_that_is_not_a_number_is_refused_and_asked_for_again() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('a');
    session.type_text("Nap").enter();
    session.type_text("lots").enter();

    assert_eq!(session.app.status.tone, Tone::Error);
    assert!(matches!(session.app.mode, Mode::Prompt(_)), "still asking");
    session.type_text("3").enter();
    assert_eq!(session.saved().node("nap").expect("nap").cost, 3);
}

#[test]
fn editing_changes_the_title_and_the_cost() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('e');
    for _ in 0.."Take a walk".len() {
        session.code(KeyCode::Backspace);
    }
    session.type_text("Take a long walk").enter();
    session.code(KeyCode::Backspace).type_text("4").enter();

    let walk = session.saved().node("walk").expect("walk").clone();
    assert_eq!(walk.title, "Take a long walk");
    assert_eq!(walk.cost, 4);
}

#[test]
fn linking_a_prerequisite_takes_a_move_and_an_enter() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('r');
    assert!(matches!(session.app.mode, Mode::LinkPick { .. }));

    session.select("receipts").enter();
    assert_eq!(
        session.saved().node("walk").expect("walk").prerequisite_ids,
        vec!["receipts"]
    );
    assert_eq!(session.app.selected.as_deref(), Some("walk"));
    assert_eq!(session.kind_of("walk"), NodeKind::Blocked);
}

#[test]
fn linking_the_same_pair_again_unlinks_it() {
    let mut session = Session::new(chain_plan());
    session.select("tax").press('r').select("receipts").enter();
    assert!(session
        .saved()
        .node("tax")
        .expect("tax")
        .prerequisite_ids
        .is_empty());
    assert_eq!(session.kind_of("tax"), NodeKind::Eligible);
}

#[test]
fn a_link_that_would_close_a_cycle_is_refused_with_the_path() {
    let mut session = Session::new(chain_plan());
    session.select("receipts").press('r').select("tax").enter();

    assert_eq!(session.app.status.tone, Tone::Error);
    assert!(session.status().contains("cycle"), "{}", session.status());
    assert!(session
        .app
        .plan()
        .node("receipts")
        .expect("receipts")
        .prerequisite_ids
        .is_empty());
    assert!(
        !session.path.exists(),
        "a refused command must not write the plan"
    );
}

#[test]
fn deleting_asks_first_and_takes_the_links_with_it() {
    let mut session = Session::new(chain_plan());
    session.select("receipts").press('D');
    assert!(matches!(session.app.mode, Mode::Confirm(_)));

    session.press('n');
    assert!(session.app.plan().node("receipts").is_some());

    session.press('D').press('y');
    let saved = session.saved();
    assert!(saved.node("receipts").is_none());
    assert!(saved.node("tax").expect("tax").prerequisite_ids.is_empty());
    assert!(
        session.app.selected.is_some(),
        "the selection moved somewhere real"
    );
}

#[test]
fn the_budget_command_sets_todays_budget() {
    let mut session = Session::new(chain_plan());
    session.press(':').type_text("budget 12").enter();
    assert_eq!(session.saved().daily_budget, 12);
    assert_eq!(session.app.view().remaining, 12);
}

#[test]
fn an_unknown_command_says_so_without_changing_anything() {
    let mut session = Session::new(chain_plan());
    session.press(':').type_text("frobnicate").enter();
    assert_eq!(session.app.status.tone, Tone::Error);
    assert!(
        session.status().contains("frobnicate"),
        "{}",
        session.status()
    );
}

#[test]
fn the_dep_command_links_a_prerequisite_by_name() {
    let mut session = Session::new(chain_plan());
    session
        .select("walk")
        .press(':')
        .type_text("dep receipts")
        .enter();
    assert_eq!(
        session.saved().node("walk").expect("walk").prerequisite_ids,
        vec!["receipts"]
    );
}

#[test]
fn the_notes_command_annotates_the_selection() {
    let mut session = Session::new(chain_plan());
    session
        .select("receipts")
        .press(':')
        .type_text("notes Shoebox in the hall")
        .enter();
    assert_eq!(
        session
            .saved()
            .node("receipts")
            .expect("receipts")
            .notes
            .as_deref(),
        Some("Shoebox in the hall")
    );
}

#[test]
fn searching_filters_live_and_n_walks_the_matches() {
    let mut session = Session::new(chain_plan());
    session.press('/').type_text("a");
    assert!(
        session.app.search.matches.len() >= 2,
        "{:?}",
        session.app.search.matches
    );

    session.enter();
    let first = session.app.selected.clone();
    session.press('n');
    assert_ne!(session.app.selected, first, "n moved on");
    session.press('N');
    assert_eq!(session.app.selected, first, "N came back");
}

#[test]
fn a_search_with_no_match_says_so_and_leaves_the_selection_alone() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('/').type_text("zzz").enter();
    assert_eq!(session.app.selected.as_deref(), Some("walk"));
    assert_eq!(session.app.status.tone, Tone::Warn);
}

#[test]
fn escape_clears_the_search_highlight() {
    let mut session = Session::new(chain_plan());
    session.press('/').type_text("walk").enter();
    assert!(!session.app.search.matches.is_empty());
    session.code(KeyCode::Esc);
    assert!(session.app.search.matches.is_empty());
}

#[test]
fn v_swaps_the_view_and_the_list_walks_with_j_and_k() {
    let mut session = Session::new(chain_plan());
    session.press('v');
    assert_eq!(session.app.view_mode, ViewMode::List);

    session.select("receipts").press('j');
    assert_eq!(session.app.selected.as_deref(), Some("tax"));
    session.press('j');
    assert_eq!(session.app.selected.as_deref(), Some("walk"));
    session.press('k');
    assert_eq!(session.app.selected.as_deref(), Some("tax"));

    session.press('v');
    assert_eq!(session.app.view_mode, ViewMode::Tree);
}

#[test]
fn the_help_sheet_opens_and_closes() {
    let mut session = Session::new(chain_plan());
    session.press('?');
    assert_eq!(session.app.mode, Mode::Help);
    session.press('j');
    assert_eq!(
        session.app.mode,
        Mode::Help,
        "keys behind the sheet stay put"
    );
    session.code(KeyCode::Esc);
    assert_eq!(session.app.mode, Mode::Normal);
}

#[test]
fn g_goes_to_the_first_node_and_shift_g_walks_the_frontier() {
    let mut session = Session::new(chain_plan());
    session.select("tax").press('g');
    assert_eq!(session.app.selected.as_deref(), Some("receipts"));

    session.press('G');
    let first = session.app.selected.clone();
    session.press('G');
    assert_ne!(session.app.selected, first, "G walks on to the next one");
}

#[test]
fn z_swaps_the_board_between_chips_and_boxes() {
    let mut session = Session::new(chain_plan());
    let compact = session.app.laid().height;
    session.press('z');
    assert!(session.app.laid().height > compact);
    session.press('z');
    assert_eq!(session.app.laid().height, compact);
}

#[test]
fn quitting_saves_first() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('c').press('q');
    assert!(session.app.should_quit);
    assert_eq!(session.saved().spent_today, 1);
}

#[test]
fn a_failed_save_keeps_the_application_open() {
    let store = MemoryStore {
        fail_with: Some("The plan could not be saved.".to_string()),
        ..MemoryStore::default()
    };
    let mut app = App::new(
        chain_plan(),
        Box::new(FrozenClock::new(TODAY)),
        Box::new(store),
    );

    app.apply(keys::map(
        &app.mode,
        KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE),
    ));

    assert!(!app.should_quit);
    assert_eq!(app.status.tone, Tone::Error);
    assert_eq!(app.status.message, "The plan could not be saved.");
}

#[test]
fn ctrl_c_quits_from_a_half_typed_command() {
    let mut session = Session::new(chain_plan());
    session.press(':').type_text("bud");
    session.key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
    assert!(session.app.should_quit);
}

#[test]
fn crossing_midnight_expires_the_budget_and_frees_yesterdays_deferrals() {
    let clock = StepClock::new(TODAY);
    let mut session = Session::with_clock(chain_plan(), Box::new(clock.clone()));
    session.select("walk").press('d');
    session.select("receipts").press('c');
    assert_eq!(session.app.plan().spent_today, 2);

    clock.set("2026-09-01");
    session.app.refresh();

    assert_eq!(session.app.plan().spent_today, 0, "unused points expire");
    assert_eq!(session.app.view().remaining, 8);
    assert_eq!(
        session.kind_of("walk"),
        NodeKind::Eligible,
        "deferral was for one day"
    );
    assert_eq!(session.kind_of("receipts"), NodeKind::Completed);
}

#[test]
fn a_session_round_trips_through_the_file_it_writes() {
    let mut session = Session::new(chain_plan());
    session
        .select("walk")
        .press('c')
        .select("receipts")
        .press(':')
        .type_text("notes Shoebox")
        .enter();

    let reopened = match load(&session.path).expect("load") {
        Loaded::Existing(plan) => plan,
        other => panic!("expected a plan on disk, got {other:?}"),
    };
    assert_eq!(reopened, *session.app.plan());
}

#[test]
fn a_json_plan_beside_the_yaml_one_is_imported_on_open() {
    let dir = tempfile::tempdir().expect("temp dir");
    let yaml_path = dir.path().join("tree.yaml");
    let json_path = dir.path().join("tree.json");
    std::fs::write(&json_path, taltree::persist::json::to_json(&chain_plan())).expect("write json");

    match load(&yaml_path).expect("load") {
        Loaded::Imported { plan, from } => {
            assert_eq!(plan, chain_plan());
            assert_eq!(from, json_path);
        }
        other => panic!("expected an import, got {other:?}"),
    }
}

#[test]
fn an_empty_plan_still_takes_a_first_node() {
    let mut session = Session::new(empty_plan(&FrozenClock::new(TODAY), "Blank"));
    assert_eq!(session.app.selected, None);

    session.press('a').type_text("The first thing").enter();
    session.type_text("1").enter();

    let saved = session.saved();
    assert_eq!(saved.nodes.len(), 1);
    assert!(
        saved.nodes[0].prerequisite_ids.is_empty(),
        "nothing was selected to link to"
    );
}

#[test]
fn a_plan_file_is_never_left_half_written() {
    let mut session = Session::new(chain_plan());
    session.select("walk").press('c');
    let siblings: Vec<PathBuf> =
        std::fs::read_dir(session.path.parent().unwrap_or_else(|| Path::new(".")))
            .expect("read dir")
            .map(|entry| entry.expect("entry").path())
            .collect();
    assert_eq!(siblings, vec![session.path.clone()]);
}
