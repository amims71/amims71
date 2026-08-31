import { THEME } from "./theme.mjs";
import { formatInt } from "./util.mjs";
import { PROFILE } from "./content.mjs";
import { levelFor, flattenDays, intensityScale, computeStreaks } from "./contributions.mjs";

export const GEOM = Object.freeze({ cell: 11, gap: 3, gridX: 46, gridY: 74, laneH: 52 });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function geometry(weekCount) {
  const step = GEOM.cell + GEOM.gap;
  const gridW = weekCount * step;
  const width = GEOM.gridX + gridW + 30;
  const height = GEOM.gridY + 7 * step + GEOM.laneH + 46;
  const laneY = GEOM.gridY + 7 * step + GEOM.laneH / 2 + 10;
  return { step, gridW, width, height, laneY };
}

// Seconds for one there-and-back sweep of the glider.
export const GLIDER_DUR = 17;

export function columnPeaks(weeks, scale) {
  return weeks.map((week, weekIndex) => {
    let best = null;
    for (const d of week.contributionDays) {
      if (!best || d.contributionCount > best.contributionCount) best = d;
    }
    return {
      weekIndex,
      weekday: best ? best.weekday : 0,
      count: best ? best.contributionCount : 0,
      level: best ? levelFor(best.contributionCount, scale) : 0,
    };
  });
}

// The glider travels the lane linearly, so the fraction of the cycle at which
// it sits over a column is that column's fraction along the lane. Each column
// is therefore visited at t = f/2 outbound and t = 0.5 + (1-f)/2 inbound.
function laneFraction(cx, gridW) {
  const xStart = GEOM.gridX + 10;
  const xEnd = GEOM.gridX + gridW - 10;
  return Math.min(1, Math.max(0, (cx - xStart) / (xEnd - xStart)));
}

// Strictly ascending keyTimes are required by SMIL; equal or descending values
// make the whole animation inert in some renderers. Nudge collisions forward.
// Safe for probeSchedule because column fractions are distinct, so at most one
// event lands on t=1 and the nudge never has to push past the ceiling.
// touchOpacity does NOT use this — its pulses clamp at both ends.
function ascending(times) {
  const out = [];
  let last = -1;
  for (const raw of times) {
    let t = Math.min(1, Math.max(0, raw));
    if (t <= last) t = Math.min(1, last + 0.0006);
    out.push(t);
    last = t;
  }
  return out;
}

// Where the beam tip points for one column's peak day, and how it should
// look when it gets there. Factored out of probeSchedule so buildGlider can
// compute the identical target for the spotlight column (task-12) without
// duplicating the hit/color/width/dot rules.
function peakTarget(peak, step) {
  const topY = GEOM.gridY + GEOM.cell / 2;
  const hit = peak.level >= 3;
  return {
    cx: GEOM.gridX + peak.weekIndex * step + GEOM.cell / 2,
    y: hit ? GEOM.gridY + peak.weekday * step + GEOM.cell / 2 : topY,
    color: hit ? THEME.heat[peak.level] : THEME.cyan,
    width: peak.level === 4 ? "2.6" : peak.level === 3 ? "2" : "1.1",
    dot: peak.level === 4 ? "3.4" : peak.level === 3 ? "2.6" : "1.6",
  };
}

// The single busiest day in the whole window -- not merely the brightest
// *level*, since several columns commonly share level 4 (see columnPeaks).
// Used (task-12) to park the resting glider under a cell a visitor can
// actually see lit up, instead of the inert lane-start position: an <img>-
// embedded SVG never animates on screen (see touchOpacity's comment below /
// task-8-report.md), so the resting frame is the only frame most visitors
// ever see. Returns null when every day in the window is empty.
function findSpotlight(weeks, scale) {
  const peaks = columnPeaks(weeks, scale);
  let best = null;
  for (const p of peaks) {
    if (p.count > 0 && (!best || p.count > best.count)) best = p;
  }
  return best;
}

