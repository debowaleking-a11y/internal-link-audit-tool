"use client";

import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import styles from "./page.module.css";

type LinkRow = {
  id: string;
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

type PageInsight = {
  id: string;
  url: string;
  title: string;
  statusCode: number | null;
  crawled: boolean;
  error: string | null;
  incomingCount: number;
  outgoingCount: number;
  linksToTarget: number;
  isOrphan: boolean;
  hasTooFewInternalLinks: boolean;
};

type AuditResponse = {
  audit: {
    id: string;
    websiteUrl: string;
    targetUrl: string;
    crawlLimit: number;
    status: string;
    error: string | null;
    createdAt: string;
    discovery?: {
      sitemapUrls: number;
      sitemapsRead: number;
      crawledFromSitemap: number;
      stoppedEarly?: boolean;
    };
    links: LinkRow[];
  };
  summary: {
    counts: {
      pages: number;
      crawledPages: number;
      links: number;
      brokenLinks: number;
      orphanPages: number;
      lowLinkPages: number;
      linksToTarget: number;
    };
    pages: PageInsight[];
    suggestions: Array<{
      url: string;
      title: string;
      reason: string;
      suggestedAnchor: string;
    }>;
  };
};

type TrackerLink = {
  targetUrl: string;
  anchorText: string;
  position: number;
  rel: string;
  follow: boolean;
  area: string;
};

type TrackerSummary = {
  counts: {
    reports: number;
    pages: number;
    links: number;
    clicks: number;
  };
  pages: Array<{
    site: string;
    pageUrl: string;
    pageTitle: string;
    links: TrackerLink[];
    reportCount: number;
    lastSeen: string;
  }>;
  links: Array<{
    pageUrl: string;
    pageTitle: string;
  } & TrackerLink>;
};

type InboundTrackerResult = {
  targetUrl: string;
  counts: {
    sourcePages: number;
    matchingLinks: number;
  };
  sources: Array<{
    pageUrl: string;
    pageTitle: string;
    site: string;
    lastSeen: string;
    reportCount: number;
    links: TrackerLink[];
  }>;
};

type TrackerConnection = {
  trackerId: string | null;
  site: string | null;
  connected: boolean;
  lastSeen: string | null;
  pagesSeen: number;
  reportsSeen: number;
};

type FilterMode = "target" | "all" | "broken" | "nofollow";
type PageFilterMode = "orphans" | "low-links";

const defaultWebsite = "https://www.vidau.ai/";
const defaultTarget = "https://www.vidau.ai/ai-video-generator/";
const trackerScriptUrl = "https://internal-link-audit-tool.netlify.app/api/tracker.js";

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function trackerIdForWebsite(value: string) {
  const hostname = hostnameFromUrl(value) || "your-website";
  let hash = 0;

  for (let index = 0; index < hostname.length; index += 1) {
    hash = (hash * 31 + hostname.charCodeAt(index)) >>> 0;
  }

  const label = hostname
    .replace(/^www\./, "")
    .split(".")[0]
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase() || "SITE";

  return `ILA-${label}-${hash.toString(36).toUpperCase().slice(0, 5)}`;
}

function trackerScriptWithId(trackerId: string) {
  return `${trackerScriptUrl}?id=${encodeURIComponent(trackerId)}`;
}

function headerSnippetFor(trackerId: string) {
  return `<script async src="${trackerScriptWithId(trackerId)}"></script>`;
}

function footerSnippetFor(trackerId: string) {
  return `<script>
  window.addEventListener("load", function () {
    var s = document.createElement("script");
    s.src = "${trackerScriptWithId(trackerId)}";
    s.async = true;
    document.body.appendChild(s);
  });
</script>`;
}

function csvCell(value: string | number | boolean | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(audit: AuditResponse["audit"]) {
  const header = [
    "source_page",
    "target_page",
    "anchor_text",
    "link_position",
    "status_code",
    "follow",
    "rel",
    "page_title",
    "broken",
  ];
  const rows = audit.links.map((link) => [
    link.sourceUrl,
    link.targetUrl,
    link.anchorText,
    link.position,
    link.statusCode,
    link.follow ? "follow" : "nofollow",
    link.rel,
    link.pageTitle,
    link.isBroken,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `internal-link-audit-${audit.id}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [websiteUrl, setWebsiteUrl] = useState(defaultWebsite);
  const [targetUrl, setTargetUrl] = useState(defaultTarget);
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [anchorFilter, setAnchorFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState(defaultTarget);
  const [trackerTargetUrl, setTrackerTargetUrl] = useState(defaultTarget);
  const [mode, setMode] = useState<FilterMode>("target");
  const [pageMode, setPageMode] = useState<PageFilterMode>("orphans");
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [trackerSummary, setTrackerSummary] = useState<TrackerSummary | null>(null);
  const [trackerConnection, setTrackerConnection] = useState<TrackerConnection | null>(null);
  const [inboundTracker, setInboundTracker] = useState<InboundTrackerResult | null>(null);
  const [trackerStatus, setTrackerStatus] = useState("");
  const [copiedSnippet, setCopiedSnippet] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ websiteUrl, targetUrl, crawlLimit }),
      });
      const responseText = await response.text();
      const data = responseText ? JSON.parse(responseText) : {};

      if (!response.ok) {
        throw new Error(data.error ?? `Audit failed with status ${response.status}.`);
      }

      setResult(data);
      setTargetFilter(data.audit.targetUrl);
      setTrackerTargetUrl(data.audit.targetUrl);
      setMode("target");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Audit failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function copySnippet(snippet: string, label: string) {
    await navigator.clipboard.writeText(snippet);
    setCopiedSnippet(`${label} snippet copied`);
  }

  async function loadTrackerReports() {
    setTrackerStatus("Loading live reports...");

    try {
      const params = new URLSearchParams({
        limit: "100",
        targetUrl: trackerTargetUrl,
        trackerId,
      });

      if (siteHostname) {
        params.set("site", siteHostname);
      }

      const response = await fetch(`/api/track/reports?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load tracker reports.");
      }

      setTrackerSummary(data.summary);
      setTrackerConnection(data.connection);
      setInboundTracker(data.inbound);
      setTrackerStatus(
        data.connection?.connected
          ? `Connected. Last signal: ${new Date(data.connection.lastSeen).toLocaleString()}.`
          : "Waiting for this website to load the snippet.",
      );
    } catch (reportError) {
      setTrackerStatus(reportError instanceof Error ? reportError.message : "Could not load tracker reports.");
    }
  }

  const filteredLinks = useMemo(() => {
    const links = result?.audit.links ?? [];
    const normalizedTargetFilter = targetFilter.trim().toLowerCase();
    const normalizedAnchorFilter = anchorFilter.trim().toLowerCase();

    return links.filter((link) => {
      if (mode === "target" && normalizedTargetFilter && !link.targetUrl.toLowerCase().includes(normalizedTargetFilter)) {
        return false;
      }

      if (mode === "broken" && !link.isBroken) {
        return false;
      }

      if (mode === "nofollow" && link.follow) {
        return false;
      }

      if (normalizedAnchorFilter && !link.anchorText.toLowerCase().includes(normalizedAnchorFilter)) {
        return false;
      }

      return true;
    });
  }, [anchorFilter, mode, result, targetFilter]);

  const filteredPages = useMemo(() => {
    const pages = result?.summary.pages ?? [];
    return pages.filter((page) => (pageMode === "orphans" ? page.isOrphan : page.hasTooFewInternalLinks));
  }, [pageMode, result]);

  const inboundSources = inboundTracker?.sources ?? [];
  const crawlCounts = result?.summary.counts;
  const trackerCounts = trackerSummary?.counts;
  const siteHostname = hostnameFromUrl(websiteUrl);
  const trackerId = trackerIdForWebsite(websiteUrl);
  const headerSnippet = headerSnippetFor(trackerId);
  const footerSnippet = footerSnippetFor(trackerId);
  const isConnected = trackerConnection?.connected ?? false;

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>IL</span>
          <div>
            <strong>LinkIntel</strong>
            <small>Internal Link Audit</small>
          </div>
        </div>
        <nav className={styles.nav}>
          <a href="#overview" className={styles.navActive}>Overview</a>
          <a href="#inbound">Inbound links</a>
          <a href="#tracker">Tracker install</a>
          <a href="#crawl">Crawler audit</a>
          <a href="#issues">Page issues</a>
        </nav>
        <div className={styles.sideNote}>
          <span>Live status</span>
          <strong>{isConnected ? "Website connected" : "Waiting for install"}</strong>
        </div>
      </aside>

      <section className={styles.content}>
        <header className={styles.topbar}>
          <div>
            <p>Project</p>
            <strong>internal-link-audit-tool.netlify.app</strong>
          </div>
          <div className={styles.topActions}>
            {result ? <button onClick={() => downloadCsv(result.audit)} type="button">Export CSV</button> : null}
            <button onClick={loadTrackerReports} type="button">Refresh reports</button>
          </div>
        </header>

        <section id="overview" className={styles.heroPanel}>
          <div>
            <p className={styles.eyebrow}>Internal link intelligence</p>
            <h1>Find every tracked page that links to your target URL.</h1>
            <p>
              Combine sitemap crawling with a sitewide JavaScript tracker to monitor inbound internal links, anchors,
              placement, clicks, and page coverage.
            </p>
            <div className={styles.installPill}>
              <span>{trackerId}</span>
              <strong>{isConnected ? "Website deployed" : "Snippet not detected yet"}</strong>
            </div>
          </div>
          <form className={styles.heroSearch} onSubmit={runAudit}>
            <label>
              Website
              <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
            </label>
            <label>
              Target URL
              <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} />
            </label>
            <label>
              Crawl limit
              <input
                min={1}
                max={200}
                type="number"
                value={crawlLimit}
                onChange={(event) => setCrawlLimit(Number(event.target.value))}
              />
            </label>
            <button disabled={isLoading} type="submit">{isLoading ? "Auditing..." : "Run audit"}</button>
          </form>
          {error ? <p className={styles.error}>{error}</p> : null}
          {result?.audit.discovery?.stoppedEarly ? (
            <p className={styles.warning}>Returned a partial audit before the free hosting time limit.</p>
          ) : null}
        </section>

        <section className={styles.metricsGrid}>
          <Metric title="Inbound sources" value={inboundTracker?.counts.sourcePages ?? crawlCounts?.linksToTarget ?? 0} color="blue" />
          <Metric title="Tracked links" value={trackerCounts?.links ?? crawlCounts?.links ?? 0} color="purple" />
          <Metric title="Sitemap pages" value={result?.audit.discovery?.sitemapUrls ?? 0} color="amber" />
          <Metric title="Broken links" value={crawlCounts?.brokenLinks ?? 0} color="red" />
        </section>

        <section id="inbound" className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>AIOSEO-style lookup</p>
              <h2>Inbound internal links to a target URL</h2>
              <p>Enter a target URL and refresh reports to see source pages where the snippet found that exact internal link.</p>
            </div>
            <button onClick={loadTrackerReports} type="button">Refresh reports</button>
          </div>
          <div className={styles.lookupRow}>
            <label>
              Target URL
              <input value={trackerTargetUrl} onChange={(event) => setTrackerTargetUrl(event.target.value)} />
            </label>
            <div className={styles.lookupMeta}>
              <span>{inboundTracker?.counts.matchingLinks ?? 0}</span>
              <small>matching internal links</small>
            </div>
          </div>
          {trackerStatus ? <p className={styles.statusText}>{trackerStatus}</p> : null}
          <DataTable
            emptyText="No tracked pages currently link to this target URL."
            columns={["Source page", "Anchor", "Area", "Position", "Follow", "Last seen"]}
            rows={inboundSources.flatMap((source) =>
              source.links.map((link) => [
                <a key="source" href={source.pageUrl} target="_blank" rel="noreferrer">{source.pageTitle || source.pageUrl}</a>,
                link.anchorText || <span className={styles.muted} key="empty">No text</span>,
                link.area,
                link.position,
                link.follow ? "follow" : "nofollow",
                new Date(source.lastSeen).toLocaleString(),
              ]),
            )}
          />
        </section>

        <section id="tracker" className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Install</p>
              <h2>Header and footer tracking snippets</h2>
              <p>Use one sitewide install. Header is fastest; footer is safer when themes or builders delay head scripts.</p>
            </div>
            {copiedSnippet ? <span className={styles.copyStatus}>{copiedSnippet}</span> : null}
          </div>
          <div className={styles.connectionGrid}>
            <div className={styles.connectionCard}>
              <span>Tool ID</span>
              <strong className={styles.trackerId}>{trackerId}</strong>
              <small>This is the hidden ID inside your script, similar to a GTM container ID.</small>
            </div>
            <div className={`${styles.connectionCard} ${isConnected ? styles.connected : styles.pending}`}>
              <span>Website deployed</span>
              <strong>{isConnected ? "Connected" : "Not detected yet"}</strong>
              <small>
                {isConnected && trackerConnection?.lastSeen
                  ? `Last signal ${new Date(trackerConnection.lastSeen).toLocaleString()}`
                  : "Install the snippet, open your website, then refresh reports."}
              </small>
            </div>
            <div className={styles.connectionCard}>
              <span>Tracked website</span>
              <strong>{siteHostname || "Enter website URL"}</strong>
              <small>{trackerConnection?.pagesSeen ?? 0} pages seen · {trackerConnection?.reportsSeen ?? 0} reports</small>
            </div>
          </div>
          <div className={styles.snippetGrid}>
            <SnippetCard title="Header version" description="Paste inside the site head." snippet={headerSnippet} onCopy={() => copySnippet(headerSnippet, "Header")} />
            <SnippetCard title="Footer version" description="Paste before the closing body tag." snippet={footerSnippet} onCopy={() => copySnippet(footerSnippet, "Footer")} />
          </div>
        </section>

        <section id="crawl" className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Crawler results</p>
              <h2>Extracted internal links</h2>
              <p>{filteredLinks.length} of {result?.audit.links.length ?? 0} links shown.</p>
            </div>
            <div className={styles.segmented}>
              <button className={mode === "target" ? styles.active : ""} onClick={() => setMode("target")} type="button">Target</button>
              <button className={mode === "all" ? styles.active : ""} onClick={() => setMode("all")} type="button">All</button>
              <button className={mode === "broken" ? styles.active : ""} onClick={() => setMode("broken")} type="button">Broken</button>
              <button className={mode === "nofollow" ? styles.active : ""} onClick={() => setMode("nofollow")} type="button">Nofollow</button>
            </div>
          </div>
          <div className={styles.filters}>
            <label>
              Target URL filter
              <input value={targetFilter} onChange={(event) => setTargetFilter(event.target.value)} />
            </label>
            <label>
              Anchor text
              <input value={anchorFilter} onChange={(event) => setAnchorFilter(event.target.value)} placeholder="video, pricing, demo..." />
            </label>
          </div>
          <DataTable
            emptyText="No links match the current filters."
            columns={["Source page", "Target page", "Anchor", "Status", "Follow"]}
            rows={filteredLinks.map((link) => [
              <a key="source" href={link.sourceUrl} target="_blank" rel="noreferrer">{link.sourceUrl}</a>,
              <a key="target" href={link.targetUrl} target="_blank" rel="noreferrer">{link.targetUrl}</a>,
              link.anchorText || <span className={styles.muted} key="empty">No text</span>,
              link.statusCode ?? "unknown",
              link.follow ? "follow" : "nofollow",
            ])}
          />
        </section>

        <section id="issues" className={styles.lowerGrid}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Coverage</p>
                <h2>Page issues</h2>
              </div>
              <div className={styles.segmented}>
                <button className={pageMode === "orphans" ? styles.active : ""} onClick={() => setPageMode("orphans")} type="button">Orphans</button>
                <button className={pageMode === "low-links" ? styles.active : ""} onClick={() => setPageMode("low-links")} type="button">Low links</button>
              </div>
            </div>
            <div className={styles.cardList}>
              {filteredPages.slice(0, 8).map((page) => (
                <article key={page.id} className={styles.rowCard}>
                  <a href={page.url} target="_blank" rel="noreferrer">{page.title || page.url}</a>
                  <span>{page.incomingCount} incoming · {page.outgoingCount} outgoing</span>
                </article>
              ))}
              {filteredPages.length === 0 ? <p className={styles.empty}>No pages found for this issue type.</p> : null}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Recommendations</p>
                <h2>Anchor opportunities</h2>
              </div>
            </div>
            <div className={styles.cardList}>
              {(result?.summary.suggestions ?? []).slice(0, 8).map((suggestion) => (
                <article key={suggestion.url} className={styles.rowCard}>
                  <a href={suggestion.url} target="_blank" rel="noreferrer">{suggestion.title || suggestion.url}</a>
                  <span>{suggestion.reason}</span>
                  <strong>{suggestion.suggestedAnchor}</strong>
                </article>
              ))}
              {!result ? <p className={styles.empty}>Run an audit to generate anchor opportunities.</p> : null}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ title, value, color }: { title: string; value: number; color: "blue" | "purple" | "amber" | "red" }) {
  return (
    <article className={`${styles.metric} ${styles[color]}`}>
      <span>{title}</span>
      <strong>{value.toLocaleString()}</strong>
    </article>
  );
}

function SnippetCard({
  title,
  description,
  snippet,
  onCopy,
}: {
  title: string;
  description: string;
  snippet: string;
  onCopy: () => void;
}) {
  return (
    <article className={styles.snippetCard}>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <code>{snippet}</code>
      <button onClick={onCopy} type="button">Copy</button>
    </article>
  );
}

function DataTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  emptyText: string;
}) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>{emptyText}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
