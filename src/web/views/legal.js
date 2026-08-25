import { html, raw } from '../html.js';
import { page } from './layout.js';
import { RETENTION_SECONDS } from '../../domain/retention.js';

const RETENTION_DAYS = RETENTION_SECONDS / (24 * 3600);

/** @param {{config: {appendMessage: string, supportEmail: string, sportTypes: Set<string>}}} input */
export function renderPrivacyPage({ config }) {
  return page('Privacy — runsync', html`
    <h1>Privacy notice</h1>
    <p>runsync is a small, self-hosted tool that appends your chosen message to
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
    <p>In a single SQLite file on the server operator's own infrastructure,
    readable only by the service process (file mode <code>0600</code>).</p>

    <h2>Withdrawing consent or requesting deletion</h2>
    <p>Disconnect at any time from your <a href="/dashboard">dashboard</a>,
    which permanently deletes your data immediately. If you cannot access the
    dashboard, email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>
    and we will confirm deletion in writing, normally immediately and within
    30 days at the latest.</p>

    <p>See <a href="/support">Support</a> for how to reach us.</p>
  `);
}

/** @param {{config: {supportEmail: string}}} input */
export function renderSupportPage({ config }) {
  return page('Support — runsync', html`
    <h1>Support</h1>
    <p>Questions, problems, or a data deletion request that you cannot
    complete from your <a href="/dashboard">dashboard</a>:
    <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>.</p>
    <p>See our <a href="/privacy">Privacy notice</a> for what we collect and
    why.</p>
  `);
}

/** @param {{config: {supportEmail: string}}} input */
export const legalFooter = ({ config }) => raw(html`<p class="footer"><a href="/privacy">Privacy</a> &middot; <a href="/support">Support</a> &middot; <a href="mailto:${config.supportEmail}">${config.supportEmail}</a></p>`);
