"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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

type CrawlSession = {
  id: string;
  projectName?: string;
  websiteUrl: string;
  targetUrl: string;
  crawlLimit: number;
  batchSize: number;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  discoveredUrls: string[];
  nextIndex: number;
  progress: {
    crawledPages: number;
    totalPages: number;
    currentBatch: number;
    currentUrl: string;
  };
  error: string | null;
  result?: AuditResponse;
};

type StorageStatus = {
  provider: "redis" | "netlify-blobs" | "memory";
  persistent: boolean;
  label: string;
  warning: string | null;
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

type IconName = "home" | "rankings" | "traffic" | "link" | "code" | "content" | "report" | "alert" | "settings" | "calendar" | "download";

const defaultWebsite = "https://www.vidau.ai/";
const defaultTarget = "https://www.vidau.ai/ai-video-generator/";
const configuredAppOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";

function trackerScriptWithId(trackerId: string, appOrigin: string) {
  const baseUrl = appOrigin ? `${appOrigin}/api/tracker.js` : "/api/tracker.js";
  return `${baseUrl}?id=${encodeURIComponent(trackerId)}`;
}

function headerSnippetFor(trackerId: string, appOrigin: string) {
  return `<script async src="${trackerScriptWithId(trackerId, appOrigin)}"></script>`;
}

function footerSnippetFor(trackerId: string, appOrigin: string) {
  return `<script>
  window.addEventListener("load", function () {
    var s = document.createElement("script");
    s.src = "${trackerScriptWithId(trackerId, appOrigin)}";
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

async function readJsonResponse(response: Response) {
  const responseText = await response.text();

  if (!responseText.trim()) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`Server returned an invalid response with status ${response.status}.`);
  }
}

export default function Home() {
  const [websiteUrl, setWebsiteUrl] = useState(defaultWebsite);
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [anchorFilter, setAnchorFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [trackerTargetUrl, setTrackerTargetUrl] = useState(defaultTarget);
  const [mode, setMode] = useState<FilterMode>("target");
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [appOrigin] = useState(() => configuredAppOrigin || (typeof window !== "undefined" ? window.location.origin : ""));
  const [showSnippets, setShowSnippets] = useState(false);
  const [issueFilter, setIssueFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [trackerSummary, setTrackerSummary] = useState<TrackerSummary | null>(null);
  const [trackerConnection, setTrackerConnection] = useState<TrackerConnection | null>(null);
  const [backgroundJob, setBackgroundJob] = useState<CrawlSession | null>(null);
  const [backgroundStatus, setBackgroundStatus] = useState("");
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [inboundTracker, setInboundTracker] = useState<InboundTrackerResult | null>(null);
  const [trackerStatus, setTrackerStatus] = useState("");
  const [trackerChecked, setTrackerChecked] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const siteHostname = hostnameFromUrl(websiteUrl);
  const trackerId = trackerIdForWebsite(websiteUrl);
  const headerSnippet = headerSnippetFor(trackerId, appOrigin);
  const footerSnippet = footerSnippetFor(trackerId, appOrigin);
  const isConnected = trackerConnection?.connected ?? false;
  const trackerLabel = !trackerChecked ? "Checking snippet..." : isConnected ? "Website deployed" : "Snippet not detected yet";
  const liveStatusLabel = !trackerChecked ? "Checking install" : isConnected ? "Website connected" : "Waiting for install";
  const currentProjectName = backgroundJob?.projectName ?? siteHostname ?? "No project created";
  const appHostname = hostnameFromUrl(appOrigin) || "internal-link-audit-tool";

  const loadLatestCrawlSession = useCallback(async (options?: { silent?: boolean }) => {
    if (!siteHostname) {
      return;
    }

    if (!options?.silent) {
      setBackgroundStatus("Loading latest crawl session...");
    }

    try {
      const params = new URLSearchParams({
        websiteUrl,
        _: String(Date.now()),
      });
      const response = await fetch(`/api/crawl-sessions?${params.toString()}`, { cache: "no-store" });
      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load latest crawl session.");
      }

      setStorageStatus(data.storage ?? null);

      if (data.latestSession) {
        setBackgroundJob(data.latestSession);
        if (data.latestSession.result) {
          setResult(data.latestSession.result);
          setTargetFilter("");
          setMode("all");
        }
      }

      if (!options?.silent) {
        setBackgroundStatus(data.latestSession ? "Latest crawl session loaded." : "No saved crawl session for this website yet.");
      }
    } catch (sessionError) {
      if (!options?.silent) {
        setBackgroundStatus(sessionError instanceof Error ? sessionError.message : "Could not load latest crawl session.");
      }
    }
  }, [siteHostname, websiteUrl]);

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
      const data = await readJsonResponse(response);

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

  const loadTrackerReports = useCallback(async (options?: { silent?: boolean }) => {
    setTrackerChecked(false);
    if (!options?.silent) {
      setTrackerStatus("Loading live reports...");
    }

    try {
      const params = new URLSearchParams({
        limit: "25",
        targetUrl: trackerTargetUrl,
        trackerId,
      });

      if (siteHostname) {
        params.set("site", siteHostname);
      }
      params.set("_", String(Date.now()));

      const response = await fetch(`/api/track/reports?${params.toString()}`, { cache: "no-store" });
      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load tracker reports.");
      }

      setTrackerSummary(data.summary);
      setTrackerConnection(data.connection);
      setInboundTracker(data.inbound);
      setTrackerChecked(true);
      if (!options?.silent) {
        setTrackerStatus(
          data.connection?.connected
            ? `Connected. Last signal: ${new Date(data.connection.lastSeen).toLocaleString()}.`
            : "Waiting for this website to load the snippet.",
        );
      }
    } catch (reportError) {
      setTrackerChecked(true);
      if (!options?.silent) {
        setTrackerStatus(reportError instanceof Error ? reportError.message : "Could not load tracker reports.");
      }
    }
  }, [siteHostname, trackerId, trackerTargetUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTrackerReports({ silent: true });
    }, 400);

    return () => window.clearTimeout(timer);
  }, [loadTrackerReports]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLatestCrawlSession({ silent: true });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [loadLatestCrawlSession]);

  async function createProjectSession() {
    setBackgroundJob(null);
    setBackgroundStatus("Creating project session...");

    try {
      const response = await fetch("/api/crawl-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          websiteUrl,
          crawlLimit,
          batchSize: 25,
          projectName: siteHostname ? `${siteHostname} SEO Project` : undefined,
        }),
      });
      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(data.error ?? "Could not start background crawl.");
      }

      setStorageStatus(data.storage ?? null);
      setBackgroundJob(data.session);
      setBackgroundStatus(
        data.storage?.persistent
          ? "Project created. The crawl session is now saved and resumable."
          : "Project created in temporary storage. Connect KV/Redis before relying on large resumable crawls.",
      );
    } catch (jobError) {
      setBackgroundStatus(jobError instanceof Error ? jobError.message : "Could not create project session.");
    }
  }

  async function refreshBackgroundCrawl() {
    if (!backgroundJob) {
      setBackgroundStatus("Start a background crawl first.");
      return;
    }

    setBackgroundStatus("Checking background crawl...");

    try {
      const response = await fetch(`/api/crawl-sessions/${backgroundJob.id}?_=${Date.now()}`, { cache: "no-store" });
      const data = await readJsonResponse(response);

      if (!response.ok) {
        setStorageStatus(data.storage ?? null);
        if (response.status === 404) {
          setBackgroundJob(null);
          setBackgroundStatus("That old crawl session was from the previous host. Create a fresh Vercel project session.");
          return;
        }
        throw new Error(data.error ?? "Could not load background crawl.");
      }

      setStorageStatus(data.storage ?? null);
      setBackgroundJob(data.session);

      if (data.session.result) {
        setResult(data.session.result);
        setTargetFilter("");
        setMode("all");
      }

      setBackgroundStatus(
        data.session.status === "completed"
          ? "Background crawl completed and loaded into the dashboard."
          : data.session.status === "failed"
            ? data.session.error ?? "Background crawl failed."
          : `Background crawl is ${data.session.status}.`,
      );
    } catch (jobError) {
      setBackgroundStatus(jobError instanceof Error ? jobError.message : "Could not load background crawl.");
    }
  }

  async function resumeBackgroundCrawl() {
    if (!backgroundJob) {
      setBackgroundStatus("Load or start a crawl session first.");
      return;
    }

    setBackgroundStatus("Resuming crawl session from saved progress...");

    try {
      const response = await fetch(`/api/crawl-sessions/${backgroundJob.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(data.error ?? "Could not resume crawl session.");
      }

      setStorageStatus(data.storage ?? null);
      setBackgroundJob(data.session);
      setBackgroundStatus("Crawl session resumed. Use refresh to check progress.");
    } catch (resumeError) {
      setBackgroundStatus(resumeError instanceof Error ? resumeError.message : "Could not resume crawl session.");
    }
  }

  async function stopBackgroundCrawl() {
    if (!backgroundJob) {
      setBackgroundStatus("Load or create a project session first.");
      return;
    }

    setBackgroundStatus("Stopping crawl session...");

    try {
      const response = await fetch(`/api/crawl-sessions/${backgroundJob.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(data.error ?? "Could not stop crawl session.");
      }

      setStorageStatus(data.storage ?? null);
      setBackgroundJob(data.session);
      setBackgroundStatus("Crawl stopped. Saved data is still available, and you can resume it later.");
    } catch (stopError) {
      setBackgroundStatus(stopError instanceof Error ? stopError.message : "Could not stop crawl session.");
    }
  }

  async function deleteBackgroundCrawl() {
    if (!backgroundJob) {
      setBackgroundStatus("Load or create a project session first.");
      return;
    }

    const shouldDelete = window.confirm("Delete this project? This removes saved crawl sessions and stored tracker reports for this website.");
    if (!shouldDelete) {
      return;
    }

    setBackgroundStatus("Deleting crawl session...");

    try {
      const response = await fetch(`/api/crawl-sessions/${backgroundJob.id}`, {
        method: "DELETE",
      });
      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete crawl session.");
      }

      setBackgroundJob(null);
      setResult(null);
      setTrackerSummary(null);
      setTrackerConnection(null);
      setInboundTracker(null);
      setTrackerStatus("");
      setTrackerChecked(false);
      setBackgroundStatus(
        `Project data deleted. Removed ${data.deletedSessions ?? 0} crawl session(s) and ${data.deletedTrackerReports ?? 0} tracker report(s).`,
      );
    } catch (deleteError) {
      setBackgroundStatus(deleteError instanceof Error ? deleteError.message : "Could not delete crawl session.");
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
  const pageByUrl = useMemo(() => new Map((result?.summary.pages ?? []).map((page) => [page.url, page])), [result]);
  const lowEngagementPages = trackerSummary?.pages.filter((page) => page.reportCount <= 1).length ?? 0;
  const topIssueRows = [
    { label: "Missing title tags", value: crawlCounts?.missingTitles ?? 0 },
    { label: "Meta descriptions missing", value: crawlCounts?.missingMetaDescriptions ?? 0 },
    { label: "Pages without H1", value: crawlCounts?.missingH1 ?? 0 },
    { label: "Broken internal links", value: crawlCounts?.brokenLinks ?? 0 },
    { label: "Orphan pages", value: crawlCounts?.orphanPages ?? 0 },
  ];
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
  const navItems: Array<{ id: DashboardView; label: string; icon: IconName }> = [
    { id: "overview", label: "Overview", icon: "home" },
    { id: "internal-links", label: "Internal Links", icon: "link" },
    { id: "page-issues", label: "Technical SEO", icon: "code" },
    { id: "content-decay", label: "Traffic", icon: "traffic" },
    { id: "link-opportunities", label: "Keywords", icon: "rankings" },
    { id: "script-tracking", label: "Reports", icon: "report" },
    { id: "site-settings", label: "Settings", icon: "settings" },
  ];

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true"></span>
          <div>
            <strong>SEO</strong>
            <small>Analytics</small>
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
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className={styles.websiteSwitch}>
          <Icon name="home" />
          <div>
            <span>Website</span>
            <strong>{siteHostname || "Add site"}</strong>
          </div>
        </div>
        <div className={styles.sideNote}>
          <span>Live status</span>
          <strong>{liveStatusLabel}</strong>
        </div>
      </aside>

      <section className={styles.content}>
        <header className={styles.topbar}>
          <div>
            <h2>{navItems.find((item) => item.id === activeView)?.label ?? "Overview"}</h2>
            <p>{activeView === "overview" ? "Your internal SEO performance overview" : appHostname}</p>
          </div>
          <div className={styles.topActions}>
            <button className={styles.dateButton} type="button"><Icon name="calendar" /> May 8 – Jun 8, 2026</button>
            {result ? <button onClick={() => downloadCsv(result.audit)} type="button">Export CSV</button> : null}
            <button onClick={createProjectSession} type="button">Create Project</button>
            <button onClick={() => loadTrackerReports()} type="button">Refresh reports</button>
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
              <strong>{trackerLabel}</strong>
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
                max={5000}
                type="number"
                value={crawlLimit}
                onChange={(event) => setCrawlLimit(Number(event.target.value))}
              />
            </label>
            <button disabled={isLoading} type="submit">{isLoading ? "Auditing..." : "Run Audit"}</button>
            <button className={styles.secondaryButton} onClick={() => loadLatestCrawlSession()} type="button">Load project</button>
            <button className={styles.secondaryButton} onClick={createProjectSession} type="button">Create Project</button>
          </form>
          <div className={styles.projectStrip}>
            <div>
              <span>Project session</span>
              <strong>{currentProjectName}</strong>
            </div>
            <div>
              <span>Saved session</span>
              <strong>{backgroundJob ? backgroundJob.status : "Not created yet"}</strong>
            </div>
            <div>
              <span>Website scope</span>
              <strong>{siteHostname || "Enter website"}</strong>
            </div>
          </div>
          <div className={styles.jobPanel}>
            <div>
              <strong>Large crawl mode</strong>
              <span>Instant audits stay safest up to 200 pages. Background sessions can crawl up to 5,000 pages in smaller resumable batches.</span>
              {storageStatus && !storageStatus.persistent ? (
                <small className={styles.storageNotice}>
                  {storageStatus.label}: {storageStatus.warning}
                </small>
              ) : null}
            </div>
            {backgroundJob ? (
              <div className={styles.jobMeta}>
                <span>{backgroundJob.status}</span>
                <strong>{backgroundJob.progress.crawledPages} / {backgroundJob.progress.totalPages} pages</strong>
                <small>Batch {backgroundJob.progress.currentBatch || 1} · {backgroundJob.nextIndex} queued</small>
                {backgroundJob.progress.currentUrl ? <small>{backgroundJob.progress.currentUrl}</small> : null}
                {backgroundJob.status === "failed" || backgroundJob.status === "queued" ? (
                  <button onClick={resumeBackgroundCrawl} type="button">Resume crawl</button>
                ) : null}
                {backgroundJob.status === "running" || backgroundJob.status === "queued" ? (
                  <button onClick={stopBackgroundCrawl} type="button">Stop run</button>
                ) : null}
                <button className={styles.dangerButton} onClick={deleteBackgroundCrawl} type="button">Delete</button>
                <button onClick={refreshBackgroundCrawl} type="button">Refresh job</button>
              </div>
            ) : null}
          </div>
          {backgroundStatus ? <p className={styles.statusText}>{backgroundStatus}</p> : null}
          {!backgroundJob && backgroundStatus.includes("old crawl session") ? (
            <button className={`${styles.secondaryButton} ${styles.inlineAction}`} onClick={createProjectSession} type="button">
              Create fresh project
            </button>
          ) : null}
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

        <section className={styles.overviewGrid}>
          <div className={styles.mainReports}>
            <section className={styles.metricsGrid}>
              <Metric title="Crawled Pages" value={crawlCounts?.crawledPages ?? 0} color="blue" icon="rankings" onClick={() => setActiveView("page-issues")} />
              <Metric title="Internal Links" value={crawlCounts?.links ?? 0} color="purple" icon="link" onClick={() => setActiveView("internal-links")} />
              <Metric title="Broken Links" value={crawlCounts?.brokenLinks ?? 0} color="teal" icon="alert" onClick={() => setActiveView("page-issues")} />
              <Metric title="Tracked Pages" value={trackerCounts?.pages ?? 0} color="green" icon="traffic" onClick={() => setActiveView("script-tracking")} />
            </section>
            <section className={`${styles.panel} ${styles.chartPanel}`} role="button" tabIndex={0} onClick={() => setActiveView("content-decay")} onKeyDown={(event) => event.key === "Enter" && setActiveView("content-decay")}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Internal Link Growth Over Time</h2>
                  <p>Recent crawl and script activity signal how much of the site is being discovered.</p>
                </div>
                <button type="button">Daily</button>
              </div>
              <div className={styles.lineChart} aria-hidden="true">
                <span></span><span></span><span></span><span></span><span></span><span></span>
              </div>
            </section>
            <section className={styles.lowerGrid}>
              <ReportCard title="Top Landing Pages" action="View full report" onClick={() => setActiveView("script-tracking")}>
                {(trackerSummary?.pages ?? []).slice(0, 5).map((page) => (
                  <div key={page.pageUrl} className={styles.listRow}>
                    <span>{page.pageTitle || page.pageUrl}</span>
                    <strong>{page.reportCount}</strong>
                  </div>
                ))}
                {!trackerSummary?.pages.length ? <p className={styles.empty}>No tracked landing pages yet.</p> : null}
              </ReportCard>
              <ReportCard title="Link Opportunities" action="View full report" onClick={() => setActiveView("link-opportunities")}>
                {(result?.summary.suggestions ?? []).slice(0, 4).map((suggestion) => (
                  <div key={suggestion.url} className={styles.listRow}>
                    <span>{suggestion.title || suggestion.url}</span>
                    <strong>{suggestion.suggestedAnchor}</strong>
                  </div>
                ))}
                {!result?.summary.suggestions.length ? <p className={styles.empty}>Run an audit to generate opportunities.</p> : null}
              </ReportCard>
            </section>
          </div>
          <aside className={styles.insightRail}>
            <button className={styles.healthCard} onClick={() => setActiveView("page-issues")} type="button">
              <div>
                <h3>Site Health</h3>
                <small>{crawlCounts?.seoHealthScore ? "Based on latest crawl" : "Run a crawl to score the site"}</small>
              </div>
              <div className={styles.healthScore}>
                <strong>{crawlCounts?.seoHealthScore ?? 0}</strong>
                <span>{(crawlCounts?.seoHealthScore ?? 0) >= 80 ? "Excellent" : "Needs data"}</span>
              </div>
              <div className={styles.healthStats}>
                <span>Crawled Pages <strong>{crawlCounts?.crawledPages ?? 0}</strong></span>
                <span>Healthy Pages <strong>{Math.max(0, (crawlCounts?.crawledPages ?? 0) - topIssueRows.reduce((total, item) => total + item.value, 0))}</strong></span>
                <span>Issues Found <strong>{topIssueRows.reduce((total, item) => total + item.value, 0)}</strong></span>
              </div>
            </button>
            <ReportCard title="Top Issues" action="View all issues" onClick={() => setActiveView("page-issues")}>
              {topIssueRows.map((issue) => (
                <div key={issue.label} className={styles.issueRow}>
                  <span>{issue.label}</span>
                  <strong>{issue.value}</strong>
                </div>
              ))}
            </ReportCard>
            <ReportCard title="AI Insights" action="View full insight" onClick={() => setActiveView("link-opportunities")}>
              <p className={styles.insightText}>Your strongest next move is to add links from high-visibility pages to priority target URLs.</p>
              <div className={styles.checkList}>
                <span>Improve anchor coverage</span>
                <span>Review orphan pages</span>
              </div>
            </ReportCard>
          </aside>
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
            <button onClick={() => loadTrackerReports()} type="button">Refresh reports</button>
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
            <button onClick={() => loadTrackerReports()} type="button">Refresh reports</button>
          </div>
          <div className={styles.connectionGrid}>
            <div className={styles.connectionCard}>
              <span>Tool ID</span>
              <strong className={styles.trackerId}>{trackerId}</strong>
              <small>This is the hidden ID inside your script, similar to a GTM container ID.</small>
            </div>
            <div className={`${styles.connectionCard} ${isConnected ? styles.connected : styles.pending}`}>
              <span>Website deployed</span>
              <strong>{!trackerChecked ? "Checking..." : isConnected ? "Connected" : "Not detected yet"}</strong>
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

function Metric({
  title,
  value,
  color,
  icon,
  onClick,
}: {
  title: string;
  value: number;
  color: "blue" | "purple" | "amber" | "red" | "green" | "teal";
  icon?: IconName;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={styles.metricIcon}><Icon name={icon ?? "report"} /></span>
      <span className={styles.metricTitle}>{title}</span>
      <strong>{value.toLocaleString()}</strong>
      <Sparkline />
    </>
  );

  if (!onClick) {
    return <article className={`${styles.metric} ${styles[color]}`}>{content}</article>;
  }

  return (
    <button className={`${styles.metric} ${styles[color]}`} onClick={onClick} type="button">
      {content}
    </button>
  );
}

function ReportCard({
  title,
  action,
  children,
  onClick,
}: {
  title: string;
  action: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={styles.reportCard} onClick={onClick} type="button">
      <div className={styles.reportHeader}>
        <h3>{title}</h3>
        <span>i</span>
      </div>
      <div className={styles.reportBody}>{children}</div>
      <strong className={styles.reportAction}>{action} <span>→</span></strong>
    </button>
  );
}

function Sparkline() {
  return (
    <svg className={styles.sparkline} viewBox="0 0 180 54" aria-hidden="true">
      <path d="M3 41 C18 28, 27 30, 38 22 S58 37, 72 26 S96 13, 108 25 S129 33, 140 18 S160 16, 177 7" />
    </svg>
  );
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z" />,
    rankings: <path d="M5 19V9m7 10V5m7 14v-7M3 20h18" />,
    traffic: <path d="m4 16 5-5 4 4 7-8m0 0v5m0-5h-5" />,
    link: <path d="M9.5 14.5 14.5 9.5m-1-4 1.2-1.2a4 4 0 1 1 5.7 5.7l-2 2a4 4 0 0 1-5.7 0m-2.4 6.4-1.2 1.2a4 4 0 1 1-5.7-5.7l2-2a4 4 0 0 1 5.7 0" />,
    code: <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2-10-4 12" />,
    content: <path d="M6 3h9l3 3v15H6zM9 12h6M9 16h6M9 8h3" />,
    report: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
    alert: <path d="M12 3 2 20h20zM12 9v4m0 4h.01" />,
    settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v3m0 12v3m9-9h-3M6 12H3m15.4-6.4-2.1 2.1M7.7 16.3l-2.1 2.1m12.8 0-2.1-2.1M7.7 7.7 5.6 5.6" />,
    calendar: <path d="M7 3v4m10-4v4M4 9h16M5 5h14v16H5z" />,
    download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />,
  };

  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
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
