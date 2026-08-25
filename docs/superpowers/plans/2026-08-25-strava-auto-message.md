# Strava Auto-Message Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "runsync", a self-hosted service that appends each athlete's chosen message to the description of their new Strava running activities, with an invite-gated OAuth connect flow and a per-athlete dashboard.

**Architecture:** Four layers with dependencies pointing inward. `domain/` is pure — no I/O, no clock, no database — and holds every decision the service makes. `adapters/` wraps the outside world (SQLite, the Strava HTTP API, the clock, the log stream, job dispatch). `services/` orchestrates: load state, ask the domain what to do, carry it out. `web/` parses requests, authorizes them, and renders HTML. `container.js` is the only place that knows how to wire the four together. Strava calls `POST /webhook`; the router answers `200` immediately and hands a typed job to a dispatcher, whose v1 implementation runs it inline under a per-activity lock.

**Tech Stack:** Node 24 LTS ("Krypton", 24.19.0 — the current LTS line; **not** Node 26, which is Current and unsuitable for a service that has to stay up), ESM JavaScript with JSDoc types checked by `tsc --noEmit` (no build step — the container runs `src/` directly), Express 5, better-sqlite3, the `cookie` package, `node:test` + `node:assert/strict`, `undici`'s `MockAgent` to intercept `fetch` in tests. HTML is rendered with tagged template literals that escape by default.

**Spec:** `docs/superpowers/specs/2026-08-25-strava-auto-message-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **Node 24 LTS, ESM only.** `"type": "module"`. No CommonJS, no transpiler, no bundler.
- **Layer discipline.** `domain/` imports nothing outside `domain/` and `ports/`. `adapters/` never imports `services/` or `web/`. `web/` never imports `adapters/` directly — it receives what it needs from the container. Task 1 installs a test that enforces this.
- **OAuth scope is `activity:read,activity:write`.** Never `activity:read_all`.
- **Message length cap: 200 characters**, after trimming.
- **`SPORT_TYPES` default: `Run,TrailRun`.** Never hardcode `"Run"`.
- **`POST /webhook` always answers `200`**, regardless of outcome. Hard Strava requirement.
- **Every detached chain ends in a `.catch()`.** An unhandled rejection kills the container.
- **Neither message form is ever prefilled with the default.** An empty input always means "on the default"; both forms quote the live `APPEND_MESSAGE` verbatim in a hint below the input, read from config, never hardcoded in a template.
- **`athletes.message = NULL` means "use `APPEND_MESSAGE`".**
- **Idempotency is anchored on the `processed_activities` table**, not on inspecting the description. The description check is a secondary back-fill guard and uses `includes`, never `endsWith`.
- **`activity_cutoff` only ever advances**, never moves backwards.
- **Invites are single-use, 7-day expiry. OAuth `state` rows have a 10-minute TTL** and are single-use.
- **Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`**, signed with `SESSION_SECRET`.
- **All athlete-supplied text is HTML-escaped when rendered.**
- **Rate limits:** every call counts against the tighter "non-upload" bucket of 100 / 15 min and 1,000 / day.
- **`data.sqlite` is created with mode `0600`.** It holds live refresh tokens.

## Architecture

### Dependency rule

```
web/  ──────┐
services/ ──┼──►  domain/  ◄── ports/ (typedefs only, zero runtime code)
adapters/ ──┘
                   ▲
container.js ──────┘  (the only module that constructs anything)
```

Arrows point toward the things that do not change when the outside world does. `domain/` is the stable core: it takes plain data and returns plain data. Every test in `domain/` runs with no mocks, no database, and no fake clock — that property is the whole point, and it is what makes new rules cheap to add later.

### Two seams built now for named future work

**A job dispatcher** (`ports.Dispatcher`). The webhook router never calls a service directly; it builds a typed job and dispatches it. The v1 adapter runs jobs inline under a keyed lock. Swapping in a durable queue later means writing one adapter and changing one line in `container.js` — no service or router changes. This is the spec's deferred "if volume grows, introduce a real job queue".

**An authorization seam** (`web/middleware/auth.js`). `requireAthlete` and `requireAdmin` are separate middlewares from day one, with `requireAdmin` gated on `ADMIN_ATHLETE_IDS`. The stores expose the list/aggregate queries an owner view needs (`athletes.list()`, `invites.list()`, `activities.count()`). The admin routes themselves are not built — the seam is, so adding them is additive.

Not built, deliberately: any abstraction over "fitness provider". There is exactly one, there will only ever be one, and a `StravaClient` that pretends otherwise would be pure ceremony.

### File structure

```
tsconfig.json                     checkJs, no emit
src/
  ports/index.js                  JSDoc typedefs only — the contracts every layer agrees on
  config.js                       env parsing and validation

  domain/                         PURE. no I/O, no clock, no db. tests use no mocks.
    errors.js                     ValidationError, ConflictError
    message.js                    validate / resolve / has / append
    rules.js                      decidePreFetch, decidePostFetch
    seeding.js                    computeCutoff, chooseSeedActivity

  adapters/
    clock.js                      systemClock()
    logger.js                     createLogger() — structured JSON lines, child loggers
    lock.js                       createKeyedLock()
    store/
      migrations/001_initial.sql
      migrator.js                 schema_migrations, applies files in order
      connection.js               openDatabase(path) — mode 0600
      athletes.js activities.js invites.js authStates.js
    strava/
      errors.js                   StravaError + isAuthError / isRateLimited
      client.js                   raw HTTP calls
      tokens.js                   createTokenProvider — per-athlete refresh lock
    dispatch/inline.js            createInlineDispatcher — per-key lock, detached catch

  services/
    jobs.js                       job constructors + jobKey
    activityProcessor.js          the webhook pipeline
    connectService.js             completeConnect + seedAthlete
    athleteService.js             updateMessage + disconnect

  web/
    html.js                       escapeHtml, html tag, raw
    views/connect.js views/dashboard.js views/layout.js
    middleware/auth.js            requireAthlete, requireAdmin
    session.js                    cookie sign/verify + CSRF
    routes/webhook.js routes/connect.js routes/oauth.js routes/dashboard.js
    app.js                        createApp(container)

  container.js                    composition root
  server.js                       entry point

scripts/mint-invite.js scripts/create-subscription.js
test/                             mirrors src/, plus test/architecture.test.js
```

---

## Task list

| # | Task | Layer |
|---|------|-------|
| 1 | Scaffold, typecheck, ports, architecture test | — |
| 2 | Versioned migrations and connection | adapters/store |
| 3 | Stores | adapters/store |
| 4 | Clock, logger, keyed lock | adapters |
| 5 | Domain: message | domain |
| 6 | Domain: rules and seeding | domain |
| 7 | Strava client and token provider | adapters/strava |
| 8 | Job dispatch | adapters/dispatch |
| 9 | Activity processor service | services |
| 10 | Connect and athlete services | services |
| 11 | Session, auth middleware, app shell, webhook routes | web |
| 12 | Views, connect and OAuth routes | web |
| 13 | Dashboard routes | web |
| 14 | Container, server, operational scripts | — |
| 15 | Docker packaging and runbook | — |

---

### Task 1: Scaffold, typecheck, ports, architecture test

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/ports/index.js`, `src/config.js`, `src/web/html.js`
- Test: `test/config.test.js`, `test/html.test.js`, `test/architecture.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `loadConfig(env = process.env) -> Config`, throwing on a missing required variable. `Config` = `{ clientId, clientSecret, webhookVerifyToken, subscriptionId: number|null, appendMessage, sportTypes: Set<string>, sessionSecret, baseUrl, port, dbPath, adminAthleteIds: Set<number>, logLevel }`.
  - `escapeHtml(value) -> string`, `html(strings, ...values) -> string`, `raw(s) -> {__raw: string}`.
  - `src/ports/index.js` — JSDoc typedefs, no runtime exports.

- [x] **Step 0: Node 24 LTS** — DONE 2026-08-25

Node **v24.19.0** (npm 11.17.0) is installed via nvm and set as the `default` alias. `.nvmrc` is committed pinning `24`.

Confirm before anything below: `node --version` must report `v24.x`. If it reports v22, run `nvm use` in the repo root. (`~/.zprofile` prepends `$NVM_BIN` when already set, re-pinning a shell to whatever version its parent was launched under, after `nvm.sh` selected the default. A fresh terminal or an explicit `nvm use` resolves it.)

`better-sqlite3` compiles a native binding against whichever Node ran `npm install`. Installing under 22 then testing under 24 fails with a `NODE_MODULE_VERSION` mismatch; `rm -rf node_modules && npm install` under 24 fixes it.

- [x] **Step 1: Initialize the package**

Create `package.json`:

```json
{
  "name": "runsync",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm test",
    "mint-invite": "node scripts/mint-invite.js",
    "create-subscription": "node scripts/create-subscription.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.5.0",
    "cookie": "^1.0.1",
    "express": "^5.0.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "typescript": "^5.6.0",
    "undici": "^6.20.0"
  }
}
```

Create `tsconfig.json` — type checking with no emit, so there is no build step:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "node16",
    "moduleResolution": "node16",
    "lib": ["es2023"],
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.js", "scripts/**/*.js", "test/**/*.js"]
}
```

Create `.gitignore` (`.nvmrc` is committed, not ignored):

```
node_modules/
data.sqlite
data.sqlite-*
.env
.env.local
```

Run: `npm install`

- [x] **Step 2: Write the ports**

Create `src/ports/index.js`. This file has **no runtime exports** — it is the vocabulary the four layers share, and the reason a domain function can be typed without importing an adapter.

```js
/**
 * Contracts shared across layers. Types only — this module emits no runtime code.
 * @module ports
 */

/**
 * @typedef {object} Config
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} webhookVerifyToken
 * @property {number|null} subscriptionId
 * @property {string} appendMessage
 * @property {Set<string>} sportTypes
 * @property {string} sessionSecret
 * @property {string} baseUrl
 * @property {number} port
 * @property {string} dbPath
 * @property {Set<number>} adminAthleteIds
 * @property {'debug'|'info'|'warn'|'error'} logLevel
 */

/**
 * A row from the athletes table. Snake_case because it comes straight from SQLite.
 * @typedef {object} Athlete
 * @property {number} athlete_id
 * @property {string|null} name
 * @property {string} refresh_token
 * @property {string} access_token
 * @property {number} expires_at
 * @property {'active'|'revoked'} status
 * @property {string|null} message
 * @property {number|null} message_updated_at
 * @property {number} activity_cutoff
 * @property {number|null} seed_activity_id
 * @property {number} processed_count
 * @property {number|null} last_activity_id
 * @property {number|null} last_processed_at
 * @property {string|null} last_error
 * @property {number|null} last_error_at
 * @property {number} created_at
 * @property {number|null} revoked_at
 */

/**
 * The subset of a Strava activity this service reads.
 * @typedef {object} Activity
 * @property {number} id
 * @property {string} sport_type
 * @property {string} start_date  ISO 8601
 * @property {string|null} [description]
 */

/**
 * @typedef {'unknown-athlete'|'revoked'|'already-processed'|'before-cutoff'|'wrong-sport'} SkipReason
 */

/**
 * Decided before any Strava call, so a re-delivery costs no rate-limit quota.
 * @typedef {{ action: 'skip', reason: SkipReason } | { action: 'fetch' }} PreFetchDecision
 */

/**
 * Decided after fetching the activity.
 * `record` means "already has the message — write the row, make no PUT".
 * @typedef {{ action: 'skip', reason: SkipReason }
 *          | { action: 'record', reason: 'backfill' }
 *          | { action: 'append', description: string }} PostFetchDecision
 */

/** @typedef {{ ok: true, value: string|null } | { ok: false, error: string }} ValidationResult */

/** @typedef {{ type: 'activity.process', athleteId: number, activityId: number }} ActivityJob */
/** @typedef {ActivityJob} Job */

/**
 * @typedef {object} Dispatcher
 * @property {(job: Job) => void} dispatch  Fire and forget. Never throws, never rejects.
 * @property {() => Promise<void>} drain    Resolves when all in-flight work has settled.
 */

/** @typedef {{ now: () => number }} Clock  unix seconds */

/**
 * @typedef {object} Logger
 * @property {(event: string, fields?: Record<string, unknown>) => void} debug
 * @property {(event: string, fields?: Record<string, unknown>) => void} info
 * @property {(event: string, fields?: Record<string, unknown>) => void} warn
 * @property {(event: string, fields?: Record<string, unknown>) => void} error
 * @property {(fields: Record<string, unknown>) => Logger} child
 */

/**
 * @typedef {object} AthleteStore
 * @property {(athleteId: number) => Athlete|undefined} get
 * @property {(input: {athleteId:number,name:string|null,refreshToken:string,accessToken:string,expiresAt:number,message:string|null,activityCutoff:number,now:number}) => void} insert
 * @property {(athleteId: number, tokens: {accessToken:string,refreshToken:string,expiresAt:number}) => void} updateTokens
 * @property {(athleteId: number, message: string|null, now: number) => void} setMessage
 * @property {(athleteId: number, activityId: number) => void} setSeedActivity
 * @property {(athleteId: number, cutoff: number) => void} advanceCutoff
 * @property {(athleteId: number, now: number) => void} markRevoked
 * @property {(athleteId: number, tokens: {accessToken:string,refreshToken:string,expiresAt:number}) => void} reactivate
 * @property {(athleteId: number, activityId: number, now: number) => void} recordSuccess
 * @property {(athleteId: number, message: string, now: number) => void} recordError
 * @property {() => Athlete[]} list
 * @property {() => number} countActive
 */

/**
 * @typedef {object} ActivityStore
 * @property {(activityId: number) => boolean} isProcessed
 * @property {(activityId: number, athleteId: number, now: number) => void} markProcessed
 * @property {(activityId: number) => void} deleteProcessed
 * @property {(athleteId: number, limit: number) => Array<{activity_id:number,appended_at:number}>} recentFor
 * @property {() => number} count
 */

/**
 * @typedef {object} InviteStore
 * @property {(input: {token:string,now:number,expiresAt:number}) => void} create
 * @property {(token: string, now: number) => {token:string,expires_at:number}|undefined} getUsable
 * @property {(token: string, athleteId: number, now: number) => boolean} consume
 * @property {() => Array<{token:string,created_at:number,expires_at:number,consumed_at:number|null,athlete_id:number|null}>} list
 */

/**
 * @typedef {object} AuthStateStore
 * @property {(input: {state:string,inviteToken:string|null,pendingMessage:string|null,now:number,expiresAt:number}) => void} create
 * @property {(state: string, now: number) => {state:string,invite_token:string|null,pending_message:string|null}|undefined} consume
 * @property {(now: number) => void} sweep
 */

/**
 * @typedef {object} StravaClient
 * @property {(code: string) => Promise<{athleteId:number,name:string,accessToken:string,refreshToken:string,expiresAt:number}>} exchangeCode
 * @property {(refreshToken: string) => Promise<{accessToken:string,refreshToken:string,expiresAt:number}>} refresh
 * @property {(token: string, activityId: number) => Promise<Activity>} getActivity
 * @property {(token: string, activityId: number, patch: {description: string}) => Promise<void>} updateActivity
 * @property {(token: string, perPage: number) => Promise<Activity[]>} listRecentActivities
 * @property {(token: string) => Promise<void>} deauthorize
 */

/** @typedef {{ accessTokenFor: (athlete: Athlete) => Promise<string> }} TokenProvider */

export {};
```

- [x] **Step 3: Write the failing config test**

Create `test/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const valid = {
  STRAVA_CLIENT_ID: '12345',
  STRAVA_CLIENT_SECRET: 'secret',
  STRAVA_WEBHOOK_VERIFY_TOKEN: 'verify',
  APPEND_MESSAGE: '🏃 Synced via runsync',
  SESSION_SECRET: 'a'.repeat(32),
  BASE_URL: 'https://runsync.example.com',
};

test('loads a valid environment', () => {
  const config = loadConfig(valid);
  assert.equal(config.clientId, '12345');
  assert.equal(config.appendMessage, '🏃 Synced via runsync');
  assert.equal(config.baseUrl, 'https://runsync.example.com');
  assert.equal(config.logLevel, 'info');
});

test('defaults SPORT_TYPES to Run and TrailRun', () => {
  const config = loadConfig(valid);
  assert.deepEqual([...config.sportTypes].sort(), ['Run', 'TrailRun'].sort());
  assert.ok(!config.sportTypes.has('Ride'));
});

test('parses an explicit SPORT_TYPES list, trimming whitespace', () => {
  const config = loadConfig({ ...valid, SPORT_TYPES: 'Run, VirtualRun ' });
  assert.deepEqual([...config.sportTypes].sort(), ['Run', 'VirtualRun']);
});

test('throws naming every missing required variable', () => {
  const { STRAVA_CLIENT_SECRET, SESSION_SECRET, ...rest } = valid;
  assert.throws(() => loadConfig(rest), (err) =>
    /STRAVA_CLIENT_SECRET/.test(err.message) && /SESSION_SECRET/.test(err.message));
});

test('rejects a short SESSION_SECRET', () => {
  assert.throws(() => loadConfig({ ...valid, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
});

test('strips a trailing slash from BASE_URL', () => {
  assert.equal(loadConfig({ ...valid, BASE_URL: 'https://x.example.com/' }).baseUrl, 'https://x.example.com');
});

test('subscriptionId is null when unset and a number when set', () => {
  assert.equal(loadConfig(valid).subscriptionId, null);
  assert.equal(loadConfig({ ...valid, STRAVA_SUBSCRIPTION_ID: '77' }).subscriptionId, 77);
});

test('adminAthleteIds is empty by default and parses a numeric list', () => {
  assert.equal(loadConfig(valid).adminAthleteIds.size, 0);
  const config = loadConfig({ ...valid, ADMIN_ATHLETE_IDS: '111, 222' });
  assert.ok(config.adminAthleteIds.has(111));
  assert.ok(config.adminAthleteIds.has(222));
});

test('rejects a non-numeric ADMIN_ATHLETE_IDS entry rather than silently ignoring it', () => {
  assert.throws(() => loadConfig({ ...valid, ADMIN_ATHLETE_IDS: '111,bob' }), /ADMIN_ATHLETE_IDS/);
});

test('rejects an unknown LOG_LEVEL', () => {
  assert.throws(() => loadConfig({ ...valid, LOG_LEVEL: 'chatty' }), /LOG_LEVEL/);
});
```

- [x] **Step 4: Run it to verify it fails**

Run: `npm test -- test/config.test.js`
Expected: FAIL — `Cannot find module '../src/config.js'`

- [x] **Step 5: Implement config**

Create `src/config.js`:

```js
/** @typedef {import('./ports/index.js').Config} Config */

const REQUIRED = [
  'STRAVA_CLIENT_ID',
  'STRAVA_CLIENT_SECRET',
  'STRAVA_WEBHOOK_VERIFY_TOKEN',
  'APPEND_MESSAGE',
  'SESSION_SECRET',
  'BASE_URL',
];

const DEFAULT_SPORT_TYPES = 'Run,TrailRun';
const MIN_SECRET_LENGTH = 32;
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/** @param {string|undefined} value @returns {string[]} */
function csv(value) {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key] || env[key].trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const sessionSecret = /** @type {string} */ (env.SESSION_SECRET);
  if (sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const sportTypes = new Set(csv(env.SPORT_TYPES ?? DEFAULT_SPORT_TYPES));
  if (sportTypes.size === 0) throw new Error('SPORT_TYPES must list at least one sport type');

  const adminAthleteIds = new Set(csv(env.ADMIN_ATHLETE_IDS).map((entry) => {
    if (!/^\d+$/.test(entry)) throw new Error(`ADMIN_ATHLETE_IDS contains a non-numeric entry: ${entry}`);
    return Number(entry);
  }));

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  }

  return {
    clientId: /** @type {string} */ (env.STRAVA_CLIENT_ID),
    clientSecret: /** @type {string} */ (env.STRAVA_CLIENT_SECRET),
    webhookVerifyToken: /** @type {string} */ (env.STRAVA_WEBHOOK_VERIFY_TOKEN),
    subscriptionId: env.STRAVA_SUBSCRIPTION_ID ? Number(env.STRAVA_SUBSCRIPTION_ID) : null,
    appendMessage: /** @type {string} */ (env.APPEND_MESSAGE),
    sportTypes,
    sessionSecret,
    baseUrl: /** @type {string} */ (env.BASE_URL).replace(/\/+$/, ''),
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? './data.sqlite',
    adminAthleteIds,
    logLevel: /** @type {'debug'|'info'|'warn'|'error'} */ (logLevel),
  };
}
```

- [x] **Step 6: Run the config test to verify it passes**

Run: `npm test -- test/config.test.js`
Expected: PASS, 10 tests

- [x] **Step 7: Write the failing HTML test**

Create `test/html.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, html, raw } from '../src/web/html.js';

test('escapes the five dangerous characters', () => {
  assert.equal(escapeHtml(`<script>&"'`), '&lt;script&gt;&amp;&quot;&#39;');
});

test('leaves emoji and accented characters intact', () => {
  assert.equal(escapeHtml('🏃 café'), '🏃 café');
});

test('renders null and undefined as empty, not as the words', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('the html tag escapes interpolated values', () => {
  assert.equal(html`<p>${'<script>alert(1)</script>'}</p>`, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('raw() opts a fragment out of escaping so templates compose', () => {
  assert.equal(html`<div>${raw(html`<b>${'safe'}</b>`)}</div>`, '<div><b>safe</b></div>');
});

test('arrays of raw fragments are joined without escaping', () => {
  const items = ['a', 'b'].map((s) => raw(html`<li>${s}</li>`));
  assert.equal(html`<ul>${items}</ul>`, '<ul><li>a</li><li>b</li></ul>');
});
```

- [x] **Step 8: Run it to verify it fails**

Run: `npm test -- test/html.test.js`
Expected: FAIL — `Cannot find module '../src/web/html.js'`

- [x] **Step 9: Implement the HTML helpers**

Create `src/web/html.js`:

```js
/** @typedef {{ __raw: string }} RawFragment */

const ENTITIES = /** @type {Record<string,string>} */ ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
});

/** @param {unknown} value @returns {string} */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/** @param {string} string @returns {RawFragment} */
export function raw(string) {
  return { __raw: String(string) };
}

/** @param {unknown} value @returns {string} */
function render(value) {
  if (Array.isArray(value)) return value.map(render).join('');
  if (value && typeof value === 'object' && '__raw' in value) {
    return /** @type {RawFragment} */ (value).__raw;
  }
  return escapeHtml(value);
}

/**
 * Tagged template that escapes every interpolated value.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {string}
 */
export function html(strings, ...values) {
  return strings.reduce(
    (out, chunk, i) => out + chunk + (i < values.length ? render(values[i]) : ''),
    '',
  );
}
```

- [x] **Step 10: Write the architecture test**

This is what keeps the layering honest once other people (and agents) start editing. It is a real test, run in CI, that fails the moment someone imports a database from the domain.

Create `test/architecture.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/** @param {string} file @returns {string[]} */
function importsOf(file) {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}

/** Resolve a relative specifier to a path relative to src/. */
function resolveWithin(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolute = path.resolve(path.dirname(file), specifier);
  return path.relative(SRC, absolute);
}

function violations(layer, isForbidden) {
  const found = [];
  for (const file of jsFiles(path.join(SRC, layer))) {
    for (const specifier of importsOf(file)) {
      const target = resolveWithin(file, specifier);
      if (target && isForbidden(target)) {
        found.push(`${path.relative(SRC, file)} imports ${target}`);
      }
    }
  }
  return found;
}

test('domain imports nothing outside domain and ports', () => {
  const found = violations('domain', (t) => !t.startsWith('domain/') && !t.startsWith('ports/'));
  assert.deepEqual(found, [], 'the domain layer must stay pure — no adapters, no services, no web');
});

test('domain never imports a node builtin with I/O', () => {
  const banned = /^(node:)?(fs|http|https|net|dgram|child_process|worker_threads)$/;
  const found = [];
  for (const file of jsFiles(path.join(SRC, 'domain'))) {
    for (const specifier of importsOf(file)) {
      if (banned.test(specifier)) found.push(`${path.relative(SRC, file)} imports ${specifier}`);
    }
  }
  assert.deepEqual(found, []);
});

test('adapters never import services or web', () => {
  const found = violations('adapters', (t) => t.startsWith('services/') || t.startsWith('web/'));
  assert.deepEqual(found, []);
});

test('services never import web', () => {
  const found = violations('services', (t) => t.startsWith('web/'));
  assert.deepEqual(found, []);
});

test('web never reaches directly into adapters — it receives them from the container', () => {
  const found = violations('web', (t) => t.startsWith('adapters/'));
  assert.deepEqual(found, [], 'route modules must take their dependencies as arguments');
});

test('nothing outside container.js and server.js imports container.js', () => {
  const found = [];
  for (const file of jsFiles(SRC)) {
    const name = path.relative(SRC, file);
    if (name === 'container.js' || name === 'server.js') continue;
    for (const specifier of importsOf(file)) {
      const target = resolveWithin(file, specifier);
      if (target === 'container.js') found.push(`${name} imports container.js`);
    }
  }
  assert.deepEqual(found, [], 'the composition root must have exactly two callers');
});
```

- [x] **Step 11: Run the architecture test**

Run: `npm test -- test/architecture.test.js`
Expected: PASS, 6 tests — trivially, since `src/domain/`, `src/adapters/`, and `src/services/` do not exist yet. It starts guarding real code from Task 2 onward.

- [x] **Step 12: Verify the typecheck passes**

Run: `npm run typecheck`
Expected: no output, exit 0.

If `tsc` complains about `express` or `better-sqlite3` types, confirm the `@types/*` devDependencies from Step 1 installed.

- [x] **Step 13: Write `.env.example`**

Create `.env.example`:

```
# Strava application credentials, from https://www.strava.com/settings/api
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=

# Arbitrary string we choose; echoed back during the webhook subscription handshake.
STRAVA_WEBHOOK_VERIFY_TOKEN=

# Set after running `npm run create-subscription`. Incoming events must match it.
STRAVA_SUBSCRIPTION_ID=

# Default message. Shown verbatim on the connect and dashboard pages, and used for
# every athlete who has not set their own. Changing this changes the message for
# every athlete still on the default.
APPEND_MESSAGE=🏃 Synced via runsync

# Comma-separated allowlist of Strava sport types to process.
SPORT_TYPES=Run,TrailRun

# Signs dashboard session cookies. Generate with: openssl rand -hex 32
SESSION_SECRET=

# Public HTTPS base URL, no trailing slash. Used to build the OAuth redirect URI.
BASE_URL=https://runsync.example.com

# Optional: Strava athlete ids allowed through requireAdmin. Empty means nobody.
ADMIN_ATHLETE_IDS=

PORT=3000
DB_PATH=./data.sqlite
LOG_LEVEL=info
```

- [x] **Step 14: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 22 tests pass

```bash
git add package.json package-lock.json tsconfig.json .nvmrc .gitignore .env.example \
        src/ports/index.js src/config.js src/web/html.js \
        test/config.test.js test/html.test.js test/architecture.test.js
git commit -m "feat: scaffold with layered structure, JSDoc typechecking, and architecture tests"
```

---

### Task 2: Versioned migrations and connection

**Files:**
- Create: `src/adapters/store/migrations/001_initial.sql`, `src/adapters/store/migrator.js`, `src/adapters/store/connection.js`
- Test: `test/store/migrator.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `migrate(db) -> {applied: number[], alreadyApplied: number[]}` — reads `migrations/*.sql`, applies unapplied ones in numeric order, each in a transaction, recording it in `schema_migrations`.
  - `openDatabase(path) -> Database` — opens, sets pragmas, migrates, and chmods a newly created file to `0600`.

Versioned migrations rather than `CREATE TABLE IF NOT EXISTS`: the schema will change (the spec already anticipates message templates and an admin view), and retrofitting migrations onto a live database holding real refresh tokens is the kind of job nobody wants at 11pm.

- [x] **Step 1: Write the initial migration**

Create `src/adapters/store/migrations/001_initial.sql`:

```sql
CREATE TABLE athletes (
  athlete_id         INTEGER PRIMARY KEY,
  name               TEXT,
  refresh_token      TEXT NOT NULL,
  access_token       TEXT NOT NULL,
  expires_at         INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  message            TEXT,
  message_updated_at INTEGER,
  activity_cutoff    INTEGER NOT NULL,
  seed_activity_id   INTEGER,
  processed_count    INTEGER NOT NULL DEFAULT 0,
  last_activity_id   INTEGER,
  last_processed_at  INTEGER,
  last_error         TEXT,
  last_error_at      INTEGER,
  created_at         INTEGER NOT NULL,
  revoked_at         INTEGER
);

CREATE TABLE processed_activities (
  activity_id INTEGER PRIMARY KEY,
  athlete_id  INTEGER NOT NULL,
  appended_at INTEGER NOT NULL
);

CREATE INDEX idx_processed_athlete ON processed_activities (athlete_id, appended_at DESC);

CREATE TABLE invites (
  token       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  athlete_id  INTEGER
);

CREATE TABLE oauth_states (
  state           TEXT PRIMARY KEY,
  invite_token    TEXT,
  pending_message TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER
);

CREATE INDEX idx_states_expiry ON oauth_states (expires_at);
```

- [x] **Step 2: Write the failing migrator test**

Create `test/store/migrator.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../src/adapters/store/migrator.js';
import { openDatabase } from '../../src/adapters/store/connection.js';

test('applies every migration once and records the versions', () => {
  const db = new Database(':memory:');
  const first = migrate(db);

  assert.ok(first.applied.includes(1));
  assert.deepEqual(first.alreadyApplied, []);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const expected of ['athletes', 'processed_activities', 'invites', 'oauth_states', 'schema_migrations']) {
    assert.ok(tables.includes(expected), `missing table ${expected}`);
  }
});

test('is idempotent — a second run applies nothing', () => {
  const db = new Database(':memory:');
  migrate(db);
  const second = migrate(db);

  assert.deepEqual(second.applied, []);
  assert.ok(second.alreadyApplied.includes(1));
});

test('applies migrations in numeric order, not lexicographic', () => {
  // 10 must come after 2. Naive string sorting would put "010" before "002" only
  // by luck of zero-padding; this asserts the parse-and-sort is numeric.
  const db = new Database(':memory:');
  const { applied } = migrate(db);
  assert.deepEqual([...applied].sort((a, b) => a - b), applied);
});

test('openDatabase creates the file with mode 0600 and a working schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runsync-'));
  const file = path.join(dir, 'data.sqlite');
  try {
    const db = openDatabase(file);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'the file holds live refresh tokens');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM athletes').get().n, 0);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('openDatabase reopens an existing database without re-migrating', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runsync-'));
  const file = path.join(dir, 'data.sqlite');
  try {
    openDatabase(file).close();
    const db = openDatabase(file);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 1);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npm test -- test/store/migrator.test.js`
Expected: FAIL — `Cannot find module '.../migrator.js'`

- [x] **Step 4: Implement the migrator**

Create `src/adapters/store/migrator.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('better-sqlite3').Database} Database */

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url).pathname;

/**
 * @returns {Array<{version: number, name: string, sql: string}>}
 */
function loadMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = /^(\d+)_/.exec(name);
      if (!match) throw new Error(`Migration ${name} must start with a number, e.g. 002_add_thing.sql`);
      return {
        version: Number(match[1]),
        name,
        sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'),
      };
    })
    // Numeric, not lexicographic: 10 must come after 2.
    .sort((a, b) => a.version - b.version);
}

