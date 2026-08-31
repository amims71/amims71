import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, root), "utf8");

// Enumerate every file that would be published if committed right now:
// tracked files (--cached) plus untracked-but-not-ignored files (--others),
// with .gitignore applied (--exclude-standard). This is deliberately wider
// than plain `git ls-files`. Plain `--cached` misses a file someone just
// created and hasn't `git add`ed yet -- exactly the moment a stray address
// is most likely to exist, since CI's checkout is always fully tracked but
// a local working tree is not. `--exclude-standard` is what keeps this from
// reopening the problem that moved us off a filesystem walk in the first
// place: `.superpowers/sdd/` is git-ignored, so it is still excluded by
// construction, along with `node_modules/` and everything else .gitignore
// covers -- proven empirically (see task-9-report.md), not assumed. Do NOT
// "simplify" this back to plain `git ls-files`; that silently drops the
// untracked-file coverage this exists for.
function publishableFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean);
}

function textFiles() {
  return publishableFiles().filter((f) => /\.(mjs|js|json|md|ya?ml|svg)$/.test(f));
}

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;

// The literal shell-prompt text in both SVGs is `amims71@github ~ % ...`,
// always followed by whitespace, never a dot. The lookahead pins the
// whitelist to that exact shape. An earlier, unanchored version stripped
// this prefix wherever it appeared, so it would also eat the domain
// suffix off a real address that happens to start with the same prefix,
// hiding it from the scan below behind what looked like a narrow, safe
// whitelist. Do not remove the `(?=\s|$)` lookahead -- see the anchoring
// test below, which exists so that regression fails loudly, not silently.
// (That test builds its fixture addresses from parts, on purpose: writing
// the domain suffix directly here would itself trip the guard below.)
function stripWhitelistedEmails(text) {
  return text
    .replace(/amims71@github(?=\s|$)/g, "")
    .replace(/github-actions\[bot\]@users\.noreply\.github\.com/g, "");
}

