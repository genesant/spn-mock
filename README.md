# spn-mock

Stand-in for the Sport Pass NIL (SPN) payment provider: the `/v1` API a customer integrates with, the hosted
checkout page loaded in an iframe, webhooks with HMAC signatures, and a small backoffice to inspect and settle
payments. Express + SQLite.

## Run locally

```bash
pnpm install
pnpm seed      # creates tenant, destination and an API key; prints the values for the customer's .env
pnpm dev       # http://localhost:4100  (admin: http://localhost:4100/admin)
```

## Run in Docker

```bash
docker build -t spn-mock .
docker run -p 4100:4100 -v spn-data:/data \
  -e SPN_BASE_URL=http://localhost:4100 \
  -e SPN_WEBHOOK_URL=http://host.docker.internal:4000/webhooks/spn \
  spn-mock
```

The image runs the seed on every start and then the server. The seed is idempotent: existing data is kept,
the API key / webhook settings are (re)applied from the environment.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SPN_PORT` | `4100` | Listen port |
| `SPN_BASE_URL` | `http://localhost:4100` | Public URL of this service; used in `iframe_url` and by the checkout page |
| `SPN_DB_PATH` | `./spn.db` | SQLite file (in Docker: `/data/spn.db`, mount a volume) |
| `SPN_WEBHOOK_URL` | `http://localhost:4000/webhooks/spn` | Where `charge.*` events are POSTed |
| `SPN_SEED_API_KEY` | generated once | The customer's API key (`Authorization: Bearer …`) |
| `SPN_SEED_WEBHOOK_SECRET` | generated once | HMAC secret for the `SPN-Signature` header |
| `SPN_SEED_RESET=1` | — | Wipe all data before seeding (local development only) |

## Endpoints

- `GET /health` — liveness.
- `POST /v1/checkout-sessions`, `GET /v1/checkout-sessions/:id`, `GET /v1/charges`, `GET /v1/charges/:id`,
  `GET /v1/destinations`, `POST /v1/refunds`, `POST /v1/webhooks/test` — API key required.
- `GET /checkout/:sessionId` — checkout page for end users (public).
- `POST /v1/checkout-sessions/:id/complete` — called by the checkout page (public).
- `GET /admin`, `GET /admin/charges/:id`, `POST /admin/charges/:id/settle` — backoffice. **No built-in auth**:
  protect it at the edge (e.g. an ALB authentication rule) when exposing the service.
