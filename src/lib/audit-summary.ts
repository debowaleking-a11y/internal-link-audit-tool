import { buildAnchorSuggestions } from "./crawler";

type PageLike = {
  id: string;
  url: string;
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  robotsMeta: string;
  h1Texts: string[];
  h2Texts: string[];
  h3Texts: string[];
  bodyTextSample: string;
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
      missingTitle: page.crawled && page.title.length === 0,
      missingMetaDescription: page.crawled && page.metaDescription.length === 0,
      missingH1: page.crawled && page.h1Texts.length === 0,
      multipleH1: page.crawled && page.h1Texts.length > 1,
      canonicalMismatch: page.crawled && Boolean(page.canonicalUrl) && page.canonicalUrl !== page.url,
      noindex: /\bnoindex\b/i.test(page.robotsMeta),
    }));
  const duplicateTitles = duplicateValues(pageInsights.map((page) => page.title).filter(Boolean));
  const duplicateMetaDescriptions = duplicateValues(pageInsights.map((page) => page.metaDescription).filter(Boolean));
  const enrichedPageInsights = pageInsights.map((page) => ({
    ...page,
    duplicateTitle: Boolean(page.title && duplicateTitles.has(page.title)),
    duplicateMetaDescription: Boolean(page.metaDescription && duplicateMetaDescriptions.has(page.metaDescription)),
    issueTypes: [
      page.missingTitle ? "missing_title" : "",
      page.title && duplicateTitles.has(page.title) ? "duplicate_title" : "",
      page.missingMetaDescription ? "missing_meta_description" : "",
      page.metaDescription && duplicateMetaDescriptions.has(page.metaDescription) ? "duplicate_meta_description" : "",
      page.missingH1 ? "missing_h1" : "",
      page.multipleH1 ? "multiple_h1" : "",
      page.canonicalMismatch ? "canonical_mismatch" : "",
      page.noindex ? "noindex" : "",
      page.isOrphan ? "orphan_page" : "",
      page.hasTooFewInternalLinks ? "low_internal_links" : "",
    ].filter(Boolean),
  }));
  const issueCount = enrichedPageInsights.reduce((total, page) => total + page.issueTypes.length, 0);
  const maxIssueCount = Math.max(1, enrichedPageInsights.length * 5);
  const seoHealthScore = Math.max(0, Math.round(100 - (issueCount / maxIssueCount) * 100));

  return {
    counts: {
      pages: pages.length,
      crawledPages: pages.filter((page) => page.crawled).length,
      links: links.length,
      brokenLinks: links.filter((link) => link.isBroken).length,
      nofollowInternalLinks: links.filter((link) => !link.follow).length,
      orphanPages: enrichedPageInsights.filter((page) => page.isOrphan).length,
      lowLinkPages: enrichedPageInsights.filter((page) => page.hasTooFewInternalLinks).length,
      linksToTarget: links.filter((link) => link.targetUrl === normalizedTarget).length,
      missingTitles: enrichedPageInsights.filter((page) => page.missingTitle).length,
      duplicateTitles: enrichedPageInsights.filter((page) => page.duplicateTitle).length,
      missingMetaDescriptions: enrichedPageInsights.filter((page) => page.missingMetaDescription).length,
      duplicateMetaDescriptions: enrichedPageInsights.filter((page) => page.duplicateMetaDescription).length,
      missingH1: enrichedPageInsights.filter((page) => page.missingH1).length,
      multipleH1: enrichedPageInsights.filter((page) => page.multipleH1).length,
      canonicalMismatches: enrichedPageInsights.filter((page) => page.canonicalMismatch).length,
      noindexPages: enrichedPageInsights.filter((page) => page.noindex).length,
      seoHealthScore,
    },
    pages: enrichedPageInsights,
    suggestions: buildAnchorSuggestions({
      pages: enrichedPageInsights,
      targetUrl: normalizedTarget,
    }),
  };
}

function duplicateValues(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}
