export type SiteModel = {
  id: string;
  hostname: string;
  verifiedDomain: string;
  createdAt: string;
};

export type CrawlModel = {
  id: string;
  siteId: string;
  websiteUrl: string;
  targetUrl: string;
  crawlLimit: number;
  status: "completed" | "failed";
  createdAt: string;
};

export type PageModel = {
  id: string;
  crawlId: string;
  url: string;
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  robotsMeta: string;
  statusCode: number | null;
  incomingCount: number;
  outgoingCount: number;
};

export type LinkModel = {
  id: string;
  crawlId: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  position: number;
  rel: string;
  statusCode: number | null;
  follow: boolean;
};

export type PageIssueModel = {
  id: string;
  crawlId: string;
  pageUrl: string;
  issueType: string;
  severity: "low" | "medium" | "high";
};

export type TrackingEventModel = {
  id: string;
  siteId: string;
  eventType: "page_view" | "internal_click" | "external_click" | "scroll";
  pageUrl: string;
  receivedAt: string;
};

export type ScriptInstallationModel = {
  id: string;
  siteId: string;
  trackerId: string;
  hostname: string;
  connected: boolean;
  lastSeen: string | null;
};
