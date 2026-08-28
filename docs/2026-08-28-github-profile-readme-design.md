# GitHub profile README for `amims71` — design

**Date:** 2026-08-28
**Status:** approved design, pending implementation plan
**Target repo:** `amims71/amims71` (new; does not exist yet)
**Explicit non-goal:** any modification to `amims71/amims71.github.io`

## 1. Purpose

Render a custom terminal-themed profile on `github.com/amims71`, in the visual
language already established by `amims71.github.io`, driven by real GitHub data
that refreshes itself daily.

Modelled on `github.com/jeslor` at the user's request. `jeslor/jeslor` is
MIT-licensed; its source was read to understand the approach, and the glider /
probe-beam idea in §6.1 is adopted from it. `generate.mjs` is nonetheless to be
written independently rather than copied, because every substantive parameter —
palette, panel content, ASCII algorithm, theme count, failure behaviour —
differs. That profile's technique —
a small Node generator emitting animated SVG cards, committed to the repo and
refreshed by a scheduled Action — is adopted. Its palette, panel content, ASCII
algorithm, and failure behaviour are not; each is replaced for reasons recorded
below.

## 2. Constraints

- **C1.** `amims71/amims71.github.io` must not be modified. The two repos share
  no files, submodules, or workflows. The only relationship is an outbound
  hyperlink from the profile README to the Pages site.
- **C2.** No third-party rendering services (`github-readme-stats` and friends).
  All images are generated in-repo and served from `raw.githubusercontent.com`.
- **C3.** No fabricated data may ever be published. See §7.
- **C4.** No phone number, and no email address, is published anywhere in the
  repo. (User decision, 2026-08-28.)
- **C5.** Private repositories are never linked and never described in a way that
  exposes business logic. They may be named and marked `[private]`, matching the
  convention already used on the Pages site.

## 3. Repository layout

```
amims71/
├── README.md                          hand-written
├── generate.mjs                       generator
├── avatar.png                         committed copy of the GitHub avatar
├── card.svg                           generated, committed
├── heatmap.svg                        generated, committed
├── package.json                       single dependency: jimp ^1.6
├── docs/
│   └── 2026-08-28-github-profile-readme-design.md   this file
└── .github/
    └── workflows/
        └── cards.yml
```

Generated SVGs are committed deliberately: GitHub's markdown renderer cannot
execute a generator, so the committed artifact *is* the delivery mechanism.

## 4. Palette

Lifted verbatim from `amims71.github.io/index.html` so the profile and the Pages
site read as one continuous surface.

| Token    | Hex       | Use                                            |
|----------|-----------|------------------------------------------------|
| `bg`     | `#0b0f0a` | card background base                           |
| `bg2`    | `#0e150d` | inner panel fill                               |
| `green`  | `#00ff66` | animated border, prompt text, heatmap hot cell |
| `fg`     | `#b6ffb0` | body / value text                              |
| `dim`    | `#5e7a5a` | leader dots, section labels, month labels      |
| `cyan`   | `#7ee7ff` | key labels, scan beam, glider                  |
| `amber`  | `#ffb86b` | peak-day marker flash                          |
| `line`   | `#1a2418` | dividers, panel strokes                        |

Heatmap ramp: `#0f1a0e → #14351a → #1c6b33 → #00c94f → #00ff66`.

**Dark only — no light variant.** Green-on-black CRT has no honest light-mode
translation. The card is a self-framed terminal window, so it reads as
deliberate against GitHub's white background. This halves the generator's
surface area versus jeslor's four-SVG output.

## 5. `card.svg`

1180px wide, height driven by content. Two panels inside a terminal chrome.

### 5.1 Chrome
- 46px title bar, `bg2` fill, `line` underline.
- Three traffic-light circles `#ff5f56` / `#ffbd2e` / `#27c93f`.
- Centre: `amims71@github ~ % ./profile.sh --live` in `dim`.
- Right: pulsing `green` dot + `LIVE`.
- Full-card rounded border filled with an animated gradient cycling
  `green → cyan → green` over 9s, soft-glow filtered.
