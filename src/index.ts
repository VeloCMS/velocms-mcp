#!/usr/bin/env node
/**
 * velocms-mcp — MCP stdio server for the VeloCMS Public API.
 *
 * Registers every tool from `./tools.js` against a single `VeloCmsClient`
 * instance. Run directly (`node dist/index.js`) or via the `velocms-mcp` /
 * `npx @velocms/mcp` bin entry — register it in an MCP client's config (see
 * README.md).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VeloCmsApiError, VeloCmsClient } from "./client.js";
import { formatMissingEnvMessage, resolveEnvConfig } from "./env.js";
import { tools } from "./tools.js";

const SERVER_NAME = "velocms-mcp";
const SERVER_VERSION = "0.1.0";

function formatError(err: unknown): string {
  if (err instanceof VeloCmsApiError) {
    const statusPart = err.status !== null ? `, HTTP ${err.status}` : "";
    const parts = [`VeloCMS API error (${err.code}${statusPart}): ${err.message}`];
    if (err.details) parts.push(`Details: ${JSON.stringify(err.details)}`);
    return parts.join("\n");
  }
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Error: ${String(err)}`;
}

async function main(): Promise<void> {
  // Env resolution is LAZY (first tool call), not a startup gate: MCP
  // registries (e.g. Glama) boot the server without credentials and only
  // need it to start + answer introspection (initialize / tools/list).
  // A missing key therefore surfaces as a helpful per-call tool error
  // inside the MCP client instead of a dead server. Warn once on stderr
  // so interactive users still see the misconfiguration immediately.
  const resolution = resolveEnvConfig();
  let client: VeloCmsClient | null = null;
  if (resolution.ok) {
    client = new VeloCmsClient(resolution.config);
  } else {
    console.error(formatMissingEnvMessage(resolution.missing));
  }

  /** Returns the API client, or the missing-env error message if unconfigured. */
  function requireClient(): VeloCmsClient | string {
    if (client) return client;
    const late = resolveEnvConfig();
    if (!late.ok) return formatMissingEnvMessage(late.missing);
    client = new VeloCmsClient(late.config);
    return client;
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const [name, tool] of Object.entries(tools)) {
    server.registerTool(
      name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => {
        const resolved = requireClient();
        if (typeof resolved === "string") {
          return { content: [{ type: "text" as const, text: resolved }], isError: true };
        }
        try {
          const result = await tool.handler(resolved, (args ?? {}) as Record<string, unknown>);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[velocms-mcp] MCP server running on stdio (${Object.keys(tools).length} tools registered).`,
  );
}

main().catch((err: unknown) => {
  console.error(`[velocms-mcp] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
