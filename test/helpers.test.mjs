import test from "node:test";
import assert from "node:assert/strict";
import { assertAnimationsMatchBaseValues } from "./helpers.mjs";

// Direct tests for the shared animation guard itself. Everything else in the
// suite uses it as an oracle over a built SVG; these pin the oracle's own
// behaviour, because a guard that silently skips what it does not recognise
// reports "checked" without having checked, and reads as coverage it does
// not have. The <animateTransform> branch was already changed to fail loudly
// on an unrecognised `type` for exactly this reason -- these cover the same
// policy on the <animate> branch.

test("assertAnimationsMatchBaseValues counts a well-formed fragment and accepts it", () => {
  const svg =
    '<svg><rect opacity="0.4" width="10">' +
    '<animate attributeName="opacity" values="0.4;1;0.4" dur="1s"/>' +
    '<animate attributeName="width" values="10;20;10" dur="1s"/>' +
    "</rect></svg>";
  assert.equal(assertAnimationsMatchBaseValues(svg), 2);
});

test("assertAnimationsMatchBaseValues still rejects a first sample that disagrees with the base value", () => {
  const svg = '<svg><rect opacity="1"><animate attributeName="opacity" values="0;1" dur="1s"/></rect></svg>';
  assert.throws(() => assertAnimationsMatchBaseValues(svg), /freezes at the animation's first sample/);
});

// The silent-skip hole. `if (name === "animate" && SCALAR_ATTRS.has(...))`
// means an attributeName outside that set is neither checked nor counted:
// the fragments below each animate an attribute away from its base value and
// the guard returned 0 without complaint. `height`, `x` and `stop-opacity`
// are all real, plausible SVG animation targets, and `cx` is one character
// away from `cy`, which IS in the set -- a typo would have gone unpoliced.
for (const attr of ["height", "x", "cx", "stop-opacity"]) {
  test(`assertAnimationsMatchBaseValues fails loudly on an unknown animated attribute (${attr})`, () => {
    const svg = `<svg><rect ${attr}="7"><animate attributeName="${attr}" values="0;7" dur="1s"/></rect></svg>`;
    assert.throws(() => assertAnimationsMatchBaseValues(svg), /unsupported <animate> attributeName/);
  });
}

test("assertAnimationsMatchBaseValues fails loudly on an <animate> with no attributeName at all", () => {
  const svg = '<svg><rect opacity="1"><animate values="0;1" dur="1s"/></rect></svg>';
  assert.throws(() => assertAnimationsMatchBaseValues(svg), /unsupported <animate> attributeName/);
});

// The parked coercion hole: Number("") is 0, so an <animate> with no `values`
// (or a whitespace-only one) produced a first sample of "" that compared
// equal to a base of exactly "0" and passed -- counted as checked, having
// verified nothing. Every peak marker in the heatmap has base opacity "0",
// so this is precisely the shape the real artifacts are full of.
for (const [label, attrs] of [
  ["missing values", 'attributeName="opacity" dur="1s"'],
  ["whitespace-only values", 'attributeName="opacity" values="   " dur="1s"'],
  ["empty values", 'attributeName="opacity" values="" dur="1s"'],
]) {
  test(`assertAnimationsMatchBaseValues fails loudly on an <animate> with ${label}, rather than coercing "" to 0`, () => {
    const svg = `<svg><rect opacity="0"><animate ${attrs}/></rect></svg>`;
    assert.throws(() => assertAnimationsMatchBaseValues(svg), /no first sample/);
  });
}

test("assertAnimationsMatchBaseValues still rejects an animateTransform type it cannot compare", () => {
  const svg =
    '<svg><g transform="translate(0,0)">' +
    '<animateTransform attributeName="transform" type="scale" values="1;2" dur="1s"/>' +
    "</g></svg>";
  assert.throws(() => assertAnimationsMatchBaseValues(svg), /unsupported animateTransform type/);
});
