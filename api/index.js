import * as cheerio from "cheerio";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export default async function handler(req, res) {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  try {
    /* ===== ① Swarm URL → venue名 ===== */
    const swarmRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const html = await swarmRes.text();
    const $ = cheerio.load(html);

    const venue =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content");

    if (!venue) {
      return res.status(400).json({ error: "venue not found" });
    }

    /* ===== ② まずNominatimで検索 ===== */
    const nominatimSearchUrl =
      "https://nominatim.openstreetmap.org/search" +
      `?q=${encodeURIComponent(venue)}` +
      "&format=json&limit=1";

    const nominatimRes = await fetch(nominatimSearchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SwarmLocationBot/1.0; +https://example.com)",
        "Accept": "application/json"
      }
    });

    let provider = null;
    let lat = null;
    let lon = null;
    let country = null;
    let state = null;
    let city = null;
    let formatted_address = null;

    if (nominatimRes.ok) {
      const nominatimJson = await nominatimRes.json();

      if (nominatimJson.length > 0) {
        lat = nominatimJson[0].lat;
        lon = nominatimJson[0].lon;
        provider = "nominatim";

        /* ===== ③ Nominatim reverse ===== */
        const reverseUrl =
          "https://nominatim.openstreetmap.org/reverse" +
          `?lat=${lat}&lon=${lon}&format=json`;

        const revRes = await fetch(reverseUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; SwarmLocationBot/1.0; +https://example.com)",
            "Accept": "application/json"
          }
        });

        if (revRes.ok) {
          const revJson = await revRes.json();
          const addr = revJson.address || {};

          country = addr.country || null;

          state =
            addr.state ||
            addr.region ||
            addr.province ||
            addr.county ||
            null;

          city =
            addr.city ||
            addr.town ||
            addr.village ||
            addr.municipality ||
            null;

          formatted_address = revJson.display_name || null;
        }
      }
    }

    /* ===== ④ Nominatimで見つからなければGoogle Maps Geocoding API ===== */
    if (!lat || !lon) {
      if (!GOOGLE_MAPS_API_KEY) {
        return res.status(200).json({
          venue,
          error: "location not found by nominatim, and Google Maps API key is not set",
          provider: "none"
        });
      }

      const googleQuery = `${venue} 日本`;

      const googleUrl =
        "https://maps.googleapis.com/maps/api/geocode/json" +
        `?address=${encodeURIComponent(googleQuery)}` +
        "&language=ja" +
        "&region=jp" +
        `&key=${GOOGLE_MAPS_API_KEY}`;

      const googleRes = await fetch(googleUrl);
      const googleJson = await googleRes.json();

      if (googleJson.status !== "OK" || !googleJson.results.length) {
        return res.status(200).json({
          venue,
          error: "location not found",
          provider: "google",
          google_status: googleJson.status,
          google_error_message: googleJson.error_message || null
        });
      }

      const result = googleJson.results[0];

      lat = result.geometry.location.lat;
      lon = result.geometry.location.lng;
      formatted_address = result.formatted_address;
      provider = "google";

      const components = result.address_components || [];

      function getComponent(type) {
        const c = components.find(component =>
          component.types.includes(type)
        );
        return c ? c.long_name : null;
      }

      country = getComponent("country");

      state = getComponent("administrative_area_level_1");

      city =
        getComponent("locality") ||
        getComponent("administrative_area_level_2") ||
        getComponent("administrative_area_level_3") ||
        getComponent("sublocality_level_1");
    }

    /* ===== ⑤ I'm at 文生成 ===== */
    let shareText = null;

    if (venue && city && state) {
      shareText = `I'm at ${venue} in ${city}, ${state}`;
    } else if (venue && state) {
      shareText = `I'm at ${venue} in ${state}`;
    } else if (venue) {
      shareText = `I'm at ${venue}`;
    }

    return res.status(200).json({
      venue,
      lat,
      lon,
      country,
      state,
      city,
      formatted_address,
      provider,
      shareText
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}