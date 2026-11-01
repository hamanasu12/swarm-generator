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

test('UI: one Google request while busy; last allowance disables further attempts including after clear', async t => {
  const w = setup(t), el = id => w.document.getElementById(id);
  el('url').value = url;
  w.fetch = async () => ({ ok: true, json: async () => data() });
  await w.run();
  let complete, calls = 0;
  w.fetch = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
  const pending = w.searchWithGoogle();
  await w.searchWithGoogle();
  assert.equal(calls, 1);
  assert.equal(el('googleButton').disabled, true);
  complete({ ok: true, json: async () => ({ ...data('google'), googleQuota: { remaining: 0, limit: 9000 } }) });
  await pending;
  assert.ok(el('status').textContent.includes('google'));
  assert.ok(el('googleQuota').textContent.includes('残り：0回'));
  assert.equal(el('googleButton').disabled, true);
  w.clearForm();
  el('url').value = url;
  w.fetch = async () => ({ ok: true, json: async () => data() });
  await w.run();
  w.fetch = () => assert.fail('quota must remain exhausted');
  await w.searchWithGoogle();
  assert.equal(el('googleButton').disabled, true);
});

test('UI: storage failure and quota exhaustion preserve chosen candidate', async t => {
  const w = setup(t), el = id => w.document.getElementById(id);
  el('url').value = url;
  w.fetch = async () => ({ ok: true, json: async () => data() });
  await w.run();
  el('candidateList').querySelector('button').click();
  const selected = el('shareText').textContent;
  for (const [error, message, disabled] of [
    ['google_budget_not_started', '翌月分の開始待ち', false],
    ['google_budget_unavailable', '課金防止', false],
    ['google_monthly_limit', '上限', true]
  ]) {
    w.fetch = async () => ({ ok: false, json: async () => ({ error }) });
    await w.searchWithGoogle();
    assert.ok(el('status').textContent.includes(message));
    assert.equal(el('shareText').textContent, selected);
    assert.equal(el('selectedAddress').textContent, '住所2');
    assert.equal(el('googleButton').disabled, disabled);
  }
});

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
  assert.equal(el('candidateList').querySelector('button').textContent, '選択中');
  assert.equal(el('selectedAddress').textContent, '住所2');
  assert.equal(w.document.activeElement, el('shareBox'));
  await w.copyShareText();
  assert.equal(copied, el('shareText').textContent);
  w.postToX();
  assert.equal(new URL(opened[0]).searchParams.get('text'), copied);
  assert.equal(opened[2], 'noopener,noreferrer');
  el('googleButton').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(el('googleButton').style.display, 'none');
  assert.ok(el('status').textContent.includes('google'));
  w.clearForm();
  assert.equal(el('url').value, '');
  assert.equal(el('shareText').textContent, '');
  assert.equal(el('candidateBox').style.display, 'none');
});

test('UI: Google billing denial, missing key and zero results preserve selected candidate and allow retry', async t => {
  const w = setup(t), el = id => w.document.getElementById(id);
  el('url').value = url;
  w.fetch = async () => ({ ok: true, json: async () => data() });
  await w.run();
  el('candidateList').querySelector('button').click();
  const selected = el('shareText').textContent;
  for (const [response, message] of [
    [{ error: 'location not found', google_status: 'REQUEST_DENIED', google_error_message: 'You must enable Billing on the Google Cloud Project' }, '課金設定'],
    [{ error: 'Google Maps API key is not set' }, 'APIキー'],
    [{ error: 'location not found', google_status: 'ZERO_RESULTS' }, '見つかりません']
  ]) {
    w.fetch = async () => ({ ok: true, json: async () => ({ provider: 'google', candidates: [], ...response }) });
    el('googleButton').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(el('status').textContent.includes(message));
    assert.equal(el('shareText').textContent, selected);
    assert.equal(el('selectedAddress').textContent, '住所2');
    assert.equal(el('candidateList').querySelector('button').textContent, '選択中');
    assert.equal(el('googleButton').disabled, false);
    assert.equal(el('googleButton').style.display, 'block');
  }
});

test('UI: candidates with identical share text still visibly change the selected address', async t => {
  const w = setup(t), el = id => w.document.getElementById(id);
  el('url').value = url;
  const result = data();
  result.candidates[1].shareText = result.candidates[0].shareText;
  w.fetch = async () => ({ ok: true, json: async () => result });
  await w.run();
  assert.equal(el('selectedAddress').textContent, '住所1');
  el('candidateList').querySelector('button').click();
  assert.equal(el('selectedAddress').textContent, '住所2');
  assert.equal(el('candidateList').querySelector('button').getAttribute('aria-pressed'), 'true');
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
