import { after } from "next/server";
import { NextResponse } from "next/server";
import {
  createProjectCrawlSession,
  listCrawlSessions,
  markStaleCrawlSession,
  runNextCrawlSessionBatch,
  toDashboardCrawlSession,
} from "@/lib/crawl-sessions";
import { getJsonStoreStatus } from "@/lib/json-store";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseSessionLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 5000;
  }

  return Math.max(1, Math.min(Math.floor(parsed), 5000));
}

function triggerSessionWorker(session: Awaited<ReturnType<typeof createProjectCrawlSession>>) {
  after(async () => {
    await runNextCrawlSessionBatch(session.id, session);
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const session = await createProjectCrawlSession({
      websiteUrl: String(body.websiteUrl ?? ""),
      crawlLimit: parseSessionLimit(body.crawlLimit),
      batchSize: Number(body.batchSize ?? 25),
      projectName: typeof body.projectName === "string" ? body.projectName : undefined,
    });

    triggerSessionWorker(session);

    return NextResponse.json(
      { session: toDashboardCrawlSession(session), storage: getJsonStoreStatus() },
      { status: 202, headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create crawl session." },
      { status: 400, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const websiteUrl = url.searchParams.get("websiteUrl") ?? "";
    const sessions = await listCrawlSessions(websiteUrl || undefined);
    const checkedSessions = await Promise.all(sessions.map(markStaleCrawlSession));

    return NextResponse.json(
      {
        sessions: checkedSessions.map(toDashboardCrawlSession),
        latestSession: checkedSessions[0] ? toDashboardCrawlSession(checkedSessions[0]) : null,
        storage: getJsonStoreStatus(),
      },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load crawl sessions." },
      { status: 400, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
