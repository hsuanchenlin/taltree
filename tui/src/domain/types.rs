//! The person-owned document and the vocabulary of [`CONTEXT.md`](../../../CONTEXT.md).
//!
//! Serde field names are the camelCase spelling the JSON plans of the web app
//! already use, so a `tree.json` written by the browser build imports unchanged.

use serde::{Deserialize, Serialize};

/// Longest accepted plan or node title, in characters.
pub const MAX_TITLE: usize = 200;
/// Highest accepted node cost, in points.
pub const MAX_COST: u32 = 99;
/// Highest accepted daily budget, in points.
pub const MAX_BUDGET: u32 = 99;
/// The only document version this build reads or writes.
pub const PLAN_VERSION: u32 = 1;

/// Whether a node is still open work or finished work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Open,
    Completed,
}

/// A single piece of work with a title, a point cost, and hard prerequisites.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanNode {
    pub id: String,
    pub title: String,
    /// Optional label putting this node in a named section of the list.
    ///
    /// Grouping is presentation, never scheduling: a group has no bearing on
    /// eligibility, budget, or what unlocks what. Sits beside the title rather than
    /// with the annotations so it stays visible in a hand-edited file whose `notes`
    /// run long.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub cost: u32,
    pub status: NodeStatus,
    /// The local calendar day this node was pushed off the frontier, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deferred_on: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_on: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prerequisite_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl PlanNode {
    /// A node with no prerequisites, no notes, and open status.
    pub fn open(id: impl Into<String>, title: impl Into<String>, cost: u32) -> Self {
        PlanNode {
            id: id.into(),
            title: title.into(),
            group: None,
            cost,
            status: NodeStatus::Open,
            deferred_on: None,
            completed_on: None,
            prerequisite_ids: Vec::new(),
            notes: None,
        }
    }

    /// The same node with the given prerequisites attached.
    pub fn requiring(mut self, ids: &[&str]) -> Self {
        self.prerequisite_ids = ids.iter().map(|id| (*id).to_string()).collect();
        self
    }

    /// The same node filed under a named group.
    pub fn grouped(mut self, group: impl Into<String>) -> Self {
        self.group = Some(group.into());
        self
    }

    /// The group label, or `None` when the node names one that is only whitespace.
    pub fn group_label(&self) -> Option<&str> {
        self.group
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
    }

    pub fn is_completed(&self) -> bool {
        self.status == NodeStatus::Completed
    }
}

/// The person's collection of nodes plus the current day's budget ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub version: u32,
    pub title: String,
    pub daily_budget: u32,
    pub active_date: String,
    pub spent_today: u32,
    #[serde(default)]
    pub nodes: Vec<PlanNode>,
}

impl Plan {
    pub fn node(&self, id: &str) -> Option<&PlanNode> {
        self.nodes.iter().find(|node| node.id == id)
    }

    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.nodes.iter().position(|node| node.id == id)
    }

    /// The still-open dependents that name `id` as a hard prerequisite.
    pub fn dependents_of<'a>(&'a self, id: &'a str) -> impl Iterator<Item = &'a PlanNode> + 'a {
        self.nodes
            .iter()
            .filter(move |node| node.prerequisite_ids.iter().any(|prereq| prereq == id))
    }
}

/// Why a command was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanErrorCode {
    NotFound,
    Cycle,
    Blocked,
    Invalid,
}

/// A refused command, carrying enough detail for the UI to explain it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanError {
    pub code: PlanErrorCode,
    pub message: String,
    pub node_id: Option<String>,
    /// The node ids forming the rejected cycle, prerequisite first.
    pub path: Vec<String>,
    pub waiting_on: Vec<NamedRef>,
}

impl PlanError {
    pub fn new(code: PlanErrorCode, message: impl Into<String>) -> Self {
        PlanError {
            code,
            message: message.into(),
            node_id: None,
            path: Vec::new(),
            waiting_on: Vec::new(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        PlanError::new(PlanErrorCode::Invalid, message)
    }

    pub fn about(mut self, node_id: impl Into<String>) -> Self {
        self.node_id = Some(node_id.into());
        self
    }
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for PlanError {}

pub type PlanResult<T> = Result<T, PlanError>;

/// A node referred to by name, for explanations the person can read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedRef {
    pub id: String,
    pub title: String,
}

impl From<&PlanNode> for NamedRef {
    fn from(node: &PlanNode) -> Self {
        NamedRef {
            id: node.id.clone(),
            title: node.title.clone(),
        }
    }
}

/// How a node stands today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Eligible,
    Deferred,
    Blocked,
    Completed,
}

impl NodeKind {
    pub fn label(self) -> &'static str {
        match self {
            NodeKind::Eligible => "Eligible",
            NodeKind::Deferred => "Deferred",
            NodeKind::Blocked => "Blocked",
            NodeKind::Completed => "Completed",
        }
    }

    /// The socket glyph a node of this kind wears on the board.
    pub fn socket(self) -> &'static str {
        match self {
            NodeKind::Eligible => "( )",
            NodeKind::Completed => "[*]",
            NodeKind::Blocked => "[ ]",
            NodeKind::Deferred => "[-]",
        }
    }
}

/// One node as it stands today, with the reason behind its kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeListing {
    pub node: PlanNode,
    pub kind: NodeKind,
    pub waiting_on: Vec<NamedRef>,
    pub exceeds_budget: bool,
}

/// The whole plan as it stands today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanView {
    pub plan: Plan,
    pub remaining: u32,
    pub listings: Vec<NodeListing>,
}

impl PlanView {
    pub fn frontier(&self) -> impl Iterator<Item = &NodeListing> {
        self.listings
            .iter()
            .filter(|listing| listing.kind == NodeKind::Eligible)
    }

    pub fn listing(&self, id: &str) -> Option<&NodeListing> {
        self.listings.iter().find(|listing| listing.node.id == id)
    }

    pub fn completed_count(&self) -> usize {
        self.listings
            .iter()
            .filter(|listing| listing.kind == NodeKind::Completed)
            .count()
    }
}

/// A dependent that would still be blocked after the selected node is completed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockedDependent {
    pub id: String,
    pub title: String,
    pub waiting_on: Vec<NamedRef>,
}

/// What completing one node right now would cost and unlock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChoiceExplanation {
    pub node: PlanNode,
    pub kind: NodeKind,
    pub remaining_budget: u32,
    pub fits_budget: bool,
    pub over_by: u32,
    pub immediate_unlocks: Vec<NamedRef>,
    pub still_blocked_dependents: Vec<BlockedDependent>,
    pub waiting_on: Vec<NamedRef>,
}

/// The fields a new node needs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NodeInput {
    pub title: String,
    pub cost: u32,
    pub prerequisite_ids: Vec<String>,
    /// The group a new node joins; a blank label means none.
    pub group: Option<String>,
}

/// The fields an edit may change; `None` leaves the field alone.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NodePatch {
    pub title: Option<String>,
    pub cost: Option<u32>,
    pub prerequisite_ids: Option<Vec<String>>,
    pub notes: Option<Option<String>>,
    /// `None` leaves the group alone; `Some(None)` or a blank label clears it.
    pub group: Option<Option<String>>,
}