// Rest-layer opacity schedule shared by every task-12 "visible at rest,
// vanishes once anything animates" element (spotlight-marker,
// glider-count-rest): lit (1) at t=0, dropping to 0 by t=0.0008 and staying
// there, frozen. keyTimes must be strictly ascending per SMIL, hence the
// tiny nudge off of 0 rather than a bare "0;0".
const REST_KEYTIMES = "0;0.0008;1";
const REST_VALUES = "1;0;0";

export function probeSchedule(weeks, scale, { step, laneY, gridW }) {
  const targets = columnPeaks(weeks, scale).map((peak) => peakTarget(peak, step));

  const events = [];
  for (const target of targets) {
    const f = laneFraction(target.cx, gridW);
    events.push({ t: f * 0.5, target });
    events.push({ t: 0.5 + (1 - f) * 0.5, target });
  }
  events.sort((a, b) => a.t - b.t);

  const keyTimes = ascending(events.map((e) => e.t)).map((t) => t.toFixed(4));
  return {
    keyTimes,
    y2: events.map((e) => (-(laneY - e.target.y)).toFixed(1)),
    colors: events.map((e) => e.target.color),
    widths: events.map((e) => e.target.width),
    dots: events.map((e) => e.target.dot),
  };
}

// Opacity keyframes for a marker visible only while the beam tip crosses it.
export function touchOpacity(xFraction) {
  const w = 0.02;
  const centres = [xFraction * 0.5, 0.5 + (1 - xFraction) * 0.5];
  const pts = [[0, 0], [1, 0]];
  for (const c of centres) {
    pts.push([c - w, 0], [c - w * 0.3, 1], [c + w * 0.3, 1], [c + w, 0]);
  }
  for (const pt of pts) pt[0] = Math.min(1, Math.max(0, pt[0]));
  pts.sort((a, b) => a[0] - b[0]);

  // Coincident samples are MERGED, not nudged. A column at either end of the
  // lane has a pulse that clamps against 0 or 1, and nudging cannot separate
  // two keyframes that both sit on the ceiling — it would emit a duplicate
  // keyTime and silently kill the animation. Keep the brighter sample so a
  // clipped pulse still flashes.
  const keyTimes = [];
  const values = [];
  for (const [t, v] of pts) {
    if (keyTimes.length && Number(keyTimes[keyTimes.length - 1]) === t) {
      if (v > values[values.length - 1]) values[values.length - 1] = v;
      continue;
    }
    keyTimes.push(t.toFixed(4));
    values.push(v);
  }

  // The two fixed cycle endpoints (t=0 and t=1) must always be closed, even
  // when a column at the very edge of the lane collides its own pulse
  // samples with them. For a *playing* animation, a lit instant at t=0 is
  // physically correct -- the glider genuinely is at the lane's edge then
  // -- but an <img>-embedded SVG's first paint lands at (or extremely close
  // to) the animation's first sample (see task-8-report.md), so that
  // correct instant is exactly what a typical page load shows, turning it
  // into a mis-lit marker on first sight. (Verified on-screen: an <img>-
  // embedded SVG shows a cached first-paint rasterisation on screen that
  // does not visibly advance. Glider lane captured six seconds apart showed
  // no movement. Canvas readback may force re-rasterisation, so it is not a
  // reliable probe for what viewers actually see.)
  // The interior merge-keeps-the-brighter-sample behaviour above is
  // unchanged and still deliberate; only the two anchor instants are
  // pinned shut, so the seeded [0, 0] and [1, 0] points always win there
  // regardless of what collided with them.
  values[0] = 0;
  values[values.length - 1] = 0;

  return { keyTimes, values };
}

