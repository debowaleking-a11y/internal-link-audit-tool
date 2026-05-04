CREATE TABLE IF NOT EXISTS "AuditRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "websiteUrl" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "crawlLimit" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Page" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "auditRunId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "statusCode" INTEGER,
  "crawled" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Page_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Link" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "auditRunId" TEXT NOT NULL,
  "sourcePageId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "anchorText" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "rel" TEXT NOT NULL,
  "follow" BOOLEAN NOT NULL,
  "statusCode" INTEGER,
  "pageTitle" TEXT NOT NULL,
  "isBroken" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Link_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Link_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Page_auditRunId_url_key" ON "Page"("auditRunId", "url");
CREATE INDEX IF NOT EXISTS "Page_auditRunId_idx" ON "Page"("auditRunId");
CREATE INDEX IF NOT EXISTS "Link_auditRunId_idx" ON "Link"("auditRunId");
CREATE INDEX IF NOT EXISTS "Link_targetUrl_idx" ON "Link"("targetUrl");
CREATE INDEX IF NOT EXISTS "Link_sourceUrl_idx" ON "Link"("sourceUrl");
