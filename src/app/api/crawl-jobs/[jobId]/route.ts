import { NextResponse } from "next/server";
import { getCrawlJob, saveCrawlJob } from "@/lib/crawl-jobs";

export const runtime = "nodejs";

const staleRunningMs = 3 * 60 * 1000;

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = await getCrawlJob(jobId);

  if (!job) {
    return NextResponse.json(
      { error: "Crawl job not found. Start a new background crawl and refresh that new job." },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  const updatedAt = new Date(job.updatedAt || job.startedAt || job.createdAt).getTime();
  if (job.status === "running" && Number.isFinite(updatedAt) && Date.now() - updatedAt > staleRunningMs) {
    const failedJob = await saveCrawlJob({
      ...job,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "Background crawl stopped updating. Start a fresh crawl with a smaller limit, or use batched crawling for larger sites.",
    });

    return NextResponse.json({ job: failedJob }, { headers: { "cache-control": "no-store, max-age=0" } });
  }

  return NextResponse.json({ job }, { headers: { "cache-control": "no-store, max-age=0" } });
}
