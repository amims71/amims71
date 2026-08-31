import assert from "node:assert/strict";

// A cheap structural XML check. Not a validating parser — the authoritative
// check is rendering with rsvg-convert in Task 8 — but it catches unclosed and
// mismatched tags, which are the realistic failure mode of string-built SVG.
export function assertBalancedXml(svg) {
  const body = svg.replace(/<!--[\s\S]*?-->/g, "");
  const tag = /<(\/?)([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  let m;
  while ((m = tag.exec(body)) !== null) {
    const [, closing, name, , selfClosing] = m;
    if (selfClosing === "/") continue;
    if (closing === "/") {
      const open = stack.pop();
      assert.equal(name, open, `expected </${open}> but found </${name}>`);
    } else {
      stack.push(name);
    }
  }
  assert.equal(stack.length, 0, `unclosed tags: ${stack.join(", ")}`);
}

// Guards against template holes reaching the committed SVG.
export function assertNoHoles(svg) {
  for (const bad of ["NaN", "undefined", "[object Object]", "${"]) {
    assert.ok(!svg.includes(bad), `rendered SVG contains "${bad}"`);
  }
}

function parseAttrs(attrText) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrText)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

// Chrome, when an SVG is embedded via <img> (exactly how GitHub renders
// README images), does not execute SMIL and does not fall back to the base
// attribute value either -- it freezes the animated attribute at the
// animation's FIRST sample. A base attribute set to the "fully revealed"
// final state (the pattern this codebase used for its two visibility-gating
// reveal animations) is therefore irrelevant to what <img> actually shows:
// if the animation's own first value is 0, the element renders invisible in
// every README, even though the base attribute claims otherwise (see
// task-8-report.md, "both artifacts render with their content invisible on
// GitHub").
//
// The fix is not "pick the right one of {base, first sample}" -- it's that
// the two must always agree, so it no longer matters which one a given
// renderer consults. This walks the tag stream (same tokenizer as
// assertBalancedXml) and, for every <animate> whose attributeName is a
// visibility- or position-affecting attribute (opacity, width, or one of
// the beam's geometry attributes y2/cy/r), asserts that its values list
// starts with exactly its enclosing element's base value for that
// attribute. A missing base `opacity` is treated as the SVG default of 1;
// peak-marker-style animations (base 0, first sample 0 -- meant to stay
// hidden at rest) pass this naturally, with no special-casing by name.
// Returns the number of <animate>/<animateTransform> elements it checked,
// so callers can assert the guard actually inspected something and isn't
// passing vacuously.
//
// task-12 fix-review found this same trap "one level deeper" than opacity:
// the glider's base `transform` was set to point at the spotlight column,
// but its <animateTransform> still started at the lane's left end, and the
// beam's base y2/cy/r were set to the spotlight target while their
// <animate>s still started at week 0's target. An <img>-embedded SVG
// freezes at the animation's first SAMPLE regardless of the base value (see
// above), so the base value alone was cosmetic -- the on-screen glider,
// beam, outline and count disagreed about which column they pointed at.
// y2/cy/r are added to the same scalar-attribute set opacity/width already
// use. `transform` is handled separately below because animateTransform's
// values are "x,y" pairs, not bare scalars.
//
// A second task-12 fix-review round found the guard *still* incomplete
// after the above, and proved it: fed a fragment with a deliberately
// mismatched stroke and stroke-width, the guard returned `checked = 2` with
// no failure -- both attribute names were simply absent from the set, so
// they were silently skipped rather than checked and passed. stroke-width
// is a genuine number, so it joins NUMERIC_ATTRS and is compared
// numerically like the others (so "2.60" vs "2.6" doesn't false-positive
// under a naive string compare). stroke/fill/stop-color are colour strings
// like "#00ff66", not numbers -- Number("#00ff66") is NaN, so a numeric
// compare would either throw or (worse) silently pass via NaN-equals-NaN.
// They get their own COLOR_ATTRS set and a normalised (trimmed,
// lowercased) string compare instead.
const NUMERIC_ATTRS = new Set(["opacity", "width", "y2", "cy", "r", "stroke-width"]);
const COLOR_ATTRS = new Set(["stroke", "fill", "stop-color"]);
const SCALAR_ATTRS = new Set([...NUMERIC_ATTRS, ...COLOR_ATTRS]);
const DEFAULT_BASE_VALUE = { opacity: "1" };

function normalizeColor(v) {
  return (v || "").trim().toLowerCase();
}

// Parses a simple `translate(x,y)` string into ["x","y"], or null if it
// isn't one. Deliberately narrow -- per task-12 fix-review, "do not try to
// parse arbitrary transform lists" (scale/rotate/matrix/multi-transform
// values are out of scope; every animateTransform in this codebase that
// needs checking is a plain translate).
function parseTranslate(s) {
  const m = /^translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(s || "");
  return m ? [m[1], m[2]] : null;
}

export function assertAnimationsMatchBaseValues(svg) {
  const body = svg.replace(/<!--[\s\S]*?-->/g, "");
  const tag = /<(\/?)([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  let checked = 0;
  let m;
  while ((m = tag.exec(body)) !== null) {
    const [, closing, name, attrText, selfClosing] = m;
    if (closing === "/") {
      stack.pop();
      continue;
    }
    const attrs = parseAttrs(attrText);
    if (name === "animate" && SCALAR_ATTRS.has(attrs.attributeName)) {
      const attrName = attrs.attributeName;
      const parent = stack[stack.length - 1];
      assert.ok(parent, `<animate attributeName="${attrName}"> has no enclosing element`);
      const baseValue = attrName in parent.attrs ? parent.attrs[attrName] : DEFAULT_BASE_VALUE[attrName];
      assert.ok(
        baseValue !== undefined,
        `<${parent.name}> animates ${attrName} but has no base ${attrName} attribute and no default is defined`
      );
      const firstSample = (attrs.values || "").split(";")[0]?.trim();
      const mismatchMsg =
        `<${parent.name}> animates ${attrName} starting at "${firstSample}" but its base ${attrName} is ` +
        `"${baseValue}" -- an <img>-embedded SVG freezes at the animation's first sample, ignoring the base ` +
        `value, so the two must agree or the element renders wrong (or invisible) in every README`;
      if (COLOR_ATTRS.has(attrName)) {
        // Colour values (e.g. "#00ff66") aren't numbers -- compare
        // normalised strings instead of parsing them numerically.
        assert.equal(normalizeColor(firstSample), normalizeColor(baseValue), mismatchMsg);
      } else {
        // Numeric compare, not exact-string, so equivalent representations
        // like "2.60" and "2.6" agree instead of false-positiving. Guard
        // against non-numeric garbage on either side first -- Node's
        // assert.equal uses Object.is, under which NaN === NaN is true, so
        // a bad parse on both sides would otherwise silently "match".
        const firstNum = Number(firstSample);
        const baseNum = Number(baseValue);
        assert.ok(!Number.isNaN(firstNum), `<${parent.name}> animates ${attrName} with a non-numeric first sample "${firstSample}"`);
        assert.ok(!Number.isNaN(baseNum), `<${parent.name}> has a non-numeric base ${attrName} "${baseValue}"`);
        assert.equal(firstNum, baseNum, mismatchMsg);
      }
      checked += 1;
    }
    // Not every animateTransform-driven element declares a base `transform`
    // -- unlike opacity, SVG has no single meaningful default translate to
    // fall back on, and at least one purely decorative element in this
    // codebase (card.mjs's scan-beam sweep) intentionally has none. Where a
    // base transform IS declared, though, it is held to the exact same
    // rule as every other attribute above.
    //
    // This branch used to silently skip any animateTransform whose type
    // wasn't "translate" -- not counted, no failure -- the same silent-skip
    // pattern task-12 review flagged for stroke/fill above. Every
    // animateTransform in this codebase today is a translate, but a future
    // scale/rotate/matrix animation must fail loudly here instead of
    // slipping through unpoliced.
    if (name === "animateTransform" && attrs.attributeName === "transform") {
      assert.equal(
        attrs.type,
        "translate",
        `<animateTransform> uses unsupported animateTransform type "${attrs.type}" -- this guard only ` +
          `understands "translate"; add support for it here before using another type, or its ` +
          `first-sample-vs-base-value agreement goes completely unchecked`
      );
      const parent = stack[stack.length - 1];
      assert.ok(parent, `<animateTransform attributeName="transform"> has no enclosing element`);
      const baseTransform = parent.attrs.transform;
      if (baseTransform !== undefined) {
        const baseXY = parseTranslate(baseTransform);
        assert.ok(
          baseXY,
          `<${parent.name}> has a base transform "${baseTransform}" that isn't a simple translate(x,y) -- can't compare`
        );
        const firstSample = (attrs.values || "").split(";")[0]?.trim();
        const firstXY = parseTranslate(`translate(${firstSample})`);
        assert.ok(
          firstXY,
          `<${parent.name}> animates transform starting at "${firstSample}", which isn't a simple "x,y" pair -- can't compare`
        );
        assert.equal(
          Number(firstXY[0]),
          Number(baseXY[0]),
          `<${parent.name}> animates transform starting at x=${firstXY[0]} but its base transform's x is ` +
            `${baseXY[0]} -- an <img>-embedded SVG freezes at the animation's first sample, ignoring the base ` +
            `value, so the two must agree or the element renders in the wrong place in every README`
        );
        assert.equal(
          Number(firstXY[1]),
          Number(baseXY[1]),
          `<${parent.name}> animates transform starting at y=${firstXY[1]} but its base transform's y is ` +
            `${baseXY[1]} -- an <img>-embedded SVG freezes at the animation's first sample, ignoring the base ` +
            `value, so the two must agree or the element renders in the wrong place in every README`
        );
        checked += 1;
      }
    }
    if (selfClosing !== "/") {
      stack.push({ name, attrs });
    }
  }
  return checked;
}
