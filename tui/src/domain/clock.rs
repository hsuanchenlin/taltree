//! The one place the application asks what today is.
//!
//! Every rule that depends on the calendar takes a `&dyn Clock`, so tests can
//! walk a plan across midnight without waiting for one.

/// Answers "what is today's local calendar date", as `YYYY-MM-DD`.
pub trait Clock {
    fn today(&self) -> String;
}

/// The real local calendar day.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn today(&self) -> String {
        chrono::Local::now().format("%Y-%m-%d").to_string()
    }
}

/// A clock stuck on one day, for tests and for `--date`.
#[derive(Debug, Clone)]
pub struct FrozenClock(String);

impl FrozenClock {
    pub fn new(date: impl Into<String>) -> Self {
        FrozenClock(date.into())
    }
}

impl Clock for FrozenClock {
    fn today(&self) -> String {
        self.0.clone()
    }
}

/// A plan needs synchronization when its recorded day no longer matches the clock.
pub fn day_has_changed(clock: &dyn Clock, active_date: &str) -> bool {
    clock.today() != active_date
}

/// A real calendar day rewritten as zero-padded `YYYY-MM-DD`, or `None`.
///
/// Dates are compared as strings everywhere else, so a hand-written `2026-8-31`
/// has to become `2026-08-31` on the way in or it would silently never match
/// today.
pub fn normalize_iso_date(value: &str) -> Option<String> {
    chrono::NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .ok()
        .map(|date| date.format("%Y-%m-%d").to_string())
}

/// True for a value [`normalize_iso_date`] accepts.
pub fn is_iso_date(value: &str) -> bool {
    normalize_iso_date(value).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frozen_clock_repeats_its_day() {
        let clock = FrozenClock::new("2026-08-31");
        assert_eq!(clock.today(), "2026-08-31");
        assert_eq!(clock.today(), "2026-08-31");
    }

    #[test]
    fn day_change_compares_the_plan_day_with_the_clock() {
        let clock = FrozenClock::new("2026-09-01");
        assert!(day_has_changed(&clock, "2026-08-31"));
        assert!(!day_has_changed(&clock, "2026-09-01"));
    }

    #[test]
    fn system_clock_reports_an_iso_date() {
        assert!(is_iso_date(&SystemClock.today()));
    }

    #[test]
    fn iso_date_rejects_nonsense_and_impossible_days() {
        assert!(is_iso_date("2026-02-28"));
        assert!(!is_iso_date("2026-02-30"));
        assert!(!is_iso_date("tomorrow"));
        assert!(!is_iso_date("2026-08-31 and more"));
    }

    #[test]
    fn a_hand_written_date_is_padded_so_it_can_match_today() {
        assert_eq!(
            normalize_iso_date("2026-8-31").as_deref(),
            Some("2026-08-31")
        );
        assert_eq!(
            normalize_iso_date("  2026-08-31  ").as_deref(),
            Some("2026-08-31")
        );
        assert_eq!(normalize_iso_date("2026-02-30"), None);
    }
}