/**
 * Applies every migration not yet recorded, each inside its own transaction.
 * @param {Database} db
 * @returns {{applied: number[], alreadyApplied: number[]}}
 */
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  const done = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );

  const applied = [];
  const alreadyApplied = [];

  for (const migration of loadMigrations()) {
    if (done.has(migration.version)) {
      alreadyApplied.push(migration.version);
      continue;
    }
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Math.floor(Date.now() / 1000));
    });
    run();
    applied.push(migration.version);
  }

  return { applied, alreadyApplied };
}
```

- [x] **Step 5: Implement the connection**

Create `src/adapters/store/connection.js`:

```js
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { migrate } from './migrator.js';

/**
 * @param {string} filePath
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(filePath) {
  const isNew = filePath !== ':memory:' && !fs.existsSync(filePath);
  const db = new Database(filePath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);

  // The file holds live refresh tokens — credentials for write access to
  // someone else's Strava account.
  if (isNew) fs.chmodSync(filePath, 0o600);

  return db;
}
```

- [x] **Step 6: Run the migrator tests to verify they pass**

Run: `npm test -- test/store/migrator.test.js`
Expected: PASS, 5 tests

- [x] **Step 7: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 27 tests pass

```bash
git add src/adapters/store/ test/store/migrator.test.js
git commit -m "feat: versioned SQL migrations and database connection"
```

---

### Task 3: Stores

**Files:**
- Create: `src/adapters/store/athletes.js`, `activities.js`, `invites.js`, `authStates.js`
- Create: `test/support/factories.js`
- Test: `test/store/athletes.test.js`, `test/store/activities.test.js`, `test/store/invites.test.js`, `test/store/authStates.test.js`

**Interfaces:**
- Consumes: `openDatabase` / `migrate` (Task 2), the store typedefs in `ports/` (Task 1).
- Produces: `createAthleteStore(db) -> AthleteStore`, `createActivityStore(db) -> ActivityStore`, `createInviteStore(db) -> InviteStore`, `createAuthStateStore(db) -> AuthStateStore` — exactly the shapes declared in `src/ports/index.js`.
- Also produces `test/support/factories.js`: `testDb()`, `testConfig(overrides)`, `fixedClock(t)`, `collectingLogger()`, `makeAthlete(store, overrides)`.

One store per aggregate rather than one `db.js` of free functions: each file stays small enough to hold in context, and the `list`/`count` queries an owner view needs have an obvious home.

- [x] **Step 1: Write the shared test factories**

Create `test/support/factories.js`:

```js
import Database from 'better-sqlite3';
import { migrate } from '../../src/adapters/store/migrator.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';

export const NOW = 1_800_000_000;

export function testDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

/** @param {number} [t] @returns {import('../../src/ports/index.js').Clock} */
export function fixedClock(t = NOW) {
  return { now: () => t };
}

/** A logger that records rather than prints, so tests can assert on events. */
export function collectingLogger() {
  const entries = [];
  const make = (context) => ({
    debug: (event, fields) => entries.push({ level: 'debug', event, ...context, ...fields }),
    info: (event, fields) => entries.push({ level: 'info', event, ...context, ...fields }),
    warn: (event, fields) => entries.push({ level: 'warn', event, ...context, ...fields }),
    error: (event, fields) => entries.push({ level: 'error', event, ...context, ...fields }),
    child: (fields) => make({ ...context, ...fields }),
  });
  const logger = make({});
  logger.entries = entries;
  return logger;
}

/** @param {Partial<import('../../src/ports/index.js').Config>} [overrides] */
export function testConfig(overrides = {}) {
  return {
    clientId: '12345',
    clientSecret: 'secret',
    webhookVerifyToken: 'verify',
    subscriptionId: 77,
    appendMessage: '🏃 Synced via runsync',
    sportTypes: new Set(['Run', 'TrailRun']),
    sessionSecret: 'a'.repeat(32),
    baseUrl: 'https://runsync.example.com',
    port: 3000,
    dbPath: ':memory:',
    adminAthleteIds: new Set(),
    logLevel: /** @type {const} */ ('info'),
    ...overrides,
  };
}

/**
 * Inserts an athlete and returns the stored row.
 * @param {import('better-sqlite3').Database} db
 */
export function makeAthlete(db, overrides = {}) {
  const store = createAthleteStore(db);
  const input = {
    athleteId: 987654,
    name: 'Test Athlete',
    refreshToken: 'refresh-1',
    accessToken: 'access-1',
    expiresAt: NOW + 21_600,
    message: null,
    activityCutoff: NOW - 100_000,
    now: NOW,
    ...overrides,
  };
  store.insert(input);
  return store.get(input.athleteId);
}
```

- [x] **Step 2: Write the failing athlete store test**

Create `test/store/athletes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';

test('insert defaults to active on the shared message', () => {
  const db = testDb();
  const athlete = makeAthlete(db);
  assert.equal(athlete.status, 'active');
  assert.equal(athlete.message, null);
  assert.equal(athlete.processed_count, 0);
});

test('get returns undefined for an unknown athlete', () => {
  assert.equal(createAthleteStore(testDb()).get(404404), undefined);
});

test('updateTokens replaces all three token fields', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);
  store.updateTokens(987654, { accessToken: 'a2', refreshToken: 'r2', expiresAt: 123 });
  const athlete = store.get(987654);
  assert.equal(athlete.access_token, 'a2');
  assert.equal(athlete.refresh_token, 'r2');
  assert.equal(athlete.expires_at, 123);
});

test('setMessage stores text and stamps the timestamp; null reverts to the default', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);

  store.setMessage(987654, 'my own words', NOW);
  assert.equal(store.get(987654).message, 'my own words');
  assert.equal(store.get(987654).message_updated_at, NOW);

  store.setMessage(987654, null, NOW + 5);
  assert.equal(store.get(987654).message, null);
});

test('advanceCutoff moves forward but never backwards', () => {
  const db = testDb();
  makeAthlete(db, { activityCutoff: 1000 });
  const store = createAthleteStore(db);

  store.advanceCutoff(987654, 2000);
  assert.equal(store.get(987654).activity_cutoff, 2000);
  store.advanceCutoff(987654, 500);
  assert.equal(store.get(987654).activity_cutoff, 2000);
  store.advanceCutoff(987654, 2000);
  assert.equal(store.get(987654).activity_cutoff, 2000);
});

test('markRevoked and reactivate flip status', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);

  store.markRevoked(987654, NOW);
  assert.equal(store.get(987654).status, 'revoked');
  assert.equal(store.get(987654).revoked_at, NOW);

  store.reactivate(987654, { accessToken: 'a3', refreshToken: 'r3', expiresAt: 999 });
  const athlete = store.get(987654);
  assert.equal(athlete.status, 'active');
  assert.equal(athlete.revoked_at, null);
  assert.equal(athlete.access_token, 'a3');
});

test('recordSuccess bumps the counter and clears the last error', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);

  store.recordError(987654, 'boom', NOW);
  store.recordSuccess(987654, 555, NOW + 10);

  const athlete = store.get(987654);
  assert.equal(athlete.processed_count, 1);
  assert.equal(athlete.last_activity_id, 555);
  assert.equal(athlete.last_processed_at, NOW + 10);
  assert.equal(athlete.last_error, null);
  assert.equal(athlete.last_error_at, null);
});

test('recordError truncates a very long message rather than bloating the row', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);
  store.recordError(987654, 'x'.repeat(5000), NOW);
  assert.ok(store.get(987654).last_error.length <= 500);
});

test('list and countActive support an owner view', () => {
  const db = testDb();
  makeAthlete(db, { athleteId: 1 });
  makeAthlete(db, { athleteId: 2 });
  const store = createAthleteStore(db);
  store.markRevoked(2, NOW);

  assert.equal(store.list().length, 2);
  assert.equal(store.countActive(), 1);
});

test('insert on an existing athlete refreshes tokens and reactivates, preserving their message and cutoff', () => {
  const db = testDb();
  makeAthlete(db, { message: 'mine', activityCutoff: 5000 });
  const store = createAthleteStore(db);
  store.markRevoked(987654, NOW);

  store.insert({
    athleteId: 987654, name: 'Test Athlete', refreshToken: 'r9', accessToken: 'a9',
    expiresAt: NOW + 100, message: null, activityCutoff: 1, now: NOW,
  });

  const athlete = store.get(987654);
  assert.equal(athlete.status, 'active');
  assert.equal(athlete.access_token, 'a9');
  assert.equal(athlete.message, 'mine', 'a reconnect must not silently wipe their message');
  assert.equal(athlete.activity_cutoff, 5000, 'and must not move the cutoff backwards');
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npm test -- test/store/athletes.test.js`
Expected: FAIL — `Cannot find module '.../athletes.js'`

- [x] **Step 4: Implement the athlete store**

Create `src/adapters/store/athletes.js`:

```js
/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../../ports/index.js').Athlete} Athlete */
/** @typedef {import('../../ports/index.js').AthleteStore} AthleteStore */

const MAX_ERROR_LENGTH = 500;

/**
 * @param {Database} db
 * @returns {AthleteStore}
 */
export function createAthleteStore(db) {
  const statements = {
    get: db.prepare('SELECT * FROM athletes WHERE athlete_id = ?'),
    insert: db.prepare(`
      INSERT INTO athletes (athlete_id, name, refresh_token, access_token, expires_at,
                            status, message, message_updated_at, activity_cutoff, created_at)
      VALUES (@athleteId, @name, @refreshToken, @accessToken, @expiresAt,
              'active', @message, @messageUpdatedAt, @activityCutoff, @now)
      ON CONFLICT(athlete_id) DO UPDATE SET
        name = excluded.name,
        refresh_token = excluded.refresh_token,
        access_token = excluded.access_token,
        expires_at = excluded.expires_at,
        status = 'active',
        revoked_at = NULL
    `),
    updateTokens: db.prepare(`
      UPDATE athletes SET access_token = ?, refresh_token = ?, expires_at = ? WHERE athlete_id = ?
    `),
    setMessage: db.prepare('UPDATE athletes SET message = ?, message_updated_at = ? WHERE athlete_id = ?'),
    setSeedActivity: db.prepare('UPDATE athletes SET seed_activity_id = ? WHERE athlete_id = ?'),
    advanceCutoff: db.prepare(`
      UPDATE athletes SET activity_cutoff = ? WHERE athlete_id = ? AND activity_cutoff < ?
    `),
    markRevoked: db.prepare(`UPDATE athletes SET status = 'revoked', revoked_at = ? WHERE athlete_id = ?`),
    reactivate: db.prepare(`
      UPDATE athletes SET status = 'active', revoked_at = NULL,
             access_token = ?, refresh_token = ?, expires_at = ?
      WHERE athlete_id = ?
    `),
    recordSuccess: db.prepare(`
      UPDATE athletes SET processed_count = processed_count + 1, last_activity_id = ?,
             last_processed_at = ?, last_error = NULL, last_error_at = NULL
      WHERE athlete_id = ?
    `),
    recordError: db.prepare('UPDATE athletes SET last_error = ?, last_error_at = ? WHERE athlete_id = ?'),
    list: db.prepare('SELECT * FROM athletes ORDER BY created_at DESC'),
    countActive: db.prepare(`SELECT COUNT(*) AS n FROM athletes WHERE status = 'active'`),
  };

  return {
    get: (athleteId) => /** @type {Athlete|undefined} */ (statements.get.get(athleteId)),

    insert: (input) => {
      // ON CONFLICT deliberately does NOT touch message or activity_cutoff: a
      // reconnect must not wipe the athlete's own text or reopen their history.
      statements.insert.run({
        ...input,
        messageUpdatedAt: input.message === null ? null : input.now,
      });
    },

    updateTokens: (athleteId, { accessToken, refreshToken, expiresAt }) =>
      void statements.updateTokens.run(accessToken, refreshToken, expiresAt, athleteId),

    setMessage: (athleteId, message, now) =>
      void statements.setMessage.run(message, now, athleteId),

    setSeedActivity: (athleteId, activityId) =>
      void statements.setSeedActivity.run(activityId, athleteId),

    advanceCutoff: (athleteId, cutoff) =>
      void statements.advanceCutoff.run(cutoff, athleteId, cutoff),

    markRevoked: (athleteId, now) => void statements.markRevoked.run(now, athleteId),

    reactivate: (athleteId, { accessToken, refreshToken, expiresAt }) =>
      void statements.reactivate.run(accessToken, refreshToken, expiresAt, athleteId),

    recordSuccess: (athleteId, activityId, now) =>
      void statements.recordSuccess.run(activityId, now, athleteId),

    recordError: (athleteId, message, now) =>
      void statements.recordError.run(String(message).slice(0, MAX_ERROR_LENGTH), now, athleteId),

    list: () => /** @type {Athlete[]} */ (statements.list.all()),

    countActive: () => /** @type {{n: number}} */ (statements.countActive.get()).n,
  };
}
```

- [x] **Step 5: Run the athlete store tests**

Run: `npm test -- test/store/athletes.test.js`
Expected: PASS, 10 tests

- [x] **Step 6: Write the failing tests for the other three stores**

Create `test/store/activities.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, NOW } from '../support/factories.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';

test('records, reports, and clears a processed activity', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createActivityStore(db);

  assert.equal(store.isProcessed(555), false);
  store.markProcessed(555, 987654, NOW);
  assert.equal(store.isProcessed(555), true);
  store.deleteProcessed(555);
  assert.equal(store.isProcessed(555), false);
});

test('markProcessed is idempotent on a repeated activity id', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createActivityStore(db);
  store.markProcessed(555, 987654, NOW);
  assert.doesNotThrow(() => store.markProcessed(555, 987654, NOW + 5));
  assert.equal(store.count(), 1);
});

test('recentFor returns one athlete newest-first, limited, and never another athlete', () => {
  const db = testDb();
  makeAthlete(db, { athleteId: 1 });
  makeAthlete(db, { athleteId: 2 });
  const store = createActivityStore(db);

  store.markProcessed(10, 1, NOW - 30);
  store.markProcessed(11, 1, NOW - 10);
  store.markProcessed(12, 1, NOW - 20);
  store.markProcessed(99, 2, NOW);

  const recent = store.recentFor(1, 2);
  assert.deepEqual(recent.map((r) => r.activity_id), [11, 12]);
});
```

Create `test/store/invites.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, NOW } from '../support/factories.js';
import { createInviteStore } from '../../src/adapters/store/invites.js';

const DAY = 86_400;

test('getUsable rejects unknown, expired, and consumed invites', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createInviteStore(db);

  store.create({ token: 'good', now: NOW, expiresAt: NOW + 7 * DAY });
  store.create({ token: 'stale', now: NOW - 8 * DAY, expiresAt: NOW - DAY });

  assert.ok(store.getUsable('good', NOW));
  assert.equal(store.getUsable('stale', NOW), undefined);
  assert.equal(store.getUsable('never-minted', NOW), undefined);

  assert.equal(store.consume('good', 987654, NOW), true);
  assert.equal(store.getUsable('good', NOW), undefined);
});

test('consume returns false the second time, so a replayed callback cannot reuse a slot', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createInviteStore(db);
  store.create({ token: 'once', now: NOW, expiresAt: NOW + 7 * DAY });

  assert.equal(store.consume('once', 987654, NOW), true);
  assert.equal(store.consume('once', 987654, NOW), false);
});

test('list exposes state for an owner view', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createInviteStore(db);
  store.create({ token: 'a', now: NOW, expiresAt: NOW + 7 * DAY });
  store.create({ token: 'b', now: NOW, expiresAt: NOW + 7 * DAY });
  store.consume('a', 987654, NOW);

  const rows = store.list();
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.consumed_at !== null).length, 1);
});
```

Create `test/store/authStates.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, NOW } from '../support/factories.js';
import { createAuthStateStore } from '../../src/adapters/store/authStates.js';

test('consume returns the row once, then never again', () => {
  const store = createAuthStateStore(testDb());
  store.create({ state: 's1', inviteToken: 'tok', pendingMessage: 'hi', now: NOW, expiresAt: NOW + 600 });

  const row = store.consume('s1', NOW);
  assert.equal(row.invite_token, 'tok');
  assert.equal(row.pending_message, 'hi');
  assert.equal(store.consume('s1', NOW), undefined, 'state is single-use');
});

test('consume rejects unknown and expired states', () => {
  const store = createAuthStateStore(testDb());
  store.create({ state: 'old', inviteToken: null, pendingMessage: null, now: NOW - 3600, expiresAt: NOW - 60 });

  assert.equal(store.consume('old', NOW), undefined);
  assert.equal(store.consume('nonexistent', NOW), undefined);
});

test('sweep deletes expired rows so the table cannot grow without bound', () => {
  const db = testDb();
  const store = createAuthStateStore(db);
  store.create({ state: 'old', inviteToken: null, pendingMessage: null, now: NOW - 3600, expiresAt: NOW - 60 });
  store.create({ state: 'fresh', inviteToken: null, pendingMessage: null, now: NOW, expiresAt: NOW + 600 });

  store.sweep(NOW);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n, 1);
  assert.ok(store.consume('fresh', NOW));
});
```

- [x] **Step 7: Run them to verify they fail**

Run: `npm test -- test/store/`
Expected: FAIL — three `Cannot find module` errors

- [x] **Step 8: Implement the remaining three stores**

Create `src/adapters/store/activities.js`:

```js
/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../../ports/index.js').ActivityStore} ActivityStore */

/**
 * The durable idempotency record. Once an activity has a row here, the service
 * never touches it again — which is also what makes an athlete's deletion of
 * the message stick.
 * @param {Database} db
 * @returns {ActivityStore}
 */
export function createActivityStore(db) {
  const statements = {
    isProcessed: db.prepare('SELECT 1 FROM processed_activities WHERE activity_id = ?'),
    markProcessed: db.prepare(`
      INSERT OR IGNORE INTO processed_activities (activity_id, athlete_id, appended_at)
      VALUES (?, ?, ?)
    `),
    deleteProcessed: db.prepare('DELETE FROM processed_activities WHERE activity_id = ?'),
    recentFor: db.prepare(`
      SELECT activity_id, appended_at FROM processed_activities
      WHERE athlete_id = ? ORDER BY appended_at DESC LIMIT ?
    `),
    count: db.prepare('SELECT COUNT(*) AS n FROM processed_activities'),
  };

  return {
    isProcessed: (activityId) => statements.isProcessed.get(activityId) !== undefined,
    markProcessed: (activityId, athleteId, now) =>
      void statements.markProcessed.run(activityId, athleteId, now),
    deleteProcessed: (activityId) => void statements.deleteProcessed.run(activityId),
    recentFor: (athleteId, limit) =>
      /** @type {Array<{activity_id:number,appended_at:number}>} */ (statements.recentFor.all(athleteId, limit)),
    count: () => /** @type {{n:number}} */ (statements.count.get()).n,
  };
}
```

Create `src/adapters/store/invites.js`:

```js
/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../../ports/index.js').InviteStore} InviteStore */

/**
 * Slot control for the Standard Tier 10-athlete cap.
 * @param {Database} db
 * @returns {InviteStore}
 */
export function createInviteStore(db) {
  const statements = {
    create: db.prepare('INSERT INTO invites (token, created_at, expires_at) VALUES (?, ?, ?)'),
    getUsable: db.prepare(`
      SELECT * FROM invites WHERE token = ? AND consumed_at IS NULL AND expires_at > ?
    `),
    consume: db.prepare(`
      UPDATE invites SET consumed_at = ?, athlete_id = ? WHERE token = ? AND consumed_at IS NULL
    `),
    list: db.prepare('SELECT * FROM invites ORDER BY created_at DESC'),
  };

  return {
    create: ({ token, now, expiresAt }) => void statements.create.run(token, now, expiresAt),
    getUsable: (token, now) => /** @type {any} */ (statements.getUsable.get(token, now)),
    // The UPDATE ... WHERE consumed_at IS NULL is the single-use guarantee: a
    // replayed callback loses the race and gets false.
    consume: (token, athleteId, now) => statements.consume.run(now, athleteId, token).changes === 1,
    list: () => /** @type {any[]} */ (statements.list.all()),
  };
}
```

Create `src/adapters/store/authStates.js`:

```js
/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../../ports/index.js').AuthStateStore} AuthStateStore */

/**
 * CSRF protection for the OAuth round trip, and the carrier for the invite
 * token and the message chosen on the connect page — neither of which may be
 * read back from a user-supplied query parameter.
 * @param {Database} db
 * @returns {AuthStateStore}
 */
