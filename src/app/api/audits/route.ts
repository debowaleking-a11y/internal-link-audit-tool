import { NextResponse } from "next/server";
import { crawlWebsite } from "@/lib/crawler";
import { normalizeUrl } from "@/lib/url";
import { buildAuditResponse } from "@/lib/audit-response";

export const runtime = "nodejs";

function parseLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.max(1, Math.min(Math.floor(parsed), 200));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const websiteUrl = normalizeUrl(String(body.websiteUrl ?? ""));
    const targetUrl = body.targetUrl ? normalizeUrl(String(body.targetUrl), websiteUrl) : websiteUrl;
    const crawlLimit = parseLimit(body.crawlLimit);

    if (new URL(websiteUrl).hostname !== new URL(targetUrl).hostname) {
      return NextResponse.json(
        { error: "Target URL must be on the same domain as the website URL." },
        { status: 400 },
      );
    }

    const result = await crawlWebsite({
      websiteUrl,
      targetUrl,
      crawlLimit,
      maxDurationMs: 9000,
    });
    const createdAt = new Date().toISOString();
    const auditId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `audit-${Date.now()}`;

    return NextResponse.json(
      buildAuditResponse({
        id: auditId,
        websiteUrl,
        targetUrl,
        crawlLimit,
        createdAt,
        discovery: result.discovery,
        pages: result.pages,
        links: result.links,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Enter a valid website URL, target URL, and crawl limit.",
      },
      { status: 400 },
    );
  }
}
