import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Componode",
  description: "Open-source, self-hosted Digital Product Asset Management",
  srcDir: "../docs",
  outDir: "./.vitepress/dist",
  cleanUrls: true,
  base: "/componode/",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Architecture", link: "/architecture" },
      { text: "Deployment", link: "/deployment" },
      { text: "API", link: "/api" },
      { text: "Importers", link: "/importers/" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Deployment", link: "/deployment" },
          { text: "Release Process", link: "/release" },
          { text: "Roadmap", link: "/roadmap" },
        ],
      },
      {
        text: "Importers",
        items: [
          { text: "Overview", link: "/importers/" },
          { text: "GitHub", link: "/importers/github" },
          { text: "Alibaba Cloud", link: "/importers/alibaba-cloud" },
          { text: "API URL", link: "/importers/api-url" },
          { text: "Web URL", link: "/importers/web-url" },
          { text: "AWS (scaffold)", link: "/importers/aws" },
          { text: "Azure (scaffold)", link: "/importers/azure" },
          { text: "Kubernetes (scaffold)", link: "/importers/kubernetes" },
          { text: "MCP Server (scaffold)", link: "/importers/mcp-server" },
        ],
      },
      {
        text: "Import Agents",
        items: [
          { text: "Deployment & Hardening", link: "/agents" },
          { text: "Wire Protocol", link: "/agent-protocol" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Digital Products", link: "/digital-products" },
          { text: "Architecture", link: "/architecture" },
          { text: "API Reference", link: "/api" },
          { text: "OpenAPI Reference", link: "/openapi-reference" },
          { text: "UX/UI Reference", link: "/ux" },
          { text: "Importer Development", link: "/importer-development" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/Componode/componode" },
    ],
    footer: {
      message: "Released under the Apache 2.0 License.",
      copyright: "Copyright © present Componode contributors",
    },
  },
});
