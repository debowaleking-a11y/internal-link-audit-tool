export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const script = `
(function () {
  if (window.__internalLinkAuditInstalled) return;
  window.__internalLinkAuditInstalled = true;

  var endpoint = ${JSON.stringify(`${origin}/api/track`)};
  var site = location.hostname;

  function cleanText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function areaFor(link) {
    if (link.closest("header")) return "header";
    if (link.closest("footer")) return "footer";
    if (link.closest("nav")) return "nav";
    if (link.closest("aside")) return "aside";
    if (link.closest("main")) return "main";
    return "body";
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
      site: site,
      pageUrl: location.href,
      pageTitle: document.title || "",
      referrer: document.referrer || "",
      links: internalLinks()
    }, extra || {});

    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
      return;
    }

    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body,
      keepalive: true
    }).catch(function () {});
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
      if (url.hostname !== location.hostname) return;
      send({
        clickedUrl: url.toString(),
        clickedAnchorText: cleanText(link.textContent || link.getAttribute("aria-label") || link.title)
      });
    } catch (_) {}
  }, true);
})();`.trim();

  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
