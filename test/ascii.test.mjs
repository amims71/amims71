import test from "node:test";
import assert from "node:assert/strict";
import { ASCII_COLS, ASCII_ROWS, RAMP, densityGrid, gridToRows, buildAscii } from "../src/ascii.mjs";

const AVATAR = new URL("../avatar.png", import.meta.url).pathname;

// Mean ramp index over an inclusive character-cell rectangle.
function bandMean(rows, r0, r1, c0, c1) {
  let sum = 0;
  let n = 0;
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      sum += RAMP.indexOf(rows[y][x]);
      n += 1;
    }
  }
  return sum / n;
}

test("RAMP runs sparse to dense and has ten steps", () => {
  assert.equal(RAMP.length, 10);
  assert.equal(RAMP[0], " ");
  assert.equal(RAMP[9], "@");
});

test("densityGrid returns rows x cols numbers in [0,1]", () => {
  const grid = densityGrid(() => 0.5, 8, 6);
  assert.equal(grid.length, 6);
  assert.equal(grid[0].length, 8);
  for (const row of grid) for (const d of row) assert.ok(d >= 0 && d <= 1);
});

test("densityGrid masks the corners to zero even for a fully black image", () => {
  const grid = densityGrid(() => 0, ASCII_COLS, ASCII_ROWS);
  assert.equal(grid[0][0], 0);
  assert.equal(grid[0][ASCII_COLS - 1], 0);
  assert.equal(grid[ASCII_ROWS - 1][0], 0);
  assert.equal(grid[ASCII_ROWS - 1][ASCII_COLS - 1], 0);
});

test("densityGrid leaves the centre unmasked for a fully black image", () => {
  const grid = densityGrid(() => 0, ASCII_COLS, ASCII_ROWS);
  assert.equal(grid[Math.floor(ASCII_ROWS / 2)][Math.floor(ASCII_COLS / 2)], 1);
});

test("densityGrid maps dark pixels dense and light pixels sparse", () => {
  const mid = [Math.floor(ASCII_ROWS / 2), Math.floor(ASCII_COLS / 2)];
  const dark = densityGrid(() => 0.1, ASCII_COLS, ASCII_ROWS)[mid[0]][mid[1]];
  const light = densityGrid(() => 0.9, ASCII_COLS, ASCII_ROWS)[mid[0]][mid[1]];
  assert.ok(dark > light, `expected dark(${dark}) > light(${light})`);
});

test("gridToRows maps the density extremes to the ramp extremes", () => {
  assert.equal(gridToRows([[0, 1]])[0], " @");
});

test("gridToRows never indexes past the end of the ramp", () => {
  assert.equal(gridToRows([[1.0]])[0], "@");
});

test("buildAscii returns a 42x54 character block", async () => {
  const rows = await buildAscii(AVATAR);
  assert.equal(rows.length, ASCII_ROWS);
  for (const row of rows) assert.equal(row.length, ASCII_COLS);
});

test("buildAscii leaves the corners blank via the elliptical mask", async () => {
  const rows = await buildAscii(AVATAR);
  assert.equal(rows[0][0], " ");
  assert.equal(rows[0][ASCII_COLS - 1], " ");
  assert.equal(rows[ASCII_ROWS - 1][0], " ");
  assert.equal(rows[ASCII_ROWS - 1][ASCII_COLS - 1], " ");
});

test("buildAscii produces a portrait, not a silhouette or an empty frame", async () => {
  const rows = await buildAscii(AVATAR);
  const total = ASCII_ROWS * ASCII_COLS;
  const inked = rows.join("").split("").filter((c) => c !== " ").length;
  const ratio = inked / total;
  assert.ok(ratio > 0.30 && ratio < 0.75, `ink ratio ${ratio.toFixed(3)} outside 0.30-0.75`);
});

// The regression test for spec §5.2.1. Under jeslor's corner-averaged algorithm
// the cheeks score near-zero contrast and the dark hair/background score
// maximum, so hair-vs-cheek ordering is exactly what distinguishes a working
// portrait from the inverted one.
test("buildAscii renders hair denser than cheeks", async () => {
  const rows = await buildAscii(AVATAR);
  const hair = bandMean(rows, 3, 9, 22, 38);
  const cheek = bandMean(rows, 20, 26, 26, 34);
  assert.ok(hair > cheek + 1.5, `hair ${hair.toFixed(2)} not clearly denser than cheek ${cheek.toFixed(2)}`);
  assert.ok(hair > 5, `hair band mean ${hair.toFixed(2)} too light to be hair`);
});
