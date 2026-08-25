# Strava Auto-Message Service — Design

## Problem

Strava's public API does not allow apps to create comments on activities
(comment creation is not exposed; only reading comments is). The closest
automatable equivalent is editing the activity's **description** at upload
time. This project builds a small self-hosted service ("runsync") that
automatically appends a fixed message to the description of every new
Strava activity for a small set of athletes.

Out of scope: posting actual Strava comments (not possible via public API,
would require unofficial browser automation, explicitly rejected as too
brittle).

## Goals

- Automatically append a static message to the description of every new
  activity, for a handful of known Strava athletes (owner + a few others).
- Self-service connect flow so a new athlete can authorize the app without
  the owner doing manual token setup per person.
- Idempotent: an activity that gets edited later (title, description, etc.)
  and re-fires the webhook must not get the message appended twice.
- Runs continuously on the owner's existing VPS infrastructure, in Docker,
  matching the pattern of other self-hosted services there.

## Non-goals

- Templated/dynamic message content (distance, pace, weather, etc.) — text
  is static for v1. Swapping to a template is a future, separate change.
- Comment creation — not possible via the public API.
- Retry/backoff queues for failed processing — a failed run simply doesn't
  get the message; no user-facing consequence, so this is logged and
  dropped rather than retried.
- Admin UI for managing connected athletes — a flat SQLite table is enough
  at this scale; inspect/edit via `sqlite3` CLI if ever needed.

## Architecture

A single Node.js/Express service with three responsibilities:

1. **OAuth connect flow** — lets an athlete authorize the app and stores
   their token.
2. **Webhook receiver** — Strava calls this on activity create/update
   events.
3. **Message logic** — fetches the activity, checks/appends the message,
   writes it back via the Strava API.

The service is a single process with no external queue or worker — "async
processing" of a webhook event means the handler returns the HTTP response
before awaiting the Strava API calls that follow, not that work is handed
off to a separate process. This keeps the deployment to one container with
no message broker, appropriate for the request volume of a handful of
athletes' activities. If volume or reliability needs ever grow past what
an in-process `setImmediate`/fire-and-forget can handle, that's the point
to introduce a real job queue — not before.

### Connect flow (sequence)

```
Athlete          Browser              runsync            Strava
  |  click Connect  |                    |                  |
  |----------------->  GET /connect      |                  |
  |                 |------------------->|                  |
  |                 |  redirect to Strava OAuth authorize    |
  |                 |<-------------------|                  |
  |                 |---------------------------------------->
  |                 |         authorize (scope grant)         |
  |                 |<----------------------------------------|
  |                 |  redirect to /oauth/callback?code=...   |
  |                 |------------------->|                  |
  |                 |                    |  exchange code    |
  |                 |                    |----------------->|
  |                 |                    |  access+refresh   |
  |                 |                    |<-----------------|
  |                 |                    | upsert athletes  |
  |                 |                    | row (SQLite)     |
  |                 |  "Connected!" page |                  |
  |                 |<-------------------|                  |
```

### Webhook flow (sequence)

```
Garmin/Strava        Strava            runsync           SQLite
     |  activity synced  |                 |                |
     |------------------>|                 |                |
     |                    | POST /webhook  |                |
     |                    |--------------->|                |
     |                    |   200 OK       |                |
     |                    |<---------------|                |
     |                    |                | lookup owner_id|
     |                    |                |--------------->|
     |                    |                |<---------------|
     |                    |  refresh token (if expired)      |
     |                    |<-------------->|                |
     |                    |  GET /activities/{id}            |
     |                    |<-------------->|                |
     |                    |  [already has message? stop]     |
     |                    |  PUT /activities/{id}            |
     |                    |<-------------->|                |
```

The two sequences share the `athletes` table and the token-refresh path in
`lib/strava.js`, but otherwise don't interact — the connect flow only ever
writes a row, the webhook flow only ever reads/refreshes one.

### Components

- `server.js` — Express app entry point, wires up routes below.
- `GET /connect` — landing page with a "Connect your Strava account" link
  that redirects into Strava's OAuth authorize URL, requesting
  `activity:read_all,activity:write` scope.
- `GET /oauth/callback` — receives the authorization code, exchanges it for
  access + refresh tokens via Strava's token endpoint, upserts the athlete
  row in SQLite.
- `GET /webhook` — handles Strava's webhook subscription verification
  handshake (echoes back `hub.challenge` when `hub.verify_token` matches).
- `POST /webhook` — receives activity events. Responds `200` immediately,
  then processes asynchronously (see Data Flow).
- `lib/strava.js` — thin API client: refresh token exchange, `GET
  /activities/{id}`, `PUT /activities/{id}`.
- `lib/db.js` — SQLite access via `better-sqlite3` (or equivalent), single
  `athletes` table.
- `data.sqlite` — persisted athlete store, mounted as a Docker volume.

### Data model

```
athletes
  athlete_id      INTEGER PRIMARY KEY   -- Strava athlete id
  refresh_token   TEXT NOT NULL
  access_token    TEXT NOT NULL
  expires_at      INTEGER NOT NULL      -- unix timestamp
  created_at      INTEGER NOT NULL
```

## Data flow

1. Athlete's Garmin (or other source) syncs a completed run to Strava.
2. Strava POSTs a webhook event to `/webhook`:
   ```json
   {
     "object_type": "activity",
     "aspect_type": "create",
     "object_id": 123456789,
     "owner_id": 987654,
     "subscription_id": 1,
     "updates": {}
   }
   ```
3. Service responds `200 OK` immediately (Strava requires ack within 2s and
   will disable the subscription after repeated failures/timeouts).
