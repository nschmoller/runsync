# Strava Auto-Message Service — Design

## Problem

Strava's public API does not allow apps to create comments on activities
(comment creation is not exposed; only reading comments is). The closest
automatable equivalent is editing the activity's **description** at upload
time. This project builds a small self-hosted service ("racegoal") that
automatically appends a fixed message to the description of every new
running activity for a small set of athletes.

Out of scope: posting actual Strava comments (not possible via public API,
would require unofficial browser automation, explicitly rejected as too
brittle).

## Goals

- Automatically append a static message to the description of every new
  **running** activity, for a handful of known Strava athletes (owner + a
  few others).
- Invite-gated self-service connect flow so a new athlete can authorize the
  app without the owner doing manual token setup per person.
- Per-athlete message text: each athlete chooses their own message when
  they connect and can change it afterwards from their dashboard.
- A per-athlete dashboard where a connected athlete can see their
  connection status and recent processing history, and edit their message.
- Idempotent: an activity that gets edited later (title, description, etc.)
  and re-fires the webhook must not get the message appended twice.
- Never retroactive: connecting must not touch an athlete's activity
  history. Exactly one existing activity — their most recent run — is
  seeded at connect time; everything older is permanently off-limits.
- Runs continuously on the owner's existing VPS infrastructure, in Docker,
  matching the pattern of other self-hosted services there.

## Non-goals

- Templated/dynamic message content (distance, pace, weather, etc.) — an
  athlete's message is a fixed string, the same on every activity. Per
  athlete, yes; per activity, no. Swapping to a template is a future,
  separate change.
- Retroactively rewriting the message on already-processed activities when
  an athlete edits it — see Message content.
- Comment creation — not possible via the public API.
- Retry/backoff queues for failed processing — a failed run simply doesn't
  get the message; no user-facing consequence, so this is logged and
  dropped rather than retried.
- Owner-facing admin UI for managing connected athletes or minting invites
  — a flat SQLite database is enough at this scale; invites are minted with
  a one-off script, and rows are inspected via the `sqlite3` CLI.
- Non-running activities — rides, swims, and everything else are ignored.
  See Event filtering.
- Backfilling history — no job ever walks an athlete's past activities.
  The single seeded run at connect time is the only exception, and it is
  deliberate. See Activity cutoff.

## Architecture

A single Node.js/Express service with four responsibilities:

1. **OAuth connect/login flow** — lets an invited athlete authorize the app
   and stores their token; the same flow re-authenticates a returning
   athlete for the dashboard.
2. **Webhook receiver** — Strava calls this on activity and athlete
   (deauthorization) events.
3. **Message logic** — fetches the activity, filters by sport type,
   checks/appends the message, writes it back via the Strava API.
4. **Dashboard** — a session-authenticated page showing one athlete their
   own connection status and processing history.

The service is a single process with no external queue or worker — "async
processing" of a webhook event means the handler returns the HTTP response
before awaiting the Strava API calls that follow, not that work is handed
off to a separate process. This keeps the deployment to one container with
no message broker, appropriate for the request volume of a handful of
athletes' activities. If volume or reliability needs ever grow past what
an in-process `setImmediate`/fire-and-forget can handle, that's the point
to introduce a real job queue — not before.

### Authentication model

There are no passwords. Strava OAuth is the only identity source:

- An athlete's first visit must carry a valid, unconsumed **invite token**
  (see Invites below). This is what enforces the 10-athlete cap against
  strangers who discover the URL.
- On a successful callback, the service sets a signed, `HttpOnly`,
  `Secure`, `SameSite=Lax` session cookie containing the Strava athlete id,
  signed with `SESSION_SECRET`. That cookie is the dashboard's credential.
- A returning athlete whose session expired visits `/login`, which runs the
  same OAuth round trip without requiring an invite — the athlete row
  already exists, so no slot is consumed.

### Invites

Slot control for the Standard Tier 10-user cap, and the answer to "anyone
who finds the URL can connect."

- `POST`-free by design: the owner mints a token with a one-off script
  (`scripts/mint-invite.js`), which inserts a random 32-byte token into the
  `invites` table and prints the resulting `/connect?invite=<token>` URL.
- The token is validated at `/connect` **and again** at `/oauth/callback`
  (carried across the round trip inside the `state` record, not as a
  user-supplied query param), then marked consumed in the same transaction
  that upserts the athlete row.
- Invites are single-use and expire after 7 days.

### CSRF protection on the OAuth round trip

