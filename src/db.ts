import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "spn.db");

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS destinations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id),
    name          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id            TEXT PRIMARY KEY,
    key           TEXT NOT NULL UNIQUE,
    label         TEXT NOT NULL,
    webhook_url   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_key_tenants (
    api_key_id    TEXT NOT NULL REFERENCES api_keys(id),
    tenant_id     TEXT NOT NULL REFERENCES tenants(id),
    PRIMARY KEY (api_key_id, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS checkout_sessions (
    id              TEXT PRIMARY KEY,
    destination_id  INTEGER NOT NULL REFERENCES destinations(id),
    amount_cents    INTEGER NOT NULL,
    fee_cents       INTEGER NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'usd',
    reference_id    TEXT,
    success_url     TEXT,
    cancel_url      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    charge_id       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS charges (
    id              TEXT PRIMARY KEY,
    destination_id  INTEGER NOT NULL REFERENCES destinations(id),
    session_id      TEXT REFERENCES checkout_sessions(id),
    amount_cents    INTEGER NOT NULL,
    fee_cents       INTEGER NOT NULL DEFAULT 0,
    net_cents       INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'usd',
    reference_id    TEXT,
    status          TEXT NOT NULL DEFAULT 'completed',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS refunds (
    id              TEXT PRIMARY KEY,
    charge_id       TEXT NOT NULL REFERENCES charges(id),
    amount_cents    INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'completed',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export default db;
