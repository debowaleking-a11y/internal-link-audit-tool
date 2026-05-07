import { NextResponse } from "next/server";
import { createCrawlSession, listCrawlSessions, runNextCrawlSessionBatch } from "@/lib/crawl-sessions";

export const runtime = "nodejs";

function parseSessionLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 5000;
  }

  return Math.max(1, Math.min(Math.floor(parsed), 5000));
}

async function triggerSessionWorker(origin: string, session: Awaited<ReturnType<typeof createCrawlSession>>) {
  if (process.env.NETLIFY || process.env.CONTEXT === "production") {
    void fetch(`${origin}/.netlify/functions/crawl-session-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, session }),
    }).catch(() => {});

    return;
  }

  void runNextCrawlSessionBatch(session.id, session);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const session = await createCrawlSession({
      websiteUrl: String(body.websiteUrl ?? ""),
      crawlLimit: parseSessionLimit(body.crawlLimit),
      batchSize: Number(body.batchSize ?? 100),
    });

    await triggerSessionWorker(new URL(request.url).origin, session);

    return NextResponse.json(
      { session },
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

    return NextResponse.json(
      { sessions, latestSession: sessions[0] ?? null },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load crawl sessions." },
      { status: 400, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
