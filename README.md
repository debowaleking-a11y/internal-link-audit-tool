# Internal Link Audit Tool

A free-friendly Next.js MVP for crawling a website, extracting internal links, finding link issues, and exporting results to CSV.

## Features

- Enter a website URL, target URL, and crawl limit.
- Discover pages from `robots.txt` sitemap declarations and `/sitemap.xml`.
- Crawl same-domain internal URLs with a sitemap-first Cheerio-based Node crawler.
- Capture source URL, target URL, anchor text, link position, rel, follow/nofollow, status code, and page title.
- Filter by target URL, anchor text, broken links, nofollow links, orphan pages, and low-link pages.
- Suggest pages that could link to the target URL with a simple anchor text recommendation.
- Export the current results to CSV in the browser.
- Install a lightweight JavaScript snippet to report live internal links from pages that load.
- Look up inbound internal links to a supplied target URL from live snippet reports.

## Tech Stack

- Next.js App Router
- TypeScript
- Cheerio
- Stateless API routes for free/serverless deployment

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
2. Enter a target URL on the same domain, such as `https://www.vidau.ai/ai-video-generator/`.
3. Pick a crawl limit. Start small, then increase it after confirming the crawl pattern.
4. Run the audit.
5. Review extracted links, page issues, and anchor opportunities.
6. Use **Export CSV** to download the current result rows.

## Live Tracking Snippet

Paste this snippet in the website `<head>`, footer, Google Tag Manager, or CMS global custom-code area:

```html
<script async src="https://internal-link-audit-tool.netlify.app/api/tracker.js"></script>
```

The snippet does not change the page visually. It reports:

- Current page URL and title
- Internal links on the page
- Anchor text
- Link position
- Header, footer, nav, main, aside, or body placement
- Follow/nofollow rel data
- Internal link clicks

The report API stores lightweight snapshots in Netlify Blobs for the project. JavaScript tracking only sees pages where the snippet actually runs, so use it alongside the sitemap crawler for broader coverage.

After reports exist, enter a target URL in the dashboard's live tracking panel and click **Refresh reports**. The tool will show every tracked source page where that URL appears as an internal link, including anchor text, placement, position, and follow/nofollow.

## Scripts

```bash
npm run dev
npm run build
npm run lint
```

## Notes

- Audit history is not saved in this free MVP. Results live in the current browser session.
- The crawler reads sitemap URLs first, then follows internal links from crawled pages.
- The live snippet records visited pages, not unvisited orphan pages.
- The crawler only follows internal URLs on the same hostname as the website URL.
- The free deployment caps crawl requests at 200 pages to reduce timeout risk.
- URL fragments are removed and trailing slashes are normalized.
- Broken links are links with unknown status or HTTP status code `400+`.
- Low-link pages are currently crawled pages with fewer than three outgoing internal links.
- Google Sheets export and persistent audit history are intentionally left for a later database-backed version.
