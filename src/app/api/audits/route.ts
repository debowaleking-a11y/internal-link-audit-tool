import { NextResponse } from "next/server";
import { crawlWebsite } from "@/lib/crawler";
import { prisma } from "@/lib/prisma";
import { normalizeUrl } from "@/lib/url";
import { summarizeAudit } from "@/lib/audit-summary";

export const runtime = "nodejs";

function parseLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 25;
  }

  return Math.max(1, Math.min(Math.floor(parsed), 250));
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

    const audit = await prisma.auditRun.create({
      data: {
        websiteUrl,
        targetUrl,
        crawlLimit,
        status: "running",
      },
    });

    try {
      const result = await crawlWebsite({ websiteUrl, targetUrl, crawlLimit });

      await prisma.$transaction(async (tx) => {
        for (const page of result.pages) {
          await tx.page.upsert({
            where: {
              auditRunId_url: {
                auditRunId: audit.id,
                url: page.url,
              },
            },
            update: {
              title: page.title,
              statusCode: page.statusCode,
              crawled: page.crawled,
              error: page.error,
            },
            create: {
              auditRunId: audit.id,
              url: page.url,
              title: page.title,
              statusCode: page.statusCode,
              crawled: page.crawled,
              error: page.error,
            },
          });
        }

        const sourcePages = await tx.page.findMany({
          where: { auditRunId: audit.id },
          select: { id: true, url: true },
        });
        const pageIdByUrl = new Map(sourcePages.map((page) => [page.url, page.id]));

        if (result.links.length > 0) {
          await tx.link.createMany({
            data: result.links
              .map((link) => {
                const sourcePageId = pageIdByUrl.get(link.sourceUrl);
                if (!sourcePageId) {
                  return null;
                }

                return {
                  auditRunId: audit.id,
                  sourcePageId,
                  sourceUrl: link.sourceUrl,
                  targetUrl: link.targetUrl,
                  anchorText: link.anchorText,
                  position: link.position,
                  rel: link.rel,
                  follow: link.follow,
                  statusCode: link.statusCode,
                  pageTitle: link.pageTitle,
                  isBroken: link.isBroken,
                };
              })
              .filter((link): link is NonNullable<typeof link> => link !== null),
          });
        }

        await tx.auditRun.update({
          where: { id: audit.id },
          data: { status: "completed" },
        });
      });
    } catch (error) {
      await prisma.auditRun.update({
        where: { id: audit.id },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Audit failed.",
        },
      });
    }

    const savedAudit = await prisma.auditRun.findUniqueOrThrow({
      where: { id: audit.id },
      include: {
        pages: { orderBy: { url: "asc" } },
        links: { orderBy: [{ sourceUrl: "asc" }, { position: "asc" }] },
      },
    });

    return NextResponse.json({
      audit: savedAudit,
      summary: summarizeAudit(savedAudit.pages, savedAudit.links, savedAudit.targetUrl),
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

export async function GET() {
  const audits = await prisma.auditRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      pages: { orderBy: { url: "asc" } },
      links: { orderBy: [{ sourceUrl: "asc" }, { position: "asc" }] },
    },
  });

  return NextResponse.json({
    audits: audits.map((audit) => ({
      audit,
      summary: summarizeAudit(audit.pages, audit.links, audit.targetUrl),
    })),
  });
}
