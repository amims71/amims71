import test from "node:test";
import assert from "node:assert/strict";
import { THEME } from "../src/theme.mjs";
import { PROFILE, ROLES, buildSections, buildCardSvg } from "../src/card.mjs";
import { assertBalancedXml, assertNoHoles, assertAnimationsMatchBaseValues } from "./helpers.mjs";

const asciiRows = Array.from({ length: 42 }, () => "@".repeat(54));
const svg = () => buildCardSvg({ asciiRows, totalContributions: 5522, syncedAt: "2026-08-28 06:00 UTC" });

test("PROFILE carries the approved copy", () => {
  assert.equal(PROFILE.name, "Md Amimul Ehshan");
  assert.equal(PROFILE.role, "Senior Software Engineer");
  assert.equal(PROFILE.company, "Blubird Interactive Ltd");
  assert.equal(PROFILE.location, "Dhaka, Bangladesh");
  assert.equal(PROFILE.portfolio, "amims71.github.io");
});

test("ROLES lists four positions, newest first", () => {
  assert.equal(ROLES.length, 4);
  assert.equal(ROLES[0][0], "2021–now");
  assert.equal(ROLES[0][1], "Blubird Interactive Ltd");
  assert.equal(ROLES[3][0], "2016–2017");
});

test("buildSections emits SYSTEM.INFO, EXPERIENCE and CONTACT", () => {
  const titles = buildSections(5522).map((s) => s.title);
  assert.deepEqual(titles, ["SYSTEM.INFO", "EXPERIENCE", "CONTACT"]);
});

test("buildSections has no TECH.STACK section", () => {
  // Replaced by EXPERIENCE because the README body carries the stack badges
  // (spec §5.3).
  const titles = buildSections(5522).map((s) => s.title);
  assert.ok(!titles.includes("TECH.STACK"));
});

test("buildSections reports the contribution total, not follower or repo counts", () => {
  const contact = buildSections(5522).find((s) => s.title === "CONTACT");
  const github = contact.rows.find((r) => r.label === "GitHub");
  assert.match(github.value, /5,522 contributions/);
  assert.ok(!/followers/.test(github.value));
  assert.ok(!/repos/.test(github.value));
});

test("buildSections aligns every value column at 13 characters", () => {
  for (const section of buildSections(5522)) {
    for (const row of section.rows) {
      assert.equal(row.label.length + row.dots.length, 13, `misaligned: ${row.label}`);
    }
  }
});

test("buildCardSvg produces a well-formed, hole-free SVG", () => {
  const out = svg();
  assert.ok(out.startsWith("<svg"));
  assert.ok(out.trimEnd().endsWith("</svg>"));
  assertBalancedXml(out);
  assertNoHoles(out);
});

test("buildCardSvg is 1180 wide", () => {
  assert.match(svg(), /<svg[^>]*width="1180"/);
});

test("buildCardSvg uses the CRT palette and no foreign colours", () => {
  const out = svg();
  for (const hex of [THEME.bg, THEME.green, THEME.fg, THEME.dim, THEME.cyan, THEME.line]) {
    assert.ok(out.includes(hex), `missing ${hex}`);
  }
  assert.ok(!out.includes("#38BDF8"), "reference profile's sky blue leaked in");
  assert.ok(!out.includes("#0B1120"), "reference profile's navy leaked in");
});

test("buildCardSvg renders every ascii row with a fixed textLength", () => {
  const out = svg();
  assert.equal((out.match(/class="ascii-row"/g) || []).length, 42);
  assert.match(out, /textLength="\d+"/);
  assert.match(out, /lengthAdjust="spacingAndGlyphs"/);
});

// rsvg-convert (used for local/manual verification of the card render) does
// not honour the CSS `white-space: pre` rule the .ascii-row class relies on
// to preserve each row's leading indentation -- it collapses the leading
// spaces and left-aligns every row, squashing the portrait into the left
// third of its panel. Chrome (the real target, since GitHub embeds this SVG
// via <img>) renders correctly either way, so this was invisible on
// github.com, but it silently distorted every rsvg-based check made against
// this project. xml:space="preserve" is the standard SVG/XML mechanism for
// preserving whitespace and is universally supported, so add it alongside
// (not instead of) the CSS rule -- belt and braces (see task-13-report.md).
test("buildCardSvg's ascii-row text elements carry xml:space=\"preserve\" so whitespace survives renderers that ignore CSS white-space:pre", () => {
  const out = svg();
  const rowTags = out.match(/<text[^>]*class="ascii-row"[^>]*>/g) || [];
  assert.equal(rowTags.length, 42, "expected 42 ascii-row <text> tags");
  for (const tag of rowTags) {
    assert.match(tag, /xml:space="preserve"/, `missing xml:space="preserve": ${tag}`);
  }
});

test("buildCardSvg includes the terminal chrome and LIVE indicator", () => {
  const out = svg();
  assert.match(out, /amims71@github ~ % \.\/profile\.sh --live/);
  assert.match(out, />LIVE</);
  assert.ok(out.includes("#ff5f56") && out.includes("#ffbd2e") && out.includes("#27c93f"));
});

test("buildCardSvg stamps the sync time", () => {
  assert.match(svg(), /synced 2026-08-28 06:00 UTC/);
});

test("buildCardSvg publishes no email address or phone number", () => {
  const out = svg();
  assert.ok(!/[\w.]+@[\w.]+\.\w+/.test(out.replace(/amims71@github/g, "")), "email-like string present");
  // Anchored on the leading "+" of international format. An unanchored digit
  // run matches SVG coordinate soup — viewBox="0 0 1180 662" is not a phone
  // number.
  assert.ok(!/\+\d[\d\s().-]{9,}/.test(out), "phone-like string present");
});

test("buildCardSvg escapes markup in dynamic values", () => {
  const out = buildCardSvg({ asciiRows, totalContributions: 1, syncedAt: 'x <b>"y"' });
  assert.ok(!out.includes("<b>"));
});

// Superseded regression guard. The former per-row reveal-clip animation had
// a base width equal to the FINAL width, which was believed sufficient for
// any renderer that "doesn't execute SMIL". That framing was wrong: Chrome,
// when this SVG is embedded via <img> (exactly how GitHub renders README
// images), DOES notice the SMIL but freezes the attribute at the
// animation's first sample -- which was 0 -- and ignores the base value
// entirely. Every one of the fourteen key/value rows rendered invisible on
// github.com/amims71 as a result (see task-8-report.md). The fix removes
// the reveal-clip mechanism outright rather than trying to pick a base
// value that happens to match a first sample; the shared guard below is
// the generic replacement, covering every opacity/width animation in the
// SVG, not just this one now-deleted mechanism.
test("buildCardSvg's opacity/width animations agree with their base attribute values (an <img>-embedded SVG freezes at the first sample, not the base -- see task-8-report.md)", () => {
  const out = svg();
  const checked = assertAnimationsMatchBaseValues(out);
  assert.ok(checked > 0, "expected at least one opacity/width animation to check -- a guard that checks nothing passes vacuously");
  // Confirm the reveal-clip mechanism is actually gone, not merely passing
  // the guard above by chance.
  assert.ok(!out.includes('clip-path="url(#rv'), "a per-row reveal clip-path is still present");
});
