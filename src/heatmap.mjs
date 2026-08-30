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

export function buildHeatmapSvg({ calendar, today }) {
  const t = THEME;
  const weeks = calendar.weeks;
  const days = flattenDays(weeks);
  const max = maxCount(days);
  const { current, longest } = computeStreaks(days, today);
  const { step, gridW, width, height } = geometry(weeks.length);

  let cells = "";
  let months = "";
  let lastMonth = -1;

  weeks.forEach((week, wi) => {
    const x = GEOM.gridX + wi * step;
    const first = week.contributionDays.find((d) => d.date);
    if (first) {
      const m = new Date(`${first.date}T00:00:00Z`).getUTCMonth();
      if (m !== lastMonth) {
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
  <text x="${legendX}" y="${height - 14}" class="heat-legend">Less</text>
  ${swatches}
  <text x="${legendX + 34 + t.heat.length * 14 + 8}" y="${height - 14}" class="heat-legend">More</text>
</g>
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="none" stroke="url(#hBorder)" stroke-width="2" filter="url(#hGlow)"/>
</svg>`;
}
