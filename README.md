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

## Session exercise substitutions (development branch)

In Train, expand a movement and choose **Change exercise / equipment**. Pick a
suggested substitute or type an exercise, select equipment, and optionally name
its machine/setup. Previously used setups can be selected again. This changes
only that week/day slot in the current cycle; `public/data.js` and both profiles'
12-week schedules remain unchanged. The selected movement retains the slot's
sets/reps prescription, with coaching notes explicitly labeled as scheduled.

Each exercise name + equipment type + optional setup label has separate PRs,
last-logged hints, and Progress history. A setup label distinguishes machines
with different stacks or sleds. Switching after logging preserves those sets
under their original identity; switching back restores them. Mark complete and
Finish workout do not fill untouched sets, so logging only a PR is supported.
The per-set Done button still explicitly accepts the displayed defaults.

### Storage and compatibility

- Existing `bts:log:wN:day` keys and `done`/`sets` fields remain. New optional
  `exercise` metadata identifies the active movement; `variants` retains other
  identities used in that slot. Backups and cloud sync include the entire record.
- Legacy logs are resolved on read from their original scheduled exercise and
  stored `resType` (or the original equipment inference); no eager rewrite or
  new program migration runs merely because this feature loads.
- Name-only archived bests/last sets have no equipment provenance. They retain
  the historical default equipment association. Previously mixed equipment
  cannot be reconstructed automatically; new named setups start separately.
- Cycle rollover archives raw records including variants and carries each
  identity's best/last sets. Read/archive/baseline failures stop before clearing.
- Pending saves capture their payload and are flushed before export/sync or
  account clearing. Failed saves remain retryable. Switching profiles while
  sync fails keeps the current profile and local data.
- JSON backups retain all metadata. CSV exports add Equipment and Setup columns
  and include switched-away records. Older app versions do not understand
  variants; do not use an old client to edit new-format records.
- Recovery estimates use known actual exercise mappings. Custom movements with
  no detailed muscle mapping still have PR/history/volume, but do not receive
  invented muscle-readiness estimates. Zero-added-weight bodyweight PRs retain
  the existing weighted-metric limitations.

### Validation

Run `node --test tests/exercise-history.test.cjs` (Node's built-in runner; no
installation or production service required). Tests execute the app's functions
with synthetic storage and a minimal DOM fixture. They cover legacy reads,
exercise/equipment isolation, repeated swaps, sparse logging, save/reload,
backup/CSV, progression, cycle/legacy migration, read/write failures, and
successful/offline profile switching.

Browser checks were also performed against localhost with synthetic data and
an in-memory sync endpoint: substitutions, original-set restoration, separate
Progress rows, completion without extra sets, named setups, reload persistence,
unchanged next-week scheduling, and a 390-pixel phone viewport. Production D1 and
Cloudflare deployment were not used for testing.

### Starting sled / machine weight

The workout equipment picker now accepts a starting weight (0–10,000 lb,
including decimals) and a loading mode: total added weight or plates per side.
For example, configure Hack Squat as Machine, starting weight 116 lb, plates on
each side: tapping +45 adds two plates and records 206 lb total. Reuse the named
setup from Previously used setups. A weight stack should use total added weight;
leave its starting weight at zero when the displayed stack weight already
includes the machine resistance.

The starting weight is calculator metadata, not a new PR identity. Editing it
never recalculates previously saved totals. Existing barbell/leg-press defaults
(45/118 lb) still apply when no custom value was saved. A legacy total below the
configured starting weight is flagged instead of silently changed. Equipment
settings travel with JSON backups, cloud records, and cycle baselines; CSV adds
Starting weight and Loading mode columns. The field is not applied to dumbbells
or bodyweight exercises. Six additional regression tests cover the 116 + 45 + 45
case, single-stack loading, lower bounds, metadata edits, persistence/rollover,
and legacy/zero/decimal/invalid values.
