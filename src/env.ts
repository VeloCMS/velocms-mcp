/**
 * Pure env-resolution helper — kept separate from `index.ts` (which has a
 * `#!/usr/bin/env node` shebang and starts the stdio server as a side effect
 * on import) so the fail-fast "missing env var" behavior is unit-testable
 * without spawning a subprocess or calling `process.exit`.
 */

export interface VeloCmsEnvConfig {
  siteUrl: string;
  apiKey: string;
}

export type VeloCmsEnvResolution =
  | { ok: true; config: VeloCmsEnvConfig }
  | { ok: false; missing: string[] };

/**
 * Reads `VELOCMS_SITE_URL` + `VELOCMS_API_KEY` from the given environment
 * (defaults to `process.env`). Never logs the resolved values.
 */
export function resolveEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): VeloCmsEnvResolution {
  const siteUrl = env.VELOCMS_SITE_URL;
  const apiKey = env.VELOCMS_API_KEY;

  const missing: string[] = [];
  if (!siteUrl) missing.push("VELOCMS_SITE_URL");
  if (!apiKey) missing.push("VELOCMS_API_KEY");

  if (missing.length > 0 || !siteUrl || !apiKey) {
    return { ok: false, missing };
  }

  return { ok: true, config: { siteUrl, apiKey } };
}

/** Human-readable message for the missing-env-var fail-fast path (stderr only, never stdout). */
export function formatMissingEnvMessage(missing: string[]): string {
  return (
    `[velocms-mcp] Missing required environment variable(s): ${missing.join(", ")}.\n` +
    "  VELOCMS_SITE_URL — your blog's base URL, e.g. https://myblog.velocms.org (or a bound custom domain)\n" +
    "  VELOCMS_API_KEY  — an API key from your VeloCMS dashboard: /admin/settings -> API Keys (Pro plan or higher)\n" +
    "Set both in your MCP client config or shell environment. See README.md for setup."
  );
}
