import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
  defineConfig({
  title: "Componode",
  description:
    "Open-source, self-hosted Digital Product Asset Management — a personal learning project in AI-assisted development",
  srcDir: "../docs",
  srcExclude: ["**/.vitepress/**"],
  outDir: "./.vitepress/dist",
  cleanUrls: true,
  base: "/componode/",
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/quickstart" },
      { text: "Importers", link: "/importers/" },
      { text: "Deploy & Operate", link: "/deployment" },
      { text: "Reference", link: "/openapi-reference" },
      { text: "Contribute", link: "/contributing" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Quickstart", link: "/quickstart" },
          { text: "Using the catalog", link: "/using-the-catalog" },
          { text: "Credentials & access", link: "/credentials-and-access" },
          { text: "Digital Products in depth", link: "/digital-products" },
        ],
      },
      {
        text: "Importers",
        items: [
          { text: "Overview", link: "/importers/" },
          { text: "GitHub", link: "/importers/github" },
          { text: "Alibaba Cloud", link: "/importers/alibaba-cloud" },
          { text: "Docker", link: "/importers/docker" },
          { text: "API URL", link: "/importers/api-url" },
          { text: "Web URL", link: "/importers/web-url" },
          { text: "AWS (scaffold)", link: "/importers/aws" },
          { text: "Azure (scaffold)", link: "/importers/azure" },
          { text: "Kubernetes (scaffold)", link: "/importers/kubernetes" },
          { text: "MCP Server (scaffold)", link: "/importers/mcp-server" },
        ],
      },
      {
        text: "Deploy & Operate",
        items: [
          { text: "Deployment", link: "/deployment" },
          { text: "Import Agents", link: "/import-agents" },
          { text: "Agent wire protocol", link: "/agent-protocol" },
          { text: "Security design", link: "/security" },
          { text: "Troubleshooting & FAQ", link: "/troubleshooting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Interactive API (OpenAPI)", link: "/openapi-reference" },
          { text: "API conventions & tables", link: "/api" },
          { text: "Vocabulary", link: "/vocabulary" },
        ],
      },
      {
        text: "Contributors",
        items: [
          { text: "Contributing", link: "/contributing" },
          { text: "Architecture overview", link: "/architecture" },
          { text: "Importer development", link: "/importer-development" },
          { text: "UX/UI reference", link: "/ux" },
          { text: "Release process", link: "/release" },
          { text: "Roadmap", link: "/roadmap" },
        ],
      },
    ],
    outline: { level: [2, 3], label: "On this page" },
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/Componode/componode/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/Componode/componode" },
    ],
    footer: {
      message:
        "Released under the Apache 2.0 License. A personal learning project in AI-assisted development — not a production-grade solution.",
      copyright: "Copyright © present Componode contributors",
    },
  },
  }),
);
