# Internal Link Audit Tool

A free-friendly Next.js MVP for crawling a website, extracting internal links, finding link issues, and exporting results to CSV.

## Features

- Enter a website URL, target URL, and crawl limit.
- Crawl same-domain internal URLs with a Cheerio-based Node crawler.
- Capture source URL, target URL, anchor text, link position, rel, follow/nofollow, status code, and page title.
- Filter by target URL, anchor text, broken links, nofollow links, orphan pages, and low-link pages.
- Suggest pages that could link to the target URL with a simple anchor text recommendation.
- Export the current results to CSV in the browser.

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

## Scripts

```bash
npm run dev
npm run build
npm run lint
```

## Notes

- Audit history is not saved in this free MVP. Results live in the current browser session.
- The crawler only follows internal URLs on the same hostname as the website URL.
- URL fragments are removed and trailing slashes are normalized.
- Broken links are links with unknown status or HTTP status code `400+`.
- Low-link pages are currently crawled pages with fewer than three outgoing internal links.
- Google Sheets export and persistent audit history are intentionally left for a later database-backed version.
