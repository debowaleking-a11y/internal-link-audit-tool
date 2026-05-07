import { NextResponse } from "next/server";
import { getCrawlJob } from "@/lib/crawl-jobs";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = await getCrawlJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Crawl job not found." }, { status: 404 });
  }

  return NextResponse.json({ job });
}
