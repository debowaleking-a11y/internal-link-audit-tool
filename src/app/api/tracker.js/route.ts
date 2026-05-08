export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const trackerOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || requestUrl.origin;
  const trackerId = requestUrl.searchParams.get("id")?.trim().toUpperCase() || "ILA-DEMO";
  const script = `
(function () {
  if (window.__internalLinkAuditInstalled) return;
  window.__internalLinkAuditInstalled = true;

  var endpoint = ${JSON.stringify(`${trackerOrigin}/api/track`)};
  var trackerId = ${JSON.stringify(trackerId)};
  var site = location.hostname;
  var maxScrollDepth = 0;
  var scrollTimer = null;

  function cleanText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function logTrackingFailure(message, details) {
    if (!window.console || !console.warn) return;
    console.warn("[Internal Link Audit]", message, details || "");
  }

  function areaFor(link) {
    if (link.closest("header")) return "header";
    if (link.closest("footer")) return "footer";
    if (link.closest("nav")) return "nav";
    if (link.closest("aside")) return "aside";
    if (link.closest("main")) return "main";
    return "body";
  }

  function meta(name) {
    var node = document.querySelector('meta[name="' + name + '"]');
    return node ? cleanText(node.getAttribute("content")) : "";
  }

  function canonicalUrl() {
    var node = document.querySelector('link[rel~="canonical"]');
    try {
      return node ? new URL(node.getAttribute("href") || "", location.href).toString() : "";
    } catch (_) {
      return "";
    }
  }

  function headingTexts(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector))
      .map(function (heading) { return cleanText(heading.textContent); })
      .filter(Boolean)
      .slice(0, 30);
  }

  function utmParams() {
    var params = new URLSearchParams(location.search);
    var output = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(function (key) {
      var value = params.get(key);
      if (value) output[key] = cleanText(value).slice(0, 160);
    });
    return output;
  }

  function deviceType() {
    var width = window.innerWidth || document.documentElement.clientWidth || 0;
    if (width < 768) return "mobile";
    if (width < 1100) return "tablet";
    return "desktop";
  }

  function pageTiming() {
    var timing = performance && performance.timing ? performance.timing : null;
    if (!timing || !timing.navigationStart) {
      return { domContentLoadedMs: null, loadCompleteMs: null };
    }
    return {
      domContentLoadedMs: timing.domContentLoadedEventEnd ? Math.max(0, timing.domContentLoadedEventEnd - timing.navigationStart) : null,
      loadCompleteMs: timing.loadEventEnd ? Math.max(0, timing.loadEventEnd - timing.navigationStart) : null
    };
  }

  function internalLinks() {
    return Array.prototype.slice.call(document.links)
      .filter(function (link) {
        try {
          return new URL(link.href, location.href).hostname === location.hostname;
        } catch (_) {
          return false;
        }
      })
      .map(function (link, index) {
        var rel = link.getAttribute("rel") || "";
        return {
          targetUrl: new URL(link.href, location.href).toString(),
          anchorText: cleanText(link.textContent || link.getAttribute("aria-label") || link.title),
          position: index + 1,
          rel: rel,
          follow: rel.toLowerCase().split(/\\s+/).indexOf("nofollow") === -1,
          area: areaFor(link)
        };
      });
  }

  function send(extra) {
    var payload = Object.assign({
      trackerId: trackerId,
      site: site,
      eventType: "page_view",
      pageUrl: location.href,
      pageTitle: document.title || "",
      metaDescription: meta("description"),
      canonicalUrl: canonicalUrl(),
      headings: {
        h1: headingTexts("h1"),
        h2: headingTexts("h2"),
        h3: headingTexts("h3")
      },
      referrer: document.referrer || "",
      utm: utmParams(),
      deviceType: deviceType(),
      pageLoadTiming: pageTiming(),
      scrollDepth: maxScrollDepth,
      links: internalLinks()
    }, extra || {});

    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      var queued = navigator.sendBeacon(endpoint, blob);
      if (!queued) {
        logTrackingFailure("sendBeacon could not queue tracking event.", {
          endpoint: endpoint,
          trackerId: trackerId,
          eventType: payload.eventType,
          pageUrl: payload.pageUrl
        });
      }
      return;
    }

    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: body,
      keepalive: true
    }).then(function (response) {
      if (!response.ok) {
        logTrackingFailure("Tracking request failed.", {
          endpoint: endpoint,
          status: response.status,
          trackerId: trackerId,
          eventType: payload.eventType,
          pageUrl: payload.pageUrl
        });
      }
    }).catch(function (error) {
      logTrackingFailure("Tracking request errored.", {
        endpoint: endpoint,
        trackerId: trackerId,
        eventType: payload.eventType,
        pageUrl: payload.pageUrl,
        error: error && error.message ? error.message : error
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { send(); });
  } else {
    send();
  }

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    try {
      var url = new URL(link.href, location.href);
      send({
        eventType: url.hostname === location.hostname ? "internal_click" : "external_click",
        clickedUrl: url.toString(),
        clickedAnchorText: cleanText(link.textContent || link.getAttribute("aria-label") || link.title),
        clickedExternal: url.hostname !== location.hostname
      });
    } catch (_) {}
  }, true);

  window.addEventListener("scroll", function () {
    var scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    maxScrollDepth = Math.max(maxScrollDepth, Math.min(100, Math.round((window.scrollY / scrollable) * 100)));
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(function () {
      send({ eventType: "scroll", links: [] });
    }, 1200);
  }, { passive: true });
})();`.trim();

  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}
