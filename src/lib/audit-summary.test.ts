import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAudit } from "@/lib/audit-summary";

const pageBase = {
  statusCode: 200,
  crawled: true,
  error: null,
  canonicalUrl: "",
  robotsMeta: "",
  h2Texts: [],
  h3Texts: [],
  bodyTextSample: "",
};

test("summarizeAudit reports core SEO page issues", () => {
  const summary = summarizeAudit(
    [
      {
        ...pageBase,
        id: "page-1",
        url: "https://example.com",
        title: "",
        metaDescription: "",
        h1Texts: [],
      },
      {
        ...pageBase,
        id: "page-2",
        url: "https://example.com/video",
        title: "Video page",
        metaDescription: "Duplicate",
        canonicalUrl: "https://example.com/canonical",
        h1Texts: ["Video", "Generator"],
      },
      {
        ...pageBase,
        id: "page-3",
        url: "https://example.com/ai-video-generator",
        title: "Target",
        metaDescription: "Duplicate",
        h1Texts: ["Target"],
      },
    ],
    [
      {
        id: "link-1",
        sourceUrl: "https://example.com/video",
        targetUrl: "https://example.com/ai-video-generator",
        anchorText: "AI video generator",
        position: 1,
        rel: "nofollow",
        follow: false,
        statusCode: 200,
        pageTitle: "Video page",
        isBroken: false,
      },
    ],
    "https://example.com/ai-video-generator",
  );

  assert.equal(summary.counts.missingTitles, 1);
  assert.equal(summary.counts.missingMetaDescriptions, 1);
  assert.equal(summary.counts.duplicateMetaDescriptions, 2);
  assert.equal(summary.counts.missingH1, 1);
  assert.equal(summary.counts.multipleH1, 1);
  assert.equal(summary.counts.canonicalMismatches, 1);
  assert.equal(summary.counts.nofollowInternalLinks, 1);
  assert.equal(summary.counts.linksToTarget, 1);
});