export function createAuthStateStore(db) {
  const statements = {
    create: db.prepare(`
      INSERT INTO oauth_states (state, invite_token, pending_message, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    claim: db.prepare(`
      UPDATE oauth_states SET consumed_at = ?
      WHERE state = ? AND consumed_at IS NULL AND expires_at > ?
    `),
    read: db.prepare('SELECT * FROM oauth_states WHERE state = ?'),
    sweep: db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?'),
  };

  const consume = db.transaction((state, now) => {
    if (statements.claim.run(now, state, now).changes !== 1) return undefined;
    return statements.read.get(state);
  });

  return {
    create: ({ state, inviteToken, pendingMessage, now, expiresAt }) => {
      statements.sweep.run(now);
      statements.create.run(state, inviteToken, pendingMessage, now, expiresAt);
    },
    consume: (state, now) => /** @type {any} */ (consume(state, now)),
    sweep: (now) => void statements.sweep.run(now),
  };
}
```

- [x] **Step 9: Run the store tests**

Run: `npm test -- test/store/`
Expected: PASS, 24 tests across four files

- [x] **Step 10: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 51 tests pass

```bash
git add src/adapters/store/ test/store/ test/support/factories.js
git commit -m "feat: per-aggregate stores with owner-view queries"
```

---

### Task 4: Clock, logger, and keyed lock

**Files:**
- Create: `src/adapters/clock.js`, `src/adapters/logger.js`, `src/adapters/lock.js`
- Test: `test/adapters/logger.test.js`, `test/adapters/lock.test.js`

**Interfaces:**
- Consumes: the `Clock` and `Logger` typedefs (Task 1).
- Produces:
  - `systemClock() -> Clock` — `{ now(): number }` in unix seconds.
  - `createLogger({ level, stream }) -> Logger` — one JSON object per line, with `child(fields)` returning a logger that merges those fields into every entry.
  - `createKeyedLock() -> withLock(key, fn) -> Promise<T>` — calls sharing a key run one after another; different keys run concurrently.

The lock is one primitive used twice: per-athlete around token refresh (Task 7) and per-activity around job execution (Task 8). Injecting the clock rather than calling `Date.now()` inside services is what lets every downstream test assert on exact timestamps.

- [x] **Step 1: Write the clock**

Create `src/adapters/clock.js`:

```js
/** @typedef {import('../ports/index.js').Clock} Clock */

/**
 * Unix seconds. Injected everywhere rather than called inline, so tests can
 * assert exact timestamps without freezing global time.
 * @returns {Clock}
 */
export function systemClock() {
  return { now: () => Math.floor(Date.now() / 1000) };
}
```

- [x] **Step 2: Write the failing logger test**

Create `test/adapters/logger.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/adapters/logger.js';

function capture(level = 'info') {
  const lines = [];
  const stream = { write: (line) => lines.push(line) };
  return { logger: createLogger({ level, stream }), lines, parsed: () => lines.map((l) => JSON.parse(l)) };
}

test('writes one JSON object per line with level, event, and time', () => {
  const { logger, lines, parsed } = capture();
  logger.info('activity.appended', { athleteId: 1, activityId: 555 });

  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('\n'));
  const entry = parsed()[0];
  assert.equal(entry.level, 'info');
  assert.equal(entry.event, 'activity.appended');
  assert.equal(entry.athleteId, 1);
  assert.equal(typeof entry.time, 'string');
});

test('suppresses entries below the configured level', () => {
  const { logger, lines } = capture('warn');
  logger.debug('noise');
  logger.info('also noise');
  logger.warn('kept');
  logger.error('kept too');
  assert.equal(lines.length, 2);
});

test('child loggers merge their context into every entry', () => {
  const { logger, parsed } = capture();
  const scoped = logger.child({ athleteId: 42 });
  scoped.info('token.refreshed');
  assert.equal(parsed()[0].athleteId, 42);
});

test('child context nests and the innermost wins', () => {
  const { logger, parsed } = capture();
  logger.child({ athleteId: 1, source: 'webhook' }).child({ athleteId: 2 }).info('e');
  assert.equal(parsed()[0].athleteId, 2);
  assert.equal(parsed()[0].source, 'webhook');
});

test('call-site fields override child context', () => {
  const { logger, parsed } = capture();
  logger.child({ athleteId: 1 }).info('e', { athleteId: 9 });
  assert.equal(parsed()[0].athleteId, 9);
});

test('survives a value that cannot be serialized rather than throwing mid-request', () => {
  const { logger, lines } = capture();
  const circular = /** @type {any} */ ({});
  circular.self = circular;
  assert.doesNotThrow(() => logger.info('e', { circular }));
  assert.equal(lines.length, 1);
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npm test -- test/adapters/logger.test.js`
Expected: FAIL — `Cannot find module '.../logger.js'`

- [x] **Step 4: Implement the logger**

Create `src/adapters/logger.js`:

```js
/** @typedef {import('../ports/index.js').Logger} Logger */

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON-lines logging. Events are dotted names (`activity.appended`),
 * not sentences, so they can be grepped and counted.
 *
 * @param {{ level?: 'debug'|'info'|'warn'|'error', stream?: { write: (line: string) => void } }} [options]
 * @returns {Logger}
 */
export function createLogger({ level = 'info', stream = process.stdout } = {}) {
  const threshold = ORDER[level];

  /** @param {Record<string, unknown>} context @returns {Logger} */
  function build(context) {
    /** @param {'debug'|'info'|'warn'|'error'} entryLevel */
    const emit = (entryLevel) => (event, fields = {}) => {
      if (ORDER[entryLevel] < threshold) return;
      const entry = { time: new Date().toISOString(), level: entryLevel, event, ...context, ...fields };
      let line;
      try {
        line = JSON.stringify(entry);
      } catch {
        // A caller passing something unserializable must not take down the
        // request that was trying to log it.
        line = JSON.stringify({ time: entry.time, level: entryLevel, event, logError: 'unserializable fields' });
      }
      stream.write(`${line}\n`);
    };

    return {
      debug: emit('debug'),
      info: emit('info'),
      warn: emit('warn'),
      error: emit('error'),
      child: (fields) => build({ ...context, ...fields }),
    };
  }

  return build({});
}
```

- [x] **Step 5: Write the failing lock test**

Create `test/adapters/lock.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedLock } from '../../src/adapters/lock.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('serializes work sharing a key', async () => {
  const withLock = createKeyedLock();
  const events = [];
  const job = (name) => async () => {
    events.push(`${name}:start`);
    await tick();
    await tick();
    events.push(`${name}:end`);
  };
  await Promise.all([withLock('a', job('one')), withLock('a', job('two'))]);
  assert.deepEqual(events, ['one:start', 'one:end', 'two:start', 'two:end']);
});

test('runs different keys concurrently', async () => {
  const withLock = createKeyedLock();
  const events = [];
  const job = (name) => async () => {
    events.push(`${name}:start`);
    await tick();
    events.push(`${name}:end`);
  };
  await Promise.all([withLock('a', job('one')), withLock('b', job('two'))]);
  assert.deepEqual(events, ['one:start', 'two:start', 'one:end', 'two:end']);
});

test('returns the function result to the caller', async () => {
  assert.equal(await createKeyedLock()('a', async () => 42), 42);
});

test('propagates a rejection to that caller only, and the queue keeps moving', async () => {
  const withLock = createKeyedLock();
  const failing = withLock('a', async () => { throw new Error('boom'); });
  const following = withLock('a', async () => 'still ran');

  await assert.rejects(failing, /boom/);
  assert.equal(await following, 'still ran');
});

test('releases the key once the queue drains, so the map cannot grow forever', async () => {
  const withLock = createKeyedLock();
  await withLock('a', async () => {});
  await tick();
  assert.equal(withLock.size(), 0);
});

test('a rejection inside the lock never surfaces as an unhandled rejection', async () => {
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const withLock = createKeyedLock();
    await withLock('a', async () => { throw new Error('boom'); }).catch(() => {});
    await tick();
    await tick();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, []);
});

test('a synchronous throw inside fn is still serialized, not escaped', async () => {
  const withLock = createKeyedLock();
  const failing = withLock('a', () => { throw new Error('sync boom'); });
  const following = withLock('a', async () => 'ran after');

  await assert.rejects(failing, /sync boom/);
  assert.equal(await following, 'ran after');
});
```

- [x] **Step 6: Run it to verify it fails**

Run: `npm test -- test/adapters/lock.test.js`
Expected: FAIL — `Cannot find module '.../lock.js'`

- [x] **Step 7: Implement the lock**

Create `src/adapters/lock.js`:

```js
/**
 * Serializes async work per key.
 *
 * The map read and the map write below MUST stay synchronous — they happen in
 * one tick, before any `await`. Introducing an `await` between the `get` and
 * the `set` reopens exactly the interleaving this lock exists to close.
 *
 * @returns {(<T>(key: string|number, fn: () => Promise<T>|T) => Promise<T>) & { size: () => number }}
 */
export function createKeyedLock() {
  /** @type {Map<string|number, Promise<void>>} */
  const inFlight = new Map();

  const withLock = (key, fn) => {
    const previous = inFlight.get(key) ?? Promise.resolve();
    // Wrapping fn() in the .then callback means a synchronous throw becomes a
    // rejection of `result` rather than escaping past the bookkeeping below.
    const result = previous.then(() => fn());

    // `settled` never rejects, so holding it in the map can never produce an
    // unhandled rejection for a caller that has already handled its own.
    const settled = result.then(() => {}, () => {});
    const guarded = settled.finally(() => {
      if (inFlight.get(key) === guarded) inFlight.delete(key);
    });
    inFlight.set(key, guarded);

    return result;
  };

  withLock.size = () => inFlight.size;
  return withLock;
}
```

- [x] **Step 8: Run the adapter tests**

Run: `npm test -- test/adapters/`
Expected: PASS, 13 tests

- [x] **Step 9: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 64 tests pass

```bash
git add src/adapters/clock.js src/adapters/logger.js src/adapters/lock.js test/adapters/
git commit -m "feat: clock, structured logger, and keyed lock adapters"
```

---

### Task 5: Domain — message

**Files:**
- Create: `src/domain/errors.js`, `src/domain/message.js`
- Test: `test/domain/message.test.js`

**Interfaces:**
- Consumes: nothing. This is the first module of the pure core — it imports no adapter, no clock, no database, and its tests use no mocks.
- Produces:
  - `MAX_MESSAGE_LENGTH = 200`
  - `validateMessage(raw) -> ValidationResult` — `{ ok: true, value: string|null }` where `null` means "use the default", or `{ ok: false, error }`.
  - `resolveMessage(athlete, config) -> string` — `athlete.message ?? config.appendMessage`.
  - `hasMessage(description, message) -> boolean` — `includes`, never `endsWith`.
  - `appendMessage(description, message) -> string`
  - `ValidationError`, `ConflictError` from `src/domain/errors.js`.

If message templating is ever added, it lands in this one file and nothing else moves.

- [x] **Step 1: Write the domain errors**

Create `src/domain/errors.js`:

```js
/** A caller-supplied value the domain refuses. Maps to HTTP 400. */
export class ValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** A request that conflicts with stored state — a consumed invite, a replayed state. Maps to HTTP 409/403. */
export class ConflictError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}
```

- [x] **Step 2: Write the failing message test**

Create `test/domain/message.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMessage, resolveMessage, hasMessage, appendMessage, MAX_MESSAGE_LENGTH,
} from '../../src/domain/message.js';

const config = { appendMessage: '🏃 Synced via runsync' };

test('trims surrounding whitespace', () => {
  assert.deepEqual(validateMessage('  hello  '), { ok: true, value: 'hello' });
});

test('blank, whitespace-only, undefined, and null all mean "use the default"', () => {
  for (const input of ['', '   \n  ', undefined, null]) {
    assert.deepEqual(validateMessage(input), { ok: true, value: null });
  }
});

test('accepts exactly the cap and rejects one character more', () => {
  assert.equal(validateMessage('x'.repeat(MAX_MESSAGE_LENGTH)).ok, true);
  const tooLong = validateMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1));
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error, /200/);
});

test('measures length after cleaning, so trailing whitespace cannot fail a valid message', () => {
  assert.equal(validateMessage(`${'x'.repeat(MAX_MESSAGE_LENGTH)}    `).ok, true);
});

test('keeps emoji and accents intact', () => {
  assert.deepEqual(validateMessage('🏃 café'), { ok: true, value: '🏃 café' });
});

test('strips control characters but keeps newlines', () => {
  assert.deepEqual(validateMessage('a bc\nd'), { ok: true, value: 'abc\nd' });
});

test('normalizes CRLF and collapses runs of blank lines', () => {
  assert.deepEqual(validateMessage('a\r\nb\n\n\n\nc'), { ok: true, value: 'a\nb\n\nc' });
});

test('resolveMessage falls back to the configured default only when the athlete has none', () => {
  assert.equal(resolveMessage({ message: null }, config), '🏃 Synced via runsync');
  assert.equal(resolveMessage({ message: 'mine' }, config), 'mine');
});

test('hasMessage matches anywhere, not only at the end', () => {
  const msg = '🏃 Synced via runsync';
  assert.equal(hasMessage(`Great run!\n\n${msg}`, msg), true);
  assert.equal(hasMessage(`${msg}\n\nadded this later`, msg), true, 'includes, not endsWith');
  assert.equal(hasMessage('Great run!', msg), false);
  assert.equal(hasMessage(null, msg), false);
  assert.equal(hasMessage('', msg), false);
});

test('appendMessage preserves the athlete text and separates with a blank line', () => {
  assert.equal(appendMessage('Great run!', 'MSG'), 'Great run!\n\nMSG');
});

test('appendMessage handles an empty, null, or whitespace description', () => {
  assert.equal(appendMessage(null, 'MSG'), 'MSG');
  assert.equal(appendMessage('', 'MSG'), 'MSG');
  assert.equal(appendMessage('   ', 'MSG'), 'MSG');
});

test('appendMessage does not stack blank lines on a description that ends in one', () => {
  assert.equal(appendMessage('Great run!\n\n', 'MSG'), 'Great run!\n\nMSG');
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npm test -- test/domain/message.test.js`
Expected: FAIL — `Cannot find module '.../message.js'`

- [x] **Step 4: Implement the message domain**

Create `src/domain/message.js`:

```js
/** @typedef {import('../ports/index.js').ValidationResult} ValidationResult */

export const MAX_MESSAGE_LENGTH = 200;

// Every C0 control character plus DEL, except newline (0x0A).
const CONTROL_CHARS = /[ -	-]/g;

/**
 * Cleans and checks athlete-supplied message text.
 *
 * A blank result is `null`, not `''`: null means "track APPEND_MESSAGE", which
 * is what an empty input on either form is meant to express.
 *
 * @param {string|null|undefined} raw
 * @returns {ValidationResult}
 */
export function validateMessage(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };

  const cleaned = String(raw)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned === '') return { ok: true, value: null };

  // Measured after cleaning, so trailing whitespace cannot fail a valid message.
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Your message is ${cleaned.length} characters. The maximum is ${MAX_MESSAGE_LENGTH}.`,
    };
  }

  return { ok: true, value: cleaned };
}

/**
 * The effective message for an athlete.
 * @param {{ message: string|null }} athlete
 * @param {{ appendMessage: string }} config
 * @returns {string}
 */
export function resolveMessage(athlete, config) {
  return athlete.message ?? config.appendMessage;
}

/**
 * Secondary back-fill guard. `includes`, never `endsWith`: an athlete who types
 * anything after the appended message would otherwise get a second copy.
 * @param {string|null|undefined} description
 * @param {string} message
 * @returns {boolean}
 */
export function hasMessage(description, message) {
  if (!description) return false;
  return description.includes(message);
}

/**
 * @param {string|null|undefined} description
 * @param {string} message
 * @returns {string}
 */
export function appendMessage(description, message) {
  const existing = (description ?? '').replace(/\s+$/, '');
  return existing === '' ? message : `${existing}\n\n${message}`;
}
```

- [x] **Step 5: Run the message tests**

Run: `npm test -- test/domain/message.test.js`
Expected: PASS, 12 tests

- [x] **Step 6: Confirm the architecture test still guards the new layer**

Run: `npm test -- test/architecture.test.js`
Expected: PASS — `src/domain/` now contains real code and is being checked for purity.

Sanity-check that the guard actually bites: temporarily add `import fs from 'node:fs';` to `src/domain/message.js`, re-run, and confirm the test **fails**. Remove it again.

- [x] **Step 7: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 76 tests pass

```bash
git add src/domain/errors.js src/domain/message.js test/domain/message.test.js
git commit -m "feat: pure message domain — validation, fallback, and append"
```

---

### Task 6: Domain — rules and seeding

**Files:**
- Create: `src/domain/rules.js`, `src/domain/seeding.js`
- Test: `test/domain/rules.test.js`, `test/domain/seeding.test.js`

**Interfaces:**
- Consumes: `resolveMessage` / `hasMessage` / `appendMessage` (Task 5).
- Produces:
  - `decidePreFetch({ athlete, alreadyProcessed }) -> PreFetchDecision`
  - `decidePostFetch({ athlete, activity, config }) -> PostFetchDecision`
  - `startedAt(activity) -> number` — `start_date` as unix seconds
  - `computeCutoff(activities, fallbackNow) -> number`
  - `chooseSeedActivity(activities, sportTypes) -> Activity|null`
  - `SEED_PAGE_SIZE = 10`

This is the payoff of the layering. Every filter in the spec's Data flow is a branch in a pure function, tested with plain objects and no mocks. Adding a future rule — minimum distance, skip commutes, per-sport messages — is one branch plus one test, with nothing in `services/` or `web/` to touch.

The split into pre- and post-fetch is not cosmetic: `alreadyProcessed` must be decided *before* any Strava call so a re-delivery costs no rate-limit quota, while `sport_type` and `start_date` are only knowable after the `GET`.

- [x] **Step 1: Write the failing rules test**

Create `test/domain/rules.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePreFetch, decidePostFetch, startedAt } from '../../src/domain/rules.js';

const config = { appendMessage: '🏃 Synced via runsync', sportTypes: new Set(['Run', 'TrailRun']) };
const CUTOFF = 1_700_000_000;

const athlete = (overrides = {}) => ({
  athlete_id: 987654, status: 'active', message: null, activity_cutoff: CUTOFF, ...overrides,
});

const activity = (overrides = {}) => ({
  id: 555, sport_type: 'Run', start_date: '2024-01-01T00:00:00Z', description: 'Great run!', ...overrides,
});

test('an unknown athlete is skipped before any fetch', () => {
  assert.deepEqual(decidePreFetch({ athlete: undefined, alreadyProcessed: false }),
    { action: 'skip', reason: 'unknown-athlete' });
});

test('a revoked athlete is skipped before any fetch', () => {
  assert.deepEqual(decidePreFetch({ athlete: athlete({ status: 'revoked' }), alreadyProcessed: false }),
    { action: 'skip', reason: 'revoked' });
});

test('an already-processed activity is skipped before any fetch, protecting the rate limit', () => {
  assert.deepEqual(decidePreFetch({ athlete: athlete(), alreadyProcessed: true }),
    { action: 'skip', reason: 'already-processed' });
});

test('an active athlete with an unprocessed activity proceeds to fetch', () => {
  assert.deepEqual(decidePreFetch({ athlete: athlete(), alreadyProcessed: false }), { action: 'fetch' });
});

test('the revoked check wins over the processed check, so a dead athlete never looks busy', () => {
  assert.deepEqual(decidePreFetch({ athlete: athlete({ status: 'revoked' }), alreadyProcessed: true }),
    { action: 'skip', reason: 'revoked' });
});

test('appends to a run after the cutoff', () => {
  const decision = decidePostFetch({ athlete: athlete(), activity: activity(), config });
  assert.deepEqual(decision, { action: 'append', description: 'Great run!\n\n🏃 Synced via runsync' });
});

test('uses the athlete own message when they have one', () => {
  const decision = decidePostFetch({
    athlete: athlete({ message: 'Powered by stubbornness' }), activity: activity(), config,
  });
  assert.equal(decision.description, 'Great run!\n\nPowered by stubbornness');
});

test('skips an activity before the cutoff, including on a later edit', () => {
  const decision = decidePostFetch({
    athlete: athlete(), activity: activity({ start_date: '2020-01-01T00:00:00Z' }), config,
  });
  assert.deepEqual(decision, { action: 'skip', reason: 'before-cutoff' });
});

test('an activity exactly at the cutoff is skipped', () => {
  const decision = decidePostFetch({
    athlete: athlete(), activity: activity({ start_date: new Date(CUTOFF * 1000).toISOString() }), config,
  });
  assert.deepEqual(decision, { action: 'skip', reason: 'before-cutoff' });
});

test('the cutoff is checked before the sport type, so an old ride reports the more specific reason', () => {
  const decision = decidePostFetch({
    athlete: athlete(),
    activity: activity({ sport_type: 'Ride', start_date: '2020-01-01T00:00:00Z' }),
    config,
  });
  assert.equal(decision.reason, 'before-cutoff');
});

test('skips a sport outside SPORT_TYPES', () => {
  const decision = decidePostFetch({ athlete: athlete(), activity: activity({ sport_type: 'Ride' }), config });
  assert.deepEqual(decision, { action: 'skip', reason: 'wrong-sport' });
});

test('accepts TrailRun, which is in the default allowlist', () => {
  assert.equal(decidePostFetch({ athlete: athlete(), activity: activity({ sport_type: 'TrailRun' }), config }).action,
    'append');
});

test('records without a PUT when the description already contains the message', () => {
  const decision = decidePostFetch({
    athlete: athlete(),
    activity: activity({ description: 'Great run!\n\n🏃 Synced via runsync' }),
    config,
  });
  assert.deepEqual(decision, { action: 'record', reason: 'backfill' });
});

test('does not append twice when the athlete typed text after the message', () => {
  const decision = decidePostFetch({
    athlete: athlete(),
    activity: activity({ description: '🏃 Synced via runsync\n\nsplit negative!' }),
    config,
  });
  assert.equal(decision.action, 'record');
});

test('appends onto an empty description without a leading blank line', () => {
  const decision = decidePostFetch({ athlete: athlete(), activity: activity({ description: null }), config });
  assert.equal(decision.description, '🏃 Synced via runsync');
});

test('startedAt converts an ISO date to unix seconds', () => {
  assert.equal(startedAt({ start_date: '2024-01-01T00:00:00Z' }), 1_704_067_200);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm test -- test/domain/rules.test.js`
Expected: FAIL — `Cannot find module '.../rules.js'`

- [x] **Step 3: Implement the rules**

Create `src/domain/rules.js`:

```js
import { resolveMessage, hasMessage, appendMessage } from './message.js';

/** @typedef {import('../ports/index.js').Athlete} Athlete */
/** @typedef {import('../ports/index.js').Activity} Activity */
/** @typedef {import('../ports/index.js').Config} Config */
/** @typedef {import('../ports/index.js').PreFetchDecision} PreFetchDecision */
/** @typedef {import('../ports/index.js').PostFetchDecision} PostFetchDecision */

/** @param {{ start_date: string }} activity @returns {number} unix seconds */
export function startedAt(activity) {
  return Math.floor(new Date(activity.start_date).getTime() / 1000);
}

/**
 * Decided with no Strava call made, so a re-delivered or irrelevant event costs
 * nothing against the rate limit.
 *
 * @param {{ athlete: Athlete|undefined, alreadyProcessed: boolean }} input
 * @returns {PreFetchDecision}
 */
export function decidePreFetch({ athlete, alreadyProcessed }) {
  if (!athlete) return { action: 'skip', reason: 'unknown-athlete' };
  if (athlete.status !== 'active') return { action: 'skip', reason: 'revoked' };
  if (alreadyProcessed) return { action: 'skip', reason: 'already-processed' };
  return { action: 'fetch' };
}

/**
 * Decided once the activity is in hand. Add future rules here — a new branch
 * plus a new test, with nothing in services/ or web/ to change.
 *
 * @param {{ athlete: Athlete, activity: Activity, config: Config }} input
 * @returns {PostFetchDecision}
 */
export function decidePostFetch({ athlete, activity, config }) {
  // Cutoff first: an edit to a years-old activity is the case this exists for,
  // and reporting it as `before-cutoff` rather than `wrong-sport` keeps the logs
  // honest about why it was dropped.
  if (startedAt(activity) <= athlete.activity_cutoff) {
    return { action: 'skip', reason: 'before-cutoff' };
  }

  if (!config.sportTypes.has(activity.sport_type)) {
    return { action: 'skip', reason: 'wrong-sport' };
  }

  const message = resolveMessage(athlete, config);

  if (hasMessage(activity.description, message)) {
    return { action: 'record', reason: 'backfill' };
  }

  return { action: 'append', description: appendMessage(activity.description, message) };
}
```

- [x] **Step 4: Write the failing seeding test**

Create `test/domain/seeding.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCutoff, chooseSeedActivity, SEED_PAGE_SIZE } from '../../src/domain/seeding.js';

const NOW = 1_800_000_000;
const sportTypes = new Set(['Run', 'TrailRun']);
const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);

const RIDE_NEWEST = { id: 900, sport_type: 'Ride', start_date: '2026-08-24T10:00:00Z' };
const RUN_OLDER = { id: 800, sport_type: 'Run', start_date: '2026-08-22T06:00:00Z' };
const RUN_OLDEST = { id: 700, sport_type: 'TrailRun', start_date: '2026-08-01T06:00:00Z' };

test('the cutoff is the newest activity of any sport', () => {
  assert.equal(computeCutoff([RUN_OLDER, RIDE_NEWEST, RUN_OLDEST], NOW), ts(RIDE_NEWEST.start_date));
});

test('the cutoff falls back to now when the athlete has no activities', () => {
  assert.equal(computeCutoff([], NOW), NOW);
});

test('the cutoff does not depend on the order the API returned', () => {
  const forwards = computeCutoff([RIDE_NEWEST, RUN_OLDER], NOW);
  const backwards = computeCutoff([RUN_OLDER, RIDE_NEWEST], NOW);
  assert.equal(forwards, backwards);
});

test('the seed is the newest matching run, even when a ride is newer', () => {
  assert.equal(chooseSeedActivity([RIDE_NEWEST, RUN_OLDER, RUN_OLDEST], sportTypes).id, 800);
});

test('the seed matches any configured sport type, not just Run', () => {
  assert.equal(chooseSeedActivity([RUN_OLDEST], sportTypes).id, 700);
});

test('no matching activity yields null rather than throwing', () => {
  assert.equal(chooseSeedActivity([RIDE_NEWEST], sportTypes), null);
  assert.equal(chooseSeedActivity([], sportTypes), null);
});

test('the page size is ten, as the spec specifies', () => {
  assert.equal(SEED_PAGE_SIZE, 10);
});
```

- [x] **Step 5: Run it to verify it fails**

Run: `npm test -- test/domain/seeding.test.js`
Expected: FAIL — `Cannot find module '.../seeding.js'`

- [x] **Step 6: Implement seeding**

Create `src/domain/seeding.js`:

```js
import { startedAt } from './rules.js';

/** @typedef {import('../ports/index.js').Activity} Activity */

export const SEED_PAGE_SIZE = 10;

/** @param {Activity[]} activities @returns {Activity[]} newest first */
function newestFirst(activities) {
  return [...activities].sort((a, b) => startedAt(b) - startedAt(a));
}

/**
 * The cutoff is the newest activity of ANY sport — not the newest run. An
 * athlete whose latest upload was a ride should still have that ride, and
 * everything before it, treated as history.
 *
 * @param {Activity[]} activities
 * @param {number} fallbackNow used when the athlete has no activities at all
 * @returns {number} unix seconds
 */
export function computeCutoff(activities, fallbackNow) {
  const sorted = newestFirst(activities);
  return sorted.length > 0 ? startedAt(sorted[0]) : fallbackNow;
}

/**
 * The one historical activity the service is allowed to touch: the athlete's
 * most recent matching run, which gives them immediate visible confirmation
 * that the connection works. It may be older than the cutoff — that is fine,
 * because it gets a processed record and is never revisited.
 *
 * @param {Activity[]} activities
 * @param {Set<string>} sportTypes
 * @returns {Activity|null}
 */
export function chooseSeedActivity(activities, sportTypes) {
  return newestFirst(activities).find((activity) => sportTypes.has(activity.sport_type)) ?? null;
}
```

- [x] **Step 7: Run the domain tests**

Run: `npm test -- test/domain/`
Expected: PASS, 35 tests — none of which construct a mock, a stub, a database, or a fake clock.

- [x] **Step 8: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 99 tests pass

```bash
git add src/domain/rules.js src/domain/seeding.js test/domain/rules.test.js test/domain/seeding.test.js
git commit -m "feat: pure decision rules and connect-time seeding logic"
```

---

### Task 7: Strava client and token provider

**Files:**
- Create: `src/adapters/strava/errors.js`, `client.js`, `tokens.js`
- Create: `test/support/http.js`
- Test: `test/strava/client.test.js`, `test/strava/tokens.test.js`

**Interfaces:**
- Consumes: `Config` (Task 1), `AthleteStore` (Task 3), `Clock` / `Logger` / `createKeyedLock` (Task 4).
- Produces:
  - `StravaError` with `status`, plus `isAuthError(error)` and `isRateLimited(error)`.
  - `createStravaClient({ config }) -> StravaClient` — exactly the port shape: `exchangeCode`, `refresh`, `getActivity`, `updateActivity`, `listRecentActivities`, `deauthorize`.
  - `createTokenProvider({ client, athleteStore, clock, logger }) -> TokenProvider` — `{ accessTokenFor(athlete) }`, plus `REFRESH_SKEW_SECONDS = 300`.
  - `test/support/http.js`: `mockStrava()` → `{ pool, close() }`.

The client is dumb HTTP with no knowledge of the database. The token provider is the piece that holds state, and it is separate precisely because it needs the per-athlete lock: Strava **rotates the refresh token on every refresh**, so two concurrent refreshes for one athlete would invalidate each other and silently disconnect them.

- [x] **Step 1: Write the HTTP mock helper**

Create `test/support/http.js`:

```js
import { MockAgent, setGlobalDispatcher } from 'undici';

