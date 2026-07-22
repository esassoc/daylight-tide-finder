# Daylight Tide Finder

A single-page web app that finds workable **daylight tide windows** at NOAA
prediction stations across California, Oregon, and Washington. Field crews pick
a station, a tide threshold, and a work mode (low- or high-tide), and the app
shows which upcoming dates have a long-enough continuous window that also falls
within daylight.

**Live:** https://esassoc.github.io/daylight-tide-finder/

It is a fully static, browser-only app — no server, no API keys, no secrets. It
fetches live station, datum, and tide-prediction data directly from NOAA CO-OPS
(`api.tidesandcurrents.noaa.gov`) and renders the station map with Leaflet +
OpenStreetMap tiles.

## Quick start

Requires Node.js 22.13+.

```sh
npm ci
npm run dev      # start the Vite dev server
npm run build    # produce static-dist/
npm run preview  # serve the production build locally
npm test         # build, then verify the static bundle (no server, calls NOAA)
```

## Project layout

| Path | Purpose |
| --- | --- |
| `static/index.html` | HTML shell (title, meta, `theme-color`, root div) |
| `static/main.tsx` | Vite entry — mounts `<Home/>`, sets font CSS vars |
| `app/page.tsx` | The entire UI and NOAA data logic (single component) |
| `app/globals.css` | All styling, including the ESA brand tokens in `:root` |
| `public/favicon.svg` | ESA-colored favicon |
| `vite.config.ts` | Static build config (`root: static`, `base: ./`, `outDir: static-dist`) |
| `tests/static-build.test.mjs` | Asserts the build is server-free and calls NOAA directly |

## Deployment

Automated via GitHub Actions → GitHub Pages. See
[STATIC_DEPLOYMENT.md](STATIC_DEPLOYMENT.md). Push to `main` and it redeploys.

## Branding

The UI uses the ESA design palette. All colors are defined as CSS custom
properties in the `:root` block of `app/globals.css`. See [CLAUDE.md](CLAUDE.md)
for the token mapping and its source (the ESA TalentBridge design system).
