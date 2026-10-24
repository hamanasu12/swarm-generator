import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { extractSwarmUrl } from '../public/swarm-url.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const url = 'https://app.foursquare.com/share/checkin/abc123?s=token&lang=ja';
function setup(t) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://generator.example/' });
  t.after(() => dom.window.close());
  dom.window.extractSwarmUrl = extractSwarmUrl;
  const script = dom.window.document.querySelector('script[type="module"]').textContent
    .replace(/import \{ extractSwarmUrl \} from "\.\/swarm-url.js";/, '');
  dom.window.eval(script);
  return dom.window;
}
function data(provider = 'nominatim') {
  return { provider, candidates: [1, 2].map(i => ({
    provider, venue: '駅', city: '市', state: '県', label: `住所${i}`,
    shareText: `I'm at 駅${i} in 市, 県\n${url}`
  })) };
}

test('UI: paste, generate, choose candidate, copy, X intent, Google fallback and clear', async t => {
  const w = setup(t);
  const el = id => w.document.getElementById(id);
  let copied, opened;
  Object.defineProperty(w.navigator, 'clipboard', { value: {
    readText: async () => `私は、駅にいました ${url}`,
    writeText: async text => { copied = text; }
  } });
  w.open = (...args) => { opened = args; };
  w.fetch = async input => {
    const request = new URL(input, 'https://generator.example/');
    assert.equal(request.searchParams.get('url'), url);
    assert.equal(request.searchParams.get('hint'), '駅');
    return { ok: true, json: async () => data(request.searchParams.get('provider')) };
  };
  await w.pasteFromClipboard();
  assert.ok(el('url').value.includes(url));
  await w.run();
  assert.equal(el('shareText').textContent, data().candidates[0].shareText);
  assert.equal(el('googleButton').style.display, 'block');
  el('candidateList').querySelector('button').click();
  assert.equal(el('shareText').textContent, data().candidates[1].shareText);
  await w.copyShareText();
  assert.equal(copied, el('shareText').textContent);
  w.postToX();
  assert.equal(new URL(opened[0]).searchParams.get('text'), copied);
  assert.equal(opened[2], 'noopener,noreferrer');
  await w.searchWithGoogle();
  assert.equal(el('googleButton').style.display, 'none');
  assert.ok(el('status').textContent.includes('google'));
  w.clearForm();
  assert.equal(el('url').value, '');
  assert.equal(el('shareText').textContent, '');
  assert.equal(el('candidateBox').style.display, 'none');
});

test('UI: empty candidates offer Google; API failures are not presented as no results', async t => {
  const w = setup(t), el = id => w.document.getElementById(id);
  el('url').value = url;
  w.fetch = async () => ({ ok: true, json: async () => ({ provider: 'nominatim', candidates: [] }) });
  await w.run();
  assert.equal(el('googleButton').style.display, 'block');
  assert.equal(el('shareBox').style.display, 'none');
  w.fetch = async () => ({ ok: false, json: async () => ({ error: 'venue not found' }) });
  await w.run();
  assert.ok(el('status').textContent.includes('失敗'));
  assert.ok(el('out').textContent.includes('施設名'));
  assert.equal(el('fetchButton').disabled, false);
  assert.equal(el('googleButton').style.display, 'none');
});
