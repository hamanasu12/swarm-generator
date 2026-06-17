import * as cheerio from "cheerio";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

function makeShareText(venue, city, state, hint = "", url = "") {
  const placeName = hint || venue;

  let text;

  if (placeName && city && state) {
    text = `I'm at ${placeName} in ${city}, ${state}`;
  } else if (placeName && state) {
    text = `I'm at ${placeName} in ${state}`;
  } else {
    text = `I'm at ${placeName}`;
  }

  if (url) {
    text += `\n${url}`;
  }

  return text;
}

function normalizeAddress(addr = {}) {
  const country = addr.country || null;

  const state =
    addr.state ||
    addr.region ||
    addr.province ||
    addr.county ||
    null;

  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.city_district ||
    null;

  return { country, state, city };
}

async function getVenueFromSwarm(url) {
  const swarmRes = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const html = await swarmRes.text();
  const $ = cheerio.load(html);

  return (
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    null
  );
}

function buildSearchQueries(venue, hint = "") {
  const queries = [];

  if (venue) queries.push(venue);

  if (hint && hint !== venue) {
    queries.push(hint);
  }

  return [...new Set(queries)];
}

async function searchNominatim(venue, hint = "", url = "") {
  const searchQueries = buildSearchQueries(venue, hint);

  const allItems = [];
  const seen = new Set();

  for (const query of searchQueries) {
    const searchUrl =
      "https://nominatim.openstreetmap.org/search" +
      `?q=${encodeURIComponent(query)}` +
      "&format=json" +
      "&addressdetails=1" +
      "&limit=5";

    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SwarmLocationBot/1.0; +https://example.com)",
        "Accept": "application/json"
      }
    });

    if (!res.ok) continue;

    const json = await res.json();

    for (const item of json) {
      const key = item.place_id || `${item.lat},${item.lon}`;

      if (seen.has(key)) continue;

      seen.add(key);

      allItems.push({
        ...item,
        search_query: query
      });
    }
  }

  return allItems.map((item, index) => {
    const addr = normalizeAddress(item.address || {});
    const shareText = makeShareText(
      venue,
      addr.city,
      addr.state,
      hint,
      url
    );

    return {
      id: `nominatim-${index}`,
      provider: "nominatim",
      venue,
      display_name_for_user: hint || venue,
      search_query: item.search_query,
      lat: item.lat,
      lon: item.lon,
      country: addr.country,
      state: addr.state,
      city: addr.city,
      formatted_address: item.display_name || null,
      label: item.display_name || `${item.lat}, ${item.lon}`,
      shareText
    };
  });
}

async function searchGoogle(venue, hint = "", url = "") {
  if (!GOOGLE_MAPS_API_KEY) {
    return {
      error: "Google Maps API key is not set",
      candidates: []
    };
  }

  const googleQuery = hint || venue;

  const googleUrl =
    "https://maps.googleapis.com/maps/api/geocode/json" +
    `?address=${encodeURIComponent(googleQuery)}` +
    "&language=ja" +
    "&region=jp" +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(googleUrl);
  const json = await res.json();

  if (json.status !== "OK" || !json.results?.length) {
    return {
      error: "location not found",
      google_status: json.status,
      google_error_message: json.error_message || null,
      candidates: []
    };
  }

  const candidates = json.results.slice(0, 5).map((result, index) => {
    const components = result.address_components || [];

    function getComponent(type) {
      const c = components.find(component => component.types.includes(type));
      return c ? c.long_name : null;
    }

    const country = getComponent("country");
    const state = getComponent("administrative_area_level_1");

    const city =
      getComponent("locality") ||
      getComponent("administrative_area_level_2") ||
      getComponent("administrative_area_level_3") ||
      getComponent("sublocality_level_1");

    const lat = result.geometry.location.lat;
    const lon = result.geometry.location.lng;

    const shareText = makeShareText(
      venue,
      city,
      state,
      hint,
      url
    );

    return {
      id: `google-${index}`,
      provider: "google",
      venue,
      display_name_for_user: hint || venue,
      search_query: googleQuery,
      lat,
      lon,
      country,
      state,
      city,
      formatted_address: result.formatted_address || null,
      label: result.formatted_address || `${lat}, ${lon}`,
      shareText
    };
  });

  return { candidates };
}

export default async function handler(req, res) {
  const { url, provider = "nominatim", hint = "" } = req.query;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  try {
    const venue = await getVenueFromSwarm(url);

    if (!venue) {
      return res.status(400).json({ error: "venue not found" });
    }

    if (provider === "google") {
      const result = await searchGoogle(venue, hint, url);

      return res.status(200).json({
        venue,
        hint: hint || null,
        provider: "google",
        candidates: result.candidates || [],
        error: result.error || null,
        google_status: result.google_status || null,
        google_error_message: result.google_error_message || null
      });
    }

    const candidates = await searchNominatim(venue, hint, url);

    return res.status(200).json({
      venue,
      hint: hint || null,
      provider: "nominatim",
      candidates,
      error: candidates.length ? null : "location not found by nominatim"
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}