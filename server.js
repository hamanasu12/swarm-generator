const express = require("express");
const cheerio = require("cheerio");

const app = express();

app.get("/", async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.json({ error: "url is required" });
  }

  try {
    /* ===== ① Swarm URL → venue 名 ===== */
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
      return res.json({ error: "venue not found" });
    }

    /* ===== ② venue → 緯度・経度（Nominatim search） ===== */
    const searchUrl =
      "https://nominatim.openstreetmap.org/search" +
      `?q=${encodeURIComponent(venue)}` +
      "&format=json&limit=1";

    const geoRes = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SwarmLocationBot/1.0; +https://example.com)",
        "Accept": "application/json"
      }
    });

    if (!geoRes.ok) {
      return res.status(500).json({
        venue,
        error: "nominatim search failed",
        status: geoRes.status
      });
    }

    const geoJson = await geoRes.json();
    if (!geoJson.length) {
      return res.json({
        venue,
        error: "location not found"
      });
    }

    const lat = geoJson[0].lat;
    const lon = geoJson[0].lon;

    /* ===== ③ 緯度・経度 → 都道府県・市町村（reverse） ===== */
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

    if (!revRes.ok) {
      return res.status(500).json({
        venue,
        lat,
        lon,
        error: "reverse geocoding failed",
        status: revRes.status
      });
    }

    const revJson = await revRes.json();
    const addr = revJson.address || {};

    /* ===== ④ 日本・海外どちらも強い正規化 ===== */
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
      null;

    /* ===== 結果 ===== */
    res.json({
      venue,
      lat,
      lon,
      country: addr.country || null,
      state,
      city
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
