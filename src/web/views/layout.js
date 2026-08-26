import { html, raw } from '../html.js';
import { MAX_MESSAGE_LENGTH } from '../../domain/message.js';
/** @param {string|null} loginUrl @param {boolean} loggedIn */
const siteHeader = (loginUrl, loggedIn) => html`<header class="site-header"><a class="brand" href="/"><img class="brand-mark" src="/app-icon.png" alt="">racegoal</a><nav><a href="/#how-it-works">How it works</a><a href="/privacy">Privacy</a><a href="/support">Support</a>${raw(loggedIn ? html`<a class="nav-login" href="/dashboard">Dashboard</a>` : loginUrl ? html`<a class="nav-login" href="${loginUrl}">Log in</a>` : '')}</nav></header>`;
/** @param {{supportEmail?:string}|null} config @param {string|null} blurb */
const siteFooter = (config, blurb) => html`<footer class="home-footer"><span>${raw(blurb ?? (config?.supportEmail ? html`<a href="mailto:${config.supportEmail}">${config.supportEmail}</a>` : ''))}</span><div><a href="/privacy">Privacy</a><a href="/support">Support</a></div></footer>`;
/**
 * @param {string} title
 * @param {string} body
 * @param {{mainClass?:string,loginUrl?:string|null,loggedIn?:boolean,config?:{supportEmail?:string}|null,footerBlurb?:string|null}} [options]
 */
