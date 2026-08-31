//! `taltree` - open a plan and draw it as a talent tree.

use std::io::{self, Stdout};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use crossterm::event::{self, Event};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use taltree::cli::{self, Options, USAGE};
use taltree::domain::clock::{Clock, FrozenClock, SystemClock};
use taltree::domain::plan::empty_plan;
use taltree::domain::seed::demo_plan;
use taltree::domain::types::Plan;
use taltree::persist::store::{load, FileStore, Loaded};
use taltree::ui::app::{App, Status};
use taltree::ui::{keys, render};

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let options = match cli::parse_args(&arguments) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("taltree: {message}");
            return ExitCode::FAILURE;
        }
    };
    if options.help {
        print!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    if options.version {
        println!("taltree {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }

    match start(options) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("taltree: {message}");
            ExitCode::FAILURE
        }
    }
}

fn start(options: Options) -> Result<(), String> {
    let clock: Box<dyn Clock> = match &options.date {
        Some(date) => Box::new(FrozenClock::new(date)),
        None => Box::new(SystemClock),
    };
    let path = resolve(&options);
    let opened = open_plan(&path, options.start_empty, clock.as_ref())?;

    let mut app = App::new(opened.plan, clock, Box::new(FileStore::new(&path)));
    app.status = opened.status;

    let mut terminal = enter_terminal().map_err(|error| error.to_string())?;
    let outcome = run(&mut terminal, &mut app);
    leave_terminal(&mut terminal).map_err(|error| error.to_string())?;
    outcome.map_err(|error| error.to_string())
}

fn resolve(options: &Options) -> PathBuf {
    let working_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let config_dir = cli::config_dir_from_env(
        std::env::var("XDG_CONFIG_HOME").ok().as_deref(),
        std::env::var("HOME").ok().as_deref(),
    );
    cli::resolve_path(
        options.path.as_deref(),
        &working_dir,
        config_dir.as_deref(),
        &|candidate: &Path| candidate.exists(),
    )
}

struct Opened {
    plan: Plan,
    status: Status,
}

fn open_plan(path: &Path, start_empty: bool, clock: &dyn Clock) -> Result<Opened, String> {
    match load(path).map_err(|error| error.message)? {
        Loaded::Existing(plan) => Ok(Opened {
            plan,
            status: Status::info(format!("{} · ? for keys", path.display())),
        }),
        Loaded::Imported { plan, from } => Ok(Opened {
            plan,
            status: Status::good(format!(
                "Imported {}. Saving writes {}.",
                from.display(),
                path.display()
            )),
        }),
        Loaded::Missing if start_empty => Ok(Opened {
            plan: empty_plan(clock, "My plan"),
            status: Status::info(format!("New plan. It will be saved to {}.", path.display())),
        }),
        Loaded::Missing => Ok(Opened {
            plan: demo_plan(clock),
            status: Status::info(format!(
                "Starter plan. Any change saves it to {}. Press ? for keys.",
                path.display()
            )),
        }),
    }
}

type Backend = CrosstermBackend<Stdout>;

fn enter_terminal() -> io::Result<Terminal<Backend>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    install_panic_hook();
    Terminal::new(CrosstermBackend::new(stdout))
}

fn leave_terminal(terminal: &mut Terminal<Backend>) -> io::Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()
}

/// Put the terminal back before a panic prints, or the message lands in the
/// alternate screen and disappears with it.
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
        previous(info);
    }));
}

fn run(terminal: &mut Terminal<Backend>, app: &mut App) -> io::Result<()> {
    while !app.should_quit {
        terminal.draw(|frame| render::draw(frame, app))?;
        match event::read()? {
            Event::Key(key) => {
                let action = keys::map(&app.mode, key);
                app.apply(action);
            }
            Event::Resize(_, _) => {}
            _ => {}
        }
    }
    Ok(())
}
