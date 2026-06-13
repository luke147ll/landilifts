# Landi Lifts

A private 3-day strength tracker for the two of us. It runs the modified
Intermediate/Advanced program (Mon full-body strength, Fri upper hypertrophy,
Sat lower hypertrophy), logs weight × reps per set, and charts progression both
per-movement and rolled up by muscle group.

No framework, no build step — just static files. Vanilla HTML/CSS/JS.

## Structure

```
public/                     the deployed static site (Worker serves this folder)
  index.html                markup + <head> (PWA meta, fonts, links to css/js)
  styles.css                all styling (Catppuccin Mocha, Space Mono + JetBrains Mono)
  data.js                   window.PROGRAM (12-week plan) + window.EX_GROUP (muscle map)
  app.js                    all logic: training log, rest timer, progression charts,
                            backup/restore, and the localStorage persistence shim
  manifest.webmanifest      PWA manifest (installable)
  icons/                    app icons (180 / 192 / 512 + apple-touch-icon)
wrangler.jsonc              Cloudflare Worker config (static-assets, serves public/)
```

Editing cheat-sheet:
- **Change the program** (exercises, sets, reps, RPE, subs, notes) -> `data.js`
- **Change the look** -> `styles.css`
- **Change behaviour** (metrics, timer, charts, muscle grouping) -> `app.js`
  - Muscle-group rollups are driven by `window.EX_GROUP` in `data.js`; split a
    group finer (e.g. Quads vs Hamstrings) by editing those values and the
    `GROUP_ORDER` array in `app.js`.

## Run it locally

Because it uses `localStorage` and fetches webfonts, serve it over http rather
than opening the file directly:

```bash
cd public
python3 -m http.server 8080
# then open http://localhost:8080
```

Or with Wrangler (mirrors production exactly):

```bash
npx wrangler dev
```

## Git setup

```bash
cd landilifts
git init
git add .
git commit -m "Landi Lifts: initial commit"
git branch -M main
# create an empty repo on GitHub first (e.g. landilifts), then:
git remote add origin https://github.com/<you>/landilifts.git
git push -u origin main
```

## Deploy on Cloudflare (Worker, connected to Git)

This repo is connected to a Cloudflare **Worker** (static assets) named
`landilifts`. `wrangler.jsonc` tells it to serve the `public/` folder. Every
`git push` to `main` triggers Workers Builds, which runs `wrangler deploy` and
publishes to:

```
https://landilifts.luke-landi.workers.dev
```

To deploy manually (no push needed):

```bash
npx wrangler deploy
```

(Optional) **Custom domain:** Worker -> *Settings* -> *Domains & Routes* -> add
a custom domain.

## Install to your phone

Open the deployed URL in Safari (iOS) or Chrome (Android) -> Share ->
**Add to Home Screen**. It launches full-screen from the Landi Lifts icon.

## Data & backups

- Logs are stored in the browser's `localStorage`, so they live **per device /
  per browser** and are not shared between phones automatically.
- To move data (or back it up): in the app tap **i -> Download backup file
  (.json)** on one device, then **i -> Restore from a backup file** on the other.
- This is also how you bring over anything logged in the original Claude version.

## Possible next tune-ups

- Add a service worker for guaranteed offline use (currently relies on browser
  cache; external webfonts fall back to monospace when offline).
- Self-host the fonts to drop the Google Fonts dependency.
- Split muscle groups finer, add per-lift target/goal lines, or a CSV import.
