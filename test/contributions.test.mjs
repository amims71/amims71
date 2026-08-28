import test from "node:test";
import assert from "node:assert/strict";
import { levelFor, computeStreaks, flattenDays, maxCount } from "../src/contributions.mjs";

const day = (date, contributionCount, weekday = 0) => ({ date, contributionCount, weekday });

test("levelFor returns 0 for no contributions", () => {
  assert.equal(levelFor(0, 10), 0);
  assert.equal(levelFor(-3, 10), 0);
});

test("levelFor maps the ratio thresholds from the spec", () => {
  assert.equal(levelFor(1, 10), 1);   // 0.10 -> below 0.15
  assert.equal(levelFor(2, 10), 2);   // 0.20 -> [0.15, 0.40)
  assert.equal(levelFor(4, 10), 3);   // 0.40 -> [0.40, 0.65)
  assert.equal(levelFor(7, 10), 4);   // 0.70 -> >= 0.65
});

test("levelFor is inclusive at each boundary", () => {
  assert.equal(levelFor(65, 100), 4);
  assert.equal(levelFor(40, 100), 3);
  assert.equal(levelFor(15, 100), 2);
});

test("levelFor treats a zero max as one to avoid dividing by zero", () => {
  assert.equal(levelFor(5, 0), 4);
});

test("computeStreaks counts the trailing run as current", () => {
  const days = [day("2026-08-24", 3), day("2026-08-25", 1), day("2026-08-26", 2)];
  assert.deepEqual(computeStreaks(days, "2026-08-26"), { current: 3, longest: 3 });
});

test("computeStreaks stops the current run at the first gap", () => {
  const days = [day("2026-08-24", 3), day("2026-08-25", 0), day("2026-08-26", 2)];
  assert.equal(computeStreaks(days, "2026-08-26").current, 1);
});

test("computeStreaks reports zero current when today is a gap", () => {
  const days = [day("2026-08-25", 4), day("2026-08-26", 0)];
  assert.equal(computeStreaks(days, "2026-08-26").current, 0);
});

test("computeStreaks finds the longest run anywhere in the window", () => {
  const days = [
    day("2026-08-20", 1), day("2026-08-21", 1), day("2026-08-22", 1), day("2026-08-23", 1),
    day("2026-08-24", 0),
    day("2026-08-25", 5),
  ];
  assert.deepEqual(computeStreaks(days, "2026-08-25"), { current: 1, longest: 4 });
});

test("computeStreaks ignores days after today", () => {
  const days = [day("2026-08-25", 2), day("2026-08-26", 1), day("2026-08-27", 0), day("2026-08-28", 0)];
  assert.deepEqual(computeStreaks(days, "2026-08-26"), { current: 2, longest: 2 });
});

test("computeStreaks handles an all-zero window", () => {
  assert.deepEqual(computeStreaks([day("2026-08-25", 0), day("2026-08-26", 0)], "2026-08-26"), {
    current: 0,
    longest: 0,
  });
});

test("computeStreaks handles an empty window", () => {
  assert.deepEqual(computeStreaks([], "2026-08-26"), { current: 0, longest: 0 });
});

test("flattenDays concatenates weeks in order", () => {
  const weeks = [
    { contributionDays: [day("2026-08-23", 1), day("2026-08-24", 2)] },
    { contributionDays: [day("2026-08-25", 3)] },
  ];
  assert.deepEqual(flattenDays(weeks).map((d) => d.contributionCount), [1, 2, 3]);
});

test("maxCount returns the peak, floored at one", () => {
  assert.equal(maxCount([day("a", 3), day("b", 9), day("c", 1)]), 9);
  assert.equal(maxCount([day("a", 0)]), 1);
  assert.equal(maxCount([]), 1);
});
