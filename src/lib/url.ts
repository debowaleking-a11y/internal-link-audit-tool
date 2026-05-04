export function normalizeUrl(rawUrl: string, baseUrl?: string) {
  const url = new URL(rawUrl, baseUrl);
  url.hash = "";

  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }

  url.hostname = url.hostname.toLowerCase();

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

export function isHttpUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isSameDomain(candidateUrl: string, websiteUrl: string) {
  const candidate = new URL(candidateUrl);
  const website = new URL(websiteUrl);
  return candidate.hostname === website.hostname;
}
