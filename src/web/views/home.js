import { html, raw } from '../html.js';
import { page } from './layout.js';

export function renderHomePage() {
  return page('runsync — Your run, your words', html`<div class="site-shell">
    <header class="site-header"><a class="brand" href="/"><img class="brand-mark" src="/app-icon.png" alt="">runsync</a><nav><a href="#how-it-works">How it works</a><a class="nav-login" href="/login">Log in</a></nav></header>
    <main class="home">
      <section class="hero">
        <div><p class="eyebrow">For runners with a goal</p><h1>Run for it.<br>Share <em>why.</em></h1><p class="hero-copy">runsync adds your own message to new runs on Strava. Share the goal you are working towards with every activity.</p><div class="hero-actions"><a class="button" href="#how-it-works">How it works</a><a href="/login">Already connected? Log in →</a></div></div>
        <div class="activity-card" aria-label="Example running activity"><div class="activity-banner">New run · shared to Strava</div><div class="activity-body"><div class="activity-top"><span>Morning Run</span><span>Today</span></div><h2>Along the Amstel</h2><p>Amsterdam, Netherlands</p><div class="activity-stats"><span>Distance<strong>8.4 km</strong></span><span>Pace<strong>5:16 /km</strong></span><span>Time<strong>44:18</strong></span></div><div class="route"><svg viewBox="0 0 380 136" fill="none" aria-hidden="true"><path d="M-16 100C45 70 45 131 104 104C169 74 159 20 222 47C280 72 266 126 324 93C349 79 363 43 405 54" stroke="#c4d7bf" stroke-width="26" stroke-linecap="round"/><path d="M-12 101C44 76 43 123 104 99C169 73 158 26 221 50C277 70 270 119 323 90C352 75 363 49 398 57" stroke="#f35b3c" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 8"/><circle cx="-1" cy="97" r="7" fill="#1b2430"/><circle cx="398" cy="57" r="7" fill="#f35b3c"/></svg></div><div class="activity-message"><strong>My running goal</strong>Training for the Amsterdam Half Marathon. 11 weeks to go.</div></div></div>
      </section>
      <section class="how" id="how-it-works"><div class="section-heading"><p class="eyebrow">One small setup</p><h2>Let each run show what you are working towards.</h2><p>Your goal is added to the description of new running activities. It can be a race, a cause, or simply a reason to keep going.</p></div><div class="steps"><article class="step"><span class="step-number">01</span><h3>Get an invite</h3><p>runsync is private. Use your invite to securely connect your Strava account.</p></article><article class="step"><span class="step-number">02</span><h3>Write your goal</h3><p>Choose the message you want to share, such as a race goal or fundraiser. You can update it later.</p></article><article class="step"><span class="step-number">03</span><h3>Go for your run</h3><p>runsync adds the message to your new Strava runs automatically.</p></article></div></section>
    </main>
    <footer class="home-footer"><span>Small tool. Your data stays yours.</span><div><a href="/privacy">Privacy</a><a href="/support">Support</a></div></footer>
  </div>`);
}
