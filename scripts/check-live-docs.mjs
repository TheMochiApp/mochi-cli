import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { TextDecoder } from "node:util";

export const DOCS_INDEX_URL = "https://docs.themochi.app/llms.txt";
export const OPENAPI_URL = "https://openapi.gitbook.com/o/bpgVa93BfrzaqXzuggv8/spec/mochi-api.json";

const guideSlugs = [
  "build-bounded-automation",
  "connect-ai-agent",
  "diagnose-api-failures",
  "lead-synchronization",
  "read-business-metrics",
  "update-lead-safely",
];
const maximumResponseBytes = 2_000_000;
const requestTimeoutMilliseconds = 15_000;

function markdownLinks(content, baseUrl) {
  return [...content.matchAll(/\[[^\]]+\]\((?<url>https:\/\/[^)\s]+|\/[^)\s]+)\)/gu)].map(
    (match) => new URL(match.groups.url, baseUrl),
  );
}

export function parseDiscoveryLinks(content, indexUrl = DOCS_INDEX_URL) {
  const docsOrigin = new URL(indexUrl).origin;
  const links = markdownLinks(content, indexUrl);
  const guideUrls = [];

  for (const slug of guideSlugs) {
    const candidates = links.filter((url) =>
      url.pathname.split("/").some((segment) => segment.replace(/\.md$/u, "") === slug),
    );
    if (candidates.length !== 1) throw new Error(`Expected exactly one ${slug} guide link in llms.txt.`);
    if (candidates[0].origin !== docsOrigin) throw new Error(`${slug} guide must use the same origin as llms.txt.`);
    guideUrls.push(candidates[0].href);
  }

  const declaredOpenApiUrls = links.filter((url) => url.hostname === "openapi.gitbook.com");
  if (declaredOpenApiUrls.some((url) => url.href !== OPENAPI_URL)) {
    throw new Error("llms.txt contains a noncanonical OpenAPI link.");
  }
  return { guideUrls, openapiUrl: OPENAPI_URL };
}

async function readBoundedBody(response, currentUrl, abortController) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      receivedBytes += result.value.byteLength;
      if (receivedBytes > maximumResponseBytes) {
        abortController.abort();
        await reader.cancel();
        throw new Error(`${currentUrl} exceeded the response-size limit.`);
      }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

async function fetchBoundedText(url, fetchImpl) {
  let currentUrl = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const abortController = new globalThis.AbortController();
    const timeout = setTimeout(() => abortController.abort(), requestTimeoutMilliseconds);
    try {
      const response = await fetchImpl(currentUrl, {
        headers: { Accept: "text/plain, text/markdown, application/json;q=0.9" },
        redirect: "manual",
        signal: abortController.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`${currentUrl} redirected without a location.`);
        const redirectedUrl = new URL(location, currentUrl);
        const allowed = redirectedUrl.origin === new URL(DOCS_INDEX_URL).origin || redirectedUrl.href === OPENAPI_URL;
        if (!allowed) throw new Error(`${currentUrl} redirected outside the approved documentation origins.`);
        currentUrl = redirectedUrl.href;
        continue;
      }
      if (!response.ok) throw new Error(`${currentUrl} returned HTTP ${response.status}.`);
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (declaredLength > maximumResponseBytes) {
        abortController.abort();
        throw new Error(`${currentUrl} exceeded the response-size limit.`);
      }
      return await readBoundedBody(response, currentUrl, abortController);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${url} exceeded the redirect limit.`);
}

export async function checkLiveDocs({ fetchImpl = globalThis.fetch } = {}) {
  const index = await fetchBoundedText(DOCS_INDEX_URL, fetchImpl);
  const discovery = parseDiscoveryLinks(index);
  for (const guideUrl of discovery.guideUrls) {
    const guide = await fetchBoundedText(guideUrl, fetchImpl);
    const canonicalLinks = markdownLinks(guide, guideUrl).filter((url) => url.href === OPENAPI_URL);
    if (canonicalLinks.length !== 1) throw new Error(`${guideUrl} does not link the canonical OpenAPI artifact.`);
  }

  const openapiBody = await fetchBoundedText(discovery.openapiUrl, fetchImpl);
  const document = JSON.parse(openapiBody);
  if (
    typeof document !== "object" ||
    document === null ||
    typeof document.openapi !== "string" ||
    typeof document.info !== "object" ||
    document.info === null ||
    document.info.title !== "Mochi Public API"
  ) {
    throw new Error("The published OpenAPI artifact has an unexpected identity.");
  }
  return { guideCount: discovery.guideUrls.length, openapiVersion: document.openapi };
}

async function main() {
  try {
    const result = await checkLiveDocs();
    process.stdout.write(`Mochi live docs passed: ${result.guideCount} guides, OpenAPI ${result.openapiVersion}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown live documentation failure.";
    process.stderr.write(`Mochi live docs failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
