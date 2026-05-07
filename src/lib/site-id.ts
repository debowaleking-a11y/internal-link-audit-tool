export function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function trackerIdForWebsite(value: string) {
  const hostname = hostnameFromUrl(value) || "your-website";
  let hash = 0;

  for (let index = 0; index < hostname.length; index += 1) {
    hash = (hash * 31 + hostname.charCodeAt(index)) >>> 0;
  }

  const label = hostname
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase() || "SITE";

  return `ILA-${label}-${hash.toString(36).toUpperCase().slice(0, 5)}`;
}