Every `/connect` and `/login` request generates a random `state` value,
stored in the `oauth_states` table with the invite token (if any) and a
short TTL (10 minutes). `/oauth/callback` rejects any request whose `state`
is missing, unknown, expired, or already consumed. This is what prevents an
attacker-crafted callback URL from binding their Strava account into a
session, and it is why the invite token is read from the stored state
record rather than from the callback's query string.

### Connect flow (sequence)

```
Athlete          Browser              racegoal            Strava
  |  invite link    |                    |                  |
  |----------------->  GET /connect?invite=tok              |
  |                 |------------------->|                  |
  |                 |  connect page: message field + button  |
  |                 |<-------------------|                  |
  |  edit message,  |                    |                  |
  |  click Connect  |  POST /connect     |                  |
  |----------------->------------------->|                  |
  |                 |  validate invite + message,            |
  |                 |  store state row (with pending msg)    |
  |                 |  redirect to Strava OAuth authorize    |
  |                 |<-------------------|                  |
  |                 |---------------------------------------->
  |                 |         authorize (scope grant)         |
  |                 |<----------------------------------------|
  |                 | redirect /oauth/callback?code=..&state=..
  |                 |------------------->|                  |
  |                 |     verify+consume state row           |
  |                 |                    |  exchange code    |
  |                 |                    |----------------->|
  |                 |                    |  access+refresh   |
  |                 |                    |<-----------------|
  |                 |          upsert athletes row,          |
  |                 |          consume invite (one txn)      |
  |                 |                    | GET /athlete/activities
  |                 |                    |----------------->|
  |                 |          set cutoff, seed newest run   |
  |                 |                    | PUT /activities/{seed}
  |                 |                    |----------------->|
  |                 |  Set-Cookie: session |                |
  |                 |  redirect /dashboard |                |
  |                 |<-------------------|                  |
```

### Webhook flow (sequence)

```
Garmin/Strava        Strava            racegoal           SQLite
     |  activity synced  |                 |                |
     |------------------>|                 |                |
     |                    | POST /webhook  |                |
     |                    |--------------->|                |
     |                    |   200 OK       |                |
     |                    |<---------------|                |
     |                    |   [verify subscription_id]      |
     |                    |                | lookup owner_id|
     |                    |                |--------------->|
     |                    |                |<---------------|
     |                    |  refresh token (if expired)      |
     |                    |<-------------->|                |
     |                    |  GET /activities/{id}            |
     |                    |<-------------->|                |
     |                    |  [not a run? stop]               |
     |                    |                | processed row? |
     |                    |                |--------------->|
     |                    |                |<---------------|
     |                    |  [already processed? stop]       |
     |                    |  PUT /activities/{id}            |
     |                    |<-------------->|                |
     |                    |                | record processed
     |                    |                |--------------->|
```

The two sequences share the `athletes` table and the token-refresh path in
`lib/strava.js`. The connect flow writes rows; the webhook flow reads and
refreshes them; the dashboard only reads.

### Components

- `server.js` — Express app entry point, wires up routes below.
- `GET /connect` — requires `?invite=<token>`. Validates the invite and
  renders the connect page: an explanation of what the app will do, an
  **empty** message input, the blank-means-default hint quoting the default
  verbatim beneath it (see Message content), and a "Connect with Strava"
  button. An invalid, expired, or consumed invite renders a plain
  "this invite link is no longer valid" page instead.
- `POST /connect` — re-validates the invite, validates the submitted
  message (see Message content), creates an `oauth_states` row holding both
  the invite token and the pending message, and redirects into Strava's
  OAuth authorize URL requesting `activity:read,activity:write` scope. On
  a validation failure it re-renders the connect page with the error and
  the athlete's text preserved.
- `POST /dashboard/message` — session-authenticated. Validates and stores a
  new message for the calling athlete, sets `message_updated_at`, redirects
  back to `/dashboard` with a confirmation. Carries a CSRF token (see
  below).
- `GET /login` — same OAuth redirect without an invite, for a returning
  athlete whose session expired. The callback rejects it if the athlete is
  not already in the `athletes` table.
- `GET /oauth/callback` — verifies and consumes the `state` row, exchanges
  the authorization code for access + refresh tokens, upserts the athlete
  row (including the state's `pending_message`) and consumes the invite in
  one transaction, establishes
  `activity_cutoff` and seeds the athlete's most recent run (see Activity
  cutoff), sets the session cookie, redirects to `/dashboard`.
- `GET /dashboard` — session-authenticated. See Dashboard below.
- `POST /disconnect` — session-authenticated. Calls Strava's
  `/oauth/deauthorize`, marks the row `status = 'revoked'`, clears the
  session cookie.
