//! Keys in, intentions out.
//!
//! Mapping is a pure function of the current [`Mode`] and the key, so the whole
//! keyboard can be tested without a terminal, and so the same intention can be
//! reached from a key, a command, or a test.

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::graph::navigate::Direction;

use super::mode::Mode;

/// One thing the person asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    None,
    Quit,
    /// Move the selection.
    Move(Direction),
    /// Move the camera, in cells.
    Pan(i32, i32),
    /// Move the camera by a screenful.
    PanPage(i32),
    GoFirst,
    GoFrontier,
    Center,
    ToggleView,
    ToggleDensity,
    ShowHelp,
    /// Close whatever overlay or highlight is showing.
    Dismiss,
    Complete,
    Defer,
    BeginAdd,
    BeginEdit,
    BeginNotes,
    BeginGroup,
    BeginLink,
    BeginDelete,
    BeginCommand,
    BeginSearch,
    SearchNext,
    SearchPrevious,
    Insert(char),
    Backspace,
    DeleteForward,
    CursorLeft,
    CursorRight,
    CursorHome,
    CursorEnd,
    Submit,
    Cancel,
    Yes,
    No,
    Save,
}

/// What a key means in this mode.
pub fn map(mode: &Mode, key: KeyEvent) -> Action {
    // Terminals that report press and release would otherwise act twice.
    if key.kind == KeyEventKind::Release {
        return Action::None;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        return match key.code {
            KeyCode::Char('c') => Action::Quit,
            KeyCode::Char('s') => Action::Save,
            _ => Action::None,
        };
    }

    match mode {
        Mode::Help => match key.code {
            KeyCode::Char('?') | KeyCode::Esc | KeyCode::Enter | KeyCode::Char('q') => {
                Action::Dismiss
            }
            // The sheet is longer than a short terminal, so it scrolls rather
            // than quietly losing its last section.
            KeyCode::Char('j') | KeyCode::Down => Action::Pan(0, 1),
            KeyCode::Char('k') | KeyCode::Up => Action::Pan(0, -1),
            KeyCode::PageDown => Action::PanPage(1),
            KeyCode::PageUp => Action::PanPage(-1),
            _ => Action::None,
        },
        Mode::Confirm(_) => match key.code {
            KeyCode::Char('y') | KeyCode::Char('Y') => Action::Yes,
            KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc | KeyCode::Char('q') => {
                Action::No
            }
            _ => Action::None,
        },
        Mode::Command(_) | Mode::Search(_) | Mode::Prompt(_) => typing(key),
        Mode::LinkPick { .. } => match key.code {
            KeyCode::Enter | KeyCode::Char(' ') => Action::Submit,
            KeyCode::Esc | KeyCode::Char('q') => Action::Cancel,
            _ => movement(key).unwrap_or(Action::None),
        },
        Mode::Normal => normal(key),
    }
}

fn typing(key: KeyEvent) -> Action {
    match key.code {
        KeyCode::Char(ch) => Action::Insert(ch),
        KeyCode::Backspace => Action::Backspace,
        KeyCode::Delete => Action::DeleteForward,
        KeyCode::Left => Action::CursorLeft,
        KeyCode::Right => Action::CursorRight,
        KeyCode::Home => Action::CursorHome,
        KeyCode::End => Action::CursorEnd,
        KeyCode::Enter => Action::Submit,
        KeyCode::Esc => Action::Cancel,
        _ => Action::None,
    }
}

fn movement(key: KeyEvent) -> Option<Action> {
    let direction = match key.code {
        KeyCode::Char('h') | KeyCode::Left => Direction::Left,
        KeyCode::Char('j') | KeyCode::Down => Direction::Down,
        KeyCode::Char('k') | KeyCode::Up => Direction::Up,
        KeyCode::Char('l') | KeyCode::Right => Direction::Right,
        _ => return None,
    };
    Some(Action::Move(direction))
}

