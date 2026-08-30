import test from "node:test";
import assert from "node:assert/strict";
import { THEME } from "../src/theme.mjs";
import { GEOM, geometry, buildHeatmapSvg } from "../src/heatmap.mjs";
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
