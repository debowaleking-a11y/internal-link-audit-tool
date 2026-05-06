import { getDeployStore, getStore } from "@netlify/blobs";

export type TrackedLink = {
  targetUrl: string;
  anchorText: string;
  position: number;
  rel: string;
  follow: boolean;
  area: string;
};

export type TrackerPayload = {
  site: string;
  pageUrl: string;
  pageTitle: string;
  referrer: string;
  links: TrackedLink[];
  clickedUrl?: string;
  clickedAnchorText?: string;
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

function getTrackerStore() {
  if (process.env.CONTEXT === "production") {
    return getStore("link-tracker");
  }

  return getDeployStore("link-tracker");
}

export async function saveTrackerPayload(payload: TrackerPayload) {
  const store = getTrackerStore();
  const timestamp = Date.now();
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const key = `${safeKeyPart(payload.site)}/${timestamp}-${random}.json`;

  await store.setJSON(key, payload);
  return key;
}

export async function listTrackerPayloads(limit = 50) {
  const store = getTrackerStore();
  const { blobs } = await store.list();
  const recent = blobs
    .map((blob) => blob.key)
    .filter((key) => key.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);

  const payloads = await Promise.all(
    recent.map(async (key) => {
      const data = await store.get(key, { type: "json" });
      return data ? { key, data: data as TrackerPayload } : null;
    }),
  );

  return payloads.filter((payload): payload is { key: string; data: TrackerPayload } => payload !== null);
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

  const pages = [...pageMap.values()].sort((first, second) => second.lastSeen.localeCompare(first.lastSeen));
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
