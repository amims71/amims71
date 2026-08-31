import test from "node:test";
import assert from "node:assert/strict";
import { THEME } from "../src/theme.mjs";
import { GEOM, geometry, buildHeatmapSvg, GLIDER_DUR, columnPeaks, probeSchedule, touchOpacity } from "../src/heatmap.mjs";
import { assertBalancedXml, assertNoHoles, assertAnimationsMatchBaseValues } from "./helpers.mjs";

// 53 weeks x 7 days with a deterministic, varied distribution.
function calendar(weekCount = 53) {
  const weeks = [];
  let n = 0;
  for (let w = 0; w < weekCount; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const count = (w * 7 + d) % 11; // 0..10, deterministic
      n += count;
      const day = new Date(Date.UTC(2025, 7, 31) + 0);
      day.setUTCDate(day.getUTCDate() + w * 7 + d);
      days.push({ date: day.toISOString().slice(0, 10), contributionCount: count, weekday: d });
    }
    weeks.push({ contributionDays: days });
  }
  return { totalContributions: n, weeks };
}

const cal = calendar();
const svg = () => buildHeatmapSvg({ calendar: cal, today: "2026-08-28" });

test("GEOM matches the spec's cell metrics", () => {
  assert.equal(GEOM.cell, 11);
  assert.equal(GEOM.gap, 3);
});

test("geometry derives width from the week count", () => {
  const a = geometry(53);
  const b = geometry(54);
  assert.equal(b.width - a.width, GEOM.cell + GEOM.gap);
  assert.equal(a.step, 14);
});

test("geometry puts the glider lane below the seven day rows", () => {
  const g = geometry(53);
  assert.ok(g.laneY > GEOM.gridY + 7 * g.step);
  assert.ok(g.laneY < g.height);
});

test("buildHeatmapSvg produces a well-formed, hole-free SVG", () => {
  const out = svg();
  assert.ok(out.startsWith("<svg"));
  assert.ok(out.trimEnd().endsWith("</svg>"));
  assertBalancedXml(out);
  assertNoHoles(out);
});

test("buildHeatmapSvg draws one rect per day", () => {
  const out = svg();
  const cells = out.match(/class="heat-cell"/g) || [];
  assert.equal(cells.length, 53 * 7);
});

