# racegoal

## Keep code DRY

Before writing logic, check whether it (or something close to it) already
exists elsewhere in `src/`. Extract shared logic into a function instead of
copy-pasting it across routes/views/services — the `loginHref` helper below
is the pattern to follow.

## Local dev auth bypass

Any link meant to log an athlete in or reconnect them (dashboard "reconnect",
homepage "Log in", etc.) must build its href with `loginHref(config)` from
`src/domain/localDev.js`, never a hardcoded `/login`. It points to the real
Strava OAuth flow in production and to `/dev/login` (the no-Strava dev
bypass) when `BASE_URL` is localhost/127.0.0.1. Hardcoding `/login` breaks
local testing of anything gated behind a session.

## Production infra

Racegoal runs on Harbor, managed via Coolify at
`https://coolify.tailb5b427.ts.net` (tailnet-only — reachable only when on the
Tailscale network; see `~/personal/infra` for the full infra docs/runbooks).
The Coolify API token lives in macOS Keychain under service `coolify-token`.

## Dev server

Once `npm run dev` is started for verification, leave it running — don't
kill it after checking a change. It auto-restarts on file changes
(`node --watch`), so it stays useful for the rest of the session.
