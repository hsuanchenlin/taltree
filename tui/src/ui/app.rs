//! The application state and everything that changes it.
//!
//! `App` owns the plan, decides what a key does, and applies the domain's
//! answer. It never re-implements a rule: eligibility, cycles, budget, and
//! rollover all come back from [`crate::domain::plan`].

use crate::domain::clock::Clock;
use crate::domain::plan::{
    complete_node, defer_node, delete_node, edit_node, explain_choice, inspect, remaining_budget,
    set_daily_budget, set_title, toggle_prerequisite, undefer_node,
};
use crate::domain::types::{NodeInput, NodeKind, NodePatch, Plan, PlanView, MAX_BUDGET, MAX_COST};
use crate::graph::board::{build_board, Board, BoardHighlights};
use crate::graph::camera::{self, BoardSize, Camera, Rect, Viewport};
use crate::graph::layout::{layout_graph, Density, LaidOutGraph, LayoutOptions};
use crate::graph::model::{build_graph, GraphModel};
use crate::graph::navigate::{self, Direction};
use crate::persist::store::PlanStore;

use super::format;
use super::keys::Action;
use super::mode::{Confirm, Mode, Prompt, PromptKind, TextInput};

/// Which workspace is on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewMode {
    /// The 2D talent tree.
    Tree,
    /// The keyboard-operable list, kept as the accessible alternative.
    List,
}

impl ViewMode {
    pub fn toggled(self) -> Self {
        match self {
            ViewMode::Tree => ViewMode::List,
            ViewMode::List => ViewMode::Tree,
        }
    }
}

/// How loudly to say something.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Info,
    Good,
    Warn,
    Error,
}

/// The last thing the application said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    pub message: String,
    pub tone: Tone,
}

impl Status {
    pub fn info(message: impl Into<String>) -> Self {
        Status {
            message: message.into(),
            tone: Tone::Info,
        }
    }

    pub fn good(message: impl Into<String>) -> Self {
        Status {
            message: message.into(),
            tone: Tone::Good,
        }
    }

    pub fn warn(message: impl Into<String>) -> Self {
        Status {
            message: message.into(),
            tone: Tone::Warn,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Status {
            message: message.into(),
            tone: Tone::Error,
        }
    }
}

/// A live search over node titles.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Search {
    pub query: String,
    pub matches: Vec<String>,
}

/// The whole application.
pub struct App {
    plan: Plan,
    clock: Box<dyn Clock>,
    store: Box<dyn PlanStore>,
    pub selected: Option<String>,
    pub view_mode: ViewMode,
    pub density: Density,
    pub camera: Camera,
    pub mode: Mode,
    pub status: Status,
    pub search: Search,
    pub should_quit: bool,
    /// How far the help sheet is scrolled, and how far it can go. The renderer
    /// reports the extent, because only it knows how the sheet was laid out.
    help_scroll: u16,
    help_extent: u16,
    viewport: Viewport,
    view: PlanView,
    model: GraphModel,
    laid: LaidOutGraph,
}

impl App {
    pub fn new(plan: Plan, clock: Box<dyn Clock>, store: Box<dyn PlanStore>) -> Self {
        let view = inspect(&plan, clock.as_ref());
        let model = build_graph(&view);
        let density = Density::Compact;
        let laid = layout_graph(
            &model,
            LayoutOptions {
                density,
                target_row_width: 96,
            },
        );
        let selected = navigate::first(&laid);
        let mut app = App {
            plan: view.plan.clone(),
            clock,
            store,
            selected,
            view_mode: ViewMode::Tree,
            density,
            camera: Camera::default(),
            mode: Mode::Normal,
            status: Status::info(format::NORMAL_HINTS),
            search: Search::default(),
            should_quit: false,
            help_scroll: 0,
            help_extent: 0,
            viewport: Viewport::new(96, 24),
            view,
            model,
            laid,
        };
        app.refresh();
        app
    }

    pub fn plan(&self) -> &Plan {
        &self.plan
    }

    pub fn view(&self) -> &PlanView {
        &self.view
    }

    pub fn model(&self) -> &GraphModel {
        &self.model
    }

    pub fn laid(&self) -> &LaidOutGraph {
        &self.laid
    }

    pub fn today(&self) -> String {
        self.clock.today()
    }

    pub fn location(&self) -> String {
        self.store.location()
    }