test("buildHeatmapSvg uses only the five heat-ramp colours for cells", () => {
  const out = svg();
  const fills = [...out.matchAll(/class="heat-cell"[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(fills.length > 0);
  for (const f of fills) assert.ok(THEME.heat.includes(f), `unexpected cell fill ${f}`);
});

test("buildHeatmapSvg reports the total, current streak and best streak", () => {
  const out = buildHeatmapSvg({ calendar: { ...cal, totalContributions: 5522 }, today: "2026-08-28" });
  assert.match(out, /5,522<\/tspan> contributions/);
  assert.match(out, /streak/);
  assert.match(out, /best/);
});

test("buildHeatmapSvg labels the terminal command", () => {
  assert.match(svg(), /amims71@github ~ % \.\/contributions\.sh --year/);
});

test("buildHeatmapSvg labels months and the Mon/Wed/Fri rows", () => {
  const out = svg();
  assert.equal((out.match(/class="heat-daylabel"/g) || []).length, 3);
  assert.ok(out.includes(">Mon<") && out.includes(">Wed<") && out.includes(">Fri<"));
  assert.ok((out.match(/class="heat-month"/g) || []).length >= 12);
});

test("buildHeatmapSvg draws a five-swatch Less/More legend", () => {
  const out = svg();
  assert.ok(out.includes(">Less<") && out.includes(">More<"));
  assert.equal((out.match(/class="heat-legend-swatch"/g) || []).length, 5);
});

// Superseded: cells no longer fade in at all (see the swapped-in shared
// guard test below for why). This asserts the accurate replacement instead
// of leaving the old assertion in place -- `/<animate attributeName="opacity"/`
// still matches elsewhere in the SVG (the glider's cockpit-light blink), so
// the original assertion would keep passing for the wrong reason even
// though the cell fade-in it named is gone.
test("buildHeatmapSvg draws heat-cells with no reveal animation", () => {
  const out = svg();
  const cellTags = out.match(/<rect class="heat-cell"[^>]*>/g) || [];
  assert.ok(cellTags.length > 0, "no heat-cell rects emitted");
  for (const tag of cellTags) {
    assert.ok(tag.endsWith("/>"), `heat-cell rect should be self-closing, with no <animate> child: ${tag}`);
  }
});

test("buildHeatmapSvg emits no numeric junk in coordinates", () => {
  const out = svg();
  assert.ok(!/(x|y|cx|cy|width|height)="(NaN|Infinity|-Infinity)"/.test(out));
});

// Superseded regression guard. The former per-cell reveal animation had a
// base opacity of 1 (fully drawn), which was believed sufficient for any
// renderer that "doesn't execute SMIL". That framing was wrong: Chrome, when
// this SVG is embedded via <img> (exactly how GitHub renders README
// images), DOES notice the SMIL but freezes the attribute at the
// animation's first sample -- which was 0 -- and ignores the base value
// entirely. The entire 365-cell grid rendered invisible on github.com/amims71
// as a result (see task-8-report.md). The fix removes the reveal animation
// outright rather than trying to pick a base value that happens to match a
// first sample; the shared guard below is the generic replacement, covering
// every opacity/width animation in the SVG, not just this one now-deleted
// mechanism.
test("buildHeatmapSvg's opacity/width animations agree with their base attribute values (an <img>-embedded SVG freezes at the first sample, not the base -- see task-8-report.md)", () => {
  const out = svg();
  const checked = assertAnimationsMatchBaseValues(out);
  assert.ok(checked > 0, "expected at least one opacity/width animation to check -- a guard that checks nothing passes vacuously");
});

// Regression: the 53-week window can open mid-month (e.g. the real GitHub
// calendar opens on Aug 30/31), leaving week 0 a one- or two-day stub of the
// old month immediately followed by a full week already in the next month.
// The month-label logic emits a label whenever the month changes between
// weeks, with no minimum-spacing guard, so both week 0 and week 1 emit a
// label just one grid column (14px) apart and their glyphs collide -- this
// is the overlap reported in task-6-report.md ("Aug"/"Sep" at x=46/x=60).
// `cal` (built above) opens on Aug 31, 2025, so it reproduces this exactly.
test("buildHeatmapSvg keeps month labels at least 3 cell-steps apart when the window opens mid-month", () => {
  const out = svg();
  const step = GEOM.cell + GEOM.gap;
  const xs = [...out.matchAll(/<text x="(\d+(?:\.\d+)?)" y="[^"]*" class="heat-month">/g)].map((m) => Number(m[1]));
  assert.ok(xs.length >= 2, "expected at least two month labels to compare spacing");
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    assert.ok(
      gap >= 3 * step,
      `month labels ${i - 1} and ${i} are only ${gap}px apart (need >= ${3 * step}px = 3 cell-steps)`
    );
  }
});

test("GLIDER_DUR is a 17 second round trip", () => {
  assert.equal(GLIDER_DUR, 17);
});

test("columnPeaks returns the busiest day of every week", () => {
  const weeks = [
    { contributionDays: [
      { date: "2026-01-01", contributionCount: 1, weekday: 0 },
      { date: "2026-01-02", contributionCount: 9, weekday: 1 },
    ] },
    { contributionDays: [
      { date: "2026-01-08", contributionCount: 0, weekday: 0 },
    ] },
  ];
  const peaks = columnPeaks(weeks, 9);
  assert.equal(peaks.length, 2);
  assert.equal(peaks[0].count, 9);
  assert.equal(peaks[0].weekday, 1);
  assert.equal(peaks[0].level, 4);
  assert.equal(peaks[1].level, 0);
});

test("probeSchedule emits two strictly ascending keyframes per week", () => {
  const g = geometry(53);
  const s = probeSchedule(cal.weeks, 10, g);
  assert.equal(s.keyTimes.length, 53 * 2);
  assert.equal(s.y2.length, s.keyTimes.length);
  assert.equal(s.colors.length, s.keyTimes.length);
  const nums = s.keyTimes.map(Number);
  for (let i = 1; i < nums.length; i++) {
    assert.ok(nums[i] > nums[i - 1], `keyTimes not ascending at ${i}: ${nums[i - 1]} -> ${nums[i]}`);
  }
  assert.ok(nums[0] >= 0 && nums[nums.length - 1] <= 1);
});

test("probeSchedule aims the beam at bright columns and the top row otherwise", () => {
  const g = geometry(2);
  const weeks = [
    { contributionDays: [{ date: "2026-01-01", contributionCount: 10, weekday: 4 }] },
    { contributionDays: [{ date: "2026-01-08", contributionCount: 1, weekday: 4 }] },
  ];
  const s = probeSchedule(weeks, 10, g);
  // The level-4 column takes a heat colour; the level-1 column takes the accent.
  assert.ok(s.colors.includes(THEME.heat[4]));
  assert.ok(s.colors.includes(THEME.cyan));
});

test("touchOpacity opens and closes at zero and peaks twice", () => {
  const o = touchOpacity(0.4);
  assert.equal(Number(o.keyTimes[0]), 0);
  assert.equal(Number(o.keyTimes[o.keyTimes.length - 1]), 1);
  assert.equal(o.values[0], 0);
  assert.equal(o.values[o.values.length - 1], 0);
  assert.equal(o.values.filter((v) => v === 1).length, 4); // two pulses, two samples each
  const nums = o.keyTimes.map(Number);
  for (let i = 1; i < nums.length; i++) assert.ok(nums[i] > nums[i - 1]);
});

test("touchOpacity stays monotonic at the extremes of the lane", () => {
  for (const f of [0, 1]) {
    const nums = touchOpacity(f).keyTimes.map(Number);
    for (let i = 1; i < nums.length; i++) assert.ok(nums[i] > nums[i - 1], `f=${f} not ascending at ${i}`);
  }
});

// Found while verifying the task-8 fix-review's shared base/first-sample
// guard: touchOpacity's own comment documents that a column at either end
// of the lane collides two coincident keyframes at the boundary and
// deliberately keeps the brighter sample so the pulse still flashes rather
// than emitting a duplicate keyTime (which would kill the whole animation).
// At exactly f=0 that collision lands ON the fixed opening/closing anchor
// points themselves, so the animation's true first (and last) sample is 1,
// not 0 -- the opposite of every interior column. This is pinned down here
// because buildPeakMarkers' base opacity is derived from this exact value
// (see its comment), not hardcoded, precisely so the two stay in sync.
test("touchOpacity at the very edge of the lane opens and closes lit, not hidden", () => {
  const o = touchOpacity(0);
  assert.equal(o.values[0], 1);
  assert.equal(o.values[o.values.length - 1], 1);
});

test("buildHeatmapSvg includes the glider and its dashed lane", () => {
  const out = svg();
  assert.match(out, /class="glider"/);
  assert.match(out, /stroke-dasharray="2 4"/);
  assert.match(out, /dur="17s"/);
  assertBalancedXml(out);
  assertNoHoles(out);
});

// Correction 2: a renderer that does not execute SMIL falls back to base
// attribute values. The glider's <animateTransform> has no effect there, so
// the <g class="glider"> needs its own base `transform` -- matching the
// animation's first keyframe -- or a static render places the glider (and
// its whole beam) at the SVG origin, on top of the header. See
// task-7-brief.md Correction 2 and revealClip in src/card.mjs for the
// established pattern.
test("buildHeatmapSvg gives the glider group a base transform for static renderers", () => {
  const out = svg();
  const g = geometry(cal.weeks.length);
  const xStart = GEOM.gridX + 10;
  const openTag = out.match(/<g class="glider"[^>]*>/);
  assert.ok(openTag, "glider group not found");
  assert.match(openTag[0], /transform="/, "glider group has no base transform attribute");
  assert.ok(
    openTag[0].includes(`transform="translate(${xStart},${g.laneY})"`),
    `glider base transform should park it at the lane start: ${openTag[0]}`
  );
});

test("buildHeatmapSvg flashes amber markers only on bright peak days", () => {
  const out = svg();
  const markers = out.match(/class="peak-marker"/g) || [];
  assert.ok(markers.length > 0, "no peak markers emitted");
  assert.ok(markers.length <= 53, "more markers than weeks");
  assert.ok(out.includes(THEME.amber));
});

// Correction 3: peak markers are meant to be invisible except during the
// brief moment the beam tip crosses them -- do not apply the static-safety
// fix used for heat-cells here, or every marker would be permanently lit at
// rest.
//
// Updated during the task-8 fix-review: this used to assert every marker's
// base was the literal "0". That was true for every column except one --
// see "touchOpacity at the very edge of the lane opens and closes lit, not
// hidden" above -- so buildPeakMarkers now derives each marker's base
// straight from its own animation's first sample instead of hardcoding "0".
// The real invariant is "hidden at rest, except where the animation's own
// first sample says otherwise", which is exactly "base equals first
// sample" -- so this also doubles as a per-marker instance of the shared
// guard, plus a sanity check that most markers are, in fact, still hidden.
test("buildHeatmapSvg keeps peak-marker base opacity in sync with its own animation's first sample", () => {
  const out = svg();
  const markers = [
    ...out.matchAll(/<rect class="peak-marker"[^>]*opacity="([^"]+)">\s*<animate attributeName="opacity"[^>]*values="([^"]+)"/g),
  ];
  assert.ok(markers.length > 0, "no peak markers emitted");
  for (const [, base, values] of markers) {
    assert.equal(base, values.split(";")[0], "peak-marker base opacity must match its own animation's first sample");
  }
  assert.ok(markers.some(([, base]) => base === "0"), "expected at least one peak marker hidden at rest");
});

// Review finding 1: buildGlider's cockpit dot used a raw `fill="#ffffff"`
// literal instead of a THEME colour -- a pure-white pixel is the one element
// on a green-phosphor card that isn't phosphor, and it violates the binding
// "palette exact" constraint (every colour must trace back to THEME). This
// scans every hex literal actually emitted and requires each one to be a
// known THEME value, so any future raw-hex regression (not just this one)
// gets caught, not just this specific white.
test("buildHeatmapSvg uses only palette colours -- no raw hex literals outside THEME", () => {
  const out = svg();
  const known = new Set([
    THEME.bg,
    THEME.bg2,
    THEME.green,
    THEME.fg,
    THEME.dim,
    THEME.cyan,
    THEME.amber,
    THEME.line,
    ...THEME.heat,
  ]);
  const hexes = out.match(/#[0-9a-fA-F]{3,8}/g) || [];
  assert.ok(hexes.length > 0, "expected to find colour literals in the output");
  for (const hex of hexes) {
    assert.ok(known.has(hex), `colour literal ${hex} is not in THEME`);
  }
});
