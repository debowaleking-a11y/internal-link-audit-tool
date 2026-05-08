import * as cheerio from "cheerio";
import { normalizeUrl, isSameDomain } from "./url";

export type CrawledPage = {
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

function timeoutSignal(ms: number) {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

async function fetchPageInner(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: timeoutSignal(6000),
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

async function fetchPage(url: string): Promise<FetchResult> {
  return withTimeout(fetchPageInner(url), 9000, `Timed out while crawling ${url}.`);
}

async function fetchTextInner(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: timeoutSignal(5000),
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

async function fetchText(url: string) {
  return withTimeout(fetchTextInner(url), 7000, `Timed out while reading ${url}.`);
}

async function findSitemapLocations(websiteUrl: string) {
  const website = new URL(websiteUrl);
  const candidates = new Set<string>();
  const robotsUrl = `${website.origin}/robots.txt`;
  let robotsFound = false;
  let robotsText = "";
  let robotsError = "";

  candidates.add(normalizeUrl("/sitemap.xml", websiteUrl));

  try {
    const robots = await fetchText(robotsUrl);
    robotsText = robots;
    robotsFound = Boolean(robots);

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
  } catch (error) {
    robotsError = error instanceof Error ? error.message : "Unable to read robots.txt.";
    // robots.txt is optional; fall back to the default sitemap location.
  }

  return {
    sitemapLocations: [...candidates],
    robots: {
      url: robotsUrl,
      found: robotsFound,
      sitemapDeclarations: [...candidates].length - 1,
      hasDisallowRules: /^\s*disallow:\s*\S+/im.test(robotsText),
      error: robotsError || null,
    },
  };
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
  const sitemapSearch = await findSitemapLocations(websiteUrl);
  const visitedSitemaps = new Set<string>();
  const discovered = new Set<string>();

  for (const sitemapUrl of sitemapSearch.sitemapLocations) {
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
    robots: sitemapSearch.robots,
  };
}

export async function discoverWebsiteUrls(websiteUrl: string, limit: number) {
  const normalizedWebsiteUrl = normalizeUrl(websiteUrl);
  const sitemapDiscovery = await discoverSitemapUrls(normalizedWebsiteUrl, Math.max(1, limit - 1));
  const urls = [
    normalizedWebsiteUrl,
    ...sitemapDiscovery.urls.filter((url) => url !== normalizedWebsiteUrl),
  ].slice(0, limit);

  return {
    urls,
    discovery: {
      sitemapUrls: sitemapDiscovery.urls.length,
      sitemapsRead: sitemapDiscovery.sitemapCount,
      crawledFromSitemap: 0,
      robots: sitemapDiscovery.robots,
      stoppedEarly: sitemapDiscovery.urls.length + 1 > urls.length,
    },
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
      signal: timeoutSignal(2500),
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
        signal: timeoutSignal(2500),
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
  maxCrawlLimit?: number;
  maxDurationMs?: number;
  seedUrls?: string[];
  enqueueDiscoveredLinks?: boolean;
  onProgress?: (progress: { crawledPages: number; queuedPages: number; currentUrl: string }) => Promise<void> | void;
  onPage?: (page: CrawledPage) => Promise<void> | void;
}) {
  const websiteUrl = normalizeUrl(input.websiteUrl);
  const normalizedTarget = normalizeUrl(input.targetUrl, websiteUrl);
  const crawlLimit = Math.max(1, Math.min(input.crawlLimit, input.maxCrawlLimit ?? 250));
  const deadline = Date.now() + (input.maxDurationMs ?? 9000);
  const hasTime = (paddingMs = 0) => Date.now() + paddingMs < deadline;
  const explicitSeeds = input.seedUrls?.flatMap((url, index) => {
    try {
      const normalized = normalizeUrl(url, websiteUrl);
      return isSameDomain(normalized, websiteUrl)
        ? [{ url: normalized, source: index === 0 && normalized === websiteUrl ? "homepage" : "sitemap" } satisfies CrawlSeed]
        : [];
    } catch {
      return [];
    }
  });
  const sitemapDiscovery = explicitSeeds
    ? {
        urls: explicitSeeds.map((seed) => seed.url).filter((url) => url !== websiteUrl),
        sitemapCount: 0,
        robots: undefined,
      }
    : await discoverSitemapUrls(websiteUrl, crawlLimit);
  const seeds: CrawlSeed[] = explicitSeeds ?? [
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

  let stoppedEarly = false;

  while (queue.length > 0 && crawled.size < crawlLimit && hasTime(1500)) {
    const currentSeed = queue.shift();
    if (!currentSeed || crawled.has(currentSeed.url)) {
      continue;
    }

    const currentUrl = currentSeed.url;
    crawled.add(currentUrl);
    await input.onProgress?.({
      crawledPages: crawled.size,
      queuedPages: queue.length,
      currentUrl,
    });

    try {
      const result = await fetchPage(currentUrl);
      statusCache.set(currentUrl, result.statusCode);

      if (!result.html || !result.contentType.includes("text/html")) {
        const page = {
          url: currentUrl,
          title: "",
          metaDescription: "",
          canonicalUrl: "",
          robotsMeta: "",
          h1Texts: [],
          h2Texts: [],
          h3Texts: [],
          bodyTextSample: "",
          statusCode: result.statusCode,
          crawled: true,
          links: [],
        };
        pages.set(currentUrl, page);
        await input.onPage?.(page);
        continue;
      }

      const $ = cheerio.load(result.html);
      const title = $("title").first().text().replace(/\s+/g, " ").trim();
      const metaDescription = $('meta[name="description"]').first().attr("content")?.replace(/\s+/g, " ").trim() ?? "";
      const canonicalHref = $('link[rel~="canonical"]').first().attr("href") ?? "";
      let canonicalUrl = "";
      try {
        canonicalUrl = canonicalHref ? normalizeUrl(canonicalHref, currentUrl) : "";
      } catch {
        canonicalUrl = "";
      }
      const robotsMeta = $('meta[name="robots"]').first().attr("content")?.replace(/\s+/g, " ").trim() ?? "";
      const h1Texts = $("h1").map((_, element) => $(element).text().replace(/\s+/g, " ").trim()).get().filter(Boolean);
      const h2Texts = $("h2").map((_, element) => $(element).text().replace(/\s+/g, " ").trim()).get().filter(Boolean);
      const h3Texts = $("h3").map((_, element) => $(element).text().replace(/\s+/g, " ").trim()).get().filter(Boolean);
      const bodyTextSample = $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000);
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

          if (
            input.enqueueDiscoveredLinks !== false
            && !queued.has(targetUrl)
            && !crawled.has(targetUrl)
            && queue.length + crawled.size < crawlLimit
          ) {
            queued.add(targetUrl);
            queue.push({ url: targetUrl, source: "link" });
          }
        } catch {
          // Ignore malformed hrefs; the UI focuses on crawlable internal links.
        }
      });

      const page = {
        url: currentUrl,
        title,
        metaDescription,
        canonicalUrl,
        robotsMeta,
        h1Texts,
        h2Texts,
        h3Texts,
        bodyTextSample,
        statusCode: result.statusCode,
        crawled: true,
        links,
      };
      pages.set(currentUrl, page);
      await input.onPage?.(page);
    } catch (error) {
      const page = {
        url: currentUrl,
        title: "",
        metaDescription: "",
        canonicalUrl: "",
        robotsMeta: "",
        h1Texts: [],
        h2Texts: [],
        h3Texts: [],
        bodyTextSample: "",
        statusCode: null,
        crawled: false,
        error: error instanceof Error ? error.message : "Unable to crawl page.",
        links: [],
      };
      pages.set(currentUrl, page);
      await input.onPage?.(page);
    }
  }

  if (queue.length > 0 && crawled.size < crawlLimit) {
    stoppedEarly = true;
  }

  const allLinks = [...pages.values()].flatMap((page) => page.links);
  const uniqueTargets = [...new Set(allLinks.map((link) => link.targetUrl))];
  const knownPageTargets = new Set([...pages.keys()]);
  const statusTargets = uniqueTargets
    .filter((url) => !statusCache.has(url) && knownPageTargets.has(url))
    .slice(0, 40);

  if (hasTime(1500)) {
    await mapWithConcurrency(statusTargets, 6, async (url) => {
      statusCache.set(url, await getStatusCode(url));
    });
  }

  for (const link of allLinks) {
    link.statusCode = statusCache.get(link.targetUrl) ?? null;
    link.isBroken = link.statusCode !== null && link.statusCode >= 400;
  }

  for (const targetUrl of uniqueTargets) {
    if (!pages.has(targetUrl)) {
      pages.set(targetUrl, {
        url: targetUrl,
        title: "",
        metaDescription: "",
        canonicalUrl: "",
        robotsMeta: "",
        h1Texts: [],
        h2Texts: [],
        h3Texts: [],
        bodyTextSample: "",
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
      robots: sitemapDiscovery.robots,
      stoppedEarly,
    },
  };
}

export function buildAnchorSuggestions(input: {
  pages: Array<{
    url: string;
    title: string;
    incomingCount: number;
    linksToTarget: number;
    h1Texts?: string[];
    h2Texts?: string[];
    h3Texts?: string[];
    bodyTextSample?: string;
  }>;
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
      const headingText = [...(page.h1Texts ?? []), ...(page.h2Texts ?? []), ...(page.h3Texts ?? [])].join(" ");
      const haystack = `${page.url} ${page.title} ${headingText} ${page.bodyTextSample ?? ""}`.toLowerCase();
      const matches = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
      const reasons = [
        page.title && keywords.some((keyword) => page.title.toLowerCase().includes(keyword.toLowerCase()))
          ? "matching keyword in title"
          : "",
        headingText && keywords.some((keyword) => headingText.toLowerCase().includes(keyword.toLowerCase()))
          ? "matching keyword in headings"
          : "",
        page.bodyTextSample && keywords.some((keyword) => page.bodyTextSample?.toLowerCase().includes(keyword.toLowerCase()))
          ? "matching keyword in body text"
          : "",
        page.incomingCount >= 3 ? "high incoming internal link count" : "",
      ].filter(Boolean);

      return {
        url: page.url,
        title: page.title,
        reason:
          reasons.length > 0
            ? `${reasons.join(", ")}. Matched: ${matches.slice(0, 3).join(", ")}.`
            : "Crawled page does not currently link to the target.",
        suggestedAnchor: keywords.length > 0 ? keywords.join(" ") : target.hostname,
        score: reasons.length * 10 + page.incomingCount,
      };
    })
    .sort((first, second) => second.score - first.score)
    .map((suggestion) => ({
      url: suggestion.url,
      title: suggestion.title,
      reason: suggestion.reason,
      suggestedAnchor: suggestion.suggestedAnchor,
    }))
    .slice(0, 25);
}