function containsEmail(text) {
  return EMAIL_PATTERN.test(stripWhitelistedEmails(text));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Asserts that `name` is never linked in `md`, by any of the three ways
// Markdown can express a link: an inline link on the same line, an HTML
// anchor wrapping the name, or a reference-style link (either the explicit
// `[name][label]`/`[name][]` form, or the shortcut `[name]` form backed by
// a `[name]: url` definition that can live anywhere else in the document).
// Constraint C5 is "never linked" full stop, so this is the one place that
// claim is proven -- keep every new link mechanism landing here instead of
// as a one-off regex next to a single call site.
function assertNeverLinked(name, md) {
  const esc = escapeRegex(name);
  const lines = md.split("\n").filter((l) => l.includes(name));
  assert.ok(lines.length > 0, `missing project ${name}`);
  assert.ok(lines.some((l) => /\[private\]/.test(l)), `${name} not marked [private]`);
  for (const line of lines) {
    assert.ok(!/\]\(http/.test(line), `${name} must not be inline-linked`);
    assert.ok(!/<a\s[^>]*href/i.test(line), `${name} must not be wrapped in an HTML anchor`);
  }

  const explicitRef = new RegExp(`\\[${esc}\\]\\[[^\\]]*\\]`);
  assert.ok(
    !explicitRef.test(md),
    `${name} must not be linked via a reference-style [text][label]`
  );

  const hasDefinition = new RegExp(`^[ \\t]*\\[${esc}\\]:\\s*\\S+`, "m").test(md);
  if (hasDefinition) {
    const usedAsShortcut = new RegExp(`\\[${esc}\\](?!\\(|\\[|:)`);
    assert.ok(
      !usedAsShortcut.test(md),
      `${name} must not be linked via a shortcut reference definition`
    );
  }
}

test("no email address appears anywhere in the repo", async () => {
  const files = textFiles();
  assert.ok(files.length > 0, "expected to scan at least one tracked text file");
  for (const f of files) {
    const body = stripWhitelistedEmails(await read(f));
    const hit = body.match(EMAIL_PATTERN);
    assert.equal(hit, null, `${f} contains an email-like string: ${hit && hit[0]}`);
  }
});

test("the shell-prompt email whitelist is anchored, not a blanket exemption", () => {
  // Built from parts rather than written as a literal contiguous string:
  // this file is itself scanned by "no email address appears anywhere in
  // the repo" below, and writing a real-looking address directly in the
  // source here would trip that guard on its own fixture.
  const realPrompt = ["amims71", "github"].join("@") + " ~ % ./profile.sh";
  const genuineDotCom = ["amims71", "github.com"].join("@");
  const genuineDotIo = "contact " + ["amims71", "github.io"].join("@") + " please";

  assert.equal(containsEmail(realPrompt), false, "the real prompt text must still read as non-email");
  assert.equal(
    containsEmail(genuineDotCom),
    true,
    "a genuine address sharing the prompt's prefix must not be whitelisted away"
  );
  assert.equal(
    containsEmail(genuineDotIo),
    true,
    "a genuine address sharing the prompt's prefix must not be whitelisted away"
  );
});

test("no phone number appears anywhere in the repo", async () => {
  const files = textFiles().filter((f) => !f.endsWith(".svg")); // coordinate soup, checked by card.test.mjs instead
  assert.ok(files.length > 0, "expected to scan at least one tracked text file");
  for (const f of files) {
    const hit = (await read(f)).match(/\+\d[\d\s().-]{9,}/);
    assert.equal(hit, null, `${f} contains a phone-like string: ${hit && hit[0]}`);
  }
});

test("README references only in-repo images, no third-party widget services", async () => {
  const md = await read("README.md");
  for (const host of ["github-readme-stats", "streak-stats", "ghchart", "vercel.app", "demolab.com"]) {
    assert.ok(!md.includes(host), `README uses third-party service ${host}`);
  }
});

test("README embeds both generated cards from raw.githubusercontent.com", async () => {
  const md = await read("README.md");
  assert.match(md, /raw\.githubusercontent\.com\/amims71\/amims71\/main\/card\.svg/);
  assert.match(md, /raw\.githubusercontent\.com\/amims71\/amims71\/main\/heatmap\.svg/);
});

test("README links out to the Pages site", async () => {
  assert.match(await read("README.md"), /amims71\.github\.io/);
});

test("README marks every private project and links none of them", async () => {
  const md = await read("README.md");
  for (const name of ["XP Track", "Multi-Tenant E-commerce System", "CRM"]) {
    assertNeverLinked(name, md);
  }
});

test("private-project link guard rejects an HTML-anchor link", () => {
  const md = '**XP Track** `[private]` <a href="https://example.com">wrapped</a>\n';
  assert.throws(() => assertNeverLinked("XP Track", md), /HTML anchor/);
});

test("private-project link guard rejects an explicit reference-style link", () => {
  const md = [
    "**XP Track** `[private]`",
    "",
    "See also [XP Track][1] for details.",
    "",
    "[1]: https://example.com/xp-track",
    "",
  ].join("\n");
  assert.throws(() => assertNeverLinked("XP Track", md), /reference-style/);
});

test("private-project link guard rejects a shortcut reference-style link", () => {
  const md = [
    "**XP Track** `[private]`",
    "",
    "See also [XP Track] for details.",
    "",
    "[XP Track]: https://example.com/xp-track",
    "",
  ].join("\n");
  assert.throws(() => assertNeverLinked("XP Track", md), /shortcut reference/);
});

test("README links the public repos it names", async () => {
  const md = await read("README.md");
  for (const repo of ["agento", "vibexp", "tinker-web"]) {
    assert.ok(
      md.includes(`github.com/amims71/${repo}`),
      `public repo ${repo} should be linked`
    );
  }
});

test("no light-theme SVG variant exists", async () => {
  const files = textFiles();
  assert.ok(!files.some((f) => /light\.svg$/.test(f)), "dark-only per spec §4");
  const svgs = files.filter((f) => f.endsWith(".svg"));
  assert.deepEqual(svgs.sort(), ["card.svg", "heatmap.svg"]);
});

test("no source file synthesizes data", async () => {
  const files = textFiles().filter((f) => f.endsWith(".mjs") && !f.startsWith("test/"));
  assert.ok(files.length > 0, "expected to scan at least one tracked source file");
  for (const f of files) {
    const body = await read(f);
    assert.doesNotMatch(body, /Math\.random/, `${f} uses Math.random`);
    assert.doesNotMatch(body, /synthesi[sz]e/i, `${f} synthesizes data`);
  }
});
