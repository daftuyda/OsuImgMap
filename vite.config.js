import { defineConfig } from "vite";

import {
  SOCIAL_IMAGE_ALT,
  createRobots,
  createSitemap,
  createWebApplicationSchema,
  normalizeSiteUrl,
  sitemapUrl,
  socialImageUrl,
} from "./scripts/seo.mjs";

const siteUrl = normalizeSiteUrl(process.env.SEO_SITE_URL);

function seoPlugin() {
  return {
    name: "build-time-seo",
    transformIndexHtml(html) {
      if (!siteUrl) return html;

      const imageUrl = socialImageUrl(siteUrl);
      const secureImageTags = siteUrl.startsWith("https://")
        ? [
            {
              tag: "meta",
              attrs: { property: "og:image:secure_url", content: imageUrl },
              injectTo: "head",
            },
          ]
        : [];
      const schema = JSON.stringify(createWebApplicationSchema(siteUrl)).replaceAll("<", "\\u003c");
      return {
        html,
        tags: [
          { tag: "link", attrs: { rel: "canonical", href: siteUrl }, injectTo: "head" },
          {
            tag: "link",
            attrs: { rel: "sitemap", type: "application/xml", href: sitemapUrl(siteUrl) },
            injectTo: "head",
          },
          { tag: "meta", attrs: { property: "og:url", content: siteUrl }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:image", content: imageUrl }, injectTo: "head" },
          ...secureImageTags,
          { tag: "meta", attrs: { property: "og:image:type", content: "image/png" }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:image:width", content: "1200" }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:image:height", content: "630" }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:image:alt", content: SOCIAL_IMAGE_ALT }, injectTo: "head" },
          { tag: "meta", attrs: { name: "twitter:image", content: imageUrl }, injectTo: "head" },
          { tag: "meta", attrs: { name: "twitter:image:alt", content: SOCIAL_IMAGE_ALT }, injectTo: "head" },
          {
            tag: "script",
            attrs: { type: "application/ld+json" },
            children: schema,
            injectTo: "head",
          },
        ],
      };
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: createRobots(siteUrl) });
      const sitemap = createSitemap(siteUrl);
      if (sitemap) {
        this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemap });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [seoPlugin()],
});