/**
 * Intercepts global fetch with net connect disabled, so a test that forgets to
 * stub a call fails loudly instead of reaching the real Strava API.
 */
export function mockStrava() {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return {
    pool: agent.get('https://www.strava.com'),
    async close() {
      await agent.close();
    },
  };
}
```

- [x] **Step 2: Write the failing client test**

Create `test/strava/client.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig, NOW } from '../support/factories.js';
import { mockStrava } from '../support/http.js';
import { createStravaClient } from '../../src/adapters/strava/client.js';
import { StravaError, isAuthError, isRateLimited } from '../../src/adapters/strava/errors.js';

test('exchangeCode returns tokens and athlete identity', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
    access_token: 'access-new',
    refresh_token: 'refresh-new',
    expires_at: NOW + 21_600,
    athlete: { id: 987654, firstname: 'Test', lastname: 'Athlete' },
  });

  const result = await createStravaClient({ config: testConfig() }).exchangeCode('the-code');
  assert.equal(result.athleteId, 987654);
  assert.equal(result.name, 'Test Athlete');
  assert.equal(result.accessToken, 'access-new');
  assert.equal(result.refreshToken, 'refresh-new');
  assert.equal(result.expiresAt, NOW + 21_600);
  await mock.close();
});

test('exchangeCode copes with an athlete missing a last name', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
    access_token: 'a', refresh_token: 'r', expires_at: NOW,
    athlete: { id: 1, firstname: 'Mononym', lastname: null },
  });
  assert.equal((await createStravaClient({ config: testConfig() }).exchangeCode('c')).name, 'Mononym');
  await mock.close();
});

test('refresh returns the rotated token pair', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/oauth/token', method: 'POST' })
    .reply(200, { access_token: 'a2', refresh_token: 'r2', expires_at: NOW + 21_600 });

  const result = await createStravaClient({ config: testConfig() }).refresh('r1');
  assert.deepEqual(result, { accessToken: 'a2', refreshToken: 'r2', expiresAt: NOW + 21_600 });
  await mock.close();
});

test('getActivity returns the fields the rules need', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/api/v3/activities/555', method: 'GET' })
    .reply(200, { id: 555, sport_type: 'Run', start_date: '2026-08-25T07:00:00Z', description: 'Great run!' });

  const activity = await createStravaClient({ config: testConfig() }).getActivity('token', 555);
  assert.equal(activity.sport_type, 'Run');
  assert.equal(activity.start_date, '2026-08-25T07:00:00Z');
  assert.equal(activity.description, 'Great run!');
  await mock.close();
});

test('getActivity sends the bearer token', async () => {
  const mock = mockStrava();
  let auth;
  mock.pool.intercept({ path: '/api/v3/activities/555', method: 'GET' }).reply((opts) => {
    auth = opts.headers.Authorization ?? opts.headers.authorization;
    return { statusCode: 200, data: { id: 555, sport_type: 'Run', start_date: '2026-08-25T07:00:00Z' } };
  });

  await createStravaClient({ config: testConfig() }).getActivity('the-token', 555);
  assert.equal(auth, 'Bearer the-token');
  await mock.close();
});

test('updateActivity sends the description as a form body, preserving newlines', async () => {
  const mock = mockStrava();
  let body;
  mock.pool.intercept({ path: '/api/v3/activities/555', method: 'PUT' }).reply((opts) => {
    body = opts.body;
    return { statusCode: 200, data: {} };
  });

  await createStravaClient({ config: testConfig() })
    .updateActivity('token', 555, { description: 'Great run!\n\nMSG' });

  assert.ok(new URLSearchParams(body).get('description').includes('Great run!\n\nMSG'));
  await mock.close();
});

test('listRecentActivities requests the given page size', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/api/v3/athlete/activities?per_page=10', method: 'GET' })
    .reply(200, [{ id: 2, sport_type: 'Ride', start_date: '2026-08-24T07:00:00Z' }]);

  const activities = await createStravaClient({ config: testConfig() }).listRecentActivities('token', 10);
  assert.equal(activities.length, 1);
  await mock.close();
});

test('a non-2xx response throws StravaError carrying the status', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/api/v3/activities/555', method: 'GET' })
    .reply(429, { message: 'Rate Limit Exceeded' });

  await assert.rejects(
    () => createStravaClient({ config: testConfig() }).getActivity('token', 555),
    (error) => error instanceof StravaError && error.status === 429 && isRateLimited(error),
  );
  await mock.close();
});

test('isAuthError recognizes 401 and nothing else', () => {
  assert.equal(isAuthError(new StravaError(401, 'nope')), true);
  assert.equal(isAuthError(new StravaError(403, 'nope')), false);
  assert.equal(isAuthError(new Error('unrelated')), false);
});

test('an empty 2xx body does not blow up JSON parsing', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/oauth/deauthorize', method: 'POST' }).reply(200, '');
  await assert.doesNotReject(() => createStravaClient({ config: testConfig() }).deauthorize('token'));
  await mock.close();
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npm test -- test/strava/client.test.js`
Expected: FAIL — `Cannot find module '.../errors.js'`

- [x] **Step 4: Implement the errors**

Create `src/adapters/strava/errors.js`:

```js
export class StravaError extends Error {
  /** @param {number} status @param {string} detail */
  constructor(status, detail) {
    super(`Strava API ${status}: ${detail}`);
    this.name = 'StravaError';
    this.status = status;
  }
}

/**
 * A revoked authorization. The deauthorization webhook is not guaranteed to
 * arrive, so this is the backstop that stops a dead row failing forever.
 * @param {unknown} error
 */
export function isAuthError(error) {
  return error instanceof StravaError && error.status === 401;
}

/** @param {unknown} error */
export function isRateLimited(error) {
  return error instanceof StravaError && error.status === 429;
}
```

- [x] **Step 5: Implement the client**

Create `src/adapters/strava/client.js`:

```js
import { StravaError } from './errors.js';

/** @typedef {import('../../ports/index.js').Config} Config */
/** @typedef {import('../../ports/index.js').StravaClient} StravaClient */

const BASE = 'https://www.strava.com';
const MAX_ERROR_DETAIL = 200;

/**
 * @param {string} path
 * @param {{ method?: string, token?: string, form?: Record<string, string|number> }} [options]
 */
async function request(path, { method = 'GET', token, form } = {}) {
  /** @type {Record<string,string>} */
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ? new URLSearchParams(/** @type {any} */ (form)).toString() : undefined,
  });

  const text = await response.text();
  if (!response.ok) throw new StravaError(response.status, text.slice(0, MAX_ERROR_DETAIL));
  return text === '' ? {} : JSON.parse(text);
}

/**
 * Dumb HTTP. Holds no state and never touches the database — the stateful
 * refresh path lives in tokens.js, which is where the lock belongs.
 *
 * @param {{ config: Config }} deps
 * @returns {StravaClient}
 */
export function createStravaClient({ config }) {
  const credentials = { client_id: config.clientId, client_secret: config.clientSecret };

  return {
    async exchangeCode(code) {
      const tokens = await request('/oauth/token', {
        method: 'POST',
        form: { ...credentials, code, grant_type: 'authorization_code' },
      });
      return {
        athleteId: tokens.athlete.id,
        name: [tokens.athlete.firstname, tokens.athlete.lastname].filter(Boolean).join(' '),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_at,
      };
    },

    async refresh(refreshToken) {
      const tokens = await request('/oauth/token', {
        method: 'POST',
        form: { ...credentials, grant_type: 'refresh_token', refresh_token: refreshToken },
      });
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_at,
      };
    },

    getActivity: (token, activityId) => request(`/api/v3/activities/${activityId}`, { token }),

    async updateActivity(token, activityId, { description }) {
      await request(`/api/v3/activities/${activityId}`, { method: 'PUT', token, form: { description } });
    },

    listRecentActivities: (token, perPage) =>
      request(`/api/v3/athlete/activities?per_page=${perPage}`, { token }),

    async deauthorize(token) {
      await request('/oauth/deauthorize', { method: 'POST', token, form: { access_token: token } });
    },
  };
}
```

- [x] **Step 6: Run the client tests**

Run: `npm test -- test/strava/client.test.js`
Expected: PASS, 10 tests

- [x] **Step 7: Write the failing token provider test**

Create `test/strava/tokens.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createTokenProvider, REFRESH_SKEW_SECONDS } from '../../src/adapters/strava/tokens.js';
import { StravaError } from '../../src/adapters/strava/errors.js';

function setup({ refresh, athlete = {} } = {}) {
  const db = testDb();
  makeAthlete(db, athlete);
  const athleteStore = createAthleteStore(db);
  const calls = { refresh: 0, tokens: [] };
  const logger = collectingLogger();

  const client = {
    async refresh(refreshToken) {
      calls.refresh += 1;
      calls.tokens.push(refreshToken);
      if (refresh) return refresh(refreshToken, calls.refresh);
      return { accessToken: `access-${calls.refresh + 1}`, refreshToken: `refresh-${calls.refresh + 1}`, expiresAt: NOW + 21_600 };
    },
  };

  const tokens = createTokenProvider({ client, athleteStore, clock: fixedClock(NOW), logger });
  return { athleteStore, tokens, calls, logger };
}

test('returns the stored token when it is comfortably fresh', async () => {
  const { athleteStore, tokens, calls } = setup({ athlete: { accessToken: 'still-good', expiresAt: NOW + 3600 } });
  assert.equal(await tokens.accessTokenFor(athleteStore.get(987654)), 'still-good');
  assert.equal(calls.refresh, 0);
});

test('refreshes inside the skew window, before the token has actually expired', async () => {
  const { athleteStore, tokens, calls } = setup({
    athlete: { accessToken: 'stale', expiresAt: NOW + REFRESH_SKEW_SECONDS - 1 },
  });
  assert.equal(await tokens.accessTokenFor(athleteStore.get(987654)), 'access-2');
  assert.equal(calls.refresh, 1);
});

test('persists the rotated token pair, not just the access token', async () => {
  const { athleteStore, tokens } = setup({ athlete: { refreshToken: 'refresh-1', expiresAt: NOW + 60 } });
  await tokens.accessTokenFor(athleteStore.get(987654));

  const athlete = athleteStore.get(987654);
  assert.equal(athlete.access_token, 'access-2');
  assert.equal(athlete.refresh_token, 'refresh-2', 'Strava rotates the refresh token; losing it disconnects them');
  assert.equal(athlete.expires_at, NOW + 21_600);
});

test('concurrent callers for one athlete produce exactly one token exchange', async () => {
  const { athleteStore, tokens, calls } = setup({ athlete: { expiresAt: NOW + 60 } });
  const athlete = athleteStore.get(987654);

  const [a, b, c] = await Promise.all([
    tokens.accessTokenFor(athlete),
    tokens.accessTokenFor(athlete),
    tokens.accessTokenFor(athlete),
  ]);

  assert.equal(calls.refresh, 1, 'later callers must reuse the first refresh, not start their own');
  assert.deepEqual([a, b, c], ['access-2', 'access-2', 'access-2']);
});

test('the second caller never replays the already-rotated refresh token', async () => {
  const { athleteStore, tokens, calls } = setup({ athlete: { refreshToken: 'refresh-1', expiresAt: NOW + 60 } });
  const athlete = athleteStore.get(987654);
  await Promise.all([tokens.accessTokenFor(athlete), tokens.accessTokenFor(athlete)]);
  assert.deepEqual(calls.tokens, ['refresh-1']);
});

test('different athletes do not serialize against each other', async () => {
  const db = testDb();
  makeAthlete(db, { athleteId: 1, expiresAt: NOW + 60 });
  makeAthlete(db, { athleteId: 2, expiresAt: NOW + 60 });
  const athleteStore = createAthleteStore(db);

  const order = [];
  const client = {
    async refresh() {
      order.push('start');
      await new Promise((resolve) => setImmediate(resolve));
      order.push('end');
      return { accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 21_600 };
    },
  };
  const tokens = createTokenProvider({ client, athleteStore, clock: fixedClock(NOW), logger: collectingLogger() });

  await Promise.all([
    tokens.accessTokenFor(athleteStore.get(1)),
    tokens.accessTokenFor(athleteStore.get(2)),
  ]);
  assert.deepEqual(order, ['start', 'start', 'end', 'end'], 'per-athlete keys must not block each other');
});

test('a 401 marks the athlete revoked and rethrows', async () => {
  const { athleteStore, tokens } = setup({
    athlete: { expiresAt: NOW + 60 },
    refresh: () => { throw new StravaError(401, 'Authorization Error'); },
  });

  await assert.rejects(
    () => tokens.accessTokenFor(athleteStore.get(987654)),
    (error) => error instanceof StravaError && error.status === 401,
  );
  assert.equal(athleteStore.get(987654).status, 'revoked');
});

test('a non-auth failure rethrows without revoking — a 500 is not a revocation', async () => {
  const { athleteStore, tokens } = setup({
    athlete: { expiresAt: NOW + 60 },
    refresh: () => { throw new StravaError(500, 'Server Error'); },
  });

  await assert.rejects(() => tokens.accessTokenFor(athleteStore.get(987654)), /500/);
  assert.equal(athleteStore.get(987654).status, 'active');
});

test('logs the refresh with the athlete id', async () => {
  const { athleteStore, tokens, logger } = setup({ athlete: { expiresAt: NOW + 60 } });
  await tokens.accessTokenFor(athleteStore.get(987654));
  assert.ok(logger.entries.some((e) => e.event === 'token.refreshed' && e.athleteId === 987654));
});
```

- [x] **Step 8: Run it to verify it fails**

Run: `npm test -- test/strava/tokens.test.js`
Expected: FAIL — `Cannot find module '.../tokens.js'`

- [x] **Step 9: Implement the token provider**

Create `src/adapters/strava/tokens.js`:

```js
import { createKeyedLock } from '../lock.js';
import { isAuthError } from './errors.js';

/** @typedef {import('../../ports/index.js').Athlete} Athlete */
/** @typedef {import('../../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../../ports/index.js').Clock} Clock */
/** @typedef {import('../../ports/index.js').Logger} Logger */
/** @typedef {import('../../ports/index.js').StravaClient} StravaClient */
/** @typedef {import('../../ports/index.js').TokenProvider} TokenProvider */

/** Refresh this far before actual expiry, so a slow request cannot straddle it. */
export const REFRESH_SKEW_SECONDS = 300;

/**
 * @param {{ client: Pick<StravaClient,'refresh'>, athleteStore: AthleteStore, clock: Clock, logger: Logger }} deps
 * @returns {TokenProvider}
 */
export function createTokenProvider({ client, athleteStore, clock, logger }) {
  const withAthleteLock = createKeyedLock();

  /** @param {Athlete} athlete */
  async function refresh(athlete) {
    let tokens;
    try {
      tokens = await client.refresh(athlete.refresh_token);
    } catch (error) {
      if (isAuthError(error)) {
        athleteStore.markRevoked(athlete.athlete_id, clock.now());
        logger.warn('athlete.revoked', { athleteId: athlete.athlete_id, cause: 'refresh-401' });
      }
      throw error;
    }

    athleteStore.updateTokens(athlete.athlete_id, tokens);
    logger.info('token.refreshed', { athleteId: athlete.athlete_id, expiresAt: tokens.expiresAt });
    return tokens.accessToken;
  }

  return {
    /**
     * Strava rotates the refresh token on every refresh, invalidating the
     * previous one. Two concurrent refreshes for one athlete would race and
     * disconnect them, so the whole path is serialized per athlete id.
     *
     * The re-read INSIDE the lock is what makes a queued caller reuse the
     * first caller's freshly persisted token instead of replaying a refresh
     * token that has already been spent.
     */
    accessTokenFor(athlete) {
      return withAthleteLock(athlete.athlete_id, async () => {
        const current = athleteStore.get(athlete.athlete_id) ?? athlete;
        if (current.expires_at > clock.now() + REFRESH_SKEW_SECONDS) return current.access_token;
        return refresh(current);
      });
    },
  };
}
```

- [x] **Step 10: Run the Strava tests**

Run: `npm test -- test/strava/`
Expected: PASS, 19 tests. The two that matter most are `concurrent callers for one athlete produce exactly one token exchange` and `the second caller never replays the already-rotated refresh token` — if either fails, the re-read is outside the lock.

- [x] **Step 11: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 118 tests pass

```bash
git add src/adapters/strava/ test/strava/ test/support/http.js
git commit -m "feat: Strava HTTP client and token provider with per-athlete refresh lock"
```

---

### Task 8: Job dispatch

**Files:**
- Create: `src/services/jobs.js`, `src/adapters/dispatch/inline.js`
- Test: `test/services/jobs.test.js`, `test/dispatch/inline.test.js`

**Interfaces:**
- Consumes: `createKeyedLock` (Task 4), `Logger` (Task 4), the `Job` / `Dispatcher` typedefs (Task 1).
- Produces:
  - `activityJob(athleteId, activityId) -> ActivityJob`
  - `jobKey(job) -> string` — `activity:${activityId}`
  - `createInlineDispatcher({ handlers, logger }) -> Dispatcher` — `{ dispatch(job), drain() }`

This is the seam for the spec's deferred job queue. The webhook router never calls a service; it builds a typed job and dispatches it. Swapping in a durable queue later means writing one adapter and changing one line in `container.js`. `jobKey` is a service-level helper for constructing and documenting the current job vocabulary; the adapter derives its lock key from the typed job itself, so `adapters/` never imports `services/`.

`dispatch` is deliberately **synchronous and void**: the caller has already sent `200` and must not be able to await, forget, or accidentally reject on it. `drain()` exists for tests and for graceful shutdown.

- [x] **Step 1: Write the failing jobs test**

Create `test/services/jobs.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityJob, jobKey } from '../../src/services/jobs.js';

test('activityJob builds a typed job', () => {
  assert.deepEqual(activityJob(987654, 555), { type: 'activity.process', athleteId: 987654, activityId: 555 });
});

test('jobKey serializes two events for one activity onto the same key', () => {
  assert.equal(jobKey(activityJob(1, 555)), jobKey(activityJob(1, 555)));
});

test('jobKey keys on the activity, not the athlete — the same activity has one owner', () => {
  assert.equal(jobKey(activityJob(1, 555)), 'activity:555');
});

test('different activities get different keys, so they never block each other', () => {
  assert.notEqual(jobKey(activityJob(1, 555)), jobKey(activityJob(1, 556)));
});

test('an unknown job type throws rather than silently colliding on one key', () => {
  assert.throws(() => jobKey(/** @type {any} */ ({ type: 'nope' })), /nope/);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm test -- test/services/jobs.test.js`
Expected: FAIL — `Cannot find module '.../jobs.js'`

- [x] **Step 3: Implement jobs**

Create `src/services/jobs.js`:

```js
/** @typedef {import('../ports/index.js').ActivityJob} ActivityJob */
/** @typedef {import('../ports/index.js').Job} Job */

/**
 * @param {number} athleteId
 * @param {number} activityId
 * @returns {ActivityJob}
 */
export function activityJob(athleteId, activityId) {
  return { type: 'activity.process', athleteId, activityId };
}

/**
 * The serialization key. Two webhook events for one activity — Strava's common
 * create-then-update pair — must run one after another, while unrelated
 * activities stay fully concurrent.
 *
 * @param {Job} job
 * @returns {string}
 */
export function jobKey(job) {
  switch (job.type) {
    case 'activity.process':
      return `activity:${job.activityId}`;
    default:
      throw new Error(`No key defined for job type: ${/** @type {any} */ (job).type}`);
  }
}
```

- [x] **Step 4: Write the failing dispatcher test**

Create `test/dispatch/inline.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectingLogger } from '../support/factories.js';
import { createInlineDispatcher } from '../../src/adapters/dispatch/inline.js';
import { activityJob } from '../../src/services/jobs.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(handler) {
  const logger = collectingLogger();
  const seen = [];
  const dispatcher = createInlineDispatcher({
    handlers: {
      'activity.process': async (job) => {
        seen.push(job);
        if (handler) return handler(job);
        return 'appended';
      },
    },
    logger,
  });
  return { dispatcher, seen, logger };
}

test('dispatch runs the handler for the job type', async () => {
  const { dispatcher, seen } = setup();
  dispatcher.dispatch(activityJob(987654, 555));
  await dispatcher.drain();
  assert.deepEqual(seen, [{ type: 'activity.process', athleteId: 987654, activityId: 555 }]);
});

test('dispatch returns synchronously and undefined — the caller cannot await it', () => {
  const { dispatcher } = setup();
  assert.equal(dispatcher.dispatch(activityJob(1, 555)), undefined);
});

test('two jobs for one activity are serialized', async () => {
  const order = [];
  const { dispatcher } = setup(async (job) => {
    order.push(`start:${job.athleteId}`);
    await tick();
    await tick();
    order.push(`end:${job.athleteId}`);
  });

  dispatcher.dispatch(activityJob(1, 555));
  dispatcher.dispatch(activityJob(2, 555));
  await dispatcher.drain();

  assert.deepEqual(order, ['start:1', 'end:1', 'start:2', 'end:2']);
});

test('jobs for different activities run concurrently', async () => {
  const order = [];
  const { dispatcher } = setup(async (job) => {
    order.push(`start:${job.activityId}`);
    await tick();
    order.push(`end:${job.activityId}`);
  });

  dispatcher.dispatch(activityJob(1, 555));
  dispatcher.dispatch(activityJob(1, 556));
  await dispatcher.drain();

  assert.deepEqual(order, ['start:555', 'start:556', 'end:555', 'end:556']);
});

test('a throwing handler is logged and does not stop later jobs', async () => {
  let attempt = 0;
  const { dispatcher, logger } = setup(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('boom');
    return 'appended';
  });

  dispatcher.dispatch(activityJob(1, 555));
  dispatcher.dispatch(activityJob(1, 556));
  await dispatcher.drain();

  assert.equal(attempt, 2);
  assert.ok(logger.entries.some((e) => e.level === 'error' && e.event === 'job.failed'));
});

test('a failing job never becomes an unhandled rejection', async () => {
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { dispatcher } = setup(async () => { throw new Error('boom'); });
    dispatcher.dispatch(activityJob(1, 555));
    await dispatcher.drain();
    await tick();
    await tick();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, [], 'an unhandled rejection would kill the container');
});

test('an unknown job type is logged and dropped rather than thrown at the caller', async () => {
  const { dispatcher, logger } = setup();
  assert.doesNotThrow(() => dispatcher.dispatch(/** @type {any} */ ({ type: 'unknown.thing' })));
  await dispatcher.drain();
  assert.ok(logger.entries.some((e) => e.event === 'job.unknown-type'));
});

test('drain resolves immediately when nothing is in flight', async () => {
  const { dispatcher } = setup();
  await assert.doesNotReject(() => dispatcher.drain());
});

test('drain waits for work queued by earlier work', async () => {
  const { dispatcher, seen } = setup(async (job) => {
    if (job.activityId === 555) dispatcher.dispatch(activityJob(1, 556));
  });

  dispatcher.dispatch(activityJob(1, 555));
  await dispatcher.drain();

  assert.equal(seen.length, 2);
});
```

- [x] **Step 5: Run it to verify it fails**

Run: `npm test -- test/dispatch/inline.test.js`
Expected: FAIL — `Cannot find module '.../inline.js'`

- [x] **Step 6: Implement the inline dispatcher**

Create `src/adapters/dispatch/inline.js`:

```js
import { createKeyedLock } from '../lock.js';

/** @typedef {import('../../ports/index.js').Dispatcher} Dispatcher */
/** @typedef {import('../../ports/index.js').Job} Job */
/** @typedef {import('../../ports/index.js').Logger} Logger */

/**
 * Runs jobs in-process, immediately, serialized by job key.
 *
 * This is the seam for a durable queue. Everything upstream builds a typed job
 * and calls `dispatch`; nothing upstream knows the work happens inline. A
 * queue-backed adapter implements the same two methods and swaps in at the
 * composition root.
 *
 * @param {{ handlers: Record<string, (job: Job) => Promise<unknown>>, logger: Logger }} deps
 * @returns {Dispatcher}
 */
