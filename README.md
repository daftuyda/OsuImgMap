# osu! imagemap builder

A visual editor for creating responsive `[imagemap]` BBCode for osu! profiles, forum posts, and beatmap descriptions. Load an image, draw clickable rectangles, add destinations, and copy the finished markup.

Everything runs in the browser. Projects are autosaved to local storage and no image or link data is sent to an application server.

## Features

- Drag-and-resize link areas with mouse, touch, or pen
- Edge snapping with hard overlap prevention across every editing method
- Percentage-based geometry that stays aligned as the preview resizes
- Numbered area list and precise X/Y/width/height controls
- Destination validation and optional hover text
- Keyboard selection, nudging, and deletion
- Generated BBCode with robust clipboard fallback
- Undo after deleting an area
- Confirmed **Clear all** reset for the image and every link area
- Local autosave between browser sessions
- Responsive, accessible interface with reduced-motion support
- Search, Open Graph, and social-card metadata with WebApplication structured data
- Automatic GitHub Pages deployment from `main`
- No runtime framework or CDN dependencies

## Quick start

You need [Node.js](https://nodejs.org/) `20.19+` or `22.12+`.

```bash
npm install
npm run dev
```

Open the local address printed by Vite, usually `http://localhost:5173`.

To create and inspect a production build:

```bash
npm run build
npm run preview
```

The generated site is written to `dist/`. Relative asset paths are enabled, so the build can be hosted from a subdirectory as well as a domain root.

## Deploy to GitHub Pages

The included workflow tests, builds, and deploys the site whenever `main` is updated.

1. Push this repository to GitHub.
2. Open **Settings → Pages** in the repository.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main`, or run **Deploy to GitHub Pages** manually from the **Actions** tab.

The live URL appears in the workflow's deployment summary. The workflow asks GitHub Pages for the exact public URL and base path at build time, so project sites such as `https://user.github.io/repository/` and custom domains both receive correct asset paths, canonical metadata, social-image URLs, and sitemap entries.

## SEO and site URL

Production SEO URLs are injected during the build instead of being guessed or hard-coded. GitHub Pages supplies `SEO_SITE_URL` automatically through the deployment workflow.

For another host, provide the final public homepage URL when building:

```bash
SEO_SITE_URL=https://your-domain.example/tools/imagemap npm run build
npm run verify:build
```

On PowerShell, set it for the current session first:

```powershell
$env:SEO_SITE_URL = "https://your-domain.example/tools/imagemap"
npm run build
npm run verify:build
```

When a public URL is present, the build creates an absolute canonical URL, Open Graph and Twitter image URLs, WebApplication JSON-LD, `sitemap.xml`, and a sitemap declaration in `robots.txt`. A local build deliberately omits URL-dependent tags rather than publishing placeholders. After the first deployment, submit the generated sitemap URL in Google Search Console.

For a GitHub project site, the generated file lives at `/repository/robots.txt`. Crawlers only treat `/robots.txt` at the host root as authoritative, and that root is controlled by GitHub, so submit `/repository/sitemap.xml` directly in Search Console. Root-domain and custom-domain deployments do not have that limitation.

## How to use it

1. Paste a direct, public image URL and choose **Load image**.
2. Choose **Add link area** for every clickable part of the image.
3. Drag an area to move it and pull its handles to resize it. Side handles snap lightly; corner handles align both axes. Areas may touch but cannot overlap.
4. Select an area to add a destination URL and optional hover text. Use `#` when an area should not navigate anywhere.
5. Choose **Copy BBCode**, then paste the result into a supported osu! editor.
6. Use **Clear all** to remove the image, link areas, and saved browser project after confirming the reset.

An output with two areas looks like this:

```text
[imagemap]
https://example.com/banner.png
10 12.5 30 18 https://osu.ppy.sh/users/1 View profile
55 60 25 15 # Decorative area
[/imagemap]
```

The four numbers on each area line are `X Y WIDTH HEIGHT`, expressed as percentages from `0` to `100`. See the [official osu! BBCode guide](https://osu.ppy.sh/wiki/en/BBCode#imagemap) for the complete format.

## Keyboard controls

When a link area on the preview or in the area list is focused:

| Key | Action |
| --- | --- |
| `Enter` or `Space` | Select the area |
| Arrow keys | Move by `0.5%` |
| `Shift` + Arrow keys | Move by `2%` |
| `Alt` + Arrow keys | Move by `0.1%` |
| `Delete` or `Backspace` | Delete the area |
| `Escape` | Clear the current selection |

Exact resizing is available through the numeric fields in the inspector.

## Project structure

```text
.
├── .github/workflows/
│   ├── ci.yml                # Pull-request and push checks
│   └── pages.yml             # GitHub Pages deployment
├── public/
│   ├── favicon.svg           # App and manifest icon
│   ├── site.webmanifest      # Install and app identity metadata
│   └── social-preview.*      # 1200 × 630 social card and SVG source
├── scripts/
│   ├── seo.mjs               # Canonical, schema, robots, and sitemap helpers
│   └── verify-build.mjs      # Production SEO integrity checks
├── src/
│   ├── app.js                # Editor state and interactions
│   ├── core.js               # Geometry constraints, validation, and BBCode helpers
│   └── styles.css            # Responsive visual system
├── tests/
│   ├── core.test.js          # Editor behavior unit tests
│   └── seo.test.js           # Deployment URL and metadata unit tests
├── index.html                # Semantic application shell
├── package.json              # Development commands
└── vite.config.js            # Portable production build settings
```

## Development

Run the unit tests:

```bash
npm test
```

Run the full test-and-build check used by CI:

```bash
npm run check
```

The editor intentionally uses browser-native JavaScript and Pointer Events. Geometry constraints, validation, and BBCode generation live in `src/core.js` so they can be tested without a browser.

## Image hosting notes

- The source must be a direct `http://` or `https://` image URL, not a page containing an image.
- The URL must remain publicly accessible to osu! visitors.
- Some hosts block hotlinking. If an image loads here but not on osu!, move it to a host that allows external embedding.
- The built-in sample is only an editor demonstration; replace it with your own hosted artwork before publishing.

## Contributing

1. Create a branch from `main`.
2. Keep UI changes usable with keyboard and touch input.
3. Add or update tests for changes to geometry, validation, or output formatting.
4. Run `npm run check` before opening a pull request.

Bug reports are most useful when they include the browser, viewport size, image aspect ratio, and steps needed to reproduce the issue. Do not include private image URLs.

## Privacy and project status

Image URLs and link-area data are kept in the browser's local storage. Loading an image still sends a normal browser request to the image's host. Clearing site data removes the saved project.

This repository does not currently declare an open-source license. Add an appropriate `LICENSE` file before distributing modified copies.

## Disclaimer

This is an unofficial community project and is not affiliated with osu! or ppy Pty Ltd. “osu!” is a trademark of ppy Pty Ltd.