- `GET /webhook` — handles Strava's webhook subscription verification
  handshake (echoes back `hub.challenge` when `hub.verify_token` matches).
- `POST /webhook` — receives activity and athlete events. Responds `200`
  immediately, then processes asynchronously (see Data flow).
- `lib/strava.js` — thin API client: refresh token exchange (with the
  per-athlete lock, see Concurrency), `GET /activities/{id}`, `PUT
  /activities/{id}`, `POST /oauth/deauthorize`.
- `lib/db.js` — SQLite access via `better-sqlite3` (or equivalent).
- `lib/session.js` — sign/verify the session cookie against
  `SESSION_SECRET`.
- `scripts/mint-invite.js` — one-off invite generator.
- `scripts/create-subscription.js` — one-off webhook subscription setup.
- `data.sqlite` — persisted store, mounted as a Docker volume, file mode
  `0600` (it holds live refresh tokens).

### Dashboard

One page, rendered server-side, scoped entirely to the athlete identified
by the session cookie. No athlete can see another's data; there is no
owner/admin view.

Shows:
- Connection status — `active` or `revoked`, with a "Reconnect" link
  (pointing at `/login`) when revoked.
- Athlete name and Strava id, as stored at connect time.
- Their message, in an editable form posting to `POST /dashboard/message`,
  with a live character count against the length cap, the
  blank-means-default hint quoting the default verbatim (see Message
  content), and `message_updated_at` shown beneath it. A note states
  plainly that changing it affects future activities only.

  An athlete currently on the default sees the field **empty** with the
  hint below it, same as the connect page. Neither form is ever prefilled
  with the default: the field holds the athlete's own override and nothing
  else, so an empty field always means "on the default" and saving never
  silently converts a default-follower into an override-holder pinned to
  today's text.
- Sport types being processed (from `SPORT_TYPES`).
- "Active since" — the `activity_cutoff` date, stated plainly as "runs
  before this date are not touched", so the absence of the message on
  history is self-explanatory rather than a support question.
- Processing history: `processed_count`, `last_activity_id` (linked to
  Strava), `last_processed_at`, and `last_error` + `last_error_at` if the
  most recent attempt failed. These are the columns that make a "why didn't
  my run get the message?" question answerable without reading container
  logs.
- A "Disconnect" button posting to `/disconnect`.

An unauthenticated visit to `/dashboard` redirects to `/login`.

### Data model

```
athletes
  athlete_id        INTEGER PRIMARY KEY   -- Strava athlete id
  name              TEXT                  -- display name at connect time
  refresh_token     TEXT NOT NULL
  access_token      TEXT NOT NULL
  expires_at        INTEGER NOT NULL      -- unix timestamp
  status            TEXT NOT NULL          -- 'active' | 'revoked'
  message           TEXT                  -- NULL => fall back to APPEND_MESSAGE
  message_updated_at INTEGER
  activity_cutoff   INTEGER NOT NULL      -- unix ts; activities at or before
                                          -- this are never touched
  seed_activity_id  INTEGER               -- the one historical run seeded
                                          -- at connect, NULL if none found
  processed_count   INTEGER NOT NULL DEFAULT 0
  last_activity_id  INTEGER
  last_processed_at INTEGER
  last_error        TEXT
  last_error_at     INTEGER
  created_at        INTEGER NOT NULL
  revoked_at        INTEGER

processed_activities
  activity_id   INTEGER PRIMARY KEY   -- Strava activity id
  athlete_id    INTEGER NOT NULL
  appended_at   INTEGER NOT NULL

invites
  token         TEXT PRIMARY KEY      -- 32 random bytes, hex
  created_at    INTEGER NOT NULL
  expires_at    INTEGER NOT NULL
  consumed_at   INTEGER               -- NULL until used
  athlete_id    INTEGER               -- set when consumed

oauth_states
  state           TEXT PRIMARY KEY    -- 32 random bytes, hex
  invite_token    TEXT                -- NULL for /login
  pending_message TEXT                -- message chosen on the connect page,
                                      -- applied at callback; NULL = default
  created_at    INTEGER NOT NULL
  expires_at    INTEGER NOT NULL
  consumed_at   INTEGER
```

`processed_activities` is the durable idempotency record — see Idempotency.
Expired `oauth_states` rows are swept on write; the table never grows.

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
3. Service verifies `subscription_id` matches ours (see Webhook
   authenticity) and responds `200 OK` immediately — Strava requires ack
   within 2s and will disable the subscription after repeated
   failures/timeouts.
