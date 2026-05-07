import { runCrawlJob } from "../../src/lib/crawl-jobs";

const crawlBackground = async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await request.json();
  const jobId = String(body.jobId ?? "");

  if (!jobId) {
    return new Response("Missing job ID", { status: 400 });
  }

  await runCrawlJob(jobId);
  return new Response(null, { status: 202 });
};

export default crawlBackground;
