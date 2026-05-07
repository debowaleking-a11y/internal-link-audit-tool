import { NextResponse } from "next/server";
import {
  filterTrackerPayloads,
  findInboundLinksForTarget,
  listTrackerPayloads,
  summarizeTrackerPayloads,
} from "@/lib/tracker-store";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store, max-age=0",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50), 200));
  const targetUrl = url.searchParams.get("targetUrl") ?? "";
  const trackerId = url.searchParams.get("trackerId") ?? "";
  const site = url.searchParams.get("site") ?? "";
  const allPayloads = await listTrackerPayloads(200);
  const payloads = filterTrackerPayloads(allPayloads, { trackerId, site }).slice(0, limit);
  const summary = summarizeTrackerPayloads(payloads);

  return NextResponse.json(
    {
      reports: payloads,
      connection: {
        trackerId: trackerId || null,
        site: site || null,
        connected: payloads.length > 0,
        lastSeen: summary.pages[0]?.lastSeen ?? null,
        pagesSeen: summary.counts.pages,
        reportsSeen: summary.counts.reports,
      },
      summary,
      inbound: targetUrl ? findInboundLinksForTarget(payloads, targetUrl) : null,
    },
    { headers: noStoreHeaders },
  );
}
