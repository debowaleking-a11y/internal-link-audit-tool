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

type CrawlSeed = {
  url: string;
  source: "homepage" | "sitemap" | "link";
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

async function fetchText(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "InternalLinkAuditBot/1.0 (+https://localhost)",
      accept: "application/xml,text/xml,text/plain,*/*",
    },
  });

  if (!response.ok) {
    return "";
  }

  return response.text();
}

async function findSitemapLocations(websiteUrl: string) {
  const website = new URL(websiteUrl);
  const candidates = new Set<string>();

  candidates.add(normalizeUrl("/sitemap.xml", websiteUrl));

  try {
    const robotsUrl = `${website.origin}/robots.txt`;
    const robots = await fetchText(robotsUrl);

    for (const line of robots.split(/\r?\n/)) {
      const match = line.match(/^\s*sitemap:\s*(.+)\s*$/i);
      if (!match) {
        continue;
      }

      try {
        const sitemapUrl = normalizeUrl(match[1].trim(), websiteUrl);
        if (isSameDomain(sitemapUrl, websiteUrl)) {
          candidates.add(sitemapUrl);
        }
      } catch {
        // Ignore malformed sitemap declarations.
      }
    }
  } catch {
    // robots.txt is optional; fall back to the default sitemap location.
  }

  return [...candidates];
}

async function readSitemapUrls(input: {
  sitemapUrl: string;
  websiteUrl: string;
  limit: number;
  visitedSitemaps: Set<string>;
}) {
  if (input.visitedSitemaps.has(input.sitemapUrl) || input.visitedSitemaps.size >= 10) {
    return [];
  }

  input.visitedSitemaps.add(input.sitemapUrl);

  try {
    const xml = await fetchText(input.sitemapUrl);
    if (!xml) {
      return [];
    }

    const $ = cheerio.load(xml, { xmlMode: true });
    const sitemapEntries = $("sitemap > loc")
      .map((_, element) => $(element).text().trim())
      .get();

    if (sitemapEntries.length > 0) {
      const urls: string[] = [];

      for (const sitemapEntry of sitemapEntries) {
        if (urls.length >= input.limit) {
          break;
        }

        try {
          const childSitemapUrl = normalizeUrl(sitemapEntry, input.websiteUrl);
          if (!isSameDomain(childSitemapUrl, input.websiteUrl)) {
            continue;
          }

          const childUrls = await readSitemapUrls({
            sitemapUrl: childSitemapUrl,
            websiteUrl: input.websiteUrl,
            limit: input.limit - urls.length,
            visitedSitemaps: input.visitedSitemaps,
          });
          urls.push(...childUrls);
        } catch {
          // Ignore malformed child sitemap URLs.
        }
      }

      return urls;
    }

    return $("url > loc")
      .map((_, element) => $(element).text().trim())
      .get()
      .flatMap((url) => {
        try {
          const normalized = normalizeUrl(url, input.websiteUrl);
          return isSameDomain(normalized, input.websiteUrl) ? [normalized] : [];
        } catch {
          return [];
        }
      })
      .slice(0, input.limit);
  } catch {
    return [];
  }
}

async function discoverSitemapUrls(websiteUrl: string, limit: number) {
  const sitemapLocations = await findSitemapLocations(websiteUrl);
  const visitedSitemaps = new Set<string>();
  const discovered = new Set<string>();

  for (const sitemapUrl of sitemapLocations) {
    if (discovered.size >= limit) {
      break;
    }

    const urls = await readSitemapUrls({
      sitemapUrl,
      websiteUrl,
      limit: limit - discovered.size,
      visitedSitemaps,
    });

    for (const url of urls) {
      discovered.add(url);
    }
  }

  return {
    urls: [...discovered],
    sitemapCount: visitedSitemaps.size,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );

  return results;
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
  const sitemapDiscovery = await discoverSitemapUrls(websiteUrl, crawlLimit);
  const seeds: CrawlSeed[] = [
    { url: websiteUrl, source: "homepage" },
    ...sitemapDiscovery.urls
      .filter((url) => url !== websiteUrl)
      .map((url) => ({ url, source: "sitemap" }) satisfies CrawlSeed),
  ];
  const queue = seeds.slice(0, crawlLimit);
  const queued = new Set(queue.map((seed) => seed.url));
  const crawled = new Set<string>();
  const statusCache = new Map<string, number | null>();
  const pages = new Map<string, CrawledPage>();

  while (queue.length > 0 && crawled.size < crawlLimit) {
    const currentSeed = queue.shift();
    if (!currentSeed || crawled.has(currentSeed.url)) {
      continue;
    }

    const currentUrl = currentSeed.url;
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
            queue.push({ url: targetUrl, source: "link" });
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

  await mapWithConcurrency(uniqueTargets, 8, async (url) => {
    if (!statusCache.has(url)) {
      statusCache.set(url, await getStatusCode(url));
    }
  });

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

  const sitemapUrlSet = new Set(sitemapDiscovery.urls);

  return {
    websiteUrl,
    targetUrl: normalizedTarget,
    pages: [...pages.values()],
    links: allLinks,
    discovery: {
      sitemapUrls: sitemapDiscovery.urls.length,
      sitemapsRead: sitemapDiscovery.sitemapCount,
      crawledFromSitemap: [...crawled].filter((url) => sitemapUrlSet.has(url)).length,
    },
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
