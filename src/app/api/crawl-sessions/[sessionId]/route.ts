import { after } from "next/server";
import { NextResponse } from "next/server";
import {
  deleteCrawlSessionsForWebsite,
  getCrawlSession,
  markStaleCrawlSession,
  resumeCrawlSession,
  runNextCrawlSessionBatch,
  stopCrawlSession,
  toDashboardCrawlSession,
} from "@/lib/crawl-sessions";
import { getJsonStoreStatus } from "@/lib/json-store";
import { trackerIdForWebsite } from "@/lib/site-id";
import { deleteTrackerPayloads } from "@/lib/tracker-store";

export const runtime = "nodejs";
export const maxDuration = 60;

function triggerSessionWorker(sessionId: string, session: Awaited<ReturnType<typeof getCrawlSession>>) {
  if (!session || session.status !== "queued") {
    return;
  }

  after(async () => {
    await runNextCrawlSessionBatch(sessionId, session);
  });
}

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = await getCrawlSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Crawl session not found. Start a fresh crawl session.", storage: getJsonStoreStatus() },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  const checkedSession = await markStaleCrawlSession(session);
  if (checkedSession.status === "failed" && session.status === "running") {

    return NextResponse.json(
      { session: toDashboardCrawlSession(checkedSession), storage: getJsonStoreStatus() },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  if (checkedSession.status === "queued") {
    triggerSessionWorker(sessionId, checkedSession);
  }

  return NextResponse.json(
    { session: toDashboardCrawlSession(checkedSession), storage: getJsonStoreStatus() },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = await resumeCrawlSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Crawl session not found. Start a fresh crawl session.", storage: getJsonStoreStatus() },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  triggerSessionWorker(sessionId, session);

  return NextResponse.json(
    { session: toDashboardCrawlSession(session), storage: getJsonStoreStatus() },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const body = await request.json().catch(() => ({}));

  if (body.action !== "stop") {
    return NextResponse.json(
      { error: "Unsupported crawl session action." },
      { status: 400, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  const session = await stopCrawlSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Crawl session not found. Start a fresh crawl session.", storage: getJsonStoreStatus() },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json(
    { session: toDashboardCrawlSession(session), storage: getJsonStoreStatus() },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}

export async function DELETE(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = await getCrawlSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Crawl session not found.", storage: getJsonStoreStatus() },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  const site = new URL(session.websiteUrl).hostname;
  const deletedSessions = await deleteCrawlSessionsForWebsite(session.websiteUrl);
  const deletedTrackerReports = await deleteTrackerPayloads({
    site,
    trackerId: trackerIdForWebsite(session.websiteUrl),
  });

  return NextResponse.json(
    {
      deleted: true,
      deletedSessions,
      deletedTrackerReports,
      storage: getJsonStoreStatus(),
    },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
