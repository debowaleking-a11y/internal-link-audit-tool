# Internal Link Audit Tool

A Next.js MVP for crawling a website, extracting internal links, finding link issues, and exporting results to CSV.

## Features

- Enter a website URL, target URL, and crawl limit.
- Crawl same-domain internal URLs with a Cheerio-based Node crawler.
- Capture source URL, target URL, anchor text, link position, rel, follow/nofollow, status code, and page title.
- Store audit runs, pages, and links in SQLite through Prisma.
- Filter by target URL, anchor text, broken links, nofollow links, orphan pages, and low-link pages.
- Suggest pages that could link to the target URL with a simple anchor text recommendation.
- Export the raw link table as CSV.

## Tech Stack

- Next.js App Router
- TypeScript
- Prisma
- SQLite
- Cheerio

## Setup

Install dependencies:

```bash
npm install
```

Generate the Prisma client:

```bash
cp .env.example .env
npm run prisma:generate
```

Create the local SQLite database:

```bash
sqlite3 prisma/dev.db < prisma/manual-init.sql
```

You can also try Prisma's normal schema push command:

```bash
npm run db:push
```

In this workspace, Prisma's schema engine validated the schema but failed during `db push`, so `prisma/manual-init.sql` is included as a reliable SQLite bootstrap.

Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy Online

This app is best deployed as a single Node web service while it uses SQLite. Serverless hosts can run the UI and API, but SQLite needs a writable persistent disk for saved audit runs and CSV exports.

The repo includes a `render.yaml` Blueprint for Render:

- Runtime: Node 22
- Build command: `npm install && npm run prisma:generate && npm run build`
- Start command: `npm run db:push && npm run start`
- Persistent SQLite path: `/var/data/audit.db`
- `DATABASE_URL`: `file:/var/data/audit.db`

To deploy:

1. Push this repo to GitHub, GitLab, or Bitbucket.
2. In Render, choose **New > Blueprint**.
3. Select the repo.
4. Render will read `render.yaml`, create the web service, attach a persistent disk, and deploy it.

For a cheaper serverless deployment later, switch production storage from SQLite to PostgreSQL and keep SQLite for local development.

## Usage

1. Enter a website URL, such as `https://www.vidau.ai/`.
2. Enter a target URL on the same domain, such as `https://www.vidau.ai/ai-video-generator/`.
3. Pick a crawl limit. Start small, then increase it after confirming the crawl pattern.
4. Run the audit.
5. Review extracted links, page issues, and anchor opportunities.
6. Use **Export CSV** to download the link rows.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run prisma:generate
npm run db:push
npm run db:studio
```

## Notes

- The crawler only follows internal URLs on the same hostname as the website URL.
- URL fragments are removed and trailing slashes are normalized.
- Broken links are links with unknown status or HTTP status code `400+`.
- Low-link pages are currently crawled pages with fewer than three outgoing internal links.
- Google Sheets export is intentionally left for a later iteration; CSV export is the MVP path.
