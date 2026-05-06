import { NextResponse } from "next/server";
import { crawlWebsite } from "@/lib/crawler";
import { normalizeUrl } from "@/lib/url";
import { summarizeAudit } from "@/lib/audit-summary";

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
    const targetUrl = normalizeUrl(String(body.targetUrl ?? ""), websiteUrl);
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

    const pages = result.pages
      .sort((first, second) => first.url.localeCompare(second.url))
      .map((page, index) => ({
        id: `page-${index + 1}`,
        url: page.url,
        title: page.title,
        statusCode: page.statusCode,
        crawled: page.crawled,
        error: page.error ?? null,
      }));

    const links = result.links
      .sort((first, second) => first.sourceUrl.localeCompare(second.sourceUrl) || first.position - second.position)
      .map((link, index) => ({
        id: `link-${index + 1}`,
        sourceUrl: link.sourceUrl,
        targetUrl: link.targetUrl,
        anchorText: link.anchorText,
        position: link.position,
        rel: link.rel,
        follow: link.follow,
        statusCode: link.statusCode,
        pageTitle: link.pageTitle,
        isBroken: link.isBroken,
      }));

    return NextResponse.json({
      audit: {
        id: auditId,
        websiteUrl,
        targetUrl,
        crawlLimit,
        status: "completed",
        error: null,
        createdAt,
        discovery: result.discovery,
        links,
      },
      summary: summarizeAudit(pages, links, targetUrl),
    });
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
