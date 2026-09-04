import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  SEO_DESCRIPTION,
  SEO_TITLE,
  SOCIAL_IMAGE_ALT,
  SOCIAL_IMAGE_FILE,
  createSitemap,
  createWebApplicationSchema,
  normalizeSiteUrl,
  sitemapUrl,
  socialImageUrl,
} from "./seo.mjs";

const distDirectory = path.resolve("dist");
const html = await readFile(path.join(distDirectory, "index.html"), "utf8");
const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
const robots = await readFile(path.join(distDirectory, "robots.txt"), "utf8");
const siteUrl = normalizeSiteUrl(process.env.SEO_SITE_URL);

function tagAttributes(tagName) {
  const tags = [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))];
  return tags.map(([tag]) =>
    Object.fromEntries(
      [...tag.matchAll(/\b([^\s=/>]+)\s*=\s*"([^"]*)"/g)].map((match) => [match[1], match[2]]),
    ),
  );
}

function selectedAttributeValues(tagName, selectorName, selectorValue, resultName) {
  return tagAttributes(tagName)
    .filter((attributes) => attributes[selectorName] === selectorValue)
    .map((attributes) => attributes[resultName])
    .filter((value) => value !== undefined);
}

function metaContent(attributeName, attributeValue) {
  const values = selectedAttributeValues("meta", attributeName, attributeValue, "content");
  assert.ok(values.length <= 1, `Expected no more than one ${attributeName}="${attributeValue}" meta tag.`);
  return values[0] ?? null;
}

assert.match(html, new RegExp(`<title>${SEO_TITLE}</title>`));
assert.equal([...html.matchAll(/<title\b[^>]*>/gi)].length, 1);
assert.equal(metaContent("name", "description"), SEO_DESCRIPTION);
assert.equal(metaContent("name", "robots"), "index, follow, max-image-preview:large, max-snippet:-1");
assert.equal(metaContent("property", "og:title"), SEO_TITLE);
assert.equal(metaContent("property", "og:description"), SEO_DESCRIPTION);
assert.equal(metaContent("name", "twitter:card"), "summary_large_image");
const manifestHrefs = selectedAttributeValues("link", "rel", "manifest", "href");
assert.equal(manifestHrefs.length, 1);
assert.match(manifestHrefs[0], /site\.webmanifest$/);
assert.doesNotMatch(head, /%[A-Z0-9_]+%|https?:\/\/(?:localhost|example\.(?:com|test))/i);
assert.match(robots, /^User-agent: \*\r?\nAllow: \//);

const manifest = JSON.parse(await readFile(path.join(distDirectory, "site.webmanifest"), "utf8"));
assert.equal(manifest.name, "osu! Imagemap Builder");
assert.equal(manifest.id, "./");
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
for (const icon of manifest.icons) {
  assert.equal(typeof icon.src, "string");
  await access(path.join(distDirectory, icon.src));
}

const socialImage = await readFile(path.join(distDirectory, SOCIAL_IMAGE_FILE));
assert.equal(socialImage.subarray(1, 4).toString("ascii"), "PNG");
assert.equal(socialImage.readUInt32BE(16), 1200);
assert.equal(socialImage.readUInt32BE(20), 630);

const canonicalUrls = selectedAttributeValues("link", "rel", "canonical", "href");
const structuredDataMatches = [
  ...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
];

if (siteUrl) {
  const manifestUrl = new URL(manifestHrefs[0], siteUrl);
  assert.equal(manifestUrl.href, new URL("site.webmanifest", siteUrl).href);
  for (const property of ["id", "start_url", "scope"]) {
    assert.equal(new URL(manifest[property], manifestUrl).href, siteUrl);
  }
  for (const icon of manifest.icons) {
    assert.equal(new URL(icon.src, manifestUrl).href, new URL(icon.src.replace(/^\.\//, ""), siteUrl).href);
  }

  const site = new URL(siteUrl);
  const builtAssets = [
    ...selectedAttributeValues("script", "type", "module", "src"),
    ...selectedAttributeValues("link", "rel", "stylesheet", "href"),
  ];
  assert.ok(builtAssets.length >= 2);
  for (const asset of builtAssets) {
    const resolved = new URL(asset, siteUrl);
    assert.equal(resolved.origin, site.origin);
    assert.ok(resolved.pathname.startsWith(site.pathname));
  }

  assert.deepEqual(canonicalUrls, [siteUrl]);
  assert.equal(metaContent("property", "og:url"), siteUrl);
  assert.equal(metaContent("property", "og:image"), socialImageUrl(siteUrl));
  assert.equal(
    metaContent("property", "og:image:secure_url"),
    siteUrl.startsWith("https://") ? socialImageUrl(siteUrl) : null,
  );
  assert.equal(metaContent("property", "og:image:type"), "image/png");
  assert.equal(metaContent("property", "og:image:width"), "1200");
  assert.equal(metaContent("property", "og:image:height"), "630");
  assert.equal(metaContent("property", "og:image:alt"), SOCIAL_IMAGE_ALT);
  assert.equal(metaContent("name", "twitter:image"), socialImageUrl(siteUrl));
  assert.equal(metaContent("name", "twitter:image:alt"), SOCIAL_IMAGE_ALT);
  assert.ok(
    head.indexOf('property="og:image"') < head.indexOf('property="og:image:type"'),
    "og:image must precede its structured image properties",
  );
  assert.ok(
    head.indexOf('name="twitter:image"') < head.indexOf('name="twitter:image:alt"'),
    "twitter:image must precede its alt text",
  );
  assert.equal(structuredDataMatches.length, 1);
  assert.deepEqual(JSON.parse(structuredDataMatches[0][1]), createWebApplicationSchema(siteUrl));

  const sitemap = await readFile(path.join(distDirectory, "sitemap.xml"), "utf8");
  assert.equal(sitemap, createSitemap(siteUrl));
  assert.match(robots, new RegExp(`Sitemap: ${sitemapUrl(siteUrl).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
} else {
  assert.deepEqual(canonicalUrls, []);
  assert.equal(metaContent("property", "og:url"), null);
  assert.equal(metaContent("property", "og:image"), null);
  assert.equal(metaContent("property", "og:image:secure_url"), null);
  assert.equal(metaContent("property", "og:image:type"), null);
  assert.equal(metaContent("name", "twitter:image"), null);
  assert.equal(structuredDataMatches.length, 0);
  assert.doesNotMatch(robots, /^Sitemap:/m);
}

console.log(`SEO build verified${siteUrl ? ` for ${siteUrl}` : " without a placeholder site URL"}.`);
