import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function csvCell(value: string | number | boolean | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const audit = await prisma.auditRun.findUnique({
    where: { id },
    include: {
      links: {
        orderBy: [{ sourceUrl: "asc" }, { position: "asc" }],
      },
    },
  });

  if (!audit) {
    return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  }

  const header = [
    "source_page",
    "target_page",
    "anchor_text",
    "link_position",
    "status_code",
    "follow",
    "rel",
    "page_title",
    "broken",
  ];

  const rows = audit.links.map((link) => [
    link.sourceUrl,
    link.targetUrl,
    link.anchorText,
    link.position,
    link.statusCode,
    link.follow ? "follow" : "nofollow",
    link.rel,
    link.pageTitle,
    link.isBroken,
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="internal-link-audit-${audit.id}.csv"`,
    },
  });
}
