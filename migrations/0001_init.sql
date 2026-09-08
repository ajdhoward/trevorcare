-- Trevorcare — D1 initial schema (converted 1:1 from prisma/schema.prisma)
-- All statements are idempotent (IF NOT EXISTS) so re-running is safe.
-- Conventions: TEXT ids (cuid/uuid generated in the Worker), TEXT datetimes
-- (ISO-8601), INTEGER booleans, REAL floats. Snake_case columns; the Worker's
-- data layer maps rows back to the camelCase JSON the client expects.

-- ---------------------------------------------------------------------------
-- Core auth/audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer', -- viewer | editor | admin (CF Access auto-provision)
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  author_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS signin_log (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  ok INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_signin_log_ts ON signin_log (ts);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  prev_hmac TEXT NOT NULL DEFAULT '',
  hmac TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log (ts);

-- Worker-managed secrets (auto-generated on first run, persist across deploys)
CREATE TABLE IF NOT EXISTS app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- Ingestion — WhatsApp (Whapi) + email
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inbound_messages (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  group_id TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  sender TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  msg_id TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL DEFAULT '',
  processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_source_msg ON inbound_messages (source, msg_id);
CREATE INDEX IF NOT EXISTS idx_inbound_ts ON inbound_messages (ts);

-- ---------------------------------------------------------------------------
-- Sharing
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'summary',
  created_at TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT
);

-- ---------------------------------------------------------------------------
-- AI feedback loop
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_feedback (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  raw TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'received',
  created_at TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- Service users (care subjects), vault, facts, finances
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS care_subjects (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT '',
  setting TEXT NOT NULL DEFAULT 'home',
  date_of_birth TEXT NOT NULL DEFAULT '',
  nhs_number TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS vault_documents (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  sensitivity TEXT NOT NULL DEFAULT 'standard',
  data TEXT NOT NULL DEFAULT '',      -- small-payload fallback (base64)
  r2_key TEXT NOT NULL DEFAULT '',    -- R2 object key when stored in DOCUMENTS
  text_extract TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS extracted_facts (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL DEFAULT '',
  document_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS finance_entries (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  receipt_id TEXT NOT NULL DEFAULT '',
  opg_reportable INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- Wizard framework (wizards are DATA, editable in Wizard Studio)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wizard_defs (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  system INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- PIM integrations, MCP research
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pim_integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'calendar',
  status TEXT NOT NULL DEFAULT 'disconnected',
  account TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  token TEXT NOT NULL DEFAULT '',
  last_sync_at TEXT,
  last_result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pim_provider_kind ON pim_integrations (provider, kind);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  tools TEXT NOT NULL DEFAULT '[]',
  last_test_at TEXT,
  last_result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  grounding REAL,
  summary TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  log TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS research_claims (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  text TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  verdict TEXT NOT NULL DEFAULT 'unverified',
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT ''
);
