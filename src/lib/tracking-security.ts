import { trackerIdForWebsite } from "@/lib/site-id";

export function cleanTrackerId(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 40);
}

export function isBotUserAgent(userAgent: string) {
  return /bot|crawler|spider|preview|facebookexternalhit|slurp|bing|google|yandex|duckduck|semrush|ahrefs|mj12|dotbot/i.test(userAgent);
}

export function originMatchesPage(origin: string | null, pageUrl: string) {
  if (!origin) {
    return true;
  }

  try {
    return origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

export function isValidSiteId(site: string, trackerId: unknown) {
  const cleanedTrackerId = cleanTrackerId(trackerId);
  const normalizedSite = site.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const bareSite = normalizedSite.replace(/^www\./, "");
  const candidates = new Set([
    normalizedSite,
    bareSite,
    `www.${bareSite}`,
  ]);

  return [...candidates].some((candidate) => cleanedTrackerId === trackerIdForWebsite(`https://${candidate}`));
}
