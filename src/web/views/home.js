import { html, raw } from '../html.js';
import { page } from './layout.js';

/** @param {{name?:string|null,email?:string|null,error?:string|null,success?:boolean}} input */
const inviteRequestForm = ({ name = null, email = null, error = null, success = false }) => success
  ? html`<p class="form-success">Thanks! We'll be in touch soon.</p>`
  : html`<form method="post" action="/request-invite" class="invite-form">
      ${raw(error ? html`<p class="error">${error}</p>` : '')}
      <div class="field-honeypot" aria-hidden="true"><label for="company">Company</label><input type="text" id="company" name="company" tabindex="-1" autocomplete="off"></div>
      <label for="name">Name</label>
      <input type="text" id="name" name="name" value="${name ?? ''}" required>
      <label for="email">Email</label>
      <input type="email" id="email" name="email" value="${email ?? ''}" required>
      <button type="submit" class="button">Request an invite</button>
    </form>`;

/** @param {{loginUrl?:string|null,loggedIn?:boolean,name?:string|null,email?:string|null,error?:string|null,success?:boolean}} [input] */
export function renderHomePage({ loginUrl = '/login', loggedIn = false, name = null, email = null, error = null, success = false } = {}) {
  return page('racegoal — Your run, your words', html`
      <section class="hero">
        <div><p class="eyebrow">For runners with a goal</p><h1>Run for it.<br>Share <em>why.</em></h1><p class="hero-copy">racegoal adds your own message to new runs on Strava. Share the goal you are working towards with every activity.</p><div class="hero-actions">${raw(loggedIn ? html`<a class="button" href="/dashboard">Go to your dashboard →</a>` : html`<a class="button" href="#request-invite">Request an invite</a><a href="#how-it-works">How it works</a><a href="${loginUrl}">Already connected? Log in →</a>`)}</div></div>
        <div class="activity-card" aria-label="Example running activity">
          <div class="activity-header">
            <div class="activity-avatar">N</div>
            <div class="activity-who"><span class="activity-name">Niek</span><span class="activity-meta">Today at 7:12 AM · Garmin Forerunner 970 · Enschede</span></div>
            <svg class="activity-chevron" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="activity-body">
            <div class="activity-type"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="17" cy="5" r="2.2" fill="currentColor"/><path d="M4 20l3.4-3.4 2.6-4.6 3.4 1.6L17 9M9 12l-3.2 1.4M13.4 13.6L16 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <h2>Lonnekerberg</h2>
            <p class="activity-message">Nice trail run through the forest.<br><br><span class="activity-goal-divider">- - - 🎯 Goal - - -</span><br>Training for UTMB. 11 weeks to go.</p>
            <div class="activity-stats"><span>Distance<strong>8.4 km</strong></span><span>Pace<strong>5:16 /km</strong></span><span>Time<strong>44:18</strong></span></div>
            <div class="route"><svg viewBox="0 0 380 136" fill="none" aria-hidden="true"><path d="M-16 100C45 70 45 131 104 104C169 74 159 20 222 47C280 72 266 126 324 93C349 79 363 43 405 54" stroke="#c4d7bf" stroke-width="26" stroke-linecap="round"/><path d="M-12 101C44 76 43 123 104 99C169 73 158 26 221 50C277 70 270 119 323 90C352 75 363 49 398 57" stroke="#f35b3c" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 8"/><circle cx="-1" cy="97" r="7" fill="#1b2430"/><circle cx="398" cy="57" r="7" fill="#f35b3c"/></svg></div>
            <div class="activity-footer">
              <div class="activity-kudos-avatars"><span></span><span></span><span></span></div>
              <span class="kudos-count">12 kudos</span>
              <div class="activity-footer-actions">
                <button type="button" aria-label="Kudos" tabindex="-1"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 11v9H4a1 1 0 01-1-1v-7a1 1 0 011-1h3zm0 0l4.5-8a2 2 0 013.8 1l-1 5H19a2 2 0 012 2.3l-1.4 7A2 2 0 0117.6 20H10a3 3 0 01-3-3v-6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
                <button type="button" aria-label="Comment" tabindex="-1"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 4V5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section class="how" id="how-it-works"><div class="section-heading"><p class="eyebrow">One small setup</p><h2>Let each run show what you are working towards.</h2><p>Your goal is added to the description of new running activities. It can be a race, a cause, or simply a reason to keep going.</p></div><div class="steps"><article class="step"><span class="step-number">01</span><h3>Get an invite</h3><p>racegoal is private. Use your invite to securely connect your Strava account.</p></article><article class="step"><span class="step-number">02</span><h3>Write your goal</h3><p>Choose the message you want to share, such as a race goal or fundraiser. You can update it later.</p></article><article class="step"><span class="step-number">03</span><h3>Go for your run</h3><p>racegoal adds the message to your new Strava runs automatically.</p></article></div></section>
      <section class="invite-request" id="request-invite"><div class="section-heading"><p class="eyebrow">Private beta</p><h2>Request an invite</h2><p>racegoal is invite-only right now. Leave your name and email and we'll be in touch.</p></div>${raw(inviteRequestForm({ name, email, error, success }))}</section>
  `, { mainClass: 'home', loginUrl, loggedIn, footerBlurb: 'Built with care. Your data stays yours.' });
}
