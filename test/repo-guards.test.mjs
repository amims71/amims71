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

// Asserts that `name` is never linked, as a closed-form property instead
// of an enumeration of link syntaxes. Every prior round of this guard
// added one more special case (inline link, HTML anchor, explicit
// reference, shortcut reference) after finding the previous enumeration
// missed a syntax -- that pattern is itself the evidence that enumerating
// syntaxes is the wrong shape. The property that actually matters for C5:
// no line mentioning the name may carry a URL, an HTML anchor tag, or a
// reference-link marker; the name may not fall inside an HTML anchor span
// even when that span crosses a line break; and no reference-style
// definition may resolve the name to a URL, matched case-insensitively
// per Markdown's own label semantics. This can over-reject (an unrelated
// URL merely sharing a line with the name) -- that is the safe direction
// for a guard whose failure mode is silently publishing a link to private
// work.
function assertNeverLinked(name, md) {
  const esc = escapeRegex(name);
  const lines = md.split("\n").filter((l) => l.includes(name));
  assert.ok(lines.length > 0, `missing project ${name}`);
  assert.ok(lines.some((l) => /\[private\]/.test(l)), `${name} not marked [private]`);
  for (const line of lines) {
    assert.ok(!/https?:\/\//.test(line), `${name}'s line must carry no URL: ${line}`);
    assert.ok(!/<a\b/i.test(line), `${name}'s line must carry no HTML anchor tag: ${line}`);
    assert.ok(!/\]\[/.test(line), `${name}'s line must carry no reference-link marker: ${line}`);
  }

  const flattened = md.replace(/\n/g, " ");
  for (const span of flattened.match(/<a\b[^>]*>.*?<\/a>/gi) ?? []) {
    assert.ok(!span.includes(name), `${name} falls inside an HTML anchor span (possibly multi-line)`);
  }

  const definesName = new RegExp(`^[ \\t]*\\[${esc}\\]:\\s*\\S+`, "im").test(md);
  if (definesName) {
    assert.ok(
      !new RegExp(`\\[${esc}\\](?!\\(|\\[|:)`, "i").test(md),
      `${name} must not resolve via a case-insensitive reference definition`
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
  // href deliberately has no "https://" so this exercises the <a>-tag
  // check in isolation, not the URL check.
  const md = '**XP Track** `[private]` <a href="/local-page">wrapped</a>\n';
  assert.throws(() => assertNeverLinked("XP Track", md), /HTML anchor tag/);
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
  assert.throws(() => assertNeverLinked("XP Track", md), /reference-link marker/);
});

test("private-project link guard rejects a shortcut reference-style link", () => {
  // The definition line `[XP Track]: https://...` matches the name at the
  // exact same case as the label, so it lands in `lines` (it contains
  // "XP Track") and the generic per-line URL check rejects it directly --
  // it never needs to reach the dedicated definition-matching branch below.
  // That branch exists for the case-*differing* form only, exercised by
  // the "case-differing reference label" test.
  const md = [
    "**XP Track** `[private]`",
    "",
    "See also [XP Track] for details.",
    "",
    "[XP Track]: https://example.com/xp-track",
    "",
  ].join("\n");
  assert.throws(() => assertNeverLinked("XP Track", md), /carry no URL/);
});

// The next four each demonstrate one of the four gaps a later review round
// found in the previous (enumerated) version of this guard. Each fixture is
// the minimal document that would have sailed through the old per-line
// `]\(http` / `<a\s[^>]*href` checks and the case-sensitive definition
// match, and now doesn't.

test("private-project link guard rejects a same-line autolink", () => {
  // GFM autolink: <https://...>. Contains no "](" and no "<a", so the old
  // enumeration missed it outright; the closed-form URL check catches it
  // because the substring "https://" is present on the name's own line.
  const md = "**XP Track** `[private]` see <https://example.com> for details\n";
  assert.throws(() => assertNeverLinked("XP Track", md), /carry no URL/);
});

test("private-project link guard rejects a bare same-line URL", () => {
  // GFM auto-links a bare URL with no bracket syntax at all.
  const md = "**XP Track** `[private]` https://example.com\n";
  assert.throws(() => assertNeverLinked("XP Track", md), /carry no URL/);
});

test("private-project link guard rejects a multi-line HTML anchor", () => {
  // The name sits on its own line, inside an anchor whose opening and
  // closing tags are on different lines -- a per-line filter never puts
  // the <a> tag and the name in the same string, which is exactly why
  // this needs a whole-document, newline-flattened scan.
  const md = [
    "**XP Track** `[private]`",
    "",
    '<a href="https://example.com">',
    "XP Track",
    "</a>",
    "",
  ].join("\n");
  assert.throws(() => assertNeverLinked("XP Track", md), /HTML anchor span/);
});

test("private-project link guard rejects a case-differing reference label", () => {
  // Markdown resolves reference labels case-insensitively, so `[XP Track]`
  // is linked by a `[xp track]: url` definition even though the literal
  // casing differs. A case-sensitive definition match misses this.
  const md = [
    "**XP Track** `[private]`",
    "",
    "See also [XP Track] for details.",
    "",
    "[xp track]: https://example.com/xp-track",
    "",
  ].join("\n");
  assert.throws(() => assertNeverLinked("XP Track", md), /case-insensitive reference/);
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
