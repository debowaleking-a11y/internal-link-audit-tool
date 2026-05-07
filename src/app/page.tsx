"use client";

import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import styles from "./page.module.css";
import { hostnameFromUrl, trackerIdForWebsite } from "@/lib/site-id";

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
  metaDescription: string;
  canonicalUrl: string;
  robotsMeta: string;
  h1Texts: string[];
  h2Texts: string[];
  h3Texts: string[];
  bodyTextSample: string;
  statusCode: number | null;
  crawled: boolean;
  error: string | null;
  incomingCount: number;
  outgoingCount: number;
  linksToTarget: number;
  isOrphan: boolean;
  hasTooFewInternalLinks: boolean;
  missingTitle: boolean;
  duplicateTitle: boolean;
  missingMetaDescription: boolean;
  duplicateMetaDescription: boolean;
  missingH1: boolean;
  multipleH1: boolean;
  canonicalMismatch: boolean;
  noindex: boolean;
  issueTypes: string[];
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
      robots?: {
        url: string;
        found: boolean;
        sitemapDeclarations: number;
        hasDisallowRules: boolean;
        error: string | null;
      };
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
      nofollowInternalLinks: number;
      orphanPages: number;
      lowLinkPages: number;
      linksToTarget: number;
      missingTitles: number;
      duplicateTitles: number;
      missingMetaDescriptions: number;
      duplicateMetaDescriptions: number;
      missingH1: number;
      multipleH1: number;
      canonicalMismatches: number;
      noindexPages: number;
      seoHealthScore: number;
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
type DashboardView =
  | "overview"
  | "internal-links"
  | "page-issues"
  | "content-decay"
  | "link-opportunities"
  | "script-tracking"
  | "site-settings";

const defaultWebsite = "https://www.vidau.ai/";
const defaultTarget = "https://www.vidau.ai/ai-video-generator/";
const trackerScriptUrl = "https://internal-link-audit-tool.netlify.app/api/tracker.js";

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

