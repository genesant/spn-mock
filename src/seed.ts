import db from "./db.js";
import { v4 as uuid } from "uuid";
import { randomBytes } from "node:crypto";

// ----------------------------------------------------------------
// Clear existing data
// ----------------------------------------------------------------

db.exec(`
  DELETE FROM refunds;
  DELETE FROM charges;
  DELETE FROM checkout_sessions;
  DELETE FROM api_key_tenants;
  DELETE FROM api_keys;
  DELETE FROM destinations;
  DELETE FROM tenants;
`);

// ----------------------------------------------------------------
// Tenant — mirrors Wave's tenant structure
// ----------------------------------------------------------------

const blueprintId = uuid();

db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run(
  blueprintId,
  "Blueprint Sports and Entertainment LLC"
);

console.log(`  Tenant: Blueprint Sports and Entertainment LLC (${blueprintId})`);

// ----------------------------------------------------------------
// Destinations — one per Wave property that needs checkout
// ----------------------------------------------------------------

const info = db
  .prepare("INSERT INTO destinations (tenant_id, name) VALUES (?, ?)")
  .run(blueprintId, "Happy Valley United");
console.log(`  Destination: Happy Valley United (id: ${info.lastInsertRowid})`);

// ----------------------------------------------------------------
// API key + webhook secret
// ----------------------------------------------------------------

const apiKeyId = uuid();
const apiKey = `spn_test_${uuid().replace(/-/g, "")}`;
const webhookSecret = `whsec_${randomBytes(24).toString("hex")}`;

db.prepare(
  "INSERT INTO api_keys (id, key, label, webhook_url, webhook_secret) VALUES (?, ?, ?, ?, ?)"
).run(apiKeyId, apiKey, "Wave Media (dev)", "http://localhost:4000/webhooks/spn", webhookSecret);

db.prepare(
  "INSERT INTO api_key_tenants (api_key_id, tenant_id) VALUES (?, ?)"
).run(apiKeyId, blueprintId);

console.log("");
console.log("  +-----------------------------------------+");
console.log("  |  SPN Mock — Seed Complete               |");
console.log("  +-----------------------------------------+");
console.log(`  |  API Key:        ${apiKey}`);
console.log(`  |  Webhook Secret: ${webhookSecret}`);
console.log(`  |  Webhook URL:    http://localhost:4000/webhooks/spn`);
console.log("  +-----------------------------------------+");
console.log("");
console.log("  Add this to Wave's .env:");
console.log(`  SPN_API_KEY=${apiKey}`);
console.log(`  SPN_BASE_URL=http://localhost:4100`);
console.log(`  SPN_WEBHOOK_SECRET=${webhookSecret}`);
console.log("");