    /// The board as the renderer will draw it.
    pub fn board(&self) -> Board {
        build_board(
            &self.laid,
            &self.model,
            self.density,
            &BoardHighlights {
                selected: self.selected.as_deref(),
                search_hits: &self.search.matches,
            },
        )
    }

    /// Tell the application how much room the tree gets. Layout wraps
    /// unconnected pieces to this width, so a resize re-lays the board out.
    pub fn set_viewport(&mut self, viewport: Viewport) {
        if self.viewport == viewport {
            return;
        }
        let relayout = self.viewport.width != viewport.width;
        self.viewport = viewport;
        if relayout {
            self.rebuild_layout();
        }
        self.keep_selection_visible();
    }

    pub fn viewport(&self) -> Viewport {
        self.viewport
    }

    pub fn help_scroll(&self) -> u16 {
        self.help_scroll
    }

    /// Told by the renderer how far the sheet it just drew can scroll.
    pub fn set_help_extent(&mut self, extent: u16) {
        self.help_extent = extent;
        self.help_scroll = self.help_scroll.min(extent);
    }

    /// Today's plan, the board, and the selection, all brought back into step.
    pub fn refresh(&mut self) {
        self.view = inspect(&self.plan, self.clock.as_ref());
        self.plan = self.view.plan.clone();
        self.model = build_graph(&self.view);
        self.rebuild_layout();
        if let Some(id) = &self.selected {
            if self.laid.node(id).is_none() {
                self.selected = navigate::first(&self.laid);
            }
        } else {
            self.selected = navigate::first(&self.laid);
        }
        self.refresh_matches();
        self.keep_selection_visible();
    }

    fn rebuild_layout(&mut self) {
        self.laid = layout_graph(
            &self.model,
            LayoutOptions {
                density: self.density,
                target_row_width: self.viewport.width.max(30),
            },
        );
        self.camera = camera::clamp(self.camera, self.board_size(), self.viewport);
    }

    fn board_size(&self) -> BoardSize {
        BoardSize {
            width: self.laid.width,
            height: self.laid.height,
        }
    }

    fn keep_selection_visible(&mut self) {
        let Some(id) = self.selected.clone() else {
            return;
        };
        let Some(node) = self.laid.node(&id) else {
            return;
        };
        self.camera = camera::keep_visible(
            self.camera,
            Rect::from(node),
            self.board_size(),
            self.viewport,
        );
    }

    /// Apply one intention.
    pub fn apply(&mut self, action: Action) {
        match action {
            Action::None => {}
            Action::Quit => self.quit(),
            Action::Move(direction) => self.move_selection(direction),
            Action::Pan(dx, dy) => {
                if self.mode == Mode::Help {
                    self.scroll_help(dy);
                } else {
                    self.camera =
                        camera::pan(self.camera, dx, dy, self.board_size(), self.viewport);
                }
            }
            Action::PanPage(pages) => {
                let step = self.viewport.height.max(1) as i32 * pages;
                if self.mode == Mode::Help {
                    self.scroll_help(step);
                } else {
                    self.camera =
                        camera::pan(self.camera, 0, step, self.board_size(), self.viewport);
                }
            }
            Action::GoFirst => self.go_first(),
            Action::GoFrontier => self.go_frontier(),
            Action::Center => self.center(),
            Action::ToggleView => {
                self.view_mode = self.view_mode.toggled();
                self.status = Status::info(match self.view_mode {
                    ViewMode::Tree => "Talent tree. Press v for the list.",
                    ViewMode::List => "List. Press v for the talent tree.",
                });
            }
            Action::ToggleDensity => {
                self.density = self.density.toggled();
                self.rebuild_layout();
                self.keep_selection_visible();
                self.status = Status::info(format!("Board is {}.", self.density.label()));
            }
            Action::ShowHelp => {
                self.mode = Mode::Help;
                self.help_scroll = 0;
            }
            Action::Dismiss => self.dismiss(),
            Action::Complete => self.complete(),
            Action::Defer => self.defer(),
            Action::BeginAdd => self.begin_add(None),
            Action::BeginEdit => self.begin_edit(None),
            Action::BeginNotes => self.begin_notes(),
            Action::BeginLink => self.begin_link(),
            Action::BeginDelete => self.begin_delete(),
            Action::BeginCommand => self.mode = Mode::Command(TextInput::default()),
            Action::BeginSearch => self.mode = Mode::Search(TextInput::default()),
            Action::SearchNext => self.jump_match(1),
            Action::SearchPrevious => self.jump_match(-1),
            Action::Insert(ch) => self.edit_input(|input| input.insert(ch)),
            Action::Backspace => self.edit_input(TextInput::backspace),
            Action::DeleteForward => self.edit_input(TextInput::delete),
            Action::CursorLeft => self.edit_input(TextInput::left),
            Action::CursorRight => self.edit_input(TextInput::right),
            Action::CursorHome => self.edit_input(TextInput::home),
            Action::CursorEnd => self.edit_input(TextInput::end),
            Action::Submit => self.submit(),
            Action::Cancel => {
                self.mode = Mode::Normal;
                self.status = Status::info("Cancelled.");
            }
            Action::Yes => self.confirm_yes(),
            Action::No => {
                self.mode = Mode::Normal;
                self.status = Status::info("Left alone.");
            }
            Action::Save => self.save(true),
        }
    }

