import { NextResponse } from "next/server";
import { listTrackerPayloads, summarizeTrackerPayloads } from "@/lib/tracker-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50), 200));
  const payloads = await listTrackerPayloads(limit);

  return NextResponse.json({
    reports: payloads,
    summary: summarizeTrackerPayloads(payloads),
  });
}
