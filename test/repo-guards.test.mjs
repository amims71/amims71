import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const read = (rel) => readFile(new URL(rel, root), "utf8");

// Enumerate tracked files only (via `git ls-files`), not the filesystem.
// `.superpowers/sdd/` is a git-ignored working directory that holds briefs
// and reports which can never be published — scanning it would guard
// content that isn't part of the repo this README task actually governs.
// Constraint C4 ("no email/phone anywhere in the repo") is read as "in what
// is tracked and therefore published", so tracked-only enumeration is the
// correct check, not an approximation of one.
function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function textFiles() {
  return trackedFiles().filter((f) => /\.(mjs|js|json|md|ya?ml|svg)$/.test(f));
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
