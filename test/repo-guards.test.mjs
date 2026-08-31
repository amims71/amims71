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

test("no email address appears anywhere in the repo", async () => {
  const files = textFiles();
  assert.ok(files.length > 0, "expected to scan at least one tracked text file");
  for (const f of files) {
    const body = (await read(f))
      .replace(/amims71@github/g, "")                      // the shell prompt, not an address
      .replace(/github-actions\[bot\]@users\.noreply\.github\.com/g, ""); // the CI committer
    const hit = body.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
    assert.equal(hit, null, `${f} contains an email-like string: ${hit && hit[0]}`);
  }
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
    assert.ok(md.includes(name), `missing project ${name}`);
    const line = md.split("\n").find((l) => l.includes(name));
    assert.match(line, /\[private\]/, `${name} not marked [private]`);
    assert.ok(!/\]\(http/.test(line), `${name} must not be linked`);
  }
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
