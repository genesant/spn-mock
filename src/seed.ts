import db from "./db.js";
import { v4 as uuid } from "uuid";

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
// Tenants — mirror Wave's tenant structure
// ----------------------------------------------------------------

const tridentId = uuid();

db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run(
  tridentId,
  "Trident Sports Group"
);

console.log(`  Tenant: Trident Sports Group (${tridentId})`);

// ----------------------------------------------------------------
// Destinations — autoincrement integer IDs, names are labels
// ----------------------------------------------------------------

const destinations = [
  "Penn State Program",
  "Thunderhawk Athletics",
  "Crimson Ridge Athletics",
  "Pacific Crest Collective",
];

for (const name of destinations) {
  const info = db
    .prepare("INSERT INTO destinations (tenant_id, name) VALUES (?, ?)")
    .run(tridentId, name);
  console.log(`  Destination: ${name} (id: ${info.lastInsertRowid})`);
}

// ----------------------------------------------------------------
// API key — Wave's platform key
// ----------------------------------------------------------------

const apiKeyId = uuid();
const apiKey = `spn_test_${uuid().replace(/-/g, "")}`;

db.prepare(
  "INSERT INTO api_keys (id, key, label, webhook_url) VALUES (?, ?, ?, ?)"
).run(apiKeyId, apiKey, "Wave Media (dev)", "http://localhost:4000/webhooks/spn");

db.prepare(
  "INSERT INTO api_key_tenants (api_key_id, tenant_id) VALUES (?, ?)"
).run(apiKeyId, tridentId);

console.log("");
console.log("  +-----------------------------------------+");
console.log("  |  SPN Mock — Seed Complete               |");
console.log("  +-----------------------------------------+");
console.log(`  |  API Key: ${apiKey}`);
console.log(`  |  Webhook: http://localhost:4000/webhooks/spn`);
console.log("  +-----------------------------------------+");
console.log("");
console.log("  Add this to Wave's .env:");
console.log(`  SPN_API_KEY=${apiKey}`);
console.log(`  SPN_BASE_URL=http://localhost:4100`);
console.log("");
