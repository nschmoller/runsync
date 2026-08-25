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
