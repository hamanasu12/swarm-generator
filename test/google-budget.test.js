import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingMonth, reserveGoogleRequest } from '../lib/google-budget.js';

const env = { UPSTASH_REDIS_REST_URL: 'https://budget.example', UPSTASH_REDIS_REST_TOKEN: 'secret' };

test('billing month follows Pacific midnight including daylight saving', () => {
  for (const [date, month] of [
    ['2026-11-01T06:59:59Z', '2026-10'], ['2026-11-01T07:00:00Z', '2026-11'],
    ['2027-01-01T07:59:59Z', '2026-12'], ['2027-01-01T08:00:00Z', '2027-01']
  ]) assert.equal(billingMonth(new Date(date)), month);
});

test('last reservation succeeds; exhausted quota blocks', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    assert.equal(url, env.UPSTASH_REDIS_REST_URL);
    assert.equal(init.headers.Authorization, 'Bearer secret');
    assert.equal(init.redirect, 'error');
    const command = JSON.parse(init.body);
    assert.equal(command[0], 'EVAL');
    assert.equal(command.at(-1), '9000');
    return Response.json({ result: [calls === 1 ? 1 : 0, 9000] });
  };
  assert.equal((await reserveGoogleRequest({ env, fetchImpl })).remaining, 0);
  await assert.rejects(reserveGoogleRequest({ env, fetchImpl }), e => e.code === 'google_monthly_limit' && e.quota.remaining === 0);
});

test('missing storage, corruption and uncertain responses fail closed without retry', async () => {
  await assert.rejects(reserveGoogleRequest({ env: {}, fetchImpl: () => assert.fail('no request') }), { code: 'google_budget_unavailable' });
  for (const response of [
    () => Response.json({ result: [-1, 0] }),
    () => Response.json({ result: [1, 9001] }),
    () => Response.json({ result: [0, 1] }),
    () => Response.json({ result: [1, '2'] }),
    () => Response.json({ error: 'secret' }),
    () => new Response('', { status: 503 }),
    () => { throw Error('secret'); }
  ]) {
    let calls = 0;
    await assert.rejects(reserveGoogleRequest({ env, fetchImpl: async () => { calls++; return response(); } }),
      e => e.code === 'google_budget_unavailable' && !e.message.includes('secret'));
    assert.equal(calls, 1);
  }
});

test('API blocks Google on quota/storage failures; Nominatim remains usable', async t => {
  const keys = ['GOOGLE_MAPS_API_KEY', ...Object.keys(env)];
  const saved = { ...process.env };
  Object.assign(process.env, env, { GOOGLE_MAPS_API_KEY: 'test' });
  t.after(() => { for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  } });
  const { default: handler } = await import('../api/index.js?budget-test');
  let result = [0, 9000], storageCalls = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    const host = new URL(input).hostname;
    if (host === 'app.foursquare.com') return new Response(`<script>window.PREFETCHED_SHARED_CONTENT = {"venue":{"name":"Cafe"}};</script>`);
    if (host === 'budget.example') { storageCalls++; return Response.json({ result }); }
    if (host === 'nominatim.openstreetmap.org') return Response.json([]);
    assert.fail('Google must not be called');
  });
  async function request(provider) {
    const res = { setHeader(k,v) { this[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ query: { url: 'https://app.foursquare.com/share/checkin/test', provider } }, res);
    assert.equal(res['Cache-Control'], 'no-store');
    return res;
  }
  assert.equal((await request('google')).code, 429);
  result = [-1, 0];
  assert.equal((await request('google')).code, 503);
  assert.equal((await request('nominatim')).code, 200);
  assert.equal(storageCalls, 2);
});
