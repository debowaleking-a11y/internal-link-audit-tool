import { buildAnchorSuggestions } from "@/lib/crawler";

type PageLike = {
  id: string;
  url: string;
  title: string;
  statusCode: number | null;
  crawled: boolean;
  error: string | null;
};

type LinkLike = {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  position: number;
  rel: string;
  follow: boolean;
  statusCode: number | null;
  pageTitle: string;
  isBroken: boolean;
};

export function summarizeAudit(pages: PageLike[], links: LinkLike[], targetUrl: string) {
  const normalizedTarget = targetUrl;
  const incomingCounts = new Map<string, number>();
  const linksToTargetCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();

  for (const page of pages) {
    incomingCounts.set(page.url, 0);
    linksToTargetCounts.set(page.url, 0);
    outgoingCounts.set(page.url, 0);
  }

  for (const link of links) {
    incomingCounts.set(link.targetUrl, (incomingCounts.get(link.targetUrl) ?? 0) + 1);
    outgoingCounts.set(link.sourceUrl, (outgoingCounts.get(link.sourceUrl) ?? 0) + 1);

    if (link.targetUrl === normalizedTarget) {
      linksToTargetCounts.set(link.sourceUrl, (linksToTargetCounts.get(link.sourceUrl) ?? 0) + 1);
    }
  }

  const pageInsights = pages
    .map((page) => ({
      ...page,
      incomingCount: incomingCounts.get(page.url) ?? 0,
      outgoingCount: outgoingCounts.get(page.url) ?? 0,
      linksToTarget: linksToTargetCounts.get(page.url) ?? 0,
    }))
    .map((page) => ({
      ...page,
      isOrphan: page.url !== normalizedTarget && page.crawled && page.incomingCount === 0,
      hasTooFewInternalLinks: page.crawled && page.outgoingCount < 3,
    }));

  return {
    counts: {
      pages: pages.length,
      crawledPages: pages.filter((page) => page.crawled).length,
      links: links.length,
      brokenLinks: links.filter((link) => link.isBroken).length,
      orphanPages: pageInsights.filter((page) => page.isOrphan).length,
      lowLinkPages: pageInsights.filter((page) => page.hasTooFewInternalLinks).length,
      linksToTarget: links.filter((link) => link.targetUrl === normalizedTarget).length,
    },
    pages: pageInsights,
    suggestions: buildAnchorSuggestions({
      pages: pageInsights,
      targetUrl: normalizedTarget,
    }),
  };
}