4. Asynchronously, under the per-activity lock:
   - Look up `owner_id` in the `athletes` table. If not found, or
     `status = 'revoked'`, drop the event and log it.
   - If a `processed_activities` row already exists for `object_id`, stop
     (idempotent no-op) — before any Strava call, so a re-delivery costs
     nothing against the rate limit.
   - If `access_token` is expired or within the refresh skew, refresh via
     `refresh_token` under the per-athlete lock, persist the new tokens.
   - `GET /activities/{object_id}` to fetch `sport_type`, `start_date`, and
     the current description.
   - If `start_date` is at or before the athlete's `activity_cutoff`, stop
     (see Activity cutoff).
   - If `sport_type` is not in `SPORT_TYPES`, stop.
   - If the description already contains the message string, record the
     `processed_activities` row and stop (recovers idempotency for
     activities processed before the table existed, or after a data loss).
   - Otherwise `PUT /activities/{object_id}` with the message appended to
     the existing description (preserve whatever the athlete already wrote;
     append on a new line).
   - Insert the `processed_activities` row and bump the athlete's
     `processed_count` / `last_activity_id` / `last_processed_at`.

## Idempotency

Idempotency is anchored on the `processed_activities` table, not on
inspecting the description. Once an activity has been appended to, its row
exists forever and the service never touches that activity again.

This is deliberately stronger than a string check, and fixes two problems a
string check has:

- **Substring vs. suffix.** Because `update` events are handled (see Event
  filtering), an athlete who edits their description and types anything
  *after* the appended message would fail an `endsWith` check and get a
  second copy. The secondary description check therefore uses `includes`,
  not `endsWith`.
- **The deletion fight.** If an athlete deliberately removes the message,
  a description-based check would re-append it on the next edit event,
  forever. With the durable record, removal is respected: the athlete's
  edit stands.

The description `includes` check remains as a secondary guard for the case
where the database is rebuilt or an activity predates the table — it
back-fills the row rather than duplicating the text.

## Message content

Each athlete has their own message string. `athletes.message` is the
athlete's own text; `NULL` means "use the `APPEND_MESSAGE` default". The
**effective message** for an athlete is `message ?? APPEND_MESSAGE`, and
that is what every append, and every idempotency back-fill check, uses.

It is set in two places — the connect page, before authorizing, and the
dashboard afterwards. Both go through the same validator.

### Validation

Applied identically on `POST /connect` and `POST /dashboard/message`:

- Trim leading/trailing whitespace. A blank or whitespace-only submission
  stores `NULL`, i.e. reverts to the default — this is the documented way
  to reset.

  Neither form is ever prefilled with the default. The input holds the
  athlete's own override and nothing else, so an empty field always means
  "on the default". Both forms instead state this explicitly **and quote
  the default verbatim** below the input, rendered from the live
  `APPEND_MESSAGE` value rather than hardcoded in the template, so the two
  can never drift apart:

  > Leave blank to use the default message: `🏃 Synced via racegoal`

  The point is that "leave blank for the default" alone is useless — the
  athlete cannot consent to text they have not been shown. Quoting it means
  a blank submission is never a surprise, while keeping the input empty
  means a blank submission stays *possible*: a prefilled field can only be
  submitted as an override, since clearing it back out is exactly the
  gesture that looks like a mistake. The quoted string is HTML-escaped like
  any other message text.
- Reject longer than **200 characters** (after trimming). This is our own
  cap, comfortably inside Strava's description limit; confirm that limit at
  implementation time and keep ours well below it, since the message shares
  the field with whatever the athlete wrote.
- Normalize line endings to `\n` and collapse runs of 3+ newlines to 2. A
  multi-line message is allowed; a message that pushes the athlete's own
  text off the visible part of the feed card is not the goal, but this is
  a nudge, not a hard rule.
- Strip control characters other than newline. Emoji and other non-ASCII
  are explicitly fine — the default is an emoji.
- No HTML or markdown handling: Strava renders descriptions as plain text.
  The string is stored and sent verbatim. It **must** be HTML-escaped when
  rendered back into our own dashboard and connect pages — the athlete is
  the only person who sees their own message there, so this is
  self-XSS-shaped rather than cross-user, but escaping is not optional.

### Changing the message later

Changing the message affects **future activities only**. Already-processed
activities keep the text they were given, because `processed_activities`
means the service never revisits an activity. There is no rewrite job, and
the dashboard says so next to the form — otherwise "I changed my message,
why is my last run still showing the old one?" is an inevitable question.

