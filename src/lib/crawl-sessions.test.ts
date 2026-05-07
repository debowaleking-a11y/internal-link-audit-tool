import assert from "node:assert/strict";
import test from "node:test";
import { mergeSessionResults } from "@/lib/crawl-sessions";
import type { CrawledLink, CrawledPage } from "@/lib/crawler";

function page(url: string, crawled: boolean): CrawledPage {
  return {
    url,
    title: crawled ? `Title ${url}` : "",
    metaDescription: "",
    canonicalUrl: "",
    robotsMeta: "",
    h1Texts: [],
    h2Texts: [],
    h3Texts: [],
    bodyTextSample: "",
    statusCode: crawled ? 200 : null,
    crawled,
    links: [],
  };
}

function link(sourceUrl: string, targetUrl: string, position: number): CrawledLink {
  return {
    sourceUrl,
    targetUrl,
    anchorText: "Anchor",
    position,
    rel: "",
    follow: true,
    statusCode: 200,
    pageTitle: "Page",
    isBroken: false,
  };
}

test("mergeSessionResults prefers crawled pages and deduplicates links", () => {
  const placeholder = page("https://example.com/a", false);
  const crawled = page("https://example.com/a", true);
  const firstLink = link("https://example.com/a", "https://example.com/b", 1);
  const duplicateLink = link("https://example.com/a", "https://example.com/b", 1);
  const secondLink = link("https://example.com/a", "https://example.com/c", 2);

  const merged = mergeSessionResults([placeholder], [firstLink], [crawled], [duplicateLink, secondLink]);

  assert.equal(merged.pages.length, 1);
  assert.equal(merged.pages[0].crawled, true);
  assert.equal(merged.links.length, 2);
});