    fn quit(&mut self) {
        self.save(false);
        self.should_quit = true;
    }

    fn scroll_help(&mut self, delta: i32) {
        let next = self.help_scroll as i32 + delta;
        self.help_scroll = next.clamp(0, self.help_extent as i32) as u16;
    }

    fn dismiss(&mut self) {
        self.help_scroll = 0;
        if !self.search.query.is_empty() {
            self.search = Search::default();
            self.status = Status::info("Search cleared.");
        }
        self.mode = Mode::Normal;
    }

    fn move_selection(&mut self, direction: Direction) {
        let Some(current) = self.selected.clone() else {
            self.selected = navigate::first(&self.laid);
            self.keep_selection_visible();
            return;
        };
        let landed = match self.view_mode {
            ViewMode::Tree => navigate::step(&self.laid, &self.model, &current, direction),
            ViewMode::List => self.list_step(&current, direction),
        };
        if let Some(id) = landed {
            self.selected = Some(id);
            self.keep_selection_visible();
        }
    }

    /// In the list, up and down walk the document order and sideways does nothing.
    fn list_step(&self, current: &str, direction: Direction) -> Option<String> {
        let index = self
            .view
            .listings
            .iter()
            .position(|listing| listing.node.id == current)?;
        let next = match direction {
            Direction::Up => index.checked_sub(1)?,
            Direction::Down => index + 1,
            _ => return None,
        };
        self.view
            .listings
            .get(next)
            .map(|listing| listing.node.id.clone())
    }

    fn go_first(&mut self) {
        if let Some(id) = navigate::first(&self.laid) {
            self.selected = Some(id);
            self.keep_selection_visible();
        }
    }

    /// `G` walks the frontier: the work that can actually be started now.
    fn go_frontier(&mut self) {
        let frontier = self.frontier_in_board_order();

        if frontier.is_empty() {
            if let Some(id) = navigate::last(&self.laid) {
                self.selected = Some(id);
                self.keep_selection_visible();
            }
            self.status = Status::warn("Nothing is eligible today.");
            return;
        }

        let position = self
            .selected
            .as_deref()
            .and_then(|id| frontier.iter().position(|found| found == id));
        let next = match position {
            Some(index) => (index + 1) % frontier.len(),
            None => 0,
        };
        self.selected = Some(frontier[next].clone());
        self.keep_selection_visible();
        self.status = Status::info(format!(
            "Frontier: {} of {} eligible.",
            next + 1,
            frontier.len()
        ));
    }

    /// Eligible nodes, top to bottom then left to right.
    fn frontier_in_board_order(&self) -> Vec<String> {
        let mut frontier: Vec<&crate::graph::layout::PlacedNode> = self
            .laid
            .nodes
            .iter()
            .filter(|node| {
                self.view
                    .listing(&node.id)
                    .map(|listing| listing.kind == NodeKind::Eligible)
                    .unwrap_or(false)
            })
            .collect();
        frontier.sort_by_key(|node| (node.y, node.x, node.original_index));
        frontier.into_iter().map(|node| node.id.clone()).collect()
    }

    fn center(&mut self) {
        let rect = self
            .selected
            .as_deref()
            .and_then(|id| self.laid.node(id))
            .map(Rect::from)
            .unwrap_or(Rect {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            });
        self.camera = camera::center_on(rect, self.board_size(), self.viewport);
    }