One consequence worth naming: the description `includes` back-fill guard
(see Idempotency) tests the *current* effective message. If an athlete
changes their message and the `processed_activities` row for an old
activity is somehow lost, that activity's old message would no longer match
and it could be appended to a second time. The durable row is the real
defence; this is a narrow gap in the secondary guard, accepted rather than
engineered around at this scale.

## Activity cutoff and connect-time seeding

The service must never work backwards through an athlete's history. There
is no backfill job, but without an explicit cutoff there is still a leak:
`update` events are handled (see Event filtering), and Strava fires those
for edits to activities of **any age**. An athlete who tidies up the title
of a two-year-old run would get the message appended to it. A cutoff is
what closes that.

### At connect time

At the end of a successful first-time `/oauth/callback`, before redirecting
to the dashboard:

1. `GET /athlete/activities?per_page=10` — the athlete's most recent
   activities.
2. Set `activity_cutoff` to the `start_date` of the newest activity
   returned, regardless of its sport type. If the athlete has no activities
   at all, set it to the connect timestamp.
3. Find the newest activity in that page whose `sport_type` is in
   `SPORT_TYPES` and append the message to it, through the same code path
   the webhook uses (so it gets a `processed_activities` row). Record its id
   as `seed_activity_id`. If none of the 10 is a run, skip the seed — the
   next uploaded run will be the athlete's first.

The seed is worth the two extra API calls because it gives the athlete
immediate, visible confirmation on their own feed that the connection
works, instead of a dashboard that says "connected" and then nothing until
their next run.

Note the seeded run may itself be older than `activity_cutoff` (if their
newest activity was a ride). That is fine and intentional: it carries a
`processed_activities` row, so it is never revisited, and the cutoff drops
everything else.

### At webhook time

After fetching the activity, drop it if its `start_date` is at or before
`activity_cutoff`. Like the sport filter, this check cannot save the `GET`
— the webhook payload carries no activity date, only an event timestamp,
and an edit to an old activity has a *recent* event timestamp. Activity ids
are near-monotonic in practice but not guaranteed, so they are not used as
a cheap proxy for this.

### On reconnect

`activity_cutoff` is set on first connect and **advanced, never moved
backwards**, on a re-authorization following a revoke (to the newest
activity at that moment, with no re-seed). Activities uploaded during a
disconnected window are treated as history, consistent with the rule above.
A plain `/login` for an expired session does not touch the cutoff or
re-seed — the athlete's `status` is still `active` and nothing was missed.

## Concurrency

Two distinct races exist here, needing two distinct locks. Both are plain
in-memory `Map`s of key → in-flight `Promise`, which is sufficient because
the service is a single process.

**For both maps: the check-and-insert must happen synchronously within one
tick — read the map, insert the chained promise, and return, all before the
handler's first `await`.** Any `await` between the lookup and the insert
reopens the exact race the lock exists to close. Entries are deleted in a
`.finally()` on the stored promise, which keeps the maps from growing
without bound; because deletion also happens on the event loop, a chain
either finds the entry and joins it or finds it gone and starts fresh —
both correct.

### 1. Per-activity: overlapping events for the same `object_id`

Each webhook handler is `async` and yields the event loop on every `await`
(SQLite lookup, token refresh, the `GET` then `PUT` to Strava). If a second
event for the same activity arrives while the first is still mid-flight
(e.g. Strava fires `create` immediately followed by an `update`, which
happens in practice), Node interleaves the two handlers rather than running
them strictly one after another:

