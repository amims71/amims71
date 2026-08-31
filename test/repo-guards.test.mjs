import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { assertBalancedXml, assertNoHoles, assertAnimationsMatchBaseValues } from "./helpers.mjs";

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
//
// The second entry -- the bot committer address in
// .github/workflows/cards.yml -- had the same hole and is now anchored the
// same way. Both anchors admit `"` as well as whitespace and the string
// boundary, because that address appears inside double quotes in the YAML
// (`git config user.email "..."`), so a whitespace-only anchor would stop
// whitelisting the one genuine occurrence. Anchoring matters because a strip
// DELETES text: wherever the literal overlaps a real address, deleting it is
// what hides that address from the scan below. See "the bot-address email
// whitelist is anchored" for both overlap directions.
function stripWhitelistedEmails(text) {
  return text
    .replace(/amims71@github(?=\s|$)/g, "")
    .replace(/(?<=^|[\s"])github-actions\[bot\]@users\.noreply\.github\.com(?=\s|"|$)/g, "");
}

function containsEmail(text) {
  return EMAIL_PATTERN.test(stripWhitelistedEmails(text));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Link syntax that must never share a line with a private project's name.
// These key on the *syntax that makes something a link*, never on what the
// target URL looks like -- that distinction is the whole point. Round 3 of
// this guard checked lines for `https?://`, believing that to be the
// "closed form" replacement for an enumeration of link syntaxes. It wasn't:
// a check for `https?://` is a one-item scheme enumeration in disguise, and
// five link forms walked through it (protocol-relative `](//host)`, a
// non-http scheme like `mailto:`/`ftp:`, a scheme-less `](host/path)`, and
// a case-varied `HTTPS://` that the flagless regex simply didn't see).
//
// `](` is the load-bearing rule: it appears in *every* Markdown inline
// link regardless of the target, so it is scheme-independent by
// construction. The rest cover the non-inline ways to link: `][` for a
// reference usage, `<a` for HTML, any `scheme://` for a bare/auto-linked
// URL under any scheme in any case, a whitespace- or line-start-prefixed
// `//` for a bare protocol-relative URL, and a bare `www.` host for GFM's
// autolink extension. Do NOT reintroduce a scheme-shaped check here; that
// is the exact regression this list exists to prevent.
//
// The `www.` rule is not a relapse into enumerating syntaxes: it is here
// because GitHub's own markdown API was asked, and it renders a bare
// `www.example.com/x` as a live anchor to `http://www.example.com/x`. The
// same check confirms a bare scheme-less host (`example.com/x`) is NOT
// linked, so there is deliberately no rule for that -- it would only
// manufacture false positives. Confirmed-renders-as-a-link is the bar for
// admitting a rule here; that is also why the unconfirmed split-reference
// form (`[Name]` newline `[1]` with `[1]: url`) stays unchased.
//
// That rule's prefix class is `[\s*_~(]`, not whitespace alone, and the
// difference is measured rather than guessed: 34 candidate prefixes were put
// through GitHub's markdown API, and `(`, `*`, `_` and `~` each still yield a
// live anchor while every other probed character (`[`, `>`, `"`, `'`, `-`,
// `.`, `/`, `:`, `!`, a backtick, `{`, `|`, `+`, `=`, `,`, `;`, `#`, `&`,
// `\\`, `@`, digits, letters, `)`, `]`, `}`, `<`) does not. That is the
// delimiter set the GFM spec itself states, so this class is closed-form and
// bounded in BOTH directions -- see the four `after ...` tests and the
// "leaves as plain text" boundary test below, which pin each side.
const LINK_SYNTAX = [
  [/\]\(/, "inline-link marker `](`"],
  [/\]\[/, "reference-link marker `][`"],
  [/<a\b/i, "HTML anchor tag"],
  [/\b[a-z][a-z0-9+.-]*:\/\//i, "URL scheme"],
  [/(^|\s)\/\//, "protocol-relative URL"],
  [/(^|[\s*_~(])www\./i, "bare `www.` autolink host"],
];

// Asserts that `name` is never linked, keyed on link syntax rather than on
// any property of the target URL. Every prior round of this guard added one
// more special case (inline link, HTML anchor, explicit reference, shortcut
// reference, autolink, bare URL) after finding the previous version missed a
// syntax -- that pattern is itself the evidence that enumerating URL shapes
// is the wrong shape for the check. The property that actually matters for
// C5: no line mentioning the name may carry any link syntax at all; the
// name may not fall inside an HTML anchor span even when that span crosses
// a line break; anchors must balance, so that span scan is sound rather
// than blind to an unclosed tag; and no reference-style definition may
// resolve the name to a URL, matched case-insensitively per Markdown's own
// label semantics. This can over-reject (an unrelated link merely sharing a
// line with the name) -- that is the safe direction for a guard whose
// failure mode is silently publishing a link to an employer's private work.
function assertNeverLinked(name, md) {
  const esc = escapeRegex(name);
  const lines = md.split("\n").filter((l) => l.includes(name));
  assert.ok(lines.length > 0, `missing project ${name}`);
  assert.ok(lines.some((l) => /\[private\]/.test(l)), `${name} not marked [private]`);
  for (const line of lines) {
    for (const [pattern, label] of LINK_SYNTAX) {
      assert.ok(!pattern.test(line), `${name}'s line must carry no ${label}: ${line}`);
    }
  }

  // An unclosed anchor is malformed markup and worth failing on by itself,
  // but it also makes the span scan below structurally blind: the span
  // regex needs a literal `</a>` to form a match at all, so a name sitting
  // inside a never-closed anchor would be scanned by a loop with zero
  // iterations. Asserting the counts balance is what makes that scan sound.
  const opens = (md.match(/<a\b/gi) ?? []).length;
  const closes = (md.match(/<\/a\s*>/gi) ?? []).length;
  assert.equal(
    opens,
    closes,
    `unbalanced HTML anchors: ${opens} <a> vs ${closes} </a> -- malformed markup, and it leaves the anchor-span scan below silently incomplete`
  );

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

test("the bot-address email whitelist is anchored, not a blanket exemption", () => {
  // Built from parts for the same reason as the test above: this file is
  // itself scanned by "no email address appears anywhere in the repo", and a
  // contiguous literal here would be a fixture that depends on the very
  // whitelist under test.
  const bot = "github-actions[bot]" + "@" + "users.noreply.github.com";

  // The single real occurrence is .github/workflows/cards.yml's
  // `git config user.email "..."`, where the address sits INSIDE double
  // quotes -- so both anchors must admit `"`. The shell-prompt entry above
  // gets away with `(?=\s|$)` because a prompt is always followed by
  // whitespace; copying that shape here would un-whitelist the genuine
  // workflow line and fail the C4 scan on a legitimate file.
  assert.equal(containsEmail(`git config user.email "${bot}"`), false, "the genuine YAML line must still read as non-email");
  assert.equal(containsEmail(bot), false, "the bare bot address must still be whitelisted");

  // ...and the hole the anchors close. An unanchored strip deletes the
  // literal wherever it appears -- including where it overlaps a genuine
  // address -- and it is the deletion that hides that address from the scan:
  //   left overlap:  "x@notify." + bot  strips back to "x@notify.", which is
  //                  no longer an address -- while the unstripped text does
  //                  contain one (local part "x", host "notify" dot "github");
  //   right overlap: bot + "@example.test" strips back to "@example.test",
  //                  which has no local part -- while the unstripped text does
  //                  contain one (the bot host as the local part of a genuine
  //                  address at example.test).
  // Both are spelled as concatenations, never as one literal, so this comment
  // is not itself an address for the repo-wide scan to find.
  // (The review's own example, "notify-" + bot, is NOT one of these: a local
  // part cannot end in "]", so EMAIL_PATTERN never matched that form with or
  // without the strip. The hole is real, but this is the shape it takes.)
  assert.equal(
    containsEmail("x@notify." + bot),
    true,
    "a genuine address whose domain runs into the whitelisted literal must survive the strip"
  );
  assert.equal(
    containsEmail(bot + "@example.test"),
    true,
    "a genuine address whose local part runs out of the whitelisted literal must survive the strip"
  );
});

test("no phone number appears anywhere in the repo", async () => {
  // .svg is excluded here only because an unanchored digit run matches SVG
  // coordinate soup; the committed SVGs are scanned with the same anchored
  // pattern by "both committed SVGs pass every structural and animation
  // guard, on disk" below. (This used to claim card.test.mjs covered them --
  // it does not: card.test.mjs scans a card built from a synthetic fixture,
  // never the committed file, and never touches heatmap.svg at all.)
  const files = textFiles().filter((f) => !f.endsWith(".svg"));
  assert.ok(files.length > 0, "expected to scan at least one tracked text file");
  for (const f of files) {
    const hit = (await read(f)).match(/\+\d[\d\s().-]{9,}/);
    assert.equal(hit, null, `${f} contains a phone-like string: ${hit && hit[0]}`);
  }
});

// The committed pair IS the deliverable -- GitHub renders card.svg and
// heatmap.svg, not the in-memory SVGs that card.test.mjs and
// heatmap.test.mjs build from synthetic fixtures. Before this test, exactly
// two tests opened those files at all (the C4 email scan and the "exactly
// two SVGs" filename assertion), so assertBalancedXml, assertNoHoles and
// assertAnimationsMatchBaseValues -- the three guards encoding everything
// this project learned the hard way about how an <img>-embedded SVG renders
// -- had never run against a single published byte. The workflow was
// deliberately ordered to generate BEFORE it tests so CI validates what it
// is about to commit; that ordering only buys anything if a test actually
// reads the artifacts off disk. This is that test.
test("both committed SVGs pass every structural and animation guard, on disk", async () => {
  for (const name of ["card.svg", "heatmap.svg"]) {
    const svg = await read(name);
    assert.ok(svg.startsWith("<svg"), `${name} does not start with <svg`);
    assert.ok(svg.trimEnd().endsWith("</svg>"), `${name} does not end with </svg>`);
    assertBalancedXml(svg);
    assertNoHoles(svg);
    // Measured on the current pair: card.svg checks 3 (the LIVE-dot opacity
    // blink plus two gradient stop-colours; its scan-beam animateTransform
    // has no base transform by design, so it is correctly not counted) and
    // heatmap.svg checks 95. Asserted as `> 0` rather than pinned to those
    // numbers because both scale with live calendar data -- the point of the
    // assertion is that the guard inspected something, so it cannot report
    // success over a file it never parsed.
    const checked = assertAnimationsMatchBaseValues(svg);
    assert.ok(checked > 0, `${name}: the animation guard checked nothing, so it passed vacuously`);
    // Same anchored pattern the repo-wide phone scan uses, applied here
    // because that scan skips .svg (see its comment).
    const phone = svg.match(/\+\d[\d\s().-]{9,}/);
    assert.equal(phone, null, `${name} contains a phone-like string: ${phone && phone[0]}`);
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

// The next five each demonstrate one of the five forms a later review round
// found evading the round-3 version of this guard. Round 3 had replaced the
// enumerated syntax checks with a per-line `!/https?:\/\//` URL check --
// which is itself a one-item scheme enumeration in disguise, so every link
// whose target isn't spelled with a lowercase `http`/`https` scheme walked
// straight through. The fix keys on link *syntax* instead: `](` appears in
// every Markdown inline link no matter what the target looks like, which is
// scheme-independent by construction. The fifth form is the anchor the span
// scan cannot see at all, because a span needs a literal `</a>` to exist.

test("private-project link guard rejects a protocol-relative link", () => {
  // `](//host/path)` -- a real link with no scheme at all, so the old
  // `https?://` check had nothing to match.
  const inline = "**XP Track** `[private]`\n\nSee also [XP Track](//example.com/x).\n";
  assert.throws(() => assertNeverLinked("XP Track", inline), /inline-link marker/);

  // The bare form, which is what the leading-`//` rule exists for: here
  // there is no `](` to catch it first.
  const bare = "**XP Track** `[private]` see //example.com/x\n";
  assert.throws(() => assertNeverLinked("XP Track", bare), /protocol-relative URL/);
});

test("private-project link guard rejects a non-http URL scheme", () => {
  // The mailto target is composed from parts on purpose: spelled as one
  // contiguous literal it would read as an address to this repo's own
  // "no email address appears anywhere" guard, which scans this file too.
  const mailtoTarget = "mailto:x" + "@" + "example.test";
  const mailto = "**XP Track** `[private]`\n\nSee also [XP Track](" + mailtoTarget + ").\n";
  assert.throws(() => assertNeverLinked("XP Track", mailto), /inline-link marker/);

  const ftpInline = "**XP Track** `[private]`\n\nSee also [XP Track](ftp://example.com/x).\n";
  assert.throws(() => assertNeverLinked("XP Track", ftpInline), /inline-link marker/);

  // Bare, so the generic `scheme://` rule is the one under test rather
  // than the inline-link marker.
  const ftpBare = "**XP Track** `[private]` see ftp://example.com/x\n";
  assert.throws(() => assertNeverLinked("XP Track", ftpBare), /carry no URL scheme/);
});

test("private-project link guard rejects a scheme-less link target", () => {
  const md = "**XP Track** `[private]`\n\nSee also [XP Track](example.com/x).\n";
  assert.throws(() => assertNeverLinked("XP Track", md), /inline-link marker/);
});

test("private-project link guard rejects a case-varied URL scheme", () => {
  // Schemes are case-insensitive in URLs; the old check had no `i` flag.
  const inline = "**XP Track** `[private]`\n\nSee also [XP Track](HTTPS://example.com/x).\n";
  assert.throws(() => assertNeverLinked("XP Track", inline), /inline-link marker/);

  const bare = "**XP Track** `[private]` see HTTPS://example.com/x\n";
  assert.throws(() => assertNeverLinked("XP Track", bare), /carry no URL scheme/);
});

test("private-project link guard rejects an unclosed HTML anchor", () => {
  // No `</a>` anywhere, so `<a ...>...</a>` never forms a span and the
  // whole-document span scan below has nothing to iterate -- the name sits
  // inside an open anchor that the scan is structurally blind to. Asserting
  // the tag counts balance is what makes that scan sound rather than
  // silently incomplete, and an unclosed anchor is malformed markup worth
  // failing on in its own right.
  const md = [
    "**XP Track** `[private]`",
    "",
    '<a href="https://example.com">',
    "XP Track",
    "",
  ].join("\n");
  assert.throws(() => assertNeverLinked("XP Track", md), /unbalanced HTML anchors/);
});

test("private-project link guard rejects a bare www. autolink host", () => {
  // GFM's autolink extension turns a bare `www.` host into a live link with
  // no bracket syntax and no scheme at all -- confirmed against GitHub's own
  // markdown API, which renders `www.example.com/xp-track` as an anchor to
  // `http://www.example.com/xp-track`. So this really would put a clickable
  // link to private work on the profile page.
  const md = "**XP Track** `[private]` see www.example.com/xp-track\n";
  assert.throws(() => assertNeverLinked("XP Track", md), /autolink host/);
});

// GFM's `www.` autolink is not delimited by whitespace alone. A later review
// round put 34 candidate prefixes through GitHub's own markdown API: `(`, `*`,
// `_` and `~` each still render a live anchor, while `[`, `>`, `"`, `'`, `-`,
// `.`, `/`, `:`, `!`, a backtick, `{`, `|`, `+`, `=`, `,`, `;`, `#`, `&`, `\`,
// `@`, digits, letters, `)`, `]`, `}` and `<` do not. That set is exactly the
// delimiter set the GFM spec states for the autolink extension, so
// `(^|[\s*_~(])www\.` is closed-form -- not one more round of enumerating
// syntaxes. Each of the four prefixes below walked straight through the
// previous `(^|\s)www\.` rule; one test each, so a partial regression names
// which prefix came back.
for (const [prefix, label] of [
  ["(", "an opening parenthesis"],
  ["*", "an emphasis asterisk"],
  ["_", "an emphasis underscore"],
  ["~", "a strikethrough tilde"],
]) {
  test(`private-project link guard rejects a bare www. autolink host after ${label}`, () => {
    const md = `**XP Track** \`[private]\` see ${prefix}www.example.com/xp-track\n`;
    assert.throws(() => assertNeverLinked("XP Track", md), /autolink host/);
  });
}

test("private-project link guard still allows a www. that GFM leaves as plain text", () => {
  // The other boundary of the same closed form, and the reason the character
  // class is `[\s*_~(]` rather than `.`: the API probe above confirms a `www.`
  // preceded by a word character, `-` or `[` is NOT auto-linked, so a rule
  // that fired on those would only manufacture false positives. Deliberately
  // passes both before and after the character-class widening -- it exists to
  // pin the upper bound, not to catch the old rule.
  for (const prefix of ["x", "4", "-", "["]) {
    const md = `**XP Track** \`[private]\` see ${prefix}www.example.com/xp-track\n`;
    assert.doesNotThrow(() => assertNeverLinked("XP Track", md), `prefix "${prefix}" should stay allowed`);
  }
});

test("private-project link guard allows a bare scheme-less host, which GFM does not link", () => {
  // The boundary, and the reason it sits exactly here: the same API check
  // confirms GitHub renders `example.com/xp-track` as plain text, NOT a
  // link. A rule for bare scheme-less hosts would therefore only manufacture
  // false positives, so there deliberately isn't one. This test pins the
  // boundary so a future round cannot widen it on a guess -- the same
  // standard that keeps the unconfirmed split-reference case unchased.
  const md = "**XP Track** `[private]` see example.com/xp-track\n";
  assert.doesNotThrow(() => assertNeverLinked("XP Track", md));

  // ...while the *linked* form of that same host is still rejected, so the
  // allowance above is about how GFM renders it, not about the host itself.
  const linked = "**XP Track** `[private]` see [XP Track](example.com/xp-track)\n";
  assert.throws(() => assertNeverLinked("XP Track", linked), /inline-link marker/);
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
