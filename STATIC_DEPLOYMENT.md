# Static deployment guide

`npm run build` produces a browser-only build of the Daylight Tide Finder. It
has no application server, no API keys, and no runtime secrets. The browser
requests live station metadata, datum availability, and tide predictions
directly from NOAA CO-OPS.

## Build the distributable folder

Install Node.js 22 or newer, then run:

```sh
npm ci
npm run build
```

The complete deployable site lands in `static-dist/`. Upload the **contents of
that folder** to any static web host. Do not distribute the source folder or
`node_modules/`.

To inspect the production bundle locally:

```sh
npm run preview
```

Use the local URL printed by Vite. Opening `index.html` directly from the
filesystem is not recommended; browsers restrict some module and data requests
for `file://` pages.

## GitHub Pages (this repo's live deployment)

Deployment is automated by `.github/workflows/deploy-pages.yml`. On every push
to `main`, GitHub Actions runs `npm ci` and `npm run build`, then publishes
`static-dist/` to Pages. Pages is configured with **Source: GitHub Actions** (no
compiled output is committed to the repo).

Live site: https://esassoc.github.io/daylight-tide-finder/

To ship a change: edit source, push to `main`, and the workflow redeploys in
~1–2 minutes. The build uses relative asset paths, so it works from a repository
subpath as well as a custom domain.

## Any other static host (Netlify, Cloudflare Pages, S3, …)

- Build command: `npm run build`
- Output directory: `static-dist`
- Node version: 22 or newer
- Environment variables: none

Any host that serves `index.html` and the generated `assets/` directory over
HTTPS will work. Keep every generated file together and preserve the directory
structure. For Netlify Drop, drag the built `static-dist/` folder onto
<https://app.netlify.com/drop>.

## Operational notes

- The app needs internet access in each user's browser for NOAA data and
  OpenStreetMap tiles.
- NOAA may occasionally be slow or unavailable; the app reports that state
  without exposing credentials because none are used.
- Tide predictions remain planning data. Users should verify local conditions
  and field safety before work.
