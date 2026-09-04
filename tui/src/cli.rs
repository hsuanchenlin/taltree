//! Turning `taltree [path]` into a plan file to open.
//!
//! The rules live here rather than in `main` so the search order can be tested
//! without a home directory or a working directory to stand in.

use std::path::{Path, PathBuf};

pub const USAGE: &str = "\
taltree - a local-first daily-budget planner, drawn as a talent tree

USAGE:
    taltree [OPTIONS] [PATH]

ARGS:
    <PATH>    Plan file to open. A .json path is read and written as JSON;
              anything else is YAML. With no path: the active plan set by
              `taltree load`, else ./tree.yaml, else ~/.config/taltree/tree.yaml.

OPTIONS:
    -e, --empty        Start a new plan empty instead of seeded with a demo
        --date <DAY>   Treat YYYY-MM-DD as today (for trying out rollover)
    -h, --help         Print this help
    -V, --version      Print the version

KEYS:
    Press ? inside the application for the full keybinding sheet.
";

/// What the command line asked for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Options {
    pub path: Option<PathBuf>,
    pub start_empty: bool,
    pub date: Option<String>,
    pub help: bool,
    pub version: bool,
}

/// Parse the arguments after the program name.
pub fn parse_args<I, S>(args: I) -> Result<Options, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut options = Options::default();
    let mut iterator = args.into_iter().peekable();
    while let Some(argument) = iterator.next() {
        let argument = argument.as_ref();
        match argument {
            "-h" | "--help" => options.help = true,
            "-V" | "--version" => options.version = true,
            "-e" | "--empty" => options.start_empty = true,
            "--date" => {
                let value = iterator
                    .next()
                    .ok_or_else(|| "--date needs a YYYY-MM-DD date.".to_string())?;
                let value = value.as_ref().to_string();
                if !crate::domain::clock::is_iso_date(&value) {
                    return Err(format!("\"{value}\" is not a YYYY-MM-DD date."));
                }
                options.date = Some(value);
            }
            _ if argument.starts_with('-') && argument != "-" => {
                return Err(format!("Unknown option \"{argument}\". Try --help."));
            }
            _ => {
                if options.path.is_some() {
                    return Err("Only one plan file can be opened at a time.".to_string());
                }
                options.path = Some(PathBuf::from(argument));
            }
        }
    }
    Ok(options)
}

/// Where the plan lives, given what exists on disk.
///
/// An explicit path always wins. The active plan comes next: it is set by an
/// explicit `taltree load`, so it outranks whatever happens to be in the working
/// directory, but never outranks a path typed on this command line. After that the
/// first existing candidate is taken, and when none exists the plan starts at
/// `./tree.yaml`.
pub fn resolve_path(
    explicit: Option<&Path>,
    active: Option<&Path>,
    working_dir: &Path,
    config_dir: Option<&Path>,
    exists: &dyn Fn(&Path) -> bool,
) -> PathBuf {
    if let Some(path) = explicit {
        return path.to_path_buf();
    }
    let default = working_dir.join("tree.yaml");
    let mut candidates = Vec::new();
    // A pointer at a plan that has been moved or deleted falls through to the
    // ordinary search rather than starting an empty document under its name.
    if let Some(path) = active {
        candidates.push(path.to_path_buf());
    }
    candidates.extend([
        default.clone(),
        working_dir.join("tree.yml"),
        working_dir.join("tree.json"),
    ]);
    if let Some(config) = config_dir {
        candidates.push(config.join("taltree/tree.yaml"));
        candidates.push(config.join("taltree/tree.yml"));
    }
    candidates
        .into_iter()
        .find(|candidate| exists(candidate))
        .unwrap_or(default)
}

