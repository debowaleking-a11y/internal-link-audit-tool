# Internal Link Audit Tool

A free-friendly Next.js MVP for crawling a website, extracting internal links, finding link issues, and exporting results to CSV.

## Features

- Enter a website URL, target URL, and crawl limit.
- Discover pages from `robots.txt` sitemap declarations and `/sitemap.xml`.
- Crawl same-domain internal URLs with a sitemap-first Cheerio-based Node crawler.
- Capture source URL, target URL, anchor text, link position, rel, follow/nofollow, status code, and page title.
- Audit missing/duplicate title tags, missing/duplicate meta descriptions, missing or multiple H1s, canonical mismatches, noindex signals, broken internal links, nofollow internal links, orphan pages, and low-link pages.
- Suggest pages where a target URL should be added based on keyword matches in title, headings, body text, and stronger internally linked pages.
- Export link and issue reports to CSV in a sheet-ready format.
- Copy a GTM-style header or footer JavaScript snippet with a unique `ILA-...` site ID.
- Look up inbound internal links to a supplied target URL from live snippet reports.
- Confirm when the snippet is connected and sending events.
- Start a batched Netlify Background Function crawl session for larger crawls up to 5,000 pages.

## Tech Stack

- Next.js App Router
- TypeScript
- Cheerio
- Stateless API routes for free/serverless deployment
- Netlify Blobs as the free-hosting storage layer for tracking events

## Setup

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy Free On Netlify

This version does not need SQLite, Prisma, or a persistent disk. It is designed for experimentation on Netlify's Free plan, which currently lists $0/month with included build/deploy and serverless-function usage credits.

Deploy steps:

1. Push this repo to GitHub.
2. In Netlify, choose **Add new project > Import an existing project**.
3. Pick the GitHub repo.
4. Use these build settings:
   - Build command: `npm run build`
   - Publish directory: `.next`
5. Deploy.

The included `netlify.toml` sets the same build command, publish directory, and Node version.

## Usage

1. Enter a website URL, such as `https://www.vidau.ai/`.
2. Pick a crawl limit. Start small, then increase it after confirming the crawl pattern.
3. Click **Run audit** for a quick full-site crawl.
4. For larger crawls, click **Start background crawl**, then use **Refresh job** until the batched session completes.
5. Review extracted links, page issues, and anchor opportunities.
6. Use **Export CSV** to download the current result rows.

## Background Crawls

The app includes single-job background crawling plus batched crawl sessions. Batched sessions store crawl progress and merged results in Netlify Blobs, so the browser can start a large crawl, receive a quick response, and check progress later.

- Quick audit API: capped at 200 pages for fast request/response use.
- Legacy background crawl API: capped at 1,500 pages for single jobs.
- Batched crawl session API: capped at 5,000 pages, processed in batches of up to 250 URLs.
- Netlify Background Functions can run longer than regular functions, but they are still not a replacement for a dedicated queue/worker once crawls need tens of thousands of pages.

Endpoints:

```text
POST /api/crawl-jobs
GET /api/crawl-jobs/:jobId
POST /.netlify/functions/crawl-background
POST /api/crawl-sessions
GET /api/crawl-sessions/:sessionId
POST /.netlify/functions/crawl-session-background
```

Batched crawl sessions discover sitemap URLs first, crawl a safe batch, merge the batch into the session report, and continue with the next batch until the session finishes or fails. The dashboard shows total crawled pages, total discovered pages, current batch, and current URL.

Sessions are project-level records for the website URL. If a crawl fails or the browser is refreshed, use **Load saved crawl** to bring back the latest session for that website, then use **Resume crawl** to continue from the saved `nextIndex` instead of starting over.

## Live Tracking Snippets

The dashboard generates a unique `ILA-...` site ID from the website URL. Tap the Tool ID on the Overview dashboard to reveal the snippets.

Use the header version when your website lets you add custom code inside `<head>`:

```html
<script async src="https://internal-link-audit-tool.netlify.app/api/tracker.js?id=ILA-YOURSITE-12345"></script>
```

Use the footer version when the header does not load reliably, or when your theme only supports code before the closing `</body>` tag:

```html
<script>
  window.addEventListener("load", function () {
    var s = document.createElement("script");
    s.src = "https://internal-link-audit-tool.netlify.app/api/tracker.js?id=ILA-YOURSITE-12345";
    s.async = true;
    document.body.appendChild(s);
  });
</script>
```

You can also install one of these through Google Tag Manager or a CMS global custom-code area.

After the snippet loads on at least one page, click **Refresh reports** and the dashboard changes from **Not detected yet** to **Connected**.

The snippet does not change the page visually. It reports:

- Current page URL and title
- Meta description
- Canonical URL
- H1, H2, and H3 text/counts
- Internal links on the page
- Anchor text
- Link position
- Header, footer, nav, main, aside, or body placement
- Follow/nofollow rel data
- Internal link clicks
- External link clicks
- Scroll depth
- Referrer
- UTM parameters
- Device type
- Page load timing

The script intentionally does not collect passwords, form field values, payment data, or private page content. The report API validates the site ID, rejects mismatched origins, rate-limits event collection, and ignores obvious bot traffic where possible.

The report API stores lightweight snapshots in Netlify Blobs for the project. These blobs act as the current free database layer for `tracking_events` and script installation status. JavaScript tracking only sees pages where the snippet actually runs, so use it alongside the sitemap crawler for broader coverage.

After reports exist, enter a target URL in the dashboard's live tracking panel and click **Refresh reports**. The tool will show every tracked source page where that URL appears as an internal link, including anchor text, placement, position, and follow/nofollow.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Environment Variables

No environment variables are required for local crawling. On Netlify, tracking events use Netlify Blobs automatically through the deployed site context.

## Data Models

The free Netlify build uses logical TypeScript models in `src/lib/data-models.ts` and Netlify Blobs instead of SQL migrations. The models cover:

- `sites`
- `crawls`
- `pages`
- `links`
- `page_issues`
- `tracking_events`
- `script_installations`

When this moves to SQLite/PostgreSQL, these models should become the migration source of truth.

## Notes

- Audit history is not saved in this free MVP. Results live in the current browser session.
- SQLite/Postgres models for `sites`, `crawls`, `pages`, `links`, `page_issues`, `tracking_events`, and `script_installations` are planned for the database-backed version. The current Netlify version uses logical equivalents in API response data and Netlify Blobs to stay free.
- The crawler reads sitemap URLs first, then follows internal links from crawled pages.
- The live snippet records visited pages, not unvisited orphan pages.
- The crawler only follows internal URLs on the same hostname as the website URL.
- The free deployment caps crawl requests at 200 pages to reduce timeout risk.
- URL fragments are removed and trailing slashes are normalized.
- Broken links are links with unknown status or HTTP status code `400+`.
- Low-link pages are currently crawled pages with fewer than three outgoing internal links.
- Google Sheets export and persistent audit history are intentionally left for a later database-backed version.
