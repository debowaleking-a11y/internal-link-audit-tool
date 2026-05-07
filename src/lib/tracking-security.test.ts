import assert from "node:assert/strict";
import test from "node:test";
import { trackerIdForWebsite } from "@/lib/site-id";
import { isBotUserAgent, isValidSiteId, originMatchesPage } from "@/lib/tracking-security";

test("tracker ID is stable and validates against the site hostname", () => {
  const trackerId = trackerIdForWebsite("https://www.vidau.ai/");

  assert.match(trackerId, /^ILA-VIDAU-[A-Z0-9]+$/);
  assert.equal(isValidSiteId("www.vidau.ai", trackerId), true);
  assert.equal(isValidSiteId("vidau.ai", trackerId), true);
  assert.equal(isValidSiteId("www.vidau.ai", "ILA-WRONG-12345"), false);
});

test("tracking origin and bot checks reject unsafe event ingestion", () => {
  assert.equal(originMatchesPage("https://www.vidau.ai", "https://www.vidau.ai/post"), true);
  assert.equal(originMatchesPage("https://evil.example", "https://www.vidau.ai/post"), false);
  assert.equal(isBotUserAgent("Googlebot/2.1"), true);
  assert.equal(isBotUserAgent("Mozilla/5.0 Safari/605.1"), false);
});