    fn complete(&mut self) {
        let Some(id) = self.selected.clone() else {
            self.status = Status::warn("Nothing is selected.");
            return;
        };
        let explanation = explain_choice(&self.plan, &id, self.clock.as_ref()).ok();
        match complete_node(&self.plan, &id, self.clock.as_ref()) {
            Ok(next) => {
                self.plan = next;
                self.after_change();
                let title = explanation
                    .as_ref()
                    .map(|choice| choice.node.title.clone())
                    .unwrap_or_else(|| id.clone());
                let cost = explanation
                    .as_ref()
                    .map(|choice| choice.node.cost)
                    .unwrap_or(0);
                let unlocked = explanation
                    .as_ref()
                    .map(|choice| format::names(&choice.immediate_unlocks))
                    .unwrap_or_default();
                let tail = if unlocked.is_empty() {
                    format!(
                        "{} left today.",
                        format::points(remaining_budget(&self.plan))
                    )
                } else {
                    format!("Unlocked {unlocked}.")
                };
                self.status = Status::good(format!(
                    "Completed \"{title}\" for {}. {tail}",
                    format::points(cost)
                ));
            }
            Err(error) => self.status = Status::error(error.message),
        }
    }

    fn defer(&mut self) {
        let Some(id) = self.selected.clone() else {
            self.status = Status::warn("Nothing is selected.");
            return;
        };
        let deferred_today = self
            .view
            .listing(&id)
            .map(|listing| listing.kind == NodeKind::Deferred)
            .unwrap_or(false);
        let title = self
            .plan
            .node(&id)
            .map(|node| node.title.clone())
            .unwrap_or_else(|| id.clone());

        let result = if deferred_today {
            undefer_node(&self.plan, &id, self.clock.as_ref())
        } else {
            defer_node(&self.plan, &id, self.clock.as_ref())
        };
        match result {
            Ok(next) => {
                self.plan = next;
                self.after_change();
                self.status = Status::good(if deferred_today {
                    format!("\"{title}\" is back on today's frontier.")
                } else {
                    format!("Deferred \"{title}\" for today.")
                });
            }
            Err(error) => self.status = Status::error(error.message),
        }
    }

    fn begin_add(&mut self, title: Option<String>) {
        self.mode = Mode::Prompt(match title {
            Some(title) if !title.trim().is_empty() => Prompt::new(PromptKind::AddCost {
                title: title.trim().to_string(),
            }),
            _ => Prompt::new(PromptKind::AddTitle),
        });
    }

    fn begin_edit(&mut self, title: Option<String>) {
        let Some(node) = self.selected.as_deref().and_then(|id| self.plan.node(id)) else {
            self.status = Status::warn("Select a node to edit.");
            return;
        };
        let id = node.id.clone();
        self.mode = Mode::Prompt(match title {
            Some(title) if !title.trim().is_empty() => Prompt::prefilled(
                PromptKind::EditCost {
                    id,
                    title: title.trim().to_string(),
                },
                node.cost.to_string(),
            ),
            _ => Prompt::prefilled(PromptKind::EditTitle { id }, node.title.clone()),
        });
    }

    fn begin_notes(&mut self) {
        let Some(node) = self.selected.as_deref().and_then(|id| self.plan.node(id)) else {
            self.status = Status::warn("Select a node to annotate.");
            return;
        };
        self.mode = Mode::Prompt(Prompt::prefilled(
            PromptKind::Notes {
                id: node.id.clone(),
            },
            node.notes.clone().unwrap_or_default(),
        ));
    }

    fn begin_link(&mut self) {
        let Some(id) = self.selected.clone() else {
            self.status = Status::warn("Select the node that needs a prerequisite.");
            return;
        };
        let title = self
            .plan
            .node(&id)
            .map(|node| node.title.clone())
            .unwrap_or_else(|| id.clone());
        self.mode = Mode::LinkPick { dependent: id };
        self.status = Status::info(format!(
            "Move to a prerequisite for \"{title}\", Enter to link or unlink, Esc to cancel."
        ));
    }

    fn begin_delete(&mut self) {
        let Some(node) = self.selected.as_deref().and_then(|id| self.plan.node(id)) else {
            self.status = Status::warn("Nothing is selected.");
            return;
        };
        self.mode = Mode::Confirm(Confirm::Delete {
            id: node.id.clone(),
            title: node.title.clone(),
        });
    }

