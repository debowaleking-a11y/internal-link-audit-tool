import { getJsonStore } from "./json-store";

export type TrackedLink = {
  targetUrl: string;
  anchorText: string;
  position: number;
  rel: string;
  follow: boolean;
  area: string;
};

export type TrackerPayload = {
  trackerId?: string;
  site: string;
  eventType?: "page_view" | "internal_click" | "external_click" | "scroll";
  pageUrl: string;
  pageTitle: string;
  metaDescription?: string;
  canonicalUrl?: string;
  headings?: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  referrer: string;
  utm?: Record<string, string>;
  deviceType?: "desktop" | "tablet" | "mobile";
  pageLoadTiming?: {
    domContentLoadedMs: number | null;
    loadCompleteMs: number | null;
  };
  scrollDepth?: number;
  links: TrackedLink[];
  clickedUrl?: string;
  clickedAnchorText?: string;
  clickedExternal?: boolean;
  userAgent?: string;
  receivedAt: string;
};

function normalizeForCompare(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function safeKeyPart(value: string) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "unknown";
}

const trackerIndexKey = "_tracker-index.json";
const trackerIndexLimit = 2000;

export async function saveTrackerPayload(payload: TrackerPayload) {
  const store = await getJsonStore("link-tracker");
  const timestamp = Date.now();
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const key = `${safeKeyPart(payload.site)}/${timestamp}-${random}.json`;

  await store.setJSON(key, payload);
  const existingIndex = await store.getJSON<string[]>(trackerIndexKey) ?? [];
  const nextIndex = [key, ...existingIndex.filter((indexKey) => indexKey !== key)].slice(0, trackerIndexLimit);

  await store.setJSON(trackerIndexKey, nextIndex);
  return key;
}

export async function listTrackerPayloads(limit = 50) {
  const store = await getJsonStore("link-tracker");
  const indexedKeys = await store.getJSON<string[]>(trackerIndexKey) ?? [];
  const recent = indexedKeys.length > 0
    ? indexedKeys.slice(0, limit)
    : (await store.listKeys())
        .filter((key) => key.endsWith(".json") && key !== trackerIndexKey)
        .sort()
        .reverse()
        .slice(0, limit);

  const payloads = await Promise.all(
    recent.map(async (key) => {
      const data = await store.getJSON<TrackerPayload>(key);
      return data ? { key, data: data as TrackerPayload } : null;
    }),
  );

  return payloads.filter((payload): payload is { key: string; data: TrackerPayload } => payload !== null);
}

export async function deleteTrackerPayloads(filters: { trackerId?: string; site?: string }) {
  const store = await getJsonStore("link-tracker");
  const indexedKeys = await store.getJSON<string[]>(trackerIndexKey) ?? [];
  const fallbackKeys = indexedKeys.length > 0
    ? []
    : (await store.listKeys()).filter((key) => key.endsWith(".json") && key !== trackerIndexKey);
  const candidateKeys = [...new Set([...indexedKeys, ...fallbackKeys])];
  const remainingKeys: string[] = [];
  let deleted = 0;

  for (const key of candidateKeys) {
    const payload = await store.getJSON<TrackerPayload>(key);

    if (payload && matchesTracker(payload, filters.trackerId, filters.site)) {
      if (await store.deleteJSON(key)) {
        deleted += 1;
      }
      continue;
    }

    if (payload) {
      remainingKeys.push(key);
    }
  }

  await store.setJSON(trackerIndexKey, remainingKeys.slice(0, trackerIndexLimit));
  return deleted;
}

function matchesTracker(payload: TrackerPayload, trackerId?: string, site?: string) {
  const normalizedTrackerId = trackerId?.trim().toUpperCase();
  const normalizedSite = site?.trim().toLowerCase();

  if (normalizedTrackerId && payload.trackerId?.toUpperCase() !== normalizedTrackerId) {
    return false;
  }

  if (normalizedSite && payload.site.toLowerCase() !== normalizedSite) {
    return false;
  }

  return true;
}

export function filterTrackerPayloads(
  payloads: Array<{ key: string; data: TrackerPayload }>,
  filters: { trackerId?: string; site?: string },
) {
  return payloads.filter(({ data }) => matchesTracker(data, filters.trackerId, filters.site));
}

export function summarizeTrackerPayloads(payloads: Array<{ key: string; data: TrackerPayload }>) {
  const pageMap = new Map<string, TrackerPayload & { reportCount: number; lastSeen: string }>();

  for (const { data } of payloads) {
    const existing = pageMap.get(data.pageUrl);
    if (!existing) {
      pageMap.set(data.pageUrl, {
        ...data,
        reportCount: 1,
        lastSeen: data.receivedAt,
      });
      continue;
    }

    existing.reportCount += 1;
    if (data.receivedAt > existing.lastSeen) {
      existing.lastSeen = data.receivedAt;
      existing.pageTitle = data.pageTitle;
      existing.links = data.links;
      existing.clickedUrl = data.clickedUrl;
      existing.clickedAnchorText = data.clickedAnchorText;
    }
  }

  const pages = [...pageMap.values()]
    .sort((first, second) => second.lastSeen.localeCompare(first.lastSeen))
    .map((page) => ({
      site: page.site,
      pageUrl: page.pageUrl,
      pageTitle: page.pageTitle,
      links: page.links,
      reportCount: page.reportCount,
      lastSeen: page.lastSeen,
    }));
  const links = pages.flatMap((page) =>
    page.links.map((link) => ({
      pageUrl: page.pageUrl,
      pageTitle: page.pageTitle,
      ...link,
    })),
  );

  return {
    counts: {
      reports: payloads.length,
      pages: pages.length,
      links: links.length,
      clicks: payloads.filter((payload) => payload.data.clickedUrl).length,
    },
    pages,
    links,
  };
}

export function findInboundLinksForTarget(
  payloads: Array<{ key: string; data: TrackerPayload }>,
  targetUrl: string,
) {
  const normalizedTarget = normalizeForCompare(targetUrl);
  const sourceMap = new Map<string, {
    pageUrl: string;
    pageTitle: string;
    site: string;
    lastSeen: string;
    reportCount: number;
    links: TrackedLink[];
  }>();

  for (const { data } of payloads) {
    const matchingLinks = data.links.filter((link) => normalizeForCompare(link.targetUrl) === normalizedTarget);
    if (matchingLinks.length === 0) {
      continue;
    }

    const existing = sourceMap.get(data.pageUrl);
    if (!existing) {
      sourceMap.set(data.pageUrl, {
        pageUrl: data.pageUrl,
        pageTitle: data.pageTitle,
        site: data.site,
        lastSeen: data.receivedAt,
        reportCount: 1,
        links: matchingLinks,
      });
      continue;
    }

    existing.reportCount += 1;
    if (data.receivedAt > existing.lastSeen) {
      existing.lastSeen = data.receivedAt;
      existing.pageTitle = data.pageTitle;
      existing.links = matchingLinks;
    }
  }

  const sources = [...sourceMap.values()].sort((first, second) => second.lastSeen.localeCompare(first.lastSeen));

  return {
    targetUrl: normalizedTarget,
    counts: {
      sourcePages: sources.length,
      matchingLinks: sources.reduce((total, source) => total + source.links.length, 0),
    },
    sources,
  };
}