export const page = (title, body, { mainClass = '', loginUrl = null, loggedIn = false, config = null, footerBlurb = null } = {}) => html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f8f4ed"><title>${title}</title><style>
  :root { color: #1b2430; background: #f8f4ed; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-synthesis: none; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 320px; }
  a { color: inherit; text-underline-offset: .18em; }
  .site-shell { width: min(100% - 40px, 1120px); margin: 0 auto; }
  .site-header { display: flex; align-items: center; justify-content: space-between; padding: 22px 0; }
  .brand { display: inline-flex; gap: 10px; align-items: center; color: #1b2430; font-size: 1.16rem; font-weight: 780; letter-spacing: -.04em; text-decoration: none; }
  .brand-mark { width: 31px; height: 31px; border-radius: 9px; box-shadow: 0 3px 10px rgba(66, 20, 103, .18); }
  .site-header nav { display: flex; gap: 22px; align-items: center; font-size: .9rem; font-weight: 650; }
  .site-header nav a { text-decoration: none; }
  .nav-login { padding: 9px 14px; border: 1px solid #d5cabe; border-radius: 999px; }
  main { padding: 32px 0 72px; }
  main:not(.home) { width: min(100% - 40px, 720px); margin: 0 auto; }
  h1, h2, h3, p { margin-top: 0; }
  main:not(.home) h1 { font-size: clamp(2.2rem, 7vw, 4rem); letter-spacing: -.065em; line-height: .95; }
  main:not(.home) h2 { margin-top: 2.4rem; font-size: 1.25rem; letter-spacing: -.035em; }
  main:not(.home) p, main:not(.home) li { color: #52606d; line-height: 1.65; }
  main:not(.home) form { display: grid; gap: 12px; margin: 28px 0; padding: 24px; border: 1px solid #dfd5ca; border-radius: 18px; background: #fffdf9; }
  label { font-size: .9rem; font-weight: 720; } textarea { width: 100%; resize: vertical; padding: 12px; border: 1px solid #cfc3b6; border-radius: 10px; font: inherit; } button, .button { width: fit-content; padding: 12px 17px; border: 0; border-radius: 999px; background: #f35b3c; color: #fff; cursor: pointer; font: inherit; font-weight: 750; text-decoration: none; } .hint, .footer { font-size: .85rem; } .error { color: #a62f20 !important; font-weight: 650; } .consent-check { display: flex; gap: 9px; align-items: flex-start; font-weight: 500; line-height: 1.45; } .consent-check input { margin-top: .25rem; } .consent { padding: 14px 18px; border-left: 3px solid #f35b3c; background: #fff1e9; } .footer { margin-top: 34px; }
  .home { overflow: hidden; }
  .hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(360px, .95fr); gap: clamp(42px, 8vw, 110px); align-items: center; min-height: 520px; padding: 48px 0 92px; }
  .eyebrow { margin-bottom: 20px; color: #c53b7c; font-size: .76rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .hero h1 { max-width: 700px; margin-bottom: 24px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(3.55rem, 7.8vw, 7rem); font-weight: 500; letter-spacing: -.075em; line-height: .86; }
  .hero h1 em { color: #c53b7c; font-style: italic; }
  .hero-copy { max-width: 510px; color: #52606d; font-size: 1.08rem; line-height: 1.65; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 19px; align-items: center; margin-top: 31px; font-size: .94rem; font-weight: 700; } .hero-actions a:not(.button) { color: #52606d; }
  .activity-card { position: relative; overflow: hidden; border: 1px solid rgba(27,36,48,.1); border-radius: 18px; background: #fffdf9; box-shadow: 18px 22px 0 #ece4d9; transform: rotate(2.5deg); }
  .activity-banner { padding: 14px 23px; background: linear-gradient(110deg, #ff7800, #f8274c 55%, #a70a9d); color: white; font-size: .75rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; } .activity-body { padding: 23px 27px 27px; } .activity-top { display: flex; justify-content: space-between; color: #7a858f; font-size: .78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; } .activity-card h2 { margin: 20px 0 5px; font-size: 1.55rem; letter-spacing: -.05em; } .activity-card p { margin-bottom: 19px; color: #68737d; }
  .activity-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 16px 0; border-top: 1px solid #eee8df; border-bottom: 1px solid #eee8df; } .activity-stats span { color: #78838d; font-size: .68rem; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; } .activity-stats strong { display: block; margin-top: 4px; color: #252d36; font-size: 1rem; letter-spacing: -.03em; }
  .route { height: 116px; margin: 20px 0; border-radius: 10px; background: #eef1e9; overflow: hidden; } .route svg { width: 100%; height: 100%; } .activity-message { padding: 15px; border-left: 3px solid #fa5226; background: #fff5f0; color: #57333a; font-size: .92rem; line-height: 1.45; } .activity-message strong { display: block; margin-bottom: 4px; color: #df3921; font-size: .72rem; letter-spacing: .09em; text-transform: uppercase; }
  .how { padding: 75px 0 92px; border-top: 1px solid #e0d7cc; } .section-heading { max-width: 570px; } .section-heading h2 { margin-bottom: 13px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2.35rem, 5vw, 4.2rem); font-weight: 500; letter-spacing: -.06em; line-height: .95; } .section-heading p { color: #66727d; line-height: 1.6; }
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 44px; } .step { padding-top: 17px; border-top: 2px solid #f35b3c; } .step-number { color: #c53b7c; font-size: .78rem; font-weight: 800; letter-spacing: .1em; } .step h3 { margin: 16px 0 8px; font-size: 1.13rem; letter-spacing: -.03em; } .step p { margin: 0; color: #66727d; line-height: 1.58; }
  .home-footer { display: flex; justify-content: space-between; gap: 20px; padding: 25px 0 42px; border-top: 1px solid #e0d7cc; color: #68737d; font-size: .86rem; } .home-footer div { display: flex; gap: 18px; }
  @media (max-width: 720px) { .site-shell { width: min(100% - 32px, 1120px); } .site-header { padding: 16px 0; } .site-header nav { gap: 14px; font-size: .84rem; } .hero { grid-template-columns: 1fr; min-height: auto; padding: 39px 0 73px; } .hero h1 { font-size: clamp(3.35rem, 17vw, 5.3rem); } .activity-card { width: calc(100% - 16px); margin: 14px 0 0 4px; } .steps { grid-template-columns: 1fr; gap: 30px; } .how { padding: 60px 0; } .home-footer { flex-direction: column; } }
</style></head><body><div class="site-shell">${raw(siteHeader(loginUrl, loggedIn))}<main class="${mainClass}">${raw(body)}</main>${raw(siteFooter(config, footerBlurb))}</div></body></html>`;
/** @param {{config:{appendMessage:string},value?:string|null,error?:string|null}} input */
export function messageField({ config, value = null, error = null }) { return html`${raw(error ? html`<p class="error">${error}</p>` : '')}<label for="message">Your running goal</label><textarea id="message" name="message" rows="3">${value ?? ''}</textarea><p class="hint">racegoal adds <code>- - - 🎯 Goal - - -</code> above your text. Leave blank to use the default goal: <code>${config.appendMessage}</code><br>Up to ${MAX_MESSAGE_LENGTH} characters.</p>`; }
/** @param {string} title @param {string} detail */
export const renderProblem = (title, detail) => page(title, html`<h1>${title}</h1><p>${detail}</p>`);
