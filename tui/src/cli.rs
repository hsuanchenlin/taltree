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
              anything else is YAML. Defaults to ./tree.yaml, then
              ~/.config/taltree/tree.yaml.

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
/// An explicit path always wins. Otherwise the first existing candidate is
/// taken, and when none exists the plan starts at `./tree.yaml`.
pub fn resolve_path(
    explicit: Option<&Path>,
    working_dir: &Path,
    config_dir: Option<&Path>,
    exists: &dyn Fn(&Path) -> bool,
) -> PathBuf {
    if let Some(path) = explicit {
        return path.to_path_buf();
    }
    let default = working_dir.join("tree.yaml");
    let mut candidates = vec![
        default.clone(),
        working_dir.join("tree.yml"),
        working_dir.join("tree.json"),
    ];
    if let Some(config) = config_dir {
        candidates.push(config.join("taltree/tree.yaml"));
        candidates.push(config.join("taltree/tree.yml"));
    }
    candidates
        .into_iter()
        .find(|candidate| exists(candidate))
        .unwrap_or(default)
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
            Path::new("/work"),
            Some(Path::new("/home/.config")),
            &present(&[]),
        );
        assert_eq!(path, PathBuf::from("/work/tree.yaml"));
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