/// The plan `taltree load` last pointed at, read from `<config>/taltree/active`.
///
/// The pointer is one line holding an absolute path, written by the Node launcher
/// ([`bin/lib/plans.mjs`](../../../bin/lib/plans.mjs)). A pointer that cannot be read
/// is no pointer: the plan is the person's, and a permissions problem on a bookmark
/// is not a reason to refuse to open anything at all.
pub fn active_plan_path(
    config_dir: Option<&Path>,
    read: &dyn Fn(&Path) -> Option<String>,
) -> Option<PathBuf> {
    let path = config_dir?.join("taltree/active");
    let text = read(&path)?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

/// `$XDG_CONFIG_HOME`, else `$HOME/.config`.
pub fn config_dir_from_env(xdg_config_home: Option<&str>, home: Option<&str>) -> Option<PathBuf> {
    if let Some(value) = xdg_config_home.filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(value));
    }
    home.filter(|value| !value.is_empty())
        .map(|value| Path::new(value).join(".config"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn present(paths: &[&str]) -> impl Fn(&Path) -> bool {
        let set: HashSet<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |path: &Path| set.contains(path)
    }

    #[test]
    fn no_arguments_means_defaults_everywhere() {
        assert_eq!(
            parse_args(Vec::<String>::new()).expect("parses"),
            Options::default()
        );
    }

    #[test]
    fn a_bare_path_is_the_plan_to_open() {
        let options = parse_args(["plans/today.yaml"]).expect("parses");
        assert_eq!(options.path, Some(PathBuf::from("plans/today.yaml")));
    }

    #[test]
    fn flags_are_recognised() {
        let options = parse_args(["--empty", "--date", "2026-08-31", "tree.yaml"]).expect("parses");
        assert!(options.start_empty);
        assert_eq!(options.date.as_deref(), Some("2026-08-31"));
        assert_eq!(options.path, Some(PathBuf::from("tree.yaml")));
    }

    #[test]
    fn a_bad_date_is_refused_before_the_terminal_is_touched() {
        assert!(parse_args(["--date", "yesterday"]).is_err());
        assert!(parse_args(["--date"]).is_err());
    }

    #[test]
    fn unknown_options_and_second_paths_are_refused() {
        assert!(parse_args(["--wat"]).is_err());
        assert!(parse_args(["one.yaml", "two.yaml"]).is_err());
    }

    #[test]
    fn an_explicit_path_wins_even_when_nothing_is_there() {
        let path = resolve_path(
            Some(Path::new("/elsewhere/plan.yaml")),
            None,
            Path::new("/work"),
            Some(Path::new("/home/.config")),
            &present(&["/work/tree.yaml"]),
        );
        assert_eq!(path, PathBuf::from("/elsewhere/plan.yaml"));
    }

    #[test]
    fn the_working_directory_plan_is_preferred_over_the_config_one() {
        let path = resolve_path(
            None,
            None,
            Path::new("/work"),
            Some(Path::new("/home/.config")),
            &present(&["/work/tree.yaml", "/home/.config/taltree/tree.yaml"]),
        );
        assert_eq!(path, PathBuf::from("/work/tree.yaml"));
    }

    #[test]
    fn a_json_plan_in_the_working_directory_is_found() {
        let path = resolve_path(
            None,
            None,
            Path::new("/work"),
            None,
            &present(&["/work/tree.json"]),
        );
        assert_eq!(path, PathBuf::from("/work/tree.json"));
    }

    #[test]
    fn the_config_plan_is_found_when_the_working_directory_has_none() {
        let path = resolve_path(
            None,
            None,
            Path::new("/work"),
            Some(Path::new("/home/.config")),
            &present(&["/home/.config/taltree/tree.yaml"]),
        );
        assert_eq!(path, PathBuf::from("/home/.config/taltree/tree.yaml"));
    }

    #[test]
    fn with_nothing_anywhere_the_plan_starts_in_the_working_directory() {
        let path = resolve_path(
            None,
            None,
            Path::new("/work"),
            Some(Path::new("/home/.config")),
            &present(&[]),
        );
        assert_eq!(path, PathBuf::from("/work/tree.yaml"));
    }

    #[test]
    fn the_active_plan_outranks_the_working_directory_but_not_an_explicit_path() {
        let active = PathBuf::from("/home/.config/taltree/plans/frontend.yaml");
        let present = present(&[
            "/work/tree.yaml",
            "/home/.config/taltree/plans/frontend.yaml",
        ]);
        assert_eq!(
            resolve_path(
                None,
                Some(&active),
                Path::new("/work"),
                Some(Path::new("/home/.config")),
                &present,
            ),
            active
        );
        assert_eq!(
            resolve_path(
                Some(Path::new("/work/tree.yaml")),
                Some(&active),
                Path::new("/work"),
                Some(Path::new("/home/.config")),
                &present,
            ),
            PathBuf::from("/work/tree.yaml")
        );
    }

    #[test]
    fn an_active_plan_that_is_gone_falls_through_to_the_ordinary_search() {
        let path = resolve_path(
            None,
            Some(Path::new("/home/.config/taltree/plans/deleted.yaml")),
            Path::new("/work"),
            Some(Path::new("/home/.config")),
            &present(&["/work/tree.yaml"]),
        );
        assert_eq!(path, PathBuf::from("/work/tree.yaml"));
    }

    #[test]
    fn the_active_pointer_is_one_line_holding_a_path() {
        let read = |path: &Path| {
            (path == Path::new("/home/.config/taltree/active"))
                .then(|| "  /plans/frontend.yaml\n".to_string())
        };
        assert_eq!(
            active_plan_path(Some(Path::new("/home/.config")), &read),
            Some(PathBuf::from("/plans/frontend.yaml"))
        );
        assert_eq!(active_plan_path(None, &read), None);
        assert_eq!(
            active_plan_path(Some(Path::new("/elsewhere")), &read),
            None,
            "no pointer file means no active plan"
        );
        assert_eq!(
            active_plan_path(Some(Path::new("/home/.config")), &|_| Some(
                "  \n".to_string()
            )),
            None,
            "an empty pointer means no active plan"
        );
    }

    #[test]
    fn the_config_directory_follows_xdg_then_home() {
        assert_eq!(
            config_dir_from_env(Some("/xdg"), Some("/home/person")),
            Some(PathBuf::from("/xdg"))
        );
        assert_eq!(
            config_dir_from_env(Some(""), Some("/home/person")),
            Some(PathBuf::from("/home/person/.config"))
        );
        assert_eq!(config_dir_from_env(None, None), None);
    }
}
