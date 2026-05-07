import { NextResponse } from "next/server";
import { saveTrackerPayload, type TrackedLink, type TrackerPayload } from "@/lib/tracker-store";
import { cleanTrackerId, isBotUserAgent, isValidSiteId, originMatchesPage } from "@/lib/tracking-security";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "null",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function headersForOrigin(origin: string | null) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": origin || "null",
    vary: "origin",
  };
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

function rateLimitKey(request: Request, site: string) {
  const ip = request.headers.get("x-nf-client-connection-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  return `${site}:${ip.split(",")[0].trim()}`;
}

function isRateLimited(key: string) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > 120;
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

function cleanHeadingArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => cleanText(item).slice(0, 240)).filter(Boolean).slice(0, 30);
}

function cleanUtm(value: unknown) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const allowed = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  const output: Record<string, string> = {};

  for (const key of allowed) {
    const cleaned = cleanText((value as Record<string, unknown>)[key]).slice(0, 160);
    if (cleaned) {
      output[key] = cleaned;
    }
  }

  return output;
}

export async function OPTIONS(request: Request) {
  return new Response(null, { headers: headersForOrigin(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const body = rawBody ? JSON.parse(rawBody) : {};
    const pageUrl = cleanUrl(body.pageUrl);
    const site = cleanText(body.site || (pageUrl ? new URL(pageUrl).hostname : ""));
    const origin = request.headers.get("origin");
    const userAgent = request.headers.get("user-agent") ?? "";

    if (!pageUrl || !site) {
      return NextResponse.json({ error: "Missing page URL or site." }, { status: 400, headers: headersForOrigin(origin) });
    }

    if (!originMatchesPage(origin, pageUrl)) {
      return NextResponse.json({ error: "Origin is not verified for this page URL." }, { status: 403, headers: headersForOrigin(origin) });
    }

    if (!isValidSiteId(site, body.trackerId)) {
      return NextResponse.json({ error: "Invalid site ID." }, { status: 403, headers: headersForOrigin(origin) });
    }

    if (isBotUserAgent(userAgent)) {
      return new Response(null, { status: 204, headers: headersForOrigin(origin) });
    }

    if (isRateLimited(rateLimitKey(request, site))) {
      return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: headersForOrigin(origin) });
    }

    const payload: TrackerPayload = {
      trackerId: cleanTrackerId(body.trackerId) || undefined,
      site,
      eventType: ["page_view", "internal_click", "external_click", "scroll"].includes(body.eventType) ? body.eventType : "page_view",
      pageUrl,
      pageTitle: cleanText(body.pageTitle).slice(0, 240),
      metaDescription: cleanText(body.metaDescription).slice(0, 300),
      canonicalUrl: cleanUrl(body.canonicalUrl),
      headings: {
        h1: cleanHeadingArray(body.headings?.h1),
        h2: cleanHeadingArray(body.headings?.h2),
        h3: cleanHeadingArray(body.headings?.h3),
      },
      referrer: cleanUrl(body.referrer),
      utm: cleanUtm(body.utm),
      deviceType: ["desktop", "tablet", "mobile"].includes(body.deviceType) ? body.deviceType : undefined,
      pageLoadTiming: {
        domContentLoadedMs: Number.isFinite(Number(body.pageLoadTiming?.domContentLoadedMs)) ? Number(body.pageLoadTiming.domContentLoadedMs) : null,
        loadCompleteMs: Number.isFinite(Number(body.pageLoadTiming?.loadCompleteMs)) ? Number(body.pageLoadTiming.loadCompleteMs) : null,
      },
      scrollDepth: Number.isFinite(Number(body.scrollDepth)) ? Math.max(0, Math.min(100, Number(body.scrollDepth))) : 0,
      links: cleanLinks(body.links),
      clickedUrl: cleanUrl(body.clickedUrl) || undefined,
      clickedAnchorText: cleanText(body.clickedAnchorText).slice(0, 240) || undefined,
      clickedExternal: Boolean(body.clickedExternal),
      userAgent,
      receivedAt: new Date().toISOString(),
    };

    const key = await saveTrackerPayload(payload);

    return NextResponse.json({ ok: true, key }, { headers: headersForOrigin(origin) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save tracker payload." },
      { status: 400, headers: headersForOrigin(request.headers.get("origin")) },
    );
  }
}