    fn confirm_yes(&mut self) {
        let Mode::Confirm(confirm) = self.mode.clone() else {
            return;
        };
        self.mode = Mode::Normal;
        match confirm {
            Confirm::Delete { id, title } => {
                match delete_node(&self.plan, &id, self.clock.as_ref()) {
                    Ok(next) => {
                        self.plan = next;
                        if self.selected.as_deref() == Some(id.as_str()) {
                            self.selected = None;
                        }
                        self.after_change();
                        self.status = Status::good(format!("Deleted \"{title}\"."));
                    }
                    Err(error) => self.status = Status::error(error.message),
                }
            }
        }
    }

    fn edit_input(&mut self, edit: impl FnOnce(&mut TextInput)) {
        match &mut self.mode {
            Mode::Command(input) | Mode::Search(input) => edit(input),
            Mode::Prompt(prompt) => edit(&mut prompt.input),
            _ => return,
        }
        if matches!(self.mode, Mode::Search(_)) {
            self.refresh_matches();
        }
    }

    fn submit(&mut self) {
        match std::mem::replace(&mut self.mode, Mode::Normal) {
            Mode::Command(input) => self.run_command(&input.into_text()),
            Mode::Search(input) => {
                self.search.query = input.into_text();
                self.refresh_matches();
                self.jump_match(0);
            }
            Mode::Prompt(prompt) => self.finish_prompt(prompt),
            Mode::LinkPick { dependent } => self.finish_link(&dependent),
            other => self.mode = other,
        }
    }

    fn finish_prompt(&mut self, prompt: Prompt) {
        let text = prompt.input.into_text();
        match prompt.kind {
            PromptKind::AddTitle => {
                if text.trim().is_empty() {
                    self.status = Status::warn("A node needs a title.");
                    return;
                }
                // Left blank rather than prefilled with the default: a
                // prefilled line means the first digit typed lands beside it.
                self.mode = Mode::Prompt(Prompt::new(PromptKind::AddCost {
                    title: text.trim().to_string(),
                }));
            }
            PromptKind::AddCost { title } if text.trim().is_empty() => self.create(title, 1),
            PromptKind::AddCost { title } => match parse_points(&text, MAX_COST) {
                Ok(cost) => self.create(title, cost),
                Err(message) => {
                    self.status = Status::error(message);
                    self.mode = Mode::Prompt(Prompt::new(PromptKind::AddCost { title }));
                }
            },
            PromptKind::EditTitle { id } => {
                if text.trim().is_empty() {
                    self.status = Status::warn("A node needs a title.");
                    return;
                }
                let cost = self.plan.node(&id).map(|node| node.cost).unwrap_or(1);
                self.mode = Mode::Prompt(Prompt::prefilled(
                    PromptKind::EditCost {
                        id,
                        title: text.trim().to_string(),
                    },
                    cost.to_string(),
                ));
            }
            PromptKind::EditCost { id, title } => match parse_points(&text, MAX_COST) {
                Ok(cost) => self.commit_edit(
                    &id,
                    NodePatch {
                        title: Some(title),
                        cost: Some(cost),
                        ..NodePatch::default()
                    },
                ),
                Err(message) => {
                    self.status = Status::error(message);
                    self.mode = Mode::Prompt(Prompt::new(PromptKind::EditCost { id, title }));
                }
            },
            PromptKind::Notes { id } => self.commit_edit(
                &id,
                NodePatch {
                    notes: Some(Some(text)),
                    ..NodePatch::default()
                },
            ),
            PromptKind::Budget => match parse_points(&text, MAX_BUDGET) {
                Ok(budget) => self.set_budget(budget),
                Err(message) => self.status = Status::error(message),
            },
            PromptKind::PlanTitle => match set_title(&self.plan, &text, self.clock.as_ref()) {
                Ok(next) => {
                    self.plan = next;
                    self.after_change();
                    self.status = Status::good(format!("Plan is now \"{}\".", self.plan.title));
                }
                Err(error) => self.status = Status::error(error.message),
            },
        }
    }

