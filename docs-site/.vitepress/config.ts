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
      { text: "Deployment", link: "/deployment" },
      { text: "API", link: "/api" },
      { text: "Importers", link: "/importer-development" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Deployment", link: "/deployment" },
          { text: "Release Process", link: "/release" },
        ],
      },
      {
        text: "Reference",
        items: [
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
