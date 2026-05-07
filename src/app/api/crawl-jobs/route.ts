import { NextResponse } from "next/server";
import { createCrawlJob, runCrawlJob } from "@/lib/crawl-jobs";

export const runtime = "nodejs";

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
    const origin = new URL(request.url).origin;

    if (process.env.NETLIFY || process.env.CONTEXT === "production") {
      const response = await fetch(`${origin}/.netlify/functions/crawl-background`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });

      if (!response.ok && response.status !== 202) {
        throw new Error(`Could not start background function. Status ${response.status}.`);
      }
    } else {
      void runCrawlJob(job.id);
    }

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create background crawl job." },
      { status: 400 },
    );
  }
}
