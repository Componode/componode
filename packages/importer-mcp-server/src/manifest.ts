import { mcpServerConfigSchema } from "./config.js";

export const manifest = {
  name: "mcp-server",
  label: "MCP Server",
  description: "Import MCP server tools and resources as components and instances.",
  version: "1.0.0",
  implPath: "@componode/importer-mcp-server/importer",
  configSchema: mcpServerConfigSchema,
  secrets: [],
};
