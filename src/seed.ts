import db from "./db.js";
import { v4 as uuid } from "uuid";
import { randomBytes } from "node:crypto";

// ----------------------------------------------------------------
// Idempotent seed. Safe to run on every start:
//   - creates the tenant, destination and Wave API key if missing
//   - keeps existing sessions, charges and refunds
//   - re-applies the API key, webhook secret and webhook URL from env,
//     so a deployment can pin them in a secret store instead of copying
//     freshly generated values around
//
// Env (all optional):
//   SPN_SEED_API_KEY          Wave's API key      (default: generated once)
//   SPN_SEED_WEBHOOK_SECRET   HMAC secret         (default: generated once)
//   SPN_WEBHOOK_URL           where charge.* events are POSTed
//                             (default: http://localhost:4000/webhooks/spn)
//   SPN_SEED_RESET=1          wipe all data first (local development)
// ----------------------------------------------------------------

const TENANT_NAME = "Blueprint Sports and Entertainment LLC";
const DESTINATION_NAME = "Happy Valley United";
const KEY_LABEL = "Wave Media";
const WEBHOOK_URL = process.env.SPN_WEBHOOK_URL || "http://localhost:4000/webhooks/spn";

if (process.env.SPN_SEED_RESET === "1") {
  db.exec(`
    DELETE FROM refunds;
    DELETE FROM charges;
    DELETE FROM checkout_sessions;
    DELETE FROM api_key_tenants;
    DELETE FROM api_keys;
    DELETE FROM destinations;
    DELETE FROM tenants;
  `);
  console.log("  Existing data removed (SPN_SEED_RESET=1)");
}

// ----------------------------------------------------------------
// Tenant — mirrors Wave's tenant structure
// ----------------------------------------------------------------

let tenant = db.prepare("SELECT id FROM tenants WHERE name = ?").get(TENANT_NAME) as { id: string } | undefined;
if (!tenant) {
  tenant = { id: uuid() };
  db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run(tenant.id, TENANT_NAME);
  console.log(`  Tenant created: ${TENANT_NAME} (${tenant.id})`);
} else {
  console.log(`  Tenant exists:  ${TENANT_NAME} (${tenant.id})`);
}

// ----------------------------------------------------------------
// Destination — one per Wave property that needs checkout
// ----------------------------------------------------------------

let destination = db
  .prepare("SELECT id FROM destinations WHERE tenant_id = ? AND name = ?")
  .get(tenant.id, DESTINATION_NAME) as { id: number } | undefined;
if (!destination) {
  const info = db.prepare("INSERT INTO destinations (tenant_id, name) VALUES (?, ?)").run(tenant.id, DESTINATION_NAME);
  destination = { id: Number(info.lastInsertRowid) };
  console.log(`  Destination created: ${DESTINATION_NAME} (id: ${destination.id})`);
} else {
  console.log(`  Destination exists:  ${DESTINATION_NAME} (id: ${destination.id})`);
}

// ----------------------------------------------------------------
// API key + webhook secret (upsert; env values win)
// ----------------------------------------------------------------

const existingKey = db
  .prepare("SELECT id, key, webhook_secret FROM api_keys WHERE label LIKE ? ORDER BY created_at LIMIT 1")
  .get(`${KEY_LABEL}%`) as { id: string; key: string; webhook_secret: string | null } | undefined;

const apiKey = process.env.SPN_SEED_API_KEY || existingKey?.key || `spn_test_${uuid().replace(/-/g, "")}`;
const webhookSecret =
  process.env.SPN_SEED_WEBHOOK_SECRET || existingKey?.webhook_secret || `whsec_${randomBytes(24).toString("hex")}`;

let apiKeyId: string;
if (!existingKey) {
  apiKeyId = uuid();
  db.prepare("INSERT INTO api_keys (id, key, label, webhook_url, webhook_secret) VALUES (?, ?, ?, ?, ?)").run(
    apiKeyId,
    apiKey,
    KEY_LABEL,
    WEBHOOK_URL,
    webhookSecret,
  );
  console.log("  API key created");
} else {
  apiKeyId = existingKey.id;
  db.prepare("UPDATE api_keys SET key = ?, webhook_url = ?, webhook_secret = ? WHERE id = ?").run(
    apiKey,
    WEBHOOK_URL,
    webhookSecret,
    apiKeyId,
  );
  console.log("  API key updated");
}

db.prepare("INSERT OR IGNORE INTO api_key_tenants (api_key_id, tenant_id) VALUES (?, ?)").run(apiKeyId, tenant.id);

// ----------------------------------------------------------------
// Summary. Secrets are printed only when generated here — a deployment
// that passes them via env already knows them.
// ----------------------------------------------------------------

const fromEnv = Boolean(process.env.SPN_SEED_API_KEY && process.env.SPN_SEED_WEBHOOK_SECRET);
console.log("");
console.log("  +-----------------------------------------+");
console.log("  |  SPN Mock — Seed Complete               |");
console.log("  +-----------------------------------------+");
console.log(`  |  Webhook URL: ${WEBHOOK_URL}`);
if (fromEnv) {
  console.log("  |  API key / webhook secret: from environment");
} else {
  console.log(`  |  API Key:        ${apiKey}`);
  console.log(`  |  Webhook Secret: ${webhookSecret}`);
  console.log("  +-----------------------------------------+");
  console.log("");
  console.log("  Add this to Wave's .env:");
  console.log(`  SPN_API_KEY=${apiKey}`);
  console.log(`  SPN_BASE_URL=${process.env.SPN_BASE_URL || "http://localhost:4100"}`);
  console.log(`  SPN_WEBHOOK_SECRET=${webhookSecret}`);
}
console.log("");