- Scanline pattern overlay at 0.045 opacity.
- A `cyan` beam, 36px tall with a gradient falloff, translating from `y=-30` to
  `y=HEIGHT+30` on a 7s loop.

### 5.2 Left panel — `VISUAL.MAP`

ASCII portrait, 54 columns × 42 rows, ramp `" .:-=+*#%@"`, filled with a
`cyan → green` linear gradient. Each row is one `<text>` element with
`textLength` + `lengthAdjust="spacingAndGlyphs"` so the block always fits the
panel exactly regardless of font.

**Algorithm** (validated against the real avatar on 2026-08-28; see §5.2.1):

1. Center-crop the source to 74% width × 82% height, offset 14px upward, to
   exclude the wall clock and bookshelf. Validated as
   `-gravity center -crop 74x82%+0-14` on the 460×460 source; the offset is in
   pixels, not percent, and must be rescaled if the avatar is ever replaced at a
   different resolution.
2. Greyscale, then full-range auto-level (histogram stretch).
3. Resize to 54×42.

   The recipe above was validated with ImageMagick, but the generator depends on
   `jimp` so that CI needs no system packages. The implementer must reproduce,
   not assume, the equivalence: ImageMagick `-auto-level` corresponds to jimp's
   `.normalize()`, and `-colorspace Gray` to `.greyscale()`. Compare the
   resulting character grid against the validated V4 output recorded in §5.2.2
   before accepting it.
4. Density from **inverted luminance**: `d = 1 - L`. Dark pixels are dense.
5. Multiply by a soft elliptical mask: `d *= 1 - smoothstep(0.74, 1.00, r)`,
   where `r` is the radius normalised so `r=1` is the inscribed ellipse.
6. Quantise into the ramp.

#### 5.2.2 Validated reference output

The V4 run of the algorithm above, against the current avatar, produced the
grid below. The implementation is correct when its output is recognisably this
portrait: hair as a dense `@`/`%` cap, eye sockets and nostrils as darker marks
against lighter cheeks, shirt and shoulders light, and a clean empty margin
outside the elliptical mask.

```
              .:--=+**#####%%%##**++=-:..
       ..-+#%%@@@@@%###%%#**##**++**+******+=-.
     .:::-#@@@%@%%##*#%#+-==::...:::::::::---==-.
    .::-+*%%#@@%*+*=*+--:::............:::::-:=+-:
   .-+*%*#%@@@%#+===-::::::::....::::::::::::-++=-.
  ..:-=--===*+=++*#*%%#++=+*=--:--------:::---==:...
    .:-=*++**==-:::....:-=-:....:-::.....::::-=-:.
         ..:++==--=++++*###*=+*#*+=-::::::....
             .:::--=-=====--======--:::..
```

#### 5.2.1 Why not jeslor's algorithm

jeslor keys density on `abs(luminance - bgLum)`, where `bgLum` is the mean of the
four corner pixels — an assumption that the background is a uniform backdrop.

Measured on this avatar, the corners are `[0.57, 0.43, 0.76, 0.75]`, mean
`0.629`, which is almost exactly the subject's skin tone. The face therefore
scores near-zero contrast and renders as **blank whitespace**, while the dark
bookshelf and left-edge shadow score maximum and render as solid `@`. The
subject and background are inverted. Verified experimentally before this design
was written.

The elliptical mask additionally removes the corner-noise problem by
construction, and mirrors GitHub's own circular avatar treatment.

### 5.3 Right panel — three sections

Dotted-leader key/value rows: key in `cyan`, dots in `line`, value in `fg`
right-aligned. Each row wipe-reveals left-to-right via an animated `clipPath`,
0.4s duration, staggered 0.08s, starting at 0.9s.

