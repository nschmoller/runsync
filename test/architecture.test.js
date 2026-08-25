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

/** @param {string} file @returns {Array<string>} */
function importsOf(file) {
  const source = fs.readFileSync(file, 'utf8');
  const matches = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)];
  return matches.map((m) => m[1] ?? '').filter(Boolean);
}

/** Resolve a relative specifier to a path relative to src/.
 * @param {string} file @param {string} specifier @returns {string|null} */
function resolveWithin(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolute = path.resolve(path.dirname(file), specifier);
  return path.relative(SRC, absolute);
}

/** @param {string} layer @param {(target: string) => boolean} isForbidden @returns {string[]} */
function violations(layer, isForbidden) {
  const found = /** @type {string[]} */ ([]);
  const files = jsFiles(path.join(SRC, layer));
  files.forEach((file) => {
    importsOf(file).forEach((specifier) => {
      const target = resolveWithin(file, specifier);
      if (target && isForbidden(target)) {
        found.push(`${path.relative(SRC, file)} imports ${target}`);
      }
    });
  });
  return found;
}

test('domain imports nothing outside domain and ports', () => {
  const found = violations('domain', (/** @type {string} */ t) => !t.startsWith('domain/') && !t.startsWith('ports/'));
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
  assert.deepEqual(found, [], 'domain should not import I/O builtins');
});

test('adapters never import services or web', () => {
  const found = violations('adapters', (/** @type {string} */ t) => t.startsWith('services/') || t.startsWith('web/'));
  assert.deepEqual(found, []);
});

test('services never import web', () => {
  const found = violations('services', (/** @type {string} */ t) => t.startsWith('web/'));
  assert.deepEqual(found, []);
});

test('web never reaches directly into adapters — it receives them from the container', () => {
  const found = violations('web', (/** @type {string} */ t) => t.startsWith('adapters/'));
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
