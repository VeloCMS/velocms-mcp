# velocms-mcp — stdio MCP server image.
#
# Used by MCP registries (e.g. Glama) to build and boot the server for
# introspection checks, and usable locally:
#
#   docker build -t velocms-mcp .
#   docker run -i --rm \
#     -e VELOCMS_SITE_URL=https://yourblog.velocms.org \
#     -e VELOCMS_API_KEY=velo_... \
#     velocms-mcp
#
# The server starts and answers MCP introspection (initialize / tools/list)
# WITHOUT credentials; env vars are only required when a tool is called.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
CMD ["node", "dist/index.js"]
