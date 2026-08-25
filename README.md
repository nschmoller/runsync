# racegoal

Self-hosted Strava description messaging for new running activities.

## Local development

Node 24 is required. Run `nvm use`, `npm install`, then `npm run check`.

## Configuration

Copy `.env.example` and set the Strava client credentials, webhook verify token, `SESSION_SECRET`, default goal text (`APPEND_MESSAGE`), public `BASE_URL`, and `SUPPORT_EMAIL`. racegoal adds a `- - - 🎯 Goal - - -` divider above the goal text on new activities. Use a persistent `/data` volume: it contains the SQLite database and live refresh tokens.

## Data retention and deletion

- Processed-activity records (activity id, date, outcome) are kept for at most **7 days** (`src/domain/retention.js`), then purged — at container startup and opportunistically on every webhook delivery.
- Deleting an athlete's data is **immediate by default**. It happens from three places, all through `src/services/dataDeletionService.js`: the athlete's own "Delete my account and data" button (`POST /delete-account`), Strava's deauthorization webhook, and a detected auth failure (a 401 on refresh or on an API call). Each attempts to deauthorize with Strava first (best-effort — an already-invalid token does not block local deletion), then permanently deletes the athlete row and all their processed-activity rows in one transaction.
- **30 days is the documented maximum SLA**, not the normal case — it exists to cover an operator manually handling a written request that arrives outside the normal three automatic paths (e.g. by email to `SUPPORT_EMAIL`).
- A deleted athlete's row is gone entirely — there is no "revoked but retained" state. Reconnecting requires a brand-new invite.
- **Backups:** if you back up `/data/data.sqlite`, back it up encrypted, and expire backups on the same or a shorter cycle than the 7-day / immediate-deletion policy above. Restore only the minimum necessary — never restore an old backup wholesale over live data, which would resurrect data for athletes who have since deleted their account.
- **Breach notification:** the operator running this deployment is responsible for detecting and notifying affected athletes of any unauthorized access to `/data/data.sqlite` (it holds live OAuth tokens). Document who that is before deploying.

## Privacy, consent, and support

- `/privacy` and `/support` are public pages (no login) describing what is collected, why, where it's stored, and how to request deletion. Both are linked from the connect page and the dashboard.
- The connect page requires an explicit, unchecked consent checkbox before starting the Strava OAuth flow; submitting without it is rejected and creates no OAuth state row.
- Strava is never used in the application's name, icon, or branding, and no official "Connect with Strava" button asset is used — the connect button reads "Continue to Strava" instead.

## Deployment

Build with `docker build -t racegoal .`. Run it with a mounted `/data` volume and your env file. Route the public HTTPS hostname to `/connect`, `/login`, `/oauth/callback`, `/dashboard`, `/delete-account`, `/webhook`, `/privacy`, `/support`, and `/healthz`.

After the callback is public, run `npm run create-subscription`; set the printed `STRAVA_SUBSCRIPTION_ID` and restart. Create athlete links with `npm run mint-invite`; each is single-use and expires after seven days.

### Production deployment

Racegoal is deployed on Harbor through Coolify, currently reachable at
`https://runsync.s7r.nl` pending migration to the registered `racegoal.app`
domain (DNS, Coolify app domain, and the Strava app's Authorization Callback
Domain all still need updating — see the migration checklist below).
Coolify builds the repository Dockerfile, routes HTTPS traffic to port 3000, and
checks `/healthz`. The `racegoal-data` persistent volume is mounted at `/data`.

Keep every application setting runtime-only in Coolify. Racegoal does not need
any configuration while the image is built, and marking credentials as build
variables can expose them in build output. The runtime-only settings include
the Strava client secret, session secret, webhook verification token, and
subscription ID.

The Strava webhook subscription has been created for
`https://runsync.s7r.nl/webhook`; its ID is stored in Coolify as
`STRAVA_SUBSCRIPTION_ID`. Replacing that subscription deletes any existing
subscription for the same Strava app, so do this only deliberately.

### Domain migration to racegoal.app

`racegoal.app` is registered but not yet live. To cut over:

1. **DNS** — at the `racegoal.app` registrar, add an A/AAAA (or CNAME, if Coolify fronts with a proxy) record pointing to the same target `runsync.s7r.nl` currently resolves to.
2. **Coolify** — in the app's Domains settings, add `racegoal.app` alongside the existing domain so Coolify issues a certificate and starts routing it; keep the old domain active until the Strava side is confirmed working, then remove it.
3. **Strava app settings** (developers.strava.com, this app's settings page) — update **Authorization Callback Domain** to `racegoal.app`. This is manual in Strava's dashboard; there is no API for it. Existing connected athletes' refresh tokens are unaffected by this change, but new OAuth attempts will fail until it's updated.
4. **Environment** — update `BASE_URL` to `https://racegoal.app` in Coolify's runtime env vars, then redeploy.
5. **Webhook subscription** — Strava webhook subscriptions are tied to the callback URL's host implicitly only through delivery, not validation, so the existing subscription keeps delivering to whatever `BASE_URL`-derived webhook URL Strava was given at creation time; **do not** recreate the subscription for a bare domain change (see the warning above) — verify webhook delivery still works after the `BASE_URL` change, and only recreate the subscription if it doesn't.
6. Once `racegoal.app` is confirmed working end-to-end (OAuth connect, dashboard, webhook delivery), remove the old `runsync.s7r.nl` domain from Coolify.

To mint an invite in production, run `node scripts/mint-invite.js` inside the
running Racegoal container. It prints a single-use URL that expires after seven
days. The invite-to-Strava connection flow was confirmed on 2026-08-25.

### Pre-production checklist

- [ ] Active Strava tier eligibility confirmed, and connected-athlete count is within the tier's cap (Standard Tier: 10).
- [ ] `SUPPORT_EMAIL` is configured and `/privacy` and `/support` are reachable at the public `BASE_URL`.
- [ ] A test deletion request has been run end-to-end (dashboard button, or the webhook/401 paths) and produces a written confirmation.
- [ ] Retention purge logs (`retention.purge-failed` should never appear) have been audited at least once.
- [ ] No Strava-sourced data is used for AI, analytics, advertising, aggregation, or disclosed to any third party.
- [ ] Complete the real Strava acceptance test from the implementation plan: invite connect, newest-run-only seed, webhook processing, idempotent edits, cutoff and sport filtering, dashboard message change, and account deletion.
