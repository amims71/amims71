import { Jimp, intToRGBA } from "jimp";
import { smoothstep } from "./util.mjs";

export const ASCII_COLS = 54;
export const ASCII_ROWS = 42;
export const RAMP = " .:-=+*#%@";

// Crop calibrated against the 460x460 avatar (spec §5.2): trims the wall clock
// and bookshelf. The vertical offset is in PIXELS on a 460px-tall source and is
// rescaled below if the avatar is ever replaced at another resolution.
const CROP_W_FRAC = 0.74;
const CROP_H_FRAC = 0.82;
const CROP_Y_OFFSET_PX = -14;
const CROP_REF_HEIGHT = 460;

// Soft elliptical mask. r = 1 is the inscribed ellipse; everything past MASK_HI
// is blank. Removes corner noise by construction and mirrors GitHub's own
// circular avatar treatment.
const MASK_LO = 0.74;
const MASK_HI = 1.0;

// Density gamma: studio portraits shot against a near-white background get
// stretched by normalize() until the whole subject (face, hair, shirt) sits
// in the dark end of the range, mushing features together. Raising (1 - L)
// to this power thins mid-tones back out so a studio-lit subject doesn't
// render as a solid mass.
const DENSITY_GAMMA = 1.8;

export function densityGrid(lumAt, cols = ASCII_COLS, rows = ASCII_ROWS) {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) * 0.5;
  const grid = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const r = Math.hypot((x - cx) / (cols * 0.5), (y - cy) / (rows * 0.52));
      // Density from INVERTED luminance: dark pixels are dense. Not from
      // distance to a corner-averaged background, which inverts this
      // particular photo — see spec §5.2.1.
      let d = (1 - lumAt(x, y)) ** DENSITY_GAMMA;
      d *= 1 - smoothstep(MASK_LO, MASK_HI, r);
      row.push(Math.max(0, Math.min(1, d)));
    }
    grid.push(row);
  }
  return grid;
}

export function gridToRows(grid) {
  return grid.map((row) =>
    row
      .map((d) => RAMP[Math.min(RAMP.length - 1, Math.floor(d * RAMP.length))])
      .join("")
  );
}

export async function buildAscii(path) {
  const img = await Jimp.read(path);
  const scale = img.height / CROP_REF_HEIGHT;
  const w = Math.round(img.width * CROP_W_FRAC);
  const h = Math.round(img.height * CROP_H_FRAC);
  const x = Math.round((img.width - w) / 2);
  const y = Math.max(0, Math.round((img.height - h) / 2 + CROP_Y_OFFSET_PX * scale));

  img.crop({ x, y, w, h });
  img.greyscale();
  img.normalize(); // jimp's equivalent of ImageMagick -auto-level (spec §5.2 step 2)
  img.resize({ w: ASCII_COLS, h: ASCII_ROWS });

  // After greyscale() the three channels are equal, so red carries luminance.
  const lumAt = (px, py) => intToRGBA(img.getPixelColor(px, py)).r / 255;
  return gridToRows(densityGrid(lumAt));
}