function buildGlider(weeks, scale, geo) {
  const { gridW, laneY, step } = geo;
  const xStart = GEOM.gridX + 10;
  const xEnd = GEOM.gridX + gridW - 10;
  const s = probeSchedule(weeks, scale, geo);

  // Park the glider under the busiest day at rest, and derive the resting
  // beam's y2/stroke/width/r from that same target -- instead of schedule
  // index 0 (whichever column sits nearest the lane start) -- so at rest
  // the beam visibly connects the parked glider to the highlighted cell
  // (task-12).
  const spotlight = findSpotlight(weeks, scale);
  const spotlightTarget = spotlight ? peakTarget(spotlight, step) : null;
  const restX = spotlightTarget ? spotlightTarget.cx : xStart;
  const restY2 = spotlightTarget ? (-(laneY - spotlightTarget.y)).toFixed(1) : s.y2[0];
  const restColor = spotlightTarget ? spotlightTarget.color : s.colors[0];
  const restWidth = spotlightTarget ? spotlightTarget.width : s.widths[0];
  const restDot = spotlightTarget ? spotlightTarget.dot : s.dots[0];

  // Fix-review round 2: setting the base attributes above is NOT enough.
  // An <img>-embedded SVG freezes every animated attribute at its
  // animation's first SAMPLE, ignoring the element's base value entirely
  // (see touchOpacity's comment / task-8-report.md) -- and that rule is
  // not specific to opacity. The glider's <animateTransform> and the
  // beam's six <animate>s (y2/stroke/stroke-width, cy/fill/r) all still
  // had their ORIGINAL schedules, whose first sample is the lane start /
  // whichever column sits nearest it, not the spotlight target the base
  // attributes above now point at. A real <img> render therefore kept
  // showing the glider at the lane start with the old beam, while the
  // outline and count (opacity-only, and already correctly two-layered)
  // pointed at the busiest column -- outline, beam and glider disagreeing
  // about which column they meant.
  //
  // The fix, mirrored from the opacity two-layer pattern but expressed as
  // a single spliced schedule (transform/geometry attributes can't be
  // split into a separate "rest layer" element the way opacity was):
  // prepend ONE rest keyframe -- the same spotlight value already used as
  // the base -- at t=0, and re-time the schedule's existing first sample
  // to a hair after it. Every original sample is kept, in order, just
  // shifted one slot later; nothing is replaced or dropped, so the sweep
  // still runs exactly as before once anything actually animates.
  //
  // The epsilon is normally 0.0008 (matching REST_KEYTIMES elsewhere), but
  // clamped below half of the schedule's own second keyTime so it can
  // never collide with -- or reorder past -- the first real sample even
  // for an implausibly dense column count; real GitHub calendars are
  // always ~53 columns; keyTimes[1] there is ~0.0066, comfortably clear.
  const nextT = s.keyTimes.length > 1 ? Number(s.keyTimes[1]) : 1;
  const restEpsilon = Math.min(0.0008, nextT / 2).toFixed(4);
  const kt = ["0", restEpsilon, ...s.keyTimes.slice(1)].join(";");
  const y2Values = [restY2, ...s.y2].join(";");
  const colorValues = [restColor, ...s.colors].join(";");
  const widthValues = [restWidth, ...s.widths].join(";");
  const dotValues = [restDot, ...s.dots].join(";");
  const gliderKt = `0;${restEpsilon};0.5;1`;
  const gliderValues = `${restX},${laneY}; ${xStart},${laneY}; ${xEnd},${laneY}; ${xStart},${laneY}`;

  // One count label per column that gets a peak marker (level >= 3, the
  // same gate buildPeakMarkers uses). Two layers per the task-12 pattern:
  // an animated layer (base opacity 0, driven by the identical touchOpacity
  // schedule its marker already uses, so the count appears exactly when its
  // cell is outlined) and, for the spotlight column only, an extra rest
  // layer (base opacity 1, values "1;0;0") so the count is visible on an
  // <img>-embedded SVG that never actually animates on screen. Both sit at
  // local (0,0) inside the scaled glider group, in the cockpit dot's old
  // spot -- dark-on-cyan (THEME.bg on THEME.cyan) stays legible; a light
  // fill would not.
  let countLabels = "";
  for (const peak of columnPeaks(weeks, scale)) {
    if (peak.level < 3) continue;
    const cx = GEOM.gridX + peak.weekIndex * step + GEOM.cell / 2;
    const o = touchOpacity(laneFraction(cx, gridW));
    if (spotlight && peak.weekIndex === spotlight.weekIndex) {
      countLabels += `<text class="glider-count-rest" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill="${THEME.bg}" opacity="1">${peak.count}<animate attributeName="opacity" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${REST_KEYTIMES}" values="${REST_VALUES}" begin="0s" fill="freeze"/></text>`;
    }
    countLabels += `<text class="glider-count" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill="${THEME.bg}" opacity="0">${peak.count}<animate attributeName="opacity" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${o.keyTimes.join(";")}" values="${o.values.join(";")}"/></text>`;
  }

  return `
  <line x1="${GEOM.gridX}" y1="${laneY}" x2="${GEOM.gridX + gridW}" y2="${laneY}" stroke="${THEME.line}" stroke-width="1" stroke-dasharray="2 4" opacity="0.5"/>
  <g class="glider" transform="translate(${restX},${laneY})" filter="url(#hGlow)">
    <animateTransform attributeName="transform" type="translate" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${gliderKt}" values="${gliderValues}"/>
    <line x1="0" y1="0" x2="0" y2="${restY2}" stroke="${restColor}" stroke-width="${restWidth}" stroke-linecap="round" opacity="0.85">
      <animate attributeName="y2" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${y2Values}"/>
      <animate attributeName="stroke" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${colorValues}"/>
      <animate attributeName="stroke-width" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${widthValues}"/>
    </line>
    <circle cx="0" cy="${restY2}" r="${restDot}" fill="${restColor}">
      <animate attributeName="cy" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${y2Values}"/>
      <animate attributeName="fill" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${colorValues}"/>
      <animate attributeName="r" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${dotValues}"/>
    </circle>
    <g transform="scale(1.4)">
      <ellipse cx="0" cy="0" rx="14" ry="6" fill="url(#gliderGlow)"/>
      <circle cx="-7.5" cy="0" r="2" fill="${THEME.green}" opacity="0.35"><animate attributeName="opacity" values="0.35;1;0.35" dur="0.9s" repeatCount="indefinite"/></circle>
      <circle cx="7.5" cy="0" r="2" fill="${THEME.green}"><animate attributeName="opacity" values="1;0.35;1" dur="0.9s" repeatCount="indefinite"/></circle>
      <path d="M-15,0 L-7,-6 L7,-6 L15,0 L7,6 L-7,6 Z" fill="${THEME.cyan}" stroke="${THEME.green}" stroke-width="1"/>
      ${countLabels}
    </g>
  </g>`;
}

