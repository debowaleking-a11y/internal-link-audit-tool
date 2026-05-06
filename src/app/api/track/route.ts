import { NextResponse } from "next/server";
import { saveTrackerPayload, type TrackedLink, type TrackerPayload } from "@/lib/tracker-store";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function cleanTrackerId(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 40);
}

function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim().slice(0, 500);
}

function cleanUrl(value: unknown) {
  try {
    return new URL(String(value ?? "")).toString();
  } catch {
    return "";
  }
}

function cleanLinks(value: unknown): TrackedLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 500).flatMap((link, index) => {
    const targetUrl = cleanUrl(link?.targetUrl);
    if (!targetUrl) {
      return [];
    }

    const rel = cleanText(link?.rel).slice(0, 120);
    const relTokens = rel.toLowerCase().split(/\s+/).filter(Boolean);

    return [{
      targetUrl,
      anchorText: cleanText(link?.anchorText).slice(0, 240),
      position: Number.isFinite(Number(link?.position)) ? Number(link.position) : index + 1,
      rel,
      follow: !relTokens.includes("nofollow"),
      area: cleanText(link?.area, "body").slice(0, 40),
    }];
  });
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pageUrl = cleanUrl(body.pageUrl);
    const site = cleanText(body.site || (pageUrl ? new URL(pageUrl).hostname : ""));

    if (!pageUrl || !site) {
      return NextResponse.json({ error: "Missing page URL or site." }, { status: 400, headers: corsHeaders });
    }

    const payload: TrackerPayload = {
      trackerId: cleanTrackerId(body.trackerId) || undefined,
      site,
      pageUrl,
      pageTitle: cleanText(body.pageTitle).slice(0, 240),
      referrer: cleanUrl(body.referrer),
      links: cleanLinks(body.links),
      clickedUrl: cleanUrl(body.clickedUrl) || undefined,
      clickedAnchorText: cleanText(body.clickedAnchorText).slice(0, 240) || undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
      receivedAt: new Date().toISOString(),
    };

    const key = await saveTrackerPayload(payload);

    return NextResponse.json({ ok: true, key }, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save tracker payload." },
      { status: 400, headers: corsHeaders },
    );
  }
}
