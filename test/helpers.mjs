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
// visibility-affecting attribute (opacity or width), asserts that its
// values list starts with exactly its enclosing element's base value for
// that attribute. A missing base `opacity` is treated as the SVG default of
// 1; peak-marker-style animations (base 0, first sample 0 -- meant to stay
// hidden at rest) pass this naturally, with no special-casing by name.
// Returns the number of <animate> elements it checked, so callers can
// assert the guard actually inspected something and isn't passing vacuously.
const VISIBILITY_ATTRS = new Set(["opacity", "width"]);
const DEFAULT_BASE_VALUE = { opacity: "1" };

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
    if (name === "animate" && VISIBILITY_ATTRS.has(attrs.attributeName)) {
      const attrName = attrs.attributeName;
      const parent = stack[stack.length - 1];
      assert.ok(parent, `<animate attributeName="${attrName}"> has no enclosing element`);
      const baseValue = attrName in parent.attrs ? parent.attrs[attrName] : DEFAULT_BASE_VALUE[attrName];
      assert.ok(
        baseValue !== undefined,
        `<${parent.name}> animates ${attrName} but has no base ${attrName} attribute and no default is defined`
      );
      const firstSample = (attrs.values || "").split(";")[0]?.trim();
      assert.equal(
        firstSample,
        baseValue,
        `<${parent.name}> animates ${attrName} starting at "${firstSample}" but its base ${attrName} is ` +
          `"${baseValue}" -- an <img>-embedded SVG freezes at the animation's first sample, ignoring the base ` +
          `value, so the two must agree or the element renders wrong (or invisible) in every README`
      );
      checked += 1;
    }
    if (selfClosing !== "/") {
      stack.push({ name, attrs });
    }
  }
  return checked;
}
