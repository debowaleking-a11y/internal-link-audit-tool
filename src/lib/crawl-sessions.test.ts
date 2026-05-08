import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectCrawlSession,
  deleteCrawlSession,
  listCrawlSessions,
  mergeSessionResults,
  resumeCrawlSession,
  saveCrawlSession,
  stopCrawlSession,
  type CrawlSession,
} from "@/lib/crawl-sessions";
import type { CrawledLink, CrawledPage } from "@/lib/crawler";

function page(url: string, crawled: boolean): CrawledPage {
  return {
    url,
    title: crawled ? `Title ${url}` : "",
    metaDescription: "",
    canonicalUrl: "",
    robotsMeta: "",
    h1Texts: [],
    h2Texts: [],
    h3Texts: [],
    bodyTextSample: "",
    statusCode: crawled ? 200 : null,
    crawled,
    links: [],
  };
}

function link(sourceUrl: string, targetUrl: string, position: number): CrawledLink {
  return {
    sourceUrl,
    targetUrl,
    anchorText: "Anchor",
    position,
    rel: "",
    follow: true,
    statusCode: 200,
    pageTitle: "Page",
    isBroken: false,
  };
}

test("mergeSessionResults prefers crawled pages and deduplicates links", () => {
  const placeholder = page("https://example.com/a", false);
  const crawled = page("https://example.com/a", true);
  const firstLink = link("https://example.com/a", "https://example.com/b", 1);
  const duplicateLink = link("https://example.com/a", "https://example.com/b", 1);
  const secondLink = link("https://example.com/a", "https://example.com/c", 2);

  const merged = mergeSessionResults([placeholder], [firstLink], [crawled], [duplicateLink, secondLink]);

  assert.equal(merged.pages.length, 1);
  assert.equal(merged.pages[0].crawled, true);
  assert.equal(merged.links.length, 2);
});

test("createProjectCrawlSession initializes a named project session for the website", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 404 });

  try {
    const session = await createProjectCrawlSession({
      websiteUrl: "https://example.net/",
      crawlLimit: 2,
      batchSize: 25,
      projectName: "Example SEO Project",
    });

    assert.equal(session.projectName, "Example SEO Project");
    assert.equal(session.websiteUrl, "https://example.net/");
    assert.equal(session.targetUrl, "https://example.net/");
    assert.equal(session.status, "queued");
    assert.equal(session.nextIndex, 0);
    assert.equal(session.progress.crawledPages, 0);
    assert.equal(session.progress.totalPages, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resumeCrawlSession keeps saved progress and makes a failed session runnable again", async () => {
  const failedSession: CrawlSession = {
    id: "resume-test",
    websiteUrl: "https://example.com/",
    targetUrl: "https://example.com/",
    crawlLimit: 5000,
    batchSize: 100,
    status: "failed",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    startedAt: "2026-05-07T00:00:00.000Z",
    finishedAt: "2026-05-07T00:05:00.000Z",
    discoveredUrls: ["https://example.com/", "https://example.com/a", "https://example.com/b"],
    nextIndex: 2,
    progress: {
      crawledPages: 2,
      totalPages: 3,
      currentBatch: 1,
      currentUrl: "https://example.com/a",
    },
    discovery: {
      sitemapUrls: 3,
      sitemapsRead: 1,
      crawledFromSitemap: 2,
      stoppedEarly: true,
    },
    pages: [page("https://example.com/", true), page("https://example.com/a", true)],
    links: [link("https://example.com/", "https://example.com/a", 1)],
    error: "Timed out",
  };

  await saveCrawlSession(failedSession);
  const resumed = await resumeCrawlSession("resume-test");

  assert.equal(resumed?.status, "queued");
  assert.equal(resumed?.nextIndex, 2);
  assert.equal(resumed?.progress.crawledPages, 2);
  assert.equal(resumed?.pages.length, 2);
  assert.equal(resumed?.links.length, 1);
  assert.equal(resumed?.error, null);
});

test("stopCrawlSession stops a runnable session without losing saved crawl data", async () => {
  const runningSession: CrawlSession = {
    id: "stop-test",
    websiteUrl: "https://stop.example/",
    targetUrl: "https://stop.example/",
    crawlLimit: 100,
    batchSize: 50,
    status: "running",
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:01:00.000Z",
    startedAt: "2026-05-08T00:01:00.000Z",
    finishedAt: null,
    discoveredUrls: ["https://stop.example/", "https://stop.example/a"],
    nextIndex: 1,
    progress: { crawledPages: 1, totalPages: 2, currentBatch: 1, currentUrl: "https://stop.example/a" },
    discovery: { sitemapUrls: 2, sitemapsRead: 1, crawledFromSitemap: 1 },
    pages: [page("https://stop.example/", true)],
    links: [link("https://stop.example/", "https://stop.example/a", 1)],
    error: null,
  };

  await saveCrawlSession(runningSession);
  const stopped = await stopCrawlSession("stop-test");

  assert.equal(stopped?.status, "failed");
  assert.equal(stopped?.error, "Crawl stopped by user.");
  assert.equal(stopped?.progress.currentUrl, "");
  assert.equal(stopped?.pages.length, 1);
  assert.equal(stopped?.links.length, 1);
});

test("deleteCrawlSession removes the saved project session", async () => {
  await saveCrawlSession({
    id: "delete-test",
    websiteUrl: "https://delete.example/",
    targetUrl: "https://delete.example/",
    crawlLimit: 100,
    batchSize: 50,
    status: "queued",
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    discoveredUrls: ["https://delete.example/"],
    nextIndex: 0,
    progress: { crawledPages: 0, totalPages: 1, currentBatch: 0, currentUrl: "" },
    discovery: { sitemapUrls: 1, sitemapsRead: 1, crawledFromSitemap: 0 },
    pages: [],
    links: [],
    error: null,
  });

  assert.equal(await deleteCrawlSession("delete-test"), true);
  assert.equal((await listCrawlSessions("https://delete.example/")).some((session) => session.id === "delete-test"), false);
});

test("listCrawlSessions returns the latest saved project session for a website", async () => {
  await saveCrawlSession({
    id: "project-session-old",
    websiteUrl: "https://example.org/",
    targetUrl: "https://example.org/",
    crawlLimit: 100,
    batchSize: 50,
    status: "failed",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:01:00.000Z",
    startedAt: null,
    finishedAt: null,
    discoveredUrls: ["https://example.org/"],
    nextIndex: 0,
    progress: { crawledPages: 0, totalPages: 1, currentBatch: 0, currentUrl: "" },
    discovery: { sitemapUrls: 1, sitemapsRead: 1, crawledFromSitemap: 0 },
    pages: [],
    links: [],
    error: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await saveCrawlSession({
    id: "project-session-new",
    websiteUrl: "https://example.org/",
    targetUrl: "https://example.org/",
    crawlLimit: 100,
    batchSize: 50,
    status: "queued",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:03:00.000Z",
    startedAt: null,
    finishedAt: null,
    discoveredUrls: ["https://example.org/"],
    nextIndex: 0,
    progress: { crawledPages: 0, totalPages: 1, currentBatch: 0, currentUrl: "" },
    discovery: { sitemapUrls: 1, sitemapsRead: 1, crawledFromSitemap: 0 },
    pages: [],
    links: [],
    error: null,
  });

  const sessions = await listCrawlSessions("https://example.org/");

  assert.equal(sessions[0].id, "project-session-new");
});
