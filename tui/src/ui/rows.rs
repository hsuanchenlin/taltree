//! The list panel as data: node rows with the group headers that separate them.
//!
//! Grouping is a property of the document, not of today, so it is drawn where the
//! document's own order can carry it: a header appears wherever the group label
//! changes from one listing to the next. Nothing is reordered - a person who wrote
//! their plan in a deliberate order keeps it, and an imported plan already arrives
//! with each group's nodes together.
//!
//! Headers are rows on the screen and nothing else. Selection walks
//! [`crate::domain::types::NodeListing`]s ([`crate::ui::app::App::list_step`]), so a
//! header can never be selected, completed, or deferred; this module only says where
//! one goes and how far to scroll past it.

use crate::domain::types::NodeListing;

/// One line of the list panel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListRow {
    /// A group's name, drawn as a separator above the nodes that carry it.
    Header(String),
    /// A node, at its index in the listings it came from.
    Node(usize),
}

/// The list panel's rows, in the order they are drawn.
pub fn list_rows(listings: &[NodeListing]) -> Vec<ListRow> {
    let mut rows = Vec::with_capacity(listings.len());
    let mut current: Option<&str> = None;
    let mut opened = false;
    for (index, listing) in listings.iter().enumerate() {
        let group = listing.node.group_label();
        if group != current {
            // A run of ungrouped nodes needs no heading of its own, but once a group
            // has been opened, leaving it does: without that the nodes after a group
            // read as if they were still inside it.
            if let Some(label) = group {
                rows.push(ListRow::Header(label.to_string()));
                opened = true;
            } else if opened {
                rows.push(ListRow::Header(UNGROUPED.to_string()));
            }
            current = group;
        }
        rows.push(ListRow::Node(index));
    }
    rows
}

/// The heading over nodes that name no group, once some other group has been drawn.
pub const UNGROUPED: &str = "Ungrouped";

/// Where in `rows` the node at `listing_index` is drawn.
pub fn row_of_node(rows: &[ListRow], listing_index: usize) -> Option<usize> {
    rows.iter()
        .position(|row| matches!(row, ListRow::Node(index) if *index == listing_index))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::{NodeKind, PlanNode};

    fn listing(id: &str, group: Option<&str>) -> NodeListing {
        let mut node = PlanNode::open(id, id, 1);
        node.group = group.map(str::to_string);
        NodeListing {
            node,
            kind: NodeKind::Eligible,
            waiting_on: Vec::new(),
            exceeds_budget: false,
        }
    }

    fn labels(rows: &[ListRow]) -> Vec<String> {
        rows.iter()
            .map(|row| match row {
                ListRow::Header(label) => format!("# {label}"),
                ListRow::Node(index) => index.to_string(),
            })
            .collect()
    }

    #[test]
    fn a_plan_with_no_groups_is_the_list_it_always_was() {
        let listings = vec![listing("a", None), listing("b", None)];
        assert_eq!(
            list_rows(&listings),
            vec![ListRow::Node(0), ListRow::Node(1)]
        );
    }

    #[test]
    fn a_header_opens_each_run_of_a_group() {
        let listings = vec![
            listing("a", Some("Basics")),
            listing("b", Some("Basics")),
            listing("c", Some("Advanced")),
        ];
        assert_eq!(
            labels(&list_rows(&listings)),
            ["# Basics", "0", "1", "# Advanced", "2"]
        );
    }

    #[test]
    fn leaving_a_group_is_headed_too_so_the_rest_is_not_read_as_part_of_it() {
        let listings = vec![
            listing("a", Some("Basics")),
            listing("b", None),
            listing("c", None),
        ];
        assert_eq!(
            labels(&list_rows(&listings)),
            ["# Basics", "0", "# Ungrouped", "1", "2"]
        );
    }

    #[test]
    fn ungrouped_nodes_before_the_first_group_need_no_heading() {
        let listings = vec![listing("a", None), listing("b", Some("Basics"))];
        assert_eq!(labels(&list_rows(&listings)), ["0", "# Basics", "1"]);
    }

    #[test]
    fn a_group_the_document_names_twice_is_headed_twice_rather_than_reordered() {
        let listings = vec![
            listing("a", Some("Basics")),
            listing("b", Some("Advanced")),
            listing("c", Some("Basics")),
        ];
        assert_eq!(
            labels(&list_rows(&listings)),
            ["# Basics", "0", "# Advanced", "1", "# Basics", "2"]
        );
    }

    #[test]
    fn a_blank_group_label_is_no_group_at_all() {
        let listings = vec![listing("a", Some("   ")), listing("b", None)];
        assert_eq!(
            list_rows(&listings),
            vec![ListRow::Node(0), ListRow::Node(1)]
        );
    }

    #[test]
    fn a_node_can_be_found_at_the_row_it_is_drawn_on() {
        let listings = vec![listing("a", Some("Basics")), listing("b", Some("Advanced"))];
        let rows = list_rows(&listings);
        assert_eq!(row_of_node(&rows, 0), Some(1));
        assert_eq!(row_of_node(&rows, 1), Some(3));
        assert_eq!(row_of_node(&rows, 2), None);
    }
}
