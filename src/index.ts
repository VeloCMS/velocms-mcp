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
  const resolution = resolveEnvConfig();
  if (!resolution.ok) {
    console.error(formatMissingEnvMessage(resolution.missing));
    process.exit(1);
  }

  const client = new VeloCmsClient(resolution.config);
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
        try {
          const result = await tool.handler(client, (args ?? {}) as Record<string, unknown>);
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
