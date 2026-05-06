import { NextResponse } from "next/server";
import { findInboundLinksForTarget, listTrackerPayloads, summarizeTrackerPayloads } from "@/lib/tracker-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50), 200));
  const targetUrl = url.searchParams.get("targetUrl") ?? "";
  const payloads = await listTrackerPayloads(limit);

  return NextResponse.json({
    reports: payloads,
    summary: summarizeTrackerPayloads(payloads),
    inbound: targetUrl ? findInboundLinksForTarget(payloads, targetUrl) : null,
  });
}
