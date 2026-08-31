import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLAPSE_RATIO,
  extractCommittedTotal,
  isCollapse,
  collapseMessage,
  assertNoContributionCollapse,
} from "../src/integrity.mjs";

// A card-shaped fragment, not the real card.svg: the point of splitting the
// floor check into pure functions is that the suite never depends on the
// committed artifact's current contents (which change every day the workflow
// runs). The `·` separator and the "N contributions" wording mirror
// buildSections in src/card.mjs; card.test.mjs is what pins that those two
// stay in step.
const cardWith = (total) =>
  '<svg><text x="1140" y="541" text-anchor="end" class="kv-value">' +
  `amims71 · ${total} contributions</text></svg>`;

const enoent = () => {
  const err = new Error("ENOENT: no such file or directory, open 'card.svg'");
  err.code = "ENOENT";
  throw err;
};

test("extractCommittedTotal reads the comma-formatted total out of a card", () => {
  assert.equal(extractCommittedTotal(cardWith("5,476")), 5476);
});

test("extractCommittedTotal reads a total with no thousands separator", () => {
  assert.equal(extractCommittedTotal(cardWith("347")), 347);
});

test("extractCommittedTotal returns null when no contribution row is present", () => {
  assert.equal(extractCommittedTotal("<svg><text>nothing here</text></svg>"), null);
  assert.equal(extractCommittedTotal(""), null);
});

test("COLLAPSE_RATIO is the deliberate 50% floor", () => {
  assert.equal(COLLAPSE_RATIO, 0.5);
});

test("isCollapse ignores ordinary rolling-window drift", () => {
  // The real day-over-day delta: 5,476 committed, 5,477 fetched. Also the
  // shape of a genuinely quiet stretch, which must not fail the build.
  assert.equal(isCollapse(5477, 5476), false);
  assert.equal(isCollapse(5000, 5476), false);
  assert.equal(isCollapse(3000, 5476), false);
});

test("isCollapse treats exactly half as allowed and anything below it as a collapse", () => {
  // "Dropped by more than 50%" -- the boundary itself passes, deliberately,
  // so the threshold has one unambiguous meaning.
  assert.equal(isCollapse(2738, 5476), false);
  assert.equal(isCollapse(2737, 5476), true);
});

test("isCollapse catches the measured token-visibility failure", () => {
  // Measured live 2026-08-31: total 5,477 of which 5,130 are
  // restrictedContributionsCount, leaving 334 public contributions. A token
  // that cannot see private activity returns about that.
  assert.equal(isCollapse(334, 5476), true);
});

test("isCollapse cannot fire without a usable baseline", () => {
  for (const baseline of [null, 0, -1, NaN, undefined, "5476"]) {
    assert.equal(isCollapse(1, baseline), false, `baseline ${String(baseline)} should not be comparable`);
  }
  assert.equal(isCollapse(NaN, 5476), false, "a non-finite fetched total is fetchCalendar's error to raise, not this one's");
});

test("collapseMessage names both numbers and the likely cause", () => {
  const msg = collapseMessage(334, 5476);
  assert.match(msg, /5,476/);
  assert.match(msg, /334/);
  assert.match(msg, /50% floor/);
  assert.match(msg, /private contributions/);
  assert.match(msg, /GH_TOKEN/);
});

test("assertNoContributionCollapse passes the current, real drift", async () => {
  const res = await assertNoContributionCollapse(5477, { read: async () => cardWith("5,476") });
  assert.deepEqual(res, { checked: true, committedTotal: 5476 });
});

test("assertNoContributionCollapse throws on a collapse, before anything is written", async () => {
  await assert.rejects(
    () => assertNoContributionCollapse(334, { read: async () => cardWith("5,476") }),
    /collapsed from 5,476 .* to 334/s
  );
});

test("assertNoContributionCollapse skips gracefully on the genuine first run", async () => {
  const res = await assertNoContributionCollapse(5477, { read: async () => enoent() });
  assert.equal(res.checked, false);
  assert.match(res.reason, /first run/);
});

test("assertNoContributionCollapse rethrows a read error that is not a missing file", async () => {
  const boom = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  await assert.rejects(
    () => assertNoContributionCollapse(5477, { read: async () => { throw boom; } }),
    /EACCES/
  );
});

// The check going quietly inoperative is the failure mode this module exists
// to reject, so an unreadable-but-present card is loud, not skipped.
test("assertNoContributionCollapse throws when a present card yields no total", async () => {
  await assert.rejects(
    () => assertNoContributionCollapse(334, { read: async () => "<svg><text>no contact row</text></svg>" }),
    /diverged/
  );
});

test("assertNoContributionCollapse honours an injected ratio", async () => {
  const read = async () => cardWith("5,476");
  await assert.rejects(() => assertNoContributionCollapse(5000, { read, ratio: 0.95 }), /collapsed/);
  await assertNoContributionCollapse(5000, { read, ratio: 0.9 });
});
