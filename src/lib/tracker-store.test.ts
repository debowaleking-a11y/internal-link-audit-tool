import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteTrackerPayloads,
  filterTrackerPayloads,
  listTrackerPayloads,
  saveTrackerPayload,
  type TrackerPayload,
} from "@/lib/tracker-store";

function payload(pageUrl: string, site = "example.com", trackerId = "ILA-TEST-12345"): TrackerPayload {
  return {
    trackerId,
    site,
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

test("deleteTrackerPayloads removes matching tracker reports from the saved index", async () => {
  const site = "delete-tracker.example";
  const trackerId = "ILA-DELETE-12345";
  await saveTrackerPayload(payload("https://delete-tracker.example/first", site, trackerId));
  await saveTrackerPayload(payload("https://delete-tracker.example/second", site, trackerId));
  await saveTrackerPayload(payload("https://keep-tracker.example/", "keep-tracker.example", "ILA-KEEP-12345"));

  const deleted = await deleteTrackerPayloads({ site, trackerId });
  const reports = filterTrackerPayloads(await listTrackerPayloads(20), { site, trackerId });
  const keptReports = filterTrackerPayloads(await listTrackerPayloads(20), { site: "keep-tracker.example" });

  assert.equal(deleted, 2);
  assert.equal(reports.length, 0);
  assert.equal(keptReports.length, 1);
});
