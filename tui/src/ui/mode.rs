//! What the application is currently asking of the keyboard.
//!
//! Every way of typing something - the command line, the search line, and the
//! two-step prompts behind `a` and `e` - shares one [`TextInput`], so editing a
//! title behaves exactly like editing a command.

/// A single line being typed, with a cursor measured in characters.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TextInput {
    text: String,
    cursor: usize,
}

impl TextInput {
    /// A line prefilled with `text`, with the cursor at the end of it.
    pub fn new(text: impl Into<String>) -> Self {
        let text = text.into();
        let cursor = text.chars().count();
        TextInput { text, cursor }
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    pub fn into_text(self) -> String {
        self.text
    }

    pub fn insert(&mut self, ch: char) {
        let at = self.byte_at(self.cursor);
        self.text.insert(at, ch);
        self.cursor += 1;
    }

    pub fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let from = self.byte_at(self.cursor - 1);
        let to = self.byte_at(self.cursor);
        self.text.replace_range(from..to, "");
        self.cursor -= 1;
    }

    pub fn delete(&mut self) {
        let length = self.text.chars().count();
        if self.cursor >= length {
            return;
        }
        let from = self.byte_at(self.cursor);
        let to = self.byte_at(self.cursor + 1);
        self.text.replace_range(from..to, "");
    }

    pub fn left(&mut self) {
        self.cursor = self.cursor.saturating_sub(1);
    }

    pub fn right(&mut self) {
        self.cursor = (self.cursor + 1).min(self.text.chars().count());
    }

    pub fn home(&mut self) {
        self.cursor = 0;
    }

    pub fn end(&mut self) {
        self.cursor = self.text.chars().count();
    }

    fn byte_at(&self, index: usize) -> usize {
        self.text
            .char_indices()
            .nth(index)
            .map(|(at, _)| at)
            .unwrap_or(self.text.len())
    }
}

/// What a prompt is collecting, and what it already has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptKind {
    AddTitle,
    AddCost { title: String },
    EditTitle { id: String },
    EditCost { id: String, title: String },
    Notes { id: String },
    Group { id: String },
    Budget,
    PlanTitle,
}

impl PromptKind {
    pub fn label(&self) -> String {
        match self {
            PromptKind::AddTitle => "New node title".to_string(),
            PromptKind::AddCost { title } => {
                format!("Cost for \"{title}\" in points (blank for 1)")
            }
            PromptKind::EditTitle { .. } => "Title".to_string(),
            PromptKind::EditCost { title, .. } => format!("Cost for \"{title}\" in points"),
            PromptKind::Notes { .. } => "Notes".to_string(),
            PromptKind::Group { .. } => "Group (blank for none)".to_string(),
            PromptKind::Budget => "Daily budget in points".to_string(),
            PromptKind::PlanTitle => "Plan title".to_string(),
        }
    }
}

/// A question waiting for a line of text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prompt {
    pub kind: PromptKind,
    pub input: TextInput,
}

impl Prompt {
    pub fn new(kind: PromptKind) -> Self {
        Prompt {
            kind,
            input: TextInput::default(),
        }
    }

    pub fn prefilled(kind: PromptKind, text: impl Into<String>) -> Self {
        Prompt {
            kind,
            input: TextInput::new(text),
        }
    }
}

/// A question waiting for yes or no.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Confirm {
    Delete { id: String, title: String },
}

impl Confirm {
    pub fn question(&self) -> String {
        match self {
            Confirm::Delete { title, .. } => {
                format!("Delete \"{title}\" and every link to it? (y/n)")
            }
        }
    }
}

/// What the keyboard means right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    Normal,
    /// `:` - a command line.
    Command(TextInput),
    /// `/` - a live search.
    Search(TextInput),
    Prompt(Prompt),
    Confirm(Confirm),
    /// `r` - pick a second node to link to or unlink from.
    LinkPick {
        dependent: String,
    },
    /// `?` - the keybinding sheet.
    Help,
}

impl Mode {
    pub fn is_typing(&self) -> bool {
        matches!(self, Mode::Command(_) | Mode::Search(_) | Mode::Prompt(_))
    }

    pub fn input(&self) -> Option<&TextInput> {
        match self {
            Mode::Command(input) | Mode::Search(input) => Some(input),
            Mode::Prompt(prompt) => Some(&prompt.input),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_appends_at_the_cursor() {
        let mut input = TextInput::default();
        for ch in "walk".chars() {
            input.insert(ch);
        }
        assert_eq!(input.text(), "walk");
        assert_eq!(input.cursor(), 4);
    }

    #[test]
    fn a_prefilled_line_starts_with_the_cursor_at_the_end() {
        let input = TextInput::new("Take a walk");
        assert_eq!(input.cursor(), 11);
    }

    #[test]
    fn backspace_removes_the_character_before_the_cursor() {
        let mut input = TextInput::new("walk");
        input.backspace();
        assert_eq!(input.text(), "wal");
        input.home();
        input.backspace();
        assert_eq!(input.text(), "wal", "nothing to delete at the start");
    }

    #[test]
    fn the_cursor_moves_without_leaving_the_line() {
        let mut input = TextInput::new("ab");
        input.left();
        input.insert('X');
        assert_eq!(input.text(), "aXb");
        input.end();
        input.right();
        assert_eq!(input.cursor(), 3);
        input.home();
        input.left();
        assert_eq!(input.cursor(), 0);
    }

    #[test]
    fn delete_removes_the_character_under_the_cursor() {
        let mut input = TextInput::new("abc");
        input.home();
        input.delete();
        assert_eq!(input.text(), "bc");
        input.end();
        input.delete();
        assert_eq!(input.text(), "bc");
    }

    #[test]
    fn editing_works_on_characters_not_bytes() {
        let mut input = TextInput::new("héllo");
        input.home();
        input.right();
        input.delete();
        assert_eq!(input.text(), "hllo");
        input.insert('é');
        assert_eq!(input.text(), "héllo");
    }

    #[test]
    fn prompts_say_what_they_want() {
        assert_eq!(PromptKind::AddTitle.label(), "New node title");
        assert_eq!(
            PromptKind::AddCost {
                title: "Walk".to_string()
            }
            .label(),
            "Cost for \"Walk\" in points (blank for 1)"
        );
    }

    #[test]
    fn a_delete_confirmation_names_what_is_going() {
        let confirm = Confirm::Delete {
            id: "a".to_string(),
            title: "Alpha".to_string(),
        };
        assert_eq!(
            confirm.question(),
            "Delete \"Alpha\" and every link to it? (y/n)"
        );
    }

    #[test]
    fn only_the_typing_modes_report_that_they_are_typing() {
        assert!(!Mode::Normal.is_typing());
        assert!(Mode::Command(TextInput::default()).is_typing());
        assert!(Mode::Search(TextInput::default()).is_typing());
        assert!(Mode::Prompt(Prompt::new(PromptKind::AddTitle)).is_typing());
        assert!(!Mode::Help.is_typing());
    }
}
