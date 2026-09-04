export const SEO_TITLE = "osu! Imagemap Builder – Free BBCode Generator";

export const SEO_DESCRIPTION =
  "Create osu! imagemap BBCode visually with this free browser tool. Load an image, draw clickable areas, then copy code for profiles, forums, and beatmaps.";

export const SOCIAL_IMAGE_FILE = "social-preview.png";
export const SOCIAL_IMAGE_ALT =
  "osu! Imagemap Builder with a visual preview of editable link areas";

export function normalizeSiteUrl(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return null;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("SEO_SITE_URL must be an absolute http(s) URL.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("SEO_SITE_URL must be an absolute http(s) URL without credentials.");
  }

  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.href;
}

export function socialImageUrl(siteUrl) {
  return siteUrl ? new URL(SOCIAL_IMAGE_FILE, siteUrl).href : null;
}

export function sitemapUrl(siteUrl) {
  return siteUrl ? new URL("sitemap.xml", siteUrl).href : null;
}

export function createWebApplicationSchema(siteUrl) {
  if (!siteUrl) return null;

  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": new URL("#application", siteUrl).href,
    name: "osu! Imagemap Builder",
    alternateName: "osu! Image Map Generator",
    description: SEO_DESCRIPTION,
    url: siteUrl,
    image: socialImageUrl(siteUrl),
    applicationCategory: "DesignApplication",
    applicationSubCategory: "Imagemap BBCode generator",
    operatingSystem: "Any",
    browserRequirements: "Requires a modern web browser with JavaScript enabled.",
    isAccessibleForFree: true,
    inLanguage: "en",
    offers: {
      "@type": "Offer",
      price: 0,
      priceCurrency: "USD",
    },
    featureList: [
      "Visual drag-and-resize link areas",
      "Edge snapping with overlap prevention",
      "Percentage-based osu! imagemap coordinates",
      "Local browser autosave",
      "Generated BBCode with one-click copy",
    ],
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createSitemap(siteUrl) {
  if (!siteUrl) return null;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${escapeXml(siteUrl)}</loc>`,
    "  </url>",
    "</urlset>",
    "",
  ].join("\n");
}

export function createRobots(siteUrl) {
  const lines = ["User-agent: *", "Allow: /"];
  if (siteUrl) lines.push("", `Sitemap: ${sitemapUrl(siteUrl)}`);
  return `${lines.join("\n")}\n`;
}
