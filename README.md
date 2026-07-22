# Daylight Tide Finder

Static proof-of-concept web app. Find workable **daylight tide windows** at
NOAA prediction stations across California, Oregon, and Washington.

- Pure static bundle (HTML/CSS/JS) — no server, no API keys, no secrets.
- Fetches **live** station, datum, and prediction data directly from NOAA's
  browser-accessible Data API and Metadata API.
- Deployed via GitHub Pages.

## Local use
Serve the folder with any static server (do not open `index.html` from the
filesystem directly):

```
npx serve .
```
