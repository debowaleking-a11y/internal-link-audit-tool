import { after } from "next/server";
import { NextResponse } from "next/server";
import { createCrawlJob, runCrawlJob } from "@/lib/crawl-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseBackgroundLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1000;
  }

  return Math.max(1, Math.min(Math.floor(parsed), 1500));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const job = await createCrawlJob({
      websiteUrl: String(body.websiteUrl ?? ""),
      crawlLimit: parseBackgroundLimit(body.crawlLimit),
    });
    after(async () => {
      await runCrawlJob(job.id, job);
    });

    return NextResponse.json({ job }, { status: 202, headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create background crawl job." },
      { status: 400 },
    );
  }
}