    fn create(&mut self, title: String, cost: u32) {
        let prerequisite_ids = self.selected.clone().into_iter().collect();
        let input = NodeInput {
            title,
            cost,
            prerequisite_ids,
        };
        match crate::domain::plan::create_node(&self.plan, &input, self.clock.as_ref()) {
            Ok((next, id)) => {
                self.plan = next;
                let title = self
                    .plan
                    .node(&id)
                    .map(|node| node.title.clone())
                    .unwrap_or_default();
                self.selected = Some(id);
                self.after_change();
                self.status = Status::good(format!("Added \"{title}\"."));
            }
            Err(error) => self.status = Status::error(error.message),
        }
    }

    fn commit_edit(&mut self, id: &str, patch: NodePatch) {
        match edit_node(&self.plan, id, &patch, self.clock.as_ref()) {
            Ok(next) => {
                self.plan = next;
                self.after_change();
                let title = self
                    .plan
                    .node(id)
                    .map(|node| node.title.clone())
                    .unwrap_or_default();
                self.status = Status::good(format!("Updated \"{title}\"."));
            }
            Err(error) => self.status = Status::error(error.message),
        }
    }

    fn set_budget(&mut self, budget: u32) {
        match set_daily_budget(&self.plan, budget, self.clock.as_ref()) {
            Ok(next) => {
                self.plan = next;
                self.after_change();
                self.status = Status::good(format!(
                    "Daily budget is {}. {} left today.",
                    format::points(budget),
                    format::points(self.view.remaining)
                ));
            }
            Err(error) => self.status = Status::error(error.message),
        }
    }

    fn finish_link(&mut self, dependent: &str) {
        let Some(prerequisite) = self.selected.clone() else {
            self.status = Status::warn("Nothing is selected.");
            return;
        };
        self.link(dependent, &prerequisite);
    }

    fn link(&mut self, dependent: &str, prerequisite: &str) {
        match toggle_prerequisite(&self.plan, dependent, prerequisite, self.clock.as_ref()) {
            Ok((next, added)) => {
                self.plan = next;
                self.selected = Some(dependent.to_string());
                self.after_change();
                let dependent_title = self.title_of(dependent);
                let prerequisite_title = self.title_of(prerequisite);
                self.status = Status::good(if added {
                    format!("\"{dependent_title}\" now needs \"{prerequisite_title}\".")
                } else {
                    format!("\"{dependent_title}\" no longer needs \"{prerequisite_title}\".")
                });
            }
            Err(error) => self.status = Status::error(error.message),
        }
    }

    fn title_of(&self, id: &str) -> String {
        self.plan
            .node(id)
            .map(|node| node.title.clone())
            .unwrap_or_else(|| id.to_string())
    }

    fn refresh_matches(&mut self) {
        let query = match &self.mode {
            Mode::Search(input) => input.text().to_string(),
            _ => self.search.query.clone(),
        };
        self.search.query = query.clone();
        let needle = query.trim().to_lowercase();
        self.search.matches = if needle.is_empty() {
            Vec::new()
        } else {
            self.laid
                .nodes
                .iter()
                .filter(|node| {
                    self.model
                        .node(&node.id)
                        .map(|found| found.title.to_lowercase().contains(&needle))
                        .unwrap_or(false)
                })
                .map(|node| node.id.clone())
                .collect()
        };
    }

    /// Step to another match. `0` jumps to the nearest one from here.
    fn jump_match(&mut self, step: i32) {
        if self.search.matches.is_empty() {
            if !self.search.query.trim().is_empty() {
                self.status = Status::warn(format!("No node matches \"{}\".", self.search.query));
            }
            return;
        }
        let ordered = self.ordered_matches();
        let position = self
            .selected
            .as_deref()
            .and_then(|id| ordered.iter().position(|found| found == id));
        let next = match (position, step) {
            (Some(index), _) => {
                let length = ordered.len() as i32;
                (((index as i32 + step) % length) + length) as usize % ordered.len()
            }
            (None, _) => navigate::nearest_among(&self.laid, self.selected.as_deref(), &ordered)
                .and_then(|id| ordered.iter().position(|found| *found == id))
                .unwrap_or_default(),
        };
        self.selected = Some(ordered[next].clone());
        self.keep_selection_visible();
        self.status = Status::info(format!(
            "Match {} of {} for \"{}\".",
            next + 1,
            ordered.len(),
            self.search.query.trim()
        ));
    }

