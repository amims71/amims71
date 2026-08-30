import { THEME } from "./theme.mjs";
import { formatInt } from "./util.mjs";
import { PROFILE } from "./content.mjs";
import { levelFor, flattenDays, maxCount, computeStreaks } from "./contributions.mjs";

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

export function columnPeaks(weeks, max) {
  return weeks.map((week, weekIndex) => {
    let best = null;
    for (const d of week.contributionDays) {
      if (!best || d.contributionCount > best.contributionCount) best = d;
    }
    return {
      weekIndex,
      weekday: best ? best.weekday : 0,
      count: best ? best.contributionCount : 0,
      level: best ? levelFor(best.contributionCount, max) : 0,
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

export function probeSchedule(weeks, max, { step, laneY, gridW }) {
  const topY = GEOM.gridY + GEOM.cell / 2;
  const targets = columnPeaks(weeks, max).map((peak) => {
    const hit = peak.level >= 3;
    return {
      cx: GEOM.gridX + peak.weekIndex * step + GEOM.cell / 2,
      y: hit ? GEOM.gridY + peak.weekday * step + GEOM.cell / 2 : topY,
      color: hit ? THEME.heat[peak.level] : THEME.cyan,
      width: peak.level === 4 ? "2.6" : peak.level === 3 ? "2" : "1.1",
      dot: peak.level === 4 ? "3.4" : peak.level === 3 ? "2.6" : "1.6",
    };
  });

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
  return { keyTimes, values };
}

function buildGlider(weeks, max, geo) {
  const { gridW, laneY } = geo;
  const xStart = GEOM.gridX + 10;
  const xEnd = GEOM.gridX + gridW - 10;
  const s = probeSchedule(weeks, max, geo);
  const kt = s.keyTimes.join(";");

  return `
  <line x1="${GEOM.gridX}" y1="${laneY}" x2="${GEOM.gridX + gridW}" y2="${laneY}" stroke="${THEME.line}" stroke-width="1" stroke-dasharray="2 4" opacity="0.5"/>
  <g class="glider" transform="translate(${xStart},${laneY})" filter="url(#hGlow)">
    <animateTransform attributeName="transform" type="translate" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="0;0.5;1" values="${xStart},${laneY}; ${xEnd},${laneY}; ${xStart},${laneY}"/>
    <line x1="0" y1="0" x2="0" y2="${s.y2[0]}" stroke="${s.colors[0]}" stroke-width="${s.widths[0]}" stroke-linecap="round" opacity="0.85">
      <animate attributeName="y2" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${s.y2.join(";")}"/>
      <animate attributeName="stroke" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${s.colors.join(";")}"/>
      <animate attributeName="stroke-width" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${s.widths.join(";")}"/>
    </line>
    <circle cx="0" cy="${s.y2[0]}" r="${s.dots[0]}" fill="${s.colors[0]}">
      <animate attributeName="cy" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${s.y2.join(";")}"/>
      <animate attributeName="fill" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${s.colors.join(";")}"/>
      <animate attributeName="r" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${s.dots.join(";")}"/>
    </circle>
    <g transform="scale(1.4)">
      <ellipse cx="0" cy="0" rx="14" ry="6" fill="url(#gliderGlow)"/>
      <circle cx="-7.5" cy="0" r="2" fill="${THEME.green}"><animate attributeName="opacity" values="0.35;1;0.35" dur="0.9s" repeatCount="indefinite"/></circle>
      <circle cx="7.5" cy="0" r="2" fill="${THEME.green}"><animate attributeName="opacity" values="1;0.35;1" dur="0.9s" repeatCount="indefinite"/></circle>
      <path d="M-9,0 L-3,-5 L3,-5 L9,0 L3,5 L-3,5 Z" fill="${THEME.cyan}" stroke="${THEME.green}" stroke-width="1"/>
      <circle cx="0" cy="0" r="2.2" fill="#ffffff"/>
    </g>
  </g>`;
}

function buildPeakMarkers(weeks, max, geo) {
  const { step, gridW } = geo;
  let out = "";
  for (const peak of columnPeaks(weeks, max)) {
    if (peak.level < 3) continue;
    const cx = GEOM.gridX + peak.weekIndex * step + GEOM.cell / 2;
    const o = touchOpacity(laneFraction(cx, gridW));
    const x = (GEOM.gridX + peak.weekIndex * step - 1.5).toFixed(1);
    const y = (GEOM.gridY + peak.weekday * step - 1.5).toFixed(1);
    out +=
      `<rect class="peak-marker" x="${x}" y="${y}" width="${GEOM.cell + 3}" height="${GEOM.cell + 3}" rx="3.5" fill="none" stroke="${THEME.amber}" stroke-width="1.4" opacity="0">` +
      `<animate attributeName="opacity" dur="${GLIDER_DUR}s" repeatCount="indefinite" keyTimes="${o.keyTimes.join(";")}" values="${o.values.join(";")}"/></rect>`;
  }
  return out;
}

export function buildHeatmapSvg({ calendar, today }) {
  const t = THEME;
  const weeks = calendar.weeks;
  const days = flattenDays(weeks);
  const max = maxCount(days);
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
      const level = levelFor(d.contributionCount, max);
      // Base attribute is the FINAL value (opacity="1"), and the reveal
      // animation runs from begin="0s" on its own timeline (values/keyTimes)
      // rather than being delayed via `begin`. A renderer that doesn't
      // execute SMIL falls back to the base attribute values, so a
      // static/non-animating render must show every cell fully drawn, not
      // invisible (see task-5-report.md, Finding 1, and revealClip in
      // src/card.mjs for the reference pattern).
      const delay = 0.15 + wi * 0.012;
      const dur = delay + 0.35;
      const holdFrac = (delay / dur).toFixed(4);
      cells +=
        `<rect class="heat-cell" x="${x}" y="${y}" width="${GEOM.cell}" height="${GEOM.cell}" rx="2.5" fill="${t.heat[level]}" opacity="1">` +
        `<animate attributeName="opacity" values="0;0;1" keyTimes="0;${holdFrac};1" dur="${dur.toFixed(3)}s" begin="0s" fill="freeze"/></rect>`;
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
  ${buildPeakMarkers(weeks, max, geo)}
  ${buildGlider(weeks, max, geo)}
  <text x="${legendX}" y="${height - 14}" class="heat-legend">Less</text>
  ${swatches}
  <text x="${legendX + 34 + t.heat.length * 14 + 8}" y="${height - 14}" class="heat-legend">More</text>
</g>
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="none" stroke="url(#hBorder)" stroke-width="2" filter="url(#hGlow)"/>
</svg>`;
}
