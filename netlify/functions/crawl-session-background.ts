import { type CrawlSession, runNextCrawlSessionBatch } from "../../src/lib/crawl-sessions";

async function triggerNextBatch(origin: string, session: CrawlSession | undefined) {
  if (!session || session.status !== "queued") {
    return;
  }

  void fetch(`${origin}/.netlify/functions/crawl-session-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: session.id, session }),
  }).catch(() => {});
}

const crawlSessionBackground = async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const startedAt = Date.now();
  const origin = new URL(request.url).origin;
  const body = await request.json();
  const sessionId = String(body.sessionId ?? "");
  let session = body.session as CrawlSession | undefined;

  if (!sessionId) {
    return new Response("Missing session ID", { status: 400 });
  }

  while (Date.now() - startedAt < 8 * 60 * 1000) {
    session = await runNextCrawlSessionBatch(sessionId, session);

    if (session.status !== "queued") {
      return new Response(null, { status: 202 });
    }
  }

  await triggerNextBatch(origin, session);
  return new Response(null, { status: 202 });
};

export default crawlSessionBackground;
