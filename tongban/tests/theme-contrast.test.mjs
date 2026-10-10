import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const css = await readFile(new URL('../src/theme-skins.css', import.meta.url), 'utf8');
const properties = body => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)].map(([, key, value]) => [key, value.trim()]));
const defaults = Object.assign({}, ...[...css.matchAll(/:root\s*\{([^}]+)\}/g)].map(([, body]) => properties(body)));
const light = properties(css.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)[1]);
const palettes = Object.fromEntries(['light', 'dark', 'eyecare'].map(id => [id, {...defaults, ...light, ...properties(css.match(new RegExp(':root\\[data-theme="' + id + '"\\]\\s*\\{([^}]+)\\}'))[1])}]));
function resolve(palette, name, seen = new Set()) {
  assert(!seen.has(name), 'theme token cycle: ' + name);
  seen.add(name);
  const value = palette[name];
  assert(value, 'missing theme token: ' + name);
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/);
  return reference ? resolve(palette, reference[1], seen) : value;
}
function luminance(hex) {
  assert.match(hex, /^#[a-f\d]{6}$/i, 'contrast tokens must be opaque sRGB colors');
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}
function expectPair(id, foreground, background) {
  const palette = palettes[id];
  const result = contrast(resolve(palette, foreground), resolve(palette, background));
  assert(result >= 4.5, id + ': ' + foreground + ' on ' + background + ' = ' + result.toFixed(3) + ':1, expected at least 4.5:1');
}
for (const id of Object.keys(palettes)) {
  test(id + ': body, secondary and placeholder text meet 4.5:1 on every standard surface', () => {
    for (const foreground of ['--ink', '--muted', '--faint']) for (const background of ['--paper', '--paper-2', '--bg', '--lime']) expectPair(id, foreground, background);
  });
  test(id + ': primary, tinted and semantic controls remain readable', () => {
    for (const pair of [['--on-primary','--green'], ['--on-primary','--green-hover'], ['--deep','--lime'], ['--danger','--danger-bg'], ['--success','--success-bg'], ['--warning','--warning-bg'], ['--on-coral','--coral'], ['--packet-on','--packet-surface'], ['--packet-footer-ink','--packet-footer']]) expectPair(id, ...pair);
    for (const surface of ['--paper', '--paper-2', '--bg']) expectPair(id, '--green', surface);
  });
}
test('packet red and coral semantics are fixed across all three skins', () => {
  for (const name of ['--coral', '--on-coral', '--packet-red', '--packet-deep', '--packet-gold', '--packet-surface', '--packet-on', '--packet-footer', '--packet-footer-ink']) {
    assert.equal(new Set(Object.values(palettes).map(palette => resolve(palette, name))).size, 1, name + ' must not change with the skin');
  }
  assert.equal(resolve(palettes.light, '--green'), '#2563eb', 'retain the approved international blue');
});
test('theme stylesheet parses for the oldest supported WebKit target', async () => {
  const output = await transform(css, {loader:'css', target:'safari15.4', logLevel:'silent'});
  assert.equal(output.warnings.length, 0);
});
