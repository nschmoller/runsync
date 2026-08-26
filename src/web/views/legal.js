import { html } from '../html.js';
import { page } from './layout.js';
import { RETENTION_SECONDS } from '../../domain/retention.js';

const RETENTION_DAYS = RETENTION_SECONDS / (24 * 3600);

/** @param {{config: {appendMessage: string, supportEmail: string, sportTypes: Set<string>}, loginUrl?:string|null, loggedIn?:boolean}} input */
export function renderPrivacyPage({ config, loginUrl = null, loggedIn = false }) {
  return page('Privacy — racegoal', html`
    <h1>Privacy notice</h1>
    <p>racegoal is a small tool that appends your chosen message to
    the description of your new ${[...config.sportTypes].join(' and ')} activities.</p>

    <h2>What we collect</h2>
    <ul>
      <li>Your Strava athlete id and name</li>
      <li>OAuth access and refresh tokens for your Strava account</li>
      <li>The message you chose (or nothing, if you use the default)</li>
      <li>For each activity we touch: its id, the date, and whether it
        succeeded or failed — kept for up to ${RETENTION_DAYS} days</li>
    </ul>

    <h2>How we collect it</h2>
    <p>Through Strava's OAuth authorization flow when you connect, and through
    Strava's webhook and API when your activities are created or updated.</p>

    <h2>What it's used for</h2>
    <p>Only to append your chosen message to your own eligible activities.
    We do not use your data for analytics, advertising, aggregation, model
    training, or disclosure to any third party.</p>

    <h2>Where it's stored</h2>
    <p>On our own infrastructure. We do not use third-party data processors
    to store your information.</p>

    <h2>Withdrawing consent or requesting deletion</h2>
    <p>Disconnect at any time from your <a href="/dashboard">dashboard</a>,
    which permanently deletes your data immediately. If you cannot access the
    dashboard, email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>
    and we will confirm deletion in writing, normally immediately and within
    30 days at the latest.</p>

    <p>See <a href="/support">Support</a> for how to reach us.</p>
  `, { config, loginUrl, loggedIn });
}

/** @param {{config: {supportEmail: string}, loginUrl?:string|null, loggedIn?:boolean}} input */
export function renderSupportPage({ config, loginUrl = null, loggedIn = false }) {
  return page('Support — racegoal', html`
    <h1>Support</h1>
    <p>Questions, problems, or a data deletion request that you cannot
    complete from your <a href="/dashboard">dashboard</a>:
    <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>.</p>
    <p>See our <a href="/privacy">Privacy notice</a> for what we collect and
    why.</p>
  `, { config, loginUrl, loggedIn });
}
