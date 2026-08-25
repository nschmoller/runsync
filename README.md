# runsync

Self-hosted Strava description messaging for new running activities.

## Local development

Node 24 is required. Run `nvm use`, `npm install`, then `npm run check`.

## Configuration

Copy `.env.example` and set the Strava client credentials, webhook verify token, `SESSION_SECRET`, default `APPEND_MESSAGE`, and public `BASE_URL`. Use a persistent `/data` volume: it contains the SQLite database and live refresh tokens.

## Deployment

Build with `docker build -t runsync .`. Run it with a mounted `/data` volume and your env file. Route the public HTTPS hostname to `/connect`, `/login`, `/oauth/callback`, `/dashboard`, `/disconnect`, `/webhook`, and `/healthz`.

After the callback is public, run `npm run create-subscription`; set the printed `STRAVA_SUBSCRIPTION_ID` and restart. Create athlete links with `npm run mint-invite`; each is single-use and expires after seven days.

Before production, complete the real Strava acceptance test from the implementation plan: invite connect, newest-run-only seed, webhook processing, idempotent edits, cutoff and sport filtering, dashboard message change, and disconnect.