```
SYSTEM.INFO
  Name.........Md Amimul Ehshan
  Role.........Senior Software Engineer
  Company......Blubird Interactive Ltd
  Location.....Dhaka, Bangladesh
  Experience...9+ years · PHP / Laravel
  Focus........SaaS platforms & API integrations
  Status.......Open to backend problems

EXPERIENCE
  2021–now.....Blubird Interactive Ltd
  2020–2021....Banglalink Digital
  2017–2020....Digicon Technologies Ltd
  2016–2017....Digicon Technologies Ltd (Jr)

CONTACT
  Portfolio....amims71.github.io
  LinkedIn.....amims71
  GitHub.......amims71 · 5,522 contributions
```

Two departures from jeslor's section list, both consequences of the user
choosing to include a shields.io stack badge row in the README body:

- **`TECH.STACK` is replaced by `EXPERIENCE`.** The badge row already enumerates
  the stack; repeating it inside the card duplicates content within a single
  screen. The four-role, nine-year timeline is not shown anywhere else on the
  profile and is the stronger use of that space.
- **Contribution total replaces repo and follower counts.** jeslor's card prints
  `47 repos · 24 followers`. The equivalent for this account is `11 followers`,
  which undersells the user, and a public repo count that misrepresents output
  because 94% of their activity is private. The contribution total is both
  accurate and favourable.

Only the contribution total is dynamic; all other values are static literals in
the generator.

### 5.4 Footer
- Left: `Live GitHub stats below ↓` in `dim`.
- Right: `synced YYYY-MM-DD HH:MM UTC`.

## 6. `heatmap.svg`

Width derived from week count; 11px cells, 3px gaps, 53 weeks × 7 days.

- Title bar: `amims71@github ~ % ./contributions.sh --year` left;
  `N contributions · streak Nd · best Nd` right, figures in `green`.
- Month labels above, `Mon`/`Wed`/`Fri` labels left, both in `dim`.
- Cells fade in over 0.35s on a per-column stagger of 0.012s.
- Cell level is assigned by ratio to the window maximum at thresholds
  0.65 / 0.40 / 0.15 / >0, giving levels 4/3/2/1.
- `Less ░▒▓█ More` legend bottom-right.

### 6.1 Glider and probe beam

Adopted from jeslor and re-themed. A `cyan` glider translates along a dashed
lane below the grid, 17s per round trip. A beam rises from it; for every column
whose peak day reaches level 3 or above, the beam's length is keyframed to
terminate exactly at that cell, and the beam takes that cell's colour and a
weight scaled to its level. Quieter columns get a thin default probe to the top
row.

Each such peak cell also carries an `amber` outline rect at opacity 0, with
opacity keyframes that pulse it to 1 only while the beam tip is over it. The
glider crosses every column twice per cycle, so each marker gets two pulses per
loop, at cycle fractions `x` and `1-x`.

Keyframe times must be strictly monotonic; collisions are resolved by nudging
by 0.0006 and clamping to `[0,1]`.

### 6.2 Streaks

`current` counts backward from today over days not in the future, stopping at
the first zero. `longest` is the maximum run of consecutive non-zero days across
the window.

## 7. Data integrity

Contribution data comes from the GraphQL `contributionsCollection.contributionCalendar`
for `login: "amims71"`. Static profile metadata needs no API call.

**Measured 2026-08-28** with the user's `gh` token:

```
contributionCalendar.totalContributions   5,522
restrictedContributionsCount              5,175   (private repos)
public commits / PRs / issues               347
logged-out public profile view            4,555 over 171 active days
```

The user's "include private contributions on my profile" setting is on, so the
dense graph is what the public already sees. Publishing it exposes nothing new.

**Failure behaviour — the substantive departure from jeslor.** Their
`generate.mjs` falls back to `synthesizeCalendar()`, a seeded linear-congruential
generator, whenever the API call fails, and renders the resulting invented
contributions beneath a `LIVE` badge. This generator must instead write a
diagnostic to stderr and `process.exit(1)`, leaving the previously committed
SVGs in place. A red X in Actions is recoverable; a profile quietly advertising
fabricated activity is not.

