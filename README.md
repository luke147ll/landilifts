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

### Record book and PR journey

Progress now opens with a record book: choose a saved exercise/setup, see the
heaviest complete set in this cycle, and open its PR journey. Recent milestones
link directly to their exercise and rep count. Journey comparisons use the same
rep count (or reps at zero-added-weight bodyweight), collapse repeated sets in
one scheduled day, and show only new cycle highs. Lower sets and logging gaps
are not labelled as declines. Week/day labels are program positions, not dates.
Dumbbell weights are shown per dumbbell; machine weights use the saved total.

This is a read-only view of existing logs, including switched-away variants.
There is no storage migration, rewrite, or change to the PR-only logging flow.
Incomplete sets do not become benchmarks. Prior-cycle last sets and carried
estimated 1RM are shown as a separate reference, never invented as dated or
actual-set milestones. The journey covers the current cycle, not raw archives.
The existing estimated-1RM PR notifications remain unchanged; same-rep cycle
milestones are a separate comparison. Volume, recovery, and the old comparison
board remain available under More details, with a saved-data coverage note.

Five additional tests cover same-rep milestones and gaps, distinct machine
histories, bodyweight/dumbbell units, cycle carryover, and empty/partial logs.
All 26 tests pass. Browser checks with an isolated synthetic profile cover
selection, opening/back navigation, rep filtering, milestone disclosure, reload,
and access to the retained analytics. The record book fits 390px and 320px phone
viewports; the date is hidden at the narrowest width to keep the header within
the screen. Production storage was not used.

### Rep picker

Reps now use the device's native select picker (wheel-style on supported iPhone
browsers), with 0–100 available directly and Type a number for whole numbers up
to 999. Merely opening or cancelling the picker does not log suggested reps.
Choosing a number saves only that set's reps through the existing save flow.
Custom entry validates before Save and can be cancelled. Controls use
`touch-action: manipulation` to suppress double-tap zoom while allowing pinch
zoom; editable fields remain at least 16px. Desktop browser checks do not
substitute for final touch testing on a physical iPhone.

### Personal recurring exercises

Use **Add / manage recurring exercises** above the workout list to choose a
movement, equipment/setup name, sets, rep range, and Monday/Wednesday/Friday.
The change starts at the selected program week/day, repeats on those days, and
continues into later cycles. Open an existing rule to edit or stop it from the
selected session onward. If the exact exercise/equipment/setup is already in
the shipped schedule, its existing prescription stays and no duplicate is
added. Use the Program tab to edit the core schedule separately.

Rules live in the per-profile `bts:custom:program:v1` key with effective-session
revisions. Custom logs use stable `extra:<id>` slots, leaving original numeric
slots untouched. They store their planned prescription and equipment identity,
so recorded sessions and swapped-away variants remain readable after editing
or stopping a rule, restoring a backup, or changing programs. A saved set or
completion protects that session's prescription; additional recorded sets are
never hidden by lowering a future set target. No defaults are automatically
logged and custom extras do not inherit the program's last-set failure cue.

The same exercise/equipment/setup shares PR and last-set history across days.
New rule keys and self-describing logs travel through existing JSON/cloud sync;
CSV and statistics include custom records. Cycle rollover archives the rule
configuration alongside raw logs, carries bests/last sets, and keeps the rules
active. Customization clears with the profile. There is no eager migration of
old logs. Older app builds cannot display these additions and should not be
used to edit the new backup format.

All 33 automated tests pass, including six recurring-program regressions for
effective days, duplicates, stable slots, swaps, preserved prescriptions,
backup/cycle carryover, invalid or failed saves, and profile isolation. Local
browser checks with synthetic records cover add, shared last-set history,
edit, reload, stop, and preserved history in the record book at phone width.

### Program overview and editing

The Program tab shows planned weekly working sets, workout and exercise counts,
and sets by primary muscle (including separate front, side and rear delts).
Direct sets count once under the assigned primary target. A separate indirect
column counts each planned set once for each mapped assisting muscle, using
secondary entries in the existing exercise map (without fractional weighting).
These are assisting-set counts, not equivalent direct sets; warm-ups are excluded.
Unknown movements are flagged as unmapped rather than given guessed contributions.
Tap a muscle to see both direct and indirect exercise sources, labeled separately. Totals
describe the plan, not completed volume, and work with sparse PR-only logging.

Edit a scheduled lift's movement, equipment/setup, primary muscle, sets or rep
range. Zero sets removes it; Restore original prescription reverses an edit.
Changes apply to that original movement on that weekday from the selected week
onward, including future cycles. Recurring extras are managed from the same panel
and also allow a primary muscle assignment. Saved or completed sessions retain
their prescription. Completing a workout/week snapshots customized prescriptions
and removals without creating logged sets.

Optional effective-session edits share the existing per-profile customization
key and backup/cloud/archive path. Original numeric log slots remain stable even
when rows are removed. No existing logs are migrated or rewritten. Exercise and
equipment identities retain separate PR histories.

Program regression tests cover totals, stable slots, effective scope, protected
legacy and customized sessions, restoration, completion snapshots, invalid saves,
backup and cycle carryover. Browser checks use isolated sample data.

### Optional lighter weeks

Program > Week intensity offers Original schedule, Normal training, or Lighter
week. Normal borrows regular effort/technique targets for the scheduled intro
weeks while preserving their exercises and rep ranges. Lighter uses half the
planned sets rounded up (minimum one), including personal extras, RPE 6–7
(3–4 reps in reserve), and no intensity techniques or failure badges. Load is
chosen by the lifter; saved weights are not recalculated.

Choices are stored by cycle and week in the existing customization key, travel
with backups/sync, and do not carry into a new cycle. Logged exercises and
completed sessions keep their saved prescription. Therefore a partly logged
week can show mixed prescriptions. Original schedule restores untouched slots.
No defaults or suggested sets are automatically logged.

### Recurring exercise picker

The add/edit recurring form includes a primary-muscle filter and movement picker.
Choices include the program, mapped exercises, saved recurring movements, and
additional glute options (hip thrusts, glute bridge and cable kickback). Choosing
a movement fills its name, equipment and primary muscle; choosing a different
movement clears the old setup label. Filtering alone never changes the current
prescription. Custom names, equipment and primary targets remain editable.

### Personal exercise library

Choose **+ Custom exercise** in the recurring movement picker. Enter a name,
equipment/setup and primary muscle, then **Save exercise to library** to keep it
without scheduling any work. Adding recurring work also saves that exercise to
the library. Entries appear in muscle filters with equipment/setup labels; an
exact identity updates its library entry while distinct setups stay separate.
The per-profile library uses the existing customization key, travels with
JSON/cloud backups, and remains available across cycles and after stopping a
recurring rule. Library-only saves never create workout logs or alter PRs.