1. Event A: `GET` activity → not yet processed.
2. Event B: `GET` activity → also not yet processed (A hasn't written).
3. Event A: `PUT` with message appended.
4. Event B: `PUT` with message appended again → duplicate.

The idempotency record alone doesn't cover this — it protects against
reprocessing the *same* event twice (e.g. a delivery retry), but not
against two *different* events for the same activity both passing the check
before either has written.

**Fix:** a `Map` of `object_id -> Promise`. If an event for an `object_id`
already has processing in flight, chain the new event's work onto that
promise instead of starting a fresh `GET`. The map resets on restart, which
is acceptable: the `processed_activities` row makes redoing in-flight work
after a crash safe.

### 2. Per-athlete: concurrent token refresh

Strava **rotates the refresh token on every refresh** — the previous one is
invalidated. Two activities from the same athlete arriving together (a
Garmin backlog sync, or a create/update pair on different activity ids)
would both see an expired access token and both POST the *same* refresh
token. The second exchange fails, and the two writes race on the `athletes`
row. The failure mode is severe and silent: the athlete ends up
disconnected and every subsequent activity fails until they manually
reconnect.

Note that the per-activity lock does **not** cover this — the two events
have different `object_id`s and therefore never share a key.

**Fix:** a second `Map` of `athlete_id -> Promise` inside `lib/strava.js`,
wrapping the whole refresh path. Concurrent callers await the one in-flight
refresh and reuse its result rather than issuing their own exchange.

## Webhook authenticity

Strava's webhook POST carries no signature, so anyone who discovers the URL
can forge events for arbitrary `object_id` / `owner_id` pairs. The blast
radius is bounded — a forger can only cause our own static message to be
appended to a connected athlete's activity — but it is a free way to burn
the rate limit.

Mitigation: reject any event whose `subscription_id` does not match the
subscription id recorded at setup time (`STRAVA_SUBSCRIPTION_ID`). This is
obscurity, not authentication, and is stated as such; it is proportionate
to the blast radius. Rejected events are logged and still answered `200`.

## Event filtering

- **`object_type: "activity"`** — both `aspect_type: create` and
  `aspect_type: update` are accepted and handled identically. The
  `processed_activities` record is what prevents double-appending on edits,
  rather than filtering to `create` only. This also correctly handles the
  case where an athlete edits their description shortly after upload,
  before the message was appended.
- **`aspect_type: delete`** — drop, and delete any `processed_activities`
  row for that id.
- **`object_type: "athlete"` with `updates.authorized === "false"`** — the
  deauthorization event. Set `status = 'revoked'` and `revoked_at` on the
  athlete row. The row is *not* deleted: the dashboard needs an identity to
  render "disconnected — reconnect" against, and keeping it means a
  returning athlete uses `/login` rather than burning a fresh invite.
  Revoked athletes are skipped in webhook processing.
- **Anything else** — log and drop.

**Sport type.** After fetching the activity, process it only if its
`sport_type` is in the `SPORT_TYPES` allowlist, default `Run,TrailRun`.
Every other activity — rides, swims, walks, and manual entries of any type
— is dropped without a `PUT`. Keeping this in config rather than hardcoding
"Run" makes broadening it a one-line env change.

## Error handling

- Webhook ack is always `200`, independent of processing outcome — this is
  a hard Strava requirement, not a nicety.
- **Detached-promise safety:** because the handler returns `200` before the
  processing promise settles, that promise is unobserved. A rejection in it
  would trigger Node's default `unhandledRejection` behavior and kill the
  container. Every detached processing chain therefore ends in a top-level
  `.catch()` that logs and records `last_error` / `last_error_at` on the
  athlete row. This is a correctness requirement, not defensive style.
- Processing failures (Strava API errors, unknown athlete, unexpected
  payloads) are logged with athlete id and event details, then dropped. No
  retry queue for v1 — failure just means that one activity doesn't get the
  message, which is a low-stakes miss. The dashboard surfaces the last
  error so the miss is at least visible to the athlete.
- **Revoked authorization:** a `401` from the token refresh endpoint is
  treated the same as a deauthorization webhook — mark the row
  `status = 'revoked'`. The webhook is not guaranteed to arrive, so this is
  the backstop that keeps a dead row from failing on every future event.
- **Rate limits:** Strava applies two per-application buckets — an overall
  limit of **200 requests / 15 min** and **2,000 / day**, and a tighter
  "non-upload" limit of **100 / 15 min** and **1,000 / day** (verified
  against developers.strava.com/docs/rate-limits, Aug 2026; Standard Tier
  may raise these, confirm on the app's own dashboard once the
  subscription is active).

  The non-upload bucket excludes only `POST /activities`, `POST /uploads`,
  and media uploads — so **every call this service makes** (token refresh,
  `GET /activities/{id}`, `PUT /activities/{id}`) counts against the
  tighter 100 / 1,000 limit. Budget against that one, not the 200/2,000.

  Cost per event: 1 request for an activity we end up skipping (neither
  the `sport_type` filter nor the `activity_cutoff` check can save the
  `GET` — the webhook payload carries neither the sport type nor the
  activity date, so we must fetch the activity to apply either), 2 for a
  run we append to, 3 if a token refresh is also due. Connecting an athlete
  costs 3 one-off requests (token exchange, activity list, seed `PUT`).

  Steady state is far inside the cap: 10 athletes at ~2 activities/day is
  roughly 60 requests/day against 1,000. The exposure is the 15-minute
  window, not the daily one — a newly connected athlete whose Garmin syncs
  a backlog, or a bulk re-upload, can fire dozens of events in a burst and
  approach 100 / 15 min.

  A `429` is logged and dropped like any other failure, per the no-retry
  non-goal; those activities silently miss their message. If bursts turn
  out to trip this in practice, the fix is a simple in-process request
  throttle (a token bucket in `lib/strava.js`) rather than a retry queue.
  The pre-Strava-call `processed_activities` check in Data flow step 4
  already keeps re-deliveries from consuming quota.

## Security notes

- Refresh tokens are long-lived credentials granting write access to
  another person's Strava account. `data.sqlite` is stored with mode `0600`
  on a mounted volume. Backups of the VPS are encrypted at rest, so no
  additional application-level encryption is applied.
- Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, signed with
  `SESSION_SECRET`, and carry nothing but the athlete id and an expiry.
- State-changing dashboard posts (`/dashboard/message`, `/disconnect`)
  carry a CSRF token in a hidden field, computed as an HMAC of the session
  id under `SESSION_SECRET` and compared with a constant-time equality
  check. `SameSite=Lax` already blocks the cross-site form post, so this is
  defence in depth — cheap, and it means the protection does not rest on
  one cookie attribute.
- `activity:read` is requested rather than `activity:read_all`: the service
  only needs to read activities it is told about, and the narrower scope
  makes for a less alarming consent screen. Private activities are
  consequently not visible to the service and will not get the message —
  accepted.

## Configuration

Environment variables:
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_WEBHOOK_VERIFY_TOKEN` — arbitrary string set by us, checked
  during the webhook subscription handshake.
- `STRAVA_SUBSCRIPTION_ID` — recorded after running
  `scripts/create-subscription.js`; incoming events must match it.
- `APPEND_MESSAGE` — default message, used to prefill the connect page and
  as the fallback for any athlete whose `message` is `NULL` (placeholder
  for now, e.g. `"🏃 Synced via racegoal"`; swap in real copy before first
  deploy). Changing it retroactively changes the effective message for
  every athlete still on the default — deliberate, but worth knowing before
  editing it on a running deployment.
- `SPORT_TYPES` — comma-separated allowlist, default `Run,TrailRun`.
- `SESSION_SECRET` — signs dashboard session cookies. Random 32+ bytes.
- `BASE_URL` — public HTTPS base URL of the deployed service, needed for
  the OAuth redirect URI.

## Deployment

- Single Docker container on the owner's existing VPS, following the same
  pattern as other self-hosted services there (reverse proxy in front,
  container behind it).
- Needs a public HTTPS endpoint (via the existing reverse proxy) for
  `/connect`, `/login`, `/oauth/callback`, `/dashboard`, and `/webhook`.
- One Strava API application (client id/secret) registered once via
  Strava's developer settings, pointing its callback domain at this
  service.
- SQLite file persisted via a mounted volume so athlete tokens survive
  container restarts/redeploys.
- Webhook subscription is created once via an authenticated `POST` to
  `/api/v3/push_subscriptions` (`scripts/create-subscription.js`), after
  the service is deployed and its callback URL is publicly reachable —
  Strava validates the URL during subscription creation. **Strava permits
  only one push subscription per application**, so re-running setup
  requires deleting the existing subscription first; the script should
  `GET` the current subscription and `DELETE` it before creating a new one.
  Record the returned id in `STRAVA_SUBSCRIPTION_ID`.

### Prerequisites before first deploy

1. **An active Strava subscription on the owner's account** ($11.99/mo).
   This is currently *not* active and is a hard blocker for API access
   under the Standard Tier terms below — nothing works without it. Activate
   before starting implementation, or at minimum before the first
   end-to-end test.
2. A registered Strava API application with the callback domain set.
3. A public HTTPS hostname routed to the container.

## API access requirements

As of mid-2026, Strava changed developer API terms in ways that directly
affect this project's ongoing cost and ceiling:

- **Standard Tier subscription requirement:** any Standard Tier app (which
  covers this project) requires the *developer* — not each connected
  athlete — to maintain an active Strava subscription ($11.99/mo). This is
  a new recurring cost of running the service, separate from VPS hosting.
  See Prerequisites: not yet active.
- **10-user cap:** Standard Tier apps start capped at 10 connected
  athletes, self-service with no review. This comfortably covers "owner +
  a few others", and the invite mechanism is what stops strangers from
  consuming the slots.
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

Unit tests, with a mocked HTTP client:

- `lib/strava.js`: token refresh logic, description-append logic.
- Webhook handler: immediate `200` response; `subscription_id` mismatch is
  rejected; non-activity events are filtered; athlete lookup is correct.
- **Sport filter:** an activity whose `sport_type` is outside `SPORT_TYPES`
  produces no `PUT`.
- **Idempotency:** an activity with an existing `processed_activities` row
  produces no Strava call at all; an activity whose description already
  contains the message back-fills the row and produces no `PUT`; an
  activity whose description has the message followed by later athlete text
  is *not* appended to again (the `includes` vs `endsWith` case).
- **Activity cutoff:** an activity whose `start_date` is before the
  athlete's `activity_cutoff` produces no `PUT`, including on an
  `aspect_type: update` event (the old-activity-edit leak); an activity
  after the cutoff is processed normally; an activity exactly at the cutoff
  is dropped.
- **Connect seeding:** a first-time connect appends to the newest run in
  the returned page and records its `processed_activities` row; an athlete
  whose 10 most recent activities contain no run gets no seed and no error;
  an athlete with zero activities gets a cutoff of the connect timestamp;
  the seeded activity is not appended to again when its `create`/`update`
  webhook arrives afterwards.
- **Reconnect:** re-authorization after a revoke advances the cutoff and
  does not re-seed; a `/login` on an active athlete leaves both untouched;
  the cutoff never moves backwards.
- **Per-activity serialization:** two overlapping events for the same
  `object_id` result in exactly one `PUT`.
- **Concurrent token refresh:** two overlapping events for *different*
  activities of the *same* athlete, with an expired access token, result in
  exactly one refresh exchange, and both proceed with the new access token.
- **Deauthorization:** an `object_type: "athlete"` event with
  `updates.authorized === "false"` sets `status = 'revoked'`; a subsequent
  activity event for that athlete is dropped without a Strava call.
- **Revoked refresh token:** a `401` from the refresh endpoint marks the
  row revoked.
- **Detached rejection:** a processing failure after the `200` is caught,
  logged, and recorded in `last_error` — it does not produce an
  unhandled rejection.
- **Invites:** `/connect` without an invite is refused; with an expired,
  unknown, or already-consumed invite is refused; a valid invite is
  consumed exactly once even if the callback is replayed.
- **OAuth state:** a callback with a missing, unknown, expired, or already-
  consumed `state` is rejected.
- **Dashboard authorization:** an unauthenticated request redirects to
  `/login`; a session cookie for athlete A never renders athlete B's data;
  a tampered/unsigned cookie is rejected; `POST /dashboard/message` with a
  missing or wrong CSRF token is rejected and changes nothing.
- **Message validation:** over-length is rejected with the athlete's text
  preserved; blank stores `NULL`; control characters are stripped; emoji
  survive intact; a message containing `<script>` is escaped when rendered
  back into the dashboard.
- **Default is disclosed:** the connect page and the dashboard both render
  the current `APPEND_MESSAGE` verbatim in the blank-means-default hint,
  and changing the env var changes what both pages display — i.e. the
  quoted text is read from config, not hardcoded in a template.
- **Field state:** the connect page renders an empty input, never
  prefilled with the default; on the dashboard, an athlete on the default
  sees an empty field and an athlete with an override sees their own text.
- **Connecting without touching the field** leaves `message` as `NULL`, so
  the athlete tracks `APPEND_MESSAGE` rather than being pinned to a copy of
  it — including the seeded run.
- **Effective message:** an athlete with `message = NULL` gets
  `APPEND_MESSAGE`; an athlete with their own message gets theirs and not
  the default; two athletes with different messages each get their own on
  concurrent events.
- **Message chosen at connect:** the message submitted on the connect page
  survives the OAuth round trip in `oauth_states.pending_message` and is
  what the seeded run receives.
- **Message change is not retroactive:** editing the message produces no
  Strava calls, and an already-processed activity is not revisited.

Manual end-to-end test: mint an invite, connect a real (test) Strava
account through it, confirm the message lands on exactly one existing run
(the most recent) and on nothing older, then upload a run, confirm the
message appears once and
isn't duplicated on a subsequent edit; upload a ride and confirm it is
untouched; check the dashboard reflects both; disconnect and confirm the
status flips.

## Open questions for implementation time

- Exact wording of the default `APPEND_MESSAGE` (placeholder used
  throughout this spec). Now lower-stakes than it was, since each athlete
  can override it — but it is still what everyone sees prefilled on the
  connect page, so it sets the tone.
- Strava's actual maximum description length, to confirm the 200-character
  message cap leaves the athlete enough room for their own text.
- Whether to log failed/unknown-athlete events anywhere beyond stdout and
  the athlete row's `last_error` (e.g. a `failures` table) — deferred until
  it's clear it's needed at this scale.
- Session lifetime for the dashboard cookie (30 days is the assumed
  default; `/login` makes re-authentication cheap either way).