Token resolution order: `GH_TOKEN`, then `GITHUB_TOKEN`, then fail.

**Open risk.** It is unverified whether the Actions default `GITHUB_TOKEN`, an
app installation token, resolves the private-inclusive calendar the way a
user PAT does. Mitigation: generate and commit the first SVGs locally with the
user's token, then inspect the first scheduled run. If the total degrades toward
347, add a fine-grained PAT with read-only user access as repository secret
`GH_TOKEN`. No code change is required for that switch.

## 8. README body

```
hero card              card.svg, full width, links to the repo
badge row              Portfolio · LinkedIn        (no email, per C4)
## $ cat stack.txt     shields.io: PHP, Laravel, Lumen, Go, MySQL,
                       Redis, JavaScript, Docker, Linux
## $ ls ~/work         4–6 selected projects
heatmap card           heatmap.svg, full width
```

Selected work, using resume wording, public repos linked and private ones marked
`[private]` with no link per C5:

| Project | Visibility |
|---|---|
| XP Track — people & inventory tracking; websockets, PDF/CSV reporting, Google Maps blueprint mapping | `[private]` |
| Multi-Tenant E-commerce System — theme customization, order/inventory, delivery, payments | `[private]` |
| CRM — auto lead assignment, Twilio SMS/call, SendGrid automation, Gmail OAuth2 | `[private]` |
| `agento` — production-ready personal AI agent platform on Claude Code CLI | linked |
| `vibexp` — team knowledge base for AI coding tools | linked |
| `tinker-web` — standalone local PHP scratchpad for any Laravel app | linked |

Badges use `style=for-the-badge` with `color=0b0f0a` and `logoColor=00ff66` to
sit in the card's palette rather than shields.io defaults.

## 9. Workflow

`.github/workflows/cards.yml`

- Triggers: `schedule` at `0 6 * * *`, `workflow_dispatch`, and `push` to `main`
  limited to `generate.mjs`, `avatar.png`, `package.json`, and the workflow file.
- `permissions: contents: write`.
- Steps: checkout, setup-node 20, `npm ci`, `npm run generate`, then commit
  `card.svg` and `heatmap.svg` only if the diff is non-empty.
- `git diff --staged --quiet || git commit` so an unchanged day is not an error.

## 10. Verification

Before the repo is created or anything is pushed:

1. Run the generator locally against the live API.
2. Assert the printed contribution total equals the value returned by a direct
   `gh api graphql` call.
3. `rsvg-convert` both SVGs to PNG and inspect them.
4. Confirm the ASCII panel is recognisable as the avatar.
5. Confirm no email address or phone number appears anywhere in the repo.
6. Confirm `git -C /Users/shan/PhpstormProjects/amims71 status` is clean and its
   `HEAD` is unchanged. Note the local checkout of the Pages repo is the
   directory named `amims71`, which is *not* the new profile repo; the new repo
   must be cloned to a separate path to avoid confusing the two.

Then create the repo, push, and confirm the rendered profile at
`github.com/amims71`.

## 11. Decisions on record

| # | Decision | Date |
|---|---|---|
| 1 | Full self-generated SVGs over widget services or a static README | 2026-08-28 |
| 2 | Green CRT palette from `index.html`, not jeslor's navy/sky | 2026-08-28 |
| 3 | Dark only; no light variant | 2026-08-28 |
| 4 | README body: badge row + stack badges + selected work; no fun-fact block | 2026-08-28 |
| 5 | No email address published | 2026-08-28 |
| 6 | Card shows contribution total, not repo/follower counts | 2026-08-28 |
| 7 | `EXPERIENCE` panel replaces `TECH.STACK` | 2026-08-28 |
| 8 | Fail loudly on API error; never synthesize data | 2026-08-28 |