function buildPeakMarkers(weeks, scale, geo) {
  const { step, gridW } = geo;
  const spotlight = findSpotlight(weeks, scale);
  let out = "";
  for (const peak of columnPeaks(weeks, scale)) {
    if (peak.level < 3) continue;
    const cx = GEOM.gridX + peak.weekIndex * step + GEOM.cell / 2;
    const o = touchOpacity(laneFraction(cx, gridW));
    const x = (GEOM.gridX + peak.weekIndex * step - 1.5).toFixed(1);
    const y = (GEOM.gridY + peak.weekday * step - 1.5).toFixed(1);
    // Base opacity is o.values[0], not a hardcoded "0" -- but no longer
    // because the first sample is ever 1. touchOpacity used to let a column
    // at either end of the lane collide a pulse sample onto the cycle
    // anchor and keep the brighter one, so its true first sample could be 1;
    // that was itself a defect (a marker lit on first paint, which is the
    // only frame an <img>-embedded SVG ever shows) and it is fixed at the
    // source: touchOpacity now pins values[0] and values[at] closed
    // unconditionally, so every column's first sample is 0. Measured today:
    // touchOpacity(0) -> [0,1,0,0,1,0], touchOpacity(1) -> [0,0,1,1,0,0].
    // The earlier claim in this comment -- "verified: touchOpacity(0) ->
    // values [1,1,0,0,1,1]" -- is no longer true of the code and has been
    // removed rather than left as false evidence for a correct decision.
    //
    // Deriving is kept anyway, and the reason is construction rather than
    // any current edge case: an <img>-embedded SVG freezes at the
    // animation's first sample and ignores the base, so the two MUST agree,
    // and reading the base out of the very array that drives the animation
    // makes them agree by construction -- including if touchOpacity's pulse
    // shape is ever revised again. A hardcoded "0" would be correct today
    // and silently wrong the next time that math changes.
    out +=
      `<rect class="peak-marker" x="${x}" y="${y}" width="${GEOM.cell + 3}" height="${GEOM.cell + 3}" rx="3.5" fill="none" stroke="${THEME.amber}" stroke-width="1.4" opacity="${o.values[0]}">` +
      `<animate attributeName="opacity" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${o.keyTimes.join(";")}" values="${o.values.join(";")}"/></rect>`;
    if (spotlight && peak.weekIndex === spotlight.weekIndex) {
      // Rest-layer outline over the single busiest cell, in addition to the
      // pulsing peak-marker above (task-12): lit at rest (base opacity 1),
      // vanishing the instant anything animates (values "1;0;0"). Same
      // geometry and stroke as a normal peak marker so it reads identically
      // -- it exists only so the outline is visible on an <img>-embedded
      // SVG, which never actually animates on screen.
      out +=
        `<rect class="spotlight-marker" x="${x}" y="${y}" width="${GEOM.cell + 3}" height="${GEOM.cell + 3}" rx="3.5" fill="none" stroke="${THEME.amber}" stroke-width="1.4" opacity="1">` +
        `<animate attributeName="opacity" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${REST_KEYTIMES}" values="${REST_VALUES}" begin="0s" fill="freeze"/></rect>`;
    }
  }
  return out;
}