    /// Matches in board order, so `n` walks the tree the way it is drawn.
    fn ordered_matches(&self) -> Vec<String> {
        let mut ordered: Vec<&crate::graph::layout::PlacedNode> = self
            .laid
            .nodes
            .iter()
            .filter(|node| self.search.matches.iter().any(|id| id == &node.id))
            .collect();
        ordered.sort_by_key(|node| (node.y, node.x, node.original_index));
        ordered.into_iter().map(|node| node.id.clone()).collect()
    }

    fn run_command(&mut self, line: &str) {
        let line = line.trim();
        let (name, rest) = match line.split_once(char::is_whitespace) {
            Some((name, rest)) => (name, rest.trim()),
            None => (line, ""),
        };
        match name {
            "" => {}
            "w" | "write" | "save" => self.save(true),
            "q" | "quit" => self.quit(),
            "wq" | "x" => {
                self.save(true);
                self.should_quit = true;
            }
            "add" | "a" => self.begin_add(Some(rest.to_string())),
            "edit" | "e" => self.begin_edit(Some(rest.to_string())),
            "notes" => {
                if rest.is_empty() {
                    self.begin_notes();
                } else if let Some(id) = self.selected.clone() {
                    self.commit_edit(
                        &id,
                        NodePatch {
                            notes: Some(Some(rest.to_string())),
                            ..NodePatch::default()
                        },
                    );
                } else {
                    self.status = Status::warn("Select a node to annotate.");
                }
            }
            "budget" => {
                if rest.is_empty() {
                    self.mode = Mode::Prompt(Prompt::prefilled(
                        PromptKind::Budget,
                        self.plan.daily_budget.to_string(),
                    ));
                } else {
                    match parse_points(rest, MAX_BUDGET) {
                        Ok(budget) => self.set_budget(budget),
                        Err(message) => self.status = Status::error(message),
                    }
                }
            }
            "title" => {
                if rest.is_empty() {
                    self.mode = Mode::Prompt(Prompt::prefilled(
                        PromptKind::PlanTitle,
                        self.plan.title.clone(),
                    ));
                } else {
                    self.finish_prompt(Prompt::prefilled(PromptKind::PlanTitle, rest));
                }
            }
            "dep" | "require" => self.command_link(rest),
            "delete" | "del" => self.begin_delete(),
            "defer" => self.defer(),
            "complete" | "done" => self.complete(),
            "help" => {
                self.mode = Mode::Help;
                self.help_scroll = 0;
            }
            "tree" => self.view_mode = ViewMode::Tree,
            "list" => self.view_mode = ViewMode::List,
            other => {
                self.status =
                    Status::error(format!("Unknown command \":{other}\". Press ? for help."))
            }
        }
    }

    fn command_link(&mut self, query: &str) {
        let Some(dependent) = self.selected.clone() else {
            self.status = Status::warn("Select the node that needs a prerequisite.");
            return;
        };
        if query.is_empty() {
            self.begin_link();
            return;
        }
        match self.find_node(query, Some(&dependent)) {
            Some(prerequisite) => self.link(&dependent, &prerequisite),
            None => self.status = Status::error(format!("No node matches \"{query}\".")),
        }
    }

    /// A node named by id or by part of its title.
    fn find_node(&self, query: &str, except: Option<&str>) -> Option<String> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return None;
        }
        let candidates = || {
            self.plan
                .nodes
                .iter()
                .filter(move |node| Some(node.id.as_str()) != except)
        };
        candidates()
            .find(|node| node.id.to_lowercase() == needle)
            .or_else(|| candidates().find(|node| node.title.to_lowercase() == needle))
            .or_else(|| candidates().find(|node| node.title.to_lowercase().contains(&needle)))
            .map(|node| node.id.clone())
    }

    /// Refresh after the plan changed, then write it out.
    fn after_change(&mut self) {
        self.refresh();
        self.save(false);
    }

    fn save(&mut self, announce: bool) {
        match self.store.save(&self.plan) {
            Ok(()) => {
                if announce {
                    self.status = Status::good(format!("Saved to {}.", self.store.location()));
                }
            }
            Err(message) => self.status = Status::error(message),
        }
    }
}

/// A whole number of points within `max`.
fn parse_points(text: &str, max: u32) -> Result<u32, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Enter a whole number of points.".to_string());
    }
    match trimmed.parse::<u32>() {
        Ok(value) if value <= max => Ok(value),
        Ok(_) => Err(format!("Points must be from 0 to {max}.")),
        Err(_) => Err(format!("\"{trimmed}\" is not a whole number of points.")),
    }
}
