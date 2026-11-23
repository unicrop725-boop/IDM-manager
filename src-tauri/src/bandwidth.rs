//! Bandwidth control: limits by time of day and day of week, a "slow mode", and pausing on metered or hotspot
//! connections. The user's own global limit (Options > Connection) is the base; everything here can only make it
//! stricter, except a schedule window set to "no limit".

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::db::Db;
use crate::metered::{self, Network};
use flowget_engine::Engine;

const SETTING: &str = "bandwidth_policy";
const MIB: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RuleMode {
    /// Cap the speed during the window.
    #[default]
    Limit,
    /// Hold all downloads during the window.
    Pause,
    /// Ignore the global limit during the window (for example: full speed at night).
    Unlimited,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Rule {
    /// 0 = Sunday ... 6 = Saturday. Empty = every day.
    pub days: Vec<u8>,
    /// "HH:MM" (24 hour). A window that ends before it starts runs past midnight.
    pub start: String,
    pub end: String,
    pub mode: RuleMode,
    /// Bytes per second for `Limit`.
    pub limit_bps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Policy {
    pub rules: Vec<Rule>,
    /// Keep downloads gentle so browsing and calls are not disturbed.
    pub slow_mode: bool,
    pub slow_mode_bps: u64,
    /// Hold downloads on metered connections and listed hotspots.
    pub pause_on_metered: bool,
    /// Wi-Fi names that are phone hotspots even if Windows does not mark them metered.
    pub hotspot_names: Vec<String>,
}

impl Default for Policy {
    fn default() -> Self {
        Self { rules: Vec::new(), slow_mode: false, slow_mode_bps: MIB, pause_on_metered: false, hotspot_names: Vec::new() }
    }
}

fn minutes(hhmm: &str) -> Option<u16> {
    let (h, m) = hhmm.trim().split_once(':')?;
    let (h, m): (u16, u16) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

impl Rule {
    fn matches(&self, weekday: u8, now: u16) -> bool {
        let (Some(start), Some(end)) = (minutes(&self.start), minutes(&self.end)) else { return false };
        let on = |d: u8| self.days.is_empty() || self.days.contains(&d);
        if start == end {
            return on(weekday); // the whole day
        }
        if start < end {
            on(weekday) && now >= start && now < end
        } else {
            // Past midnight: the evening part belongs to the day the window starts, the morning part to the day after.
            (on(weekday) && now >= start) || (on((weekday + 6) % 7) && now < end)
        }
    }

    fn describe(&self) -> String {
        format!("{} {}–{}", day_names(&self.days), self.start, self.end)
    }
}

fn day_names(days: &[u8]) -> String {
    const N: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if days.is_empty() || days.len() == 7 {
        return "every day".into();
    }
    let mut d = days.to_vec();
    d.sort_unstable();
    d.dedup();
    d.iter().filter_map(|i| N.get(*i as usize)).copied().collect::<Vec<_>>().join(", ")
}

impl Policy {
    /// A message the user can act on, if something is wrong.
    pub fn validate(&self) -> Result<(), String> {
        for (i, r) in self.rules.iter().enumerate() {
            let n = i + 1;
            if minutes(&r.start).is_none() || minutes(&r.end).is_none() {
                return Err(format!("Schedule {n}: use times like 08:30 for start and end."));
            }
            if r.days.iter().any(|d| *d > 6) {
                return Err(format!("Schedule {n}: the days are not valid."));
            }
            if r.mode == RuleMode::Limit && r.limit_bps == 0 {
                return Err(format!("Schedule {n}: enter a speed limit above 0, or choose Pause or No limit."));
            }
        }
        if self.slow_mode_bps == 0 {
            return Err("Slow mode needs a speed above 0.".into());
        }
        Ok(())
    }
}

/// What the policy decides right now.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Effective {
    /// Global speed limit to apply (0 = none).
    pub limit_bps: u64,
    /// Downloads are held.
    pub paused: bool,
    /// One line for the status chip, e.g. "Slow mode · 1 MB/s".
    pub reason: Option<String>,
    pub slow_mode: bool,
    /// The pause comes from a metered connection (the user may override that one).
    pub metered_pause: bool,
}

fn stricter(current: u64, other: u64) -> u64 {
    match (current, other) {
        (0, o) => o,
        (c, 0) => c,
        (c, o) => c.min(o),
    }
}

fn speed_text(bps: u64) -> String {
    let mb = bps as f64 / MIB as f64;
    if mb >= 10.0 { format!("{mb:.0} MB/s") } else { format!("{mb:.1} MB/s") }
}

/// Decide the global limit and whether to hold downloads. `weekday`: 0 = Sunday; `now`: minutes since midnight.
pub fn effective(base_bps: u64, policy: &Policy, weekday: u8, now: u16, net: &Network, override_metered: bool) -> Effective {
    let mut out = Effective { limit_bps: base_bps, slow_mode: policy.slow_mode, ..Default::default() };

    if policy.pause_on_metered && !override_metered {
        if let Some(why) = net.restriction(&policy.hotspot_names) {
            out.paused = true;
            out.metered_pause = true;
            out.reason = Some(format!("Paused: {why}"));
            return out;
        }
    }

    let active: Vec<&Rule> = policy.rules.iter().filter(|r| r.matches(weekday, now)).collect();
    if let Some(r) = active.iter().find(|r| r.mode == RuleMode::Pause) {
        out.paused = true;
        out.reason = Some(format!("Paused by schedule ({})", r.describe()));
        return out;
    }

    let mut source: Option<String> = None;
    if active.iter().any(|r| r.mode == RuleMode::Unlimited) {
        out.limit_bps = 0;
        source = Some("No limit (schedule)".into());
    }
    for r in active.iter().filter(|r| r.mode == RuleMode::Limit) {
        let combined = stricter(out.limit_bps, r.limit_bps);
        if combined != out.limit_bps || source.is_none() || source.as_deref() == Some("No limit (schedule)") {
            source = Some(format!("Limited to {} ({})", speed_text(r.limit_bps), r.describe()));
        }
        out.limit_bps = combined;
    }
    if policy.slow_mode {
        let combined = stricter(out.limit_bps, policy.slow_mode_bps);
        out.limit_bps = combined;
        source = Some(format!("Slow mode · {}", speed_text(policy.slow_mode_bps)));
    }
    out.reason = source;
    out
}

pub async fn load_policy(db: &Db) -> Policy {
    db.get_setting(SETTING).await.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub async fn save_policy(db: &Db, policy: &Policy) -> Result<(), String> {
    policy.validate()?;
    let json = serde_json::to_string(policy).map_err(|e| e.to_string())?;
    db.set_setting(SETTING, &json).await.map_err(|e| format!("Could not save the settings: {e}"))
}

/// Applies the policy to the engine, continuously.
pub struct BandwidthManager {
    engine: Engine,
    db: Db,
    app: Option<AppHandle>,
    wake: Notify,
    override_metered: AtomicBool,
    /// Look at the network again on the next round (something changed).
    recheck: AtomicBool,
    /// Downloads this manager paused (so only those are resumed when the restriction ends).
    held: Mutex<HashSet<String>>,
    last: Mutex<Option<Effective>>,
    network: Mutex<Network>,
}

impl BandwidthManager {
    pub fn new(engine: Engine, db: Db, app: Option<AppHandle>) -> Arc<Self> {
        Arc::new(Self {
            engine,
            db,
            app,
            wake: Notify::new(),
            override_metered: AtomicBool::new(false),
            recheck: AtomicBool::new(true),
            held: Mutex::new(HashSet::new()),
            last: Mutex::new(None),
            network: Mutex::new(Network::default()),
        })
    }

    /// Re-evaluate right away (after the policy or the user's global limit changed).
    pub fn refresh(&self) {
        self.recheck.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }

    pub fn set_override(&self, on: bool) {
        self.override_metered.store(on, Ordering::SeqCst);
        self.refresh();
    }

    pub fn state(&self) -> Effective {
        self.last.lock().unwrap().clone().unwrap_or_default()
    }

    pub fn network(&self) -> Network {
        self.network.lock().unwrap().clone()
    }

    pub async fn run(self: Arc<Self>) {
        let mut checked = Instant::now() - Duration::from_secs(3600);
        loop {
            self.tick(&mut checked).await;
            let wait = if self.state().paused { 5 } else { 10 };
            tokio::select! {
                _ = self.wake.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(wait)) => {}
            }
        }
    }

    async fn tick(&self, checked: &mut Instant) {
        let policy = load_policy(&self.db).await;
        let force = self.recheck.swap(false, Ordering::SeqCst);
        if policy.pause_on_metered && (force || checked.elapsed() > Duration::from_secs(30)) {
            if let Ok(n) = tokio::task::spawn_blocking(metered::detect).await {
                *self.network.lock().unwrap() = n;
            }
            *checked = Instant::now();
        }
        let base = self.db.get_setting("global_speed_limit").await.and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        let (weekday, now) = {
            use chrono::{Datelike, Local, Timelike};
            let t = Local::now();
            (t.weekday().num_days_from_sunday() as u8, (t.hour() * 60 + t.minute()) as u16)
        };
        let net = self.network();
        let eff = effective(base, &policy, weekday, now, &net, self.override_metered.load(Ordering::SeqCst));

        self.engine.set_global_speed_limit(eff.limit_bps);
        if eff.paused {
            for d in self.engine.list().into_iter().filter(|d| d.state.is_active()) {
                if self.engine.pause(&d.id).await.is_ok() {
                    self.held.lock().unwrap().insert(d.id);
                }
            }
        } else {
            let ids: Vec<String> = self.held.lock().unwrap().drain().collect();
            for id in ids {
                if self.engine.info(&id).is_ok_and(|i| i.state == flowget_engine::DownloadState::Paused) {
                    let _ = self.engine.resume(&id).await;
                }
            }
        }

        let changed = self.last.lock().unwrap().as_ref() != Some(&eff);
        if changed {
            if let Some(app) = &self.app {
                let _ = app.emit("bandwidth-state", &eff);
            }
            *self.last.lock().unwrap() = Some(eff);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(days: &[u8], start: &str, end: &str, mode: RuleMode, mbps: u64) -> Rule {
        Rule { days: days.to_vec(), start: start.into(), end: end.into(), mode, limit_bps: mbps * MIB }
    }
    fn open() -> Network {
        Network::default()
    }
    fn at(h: u16, m: u16) -> u16 {
        h * 60 + m
    }

    #[test]
    fn a_weekday_daytime_window_limits_the_speed_only_inside_it() {
        let p = Policy { rules: vec![rule(&[1, 2, 3, 4, 5], "09:00", "17:00", RuleMode::Limit, 2)], ..Default::default() };
        let tue_noon = effective(0, &p, 2, at(12, 0), &open(), false);
        assert_eq!(tue_noon.limit_bps, 2 * MIB);
        assert!(tue_noon.reason.unwrap().contains("Limited to 2.0 MB/s"));
        assert_eq!(effective(0, &p, 2, at(17, 0), &open(), false).limit_bps, 0, "the end minute is outside");
        assert_eq!(effective(0, &p, 6, at(12, 0), &open(), false).limit_bps, 0, "Saturday is not in the schedule");
    }

    #[test]
    fn a_window_past_midnight_belongs_to_the_day_it_started() {
        // Friday 23:00 -> Saturday 06:00, pause.
        let p = Policy { rules: vec![rule(&[5], "23:00", "06:00", RuleMode::Pause, 0)], ..Default::default() };
        assert!(effective(0, &p, 5, at(23, 30), &open(), false).paused, "Friday late evening");
        assert!(effective(0, &p, 6, at(3, 0), &open(), false).paused, "Saturday early morning");
        assert!(!effective(0, &p, 5, at(3, 0), &open(), false).paused, "Friday early morning is the previous night's gap");
        assert!(!effective(0, &p, 6, at(7, 0), &open(), false).paused);
    }

    #[test]
    fn the_stricter_limit_wins_and_no_limit_windows_lift_the_global_one() {
        let night = rule(&[], "00:00", "06:00", RuleMode::Unlimited, 0);
        let p = Policy { rules: vec![night.clone()], ..Default::default() };
        // Global limit 1 MB/s, but at night the schedule lifts it.
        assert_eq!(effective(MIB, &p, 3, at(2, 0), &open(), false).limit_bps, 0);
        assert_eq!(effective(MIB, &p, 3, at(9, 0), &open(), false).limit_bps, MIB);

        // Limit rule and global limit: the smaller one applies.
        let p2 = Policy { rules: vec![rule(&[], "00:00", "00:00", RuleMode::Limit, 5)], ..Default::default() };
        assert_eq!(effective(2 * MIB, &p2, 1, at(10, 0), &open(), false).limit_bps, 2 * MIB);
        assert_eq!(effective(10 * MIB, &p2, 1, at(10, 0), &open(), false).limit_bps, 5 * MIB);
    }

    #[test]
    fn slow_mode_caps_the_speed_whatever_else_applies() {
        let p = Policy {
            slow_mode: true,
            slow_mode_bps: MIB / 2,
            rules: vec![rule(&[], "00:00", "06:00", RuleMode::Unlimited, 0)],
            ..Default::default()
        };
        let e = effective(0, &p, 3, at(2, 0), &open(), false);
        assert_eq!(e.limit_bps, MIB / 2);
        assert!(e.slow_mode && e.reason.unwrap().starts_with("Slow mode"));
    }

    #[test]
    fn metered_and_hotspot_connections_pause_until_the_user_overrides() {
        let p = Policy { pause_on_metered: true, hotspot_names: vec!["My Phone".into()], ..Default::default() };
        let metered = Network { metered: true, why: Some("Windows marks this connection as metered".into()), ssid: None };
        let e = effective(0, &p, 1, at(10, 0), &metered, false);
        assert!(e.paused && e.metered_pause && e.reason.unwrap().starts_with("Paused: "));

        let phone = Network { metered: false, why: None, ssid: Some("my phone".into()) };
        assert!(effective(0, &p, 1, at(10, 0), &phone, false).paused);

        assert!(!effective(0, &p, 1, at(10, 0), &metered, true).paused, "Download anyway");
        let off = Policy { pause_on_metered: false, ..p };
        assert!(!effective(0, &off, 1, at(10, 0), &metered, false).paused, "the switch is off");
    }

    #[test]
    fn mistakes_in_the_schedule_are_explained() {
        let bad_time = Policy { rules: vec![rule(&[], "9am", "17:00", RuleMode::Pause, 0)], ..Default::default() };
        assert!(bad_time.validate().unwrap_err().contains("08:30"));
        let bad_day = Policy { rules: vec![rule(&[9], "09:00", "17:00", RuleMode::Pause, 0)], ..Default::default() };
        assert!(bad_day.validate().is_err());
        let no_speed = Policy { rules: vec![rule(&[], "09:00", "17:00", RuleMode::Limit, 0)], ..Default::default() };
        assert!(no_speed.validate().unwrap_err().contains("speed limit"));
        assert!(Policy::default().validate().is_ok());
    }

    #[test]
    fn the_saved_form_round_trips() {
        let p = Policy { rules: vec![rule(&[1, 2], "08:00", "18:00", RuleMode::Limit, 3)], slow_mode: true, ..Default::default() };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"limitBps\"") && json.contains("\"mode\":\"limit\""));
        assert_eq!(serde_json::from_str::<Policy>(&json).unwrap(), p);
        // Old or partial settings still load.
        assert_eq!(serde_json::from_str::<Policy>("{}").unwrap(), Policy::default());
    }
}
