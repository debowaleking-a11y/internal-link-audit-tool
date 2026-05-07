import { summarizeAudit } from "./audit-summary";
import type { CrawledLink, CrawledPage } from "./crawler";

export function buildAuditResponse(input: {
  id: string;
  websiteUrl: string;
  targetUrl: string;
  crawlLimit: number;
  createdAt: string;
  discovery: {
    sitemapUrls: number;
    sitemapsRead: number;
    crawledFromSitemap: number;
    robots?: {
      url: string;
      found: boolean;
      sitemapDeclarations: number;
      hasDisallowRules: boolean;
      error: string | null;
    };
    stoppedEarly?: boolean;
  };
  pages: CrawledPage[];
  links: CrawledLink[];
}) {
  const pages = input.pages
    .sort((first, second) => first.url.localeCompare(second.url))
    .map((page, index) => ({
      id: `page-${index + 1}`,
      url: page.url,
      title: page.title,
      metaDescription: page.metaDescription,
      canonicalUrl: page.canonicalUrl,
      robotsMeta: page.robotsMeta,
      h1Texts: page.h1Texts,
      h2Texts: page.h2Texts,
      h3Texts: page.h3Texts,
      bodyTextSample: page.bodyTextSample,
      statusCode: page.statusCode,
      crawled: page.crawled,
      error: page.error ?? null,
    }));

  const links = input.links
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

  return {
    audit: {
      id: input.id,
      websiteUrl: input.websiteUrl,
      targetUrl: input.targetUrl,
      crawlLimit: input.crawlLimit,
      status: "completed",
      error: null,
      createdAt: input.createdAt,
      discovery: input.discovery,
      links,
    },
    summary: summarizeAudit(pages, links, input.targetUrl),
  };
}