export function buildHeatmapSvg({ calendar, today }) {
  const t = THEME;
  const weeks = calendar.weeks;
  const days = flattenDays(weeks);
  const scale = intensityScale(days);
  const { current, longest } = computeStreaks(days, today);
  const geo = geometry(weeks.length);
  const { step, width, height } = geo;

  let cells = "";
  let months = "";
  let lastMonth = -1;

  weeks.forEach((week, wi) => {
    const x = GEOM.gridX + wi * step;
    const first = week.contributionDays.find((d) => d.date);
    if (first) {
      const firstDate = new Date(`${first.date}T00:00:00Z`);
      const m = firstDate.getUTCMonth();
      // Week 0 can be a stub: the 53-week window frequently opens mid-month
      // (the real calendar opens on Aug 30/31), leaving week 0's first day
      // and week 1's first day in different months just one grid column
      // apart, so both would emit a label and their glyphs would collide.
      // Suppress week 0's label unless it is a genuine month start (its
      // first day falls within the first seven days of the month). Every
      // later week keeps the existing month !== lastMonth behaviour
      // untouched, so the real boundary (week 1, here) still gets labelled.
      const isMidMonthOpeningStub = wi === 0 && firstDate.getUTCDate() > 7;
      if (m !== lastMonth && !isMidMonthOpeningStub) {
        months += `<text x="${x}" y="${GEOM.gridY - 12}" class="heat-month">${MONTHS[m]}</text>`;
        lastMonth = m;
      }
    }
    for (const d of week.contributionDays) {
      const y = GEOM.gridY + d.weekday * step;
      const level = levelFor(d.contributionCount, scale);
      // No reveal animation, and no gated visibility. Chrome, when this SVG
      // is embedded via <img> (exactly how GitHub renders README images),
      // does not execute SMIL and does not fall back to the base attribute
      // either: it freezes the animated attribute at the animation's first
      // sample. The former animation's base opacity was 1 (fully drawn),
      // but its first sample was 0, so the entire 365-cell grid rendered
      // invisible in every README (see task-8-report.md). The cells are
      // drawn plainly instead of relying on any animation whose first
      // sample and base value must be kept in sync by hand.
      cells += `<rect class="heat-cell" x="${x}" y="${y}" width="${GEOM.cell}" height="${GEOM.cell}" rx="2.5" fill="${t.heat[level]}" opacity="1"/>`;
    }
  });

  const dayLabels = [
    [1, "Mon"],
    [3, "Wed"],
    [5, "Fri"],
  ]
    .map(
      ([d, label]) =>
        `<text x="${GEOM.gridX - 10}" y="${GEOM.gridY + d * step + 9}" text-anchor="end" class="heat-daylabel">${label}</text>`
    )
    .join("");

  const legendX = width - 30 - t.heat.length * 14 - 46;
  const swatches = t.heat
    .map(
      (c, i) =>
        `<rect class="heat-legend-swatch" x="${legendX + 34 + i * 14}" y="${height - 22}" width="10" height="10" rx="2" fill="${c}"/>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
<defs>
  <radialGradient id="hBg" cx="18%" cy="12%" r="90%">
    <stop offset="0%" stop-color="${t.bg2}"/>
    <stop offset="100%" stop-color="${t.bg}"/>
  </radialGradient>
  <linearGradient id="hBorder" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${t.green}"><animate attributeName="stop-color" values="${t.green};${t.cyan};${t.green}" dur="9s" repeatCount="indefinite"/></stop>
    <stop offset="100%" stop-color="${t.cyan}"><animate attributeName="stop-color" values="${t.cyan};${t.green};${t.cyan}" dur="9s" repeatCount="indefinite"/></stop>
  </linearGradient>
  <filter id="hGlow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <radialGradient id="gliderGlow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${t.cyan}" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="${t.cyan}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="hClip"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14"/></clipPath>
  <style>
    .heat-term { fill: ${t.dim}; font-size: 13px; }
    .heat-stats { fill: ${t.fg}; font-size: 12.5px; }
    .heat-accent { fill: ${t.green}; font-weight: 700; }
    .heat-month { fill: ${t.dim}; font-size: 10px; }
    .heat-daylabel { fill: ${t.dim}; font-size: 9.5px; }
    .heat-legend { fill: ${t.dim}; font-size: 10px; }
  </style>
</defs>
<g clip-path="url(#hClip)">
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#hBg)"/>
  <rect x="0" y="0" width="${width}" height="46" fill="${t.bg2}"/>
  <line x1="0" y1="46" x2="${width}" y2="46" stroke="${t.line}" stroke-width="1"/>
  <text x="24" y="28" class="heat-term">${PROFILE.login}@github ~ % ./contributions.sh --year</text>
  <text x="${width - 24}" y="28" text-anchor="end" class="heat-stats"><tspan class="heat-accent">${formatInt(calendar.totalContributions)}</tspan> contributions · streak <tspan class="heat-accent">${current}d</tspan> · best <tspan class="heat-accent">${longest}d</tspan></text>
  ${months}
  ${dayLabels}
  ${cells}
  ${buildPeakMarkers(weeks, scale, geo)}
  ${buildGlider(weeks, scale, geo)}
  <text x="${legendX}" y="${height - 14}" class="heat-legend">Less</text>
  ${swatches}
  <text x="${legendX + 34 + t.heat.length * 14 + 8}" y="${height - 14}" class="heat-legend">More</text>
</g>
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="none" stroke="url(#hBorder)" stroke-width="2" filter="url(#hGlow)"/>
</svg>`;
}
