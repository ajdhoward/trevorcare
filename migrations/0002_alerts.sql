-- 0002_alerts.sql — alert rules + computed events.
--
-- The scheduled handler (crons 0 8 * * *, 0 20 * * *) evaluates every enabled
-- rule against live data and records the computed state as an alert_event.
-- All statements are idempotent (IF NOT EXISTS) so re-running is safe.

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,                  -- no-checkin | call-spike | stale-data
  config TEXT NOT NULL DEFAULT '{}',   -- JSON: {hours} / {minutes,threshold} / {days}
  channel TEXT NOT NULL DEFAULT 'inbox',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_state TEXT NOT NULL DEFAULT '', -- last computed state: ok | warning | alert
  last_run_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  subject_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,                 -- ok | warning | alert
  detail TEXT NOT NULL DEFAULT '{}',   -- JSON snapshot of the evaluation
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events (rule_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules (enabled);