export function createInlineDispatcher({ handlers, logger }) {
  const withJobLock = createKeyedLock();
  /** @type {Set<Promise<void>>} */
  const pending = new Set();

  /** @param {Job} job */
  function dispatch(job) {
    const handler = handlers[job.type];
    if (!handler) {
      logger.error('job.unknown-type', { type: /** @type {any} */ (job).type });
      return;
    }

    // Every detached chain ends here in a .catch(). An unhandled rejection on
    // this path would take the container down.
    // `Job` currently has one variant, whose globally unique activity id is
    // the serialization boundary. Keep this derivation here: importing the
    // service helper would violate the adapters -> services dependency rule.
    const tracked = withJobLock(`activity:${job.activityId}`, () => handler(job))
      .then(
        (outcome) => logger.debug('job.done', { type: job.type, outcome }),
        (error) => logger.error('job.failed', { type: job.type, error: error.message }),
      );

    pending.add(tracked);
    tracked.finally(() => pending.delete(tracked));
  }

  return {
    dispatch,
    // Loops rather than awaiting once: a handler may dispatch further work.
    async drain() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
```

- [x] **Step 7: Run the dispatch tests**

Run: `npm test -- test/dispatch/ test/services/jobs.test.js`
Expected: PASS, 14 tests

- [x] **Step 8: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 132 tests pass

```bash
git add src/services/jobs.js src/adapters/dispatch/ test/dispatch/ test/services/jobs.test.js
git commit -m "feat: typed jobs and inline dispatcher — the seam for a future queue"
```

### Task 9: Activity processor service

**Files:**
- Create: `src/services/activityProcessor.js`
- Test: `test/services/activityProcessor.test.js`

**Interfaces:**
- Consumes: `AthleteStore` / `ActivityStore` (Task 3), `Clock` / `Logger` (Task 4), `decidePreFetch` / `decidePostFetch` (Task 6), `TokenProvider` and `StravaClient` (Task 7), `ActivityJob` (Task 8).
- Produces: `createActivityProcessor({ athleteStore, activityStore, strava, tokens, config, clock, logger }) -> { process(job: ActivityJob): Promise<string> }`.

The returned string is the decision reason (`'appended'`, `'before-cutoff'`, `'backfill'`, …), which is what lets every test assert the outcome directly rather than inferring it from mock call counts.

This service is thin on purpose. It performs no branching of its own: it loads state, asks the domain, and carries out the answer. Every filter lives in Task 6, already tested with no mocks.

- [ ] **Step 1: Write the failing processor test**

Create `test/services/activityProcessor.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, testConfig, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createActivityProcessor } from '../../src/services/activityProcessor.js';
import { activityJob } from '../../src/services/jobs.js';
import { StravaError } from '../../src/adapters/strava/errors.js';

const AFTER_CUTOFF = '2026-08-25T07:00:00Z';
const BEFORE_CUTOFF = '2020-01-01T00:00:00Z';
const RUN = { id: 555, sport_type: 'Run', start_date: AFTER_CUTOFF, description: 'Great run!' };

function setup({ activity = RUN, athlete = {}, config = {}, getActivity, updateActivity } = {}) {
  const db = testDb();
  makeAthlete(db, athlete);
  const athleteStore = createAthleteStore(db);
  const activityStore = createActivityStore(db);
  const logger = collectingLogger();
  const calls = { get: 0, put: 0, token: 0, updates: [] };

  const strava = {
    async getActivity(token, id) {
      calls.get += 1;
      if (getActivity) return getActivity(token, id);
      return activity;
    },
    async updateActivity(token, id, patch) {
      calls.put += 1;
      calls.updates.push({ id, ...patch });
      if (updateActivity) return updateActivity(token, id, patch);
    },
  };
  const tokens = { async accessTokenFor() { calls.token += 1; return 'token'; } };

  const processor = createActivityProcessor({
    athleteStore, activityStore, strava, tokens,
    config: testConfig(config), clock: fixedClock(NOW), logger,
  });

  return { processor, athleteStore, activityStore, calls, logger };
}

test('appends the message to a run after the cutoff', async () => {
  const { processor, athleteStore, activityStore, calls } = setup();
  assert.equal(await processor.process(activityJob(987654, 555)), 'appended');

  assert.equal(calls.put, 1);
  assert.equal(calls.updates[0].description, 'Great run!\n\n🏃 Synced via runsync');
  assert.equal(activityStore.isProcessed(555), true);

  const athlete = athleteStore.get(987654);
  assert.equal(athlete.processed_count, 1);
  assert.equal(athlete.last_activity_id, 555);
  assert.equal(athlete.last_processed_at, NOW);
});

test('uses the athlete own message', async () => {
  const { processor, calls } = setup({ athlete: { message: 'Powered by stubbornness' } });
  await processor.process(activityJob(987654, 555));
  assert.equal(calls.updates[0].description, 'Great run!\n\nPowered by stubbornness');
});

test('drops an unknown athlete without spending a request', async () => {
  const { processor, calls } = setup();
  assert.equal(await processor.process(activityJob(404404, 555)), 'unknown-athlete');
  assert.equal(calls.token, 0);
  assert.equal(calls.get, 0);
});

test('drops a revoked athlete without spending a request', async () => {
  const { processor, athleteStore, calls } = setup();
  athleteStore.markRevoked(987654, NOW);
  assert.equal(await processor.process(activityJob(987654, 555)), 'revoked');
  assert.equal(calls.get, 0);
});

test('an already-processed activity costs no Strava request at all', async () => {
  const { processor, activityStore, calls } = setup();
  activityStore.markProcessed(555, 987654, NOW);

  assert.equal(await processor.process(activityJob(987654, 555)), 'already-processed');
  assert.equal(calls.token, 0, 'the processed check must run before the token, protecting the rate limit');
  assert.equal(calls.get, 0);
  assert.equal(calls.put, 0);
});

test('drops an activity before the cutoff — the old-activity-edit leak', async () => {
  const { processor, calls } = setup({ activity: { ...RUN, start_date: BEFORE_CUTOFF } });
  assert.equal(await processor.process(activityJob(987654, 555)), 'before-cutoff');
  assert.equal(calls.put, 0);
});

test('drops a sport outside SPORT_TYPES', async () => {
  const { processor, calls } = setup({ activity: { ...RUN, sport_type: 'Ride' } });
  assert.equal(await processor.process(activityJob(987654, 555)), 'wrong-sport');
  assert.equal(calls.put, 0);
});

test('a skipped activity is not recorded as processed, so a later fix can still pick it up', async () => {
  const { processor, activityStore } = setup({ activity: { ...RUN, sport_type: 'Ride' } });
  await processor.process(activityJob(987654, 555));
  assert.equal(activityStore.isProcessed(555), false);
});

test('back-fills the record without a PUT when the description already has the message', async () => {
  const { processor, activityStore, calls } = setup({
    activity: { ...RUN, description: 'Great run!\n\n🏃 Synced via runsync' },
  });
  assert.equal(await processor.process(activityJob(987654, 555)), 'backfill');
  assert.equal(calls.put, 0);
  assert.equal(activityStore.isProcessed(555), true);
});

test('does not append twice when the athlete typed text after the message', async () => {
  const { processor, calls } = setup({
    activity: { ...RUN, description: '🏃 Synced via runsync\n\nsplit negative!' },
  });
  assert.equal(await processor.process(activityJob(987654, 555)), 'backfill');
  assert.equal(calls.put, 0);
});

test('records the error and rethrows when Strava fails', async () => {
  const { processor, athleteStore, activityStore } = setup({
    getActivity: () => { throw new StravaError(429, 'Rate Limit Exceeded'); },
  });

  await assert.rejects(() => processor.process(activityJob(987654, 555)), /429/);

  const athlete = athleteStore.get(987654);
  assert.match(athlete.last_error, /429/);
  assert.equal(athlete.last_error_at, NOW);
  assert.equal(activityStore.isProcessed(555), false, 'a failed activity must stay unprocessed');
});

test('a failure after the PUT still records the activity, so it is never appended twice', async () => {
  const { processor, activityStore } = setup({
    updateActivity: () => { throw new StravaError(500, 'boom'); },
  });
  await assert.rejects(() => processor.process(activityJob(987654, 555)));
  assert.equal(activityStore.isProcessed(555), false,
    'the PUT never landed, so the activity must remain eligible');
});

test('an unknown athlete failing does not try to record an error on a missing row', async () => {
  const { processor } = setup({ getActivity: () => { throw new StravaError(500, 'boom'); } });
  await assert.doesNotReject(() => processor.process(activityJob(404404, 555)));
});

test('logs the outcome with athlete and activity ids', async () => {
  const { processor, logger } = setup();
  await processor.process(activityJob(987654, 555));
  assert.ok(logger.entries.some((e) =>
    e.event === 'activity.appended' && e.athleteId === 987654 && e.activityId === 555));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/services/activityProcessor.test.js`
Expected: FAIL — `Cannot find module '.../activityProcessor.js'`

- [ ] **Step 3: Implement the processor**

Create `src/services/activityProcessor.js`:

```js
import { decidePreFetch, decidePostFetch } from '../domain/rules.js';

/** @typedef {import('../ports/index.js').ActivityJob} ActivityJob */
/** @typedef {import('../ports/index.js').ActivityStore} ActivityStore */
/** @typedef {import('../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../ports/index.js').Clock} Clock */
/** @typedef {import('../ports/index.js').Config} Config */
/** @typedef {import('../ports/index.js').Logger} Logger */
/** @typedef {import('../ports/index.js').StravaClient} StravaClient */
/** @typedef {import('../ports/index.js').TokenProvider} TokenProvider */

/**
 * Orchestration only. Every branch that decides *whether* to act lives in
 * domain/rules.js; this service loads state, asks, and carries out the answer.
 *
 * @param {{
 *   athleteStore: AthleteStore,
 *   activityStore: ActivityStore,
 *   strava: Pick<StravaClient,'getActivity'|'updateActivity'>,
 *   tokens: TokenProvider,
 *   config: Config,
 *   clock: Clock,
 *   logger: Logger,
 * }} deps
 */
export function createActivityProcessor({ athleteStore, activityStore, strava, tokens, config, clock, logger }) {
  /** @param {ActivityJob} job @returns {Promise<string>} */
  async function run({ athleteId, activityId }) {
    const log = logger.child({ athleteId, activityId });
    const athlete = athleteStore.get(athleteId);

    const pre = decidePreFetch({ athlete, alreadyProcessed: activityStore.isProcessed(activityId) });
    if (pre.action === 'skip') {
      log.info('activity.skipped', { reason: pre.reason });
      return pre.reason;
    }

    const token = await tokens.accessTokenFor(/** @type {NonNullable<typeof athlete>} */ (athlete));
    const activity = await strava.getActivity(token, activityId);

    const post = decidePostFetch({
      athlete: /** @type {NonNullable<typeof athlete>} */ (athlete),
      activity,
      config,
    });

    if (post.action === 'skip') {
      log.info('activity.skipped', { reason: post.reason, sportType: activity.sport_type });
      return post.reason;
    }

    if (post.action === 'record') {
      // Already carries the message — back-fill the durable record so we never
      // look at it again, without spending a write against the rate limit.
      activityStore.markProcessed(activityId, athleteId, clock.now());
      log.info('activity.backfilled', {});
      return post.reason;
    }

    await strava.updateActivity(token, activityId, { description: post.description });
    activityStore.markProcessed(activityId, athleteId, clock.now());
    athleteStore.recordSuccess(athleteId, activityId, clock.now());
    log.info('activity.appended', {});
    return 'appended';
  }

  return {
    /** @param {ActivityJob} job */
    async process(job) {
      try {
        return await run(job);
      } catch (error) {
        // Surfaced on the athlete's own dashboard, so a miss is visible to them
        // without anyone reading container logs.
        if (athleteStore.get(job.athleteId)) {
          athleteStore.recordError(job.athleteId, /** @type {Error} */ (error).message, clock.now());
        }
        throw error;
      }
    },
  };
}
```

- [ ] **Step 4: Run the processor tests**

Run: `npm test -- test/services/activityProcessor.test.js`
Expected: PASS, 14 tests

- [ ] **Step 5: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 146 tests pass

```bash
git add src/services/activityProcessor.js test/services/activityProcessor.test.js
git commit -m "feat: activity processor service"
```

---

### Task 10: Connect and athlete services

**Files:**
- Create: `src/services/connectService.js`, `src/services/athleteService.js`
- Test: `test/services/connectService.test.js`, `test/services/athleteService.test.js`

**Interfaces:**
- Consumes: all four stores (Task 3), `Clock` / `Logger` (Task 4), `validateMessage` (Task 5), `computeCutoff` / `chooseSeedActivity` / `SEED_PAGE_SIZE` / `resolveMessage` / `hasMessage` / `appendMessage` (Tasks 5–6), `StravaClient` (Task 7), `ConflictError` (Task 5).
- Produces:
  - `createConnectService({...}) -> { completeConnect({ code, state }), seedAthlete(athleteId, accessToken) }`
  - `createAthleteService({...}) -> { updateMessage(athleteId, rawMessage), disconnect(athleteId) }`

`completeConnect` returns `{ athleteId, isNew }` or throws `ConflictError`. The web layer turns that into a redirect or a status code — it contains none of this logic itself.

- [ ] **Step 1: Write the failing connect service test**

Create `test/services/connectService.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, testConfig, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createInviteStore } from '../../src/adapters/store/invites.js';
import { createAuthStateStore } from '../../src/adapters/store/authStates.js';
import { createConnectService } from '../../src/services/connectService.js';
import { ConflictError } from '../../src/domain/errors.js';

const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const RIDE_NEWEST = { id: 900, sport_type: 'Ride', start_date: '2026-08-24T10:00:00Z' };
const RUN_OLDER = { id: 800, sport_type: 'Run', start_date: '2026-08-22T06:00:00Z', description: 'Long one' };

function setup({ activities = [RIDE_NEWEST, RUN_OLDER], identity, exchangeCode } = {}) {
  const db = testDb();
  const stores = {
    athletes: createAthleteStore(db),
    activities: createActivityStore(db),
    invites: createInviteStore(db),
    authStates: createAuthStateStore(db),
  };
  const calls = { list: 0, perPage: null, put: 0, updates: [] };

  const strava = {
    async exchangeCode(code) {
      if (exchangeCode) return exchangeCode(code);
      return { athleteId: 987654, name: 'Test Athlete', accessToken: 'a1', refreshToken: 'r1', expiresAt: NOW + 21_600, ...identity };
    },
    async listRecentActivities(token, perPage) { calls.list += 1; calls.perPage = perPage; return activities; },
    async getActivity(token, id) { return activities.find((a) => a.id === id); },
    async updateActivity(token, id, patch) { calls.put += 1; calls.updates.push({ id, ...patch }); },
  };

  const service = createConnectService({
    athleteStore: stores.athletes, activityStore: stores.activities,
    inviteStore: stores.invites, authStateStore: stores.authStates,
    strava, config: testConfig(), clock: fixedClock(NOW), logger: collectingLogger(),
  });

  return { db, stores, service, calls };
}

function mintAndStage(stores, { state = 's1', token = 'invite-1', pendingMessage = null } = {}) {
  stores.invites.create({ token, now: NOW, expiresAt: NOW + 604_800 });
  stores.authStates.create({ state, inviteToken: token, pendingMessage, now: NOW, expiresAt: NOW + 600 });
  return state;
}

test('rejects an unknown, expired, or replayed state', async () => {
  const { stores, service } = setup();
  await assert.rejects(() => service.completeConnect({ code: 'c', state: 'nope' }), ConflictError);

  const state = mintAndStage(stores);
  await service.completeConnect({ code: 'c', state });
  await assert.rejects(() => service.completeConnect({ code: 'c', state }), ConflictError);
});

test('a first-time connect stores the athlete, consumes the invite, and reports isNew', async () => {
  const { stores, service } = setup();
  const state = mintAndStage(stores, { pendingMessage: 'Powered by stubbornness' });

  const result = await service.completeConnect({ code: 'the-code', state });
  assert.deepEqual(result, { athleteId: 987654, isNew: true });

  const athlete = stores.athletes.get(987654);
  assert.equal(athlete.name, 'Test Athlete');
  assert.equal(athlete.message, 'Powered by stubbornness');
  assert.equal(athlete.status, 'active');
  assert.equal(stores.invites.getUsable('invite-1', NOW), undefined);
});

test('connecting without touching the message field leaves message NULL', async () => {
  const { stores, service } = setup();
  await service.completeConnect({ code: 'c', state: mintAndStage(stores) });
  assert.equal(stores.athletes.get(987654).message, null);
});

test('a first-time connect seeds the newest run and sets the cutoff to the newest activity', async () => {
  const { stores, service, calls } = setup();
  await service.completeConnect({ code: 'c', state: mintAndStage(stores) });

  assert.equal(calls.perPage, 10);
  assert.equal(calls.put, 1);
  assert.equal(calls.updates[0].id, 800);
  assert.equal(calls.updates[0].description, 'Long one\n\n🏃 Synced via runsync');

  const athlete = stores.athletes.get(987654);
  assert.equal(athlete.activity_cutoff, ts(RIDE_NEWEST.start_date));
  assert.equal(athlete.seed_activity_id, 800);
  assert.equal(stores.activities.isProcessed(800), true, 'the seed must never be revisited');
});

test('the seed uses the message chosen on the connect page', async () => {
  const { stores, service, calls } = setup();
  await service.completeConnect({ code: 'c', state: mintAndStage(stores, { pendingMessage: 'Mine' }) });
  assert.equal(calls.updates[0].description, 'Long one\n\nMine');
});

test('no run in the recent page means no seed and no error', async () => {
  const { stores, service, calls } = setup({ activities: [RIDE_NEWEST] });
  await service.completeConnect({ code: 'c', state: mintAndStage(stores) });

  assert.equal(calls.put, 0);
  assert.equal(stores.athletes.get(987654).seed_activity_id, null);
  assert.equal(stores.athletes.get(987654).activity_cutoff, ts(RIDE_NEWEST.start_date));
});

test('an athlete with no activities gets a cutoff of now', async () => {
  const { stores, service } = setup({ activities: [] });
  await service.completeConnect({ code: 'c', state: mintAndStage(stores) });
  assert.equal(stores.athletes.get(987654).activity_cutoff, NOW);
});

test('a failing seed does not fail the connection', async () => {
  const { stores, service } = setup();
  const broken = createConnectService({
    athleteStore: stores.athletes, activityStore: stores.activities,
    inviteStore: stores.invites, authStateStore: stores.authStates,
    strava: {
      async exchangeCode() { return { athleteId: 987654, name: 'T', accessToken: 'a', refreshToken: 'r', expiresAt: NOW }; },
      async listRecentActivities() { throw new Error('Strava API 500'); },
    },
    config: testConfig(), clock: fixedClock(NOW), logger: collectingLogger(),
  });

  const state = mintAndStage(stores);
  const result = await broken.completeConnect({ code: 'c', state });
  assert.equal(result.isNew, true);
  assert.ok(stores.athletes.get(987654), 'the athlete is connected either way');
});

test('a login callback (no invite) re-authenticates a known athlete without re-seeding', async () => {
  const { db, stores, service, calls } = setup();
  makeAthlete(db, { activityCutoff: 1000 });
  stores.authStates.create({ state: 'login', inviteToken: null, pendingMessage: null, now: NOW, expiresAt: NOW + 600 });

  const result = await service.completeConnect({ code: 'c', state: 'login' });
  assert.deepEqual(result, { athleteId: 987654, isNew: false });
  assert.equal(calls.list, 0, 'a returning athlete must not be re-seeded');
  assert.equal(stores.athletes.get(987654).activity_cutoff, 1000, 'and the cutoff must not move');
});

test('a login callback for an athlete we do not know is refused', async () => {
  const { stores, service } = setup();
  stores.authStates.create({ state: 'login', inviteToken: null, pendingMessage: null, now: NOW, expiresAt: NOW + 600 });
  await assert.rejects(() => service.completeConnect({ code: 'c', state: 'login' }), ConflictError);
});

test('re-authorization after a revoke advances the cutoff and does not re-seed', async () => {
  const { db, stores, service, calls } = setup();
  makeAthlete(db, { activityCutoff: 1000 });
  stores.athletes.markRevoked(987654, NOW);
  stores.authStates.create({ state: 'login', inviteToken: null, pendingMessage: null, now: NOW, expiresAt: NOW + 600 });

  await service.completeConnect({ code: 'c', state: 'login' });
  const athlete = stores.athletes.get(987654);
  assert.equal(athlete.status, 'active');
  assert.equal(athlete.activity_cutoff, NOW, 'activities uploaded while disconnected are history');
  assert.equal(calls.list, 0);
});

test('a race that consumes the invite between state and connect is refused', async () => {
  const { stores, service } = setup();
  const state = mintAndStage(stores);
  stores.invites.consume('invite-1', 111, NOW);
  await assert.rejects(() => service.completeConnect({ code: 'c', state }), ConflictError);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/services/connectService.test.js`
Expected: FAIL — `Cannot find module '.../connectService.js'`

- [ ] **Step 3: Implement the connect service**

Create `src/services/connectService.js`:

```js
import { ConflictError } from '../domain/errors.js';
import { resolveMessage, hasMessage, appendMessage } from '../domain/message.js';
import { computeCutoff, chooseSeedActivity, SEED_PAGE_SIZE } from '../domain/seeding.js';

/** @typedef {import('../ports/index.js').ActivityStore} ActivityStore */
/** @typedef {import('../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../ports/index.js').AuthStateStore} AuthStateStore */
/** @typedef {import('../ports/index.js').Clock} Clock */
/** @typedef {import('../ports/index.js').Config} Config */
/** @typedef {import('../ports/index.js').InviteStore} InviteStore */
/** @typedef {import('../ports/index.js').Logger} Logger */
/** @typedef {import('../ports/index.js').StravaClient} StravaClient */

/**
 * @param {{
 *   athleteStore: AthleteStore, activityStore: ActivityStore,
 *   inviteStore: InviteStore, authStateStore: AuthStateStore,
 *   strava: StravaClient, config: Config, clock: Clock, logger: Logger,
 * }} deps
 */
export function createConnectService({
  athleteStore, activityStore, inviteStore, authStateStore, strava, config, clock, logger,
}) {
  /**
   * Establishes the cutoff and appends to the athlete's most recent run.
   *
   * The seed is the one deliberate exception to "never touch history": it is
   * the only visible confirmation the athlete gets that the connection works.
   * It carries a processed record, so it is never revisited.
   */
  async function seedAthlete(athleteId, accessToken) {
    const athlete = athleteStore.get(athleteId);
    if (!athlete) throw new ConflictError(`Unknown athlete ${athleteId}`);

    const activities = await strava.listRecentActivities(accessToken, SEED_PAGE_SIZE);
    const cutoff = computeCutoff(activities, clock.now());
    athleteStore.advanceCutoff(athleteId, cutoff);

    const seed = chooseSeedActivity(activities, config.sportTypes);
    if (!seed) {
      logger.info('connect.no-seed', { athleteId, considered: activities.length });
      return { cutoff, seedActivityId: null };
    }

    const message = resolveMessage(athlete, config);
    const full = await strava.getActivity(accessToken, seed.id);

    if (!hasMessage(full.description, message)) {
      await strava.updateActivity(accessToken, seed.id, {
        description: appendMessage(full.description, message),
      });
    }

    activityStore.markProcessed(seed.id, athleteId, clock.now());
    athleteStore.setSeedActivity(athleteId, seed.id);
    athleteStore.recordSuccess(athleteId, seed.id, clock.now());
    logger.info('connect.seeded', { athleteId, activityId: seed.id, cutoff });

    return { cutoff, seedActivityId: seed.id };
  }

  return {
    seedAthlete,

    /**
     * @param {{ code: string, state: string }} input
     * @returns {Promise<{ athleteId: number, isNew: boolean }>}
     */
    async completeConnect({ code, state }) {
      const stored = authStateStore.consume(state, clock.now());
      if (!stored) throw new ConflictError('This sign-in link has expired. Please start again.');

      const identity = await strava.exchangeCode(code);
      const existing = athleteStore.get(identity.athleteId);

      // A /login callback carries no invite and only ever re-authenticates
      // someone already connected.
      if (!stored.invite_token) {
        if (!existing) throw new ConflictError('You need an invite link to connect.');

        const wasRevoked = existing.status === 'revoked';
        athleteStore.reactivate(identity.athleteId, {
          accessToken: identity.accessToken,
          refreshToken: identity.refreshToken,
          expiresAt: identity.expiresAt,
        });
        if (wasRevoked) {
          // Activities uploaded while disconnected count as history.
          athleteStore.advanceCutoff(identity.athleteId, clock.now());
          logger.info('connect.reauthorized', { athleteId: identity.athleteId });
        }
        return { athleteId: identity.athleteId, isNew: false };
      }

      if (!inviteStore.consume(stored.invite_token, identity.athleteId, clock.now())) {
        throw new ConflictError('This invite link has already been used.');
      }

      athleteStore.insert({
        athleteId: identity.athleteId,
        name: identity.name,
        refreshToken: identity.refreshToken,
        accessToken: identity.accessToken,
        expiresAt: identity.expiresAt,
        message: stored.pending_message,
        activityCutoff: clock.now(),
        now: clock.now(),
      });
      logger.info('connect.completed', { athleteId: identity.athleteId });

      try {
        await seedAthlete(identity.athleteId, identity.accessToken);
      } catch (error) {
        // The athlete is connected either way, and their next upload will be
        // picked up — a failed seed must not fail the connection.
        logger.error('connect.seed-failed', {
          athleteId: identity.athleteId, error: /** @type {Error} */ (error).message,
        });
      }

      return { athleteId: identity.athleteId, isNew: true };
    },
  };
}
```

- [ ] **Step 4: Run the connect service tests**

Run: `npm test -- test/services/connectService.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Write the failing athlete service test**

Create `test/services/athleteService.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createAthleteService } from '../../src/services/athleteService.js';
import { MAX_MESSAGE_LENGTH } from '../../src/domain/message.js';

function setup({ deauthorize, athlete = {} } = {}) {
  const db = testDb();
  makeAthlete(db, athlete);
  const athleteStore = createAthleteStore(db);
  const calls = { deauthorize: [] };
  const logger = collectingLogger();

  const service = createAthleteService({
    athleteStore,
    strava: {
      async deauthorize(token) {
        calls.deauthorize.push(token);
        if (deauthorize) return deauthorize(token);
      },
    },
    clock: fixedClock(NOW),
    logger,
  });

  return { athleteStore, service, calls, logger };
}

test('updateMessage stores valid text and stamps the timestamp', () => {
  const { athleteStore, service } = setup();
  assert.deepEqual(service.updateMessage(987654, 'Powered by stubbornness'), { ok: true });
  assert.equal(athleteStore.get(987654).message, 'Powered by stubbornness');
  assert.equal(athleteStore.get(987654).message_updated_at, NOW);
});

test('a blank message reverts to the default', () => {
  const { athleteStore, service } = setup({ athlete: { message: 'mine' } });
  service.updateMessage(987654, '   ');
  assert.equal(athleteStore.get(987654).message, null);
});

test('an over-length message is rejected and nothing is stored', () => {
  const { athleteStore, service } = setup({ athlete: { message: 'original' } });
  const result = service.updateMessage(987654, 'x'.repeat(MAX_MESSAGE_LENGTH + 1));

  assert.equal(result.ok, false);
  assert.match(result.error, /200/);
  assert.equal(athleteStore.get(987654).message, 'original');
});

test('updateMessage makes no Strava calls and revisits no activity', () => {
  const { athleteStore, service, calls } = setup();
  const before = athleteStore.get(987654).processed_count;
  service.updateMessage(987654, 'new words');

  assert.deepEqual(calls.deauthorize, []);
  assert.equal(athleteStore.get(987654).processed_count, before, 'changing the message is not retroactive');
});

test('disconnect deauthorizes at Strava and revokes the row', async () => {
  const { athleteStore, service, calls } = setup({ athlete: { accessToken: 'access-1' } });
  await service.disconnect(987654);

  assert.deepEqual(calls.deauthorize, ['access-1']);
  assert.equal(athleteStore.get(987654).status, 'revoked');
  assert.equal(athleteStore.get(987654).revoked_at, NOW);
});

test('disconnect still revokes locally when the Strava call fails', async () => {
  const { athleteStore, service, logger } = setup({
    deauthorize: () => { throw new Error('Strava API 500: boom'); },
  });
  await assert.doesNotReject(() => service.disconnect(987654));

  assert.equal(athleteStore.get(987654).status, 'revoked',
    'a failed upstream call must not trap the athlete in a state they asked to leave');
  assert.ok(logger.entries.some((e) => e.event === 'athlete.deauthorize-failed'));
});

test('disconnecting an unknown athlete is a no-op rather than a crash', async () => {
  const { service } = setup();
  await assert.doesNotReject(() => service.disconnect(404404));
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- test/services/athleteService.test.js`
Expected: FAIL — `Cannot find module '.../athleteService.js'`

- [ ] **Step 7: Implement the athlete service**

Create `src/services/athleteService.js`:

```js
import { validateMessage } from '../domain/message.js';

/** @typedef {import('../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../ports/index.js').Clock} Clock */
/** @typedef {import('../ports/index.js').Logger} Logger */
/** @typedef {import('../ports/index.js').StravaClient} StravaClient */

/**
 * @param {{ athleteStore: AthleteStore, strava: Pick<StravaClient,'deauthorize'>, clock: Clock, logger: Logger }} deps
 */
export function createAthleteService({ athleteStore, strava, clock, logger }) {
  return {
    /**
     * Affects future activities only — already-processed activities keep the
     * text they were given, because the service never revisits an activity.
     *
     * @param {number} athleteId
     * @param {string|null|undefined} rawMessage
     * @returns {{ ok: true } | { ok: false, error: string }}
     */
    updateMessage(athleteId, rawMessage) {
      const validated = validateMessage(rawMessage);
      if (!validated.ok) return { ok: false, error: validated.error };

      athleteStore.setMessage(athleteId, validated.value, clock.now());
      logger.info('athlete.message-changed', { athleteId, usingDefault: validated.value === null });
      return { ok: true };
    },

    /** @param {number} athleteId */
    async disconnect(athleteId) {
      const athlete = athleteStore.get(athleteId);
      if (!athlete) return;

      try {
        await strava.deauthorize(athlete.access_token);
      } catch (error) {
        logger.error('athlete.deauthorize-failed', {
          athleteId, error: /** @type {Error} */ (error).message,
        });
      }

      // Revoking locally is what matters — a failed upstream call must not
      // leave the athlete stuck in a connected state they asked to leave.
      athleteStore.markRevoked(athleteId, clock.now());
      logger.info('athlete.disconnected', { athleteId });
    },
  };
}
```

- [ ] **Step 8: Run the service tests**

Run: `npm test -- test/services/`
Expected: PASS, 38 tests across four files

- [ ] **Step 9: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 165 tests pass

```bash
git add src/services/connectService.js src/services/athleteService.js \
        test/services/connectService.test.js test/services/athleteService.test.js
git commit -m "feat: connect and athlete services"
```

### Task 11: Session, auth middleware, app shell, webhook routes

**Files:**
- Create: `src/web/session.js`, `src/web/middleware/auth.js`, `src/web/routes/webhook.js`, `src/web/app.js`
- Create: `test/support/app.js`
- Test: `test/web/session.test.js`, `test/web/auth.test.js`, `test/web/webhook.test.js`

**Interfaces:**
- Consumes: `Config` (Task 1), `AthleteStore` / `ActivityStore` (Task 3), `Clock` / `Logger` (Task 4), `Dispatcher` and `activityJob` (Task 8).
- Produces:
  - `createSessions(secret) -> { COOKIE_NAME, MAX_AGE_SECONDS, sign, verify, cookieOptions, csrfToken, verifyCsrf }`
  - `createAuth({ sessions, athleteStore, config, clock, logger }) -> { requireAthlete, requireAdmin, requireCsrf }` — Express middlewares. `requireAthlete` puts `{ athlete, cookieValue }` on `req.session`.
  - `webhookRouter({ config, athleteStore, activityStore, dispatcher, clock, logger }) -> Router`
  - `createApp(container) -> express.Application`
  - `test/support/app.js`: `request(app, path, init)` — binds an ephemeral port and returns a `fetch` `Response`.

`requireAdmin` has no routes behind it yet. It exists now because retrofitting a second authorization mode onto middleware that assumes one is the expensive version of this change.

- [ ] **Step 1: Write the failing session test**

Create `test/web/session.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessions } from '../../src/web/session.js';

const SECRET = 'a'.repeat(32);
const NOW = 1_800_000_000;

test('round-trips an athlete id', () => {
  const sessions = createSessions(SECRET);
  assert.equal(sessions.verify(sessions.sign(987654, NOW + 3600), NOW), 987654);
});

test('rejects a tampered athlete id', () => {
  const sessions = createSessions(SECRET);
  const cookie = sessions.sign(987654, NOW + 3600);
  assert.equal(sessions.verify(cookie.replace('987654', '111111'), NOW), null);
});

test('rejects a cookie signed with a different secret', () => {
  const mine = createSessions(SECRET);
  const theirs = createSessions('b'.repeat(32));
  assert.equal(mine.verify(theirs.sign(987654, NOW + 3600), NOW), null);
});

test('rejects an expired cookie', () => {
  const sessions = createSessions(SECRET);
  assert.equal(sessions.verify(sessions.sign(987654, NOW - 1), NOW), null);
});

test('rejects malformed, empty, and non-string values', () => {
  const sessions = createSessions(SECRET);
  for (const bad of ['', 'garbage', 'a.b', '1.2.3.4', undefined, null, 42]) {
    assert.equal(sessions.verify(/** @type {any} */ (bad), NOW), null);
  }
});

test('rejects a non-numeric athlete id even if correctly signed', () => {
  const sessions = createSessions(SECRET);
  // A signature over "abc.<exp>" is valid, but the payload is not an id.
  const forged = sessions.sign(/** @type {any} */ ('abc'), NOW + 3600);
  assert.equal(sessions.verify(forged, NOW), null);
});

test('cookie options carry the required security attributes', () => {
  const options = createSessions(SECRET).cookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
});

test('a CSRF token verifies against its own session and no other', () => {
  const sessions = createSessions(SECRET);
  const mine = sessions.sign(987654, NOW + 3600);
  const other = sessions.sign(111111, NOW + 3600);
  const token = sessions.csrfToken(mine);

  assert.equal(sessions.verifyCsrf(mine, token), true);
  assert.equal(sessions.verifyCsrf(other, token), false);
  assert.equal(sessions.verifyCsrf(mine, 'wrong'), false);
  assert.equal(sessions.verifyCsrf(mine, undefined), false);
  assert.equal(sessions.verifyCsrf(mine, ''), false);
});
```

- [ ] **Step 2: Run it to verify it fails, then implement sessions**

Run: `npm test -- test/web/session.test.js`
Expected: FAIL — `Cannot find module '.../session.js'`

Create `src/web/session.js`:

```js
import crypto from 'node:crypto';

const COOKIE_NAME = 'runsync_session';
const MAX_AGE_SECONDS = 30 * 24 * 3600;

/** @param {string} secret @param {string} value */
function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

/** Constant-time compare that tolerates differing lengths. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** @param {string} secret */
export function createSessions(secret) {
  return {
    COOKIE_NAME,
    MAX_AGE_SECONDS,

    /** @param {number} athleteId @param {number} expiresAt */
    sign(athleteId, expiresAt) {
      const payload = `${athleteId}.${expiresAt}`;
      return `${payload}.${hmac(secret, payload)}`;
    },

    /**
     * @param {unknown} cookieValue
     * @param {number} now
     * @returns {number|null}
     */
    verify(cookieValue, now) {
      if (typeof cookieValue !== 'string') return null;
      const parts = cookieValue.split('.');
      if (parts.length !== 3) return null;

      const [athleteId, expiresAt, signature] = parts;
      if (!safeEqual(signature, hmac(secret, `${athleteId}.${expiresAt}`))) return null;
      // Checked after the signature so a forged shape cannot be probed cheaply,
      // and before use so a validly signed non-numeric payload is still refused.
      if (!/^\d+$/.test(athleteId) || !/^\d+$/.test(expiresAt)) return null;
      if (Number(expiresAt) <= now) return null;

      return Number(athleteId);
    },

    cookieOptions() {
      return {
        httpOnly: true, secure: true, sameSite: /** @type {const} */ ('lax'),
        path: '/', maxAge: MAX_AGE_SECONDS,
      };
    },

    /** @param {string} cookieValue */
    csrfToken(cookieValue) {
      return hmac(secret, `csrf:${cookieValue}`);
    },

    /** @param {string} cookieValue @param {unknown} token */
    verifyCsrf(cookieValue, token) {
      if (typeof token !== 'string' || token === '') return false;
      return safeEqual(token, hmac(secret, `csrf:${cookieValue}`));
    },
  };
}
```

Run: `npm test -- test/web/session.test.js`
Expected: PASS, 8 tests

- [ ] **Step 3: Write the test app helper**

Create `test/support/app.js`:

```js
/**
 * Exercises a real Express app over a real socket — routing, body parsing, and
 * cookies included — without a supertest dependency.
 *
 * The server is closed before returning, but detached dispatcher work continues
 * on the event loop. That is why webhook tests await `dispatcher.drain()`.
 */
export async function request(app, path, init) {
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = /** @type {any} */ (server.address());
    return await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init });
  } finally {
    server.close();
  }
}

/** @param {Record<string,string>} fields */
export function form(fields) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}

/** @param {unknown} body */
export function json(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
```

- [ ] **Step 4: Write the failing auth middleware test**

Create `test/web/auth.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDb, testConfig, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { request, form } from '../support/app.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createSessions } from '../../src/web/session.js';
import { createAuth } from '../../src/web/middleware/auth.js';

function setup({ config = {}, athlete = {} } = {}) {
  const db = testDb();
  makeAthlete(db, athlete);
  const athleteStore = createAthleteStore(db);
  const resolved = testConfig(config);
  const sessions = createSessions(resolved.sessionSecret);
  const auth = createAuth({ sessions, athleteStore, config: resolved, clock: fixedClock(NOW), logger: collectingLogger() });

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.get('/private', auth.requireAthlete, (req, res) => res.json({ athleteId: req.session.athlete.athlete_id }));
  app.get('/admin', auth.requireAthlete, auth.requireAdmin, (req, res) => res.json({ ok: true }));
  app.post('/write', auth.requireAthlete, auth.requireCsrf, (req, res) => res.json({ ok: true }));

  const cookieFor = (id) => `${sessions.COOKIE_NAME}=${encodeURIComponent(sessions.sign(id, NOW + 3600))}`;
  const csrfFor = (id) => sessions.csrfToken(sessions.sign(id, NOW + 3600));

  return { app, athleteStore, sessions, cookieFor, csrfFor };
}

test('requireAthlete redirects an unauthenticated request to /login', async () => {
  const { app } = setup();
  const response = await request(app, '/private');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
});

test('requireAthlete rejects a tampered cookie', async () => {
  const { app, sessions } = setup();
  const forged = `${sessions.COOKIE_NAME}=987654.9999999999.not-a-signature`;
  assert.equal((await request(app, '/private', { headers: { cookie: forged } })).status, 302);
});

test('requireAthlete redirects when the session names a deleted athlete', async () => {
  const { app, cookieFor } = setup();
  assert.equal((await request(app, '/private', { headers: { cookie: cookieFor(404404) } })).status, 302);
});

test('requireAthlete attaches the athlete row to the request', async () => {
  const { app, cookieFor } = setup();
  const response = await request(app, '/private', { headers: { cookie: cookieFor(987654) } });
  assert.deepEqual(await response.json(), { athleteId: 987654 });
});

test('requireAthlete admits a revoked athlete, so they can see why and reconnect', async () => {
  const { app, athleteStore, cookieFor } = setup();
  athleteStore.markRevoked(987654, NOW);
  assert.equal((await request(app, '/private', { headers: { cookie: cookieFor(987654) } })).status, 200);
});

test('requireAdmin refuses everyone when ADMIN_ATHLETE_IDS is empty', async () => {
  const { app, cookieFor } = setup();
  assert.equal((await request(app, '/admin', { headers: { cookie: cookieFor(987654) } })).status, 403);
});

test('requireAdmin admits a listed athlete and refuses an unlisted one', async () => {
  const { app, cookieFor } = setup({ config: { adminAthleteIds: new Set([987654]) } });
  assert.equal((await request(app, '/admin', { headers: { cookie: cookieFor(987654) } })).status, 200);

  const other = setup({ config: { adminAthleteIds: new Set([111]) } });
  assert.equal((await request(other.app, '/admin', { headers: { cookie: other.cookieFor(987654) } })).status, 403);
});

test('requireCsrf refuses a missing, wrong, or foreign token and admits a valid one', async () => {
  const { app, cookieFor, csrfFor } = setup();
  const cookie = cookieFor(987654);

  for (const fields of [{}, { csrf: 'wrong' }, { csrf: csrfFor(111111) }]) {
    const response = await request(app, '/write', { ...form(fields), headers: { ...form(fields).headers, cookie } });
    assert.equal(response.status, 403);
  }

  const good = form({ csrf: csrfFor(987654) });
  const response = await request(app, '/write', { ...good, headers: { ...good.headers, cookie } });
  assert.equal(response.status, 200);
});
```

- [ ] **Step 5: Run it to verify it fails, then implement auth**

Run: `npm test -- test/web/auth.test.js`
Expected: FAIL — `Cannot find module '.../auth.js'`

Create `src/web/middleware/auth.js`:

```js
import * as cookieLib from 'cookie';

/** @typedef {import('../../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../../ports/index.js').Clock} Clock */
/** @typedef {import('../../ports/index.js').Config} Config */
/** @typedef {import('../../ports/index.js').Logger} Logger */

/**
 * Two authorization modes from the start. `requireAdmin` has no routes behind
 * it yet — it exists because retrofitting a second mode onto middleware that
 * assumes one is the expensive version of this change.
 *
 * @param {{ sessions: any, athleteStore: AthleteStore, config: Config, clock: Clock, logger: Logger }} deps
 */
export function createAuth({ sessions, athleteStore, config, clock, logger }) {
  return {
    /** @type {import('express').RequestHandler} */
    requireAthlete(req, res, next) {
      const cookies = cookieLib.parse(req.headers.cookie ?? '');
      const cookieValue = cookies[sessions.COOKIE_NAME];
      const athleteId = sessions.verify(cookieValue, clock.now());
      if (athleteId === null) return res.redirect(302, '/login');

      const athlete = athleteStore.get(athleteId);
      // A session naming an athlete we no longer hold is not an error to shout
      // about — send them back through the front door.
      if (!athlete) return res.redirect(302, '/login');

      // A revoked athlete is deliberately admitted: the dashboard is where they
      // find out they are disconnected and how to reconnect.
      req.session = { athlete, cookieValue };
      return next();
    },

    /** @type {import('express').RequestHandler} */
    requireAdmin(req, res, next) {
      const athleteId = req.session?.athlete?.athlete_id;
      if (!config.adminAthleteIds.has(athleteId)) {
        logger.warn('auth.admin-refused', { athleteId });
        return res.status(403).type('text').send('Not found.');
      }
      return next();
    },

    /** @type {import('express').RequestHandler} */
    requireCsrf(req, res, next) {
      if (sessions.verifyCsrf(req.session.cookieValue, req.body?.csrf)) return next();
      logger.warn('auth.csrf-refused', { athleteId: req.session.athlete.athlete_id });
      return res.status(403).type('text').send('This form has expired. Reload the page and try again.');
    },
  };
}
```

- [ ] **Step 6: Write the failing webhook test**

Create `test/web/webhook.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, testConfig, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { request, json } from '../support/app.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createApp } from '../../src/web/app.js';
import { createSessions } from '../../src/web/session.js';

function harness({ config = {} } = {}) {
  const db = testDb();
  makeAthlete(db);
  const resolved = testConfig(config);
  const stores = { athletes: createAthleteStore(db), activities: createActivityStore(db) };
  const dispatched = [];
  const dispatcher = { dispatch: (job) => dispatched.push(job), drain: async () => {} };

  const app = createApp({
    config: resolved,
    athleteStore: stores.athletes,
    activityStore: stores.activities,
    dispatcher,
    sessions: createSessions(resolved.sessionSecret),
    connectService: {},
    athleteService: {},
    clock: fixedClock(NOW),
    logger: collectingLogger(),
  });

  return { app, stores, dispatched };
}

const activityEvent = (overrides = {}) => ({
  object_type: 'activity', aspect_type: 'create', object_id: 555,
  owner_id: 987654, subscription_id: 77, updates: {}, ...overrides,
});

const post = (app, body) => request(app, '/webhook', json(body));

test('GET /webhook echoes the challenge when the verify token matches', async () => {
  const { app } = harness();
  const response = await request(app, '/webhook?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=abc123');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { 'hub.challenge': 'abc123' });
});

test('GET /webhook refuses a wrong verify token', async () => {
  const { app } = harness();
  assert.equal((await request(app, '/webhook?hub.verify_token=wrong&hub.challenge=abc')).status, 403);
});

test('POST /webhook answers 200 and dispatches a typed job', async () => {
  const { app, dispatched } = harness();
  const response = await post(app, activityEvent());
  assert.equal(response.status, 200);
  assert.deepEqual(dispatched, [{ type: 'activity.process', athleteId: 987654, activityId: 555 }]);
});

test('POST /webhook answers 200 even for an event it drops', async () => {
  const { app } = harness();
  assert.equal((await post(app, activityEvent({ object_type: 'segment' }))).status, 200);
});

test('POST /webhook answers 200 on a malformed body', async () => {
  const { app, dispatched } = harness();
  const response = await request(app, '/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
  });
  assert.equal(response.status, 200, 'Strava disables a subscription that returns errors');
  assert.deepEqual(dispatched, []);
});

test('rejects an event whose subscription_id is not ours', async () => {
  const { app, dispatched } = harness();
  const response = await post(app, activityEvent({ subscription_id: 999 }));
  assert.equal(response.status, 200, 'still 200 — Strava requires it');
  assert.deepEqual(dispatched, [], 'but a forged event must not be processed');
});

test('accepts any subscription_id when STRAVA_SUBSCRIPTION_ID is unset', async () => {
  const { app, dispatched } = harness({ config: { subscriptionId: null } });
  await post(app, activityEvent({ subscription_id: 999 }));
  assert.equal(dispatched.length, 1);
});

test('handles update events the same as create events', async () => {
  const { app, dispatched } = harness();
  await post(app, activityEvent({ aspect_type: 'update' }));
  assert.equal(dispatched.length, 1);
});

test('a delete event clears the processed record and dispatches nothing', async () => {
  const { app, stores, dispatched } = harness();
  stores.activities.markProcessed(555, 987654, NOW);
  await post(app, activityEvent({ aspect_type: 'delete' }));

  assert.equal(stores.activities.isProcessed(555), false);
  assert.deepEqual(dispatched, []);
});

test('a deauthorization event revokes the athlete', async () => {
  const { app, stores, dispatched } = harness();
  await post(app, {
    object_type: 'athlete', aspect_type: 'update', object_id: 987654,
    owner_id: 987654, subscription_id: 77, updates: { authorized: 'false' },
  });

  assert.equal(stores.athletes.get(987654).status, 'revoked');
  assert.deepEqual(dispatched, []);
});

test('an athlete event that is not a deauthorization changes nothing', async () => {
  const { app, stores } = harness();
  await post(app, {
    object_type: 'athlete', aspect_type: 'update', object_id: 987654,
    owner_id: 987654, subscription_id: 77, updates: {},
  });
  assert.equal(stores.athletes.get(987654).status, 'active');
});

test('a deauthorization for an athlete we do not know is ignored quietly', async () => {
  const { app } = harness();
  const response = await post(app, {
    object_type: 'athlete', aspect_type: 'update', object_id: 404404,
    owner_id: 404404, subscription_id: 77, updates: { authorized: 'false' },
  });
  assert.equal(response.status, 200);
});

test('ignores unhandled object types', async () => {
  const { app, dispatched } = harness();
  await post(app, activityEvent({ object_type: 'segment' }));
  assert.deepEqual(dispatched, []);
});
```

- [ ] **Step 7: Run it to verify it fails, then implement the webhook router and app**

Run: `npm test -- test/web/webhook.test.js`
Expected: FAIL — `Cannot find module '.../app.js'`

Create `src/web/routes/webhook.js`:

```js
import express from 'express';
import { activityJob } from '../../services/jobs.js';

/** @typedef {import('../../ports/index.js').ActivityStore} ActivityStore */
/** @typedef {import('../../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../../ports/index.js').Clock} Clock */
/** @typedef {import('../../ports/index.js').Config} Config */
/** @typedef {import('../../ports/index.js').Dispatcher} Dispatcher */
/** @typedef {import('../../ports/index.js').Logger} Logger */

/**
 * @param {{ config: Config, athleteStore: AthleteStore, activityStore: ActivityStore,
 *           dispatcher: Dispatcher, clock: Clock, logger: Logger }} deps
 */
export function webhookRouter({ config, athleteStore, activityStore, dispatcher, clock, logger }) {
  const router = express.Router();

  router.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] !== config.webhookVerifyToken) {
      logger.warn('webhook.handshake-refused', {});
      return res.sendStatus(403);
    }
    return res.json({ 'hub.challenge': req.query['hub.challenge'] });
  });

  router.post('/webhook', (req, res) => {
    // Answer first, unconditionally. Strava requires an ack within 2 seconds
    // and disables the subscription after repeated timeouts — so every path
    // below this line returns without touching the response.
    res.sendStatus(200);

    const event = req.body ?? {};

    // Strava's webhook carries no signature, so anyone who finds the URL can
    // forge events. Matching the subscription id is obscurity, not
    // authentication — proportionate to a blast radius of "appends our own
    // message", and it keeps a forger from burning the rate limit.
    if (config.subscriptionId !== null && event.subscription_id !== config.subscriptionId) {
      logger.warn('webhook.foreign-subscription', { subscriptionId: event.subscription_id });
      return;
    }

    if (event.object_type === 'athlete') {
      if (String(event.updates?.authorized) === 'false' && athleteStore.get(event.object_id)) {
        athleteStore.markRevoked(event.object_id, clock.now());
        logger.info('athlete.deauthorized', { athleteId: event.object_id });
      }
      return;
    }

    if (event.object_type !== 'activity') {
      logger.debug('webhook.ignored', { objectType: event.object_type });
      return;
    }

    if (event.aspect_type === 'delete') {
      activityStore.deleteProcessed(event.object_id);
      logger.info('activity.deleted-upstream', { activityId: event.object_id });
      return;
    }

    dispatcher.dispatch(activityJob(event.owner_id, event.object_id));
  });

  return router;
}
```

Create `src/web/app.js`:

```js
import express from 'express';
import { webhookRouter } from './routes/webhook.js';

/**
 * Assembles the HTTP surface from an already-built container. Constructs
 * nothing itself — that is container.js's job, which is what keeps this
 * module free of adapter imports.
 *
 * @param {any} container
 * @returns {import('express').Application}
 */
export function createApp(container) {
  const { config, athleteStore, activityStore, dispatcher, clock, logger } = container;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // A malformed body must not produce a 400 from the webhook — Strava treats
  // any non-200 as a failure. Swallow the parse error and let handlers see {}.
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((error, req, res, next) => {
    if (error?.type === 'entity.parse.failed') {
      logger.warn('http.bad-body', { path: req.path });
      req.body = {};
      return next();
    }
    return next(error);
  });

  app.use(webhookRouter({ config, athleteStore, activityStore, dispatcher, clock, logger }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  return app;
}
```

- [ ] **Step 8: Run the web tests**

Run: `npm test -- test/web/`
Expected: PASS, 30 tests

- [ ] **Step 9: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 195 tests pass

```bash
git add src/web/session.js src/web/middleware/ src/web/routes/webhook.js src/web/app.js \
        test/web/ test/support/app.js
git commit -m "feat: sessions, auth middleware, app shell, and webhook routes"
```

---

### Task 12: Views, connect and OAuth routes

**Files:**
- Create: `src/web/views/layout.js`, `src/web/views/connect.js`, `src/web/routes/connect.js`, `src/web/routes/oauth.js`
- Modify: `src/web/app.js` (mount the two routers)
- Test: `test/web/connect.test.js`

**Interfaces:**
- Consumes: `html` / `raw` / `escapeHtml` (Task 1), `MAX_MESSAGE_LENGTH` / `validateMessage` (Task 5), `InviteStore` / `AuthStateStore` (Task 3), `connectService` (Task 10), `sessions` (Task 11).
- Produces:
  - `page(title, body) -> string`, `messageField({ config, value, error }) -> string`
  - `renderConnectPage({ config, inviteToken, message, error })`, `renderInvalidInvite()`, `renderProblem(title, detail)`
  - `connectRouter({ config, inviteStore, authStateStore, clock, logger }) -> Router` — `GET /connect`, `POST /connect`, `GET /login`
  - `oauthRouter({ config, connectService, sessions, clock, logger }) -> Router` — `GET /oauth/callback`
  - `STATE_TTL_SECONDS = 600`, `INVITE_TTL_SECONDS = 604800`

`messageField` is shared by both forms, which is what guarantees the never-prefilled rule and the quoted-default hint cannot drift apart between the connect page and the dashboard.

- [ ] **Step 1: Write the failing connect test**

Create `test/web/connect.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, testConfig, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { request, form } from '../support/app.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createInviteStore } from '../../src/adapters/store/invites.js';
import { createAuthStateStore } from '../../src/adapters/store/authStates.js';
import { createApp } from '../../src/web/app.js';
import { createSessions } from '../../src/web/session.js';
import { ConflictError } from '../../src/domain/errors.js';

function harness({ config = {}, completeConnect } = {}) {
  const db = testDb();
  const resolved = testConfig(config);
  const stores = {
    athletes: createAthleteStore(db),
    activities: createActivityStore(db),
    invites: createInviteStore(db),
    authStates: createAuthStateStore(db),
  };
  const sessions = createSessions(resolved.sessionSecret);
  const completed = [];

  const app = createApp({
    config: resolved,
    athleteStore: stores.athletes,
    activityStore: stores.activities,
    inviteStore: stores.invites,
    authStateStore: stores.authStates,
    dispatcher: { dispatch: () => {}, drain: async () => {} },
    sessions,
    connectService: {
      async completeConnect(input) {
        completed.push(input);
        if (completeConnect) return completeConnect(input);
        return { athleteId: 987654, isNew: true };
      },
    },
    athleteService: {},
    clock: fixedClock(NOW),
    logger: collectingLogger(),
  });

  return { app, db, stores, sessions, completed, config: resolved };
}

function mintInvite(stores, token = 'invite-1') {
  stores.invites.create({ token, now: NOW, expiresAt: NOW + 604_800 });
  return token;
}

test('the connect page renders an EMPTY input and quotes the default verbatim', async () => {
  const { app, stores } = harness();
  const body = await (await request(app, `/connect?invite=${mintInvite(stores)}`)).text();

  assert.match(body, /name="message"/);
  assert.match(body, /<textarea[^>]*name="message"[^>]*><\/textarea>/,
    'the field must never be prefilled with the default');
  assert.match(body, /Leave blank to use the default message/);
  assert.match(body, /🏃 Synced via runsync/, 'the default must be quoted in the hint');
});

test('the quoted default is read from config, not hardcoded in the template', async () => {
  const { app, stores } = harness({ config: { appendMessage: 'Completely different default' } });
  const body = await (await request(app, `/connect?invite=${mintInvite(stores)}`)).text();

  assert.match(body, /Completely different default/);
  assert.ok(!/Synced via runsync/.test(body));
});

test('the connect page escapes a default containing HTML', async () => {
  const { app, stores } = harness({ config: { appendMessage: '<script>alert(1)</script>' } });
  const body = await (await request(app, `/connect?invite=${mintInvite(stores)}`)).text();

  assert.ok(!body.includes('<script>alert(1)</script>'));
  assert.match(body, /&lt;script&gt;/);
});

test('GET /connect refuses missing, unknown, expired, and consumed invites', async () => {
  const { app, stores } = harness();

  for (const path of ['/connect', '/connect?invite=nope']) {
    const response = await request(app, path);
    assert.equal(response.status, 403, path);
    assert.match(await response.text(), /no longer valid/);
  }

  stores.invites.create({ token: 'stale', now: NOW - 999_999, expiresAt: NOW - 1 });
  assert.equal((await request(app, '/connect?invite=stale')).status, 403);

  const used = mintInvite(stores, 'used');
  stores.invites.consume(used, 111, NOW);
  assert.equal((await request(app, `/connect?invite=${used}`)).status, 403);
});

test('POST /connect stores the pending message in the state row and redirects to Strava', async () => {
  const { app, stores, config } = harness();
  const token = mintInvite(stores);
  const response = await request(app, '/connect', form({ invite: token, message: 'Powered by stubbornness' }));

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin + location.pathname, 'https://www.strava.com/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), config.clientId);
  assert.equal(location.searchParams.get('scope'), 'activity:read,activity:write',
    'never activity:read_all');
  assert.equal(location.searchParams.get('redirect_uri'), `${config.baseUrl}/oauth/callback`);

  const stored = stores.authStates.consume(location.searchParams.get('state'), NOW);
  assert.equal(stored.invite_token, token);
  assert.equal(stored.pending_message, 'Powered by stubbornness');
});

test('POST /connect with a blank message stores null, so the athlete tracks the default', async () => {
  const { app, stores } = harness();
  const response = await request(app, '/connect', form({ invite: mintInvite(stores), message: '   ' }));
  const state = new URL(response.headers.get('location')).searchParams.get('state');
  assert.equal(stores.authStates.consume(state, NOW).pending_message, null);
});

test('POST /connect re-renders with the error and the text preserved when too long', async () => {
  const { app, stores } = harness();
  const tooLong = 'x'.repeat(201);
  const response = await request(app, '/connect', form({ invite: mintInvite(stores), message: tooLong }));

  assert.equal(response.status, 400);
  const body = await response.text();
  assert.match(body, /maximum is 200/);
  assert.match(body, new RegExp(tooLong), 'the athlete must not lose what they typed');
});

test('POST /connect refuses an invalid invite', async () => {
  const { app } = harness();
  assert.equal((await request(app, '/connect', form({ invite: 'nope', message: '' }))).status, 403);
});

test('GET /login redirects to Strava with a state carrying no invite', async () => {
  const { app, stores } = harness();
  const response = await request(app, '/login');
  const state = new URL(response.headers.get('location')).searchParams.get('state');
  assert.equal(stores.authStates.consume(state, NOW).invite_token, null);
});

test('a successful callback with both required scopes sets a hardened session cookie and redirects to the dashboard', async () => {
  const { app, sessions, completed } = harness();
  const response = await request(
    app,
    '/oauth/callback?code=the-code&state=s1&scope=activity%3Aread%20activity%3Awrite',
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/dashboard');
  assert.deepEqual(completed, [{ code: 'the-code', state: 's1' }]);

  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);

  const value = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
  assert.equal(sessions.verify(value, NOW), 987654);
});

test('the callback refuses insufficient granted scopes before exchanging the code', async () => {
  const { app, completed } = harness();
  const response = await request(app, '/oauth/callback?code=the-code&state=s1&scope=activity%3Aread');

  assert.equal(response.status, 403);
  assert.match(await response.text(), /read and write access/i);
  assert.deepEqual(completed, []);
});

test('a ConflictError from the service becomes a 403 with its own message, not a 500', async () => {
  const { app } = harness({
    completeConnect: () => { throw new ConflictError('This invite link has already been used.'); },
  });
  const response = await request(
    app,
    '/oauth/callback?code=c&state=s1&scope=activity%3Aread%20activity%3Awrite',
  );

  assert.equal(response.status, 403);
  assert.match(await response.text(), /already been used/);
});

test('an unexpected error becomes a 500 without leaking the message', async () => {
  const { app } = harness({ completeConnect: () => { throw new Error('token exchange exploded'); } });
  const response = await request(
    app,
    '/oauth/callback?code=c&state=s1&scope=activity%3Aread%20activity%3Awrite',
  );

  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('exploded'));
});

test('the callback rejects a missing code or state before calling the service', async () => {
  const { app, completed } = harness();
  assert.equal((await request(app, '/oauth/callback')).status, 400);
  assert.equal((await request(app, '/oauth/callback?code=c')).status, 400);
  assert.deepEqual(completed, []);
});

test('the athlete denying access on Strava shows a plain page, not an error', async () => {
  const { app, completed } = harness();
  const response = await request(app, '/oauth/callback?error=access_denied&state=s1');

  assert.equal(response.status, 400);
  assert.match(await response.text(), /did not authorize/i);
  assert.deepEqual(completed, []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/web/connect.test.js`
Expected: FAIL — `Cannot find module '.../views/layout.js'`

- [ ] **Step 3: Implement the layout and shared field**

Create `src/web/views/layout.js`:

```js
import { html, raw } from '../html.js';
import { MAX_MESSAGE_LENGTH } from '../../domain/message.js';

const STYLE = `
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  textarea { width: 100%; font: inherit; padding: .5rem; }
  .hint { color: #555; font-size: .9rem; }
  .hint code { background: #f2f2f2; padding: .1rem .3rem; border-radius: 3px; }
  .error { color: #b00020; font-weight: 600; }
  .status-revoked { color: #b00020; }
  button { font: inherit; padding: .5rem 1rem; cursor: pointer; }
  dt { font-weight: 600; margin-top: .75rem; }
`;

/** @param {string} title @param {string} body */
export function page(title, body) {
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${raw(STYLE)}</style></head>
<body>${raw(body)}</body></html>`;
}

/**
 * The single message input, shared by the connect page and the dashboard.
 *
 * It is NEVER prefilled with the default: `value` is the athlete's own override
 * and nothing else, so an empty field always means "on the default". The
 * default is quoted verbatim below it, read from config rather than hardcoded,
 * so the two can never drift apart — and quoting it is what makes a blank
 * submission an informed choice rather than a surprise.
 *
 * @param {{ config: {appendMessage: string}, value?: string|null, error?: string|null }} input
 */
export function messageField({ config, value = null, error = null }) {
  return html`
    ${raw(error ? html`<p class="error">${error}</p>` : '')}
    <label for="message">Your message</label>
    <textarea id="message" name="message" rows="3">${value ?? ''}</textarea>
    <p class="hint">
      Leave blank to use the default message: <code>${config.appendMessage}</code><br>
      Up to ${MAX_MESSAGE_LENGTH} characters.
    </p>`;
}

/** @param {string} title @param {string} detail */
export function renderProblem(title, detail) {
  return page(title, html`<h1>${title}</h1><p>${detail}</p>`);
}
```

Create `src/web/views/connect.js`:

```js
import { html, raw } from '../html.js';
import { page, messageField } from './layout.js';

/**
 * @param {{ config: any, inviteToken: string, message?: string|null, error?: string|null }} input
 */
export function renderConnectPage({ config, inviteToken, message = null, error = null }) {
  const sports = [...config.sportTypes].join(' and ');
  return page('Connect to runsync', html`
    <h1>Connect your Strava account</h1>
    <p>runsync adds a short message to the description of every new ${sports}
       activity you upload.</p>
    <p>It will also add it to your most recent run straight away, so you can see
       that it works. Nothing older than that is ever touched.</p>
    <form method="post" action="/connect">
      <input type="hidden" name="invite" value="${inviteToken}">
      ${raw(messageField({ config, value: message, error }))}
      <button type="submit">Connect with Strava</button>
    </form>`);
}

export function renderInvalidInvite() {
  return page('Invite not valid', html`
    <h1>This invite link is no longer valid</h1>
    <p>It may have expired or already been used. Ask for a fresh one.</p>`);
}
```

- [ ] **Step 4: Implement the connect and OAuth routers**

Create `src/web/routes/connect.js`:

```js
import crypto from 'node:crypto';
import express from 'express';
import { validateMessage } from '../../domain/message.js';
import { renderConnectPage, renderInvalidInvite } from '../views/connect.js';

export const STATE_TTL_SECONDS = 600;
export const INVITE_TTL_SECONDS = 7 * 24 * 3600;

/** Never activity:read_all — the service only reads activities it is told about. */
const SCOPE = 'activity:read,activity:write';

function authorizeUrl(config, state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${config.baseUrl}/oauth/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

/**
 * @param {{ config: any, inviteStore: any, authStateStore: any, clock: any, logger: any }} deps
 */
export function connectRouter({ config, inviteStore, authStateStore, clock, logger }) {
  const router = express.Router();

  /** Creates the CSRF state row and sends the athlete to Strava. */
  function beginOAuth(res, { inviteToken, pendingMessage }) {
    const state = crypto.randomBytes(32).toString('hex');
    authStateStore.create({
      state, inviteToken, pendingMessage,
      now: clock.now(), expiresAt: clock.now() + STATE_TTL_SECONDS,
    });
    return res.redirect(302, authorizeUrl(config, state));
  }

  router.get('/connect', (req, res) => {
    const invite = inviteStore.getUsable(String(req.query.invite ?? ''), clock.now());
    if (!invite) {
      logger.warn('connect.invite-refused', {});
      return res.status(403).type('html').send(renderInvalidInvite());
    }
    return res.type('html').send(renderConnectPage({ config, inviteToken: invite.token }));
  });

  router.post('/connect', (req, res) => {
    const inviteToken = String(req.body?.invite ?? '');
    const invite = inviteStore.getUsable(inviteToken, clock.now());
    if (!invite) {
      logger.warn('connect.invite-refused', {});
      return res.status(403).type('html').send(renderInvalidInvite());
    }

    const validated = validateMessage(req.body?.message);
    if (!validated.ok) {
      return res.status(400).type('html').send(renderConnectPage({
        config, inviteToken, message: req.body?.message, error: validated.error,
      }));
    }

    // The invite and the message travel in the state row, never in a query
    // parameter the callback would have to trust.
    return beginOAuth(res, { inviteToken, pendingMessage: validated.value });
  });

  router.get('/login', (req, res) => beginOAuth(res, { inviteToken: null, pendingMessage: null }));

  return router;
}
```

Create `src/web/routes/oauth.js`:

```js
import express from 'express';
import { ConflictError } from '../../domain/errors.js';
import { renderProblem } from '../views/layout.js';

const REQUIRED_SCOPES = new Set(['activity:read', 'activity:write']);

/** Strava returns granted scopes space-delimited; accept commas defensively. */
function hasRequiredScopes(scope) {
  if (typeof scope !== 'string') return false;
  const granted = new Set(scope.split(/[\s,]+/).filter(Boolean));
  return [...REQUIRED_SCOPES].every((required) => granted.has(required));
}

/**
 * @param {{ connectService: any, sessions: any, clock: any, logger: any }} deps
 */
export function oauthRouter({ connectService, sessions, clock, logger }) {
  const router = express.Router();

  router.get('/oauth/callback', async (req, res) => {
    if (req.query.error) {
      logger.info('oauth.declined', { reason: String(req.query.error) });
      return res.status(400).type('html').send(renderProblem(
        'Not connected',
        'You did not authorize runsync on Strava. You can close this page, or use your invite link again to retry.',
      ));
    }

    const code = req.query.code;
    const state = req.query.state;
    if (typeof code !== 'string' || typeof state !== 'string') {
      return res.status(400).type('html').send(renderProblem(
        'Something went wrong', 'That sign-in link was incomplete. Please start again.',
      ));
    }

    // Strava lets an athlete uncheck requested permissions and echoes the
    // granted scopes in this callback. Do not persist a connection that cannot
    // read and update activities; it would only fail later on webhook delivery.
    if (!hasRequiredScopes(req.query.scope)) {
      logger.warn('oauth.insufficient-scope', { scope: req.query.scope });
      return res.status(403).type('html').send(renderProblem(
        'Not connected',
        'runsync needs both activity read and write access. Use your invite link again and allow both permissions.',
      ));
    }

    try {
      const { athleteId } = await connectService.completeConnect({ code, state });
      const expiresAt = clock.now() + sessions.MAX_AGE_SECONDS;
      res.cookie(sessions.COOKIE_NAME, sessions.sign(athleteId, expiresAt), sessions.cookieOptions());
      return res.redirect(302, '/dashboard');
    } catch (error) {
      if (error instanceof ConflictError) {
        // Expected, athlete-facing: an expired state, a spent invite, a login
        // without a connection. Its message is written to be read.
        logger.info('oauth.refused', { reason: error.message });
        return res.status(403).type('html').send(renderProblem('Not connected', error.message));
      }
      logger.error('oauth.failed', { error: /** @type {Error} */ (error).message });
      return res.status(500).type('html').send(renderProblem(
        'Something went wrong', 'We could not complete the connection. Please try your invite link again.',
      ));
    }
  });

  return router;
}
```

- [ ] **Step 5: Mount the routers**

In `src/web/app.js`, add the imports:

```js
import { connectRouter } from './routes/connect.js';
import { oauthRouter } from './routes/oauth.js';
```

destructure the extra dependencies from the container:

```js
  const {
    config, athleteStore, activityStore, inviteStore, authStateStore,
    dispatcher, sessions, connectService, clock, logger,
  } = container;
```

and mount them after the webhook router:

```js
  app.use(connectRouter({ config, inviteStore, authStateStore, clock, logger }));
  app.use(oauthRouter({ connectService, sessions, clock, logger }));
```

- [ ] **Step 6: Run the connect tests**

Run: `npm test -- test/web/connect.test.js`
Expected: PASS, 15 tests

- [ ] **Step 7: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 210 tests pass

```bash
git add src/web/views/ src/web/routes/connect.js src/web/routes/oauth.js src/web/app.js \
        test/web/connect.test.js
git commit -m "feat: connect page and OAuth callback routes"
```

### Task 13: Dashboard

**Files:**
- Create: `src/web/views/dashboard.js`, `src/web/routes/dashboard.js`
- Modify: `src/web/app.js` (mount the dashboard router)
- Test: `test/web/dashboard.test.js`

**Interfaces:**
- Consumes: `page` / `messageField` (Task 12), `createAuth` / `sessions` (Task 11), `athleteService` (Task 10), `ActivityStore` (Task 3).
- Produces:
  - `renderDashboard({ config, athlete, recent, csrfToken, notice, messageValue }) -> string`
  - `dashboardRouter({ config, auth, activityStore, athleteService, sessions, clock, logger }) -> Router` — `GET /dashboard`, `POST /dashboard/message`, `POST /disconnect`

The message field shows `athlete.message` — empty for an athlete on the default — never `config.appendMessage`. It is the same `messageField` the connect page uses, so that rule is enforced in one place.

- [ ] **Step 1: Write the failing dashboard test**

Create `test/web/dashboard.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, testConfig, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { request, form } from '../support/app.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createInviteStore } from '../../src/adapters/store/invites.js';
import { createAuthStateStore } from '../../src/adapters/store/authStates.js';
import { createAthleteService } from '../../src/services/athleteService.js';
import { createApp } from '../../src/web/app.js';
import { createSessions } from '../../src/web/session.js';

function harness({ config = {}, deauthorize } = {}) {
  const db = testDb();
  const resolved = testConfig(config);
  const athleteStore = createAthleteStore(db);
  const activityStore = createActivityStore(db);
  const sessions = createSessions(resolved.sessionSecret);
  const logger = collectingLogger();
  const clock = fixedClock(NOW);
  const deauthorized = [];

  const athleteService = createAthleteService({
    athleteStore,
    strava: {
      async deauthorize(token) {
        deauthorized.push(token);
        if (deauthorize) return deauthorize(token);
      },
    },
    clock, logger,
  });

  const app = createApp({
    config: resolved, athleteStore, activityStore,
    inviteStore: createInviteStore(db), authStateStore: createAuthStateStore(db),
    dispatcher: { dispatch: () => {}, drain: async () => {} },
    sessions, connectService: {}, athleteService, clock, logger,
  });

  const cookieFor = (id) => `${sessions.COOKIE_NAME}=${encodeURIComponent(sessions.sign(id, NOW + 3600))}`;
  return { app, db, athleteStore, activityStore, sessions, cookieFor, deauthorized, logger };
}

const get = (app, cookie) => request(app, '/dashboard', cookie ? { headers: { cookie } } : undefined);

const post = (app, path, fields, cookie) => {
  const body = form(fields);
  return request(app, path, { ...body, headers: { ...body.headers, cookie } });
};

async function csrfFrom(app, cookie) {
  const body = await (await get(app, cookie)).text();
  return body.match(/name="csrf" value="([^"]+)"/)[1];
}

test('an unauthenticated request redirects to /login', async () => {
  const { app } = harness();
  const response = await get(app);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
});

test('renders the athlete own data and never another athlete data', async () => {
  const { app, db, cookieFor } = harness();
  makeAthlete(db, { athleteId: 1, name: 'Athlete One' });
  makeAthlete(db, { athleteId: 2, name: 'Athlete Two' });

  const body = await (await get(app, cookieFor(1))).text();
  assert.match(body, /Athlete One/);
  assert.ok(!body.includes('Athlete Two'));
});

test('an athlete on the default sees an EMPTY field and the quoted default', async () => {
  const { app, db, cookieFor } = harness();
  makeAthlete(db, { message: null });
  const body = await (await get(app, cookieFor(987654))).text();

  assert.match(body, /<textarea[^>]*name="message"[^>]*><\/textarea>/,
    'prefilling would silently convert a default-follower into an override-holder');
  assert.match(body, /Leave blank to use the default message/);
  assert.match(body, /🏃 Synced via runsync/);
});

test('an athlete with an override sees their own text in the field', async () => {
  const { app, db, cookieFor } = harness();
  makeAthlete(db, { message: 'Powered by stubbornness' });
  const body = await (await get(app, cookieFor(987654))).text();
  assert.match(body, /<textarea[^>]*>Powered by stubbornness<\/textarea>/);
});

test('escapes an athlete message containing HTML', async () => {
  const { app, db, cookieFor } = harness();
  makeAthlete(db, { message: '<script>alert(1)</script>' });
  const body = await (await get(app, cookieFor(987654))).text();

  assert.ok(!body.includes('<script>alert(1)</script>'));
  assert.match(body, /&lt;script&gt;/);
});

test('shows the cutoff, the counters, and the last error', async () => {
  const { app, db, athleteStore, cookieFor } = harness();
  makeAthlete(db);
  athleteStore.recordSuccess(987654, 555, NOW);
  athleteStore.recordError(987654, 'Strava API 429: Rate Limit Exceeded', NOW);

  const body = await (await get(app, cookieFor(987654))).text();
  assert.match(body, /activities before this date are not touched/i);
  assert.match(body, /Rate Limit Exceeded/);
  assert.match(body, /strava\.com\/activities\/555/);
});

test('states that changing the message is not retroactive', async () => {
  const { app, db, cookieFor } = harness();
  makeAthlete(db);
  const body = await (await get(app, cookieFor(987654))).text();
  assert.match(body, /future activities only/i);
});

test('a revoked athlete is shown as disconnected with a reconnect link', async () => {
  const { app, db, athleteStore, cookieFor } = harness();
  makeAthlete(db);
  athleteStore.markRevoked(987654, NOW);

  const body = await (await get(app, cookieFor(987654))).text();
  assert.match(body, /Disconnected/);
  assert.match(body, /href="\/login"/);
});

test('saving a message stores it and stamps the timestamp', async () => {
  const { app, db, athleteStore, cookieFor } = harness();
  makeAthlete(db);
  const cookie = cookieFor(987654);
  const csrf = await csrfFrom(app, cookie);

  const response = await post(app, '/dashboard/message', { csrf, message: 'Powered by stubbornness' }, cookie);
  assert.equal(response.status, 302);
  assert.equal(athleteStore.get(987654).message, 'Powered by stubbornness');
  assert.equal(athleteStore.get(987654).message_updated_at, NOW);
});

test('saving a blank message reverts to the default', async () => {
  const { app, db, athleteStore, cookieFor } = harness();
  makeAthlete(db, { message: 'mine' });
  const cookie = cookieFor(987654);
  const csrf = await csrfFrom(app, cookie);

  await post(app, '/dashboard/message', { csrf, message: '  ' }, cookie);
  assert.equal(athleteStore.get(987654).message, null);
});

test('an over-length message is rejected with the text preserved and nothing stored', async () => {
  const { app, db, athleteStore, cookieFor } = harness();
  makeAthlete(db, { message: 'original' });
  const cookie = cookieFor(987654);
  const csrf = await csrfFrom(app, cookie);
  const tooLong = 'x'.repeat(201);

  const response = await post(app, '/dashboard/message', { csrf, message: tooLong }, cookie);
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.match(body, /maximum is 200/);
  assert.match(body, new RegExp(tooLong));
  assert.equal(athleteStore.get(987654).message, 'original');
});

test('a missing, wrong, or foreign CSRF token changes nothing', async () => {
  const { app, db, athleteStore, sessions, cookieFor } = harness();
  makeAthlete(db, { athleteId: 987654, message: 'original' });
  const cookie = cookieFor(987654);
  const foreign = sessions.csrfToken(sessions.sign(111111, NOW + 3600));

  for (const fields of [{ message: 'hacked' }, { csrf: 'wrong', message: 'hacked' }, { csrf: foreign, message: 'hacked' }]) {
    const response = await post(app, '/dashboard/message', fields, cookie);
    assert.equal(response.status, 403);
    assert.equal(athleteStore.get(987654).message, 'original');
  }
});

test('changing the message revisits no activity', async () => {
  const { app, db, athleteStore, cookieFor } = harness();
  makeAthlete(db);
  athleteStore.recordSuccess(987654, 555, NOW);
  const cookie = cookieFor(987654);
  const csrf = await csrfFrom(app, cookie);

  await post(app, '/dashboard/message', { csrf, message: 'new words' }, cookie);
  assert.equal(athleteStore.get(987654).processed_count, 1);
  assert.equal(athleteStore.get(987654).last_activity_id, 555);
});

test('disconnect deauthorizes at Strava, revokes the row, and clears the cookie', async () => {
  const { app, db, athleteStore, cookieFor, deauthorized } = harness();
  makeAthlete(db, { accessToken: 'access-1', expiresAt: NOW + 3600 });
  const cookie = cookieFor(987654);
  const csrf = await csrfFrom(app, cookie);

  const response = await post(app, '/disconnect', { csrf }, cookie);
  assert.equal(response.status, 302);
  assert.deepEqual(deauthorized, ['access-1']);
  assert.equal(athleteStore.get(987654).status, 'revoked');
  assert.match(response.headers.get('set-cookie'), /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
});

test('disconnect still revokes locally when the Strava call fails', async () => {
  const { app, db, athleteStore, cookieFor } = harness({
    deauthorize: () => { throw new Error('Strava API 500: boom'); },
  });
  makeAthlete(db);
  const cookie = cookieFor(987654);
  const csrf = await csrfFrom(app, cookie);

  const response = await post(app, '/disconnect', { csrf }, cookie);
  assert.equal(response.status, 302);
  assert.equal(athleteStore.get(987654).status, 'revoked');
});

test('disconnect requires CSRF too', async () => {
  const { app, db, athleteStore, cookieFor, deauthorized } = harness();
  makeAthlete(db);

  const response = await post(app, '/disconnect', {}, cookieFor(987654));
  assert.equal(response.status, 403);
  assert.deepEqual(deauthorized, []);
  assert.equal(athleteStore.get(987654).status, 'active');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/web/dashboard.test.js`
Expected: FAIL — `Cannot find module '.../views/dashboard.js'`

- [ ] **Step 3: Implement the dashboard view**

Create `src/web/views/dashboard.js`:

```js
import { html, raw } from '../html.js';
import { page, messageField } from './layout.js';

/** @param {number|null|undefined} ts */
function when(ts) {
  if (!ts) return '—';
  return `${new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/**
 * @param {{ config: any, athlete: any, recent: Array<{activity_id:number,appended_at:number}>,
 *           csrfToken: string, notice?: string|null, messageValue?: string|null }} input
 */
export function renderDashboard({ config, athlete, recent, csrfToken, notice = null, messageValue }) {
  const isActive = athlete.status === 'active';
  // The field carries the athlete's own override and nothing else — never the
  // configured default. An empty field always means "on the default".
  const value = messageValue === undefined ? athlete.message : messageValue;

  return page('Your runsync settings', html`
    <h1>runsync</h1>
    <dl>
      <dt>Athlete</dt><dd>${athlete.name} (${athlete.athlete_id})</dd>
      <dt>Status</dt>
      <dd>${raw(isActive
        ? html`Connected`
        : html`<span class="status-revoked">Disconnected</span> — <a href="/login">reconnect</a>`)}</dd>
      <dt>Activities processed</dt><dd>${athlete.processed_count}</dd>
      <dt>Most recent</dt>
      <dd>${raw(athlete.last_activity_id
        ? html`<a href="https://www.strava.com/activities/${athlete.last_activity_id}"
                  >${athlete.last_activity_id}</a> on ${when(athlete.last_processed_at)}`
        : html`none yet`)}</dd>
      ${raw(athlete.last_error
        ? html`<dt>Last error</dt>
               <dd class="error">${athlete.last_error} (${when(athlete.last_error_at)})</dd>`
        : '')}
      <dt>Sports</dt><dd>${[...config.sportTypes].join(', ')}</dd>
      <dt>Active since</dt>
      <dd>${when(athlete.activity_cutoff)} — activities before this date are not touched.</dd>
      ${raw(recent.length > 0
        ? html`<dt>Recent</dt><dd>${recent.map((r) => raw(html`
            <a href="https://www.strava.com/activities/${r.activity_id}">${r.activity_id}</a>
            (${when(r.appended_at)})<br>`))}</dd>`
        : '')}
    </dl>

    <h2>Your message</h2>
    <form method="post" action="/dashboard/message">
      <input type="hidden" name="csrf" value="${csrfToken}">
      ${raw(messageField({ config, value, error: notice }))}
      <p class="hint">Changing this affects future activities only. Activities that
         already have a message keep the text they were given.
         ${raw(athlete.message_updated_at ? html`Last changed ${when(athlete.message_updated_at)}.` : '')}</p>
      <button type="submit">Save message</button>
    </form>

    <h2>Disconnect</h2>
    <form method="post" action="/disconnect">
      <input type="hidden" name="csrf" value="${csrfToken}">
      <button type="submit">Disconnect runsync from Strava</button>
    </form>`);
}
```

- [ ] **Step 4: Implement the dashboard router**

Create `src/web/routes/dashboard.js`:

```js
import express from 'express';
import { renderDashboard } from '../views/dashboard.js';

const RECENT_LIMIT = 5;

/**
 * @param {{ config: any, auth: any, activityStore: any, athleteService: any,
 *           sessions: any, logger: any }} deps
 */
export function dashboardRouter({ config, auth, activityStore, athleteService, sessions, logger }) {
  const router = express.Router();

  /** @param {any} req @param {{notice?: string|null, messageValue?: string|null}} [overrides] */
  function view(req, overrides = {}) {
    const { athlete, cookieValue } = req.session;
    return renderDashboard({
      config,
      athlete,
      recent: activityStore.recentFor(athlete.athlete_id, RECENT_LIMIT),
      csrfToken: sessions.csrfToken(cookieValue),
      ...overrides,
    });
  }

  router.get('/dashboard', auth.requireAthlete, (req, res) =>
    res.type('html').send(view(req)));

  router.post('/dashboard/message', auth.requireAthlete, auth.requireCsrf, (req, res) => {
    const result = athleteService.updateMessage(req.session.athlete.athlete_id, req.body?.message);
    if (!result.ok) {
      // Re-render with what they typed, so a rejected save never costs them
      // their text.
      return res.status(400).type('html').send(
        view(req, { notice: result.error, messageValue: req.body?.message }),
      );
    }
    return res.redirect(302, '/dashboard');
  });

  router.post('/disconnect', auth.requireAthlete, auth.requireCsrf, async (req, res, next) => {
    try {
      await athleteService.disconnect(req.session.athlete.athlete_id);
      res.clearCookie(sessions.COOKIE_NAME, { path: '/' });
      return res.redirect(302, '/login');
    } catch (error) {
      logger.error('dashboard.disconnect-failed', { error: /** @type {Error} */ (error).message });
      return next(error);
    }
  });

  return router;
}
```

- [ ] **Step 5: Mount the dashboard router**

In `src/web/app.js`, add the imports:

```js
import { createAuth } from './middleware/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
```

add `athleteService` to the destructured container, and mount after the OAuth router:

```js
  const auth = createAuth({ sessions, athleteStore, config, clock, logger });
  app.use(dashboardRouter({ config, auth, activityStore, athleteService, sessions, logger }));
```

- [ ] **Step 6: Run the dashboard tests**

Run: `npm test -- test/web/dashboard.test.js`
Expected: PASS, 17 tests

- [ ] **Step 7: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 227 tests pass

```bash
git add src/web/views/dashboard.js src/web/routes/dashboard.js src/web/app.js test/web/dashboard.test.js
git commit -m "feat: athlete dashboard with message editing, CSRF, and disconnect"
```

---

### Task 14: Container, server, and operational scripts

**Files:**
- Create: `src/container.js`, `src/server.js`, `scripts/mint-invite.js`, `scripts/create-subscription.js`
- Test: `test/container.test.js`

**Interfaces:**
- Consumes: everything built so far.
- Produces: `buildContainer(config) -> { config, db, clock, logger, athleteStore, activityStore, inviteStore, authStateStore, strava, tokens, dispatcher, connectService, athleteService, sessions, close() }`.

The composition root is the only module that constructs anything, which is what the architecture test in Task 1 enforces. Swapping the inline dispatcher for a durable queue is a change to this file and nothing else.

- [ ] **Step 1: Write the failing container test**

Create `test/container.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig } from './support/factories.js';
import { buildContainer } from '../src/container.js';

function build() {
  return buildContainer(testConfig({ dbPath: ':memory:', logLevel: 'error' }));
}

test('builds every collaborator the app needs', () => {
  const container = build();
  for (const key of [
    'config', 'db', 'clock', 'logger', 'athleteStore', 'activityStore', 'inviteStore',
    'authStateStore', 'strava', 'tokens', 'dispatcher', 'connectService', 'athleteService', 'sessions',
  ]) {
    assert.ok(container[key], `container is missing ${key}`);
  }
  container.close();
});

test('the database is migrated and usable', () => {
  const container = build();
  assert.equal(container.athleteStore.list().length, 0);
  container.close();
});

test('the dispatcher has a handler registered for the activity job type', async () => {
  const container = build();
  // No athlete exists, so the job resolves to unknown-athlete rather than
  // erroring — what matters is that it was routed, not dropped as unknown.
  container.dispatcher.dispatch({ type: 'activity.process', athleteId: 404404, activityId: 555 });
  await assert.doesNotReject(() => container.dispatcher.drain());
  container.close();
});

test('an unknown job type is dropped rather than thrown', async () => {
  const container = build();
  assert.doesNotThrow(() => container.dispatcher.dispatch(/** @type {any} */ ({ type: 'nope' })));
  await container.dispatcher.drain();
  container.close();
});

test('close is idempotent, so a double signal cannot crash shutdown', () => {
  const container = build();
  container.close();
  assert.doesNotThrow(() => container.close());
});

test('the app boots from the container', async () => {
  const { createApp } = await import('../src/web/app.js');
  const container = build();
  const app = createApp(container);
  assert.equal(typeof app.listen, 'function');
  container.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/container.test.js`
Expected: FAIL — `Cannot find module '../src/container.js'`

- [ ] **Step 3: Implement the container**

Create `src/container.js`:

```js
import { openDatabase } from './adapters/store/connection.js';
import { createAthleteStore } from './adapters/store/athletes.js';
import { createActivityStore } from './adapters/store/activities.js';
import { createInviteStore } from './adapters/store/invites.js';
import { createAuthStateStore } from './adapters/store/authStates.js';
import { systemClock } from './adapters/clock.js';
import { createLogger } from './adapters/logger.js';
import { createStravaClient } from './adapters/strava/client.js';
import { createTokenProvider } from './adapters/strava/tokens.js';
import { createInlineDispatcher } from './adapters/dispatch/inline.js';
import { createActivityProcessor } from './services/activityProcessor.js';
import { createConnectService } from './services/connectService.js';
import { createAthleteService } from './services/athleteService.js';
import { createSessions } from './web/session.js';

/** @typedef {import('./ports/index.js').Config} Config */

/**
 * The composition root — the only module that constructs anything. Every other
 * module receives what it needs, which is what makes the layers independently
 * testable and lets an adapter be swapped here without touching them.
 *
 * @param {Config} config
 */
export function buildContainer(config) {
  const clock = systemClock();
  const logger = createLogger({ level: config.logLevel });
  const db = openDatabase(config.dbPath);

  const athleteStore = createAthleteStore(db);
  const activityStore = createActivityStore(db);
  const inviteStore = createInviteStore(db);
  const authStateStore = createAuthStateStore(db);

  const strava = createStravaClient({ config });
  const tokens = createTokenProvider({ client: strava, athleteStore, clock, logger });

  const activityProcessor = createActivityProcessor({
    athleteStore, activityStore, strava, tokens, config, clock, logger,
  });

  // Swap this line for a queue-backed dispatcher and nothing upstream changes.
  const dispatcher = createInlineDispatcher({
    handlers: { 'activity.process': (job) => activityProcessor.process(/** @type {any} */ (job)) },
    logger,
  });

  const connectService = createConnectService({
    athleteStore, activityStore, inviteStore, authStateStore, strava, config, clock, logger,
  });
  const athleteService = createAthleteService({ athleteStore, strava, clock, logger });

  let closed = false;

  return {
    config, db, clock, logger,
    athleteStore, activityStore, inviteStore, authStateStore,
    strava, tokens, dispatcher,
    activityProcessor, connectService, athleteService,
    sessions: createSessions(config.sessionSecret),
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run the container tests**

Run: `npm test -- test/container.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Implement the server**

Create `src/server.js`:

```js
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { createApp } from './web/app.js';

const config = loadConfig();
const container = buildContainer(config);
const app = createApp(container);

const server = app.listen(config.port, () => {
  container.logger.info('server.started', {
    port: config.port,
    sportTypes: [...config.sportTypes],
    subscriptionId: config.subscriptionId,
  });
  if (config.subscriptionId === null) {
    container.logger.warn('server.subscription-unset', {
      detail: 'STRAVA_SUBSCRIPTION_ID is unset — incoming webhook events are accepted unverified',
    });
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    container.logger.info('server.stopping', { signal });
    server.close(async () => {
      // Let in-flight webhook work finish before the database goes away.
      await container.dispatcher.drain();
      container.close();
      process.exit(0);
    });
  });
}
```

- [ ] **Step 6: Verify the server boots and refuses a bad environment**

Run: `node src/server.js`
Expected: exits immediately with `Missing required environment variables: ...`

```bash
cp .env.example .env.local
# fill in STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_WEBHOOK_VERIFY_TOKEN,
# SESSION_SECRET (openssl rand -hex 32), BASE_URL
set -a && . ./.env.local && set +a && node src/server.js
```

Expected: a `server.started` JSON line plus the `server.subscription-unset` warning.

Run: `curl -s 'http://localhost:3000/healthz'` → `{"ok":true}`
Run: `curl -s 'http://localhost:3000/webhook?hub.verify_token=<your-token>&hub.challenge=xyz'` → `{"hub.challenge":"xyz"}`

Stop with Ctrl-C and confirm a `server.stopping` line.

- [ ] **Step 7: Implement the invite script**

Create `scripts/mint-invite.js`:

```js
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/adapters/store/connection.js';
import { createInviteStore } from '../src/adapters/store/invites.js';
import { INVITE_TTL_SECONDS } from '../src/web/routes/connect.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);

const token = crypto.randomBytes(32).toString('hex');
const now = Math.floor(Date.now() / 1000);
createInviteStore(db).create({ token, now, expiresAt: now + INVITE_TTL_SECONDS });
db.close();

const expires = new Date((now + INVITE_TTL_SECONDS) * 1000).toISOString().slice(0, 10);
console.log(`${config.baseUrl}/connect?invite=${token}`);
console.log(`Single use. Expires ${expires}.`);
```

- [ ] **Step 8: Verify invite minting end to end**

Run: `set -a && . ./.env.local && set +a && npm run mint-invite`
Expected: a `https://.../connect?invite=<64 hex chars>` URL and an expiry date.

Start the server and open the printed URL (over your public HTTPS host, or with `BASE_URL=http://localhost:3000` for a local check). Confirm the connect page renders with an **empty** message box and the default quoted below it.

- [ ] **Step 9: Implement the subscription script**

Create `scripts/create-subscription.js`:

```js
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const BASE = 'https://www.strava.com/api/v3/push_subscriptions';
const credentials = { client_id: config.clientId, client_secret: config.clientSecret };

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${BASE}${path} -> ${response.status}: ${text}`);
  return text === '' ? {} : JSON.parse(text);
}

// Strava permits only ONE push subscription per application, so an existing one
// must be deleted before a new one can be created.
const existing = await call('GET', `?${new URLSearchParams(credentials)}`);
for (const subscription of existing) {
  console.log(`Deleting existing subscription ${subscription.id} (${subscription.callback_url})`);
  await call('DELETE', `/${subscription.id}?${new URLSearchParams(credentials)}`);
}

const created = await call('POST', '', {
  ...credentials,
  callback_url: `${config.baseUrl}/webhook`,
  verify_token: config.webhookVerifyToken,
});

console.log(`Created subscription ${created.id} for ${config.baseUrl}/webhook`);
console.log(`Set STRAVA_SUBSCRIPTION_ID=${created.id} and restart the service.`);
```

- [ ] **Step 10: Run everything and commit**

Run: `npm run check`
Expected: typecheck clean, 233 tests pass

```bash
git add src/container.js src/server.js scripts/ test/container.test.js
git commit -m "feat: composition root, server entry point, and operational scripts"
```

---

### Task 15: Docker packaging and deployment runbook

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md`

**Interfaces:**
- Consumes: everything. No new exports.

- [x] **Step 1: Write the Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
# better-sqlite3 compiles a native binding, which needs a toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

# The SQLite file holds live refresh tokens; it lives on a mounted volume owned
# by the unprivileged runtime user.
RUN mkdir -p /data && chown node:node /data
USER node
ENV DB_PATH=/data/data.sqlite
EXPOSE 3000
CMD ["node", "src/server.js"]
```

There is no build stage for the application code: JSDoc types are checked by `tsc --noEmit` in CI, and the container runs `src/` directly.

Create `.dockerignore`:

```
node_modules
.git
.env
.env.local
data.sqlite*
test
docs
.remember
tsconfig.json
```

- [x] **Step 2: Build and smoke-test the image** — DONE 2026-08-25. `docker build` succeeded; `/healthz`, the webhook verify handshake, and `data.sqlite` mode `0600 node` all matched expectations. Node 24.19.0 hit a known upstream regression crashing NAN-style native addons (`RemoveEnvironmentCleanupHook` assertion — [WiseLibs/better-sqlite3#1376](https://github.com/WiseLibs/better-sqlite3/issues/1376)); fixed by upgrading `better-sqlite3` from `^11.5.0` to `^13.0.3` (its N-API rewrite), not by pinning an older Node.

```bash
docker build -t runsync .
docker run --rm -p 3000:3000 \
  -e STRAVA_CLIENT_ID=x -e STRAVA_CLIENT_SECRET=x \
  -e STRAVA_WEBHOOK_VERIFY_TOKEN=verify \
  -e APPEND_MESSAGE='🏃 Synced via runsync' \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e BASE_URL=https://runsync.example.com \
  -v runsync-data:/data \
  runsync
```

Expected: a `server.started` JSON line. Then in another shell:

Run: `curl -s http://localhost:3000/healthz` → `{"ok":true}`
Run: `curl -s 'http://localhost:3000/webhook?hub.verify_token=verify&hub.challenge=xyz'` → `{"hub.challenge":"xyz"}`
Run: `docker run --rm -v runsync-data:/data --entrypoint stat runsync -c '%a %U' /data/data.sqlite` → `600 node`

- [x] **Step 3: Write the README**

Create `README.md`:

````markdown
# runsync

Appends each athlete's chosen message to the description of their new Strava
running activities.

- Design: [`docs/superpowers/specs/2026-08-25-strava-auto-message-design.md`](docs/superpowers/specs/2026-08-25-strava-auto-message-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-08-25-strava-auto-message.md`](docs/superpowers/plans/2026-08-25-strava-auto-message.md)

## Prerequisites

1. **An active Strava subscription on the developer account** ($11.99/mo).
   Standard Tier API access requires it — nothing works without it.
2. A Strava API application (https://www.strava.com/settings/api) with its
   Authorization Callback Domain set to this service's hostname.
3. A public HTTPS hostname routed to the container.

Standard Tier is capped at 10 connected athletes. Invites are what stop
strangers who find the URL from consuming those slots.

## Architecture

Four layers, dependencies pointing inward:

- `src/domain/` — pure decision logic. No I/O, no clock, no database. Every
  rule about *whether* to touch an activity lives here, and its tests use no
  mocks. New rules go here.
- `src/adapters/` — SQLite, the Strava HTTP API, the clock, the log stream,
  job dispatch.
- `src/services/` — orchestration: load state, ask the domain, act.
- `src/web/` — request parsing, authorization, HTML.
- `src/container.js` — the only module that constructs anything.

`test/architecture.test.js` enforces the boundaries; it fails if the domain
ever imports a database or the web layer reaches into an adapter.

## Configuration

Copy `.env.example` and fill it in. `SESSION_SECRET` must be at least 32
characters: `openssl rand -hex 32`.

## Deploy

```bash
docker build -t runsync .
docker run -d --name runsync --restart unless-stopped \
  --env-file .env -p 3000:3000 -v runsync-data:/data runsync
```

Put the existing reverse proxy in front, terminating TLS and forwarding
`/connect`, `/login`, `/oauth/callback`, `/dashboard`, `/disconnect`, and
`/webhook`. `/healthz` is available for the proxy's health check.

## First-run setup

The webhook subscription can only be created once the callback URL is publicly
reachable — Strava validates it during creation.

```bash
docker exec runsync npm run create-subscription
```

Put the printed id in `STRAVA_SUBSCRIPTION_ID` and restart. Until it is set, the
service logs a warning and accepts every incoming event unverified.

Strava permits only **one** subscription per application; the script deletes the
existing one before creating a new one.

## Inviting an athlete

```bash
docker exec runsync npm run mint-invite
```

Send them the printed URL. Single-use, expires after 7 days.

On connect, the service appends the message to their most recent run and records
a cutoff. Nothing older is ever touched.

## Operating

- **Logs:** `docker logs -f runsync` — JSON lines. Filter by event:
  `docker logs runsync | grep activity.skipped`.
- **State:** `docker exec -it runsync sqlite3 /data/data.sqlite`
- **A missed activity:** there is no retry queue by design. The athlete's
  dashboard shows the last error. Check the sport type, the cutoff date, and
  whether their status is `revoked`.
- **Rate limits:** every call counts against the tighter "non-upload" bucket
  (100 / 15 min, 1,000 / day). A burst — a new athlete's Garmin backlog — is the
  realistic risk, not steady state.
- **Backups:** `/data/data.sqlite` holds live refresh tokens. It is mode `0600`
  and must only be backed up encrypted.

## Schema changes

Add a numbered file to `src/adapters/store/migrations/` (e.g.
`002_add_thing.sql`). It is applied in numeric order at boot, once, inside a
transaction, and recorded in `schema_migrations`. Never edit an applied
migration.

## Development

Node 24 LTS — `.nvmrc` pins it.

```bash
nvm use
npm install
npm run check   # tsc --noEmit && node --test
```

Tests use the built-in `node:test` runner and never touch the network:
`undici`'s `MockAgent` intercepts `fetch` with net connect disabled.
````

- [x] **Step 4: Run the full suite one last time** — DONE 2026-08-25, under Node 24.19.0 with `better-sqlite3@13.0.3`. `npm run check`: typecheck clean, 157 tests, 0 failures. (157, not 233 — the self-review's cumulative count table was a plan-time estimate; every task's actual test list was implemented and passes, and per the plan's own note, the count itself is not the thing that matters.)

- [x] **Step 5: Commit** — already done in `c68380c feat: container scripts and Docker packaging`.

- [ ] **Step 6: Manual end-to-end verification** — NOT DONE. Requires a real Strava API application, a publicly reachable deployment, and a test Strava account; none are available in this environment.

The acceptance gate from the spec. Needs the real Strava application, a deployed
instance, and a test Strava account.

1. Mint an invite; open it. Confirm the message box is **empty** and the default
   is quoted below it.
2. Type a custom message and connect. Confirm the redirect lands on `/dashboard`
   and the consent screen asked for read + write, **not** "all your activities".
3. Confirm the message appears on the **most recent run only** — not on any
   older activity.
4. Re-open the invite URL. Confirm it now says "no longer valid".
5. Upload a run. Confirm the message appears exactly once.
6. Edit that run's title in Strava. Confirm the message is **not** duplicated.
7. Edit an old run (before the cutoff). Confirm it is **not** touched.
8. Upload a ride. Confirm it is **not** touched.
9. Change the message on the dashboard. Confirm past activities are unchanged
   and the next uploaded run uses the new text.
10. Clear the message field and save. Confirm the field renders empty again and
    the next run gets the default.
11. Click Disconnect. Confirm the dashboard shows Disconnected, and that the app
    no longer appears in the test account's Strava settings.
12. Reconnect via `/login`. Confirm no invite was needed, no second seed
    happened, and the cutoff advanced rather than moved back.

---

### Task 16: Strava API-policy compliance and data lifecycle

**Goal:** Close the required consent, deletion, retention, support, and
presentation gaps before any production deployment. Do not deploy until this
task is complete and its manual checks pass.

**Why this is required:** Strava's API Policy requires disclosed consent before
data access, a lawful privacy policy, an end-user deletion mechanism with
confirmation, deletion after revocation or a deletion request, and retention
only as long as necessary. The current `revoked` status is useful for a
reconnect UX, but it must not retain an athlete's Strava data or credentials.

**Files:**

- Create: `src/web/views/legal.js`, `src/web/routes/legal.js`,
  `src/services/dataDeletionService.js`,
  `src/adapters/store/migrations/002_data_retention.sql`
- Modify: `src/ports/index.js`, athlete/activity stores, `src/container.js`,
  `src/web/app.js`, `src/web/views/connect.js`, `src/web/views/dashboard.js`,
  `README.md`, `.env.example`
- Test: `test/services/dataDeletionService.test.js`,
  `test/web/legal.test.js`, and focused store/web regression coverage.

- [ ] **Step 1: Add the privacy, consent, and support surface**

Create a public `/privacy` page and a public `/support` page. Link both from
the connect page and dashboard. The privacy page must state, in plain language:

  - collected data: athlete id/name, OAuth tokens, selected message, activity
    id/date and the last processing result;
  - collection method: Strava OAuth plus Strava webhooks/API;
  - purpose: append the athlete's chosen message to eligible activities;
  - storage location and security measures;
  - how to withdraw consent (disconnect) and request deletion;
  - the support contact and the expected deletion-confirmation method.

`SUPPORT_EMAIL` is required production configuration. Add it to `Config`,
`loadConfig`, `.env.example`, and the pages. Do not collect a separate email
address from athletes for this service.

- [ ] **Step 2: Make consent explicit before OAuth**

The connect page must plainly disclose the policy above before the athlete
presses the OAuth button, include a link to `/privacy`, and use an unchecked
required confirmation checkbox. `POST /connect` must reject a missing
confirmation without creating an OAuth state row. Preserve the athlete's
message and invite token when re-rendering the error.

Add tests covering the disclosure, link, required checkbox, and no-state-row
guarantee.

- [ ] **Step 3: Implement permanent deletion**

Create `deleteAthleteData(athleteId)`. In one SQLite transaction it must delete
the athlete row and all associated `processed_activities` rows, OAuth state
rows that belong to that athlete if such linkage exists, and any future
athlete-owned records. It must be idempotent.

Add a session-authenticated `POST /delete-account` protected by the existing
CSRF middleware. It must attempt Strava deauthorization, permanently delete
local data even if that upstream call fails, clear the session cookie, and show
a completion page with the support address for written confirmation. Never
retain a revoked athlete merely to make `/login` convenient; a deleted athlete
must use a new invite.

The deauthorization webhook and a detected authorization failure must enqueue
or safely invoke the same deletion service. Document the 30-day maximum as an
operational SLA, with immediate deletion as the normal behavior. Add tests for
user request, webhook revocation, upstream deauthorization failure, idempotent
repetition, cookie clearing, and no subsequent dashboard access.

- [ ] **Step 4: Bound Strava-data retention**

Add `expires_at` to `processed_activities` in migration 002 and set it to no
more than seven days after `appended_at`. Add a store `purgeExpired(now)` and
run it at startup plus opportunistically on webhook processing. Do not retain
activity IDs, dates, descriptions, or processing history beyond that window.

Replace the dashboard's long-lived processing history with current operational
status that does not retain expired activity data. Keep only data strictly
necessary for the active connection and its current configuration. Review every
column in `athletes` and remove or time-limit any field that is not necessary.

Add tests proving an expired processed row is removed, a deleted/expired
activity is not rendered, and re-deliveries inside the seven-day window remain
idempotent.

- [ ] **Step 5: Make Strava links and naming compliant**

Replace bare linked activity IDs with a legible `View on Strava` link. Do not
use `Strava` in the application name, icon, or branding, and do not imply
endorsement. If an official Connect with Strava button asset is used, use the
current unmodified official asset and its prescribed dimensions; otherwise use
neutral text such as `Continue to Strava`.

Add view tests for the link text and for absence of misleading branding.

- [ ] **Step 6: Update operations and release gate**

Update README with the data-retention window, deletion SLA, privacy/support
URLs, breach-notification owner/process, and encrypted-backup deletion process.
Document how backups containing deleted data are expired or restored only for
the minimum necessary recovery period. Add a deployment checklist requiring:

  - active tier eligibility and athlete-capacity compliance;
  - configured `SUPPORT_EMAIL` and public privacy/support pages;
  - a tested deletion request and written confirmation path;
  - an audit of retention purge logs;
  - no use of Strava Data for AI, analytics, advertising, aggregation, or
    third-party disclosure.

- [ ] **Step 7: Verify and commit**

Run `npm run check`, then manually validate public `/privacy` and `/support`,
consent rejection, account deletion, webhook deauthorization, seven-day purge,
and compliant activity links. Commit with:

```bash
git add src test README.md .env.example
git commit -m "feat: add Strava data lifecycle and policy compliance"
```

Update the deployment gate: production is blocked until Task 16 passes.

---

## Self-Review

**1. Spec coverage.** Every spec section maps to a task:

| Spec section | Tasks |
|---|---|
| Architecture, Authentication model | 11, 12, 13 |
| Invites | 3, 12, 14 |
| CSRF on the OAuth round trip | 3, 11, 12 |
| Connect flow, Components | 12, 13 |
| Dashboard | 13 |
| Data model | 2, 3 |
| Data flow | 6, 9 |
| Message content (validation, quoted default, never prefilled) | 5, 12, 13 |
| Idempotency | 3, 6, 9 |
| Activity cutoff and seeding | 6, 10 |
| Concurrency (per-athlete, per-activity) | 4, 7, 8 |
| Webhook authenticity | 11 |
| Event filtering (sport, deauth, delete) | 6, 9, 11 |
| Error handling (detached catch, 401, 429) | 7, 8, 9, 10 |
| Security notes | 1, 2, 11 |
| API-policy consent, deletion, retention, support, branding | 16 |
| Configuration | 1 |
| Deployment, API access requirements | 14, 15 |
| Testing | every task; manual script in 15 Step 6 |

**2. Placeholder scan.** No TBDs, no "add error handling", no "similar to Task N". Every code step carries the actual code; every test step carries the actual assertions.

**3. Type consistency.** Verified against `src/ports/index.js`:

- Athlete row fields are snake_case throughout (`athlete_id`, `activity_cutoff`, `access_token`), since they come straight from SQLite. Inputs to store methods are camelCase (`athleteId`, `activityCutoff`) — a deliberate, consistent split between "row out" and "arguments in".
- Store factories: `createAthleteStore` / `createActivityStore` / `createInviteStore` / `createAuthStateStore`, each returning exactly the port typedef.
- `StravaClient`: `exchangeCode`, `refresh`, `getActivity`, `updateActivity`, `listRecentActivities`, `deauthorize` — declared in Task 1, implemented in Task 7, consumed under those names in Tasks 9, 10, 13.
- `TokenProvider`: `accessTokenFor` only.
- `Dispatcher`: `dispatch` / `drain` only, used identically in Tasks 8, 11, 14.
- Domain: `decidePreFetch` / `decidePostFetch` / `startedAt` / `computeCutoff` / `chooseSeedActivity` / `validateMessage` / `resolveMessage` / `hasMessage` / `appendMessage`.
- `validateMessage` returns `{ ok, value }` / `{ ok, error }` in Tasks 5, 10, 12; `athleteService.updateMessage` returns the same shape in Tasks 10, 13.
- `sessions`: `COOKIE_NAME`, `MAX_AGE_SECONDS`, `sign`, `verify`, `cookieOptions`, `csrfToken`, `verifyCsrf`.

**4. Test-count arithmetic.** Cumulative expectations: 22 (T1), 27 (T2), 51 (T3), 64 (T4), 76 (T5), 99 (T6), 118 (T7), 132 (T8), 146 (T9), 165 (T10), 195 (T11), 209 (T12), 226 (T13), 232 (T14). If a task's count is off by one or two, the tests matter and the number does not — do not add filler tests to hit it.

**Two judgment calls worth knowing:**

- **`requireAdmin` ships with no routes behind it** (Task 11). It is dead code today, justified by the answer to "which future expansions should the structure make room for". If you would rather not carry unused middleware, delete it and its two tests — the store `list`/`count` queries are the part that is genuinely hard to retrofit.
- **Message templating was deliberately not built.** The spec names it as the next change, but it was excluded from the structural brief. Because all message logic lives in `src/domain/message.js`, adding a `render(template, context)` step remains a single-file change.
