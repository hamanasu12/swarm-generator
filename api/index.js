import * as cheerio from "cheerio";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

function makeShareText(venue, city, state) {
  if (venue && city && state) return `I'm at ${venue} in ${city}, ${state}`;
  if (venue && state) return `I'm at ${venue} in ${state}`;
  return `I'm at ${venue}`;
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

async function searchNominatim(venue) {
  const searchUrl =
    "https://nominatim.openstreetmap.org/search" +
    `?q=${encodeURIComponent(venue)}` +
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

  if (!res.ok) return [];

  const json = await res.json();

  return json.map((item, index) => {
    const addr = normalizeAddress(item.address || {});
    const shareText = makeShareText(venue, addr.city, addr.state);

    return {
      id: `nominatim-${index}`,
      provider: "nominatim",
      venue,
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

async function searchGoogle(venue) {
  if (!GOOGLE_MAPS_API_KEY) {
    return {
      error: "Google Maps API key is not set",
      candidates: []
    };
  }

  const googleQuery = `${venue} 日本`;

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
    const shareText = makeShareText(venue, city, state);

    return {
      id: `google-${index}`,
      provider: "google",
      venue,
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
  const { url, provider = "nominatim" } = req.query;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  try {
    const venue = await getVenueFromSwarm(url);

    if (!venue) {
      return res.status(400).json({ error: "venue not found" });
    }

    if (provider === "google") {
      const result = await searchGoogle(venue);

      return res.status(200).json({
        venue,
        provider: "google",
        candidates: result.candidates || [],
        error: result.error || null,
        google_status: result.google_status || null,
        google_error_message: result.google_error_message || null
      });
    }

    const candidates = await searchNominatim(venue);

    return res.status(200).json({
      venue,
      provider: "nominatim",
      candidates,
      error: candidates.length ? null : "location not found by nominatim"
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}