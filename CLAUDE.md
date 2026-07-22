# CLAUDE.md — Daylight Tide Finder

Guidance for Claude Code working in this repo. Read this first.

## What this is

A single-page, fully static web app that finds workable **daylight tide
windows** at NOAA prediction stations in CA/OR/WA. Field crews choose a station,
tide threshold, work mode (low/high tide), minimum window length, and datum; the
app shows which upcoming dates have a long-enough continuous tide window that
also falls within daylight.

- **Live:** https://esassoc.github.io/daylight-tide-finder/ (GitHub Pages, public)
- **Repo:** `esassoc/daylight-tide-finder`
- No server, no API keys, no secrets. The browser calls NOAA CO-OPS
  (`api.tidesandcurrents.noaa.gov`) directly for stations, datums, and
  predictions, and draws the map with Leaflet + OpenStreetMap tiles.

## Stack & commands

Vite + React 19 + TypeScript, Tailwind v4 (via `@tailwindcss/postcss`), Leaflet.
Node.js 22.13+.

```sh
npm ci            # install (uses package-lock.json)
npm run dev       # Vite dev server (root is static/)
npm run build     # -> static-dist/
npm run preview   # serve the production build
npm run format    # Prettier --write (ESA config: 4-space, printWidth 180)
npm test          # build + assert the bundle is server-free and calls NOAA
```

Formatting is Prettier-managed (`.prettierrc` mirrors the ESA `.prettierrc` used
in wave-runup / TalentBridge). `*.md` and `static-dist/` are ignored
(`.prettierignore`). Run `npm run format` before committing.

## Architecture (small and flat — don't over-structure it)

- `static/index.html` — HTML shell: `<title>`, meta description, `theme-color`
  (`#3a524e`), favicon link, the ESA font-suite `<link>` tags, `<div id="root">`,
  and the module script.
- `static/main.tsx` — Vite entry. Mounts `<Home/>` from `app/page.tsx` and points
  both legacy `--font-geist-sans` / `--font-geist-mono` CSS vars at DM Sans (the
  single UI face). This replaces what a Next.js layout used to do.
- `app/page.tsx` — **the entire app**: one client component (~950 lines once
  Prettier-formatted; it was authored as terse one-liners)
  (`"use client"` at the top; harmless in a pure client build). Contains all
  state, the NOAA fetch logic, the calendar/list/month views, the Leaflet map,
  and the tide-signature chart. Only imports `react` and `leaflet` types.
- `app/globals.css` — **all styling**, including the brand tokens (see below).
- `vite.config.ts` — static build config: `root: "static"`,
  `publicDir: "../public"`, `base: "./"` (relative paths so it works from a
  Pages subpath), `outDir: "../static-dist"`.
- `tests/static-build.test.mjs` — guards the static guarantee: asserts
  relative `./assets/*.js`, no `/_next/`, no `/api/noaa/`, that the bundle
  contains `api.tidesandcurrents.noaa.gov`, and that there is no `server/` dir.

## Branding — ESA palette

The UI uses ESA's design palette, sourced from the ESA **TalentBridge** design
system (`TalentBridge.Web/src/scss/tokens/_colors.scss`). All colors are CSS
custom properties in the `:root` block of `app/globals.css`. To adjust the
theme, edit those tokens (and note there are also alpha-variant literals of the
same hues throughout the file — keep them in sync if you change a base hue).

Current token → ESA mapping:

| Token | Value | ESA role |
| --- | --- | --- |
| `--kelp` (primary/headers) | `#3a524e` | green-800 |
| `--ink` (text) | `#1e2c2e` | green-950 |
| `--marine` (links, tide curve, coast) | `#2e8c7a` | teal |
| `--water` (map water) | `#cfe1de` | green-200 |
| `--seafoam` (highlights) | `#e6f0ee` | green-100 |
| `--orange` (accent / CTA) | `#f48156` | **ESA primary coral** |
| `--muted` | `#656565` | gray-600 |
| `--border` | `#bdbdbd` | gray-300 |
| `--sand` (page background) | `#ffffff` | white |
| `--paper` (cards/panels) | `#f3f8f7` | green-50 tint |

### Fonts

The app uses **two** faces — the ESA UI + display pair (matching wave-runup /
TalentBridge), loaded from Google Fonts via `<link>` tags in `static/index.html`:

- **DM Sans** — everything UI: `body`, controls, and all the uppercase
  micro-labels / eyebrows (rendered as letter-spaced DM Sans overlines, the ESA
  pattern). `main.tsx` binds **both** legacy Geist vars (`--font-geist-sans` and
  `--font-geist-mono`) to DM Sans, so the ~40 `var(--font-geist-mono)` usages
  scattered through `globals.css` all resolve to DM Sans without a per-rule edit.
- **Domine** — decorative serif headings. Exposed as `--font-serif` in the
  `:root` of `app/globals.css`; every heading that used to say `Georgia,serif`
  now references `var(--font-serif)`.

There is intentionally **no monospace face** — ESA reserves mono for code, not UI.
Don't reintroduce one for labels or numeric readouts.

### Logo & favicon

- The header brand mark is the **ESA coral-tile lockup** — a coral (`--orange`,
  `#f48156`) rounded tile with the white ESA glyph — inlined as SVG in
  `app/page.tsx` (class `.esa-mark`), sitting next to the DM Sans wordmark. This
  is the same lockup ESA apps use in their app-shell topbar.
- `public/favicon.svg` is the standalone version of that mark (coral tile +
  white glyph, literal hex since a favicon can't resolve CSS vars).
- `public/esa-logo.svg` is the raw ESA glyph (`fill="currentColor"`) kept as the
  reusable brand asset.
- `theme-color` in `static/index.html` is `#3a524e` (ESA green-800).

## Deployment

Automated: `.github/workflows/deploy-pages.yml` runs on push to `main` —
`npm ci` → `npm run build` → upload `static-dist/` → `actions/deploy-pages`.
Pages **Source is set to "GitHub Actions"**; the compiled output is never
committed (`static-dist/` is gitignored). Just push to `main`.

## History & context

- This started as an OpenAI "Sites" full-stack starter (Next.js/RSC on
  Cloudflare via `vinext`, with D1/Drizzle and ChatGPT-auth helpers). A
  colleague (Damian) ported it to a server-free static build that calls NOAA
  directly from the browser.
- When moving it to ESA, the OpenAI-Sites/Cloudflare/Next dynamic apparatus was
  removed (it could only build inside OpenAI's Linux sandbox). What remains is a
  clean static Vite/React app. Damian retains the original full-stack version if
  the dynamic mode is ever needed again.
- The app was then rebranded from its original warm "field-notebook" palette to
  the ESA palette (full rebrand: brand hues + surfaces), and finally aligned with
  the standard ESA app chrome (wave-runup / TalentBridge): the ESA type suite
  (DM Sans / Domine / JetBrains Mono), the coral-tile ESA logo lockup, and the
  ESA-mark favicon.

## Conventions & gotchas

- Keep it a small static app. Resist adding a server, a router, or a component
  framework unless there's a real need — the whole UI intentionally lives in one
  component.
- Preserve the static guarantee: never introduce a same-origin `/api/...` call
  or anything that needs a backend. `npm test` will fail if you do.
- Keep `base: "./"` in `vite.config.ts` — Pages serves from the
  `/daylight-tide-finder/` subpath, which relies on relative asset URLs.
- Tide data is live from NOAA; nothing is bundled or cached at build time.
