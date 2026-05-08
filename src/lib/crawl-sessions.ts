import { buildAuditResponse } from "./audit-response";
import { crawlWebsite, discoverWebsiteUrls, type CrawledLink, type CrawledPage } from "./crawler";
import { getJsonStore } from "./json-store";
import { normalizeUrl } from "./url";

export type CrawlSession = {
  id: string;
  projectName?: string;
  websiteUrl: string;
  targetUrl: string;
  crawlLimit: number;
  batchSize: number;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  discoveredUrls: string[];
  nextIndex: number;
  progress: {
    crawledPages: number;
    totalPages: number;
    currentBatch: number;
    currentUrl: string;
  };
  discovery: {
    sitemapUrls: number;
    sitemapsRead: number;
    crawledFromSitemap: number;
    robots?: {
      url: string;
      found: boolean;
      sitemapDeclarations: number;
      hasDisallowRules: boolean;
      error: string | null;
    } | null;
    stoppedEarly?: boolean;
  };
  pages: CrawledPage[];
  links: CrawledLink[];
  error: string | null;
  result?: ReturnType<typeof buildAuditResponse>;
};

function makeSessionId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `session-${Date.now()}`;
}

export async function saveCrawlSession(session: CrawlSession) {
  const sessionToSave = {
    ...session,
    updatedAt: new Date().toISOString(),
  };

  const store = await getJsonStore("crawl-sessions");
  await store.setJSON(`${session.id}.json`, sessionToSave);
  return sessionToSave;
}

export async function getCrawlSession(sessionId: string) {
  const store = await getJsonStore("crawl-sessions");
  return store.getJSON<CrawlSession>(`${sessionId}.json`);
}

export async function deleteCrawlSession(sessionId: string) {
  const store = await getJsonStore("crawl-sessions");
  return store.deleteJSON(`${sessionId}.json`);
}

