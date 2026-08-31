//! The keybinding sheet `?` puts on the screen.
//!
//! It is data rather than a painted string so a test can hold it against the
//! key map and notice when the two drift apart.

/// One group of keys.
pub struct Section {
    pub title: &'static str,
    pub rows: &'static [(&'static str, &'static str)],
}

pub const SECTIONS: &[Section] = &[
    Section {
        title: "Move",
        rows: &[
            (
                "h j k l",
                "move along the conduits, then to the nearest node",
            ),
            ("arrows", "the same, for anyone who prefers them"),
            ("g", "jump to the first node"),
            ("G", "walk the frontier: what can be started now"),
            ("f", "centre the board on the selection"),
            ("H J K L", "pan the board"),
            ("PgUp PgDn", "pan by a screenful"),
        ],
    },
    Section {
        title: "Look",
        rows: &[
            ("/", "search titles; type to filter"),
            ("n N", "next and previous match"),
            ("v", "swap between the talent tree and the list"),
            ("z", "swap between compact chips and expanded boxes"),
            ("?", "this sheet"),
            ("Esc", "close an overlay or clear the search"),
        ],
    },
    Section {
        title: "Change",
        rows: &[
            (
                "c  Enter  Space",
                "complete the selected node, spending its cost",
            ),
            ("d", "defer for today, or bring a deferred node back"),
            ("a", "add a node, linked to the selection as a prerequisite"),
            ("e", "edit the title and cost"),
            ("m", "edit the notes"),
            ("r", "link or unlink a prerequisite: move, then Enter"),
            ("D", "delete the selected node, after y/n"),
        ],
    },
    Section {
        title: "Commands",
        rows: &[
            (":add <title>", "add a node"),
            (":edit <title>", "retitle the selection"),
            (":dep <title>", "link or unlink a prerequisite by name"),
            (":require <title>", "the same"),
            (":notes <text>", "annotate the selection"),
            (":budget <n>", "set today's budget"),
            (":title <text>", "rename the plan"),
            (":delete", "delete the selection"),
            (":list  :tree", "choose a view"),
            (":w  :save", "save now (changes also save themselves)"),
            (":q  :wq", "quit, saving first"),
        ],
    },
    Section {
        title: "Sockets",
        rows: &[
            ("( )", "eligible: every prerequisite is done"),
            ("[*]", "completed"),
            ("[ ]", "blocked: something it needs is unfinished"),
            ("[-]", "deferred for today"),
            ("═══", "an illuminated conduit: its prerequisite is done"),
        ],
    },
];

/// How many lines each section takes: a title, a line per row, and a gap.
pub fn section_heights() -> Vec<usize> {
    SECTIONS
        .iter()
        .map(|section| section.rows.len() + 2)
        .collect()
}

/// The widest key column, so the sheet can be laid out in one pass.
pub fn key_column_width() -> usize {
    SECTIONS
        .iter()
        .flat_map(|section| section.rows.iter())
        .map(|(keys, _)| keys.chars().count())
        .max()
        .unwrap_or(0)
}

/// The narrowest column that still shows every description in full. A second
/// column is only worth opening when there is room for one of these.
pub fn column_width() -> usize {
    let widest = SECTIONS
        .iter()
        .flat_map(|section| section.rows.iter())
        .map(|(_, description)| description.chars().count())
        .max()
        .unwrap_or(0);
    key_column_width() + 2 + widest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sheet_covers_every_group_of_keys() {
        let titles: Vec<&str> = SECTIONS.iter().map(|section| section.title).collect();
        assert_eq!(
            titles,
            vec!["Move", "Look", "Change", "Commands", "Sockets"]
        );
    }

    #[test]
    fn every_row_says_what_the_key_does() {
        for section in SECTIONS {
            for (keys, description) in section.rows {
                assert!(!keys.is_empty(), "a row in {} has no key", section.title);
                assert!(
                    !description.is_empty(),
                    "{keys} in {} has no description",
                    section.title
                );
            }
        }
    }

    #[test]
    fn a_section_is_as_tall_as_its_rows_plus_a_title_and_a_gap() {
        let heights = section_heights();
        assert_eq!(heights.len(), SECTIONS.len());
        for (height, section) in heights.iter().zip(SECTIONS) {
            assert_eq!(*height, section.rows.len() + 2);
        }
    }

    #[test]
    fn the_key_column_is_wide_enough_for_the_widest_key() {
        let widest = SECTIONS
            .iter()
            .flat_map(|section| section.rows.iter())
            .map(|(keys, _)| keys.chars().count())
            .max()
            .unwrap();
        assert_eq!(key_column_width(), widest);
    }

    #[test]
    fn a_column_is_wide_enough_for_the_longest_row_it_holds() {
        let width = column_width();
        for section in SECTIONS {
            for (keys, description) in section.rows {
                assert!(
                    keys.chars().count() + 2 + description.chars().count() <= width,
                    "{keys} does not fit"
                );
            }
        }
    }

    #[test]
    fn every_socket_the_board_can_draw_is_explained() {
        use crate::domain::types::NodeKind;
        let sockets = SECTIONS
            .iter()
            .find(|section| section.title == "Sockets")
            .expect("a sockets section");
        for kind in [
            NodeKind::Eligible,
            NodeKind::Completed,
            NodeKind::Blocked,
            NodeKind::Deferred,
        ] {
            assert!(
                sockets.rows.iter().any(|(keys, _)| *keys == kind.socket()),
                "{} is not explained",
                kind.socket()
            );
        }
    }
}
