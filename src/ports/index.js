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
 * @property {string} supportEmail
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
 * @property {(athleteId: number) => void} remove  Permanent erasure — used only by data deletion, never by the revoke/reconnect path.
 */

/**
 * @typedef {object} ActivityStore
 * @property {(activityId: number) => boolean} isProcessed
 * @property {(activityId: number, athleteId: number, now: number) => void} markProcessed
 * @property {(activityId: number) => void} deleteProcessed
 * @property {(athleteId: number, limit: number) => Array<{activity_id:number,appended_at:number}>} recentFor
 * @property {() => number} count
 * @property {(athleteId: number) => void} deleteForAthlete  Bulk erasure for a data deletion request.
 * @property {(now: number) => number} purgeExpired  Deletes rows past their retention window; returns the count removed.
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

/**
 * Permanent erasure — Strava deauthorization plus deletion of every row this
 * service holds for the athlete. Idempotent: a second call on an already-gone
 * athlete is a no-op, not an error.
 * @typedef {object} DataDeletionService
 * @property {(athleteId: number, context?: {reason?: string}) => Promise<void>} deleteAthleteData
 */

export {};
