"use client";

import { FormEvent, useMemo, useState } from "react";
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

type FilterMode = "all" | "target" | "broken" | "nofollow";
type PageFilterMode = "orphans" | "low-links";

const defaultWebsite = "https://www.vidau.ai/";
const defaultTarget = "https://www.vidau.ai/ai-video-generator/";

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
  const [crawlLimit, setCrawlLimit] = useState(25);
  const [anchorFilter, setAnchorFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState(defaultTarget);
  const [mode, setMode] = useState<FilterMode>("target");
  const [pageMode, setPageMode] = useState<PageFilterMode>("orphans");
  const [result, setResult] = useState<AuditResponse | null>(null);
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
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Audit failed.");
      }

      setResult(data);
      setTargetFilter(data.audit.targetUrl);
      setMode("target");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Audit failed.");
    } finally {
      setIsLoading(false);
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

  return (
    <main className={styles.page}>
      <section className={styles.header}>
        <div>
          <p className={styles.productLabel}>Internal Link Audit</p>
          <h1>Find the pages helping or hurting a target URL.</h1>
          <p className={styles.lede}>
            Crawl a domain, extract internal links, identify broken URLs and orphaned pages, then export the raw link map.
          </p>
        </div>
        {result ? (
          <button className={styles.exportButton} onClick={() => downloadCsv(result.audit)} type="button">
            Export CSV
          </button>
        ) : null}
      </section>

      <section className={styles.auditPanel}>
        <form className={styles.form} onSubmit={runAudit}>
          <label>
            Website URL
            <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://example.com/" />
          </label>
          <label>
            Target URL
            <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://example.com/target-page/" />
          </label>
          <label>
            Crawl limit
            <input
              min={1}
              max={250}
              type="number"
              value={crawlLimit}
              onChange={(event) => setCrawlLimit(Number(event.target.value))}
            />
          </label>
          <button disabled={isLoading} type="submit">
            {isLoading ? "Crawling..." : "Run audit"}
          </button>
        </form>
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>

      {result ? (
        <>
          <section className={styles.statsGrid}>
            <Stat label="Crawled pages" value={result.summary.counts.crawledPages} />
            <Stat label="Internal links" value={result.summary.counts.links} />
            <Stat label="Links to target" value={result.summary.counts.linksToTarget} />
            <Stat label="Broken links" value={result.summary.counts.brokenLinks} tone={result.summary.counts.brokenLinks > 0 ? "warn" : "good"} />
            <Stat label="Orphan pages" value={result.summary.counts.orphanPages} />
            <Stat label="Low-link pages" value={result.summary.counts.lowLinkPages} />
          </section>

          <section className={styles.workspace}>
            <div className={styles.resultsCard}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>Extracted internal links</h2>
                  <p>{filteredLinks.length} of {result.audit.links.length} links shown</p>
                </div>
                <div className={styles.segmented}>
                  <button className={mode === "all" ? styles.active : ""} onClick={() => setMode("all")} type="button">All</button>
                  <button className={mode === "target" ? styles.active : ""} onClick={() => setMode("target")} type="button">Target</button>
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
                  Anchor text filter
                  <input value={anchorFilter} onChange={(event) => setAnchorFilter(event.target.value)} placeholder="video, pricing, demo..." />
                </label>
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Source page</th>
                      <th>Target page</th>
                      <th>Anchor</th>
                      <th>Position</th>
                      <th>Status</th>
                      <th>Follow</th>
                      <th>Page title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLinks.map((link) => (
                      <tr key={link.id}>
                        <td><a href={link.sourceUrl} target="_blank" rel="noreferrer">{link.sourceUrl}</a></td>
                        <td><a href={link.targetUrl} target="_blank" rel="noreferrer">{link.targetUrl}</a></td>
                        <td>{link.anchorText || <span className={styles.muted}>No text</span>}</td>
                        <td>{link.position}</td>
                        <td><Status statusCode={link.statusCode} isBroken={link.isBroken} /></td>
                        <td>{link.follow ? "follow" : "nofollow"}</td>
                        <td>{link.pageTitle || <span className={styles.muted}>Untitled</span>}</td>
                      </tr>
                    ))}
                    {filteredLinks.length === 0 ? (
                      <tr>
                        <td colSpan={7} className={styles.empty}>No links match the current filters.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className={styles.sidePanel}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>Page issues</h2>
                  <p>Orphans and pages with fewer than 3 internal links out.</p>
                </div>
              </div>
              <div className={styles.segmentedWide}>
                <button className={pageMode === "orphans" ? styles.active : ""} onClick={() => setPageMode("orphans")} type="button">Orphans</button>
                <button className={pageMode === "low-links" ? styles.active : ""} onClick={() => setPageMode("low-links")} type="button">Too few links</button>
              </div>
              <div className={styles.issueList}>
                {filteredPages.slice(0, 12).map((page) => (
                  <article key={page.id} className={styles.issueItem}>
                    <a href={page.url} target="_blank" rel="noreferrer">{page.title || page.url}</a>
                    <p>{page.incomingCount} incoming · {page.outgoingCount} outgoing · {page.statusCode ?? "no status"}</p>
                  </article>
                ))}
                {filteredPages.length === 0 ? <p className={styles.empty}>No pages found for this issue type.</p> : null}
              </div>

              <div className={styles.suggestions}>
                <h2>Anchor opportunities</h2>
                {result.summary.suggestions.slice(0, 8).map((suggestion) => (
                  <article key={suggestion.url} className={styles.issueItem}>
                    <a href={suggestion.url} target="_blank" rel="noreferrer">{suggestion.title || suggestion.url}</a>
                    <p>{suggestion.reason}</p>
                    <strong>{suggestion.suggestedAnchor}</strong>
                  </article>
                ))}
              </div>
            </aside>
          </section>
        </>
      ) : (
        <section className={styles.emptyState}>
          <h2>Ready for the first crawl.</h2>
          <p>Start with a small crawl limit, review the target URL links, then increase the limit once the domain pattern looks right.</p>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "good" }) {
  return (
    <article className={`${styles.stat} ${tone === "warn" ? styles.warn : ""} ${tone === "good" ? styles.good : ""}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </article>
  );
}

function Status({ statusCode, isBroken }: { statusCode: number | null; isBroken: boolean }) {
  if (statusCode === null) {
    return <span className={styles.badgeWarn}>Unknown</span>;
  }

  return <span className={isBroken ? styles.badgeWarn : styles.badgeGood}>{statusCode}</span>;
}
