import test from "node:test";
import assert from "node:assert/strict";
import { THEME } from "../src/theme.mjs";
import { smoothstep, escapeXml, kv, formatInt } from "../src/util.mjs";

test("THEME carries the exact palette from index.html", () => {
  assert.equal(THEME.bg, "#0b0f0a");
  assert.equal(THEME.bg2, "#0e150d");
  assert.equal(THEME.green, "#00ff66");
  assert.equal(THEME.fg, "#b6ffb0");
  assert.equal(THEME.dim, "#5e7a5a");
  assert.equal(THEME.cyan, "#7ee7ff");
  assert.equal(THEME.amber, "#ffb86b");
  assert.equal(THEME.line, "#1a2418");
});

test("THEME.heat has five levels, darkest first, brightest is green", () => {
  assert.equal(THEME.heat.length, 5);
  assert.equal(THEME.heat[0], "#0f1a0e");
  assert.equal(THEME.heat[4], "#00ff66");
  for (const c of THEME.heat) assert.match(c, /^#[0-9a-f]{6}$/);
});

test("smoothstep clamps below edge0 and above edge1", () => {
  assert.equal(smoothstep(0.2, 0.8, 0.0), 0);
  assert.equal(smoothstep(0.2, 0.8, 1.0), 1);
});

test("smoothstep is 0.5 at the midpoint and monotonic", () => {
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.ok(smoothstep(0, 1, 0.3) < smoothstep(0, 1, 0.7));
});

test("escapeXml escapes the four dangerous characters", () => {
  assert.equal(escapeXml('a & b < c > d "e"'), "a &amp; b &lt; c &gt; d &quot;e&quot;");
});

test("escapeXml escapes ampersands before the entities it introduces", () => {
  assert.equal(escapeXml("&lt;"), "&amp;lt;");
});

test("escapeXml coerces non-strings", () => {
  assert.equal(escapeXml(42), "42");
});

test("kv pads the label out to 13 columns with dots", () => {
  const row = kv("Name", "Md Amimul Ehshan");
  assert.equal(row.label, "Name");
  assert.equal(row.dots, ".........");
  assert.equal(row.label.length + row.dots.length, 13);
  assert.equal(row.value, "Md Amimul Ehshan");
});

test("kv keeps the 13-column total for the longest real label", () => {
  const row = kv("Experience", "9+ years");
  assert.equal(row.dots, "...");
  assert.equal(row.label.length + row.dots.length, 13);
});

test("kv never emits fewer than two dots", () => {
  assert.equal(kv("AnAbsurdlyLongLabel", "x").dots, "..");
});

test("kv escapes both label and value", () => {
  const row = kv("A&B", "x < y");
  assert.equal(row.label, "A&amp;B");
  assert.equal(row.value, "x &lt; y");
});

test("formatInt inserts thousands separators", () => {
  assert.equal(formatInt(5522), "5,522");
  assert.equal(formatInt(347), "347");
  assert.equal(formatInt(0), "0");
  assert.equal(formatInt(1000000), "1,000,000");
});
