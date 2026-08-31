//! Taltree: a local-first daily-budget dependency planner rendered as a
//! terminal talent tree.
//!
//! The crate is layered so the rules can be tested without a terminal:
//!
//! - [`domain`] holds the plan and every rule about it.
//! - [`persist`] reads and writes the person-owned YAML (and imports JSON).
//! - [`graph`] turns a plan into cells: layered layout, conduits, navigation,
//!   camera.
//! - [`ui`] is the ratatui application: modes, keys, and drawing.

pub mod cli;
pub mod domain;
pub mod graph;
pub mod persist;
pub mod ui;
