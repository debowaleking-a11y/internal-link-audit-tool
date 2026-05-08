import assert from "node:assert/strict";
import test from "node:test";
import { listTrackerPayloads, saveTrackerPayload, type TrackerPayload } from "@/lib/tracker-store";

function payload(pageUrl: string): TrackerPayload {
  return {
    trackerId: "ILA-TEST-12345",
    site: "example.com",
    eventType: "page_view",
    pageUrl,
    pageTitle: "Example",
    metaDescription: "",
    canonicalUrl: pageUrl,
    headings: { h1: [], h2: [], h3: [] },
    referrer: "",
    utm: {},
    deviceType: "desktop",
    pageLoadTiming: { domContentLoadedMs: 1, loadCompleteMs: 2 },
    scrollDepth: 0,
    links: [],
    receivedAt: new Date().toISOString(),
  };
}

test("tracker payloads are listed from the saved tracker index", async () => {
  const firstKey = await saveTrackerPayload(payload("https://example.com/first"));
  const secondKey = await saveTrackerPayload(payload("https://example.com/second"));

  const reports = await listTrackerPayloads(2);

  assert.equal(reports.length, 2);
  assert.equal(reports[0].key, secondKey);
  assert.equal(reports[1].key, firstKey);
});

