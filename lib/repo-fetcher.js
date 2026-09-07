/**
 * Repo fetcher — clones/parses repos from GitHub/GitLab.
 * When DAYTONA_API_KEY is set, shallow-clones in a Daytona sandbox and scans sources.
 */

const { scanRepository } = require("./repo-scanner");

// octokit is ESM-only. Vercel Node functions disable require(esm)
// (--no-experimental-require-module), so a top-level require() crashes
// the whole Fluid Compute boot — including GET /health.
let octokitImport;

function loadOctokit() {
  if (!octokitImport) {
    octokitImport = import("octokit");
  }
  return octokitImport;
}

async function fetchRepo(url, provider) {
  if (!url) return null;

  if (provider === "github" || url.includes("github.com")) {
    const repoInfo = await fetchGitHubRepo(url);
    // Bound the live sandbox scan: a slow/hung Daytona provision must degrade
    // to demo findings rather than leave the Slack thread silent forever.
    const scan = await Promise.race([
      scanRepository(url).catch((err) => {
        console.error(`Live scan failed for ${url}:`, err.message);
        return null;
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), SCAN_DEADLINE_MS).unref?.()),
    ]);
    if (scan) {
      repoInfo.scan = scan;
      repoInfo.cloned = true;
      repoInfo.scanMode = "daytona";
    }
    return repoInfo;
  }

  // GitLab and others — return metadata for now
  return { url, provider, name: extractRepoName(url) };
}

// GitHub API request budget. Without a timeout a hung connection would block
// the analysis pipeline indefinitely; Octokit also retries transient 5xx/429
// internally when the retry plugin defaults are left enabled.
const GITHUB_TIMEOUT_MS = 30_000;

// Overall deadline for a live Daytona repo scan (provision + clone + scan).
const SCAN_DEADLINE_MS = 150_000;

async function fetchGitHubRepo(url) {
  const [owner, repo] = extractGitHubParts(url);
  const { Octokit } = await loadOctokit();
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
    request: { timeout: GITHUB_TIMEOUT_MS },
  });

  // AbortController bounds the request even on Octokit versions that ignore the
  // legacy `request.timeout` option (fetch-based core honors the signal).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    timer.unref();
  }

  try {
    const { data } = await octokit.rest.repos.get({
      owner,
      repo,
      request: { signal: controller.signal },
    });
    return {
      url,
      provider: "github",
      name: data.full_name,
      language: data.language,
      size: data.size,
      defaultBranch: data.default_branch,
      stars: data.stargazers_count,
    };
  } catch (err) {
    console.error(`Failed to fetch GitHub repo ${owner}/${repo}:`, err.message);
    return { url, provider: "github", name: `${owner}/${repo}`, fallback: true };
  } finally {
    clearTimeout(timer);
  }
}

function extractGitHubParts(url) {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!match) return ["unknown", "unknown"];
  return [match[1], match[2].replace(/\.git$/, "")];
}

function extractRepoName(url) {
  const parts = url.replace(/\/$/, "").split("/");
  return parts.slice(-2).join("/");
}

module.exports = { fetchRepo };