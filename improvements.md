# Improvements

## Coolify build-log secret exposure (2026-08-25)

Coolify's generated Dockerfile included application environment variables as
build arguments during the initial Racegoal deployment. This made the Strava
client secret visible in that deployment's log. Keep all runtime credentials
out of build arguments before any retry, rotate the exposed Strava client
secret in Strava, replace it in Coolify, and restrict or remove the affected
deployment log if Coolify permits it.
