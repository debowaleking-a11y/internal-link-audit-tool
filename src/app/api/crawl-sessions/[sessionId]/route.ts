import { NextResponse } from "next/server";
import { getCrawlSession, runNextCrawlSessionBatch, saveCrawlSession } from "@/lib/crawl-sessions";

export const runtime = "nodejs";

const staleRunningMs = 4 * 60 * 1000;

async function triggerSessionWorker(origin: string, sessionId: string, session: Awaited<ReturnType<typeof getCrawlSession>>) {
  if (!session || session.status !== "queued") {
    return;
  }

  if (process.env.NETLIFY || process.env.CONTEXT === "production") {
    void fetch(`${origin}/.netlify/functions/crawl-session-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, session }),
    }).catch(() => {});
    return;
  }

  void runNextCrawlSessionBatch(sessionId, session);
}

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const session = await getCrawlSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Crawl session not found. Start a fresh crawl session." },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  const updatedAt = new Date(session.updatedAt || session.startedAt || session.createdAt).getTime();
  if (session.status === "running" && Number.isFinite(updatedAt) && Date.now() - updatedAt > staleRunningMs) {
    const failedSession = await saveCrawlSession({
      ...session,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "Crawl session stopped updating. Start it again with a smaller batch size.",
    });

    return NextResponse.json({ session: failedSession }, { headers: { "cache-control": "no-store, max-age=0" } });
  }

  if (session.status === "queued") {
    await triggerSessionWorker(new URL(request.url).origin, sessionId, session);
  }

  return NextResponse.json({ session }, { headers: { "cache-control": "no-store, max-age=0" } });
}
