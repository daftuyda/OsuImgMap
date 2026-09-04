import test from "node:test";
import assert from "node:assert/strict";

import {
  SEO_DESCRIPTION,
  createRobots,
  createSitemap,
  createWebApplicationSchema,
  normalizeSiteUrl,
  sitemapUrl,
  socialImageUrl,
} from "../scripts/seo.mjs";

test("normalizeSiteUrl preserves Pages subpaths and normalizes the homepage", () => {
  assert.equal(normalizeSiteUrl(""), null);
  assert.equal(
    normalizeSiteUrl("https://example.github.io/OsuImgMap?preview=1#editor"),
    "https://example.github.io/OsuImgMap/",
  );
  assert.equal(normalizeSiteUrl("https://example.com"), "https://example.com/");
});

test("normalizeSiteUrl rejects unsafe or non-absolute deployment URLs", () => {
  assert.throws(() => normalizeSiteUrl("/OsuImgMap/"), /absolute http\(s\)/);
  assert.throws(() => normalizeSiteUrl("ftp://example.com/app"), /absolute http\(s\)/);
  assert.throws(() => normalizeSiteUrl("https://user:pass@example.com/app"), /without credentials/);
});

test("SEO asset URLs remain inside the deployed Pages path", () => {
  const siteUrl = "https://example.github.io/OsuImgMap/";
  assert.equal(socialImageUrl(siteUrl), `${siteUrl}social-preview.png`);
  assert.equal(sitemapUrl(siteUrl), `${siteUrl}sitemap.xml`);
});

test("structured data describes the visible free web application without invented ratings", () => {
  const siteUrl = "https://example.com/";
  const schema = createWebApplicationSchema(siteUrl);
  assert.equal(schema["@type"], "WebApplication");
  assert.equal(schema.url, siteUrl);
  assert.equal(schema.description, SEO_DESCRIPTION);
  assert.equal(schema.applicationCategory, "DesignApplication");
  assert.equal(schema.isAccessibleForFree, true);
  assert.equal(schema.offers.price, 0);
  assert.equal("aggregateRating" in schema, false);
  assert.equal("review" in schema, false);
});

test("sitemap and robots output use the exact canonical URL", () => {
  const siteUrl = "https://example.github.io/OsuImgMap/";
  assert.match(createSitemap(siteUrl), new RegExp(`<loc>${siteUrl}</loc>`));
  assert.match(createRobots(siteUrl), new RegExp(`Sitemap: ${siteUrl}sitemap\\.xml`));
  assert.equal(createRobots(null), "User-agent: *\nAllow: /\n");
});
