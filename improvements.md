# Improvements

## Coolify build-log secret exposure (2026-08-25)

Coolify's generated Dockerfile included application environment variables as
build arguments during the initial Racegoal deployment. This made the Strava
client secret visible in that deployment's log. Keep all runtime credentials
out of build arguments before any retry, rotate the exposed Strava client
secret in Strava, replace it in Coolify, and restrict or remove the affected
deployment log if Coolify permits it.

## Security review follow-ups (2026-08-26)

### Authenticate Strava webhook deliveries (high)

`POST /webhook` currently accepts arbitrary JSON and can trigger activity
processing or delete and deauthorize an athlete. `subscription_id` is only a
numeric filter, not proof that Strava sent the request. Require a webhook
signing secret, retain the raw request body, and verify Strava's
`X-Strava-Signature` HMAC with a timestamp window before acknowledging or
processing the event. Make `STRAVA_SUBSCRIPTION_ID` required as an additional
filter.

### Restrict local environment-file permissions (medium)

The local `.env` contains OAuth and session credentials but is mode `0644`.
Set it to `0600` and ensure production runtime secrets and the mounted
database are readable only by the service identity.

### Bound unauthenticated database work (medium)

Every unauthenticated `GET /login` writes an OAuth state that remains for ten
minutes, and webhook POSTs can enqueue work immediately. Add proxy and/or
application rate limits and cap outstanding OAuth states to prevent SQLite,
CPU, and shared Strava API quota exhaustion.

### Verify the build-log exposure remediation (high)

The 2026-08-25 Coolify build-log exposure above remains a security follow-up
until the Strava client secret has been rotated in Strava and Coolify, and the
affected deployment log has been restricted or removed where possible.
