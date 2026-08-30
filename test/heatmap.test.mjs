import test from "node:test";
import assert from "node:assert/strict";
import { THEME } from "../src/theme.mjs";
import { GEOM, geometry, buildHeatmapSvg, GLIDER_DUR, columnPeaks, probeSchedule, touchOpacity } from "../src/heatmap.mjs";
import { assertBalancedXml, assertNoHoles } from "./helpers.mjs";

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

test("buildHeatmapSvg staggers the cell fade-in", () => {
  const out = svg();
  assert.match(out, /<animate attributeName="opacity"/);
});

test("buildHeatmapSvg emits no numeric junk in coordinates", () => {
  const out = svg();
  assert.ok(!/(x|y|cx|cy|width|height)="(NaN|Infinity|-Infinity)"/.test(out));
});

// Regression: a renderer that does not execute SMIL (e.g. rsvg-convert, some
// GitHub-side static renders) falls back to the base attribute values. The
// brief's original cell markup used `opacity="0"` as the base with the reveal
// driven entirely by `begin`, which makes the whole grid invisible on any
// such renderer -- the exact bug that hit the hero card's key/value rows
// (see task-5-report.md, Finding 1). The base value must be the final,
// fully-visible state; the stagger must live inside the animation's own
// timeline (keyTimes/values), not in `begin`.
test("buildHeatmapSvg never emits a heat-cell rect with opacity=\"0\"", () => {
  const out = svg();
  const cellTags = out.match(/<rect class="heat-cell"[^>]*>/g) || [];
  assert.ok(cellTags.length > 0);
  for (const tag of cellTags) {
    assert.ok(!/opacity="0"/.test(tag), `heat-cell rect is invisible without SMIL: ${tag}`);
  }
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
// brief moment the beam tip crosses them. opacity="0" is their correct
// resting state -- do not apply the static-safety fix used for heat-cells
// here, or every marker would be permanently lit at rest.
test("buildHeatmapSvg keeps peak markers hidden at rest (opacity=0 base)", () => {
  const out = svg();
  const markerTags = out.match(/<rect class="peak-marker"[^>]*>/g) || [];
  assert.ok(markerTags.length > 0, "no peak markers emitted");
  for (const tag of markerTags) {
    assert.match(tag, /opacity="0"/, `peak-marker should default to hidden: ${tag}`);
  }
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
