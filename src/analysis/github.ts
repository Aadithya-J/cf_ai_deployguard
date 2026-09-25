import { z } from "zod";

// Verified GitHub repository ID survives the submission rename. Resolve the old
// name explicitly rather than following redirects (which could later be reused).
export const PROJECT_REPOSITORY = "Aadithya-J/cf_ai_deployguard";
const PROJECT_REPOSITORY_ID = 1386919200;
export function canonicalRepository(value: string): string {
  return ["aadithya-j/deployguard", PROJECT_REPOSITORY.toLowerCase()].includes(
    value.toLowerCase()
  )
    ? PROJECT_REPOSITORY
    : value;
}

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const prSchema = z.object({
  number: z.number().int(),
  html_url: z.string(),
  title: z.string().max(500),
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  merged: z.boolean(),
  base: z.object({
    sha,
    repo: z.object({ full_name: z.string(), id: z.number().optional() })
  }),
  head: z.object({ sha }),
  changed_files: z.number().int().nonnegative()
});
export interface PullSnapshot {
  url: string;
  repository: string;
  number: number;
  title: string;
  commitSha: string;
  baseSha: string;
  mergeBaseSha: string;
  changedFiles: number;
  diff: string;
  diffSha256: string;
  capturedAt: number;
}
export function parsePullUrl(value: string) {
  const url = new URL(value);
  const match =
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/.exec(
      url.pathname
    );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match ||
    Number(match[3]) > 2_147_483_647
  )
    throw new Error("Expected https://github.com/owner/repository/pull/number");
  const repository = canonicalRepository(`${match[1]}/${match[2]}`);
  return {
    repository,
    number: Number(match[3]),
    url: `https://github.com/${repository}/pull/${match[3]}`
  };
}
export async function boundedText(
  response: Response,
  limit: number
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new Error(
          "Response exceeds V1 size limit; analysis rejected, not truncated"
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export class GitHubReader {
  private token?: string;
  private http: typeof fetch;
  constructor(token?: string, http: typeof fetch = fetch) {
    this.token = token;
    // Native Workers fetch requires its global receiver when stored as a method.
    this.http = http.bind(globalThis);
  }
  private async get(path: string, diff = false) {
    const response = await this.http(`https://api.github.com${path}`, {
      headers: {
        Accept: diff
          ? "application/vnd.github.diff"
          : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "DeployGuard",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok)
      throw new Error(
        `GitHub returned HTTP ${response.status}; check PR access and rate limits`
      );
    return boundedText(response, diff ? 24_000 : 1_000_000);
  }
  async snapshot(value: string): Promise<PullSnapshot> {
    const parsed = parsePullUrl(value);
    const path = `/repos/${parsed.repository}/pulls/${parsed.number}`;
    const read = async () => {
      const pr = prSchema.parse(JSON.parse(await this.get(path)));
      if (
        (parsed.repository === PROJECT_REPOSITORY &&
          pr.base.repo.id !== PROJECT_REPOSITORY_ID) ||
        pr.number !== parsed.number ||
        pr.base.repo.full_name.toLowerCase() !==
          parsed.repository.toLowerCase() ||
        parsePullUrl(pr.html_url).url.toLowerCase() !== parsed.url.toLowerCase()
      )
        throw new Error("GitHub PR identity mismatch");
      if (pr.state !== "open" || pr.merged || pr.draft)
        throw new Error("V1 requires an open, non-draft, unmerged PR");
      if (pr.changed_files === 0 || pr.changed_files > 100)
        throw new Error("V1 supports PRs changing 1–100 files");
      return pr;
    };
    const before = await read();
    const comparison = z
      .object({ merge_base_commit: z.object({ sha }) })
      .parse(
        JSON.parse(
          await this.get(
            `/repos/${parsed.repository}/compare/${before.base.sha}...${before.head.sha}?per_page=1`
          )
        )
      );
    const mergeBaseSha = comparison.merge_base_commit.sha;
    const diff = await this.get(
      `/repos/${parsed.repository}/compare/${mergeBaseSha}...${before.head.sha}`,
      true
    );
    if (!diff.startsWith("diff --git "))
      throw new Error("Empty or unsupported diff response");
    // Never silently analyze a partial/binary diff as complete evidence.
    const fileCount = (diff.match(/^diff --git /gm) ?? []).length;
    if (
      fileCount !== before.changed_files ||
      /^Binary files .* differ$/m.test(diff) ||
      diff.includes("GIT binary patch")
    )
      throw new Error("Incomplete or binary diff is unsupported in V1");
    const after = await read();
    if (
      after.head.sha !== before.head.sha ||
      after.base.sha !== before.base.sha ||
      after.changed_files !== before.changed_files
    )
      throw new Error("PR changed while fetching; retry analysis");
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(diff)
    );
    return {
      ...parsed,
      title: before.title,
      commitSha: before.head.sha,
      baseSha: before.base.sha,
      mergeBaseSha,
      changedFiles: before.changed_files,
      diff,
      diffSha256: Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0")
      ).join(""),
      capturedAt: Date.now()
    };
  }
}