fn normal(key: KeyEvent) -> Action {
    if let Some(action) = movement(key) {
        return action;
    }
    match key.code {
        // Shifted movement pans the board instead of the selection.
        KeyCode::Char('H') => Action::Pan(-6, 0),
        KeyCode::Char('J') => Action::Pan(0, 3),
        KeyCode::Char('K') => Action::Pan(0, -3),
        KeyCode::Char('L') => Action::Pan(6, 0),
        KeyCode::PageDown => Action::PanPage(1),
        KeyCode::PageUp => Action::PanPage(-1),

        KeyCode::Char('g') => Action::GoFirst,
        KeyCode::Char('G') => Action::GoFrontier,
        KeyCode::Char('f') => Action::Center,

        KeyCode::Char('c') | KeyCode::Enter | KeyCode::Char(' ') => Action::Complete,
        KeyCode::Char('d') => Action::Defer,
        KeyCode::Char('a') => Action::BeginAdd,
        KeyCode::Char('e') => Action::BeginEdit,
        KeyCode::Char('m') => Action::BeginNotes,
        KeyCode::Char('M') => Action::BeginGroup,
        KeyCode::Char('r') => Action::BeginLink,
        KeyCode::Char('D') => Action::BeginDelete,

        KeyCode::Char(':') => Action::BeginCommand,
        KeyCode::Char('/') => Action::BeginSearch,
        KeyCode::Char('n') => Action::SearchNext,
        KeyCode::Char('N') => Action::SearchPrevious,

        KeyCode::Char('v') => Action::ToggleView,
        KeyCode::Char('z') => Action::ToggleDensity,
        KeyCode::Char('?') => Action::ShowHelp,
        KeyCode::Esc => Action::Dismiss,
        KeyCode::Char('q') => Action::Quit,
        _ => Action::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::mode::{Confirm, Prompt, PromptKind, TextInput};

    fn press(ch: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE)
    }

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn control(ch: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(ch), KeyModifiers::CONTROL)
    }

    #[test]
    fn hjkl_and_the_arrow_keys_move_the_selection() {
        for (ch, code, direction) in [
            ('h', KeyCode::Left, Direction::Left),
            ('j', KeyCode::Down, Direction::Down),
            ('k', KeyCode::Up, Direction::Up),
            ('l', KeyCode::Right, Direction::Right),
        ] {
            assert_eq!(map(&Mode::Normal, press(ch)), Action::Move(direction));
            assert_eq!(map(&Mode::Normal, key(code)), Action::Move(direction));
        }
    }

    #[test]
    fn shifted_movement_pans_the_camera() {
        assert_eq!(map(&Mode::Normal, press('H')), Action::Pan(-6, 0));
        assert_eq!(map(&Mode::Normal, press('L')), Action::Pan(6, 0));
        assert_eq!(
            map(&Mode::Normal, key(KeyCode::PageDown)),
            Action::PanPage(1)
        );
    }

    #[test]
    fn the_three_ways_to_complete_a_node_agree() {
        assert_eq!(map(&Mode::Normal, press('c')), Action::Complete);
        assert_eq!(map(&Mode::Normal, key(KeyCode::Enter)), Action::Complete);
        assert_eq!(map(&Mode::Normal, press(' ')), Action::Complete);
    }

    #[test]
    fn the_editing_keys_are_where_vim_puts_them() {
        assert_eq!(map(&Mode::Normal, press('a')), Action::BeginAdd);
        assert_eq!(map(&Mode::Normal, press('e')), Action::BeginEdit);
        assert_eq!(map(&Mode::Normal, press('m')), Action::BeginNotes);
        assert_eq!(map(&Mode::Normal, press('M')), Action::BeginGroup);
        assert_eq!(map(&Mode::Normal, press('r')), Action::BeginLink);
        assert_eq!(map(&Mode::Normal, press('D')), Action::BeginDelete);
        assert_eq!(map(&Mode::Normal, press('d')), Action::Defer);
    }

    #[test]
    fn the_navigation_keys_are_where_vim_puts_them() {
        assert_eq!(map(&Mode::Normal, press('g')), Action::GoFirst);
        assert_eq!(map(&Mode::Normal, press('G')), Action::GoFrontier);
        assert_eq!(map(&Mode::Normal, press('f')), Action::Center);
        assert_eq!(map(&Mode::Normal, press('/')), Action::BeginSearch);
        assert_eq!(map(&Mode::Normal, press('n')), Action::SearchNext);
        assert_eq!(map(&Mode::Normal, press('N')), Action::SearchPrevious);
    }

    #[test]
    fn quitting_works_from_the_keyboard_and_from_the_interrupt() {
        assert_eq!(map(&Mode::Normal, press('q')), Action::Quit);
        assert_eq!(map(&Mode::Normal, control('c')), Action::Quit);
        assert_eq!(map(&Mode::Help, control('c')), Action::Quit);
        assert_eq!(
            map(&Mode::Command(TextInput::new("add")), control('c')),
            Action::Quit
        );
    }

    #[test]
    fn typing_a_command_never_triggers_a_normal_mode_key() {
        let mode = Mode::Command(TextInput::default());
        assert_eq!(map(&mode, press('q')), Action::Insert('q'));
        assert_eq!(map(&mode, press('d')), Action::Insert('d'));
        assert_eq!(map(&mode, key(KeyCode::Enter)), Action::Submit);
        assert_eq!(map(&mode, key(KeyCode::Esc)), Action::Cancel);
        assert_eq!(map(&mode, key(KeyCode::Backspace)), Action::Backspace);
        assert_eq!(map(&mode, key(KeyCode::Left)), Action::CursorLeft);
    }

    #[test]
    fn a_prompt_takes_text_the_same_way_the_command_line_does() {
        let mode = Mode::Prompt(Prompt::new(PromptKind::AddTitle));
        assert_eq!(map(&mode, press('W')), Action::Insert('W'));
        assert_eq!(map(&mode, key(KeyCode::Enter)), Action::Submit);
    }

    #[test]
    fn a_confirmation_only_hears_yes_or_no() {
        let mode = Mode::Confirm(Confirm::Delete {
            id: "a".to_string(),
            title: "Alpha".to_string(),
        });
        assert_eq!(map(&mode, press('y')), Action::Yes);
        assert_eq!(map(&mode, press('n')), Action::No);
        assert_eq!(map(&mode, key(KeyCode::Esc)), Action::No);
        assert_eq!(map(&mode, press('x')), Action::None);
    }

    #[test]
    fn linking_still_moves_around_while_it_waits_for_a_target() {
        let mode = Mode::LinkPick {
            dependent: "a".to_string(),
        };
        assert_eq!(map(&mode, press('j')), Action::Move(Direction::Down));
        assert_eq!(map(&mode, key(KeyCode::Enter)), Action::Submit);
        assert_eq!(map(&mode, key(KeyCode::Esc)), Action::Cancel);
    }

    #[test]
    fn the_help_sheet_closes_on_anything_that_looks_like_closing() {
        for code in [
            KeyCode::Esc,
            KeyCode::Enter,
            KeyCode::Char('?'),
            KeyCode::Char('q'),
        ] {
            assert_eq!(map(&Mode::Help, key(code)), Action::Dismiss);
        }
    }

    #[test]
    fn the_help_sheet_scrolls_with_the_movement_keys() {
        assert_eq!(map(&Mode::Help, press('j')), Action::Pan(0, 1));
        assert_eq!(map(&Mode::Help, press('k')), Action::Pan(0, -1));
        assert_eq!(map(&Mode::Help, key(KeyCode::PageDown)), Action::PanPage(1));
        assert_eq!(map(&Mode::Help, press('x')), Action::None);
    }

    #[test]
    fn a_key_release_is_not_a_second_press() {
        let mut event = press('q');
        event.kind = KeyEventKind::Release;
        assert_eq!(map(&Mode::Normal, event), Action::None);
    }

    #[test]
    fn control_s_saves_from_anywhere() {
        assert_eq!(map(&Mode::Normal, control('s')), Action::Save);
        assert_eq!(map(&Mode::Help, control('s')), Action::Save);
    }
}
