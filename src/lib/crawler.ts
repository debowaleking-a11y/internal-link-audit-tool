import * as cheerio from "cheerio";
import { normalizeUrl, isSameDomain } from "@/lib/url";

export type CrawledPage = {
  url: string;
  title: string;
  statusCode: number | null;
  crawled: boolean;
  error?: string;
  links: CrawledLink[];
};

export type CrawledLink = {
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

type FetchResult = {
  statusCode: number | null;
  html: string;
  contentType: string;
};

async function fetchPage(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "InternalLinkAuditBot/1.0 (+https://localhost)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const html = contentType.includes("text/html") ? await response.text() : "";

  return {
    statusCode: response.status,
    html,
    contentType,
  };
}

async function getStatusCode(url: string) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "user-agent": "InternalLinkAuditBot/1.0 (+https://localhost)",
      },
    });

    return response.status;
  } catch {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": "InternalLinkAuditBot/1.0 (+https://localhost)",
          range: "bytes=0-0",
        },
      });
      return response.status;
    } catch {
      return null;
    }
  }
}

export async function crawlWebsite(input: {
  websiteUrl: string;
  targetUrl: string;
  crawlLimit: number;
}) {
  const websiteUrl = normalizeUrl(input.websiteUrl);
  const normalizedTarget = normalizeUrl(input.targetUrl, websiteUrl);
  const crawlLimit = Math.max(1, Math.min(input.crawlLimit, 250));
  const queue = [websiteUrl];
  const queued = new Set(queue);
  const crawled = new Set<string>();
  const statusCache = new Map<string, number | null>();
  const pages = new Map<string, CrawledPage>();

  while (queue.length > 0 && crawled.size < crawlLimit) {
    const currentUrl = queue.shift();
    if (!currentUrl || crawled.has(currentUrl)) {
      continue;
    }

    crawled.add(currentUrl);

    try {
      const result = await fetchPage(currentUrl);
      statusCache.set(currentUrl, result.statusCode);

      if (!result.html || !result.contentType.includes("text/html")) {
        pages.set(currentUrl, {
          url: currentUrl,
          title: "",
          statusCode: result.statusCode,
          crawled: true,
          links: [],
        });
        continue;
      }

      const $ = cheerio.load(result.html);
      const title = $("title").first().text().replace(/\s+/g, " ").trim();
      const links: CrawledLink[] = [];

      $("a[href]").each((index, element) => {
        const href = $(element).attr("href");
        if (!href) {
          return;
        }

        try {
          const targetUrl = normalizeUrl(href, currentUrl);
          if (!isSameDomain(targetUrl, websiteUrl)) {
            return;
          }

          const rel = ($(element).attr("rel") ?? "").trim();
          const relTokens = rel.toLowerCase().split(/\s+/).filter(Boolean);
          const anchorText = $(element).text().replace(/\s+/g, " ").trim();

          links.push({
            sourceUrl: currentUrl,
            targetUrl,
            anchorText,
            position: index + 1,
            rel,
            follow: !relTokens.includes("nofollow"),
            statusCode: null,
            pageTitle: title,
            isBroken: false,
          });

          if (!queued.has(targetUrl) && !crawled.has(targetUrl) && queue.length + crawled.size < crawlLimit) {
            queued.add(targetUrl);
            queue.push(targetUrl);
          }
        } catch {
          // Ignore malformed hrefs; the UI focuses on crawlable internal links.
        }
      });

      pages.set(currentUrl, {
        url: currentUrl,
        title,
        statusCode: result.statusCode,
        crawled: true,
        links,
      });
    } catch (error) {
      pages.set(currentUrl, {
        url: currentUrl,
        title: "",
        statusCode: null,
        crawled: false,
        error: error instanceof Error ? error.message : "Unable to crawl page.",
        links: [],
      });
    }
  }

  const allLinks = [...pages.values()].flatMap((page) => page.links);
  const uniqueTargets = [...new Set(allLinks.map((link) => link.targetUrl))];

  await Promise.all(
    uniqueTargets.map(async (url) => {
      if (!statusCache.has(url)) {
        statusCache.set(url, await getStatusCode(url));
      }
    }),
  );

  for (const link of allLinks) {
    link.statusCode = statusCache.get(link.targetUrl) ?? null;
    link.isBroken = link.statusCode === null || link.statusCode >= 400;
  }

  for (const targetUrl of uniqueTargets) {
    if (!pages.has(targetUrl)) {
      pages.set(targetUrl, {
        url: targetUrl,
        title: "",
        statusCode: statusCache.get(targetUrl) ?? null,
        crawled: false,
        links: [],
      });
    }
  }

  return {
    websiteUrl,
    targetUrl: normalizedTarget,
    pages: [...pages.values()],
    links: allLinks,
  };
}

export function buildAnchorSuggestions(input: {
  pages: Array<{ url: string; title: string; incomingCount: number; linksToTarget: number }>;
  targetUrl: string;
}) {
  const target = new URL(input.targetUrl);
  const keywords = target.pathname
    .split("/")
    .filter(Boolean)
    .flatMap((part) => part.split("-"))
    .filter((part) => part.length > 2);

  return input.pages
    .filter((page) => page.linksToTarget === 0)
    .map((page) => {
      const haystack = `${page.url} ${page.title}`.toLowerCase();
      const matches = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));

      return {
        url: page.url,
        title: page.title,
        reason:
          matches.length > 0
            ? `Mentions ${matches.slice(0, 3).join(", ")} in the URL or title.`
            : "Crawled page does not currently link to the target.",
        suggestedAnchor: keywords.length > 0 ? keywords.join(" ") : target.hostname,
      };
    })
    .slice(0, 25);
}