export async function listCrawlSessions(websiteUrl?: string) {
  const normalizedWebsiteUrl = websiteUrl ? normalizeUrl(websiteUrl) : "";

  const store = await getJsonStore("crawl-sessions");
  const keys = await store.listKeys();
  const sessions = await Promise.all(
    keys
      .filter((key) => key.endsWith(".json"))
      .map(async (key) => store.getJSON<CrawlSession>(key)),
  );

  return sessions
    .filter((session): session is CrawlSession => session !== null)
    .filter((session) => !normalizedWebsiteUrl || session.websiteUrl === normalizedWebsiteUrl)
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

export async function createProjectCrawlSession(input: { websiteUrl: string; crawlLimit: number; batchSize?: number; projectName?: string }) {
  const websiteUrl = normalizeUrl(input.websiteUrl);
  const crawlLimit = Math.max(1, Math.min(Math.floor(input.crawlLimit), 5000));
  const batchSize = Math.max(25, Math.min(Math.floor(input.batchSize ?? 100), 250));
  const discovered = await discoverWebsiteUrls(websiteUrl, crawlLimit);
  const createdAt = new Date().toISOString();
  const session: CrawlSession = {
    id: makeSessionId(),
    projectName: input.projectName?.trim() || new URL(websiteUrl).hostname,
    websiteUrl,
    targetUrl: websiteUrl,
    crawlLimit,
    batchSize,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    discoveredUrls: discovered.urls,
    nextIndex: 0,
    progress: {
      crawledPages: 0,
      totalPages: discovered.urls.length,
      currentBatch: 0,
      currentUrl: "",
    },
    discovery: discovered.discovery,
    pages: [],
    links: [],
    error: null,
  };

  return saveCrawlSession(session);
}

export async function createCrawlSession(input: { websiteUrl: string; crawlLimit: number; batchSize?: number }) {
  return createProjectCrawlSession(input);
}

export function mergeSessionResults(
  existingPages: CrawledPage[],
  existingLinks: CrawledLink[],
  batchPages: CrawledPage[],
  batchLinks: CrawledLink[],
) {
  const pageMap = new Map(existingPages.map((page) => [page.url, page]));

  for (const page of batchPages) {
    const existing = pageMap.get(page.url);
    if (!existing || page.crawled || !existing.crawled) {
      pageMap.set(page.url, page);
    }
  }

  const linkMap = new Map<string, CrawledLink>();
  for (const link of [...existingLinks, ...batchLinks]) {
    linkMap.set(`${link.sourceUrl}|${link.position}|${link.targetUrl}`, link);
  }

  return {
    pages: [...pageMap.values()],
    links: [...linkMap.values()],
  };
}

export async function resumeCrawlSession(sessionId: string) {
  const session = await getCrawlSession(sessionId);

  if (!session) {
    return null;
  }

  if (session.status === "completed") {
    return session;
  }

  return saveCrawlSession({
    ...session,
    status: "queued",
    finishedAt: null,
    error: null,
    result: undefined,
    progress: {
      ...session.progress,
      crawledPages: session.pages.filter((page) => page.crawled).length,
      totalPages: session.discoveredUrls.length,
      currentUrl: "",
    },
  });
}

export async function stopCrawlSession(sessionId: string) {
  const session = await getCrawlSession(sessionId);

  if (!session) {
    return null;
  }

  if (session.status === "completed" || session.status === "failed") {
    return session;
  }

  return saveCrawlSession({
    ...session,
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: "Crawl stopped by user.",
    progress: {
      ...session.progress,
      crawledPages: session.pages.filter((page) => page.crawled).length,
      currentUrl: "",
    },
  });
}

function buildSessionResult(session: CrawlSession) {
  const { robots, ...discovery } = session.discovery;

  return buildAuditResponse({
    id: session.id,
    websiteUrl: session.websiteUrl,
    targetUrl: session.targetUrl,
    crawlLimit: session.crawlLimit,
    createdAt: session.createdAt,
    discovery: {
      ...discovery,
      ...(robots ? { robots } : {}),
      crawledFromSitemap: session.pages.filter((page) => session.discoveredUrls.includes(page.url) && page.crawled).length,
      stoppedEarly: session.nextIndex < session.discoveredUrls.length,
    },
    pages: session.pages,
    links: session.links,
  });
}

export async function runNextCrawlSessionBatch(sessionId: string, fallbackSession?: CrawlSession) {
  const existing = await getCrawlSession(sessionId) ?? fallbackSession ?? null;

  if (!existing) {
    throw new Error(`Crawl session ${sessionId} was not found.`);
  }

  if (existing.status === "completed" || existing.status === "failed") {
    return existing;
  }

  if (existing.nextIndex >= existing.discoveredUrls.length) {
    return saveCrawlSession({
      ...existing,
      status: "completed",
      finishedAt: new Date().toISOString(),
      progress: {
        ...existing.progress,
        crawledPages: existing.pages.filter((page) => page.crawled).length,
        currentUrl: "",
      },
      result: buildSessionResult(existing),
    });
  }

  const batchUrls = existing.discoveredUrls.slice(existing.nextIndex, existing.nextIndex + existing.batchSize);
  const runningSession = await saveCrawlSession({
    ...existing,
    status: "running",
    startedAt: existing.startedAt ?? new Date().toISOString(),
    error: null,
    progress: {
      ...existing.progress,
      currentBatch: Math.floor(existing.nextIndex / existing.batchSize) + 1,
      currentUrl: batchUrls[0] ?? "",
    },
  });

  try {
    const baseCrawledCount = runningSession.pages.filter((page) => page.crawled).length;
    const result = await crawlWebsite({
      websiteUrl: runningSession.websiteUrl,
      targetUrl: runningSession.targetUrl,
      crawlLimit: batchUrls.length,
      maxCrawlLimit: batchUrls.length,
      maxDurationMs: 90 * 1000,
      seedUrls: batchUrls,
      enqueueDiscoveredLinks: false,
      async onProgress(progress) {
        await saveCrawlSession({
          ...runningSession,
          status: "running",
          progress: {
            crawledPages: baseCrawledCount + progress.crawledPages,
            totalPages: runningSession.discoveredUrls.length,
            currentBatch: runningSession.progress.currentBatch,
            currentUrl: progress.currentUrl,
          },
        });
      },
    });
    const merged = mergeSessionResults(runningSession.pages, runningSession.links, result.pages, result.links);
    const latest = await getCrawlSession(sessionId);

    if (latest?.status === "failed" && latest.error === "Crawl stopped by user.") {
      return latest;
    }

    const nextIndex = Math.min(runningSession.discoveredUrls.length, runningSession.nextIndex + batchUrls.length);
    const isComplete = nextIndex >= runningSession.discoveredUrls.length;
    const nextSession: CrawlSession = {
      ...runningSession,
      ...merged,
      nextIndex,
      status: isComplete ? "completed" : "queued",
      finishedAt: isComplete ? new Date().toISOString() : null,
      progress: {
        crawledPages: merged.pages.filter((page) => page.crawled).length,
        totalPages: runningSession.discoveredUrls.length,
        currentBatch: runningSession.progress.currentBatch,
        currentUrl: "",
      },
      result: isComplete ? buildSessionResult({ ...runningSession, ...merged, nextIndex }) : undefined,
    };

    return saveCrawlSession(nextSession);
  } catch (error) {
    return saveCrawlSession({
      ...runningSession,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Crawl session batch failed.",
    });
  }
}