function downloadRowsCsv(filename: string, header: string[], rows: Array<Array<string | number | boolean | null>>) {
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [websiteUrl, setWebsiteUrl] = useState(defaultWebsite);
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [anchorFilter, setAnchorFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [trackerTargetUrl, setTrackerTargetUrl] = useState(defaultTarget);
  const [mode, setMode] = useState<FilterMode>("target");
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [showSnippets, setShowSnippets] = useState(false);
  const [issueFilter, setIssueFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
        body: JSON.stringify({ websiteUrl, crawlLimit }),
      });
      const responseText = await response.text();
      const data = responseText ? JSON.parse(responseText) : {};

      if (!response.ok) {
        throw new Error(data.error ?? `Audit failed with status ${response.status}.`);
      }

      setResult(data);
      setTargetFilter("");
      setMode("all");
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

  const filteredIssuePages = useMemo(() => {
    const pages = result?.summary.pages ?? [];
    const normalizedIssue = issueFilter.trim();
    const normalizedStatus = statusFilter.trim();

    return pages.filter((page) => {
      if (normalizedIssue && !page.issueTypes.includes(normalizedIssue)) {
        return false;
      }

      if (normalizedStatus && String(page.statusCode ?? "unknown") !== normalizedStatus) {
        return false;
      }

      return page.issueTypes.length > 0;
    });
  }, [issueFilter, result, statusFilter]);

  const inboundSources = inboundTracker?.sources ?? [];
  const crawlCounts = result?.summary.counts;
  const trackerCounts = trackerSummary?.counts;
  const siteHostname = hostnameFromUrl(websiteUrl);
  const trackerId = trackerIdForWebsite(websiteUrl);
  const headerSnippet = headerSnippetFor(trackerId);
  const footerSnippet = footerSnippetFor(trackerId);
  const isConnected = trackerConnection?.connected ?? false;
  const pageByUrl = useMemo(() => new Map((result?.summary.pages ?? []).map((page) => [page.url, page])), [result]);
  const lowEngagementPages = trackerSummary?.pages.filter((page) => page.reportCount <= 1).length ?? 0;
  const issueOptions = [
    ["", "All issues"],
    ["missing_title", "Missing title"],
    ["duplicate_title", "Duplicate title"],
    ["missing_meta_description", "Missing meta description"],
    ["duplicate_meta_description", "Duplicate meta description"],
    ["missing_h1", "Missing H1"],
    ["multiple_h1", "Multiple H1"],
    ["canonical_mismatch", "Canonical mismatch"],
    ["noindex", "Noindex"],
    ["orphan_page", "Orphan page"],
    ["low_internal_links", "Low internal links"],
  ];
  const navItems: Array<{ id: DashboardView; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "internal-links", label: "Internal Links" },
    { id: "page-issues", label: "Page Issues" },
    { id: "content-decay", label: "Content Decay" },
    { id: "link-opportunities", label: "Link Opportunities" },
    { id: "script-tracking", label: "Script Tracking" },
    { id: "site-settings", label: "Site Settings" },
  ];

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
          {navItems.map((item) => (
            <button
              key={item.id}
              className={activeView === item.id ? styles.navActive : ""}
              onClick={() => setActiveView(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
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

        {activeView === "overview" ? (
          <>
        <section className={styles.heroPanel}>
          <div>
            <h1>Internal link audit dashboard.</h1>
            <p>
              Run a full-site crawl from the website URL, then use Internal Links when you want target URL inbound
              analysis, anchors, placement, clicks, and page coverage.
            </p>
            <button className={styles.installPill} onClick={() => setShowSnippets((value) => !value)} type="button">
              <span>{trackerId}</span>
              <strong>{isConnected ? "Website deployed" : "Snippet not detected yet"}</strong>
            </button>
          </div>
          <form className={styles.heroSearch} onSubmit={runAudit}>
            <label>
              Website
              <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
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
          {showSnippets ? (
            <div className={styles.snippetGrid}>
              <SnippetCard title="Header snippet" description="Paste inside the site head." snippet={headerSnippet} onCopy={() => copySnippet(headerSnippet, "Header")} />
              <SnippetCard title="Footer snippet" description="Paste before the closing body tag." snippet={footerSnippet} onCopy={() => copySnippet(footerSnippet, "Footer")} />
            </div>
          ) : null}
          {copiedSnippet ? <span className={styles.copyStatus}>{copiedSnippet}</span> : null}
        </section>

        <section className={styles.metricsGrid}>
          <Metric title="Total crawled pages" value={crawlCounts?.crawledPages ?? 0} color="blue" />
          <Metric title="Total internal links" value={crawlCounts?.links ?? 0} color="purple" />
          <Metric title="Broken internal links" value={crawlCounts?.brokenLinks ?? 0} color="red" />
          <Metric title="Orphan pages" value={crawlCounts?.orphanPages ?? 0} color="amber" />
          <Metric title="Missing titles" value={crawlCounts?.missingTitles ?? 0} color="red" />
          <Metric title="Missing meta descriptions" value={crawlCounts?.missingMetaDescriptions ?? 0} color="amber" />
          <Metric title="Pages with no H1" value={crawlCounts?.missingH1 ?? 0} color="purple" />
          <Metric title="SEO health score" value={crawlCounts?.seoHealthScore ?? 0} color="blue" />
        </section>
          </>
        ) : null}

        {activeView === "internal-links" ? (
          <>
        <section className={styles.panel}>
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
              <input
                value={trackerTargetUrl}
                onChange={(event) => {
                  setTrackerTargetUrl(event.target.value);
                  setTargetFilter(event.target.value);
                  setMode("target");
                }}
              />
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

        <section className={styles.panel}>
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
              Target URL filter for inbound analysis
              <input
                placeholder="Leave blank to show the whole website link map"
                value={targetFilter}
                onChange={(event) => setTargetFilter(event.target.value)}
              />
            </label>
            <label>
              Anchor text
              <input value={anchorFilter} onChange={(event) => setAnchorFilter(event.target.value)} placeholder="video, pricing, demo..." />
            </label>
          </div>
          <DataTable
            emptyText="No links match the current filters."
            columns={["Source page", "Target page", "Anchor", "Position", "Rel", "Status", "Page title", "Incoming", "Outgoing"]}
            rows={filteredLinks.map((link) => {
              const targetPage = pageByUrl.get(link.targetUrl);
              const sourcePage = pageByUrl.get(link.sourceUrl);

              return [
                <a key="source" href={link.sourceUrl} target="_blank" rel="noreferrer">{link.sourceUrl}</a>,
                <a key="target" href={link.targetUrl} target="_blank" rel="noreferrer">{link.targetUrl}</a>,
                link.anchorText || <span className={styles.muted} key="empty">No text</span>,
                link.position,
                link.rel || (link.follow ? "follow" : "nofollow"),
                link.statusCode ?? "unknown",
                link.pageTitle || "Untitled",
                targetPage?.incomingCount ?? 0,
                sourcePage?.outgoingCount ?? 0,
              ];
            })}
          />
        </section>
          </>
        ) : null}

        {activeView === "script-tracking" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Script tracking</p>
              <h2>Live tracking events</h2>
              <p>Script data is stored separately from crawler data and excludes passwords, form values, payments, and private user content.</p>
            </div>
            <button onClick={loadTrackerReports} type="button">Refresh reports</button>
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
          <DataTable
            emptyText="No script events found for this site ID yet."
            columns={["Page", "Reports", "Links seen", "Last seen"]}
            rows={(trackerSummary?.pages ?? []).map((page) => [
              <a key="page" href={page.pageUrl} target="_blank" rel="noreferrer">{page.pageTitle || page.pageUrl}</a>,
              page.reportCount,
              page.links.length,
              new Date(page.lastSeen).toLocaleString(),
            ])}
          />
        </section>
        ) : null}

        {activeView === "page-issues" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Technical SEO</p>
              <h2>Page issues</h2>
              <p>Filter title, description, heading, canonical, indexability, orphan, and low-link issues.</p>
            </div>
            {result ? (
              <button
                onClick={() => downloadRowsCsv(
                  `page-issues-${result.audit.id}.csv`,
                  ["url", "title", "status_code", "issues", "incoming_links", "outgoing_links", "crawl_date"],
                  filteredIssuePages.map((page) => [
                    page.url,
                    page.title,
                    page.statusCode,
                    page.issueTypes.join("|"),
                    page.incomingCount,
                    page.outgoingCount,
                    result.audit.createdAt,
                  ]),
                )}
                type="button"
              >
                Export issues
              </button>
            ) : null}
          </div>
          <div className={styles.filters}>
            <label>
              Issue type
              <select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}>
                {issueOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Status code
              <input value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} placeholder="200, 404, unknown" />
            </label>
          </div>
          <DataTable
            emptyText="No page issues match the filters."
            columns={["URL", "Title", "Status", "Issues", "Incoming", "Outgoing"]}
            rows={filteredIssuePages.map((page) => [
              <a key="url" href={page.url} target="_blank" rel="noreferrer">{page.url}</a>,
              page.title || <span className={styles.muted} key="title">Missing title</span>,
              page.statusCode ?? "unknown",
              page.issueTypes.join(", "),
              page.incomingCount,
              page.outgoingCount,
            ])}
          />
        </section>
        ) : null}

        {activeView === "link-opportunities" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Recommendations</p>
              <h2>Link opportunities</h2>
              <p>Suggestions prioritize matching keywords in titles, headings, body text, and pages with stronger incoming link counts.</p>
            </div>
          </div>
          <div className={styles.cardList}>
            {(result?.summary.suggestions ?? []).map((suggestion) => (
              <article key={suggestion.url} className={styles.rowCard}>
                <a href={suggestion.url} target="_blank" rel="noreferrer">{suggestion.title || suggestion.url}</a>
                <span>{suggestion.reason}</span>
                <strong>{suggestion.suggestedAnchor}</strong>
              </article>
            ))}
            {!result ? <p className={styles.empty}>Run an audit to generate anchor opportunities.</p> : null}
          </div>
        </section>
        ) : null}

        {activeView === "content-decay" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Engagement</p>
              <h2>Content decay signals</h2>
              <p>Early signal based on script reports: pages with very low repeat visits or no recent engagement are highlighted here.</p>
            </div>
          </div>
          <section className={styles.metricsGrid}>
            <Metric title="Tracked pages" value={trackerCounts?.pages ?? 0} color="blue" />
            <Metric title="Low engagement pages" value={lowEngagementPages} color="red" />
            <Metric title="Internal clicks" value={trackerCounts?.clicks ?? 0} color="purple" />
            <Metric title="Reports stored" value={trackerCounts?.reports ?? 0} color="amber" />
          </section>
        </section>
        ) : null}

        {activeView === "site-settings" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Settings</p>
              <h2>Site verification and crawl settings</h2>
              <p>The site ID is generated from your verified domain. Tracking events are accepted only when the ID and page domain match.</p>
            </div>
          </div>
          <div className={styles.connectionGrid}>
            <div className={styles.connectionCard}>
              <span>Verified domain</span>
              <strong>{siteHostname || "No website entered"}</strong>
              <small>CORS rejects events when the browser origin does not match the page URL.</small>
            </div>
            <div className={styles.connectionCard}>
              <span>Robots.txt</span>
              <strong>{result?.audit.discovery?.robots?.found ? "Found" : "Not checked"}</strong>
              <small>{result?.audit.discovery?.robots?.hasDisallowRules ? "Disallow rules detected" : "No disallow signal loaded"}</small>
            </div>
            <div className={styles.connectionCard}>
              <span>Sitemap discovery</span>
              <strong>{result?.audit.discovery?.sitemapUrls ?? 0} URLs</strong>
              <small>{result?.audit.discovery?.sitemapsRead ?? 0} sitemap files read</small>
            </div>
          </div>
        </section>
        ) : null}

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
