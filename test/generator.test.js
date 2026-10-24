import { test } from "node:test";
import assert from "node:assert/strict";
import handler, { extractVenueFromHtml } from "../api/index.js";
import { validateSwarmUrl, extractSwarmUrl } from "../public/swarm-url.js";

const oldUrl = "https://swarmapp.com/user/123/checkin/abc123?s=Token_-&ref=share";
const newUrl = "https://app.foursquare.com/share/checkin/abc123?s=Token_-&lang=ja";
const newHtml = `<meta property="og:title" content="Someone's check in at Wrong name">
<script>window.PREFETCHED_SHARED_CONTENT = ${JSON.stringify({
  user: { name: "Someone" }, venue: { name: '駅前カフェ & "茶"' }
})};</script>`;

test("new and old URLs, shared text, parameters and punctuation", () => {
  for (const url of [oldUrl, newUrl, oldUrl.replace('swarmapp.com', 'ja.swarmapp.com'), oldUrl.replace('swarmapp.com', 'www.foursquare.com')]) {
    assert.equal(validateSwarmUrl(url).href, url);
    assert.equal(extractSwarmUrl(`私はここ、駅前カフェにいました（${url}）。`), url);
  }
  assert.equal(extractSwarmUrl(`https://example.com/ ${newUrl}#fragment`), newUrl);
  assert.equal(extractSwarmUrl(`[${newUrl}](${newUrl})`), newUrl);
});

test("reject spoofed hosts, unrelated paths and URL prefix matches", () => {
  for (const url of [
    'http://app.foursquare.com/share/checkin/abc',
    'https://app.foursquare.com.evil.test/share/checkin/abc',
    'https://app.foursquare.com@evil.test/share/checkin/abc',
    'https://evil.test@app.foursquare.com/share/checkin/abc',
    'https://app.foursquare.com:444/share/checkin/abc',
    'https://app.foursquare.com/share/venue/abc',
    'https://app.foursquare.com/share/checkin/abc/extra',
    'https://swarmapp.com/user/1/checkin/abc/extra',
    'https://127.0.0.1/share/checkin/abc'
  ]) {
    assert.throws(() => validateSwarmUrl(url));
    assert.equal(extractSwarmUrl(url), null);
  }
});

test("venue uses new embedded JSON, preserves punctuation, and supports old metadata", () => {
  assert.equal(extractVenueFromHtml(newHtml, newUrl), '駅前カフェ & "茶"');
  assert.equal(extractVenueFromHtml('<meta property="og:title" content="旧施設 &amp; 店">', oldUrl), '旧施設 & 店');
  assert.equal(extractVenueFromHtml('<meta name="twitter:title" content="旧施設">', oldUrl), '旧施設');
  assert.equal(extractVenueFromHtml(`<meta property="og:title" content="Sam's check in at Joe's Cafe">`, newUrl), "Joe's Cafe");
  assert.equal(extractVenueFromHtml('<meta property="og:title" content="Swarm">', newUrl), null);
  assert.equal(extractVenueFromHtml('<script>window.PREFETCHED_SHARED_CONTENT = {broken};</script>', newUrl), null);
});

async function request(query) {
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ query }, res);
  return res;
}

test("new and old API requests preserve hints, candidates, addresses and original share URL", async t => {
  for (const url of [oldUrl, newUrl]) {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (input) => {
      const target = String(input); calls.push(target);
      if (target === url) return new Response(newHtml);
      assert.equal(new URL(target).hostname, 'nominatim.openstreetmap.org');
      return Response.json([
        { place_id: 1, lat: '35', lon: '139', address: { city: '新宿区', state: '東京都', country: '日本' }, display_name: '住所1' },
        { place_id: 2, lat: '36', lon: '140', address: { town: '別の町', province: '別の県' }, display_name: '住所2' }
      ]);
    });
    const res = await request({ url, hint: 'カフェ' });
    assert.equal(res.code, 200);
    assert.equal(res.body.venue, '駅前カフェ & "茶"');
    assert.equal(res.body.candidates.length, 2); // deduplicated across venue + hint
    assert.equal(res.body.candidates[0].shareText, `I'm at カフェ in 新宿区, 東京都\n${url}`);
    assert.equal(res.body.candidates[1].city, '別の町');
    assert.equal(calls.length, 3);
    t.mock.restoreAll();
  }
});

test("validated redirects support old to new without changing shared URL", async t => {
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = String(input);
    if (url === oldUrl) {
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: newUrl } });
    }
    if (url === newUrl) return new Response(newHtml);
    return Response.json([{ place_id: 1, address: { state: '東京都' } }]);
  });
  const res = await request({ url: oldUrl });
  assert.equal(res.code, 200);
  assert.ok(res.body.candidates[0].shareText.endsWith(oldUrl));
});

test("unsafe redirects, loops, HTTP failures and oversized pages fail without geocoding", async t => {
  t.mock.method(console, 'error', () => {});
  for (const response of [
    () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }),
    () => new Response(null, { status: 302, headers: { location: '/share/checkin/abc123?s=Token_-&lang=ja' } }),
    () => new Response(null, { status: 404 }),
    () => new Response('x', { headers: { 'content-length': String(1024 * 1024 + 1) } }),
    () => new Response('x'.repeat(1024 * 1024 + 1))
  ]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async input => {
      assert.equal(String(input), newUrl);
      calls++;
      return response();
    });
    assert.equal((await request({ url: newUrl })).code, 502);
    assert.ok(calls <= 4);
    mock.mock.restore();
  }
});

test("invalid URL and missing venue never reach geocoding", async t => {
  t.mock.method(console, 'error', () => {});
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('<html></html>'));
  assert.equal((await request({ url: 'https://example.com/' })).code, 400);
  assert.equal(mock.mock.callCount(), 0);
  assert.equal((await request({ url: newUrl })).body.error, 'venue not found');
  assert.equal(mock.mock.callCount(), 1);
});

test("Japanese ISO prefecture fallback and city-only addresses retain location", async t => {
  t.mock.method(globalThis, 'fetch', async input => String(input) === newUrl
    ? new Response(newHtml)
    : Response.json([
      { place_id: 1, address: { city: '八王子市', 'ISO3166-2-lvl4': 'JP-13' } },
      { place_id: 2, address: { city: 'London' } }
    ]));
  const res = await request({ url: newUrl });
  assert.equal(res.body.candidates[0].state, '東京都');
  assert.ok(res.body.candidates[0].shareText.includes('in 八王子市, 東京都'));
  assert.ok(res.body.candidates[1].shareText.includes('in London'));
});

test("Google geocoding preserves venue, hint, address, and URL for new links", async t => {
  const original = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  t.after(() => {
    if (original === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = original;
  });
  const { default: googleHandler } = await import('../api/index.js?google-test');
  t.mock.method(globalThis, 'fetch', async input => {
    if (String(input) === newUrl) return new Response(newHtml);
    const target = new URL(input);
    assert.equal(target.hostname, 'maps.googleapis.com');
    assert.equal(target.searchParams.get('address'), '駅前カフェ');
    return Response.json({ status: 'OK', results: [{
      address_components: [
        { types: ['locality'], long_name: '八王子市' },
        { types: ['administrative_area_level_1'], long_name: '東京都' }
      ], geometry: { location: { lat: 35, lng: 139 } }, formatted_address: '東京都八王子市'
    }] });
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await googleHandler({ query: { url: newUrl, provider: 'google', hint: '駅前カフェ' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.candidates[0].shareText, `I'm at 駅前カフェ in 八王子市, 東京都\n${newUrl}`);
});
