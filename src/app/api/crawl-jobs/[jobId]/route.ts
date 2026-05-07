import { NextResponse } from "next/server";
import { getCrawlJob } from "@/lib/crawl-jobs";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = await getCrawlJob(jobId);

  if (!job) {
    return NextResponse.json(
      { error: "Crawl job not found. Start a new background crawl and refresh that new job." },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json({ job }, { headers: { "cache-control": "no-store, max-age=0" } });
}