4. Asynchronously:
   - Look up `owner_id` in the `athletes` table. If not found, drop the
     event (unknown/unconnected athlete) and log it.
   - If `access_token` is expired (or close to it), refresh via
     `refresh_token`, persist the new tokens.
   - `GET /activities/{object_id}` to fetch current description.
   - If the description already ends with the configured message string,
     stop (idempotent no-op).
   - Otherwise `PUT /activities/{object_id}` with the message appended to
     the existing description (preserve whatever the athlete already
     wrote; append on a new line).

## Concurrency: overlapping webhook events for the same activity

The service is single-process, but not single-threaded in effect — each
webhook handler is `async` and yields the event loop on every `await`
(SQLite lookup, token refresh, the `GET` then `PUT` to Strava). If a
second event for the same activity arrives while the first is still
mid-flight (e.g. Strava fires `create` immediately followed by an
`update`, which happens in practice), Node interleaves the two handlers
rather than running them strictly one after another.

This creates a race the idempotency check alone doesn't cover:

1. Event A: `GET` activity → description doesn't have the message yet.
2. Event B: `GET` activity → also doesn't have it yet (A hasn't written).
3. Event A: `PUT` with message appended.
4. Event B: `PUT` with message appended again → duplicate.

The "append only if missing" check protects against reprocessing the
*same* event twice (e.g. a delivery retry), but not against two
*different* events for the same activity both passing the check before
either has written.

**Fix:** serialize processing per `object_id`. Maintain an in-memory `Map`
of `object_id -> Promise` in the webhook handler; if an event for an
`object_id` already has processing in flight, chain the new event's work
onto that promise instead of starting a fresh `GET` immediately. This
needs no external lock or queue — a single process is enough to make the
per-activity ordering hold — and the map naturally resets on restart
(acceptable since in-flight work is idempotent-safe to redo after a
crash). Different activities/athletes never share a map key, so this adds
no serialization across unrelated events.

## Event filtering

Both `aspect_type: create` and `aspect_type: update` are accepted and
handled identically — the idempotency check (description already ends
with the message) is what prevents double-appending on edits, rather than
filtering to `create` only. This also correctly handles the case where an
athlete edits their description shortly after upload, before the message
was appended, or clears it entirely.

Ignore events where `object_type != "activity"` (Strava also sends athlete
deauthorization events).

## Error handling

- Webhook ack is always `200`, independent of processing outcome — this is
  a hard Strava requirement, not a nicety.
- Processing failures (expired/revoked refresh token, Strava API errors,
  unknown athlete) are logged with athlete id and event details, then
  dropped. No retry queue for v1 — failure just means that one activity
  doesn't get the message, which is a low-stakes miss.
- If a refresh token is revoked (athlete disconnected the app on Strava's
  side), mark the row as needing reconnection on next log review, or
  simply log the error — decide during implementation which is enough for
  a handful of users, no need to build athlete-facing error notifications.

## Configuration

Environment variables:
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_WEBHOOK_VERIFY_TOKEN` — arbitrary string set by us, checked
  during the webhook subscription handshake.
- `APPEND_MESSAGE` — the static text to append (placeholder for now, e.g.
  `"🏃 Synced via runsync"`; swap in real copy before first deploy).
- `BASE_URL` — public HTTPS base URL of the deployed service, needed for
  the OAuth redirect URI.

## Deployment

- Single Docker container on the owner's existing VPS, following the same
  pattern as other self-hosted services there (reverse proxy in front,
  container behind it).
- Needs a public HTTPS endpoint (via the existing reverse proxy) for both
  `/oauth/callback` and `/webhook`.
- One Strava API application (client id/secret) registered once via
  Strava's developer settings, pointing its callback domain at this
  service.
- SQLite file persisted via a mounted volume so athlete tokens survive
  container restarts/redeploys.
- Webhook subscription itself is created once via a one-time authenticated
  POST to Strava's push subscription endpoint (`POST
  /api/v3/push_subscriptions`), not something the app needs to do at
  runtime — a setup step done manually or via a small one-off script after
  first deploy.

## API access requirements

As of mid-2026, Strava changed developer API terms in ways that directly
affect this project's ongoing cost and ceiling:

- **Standard Tier subscription requirement:** any Standard Tier app (which
  covers this project) requires the *developer* — not each connected
  athlete — to maintain an active Strava subscription ($11.99/mo). This is
  a new recurring cost of running the service, separate from VPS hosting.
- **10-user cap:** Standard Tier apps start capped at 10 connected
  athletes, self-service with no review. This comfortably covers "owner +
  a few others."
- **Growing past 10 users:** requires requesting a bump to the higher
  Standard Tier level (up to 9,999 users), which goes through Strava
  review with no committed turnaround SLA — not a same-day dashboard
  toggle. Worth knowing before promising a connect link to a wider group.
  If usage ever needs to scale beyond that, Extended Access Tier (10,000+
  users) is a separate, case-by-case admission process, not relevant at
  this project's scale.
- **Comments still unsupported:** confirms the Non-goals decision above —
  no tier or subscription level exposes comment creation via the public
  API.

## Testing

- Unit tests for `lib/strava.js` (token refresh logic, description-append
  logic with the idempotency check) using a mocked HTTP client.
- Unit tests for the webhook handler: verifies immediate `200` response,
  correct filtering of non-activity events, correct athlete lookup.
- Unit test for the per-activity serialization: two overlapping events for
  the same `object_id` must result in exactly one `PUT` call.
- Manual end-to-end test: connect a real (test) Strava account through
  `/connect`, upload/edit an activity, confirm the message appears once
  and isn't duplicated on a subsequent edit.

## Open questions for implementation time

- Exact wording of `APPEND_MESSAGE` (placeholder used throughout this
  spec).
- Whether to log failed/unknown-athlete events anywhere beyond stdout
  (e.g. a `failures` table) — deferred until it's clear it's needed at
  this scale.
