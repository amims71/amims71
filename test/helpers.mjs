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
