import { buildAuditResponse } from "./audit-response";
import { crawlWebsite } from "./crawler";
import { getJsonStore } from "./json-store";
import { normalizeUrl } from "./url";

export type BackgroundCrawlJob = {
  id: string;
  websiteUrl: string;
  targetUrl: string;
  crawlLimit: number;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: {
    crawledPages: number;
    queuedPages: number;
    currentUrl: string;
  };
  error: string | null;
  result?: ReturnType<typeof buildAuditResponse>;
};

export function makeJobId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `crawl-${Date.now()}`;
}

export async function saveCrawlJob(job: BackgroundCrawlJob) {
  const jobToSave = {
    ...job,
    updatedAt: new Date().toISOString(),
  };

  const store = await getJsonStore("crawl-jobs");
  await store.setJSON(`${job.id}.json`, jobToSave);
  return jobToSave;
}

export async function getCrawlJob(jobId: string) {
  const store = await getJsonStore("crawl-jobs");
  return store.getJSON<BackgroundCrawlJob>(`${jobId}.json`);
}

export async function createCrawlJob(input: { websiteUrl: string; crawlLimit: number }) {
  const websiteUrl = normalizeUrl(input.websiteUrl);
  const crawlLimit = Math.max(1, Math.min(Math.floor(input.crawlLimit), 1500));
  const job: BackgroundCrawlJob = {
    id: makeJobId(),
    websiteUrl,
    targetUrl: websiteUrl,
    crawlLimit,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    progress: {
      crawledPages: 0,
      queuedPages: 0,
      currentUrl: "",
    },
    error: null,
  };

  return saveCrawlJob(job);
}

export async function runCrawlJob(jobId: string, fallbackJob?: BackgroundCrawlJob) {
  const existing = await getCrawlJob(jobId) ?? fallbackJob ?? null;

  if (!existing) {
    throw new Error(`Crawl job ${jobId} was not found.`);
  }

  if (fallbackJob) {
    await saveCrawlJob(existing);
  }

  const runningJob: BackgroundCrawlJob = {
    ...existing,
    status: "running",
    startedAt: new Date().toISOString(),
    error: null,
  };
  await saveCrawlJob(runningJob);

  let lastProgressSave = 0;
  let lastSavedProgressPage = 0;

  try {
    const result = await crawlWebsite({
      websiteUrl: runningJob.websiteUrl,
      targetUrl: runningJob.targetUrl,
      crawlLimit: runningJob.crawlLimit,
      maxCrawlLimit: 1500,
      maxDurationMs: 14 * 60 * 1000,
      async onProgress(progress) {
        const now = Date.now();
        if (progress.crawledPages - lastSavedProgressPage < 5 && now - lastProgressSave < 5000) {
          return;
        }

        lastProgressSave = now;
        lastSavedProgressPage = progress.crawledPages;
        await saveCrawlJob({
          ...runningJob,
          status: "running",
          progress,
        });
      },
    });
    const completedAt = new Date().toISOString();

    return saveCrawlJob({
      ...runningJob,
      status: "completed",
      finishedAt: completedAt,
      progress: {
        crawledPages: result.pages.filter((page) => page.crawled).length,
        queuedPages: 0,
        currentUrl: "",
      },
      result: buildAuditResponse({
        id: runningJob.id,
        websiteUrl: result.websiteUrl,
        targetUrl: result.targetUrl,
        crawlLimit: runningJob.crawlLimit,
        createdAt: runningJob.createdAt,
        discovery: result.discovery,
        pages: result.pages,
        links: result.links,
      }),
    });
  } catch (error) {
    return saveCrawlJob({
      ...runningJob,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Background crawl failed.",
    });
  }
}
