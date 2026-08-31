//! Getting a plan off disk and back onto it without ever leaving a half-written
//! file behind.
//!
//! Saves are written to a sibling temporary file and renamed into place, so an
//! interrupted save leaves the previous plan intact rather than a truncated one.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::domain::types::{Plan, PlanError, PlanResult};

use super::{json, yaml};

/// What was found at the requested path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Loaded {
    /// The file was there and readable.
    Existing(Plan),
    /// No YAML plan was there, but a `tree.json` beside it was imported.
    Imported { plan: Plan, from: PathBuf },
    /// Nothing to read yet.
    Missing,
}

/// Read the plan at `path`, importing a sibling JSON plan if that is all there is.
pub fn load(path: &Path) -> PlanResult<Loaded> {
    if let Some(text) = read_if_present(path)? {
        let plan = parse_for(path, &text)?;
        return Ok(Loaded::Existing(plan));
    }
    if let Some(sibling) = json_sibling(path) {
        if let Some(text) = read_if_present(&sibling)? {
            let plan = json::from_json(&text)?;
            return Ok(Loaded::Imported {
                plan,
                from: sibling,
            });
        }
    }
    Ok(Loaded::Missing)
}

/// Parse `text` the way `path`'s extension asks for.
pub fn parse_for(path: &Path, text: &str) -> PlanResult<Plan> {
    if has_extension(path, "json") {
        json::from_json(text)
    } else {
        yaml::from_yaml(text)
    }
}

/// Render `plan` the way `path`'s extension asks for.
pub fn render_for(path: &Path, plan: &Plan) -> String {
    if has_extension(path, "json") {
        json::to_json(plan)
    } else {
        yaml::to_yaml(plan)
    }
}

/// The `tree.json` beside a `tree.yaml`, when the path is not already JSON.
pub fn json_sibling(path: &Path) -> Option<PathBuf> {
    if has_extension(path, "json") {
        return None;
    }
    Some(path.with_extension("json"))
}

/// Somewhere a plan can be written.
pub trait PlanStore {
    fn save(&mut self, plan: &Plan) -> Result<(), String>;
    /// What to show the person when naming where their plan lives.
    fn location(&self) -> String;
}

/// A plan file on disk, written atomically.
#[derive(Debug, Clone)]
pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        FileStore { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl PlanStore for FileStore {
    fn save(&mut self, plan: &Plan) -> Result<(), String> {
        write_atomically(&self.path, &render_for(&self.path, plan))
            .map_err(|error| format!("Could not save {}: {error}", self.path.display()))
    }

    fn location(&self) -> String {
        self.path.display().to_string()
    }
}

/// A plan store that keeps every save in memory, for tests.
#[derive(Debug, Default, Clone)]
pub struct MemoryStore {
    pub saved: Vec<Plan>,
    pub fail_with: Option<String>,
}

impl PlanStore for MemoryStore {
    fn save(&mut self, plan: &Plan) -> Result<(), String> {
        if let Some(message) = &self.fail_with {
            return Err(message.clone());
        }
        self.saved.push(plan.clone());
        Ok(())
    }

    fn location(&self) -> String {
        "(memory)".to_string()
    }
}

/// Write `contents` to `path` through a temporary file in the same directory.
pub fn write_atomically(path: &Path, contents: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let temporary = temporary_beside(path);
    fs::write(&temporary, contents)?;
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

fn temporary_beside(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "tree.yaml".to_string());
    let stamp = std::process::id();
    path.with_file_name(format!(".{name}.{stamp}.tmp"))
}

fn read_if_present(path: &Path) -> PlanResult<Option<String>> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(PlanError::invalid(format!(
            "Could not read {}: {error}",
            path.display()
        ))),
    }
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .map(|found| found.eq_ignore_ascii_case(extension))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clock::FrozenClock;
    use crate::domain::seed::demo_plan;

    fn demo() -> Plan {
        demo_plan(&FrozenClock::new("2026-08-31"))
    }

    #[test]
    fn a_missing_file_with_no_json_beside_it_reports_nothing_to_read() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(
            load(&dir.path().join("tree.yaml")).expect("load"),
            Loaded::Missing
        );
    }

    #[test]
    fn a_saved_plan_reads_back_from_disk() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("tree.yaml");
        let mut store = FileStore::new(&path);
        store.save(&demo()).expect("save");
        assert_eq!(load(&path).expect("load"), Loaded::Existing(demo()));
    }

    #[test]
    fn saving_creates_the_directories_the_path_names() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("nested/deeper/tree.yaml");
        FileStore::new(&path).save(&demo()).expect("save");
        assert!(path.exists());
    }

    #[test]
    fn saving_leaves_no_temporary_files_behind() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("tree.yaml");
        FileStore::new(&path).save(&demo()).expect("save");
        let names: Vec<String> = fs::read_dir(dir.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert_eq!(names, vec!["tree.yaml".to_string()]);
    }

    #[test]
    fn a_json_plan_beside_a_missing_yaml_one_is_imported() {
        let dir = tempfile::tempdir().expect("temp dir");
        let yaml_path = dir.path().join("tree.yaml");
        let json_path = dir.path().join("tree.json");
        fs::write(&json_path, json::to_json(&demo())).expect("write json");

        match load(&yaml_path).expect("load") {
            Loaded::Imported { plan, from } => {
                assert_eq!(plan, demo());
                assert_eq!(from, json_path);
            }
            other => panic!("expected an import, got {other:?}"),
        }
    }

    #[test]
    fn a_json_path_is_read_and_written_as_json() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("tree.json");
        FileStore::new(&path).save(&demo()).expect("save");
        let text = fs::read_to_string(&path).expect("read");
        assert!(text.starts_with('{'), "{text}");
        assert_eq!(load(&path).expect("load"), Loaded::Existing(demo()));
    }

    #[test]
    fn a_json_path_never_imports_itself() {
        assert_eq!(json_sibling(Path::new("/plans/tree.json")), None);
        assert_eq!(
            json_sibling(Path::new("/plans/tree.yaml")),
            Some(PathBuf::from("/plans/tree.json"))
        );
    }

    #[test]
    fn an_unreadable_document_is_reported_rather_than_swallowed() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("tree.yaml");
        fs::write(&path, "version: 9\ntitle: Nope\ndailyBudget: 1\nactiveDate: 2026-08-31\nspentToday: 0\nnodes: []\n")
            .expect("write");
        let error = load(&path).expect_err("refused");
        assert!(error.message.contains("version 9"), "{}", error.message);
    }

    #[test]
    fn the_memory_store_records_every_save() {
        let mut store = MemoryStore::default();
        store.save(&demo()).expect("save");
        store.save(&demo()).expect("save");
        assert_eq!(store.saved.len(), 2);
    }
}
