import cheerio from "cheerio";

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  try {
    /* ===== ① Swarmページ取得 ===== */
    const swarmRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const html = await swarmRes.text();
    const $ = cheerio.load(html);

    const venue =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content");

    if (!venue) {
      return res.status(400).json({ error: "venue not found" });
    }

    /* ===== ② 緯度経度検索 ===== */
    const searchUrl =
      "https://nominatim.openstreetmap.org/search" +
      `?q=${encodeURIComponent(venue)}&format=json&limit=1`;

    const geoRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "SwarmLocationTool/1.0",
        "Accept": "application/json"
      }
    });

    const geoJson = await geoRes.json();

    if (!geoJson.length) {
      return res.json({ venue, error: "location not found" });
    }

    const { lat, lon } = geoJson[0];

    /* ===== ③ reverse ===== */
    const reverseUrl =
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;

    const revRes = await fetch(reverseUrl, {
      headers: {
        "User-Agent": "SwarmLocationTool/1.0",
        "Accept": "application/json"
      }
    });

    const revJson = await revRes.json();
    const addr = revJson.address || {};

    const state =
      addr.state || addr.region || addr.province || addr.county || null;

    const city =
      addr.city || addr.town || addr.village || addr.municipality || null;

    return res.status(200).json({
      venue,
      lat,
      lon,
      country: addr.country || null,
      state,
      city
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}