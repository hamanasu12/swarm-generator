const LEGACY_HOSTS = new Set([
  "swarmapp.com", "www.swarmapp.com", "ja.swarmapp.com",
  "foursquare.com", "www.foursquare.com", "ja.foursquare.com"
]);

// Keep the browser and server allowlists identical. Never allow arbitrary
// Foursquare paths: every redirect is checked with this same validator.
export function validateSwarmUrl(value) {
  if (typeof value !== "string") throw new Error("invalid Swarm URL");
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error("invalid Swarm URL"); }

  const validPath = parsed.hostname === "app.foursquare.com"
    ? /^\/share\/checkin\/[A-Za-z0-9]+\/?$/.test(parsed.pathname)
    : LEGACY_HOSTS.has(parsed.hostname) &&
      /^\/user\/\d+\/checkin\/[A-Za-z0-9]+\/?$/.test(parsed.pathname);

  if (parsed.protocol !== "https:" || parsed.port || parsed.username ||
      parsed.password || !validPath) {
    throw new Error("only official Swarm check-in URLs are allowed");
  }
  parsed.hash = "";
  return parsed;
}

export function extractSwarmUrl(text) {
  if (typeof text !== "string") return null;
  const urls = text.match(/https?:\/\/[^\s<>"'「」『』、。()（）]+/gi) || [];
  for (const raw of urls) {
    const value = raw.replace(/[)\]）】.,!?！？]+$/, "");
    try { return validateSwarmUrl(value).href; }
    catch { /* Continue past unrelated links in shared text. */ }
  }
  return null;
}
