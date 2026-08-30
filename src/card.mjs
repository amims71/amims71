import { THEME } from "./theme.mjs";
import { escapeXml, formatInt, kv } from "./util.mjs";
import { PROFILE, ROLES } from "./content.mjs";

export { PROFILE, ROLES };

const WIDTH = 1180;
const PANEL_X = 40;
const PANEL_Y = 92;
const LEFT_W = 470;
const RIGHT_X = PANEL_X + LEFT_W + 40;
const RIGHT_W = WIDTH - RIGHT_X - 40;
const LINE_H = 25;
const TITLE_GAP = 26;
const SECTION_GAP = 34;

export function buildSections(totalContributions) {
  return [
    {
      title: "SYSTEM.INFO",
      rows: [
        kv("Name", PROFILE.name),
        kv("Role", PROFILE.role),
        kv("Company", PROFILE.company),
        kv("Location", PROFILE.location),
        kv("Experience", PROFILE.experience),
        kv("Focus", PROFILE.focus),
        kv("Status", PROFILE.status),
      ],
    },
    {
      title: "EXPERIENCE",
      rows: ROLES.map(([period, employer]) => kv(period, employer)),
    },
    {
      title: "CONTACT",
      rows: [
        kv("Portfolio", PROFILE.portfolio),
        kv("LinkedIn", PROFILE.linkedin),
        kv("GitHub", `${PROFILE.login} · ${formatInt(totalContributions)} contributions`),
      ],
    },
  ];
}

function revealClip(id, x, y, w, h, delay) {
  // Base width is the FINAL width, and the animation starts at 0s (holding at
  // zero, then wiping) rather than being delayed via `begin`. A renderer that
  // doesn't execute SMIL falls back to the base attribute values, so a
  // static/non-animating render must show every row fully revealed, not
  // clipped to nothing (see task-5-report.md, Finding 1).
  const dur = delay + 0.4;
  const holdFrac = (delay / dur).toFixed(4);
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"><animate attributeName="width" values="0;0;${w}" keyTimes="0;${holdFrac};1" dur="${dur.toFixed(2)}s" begin="0s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0.3 0 0.2 1"/></rect></clipPath>`;
}

function layoutRight(sections) {
  let clips = "";
  let body = "";
  let y = PANEL_Y + 28;
  let delay = 0.9;
  let i = 0;

  sections.forEach((section, si) => {
    if (si > 0) {
      body += `<line x1="${RIGHT_X}" y1="${y - TITLE_GAP + 12}" x2="${RIGHT_X + RIGHT_W}" y2="${y - TITLE_GAP + 12}" class="divider"/>`;
    }
    body += `<text x="${RIGHT_X}" y="${y}" class="panel-title">${section.title}</text>`;
    y += TITLE_GAP;

    for (const row of section.rows) {
      const id = `rv${i}`;
      clips += revealClip(id, RIGHT_X, y - 14, RIGHT_W, 20, delay);
      body +=
        `<g clip-path="url(#${id})">` +
        `<text x="${RIGHT_X}" y="${y}"><tspan class="kv-label">${row.label}</tspan><tspan class="kv-dots">${row.dots}</tspan></text>` +
        `<text x="${RIGHT_X + RIGHT_W}" y="${y}" text-anchor="end" class="kv-value">${row.value}</text>` +
        `</g>`;
      y += LINE_H;
      delay += 0.08;
      i += 1;
    }
    if (si < sections.length - 1) y += SECTION_GAP - LINE_H;
  });

  return { clips, body, contentHeight: y - PANEL_Y };
}

export function buildCardSvg({ asciiRows, totalContributions, syncedAt }) {
  const t = THEME;
  const sections = buildSections(totalContributions);
  const { clips, body, contentHeight } = layoutRight(sections);

  const panelH = contentHeight + 24;
  const HEIGHT = PANEL_Y + panelH + 62;

  const asciiLineH = (panelH - 44) / asciiRows.length;
  const ascii = asciiRows
    .map(
      (row, i) =>
        `<text x="${PANEL_X + 14}" y="${(PANEL_Y + 26 + i * asciiLineH).toFixed(1)}" textLength="${LEFT_W - 28}" lengthAdjust="spacingAndGlyphs" class="ascii-row">${escapeXml(row)}</text>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
<defs>
  <radialGradient id="bgGlow" cx="24%" cy="14%" r="85%">
    <stop offset="0%" stop-color="${t.bg2}"/>
    <stop offset="100%" stop-color="${t.bg}"/>
  </radialGradient>
  <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${t.green}"><animate attributeName="stop-color" values="${t.green};${t.cyan};${t.green}" dur="9s" repeatCount="indefinite"/></stop>
    <stop offset="100%" stop-color="${t.cyan}"><animate attributeName="stop-color" values="${t.cyan};${t.green};${t.cyan}" dur="9s" repeatCount="indefinite"/></stop>
  </linearGradient>
  <linearGradient id="asciiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${t.cyan}"/>
    <stop offset="100%" stop-color="${t.green}"/>
  </linearGradient>
  <pattern id="scanlines" width="3" height="3" patternUnits="userSpaceOnUse">
    <rect width="3" height="1" fill="${t.cyan}" opacity="0.045"/>
  </pattern>
  <linearGradient id="scanBeam" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="${t.cyan}" stop-opacity="0"/>
    <stop offset="50%" stop-color="${t.cyan}" stop-opacity="0.22"/>
    <stop offset="100%" stop-color="${t.cyan}" stop-opacity="0"/>
  </linearGradient>
  <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="frameClip"><rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="14"/></clipPath>
  ${clips}
  <style>
    .term-label { fill: ${t.dim}; font-size: 13px; }
    .panel-title { fill: ${t.cyan}; font-size: 12px; font-weight: 700; letter-spacing: 2px; }
    .kv-label { fill: ${t.cyan}; font-size: 13px; font-weight: 600; }
    .kv-dots { fill: ${t.line}; font-size: 13px; }
    .kv-value { fill: ${t.fg}; font-size: 13px; }
    .ascii-row { fill: url(#asciiGrad); font-size: 8.6px; white-space: pre; }
    .divider { stroke: ${t.line}; stroke-width: 1; }
    .foot { fill: ${t.dim}; font-size: 11.5px; }
  </style>
</defs>
<g clip-path="url(#frameClip)">
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#bgGlow)"/>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#scanlines)"/>
  <rect x="0" y="0" width="${WIDTH}" height="46" fill="${t.bg2}"/>
  <line x1="0" y1="46" x2="${WIDTH}" y2="46" stroke="${t.line}" stroke-width="1"/>
  <circle cx="26" cy="23" r="6.5" fill="#ff5f56"/>
  <circle cx="47" cy="23" r="6.5" fill="#ffbd2e"/>
  <circle cx="68" cy="23" r="6.5" fill="#27c93f"/>
  <text x="${WIDTH / 2}" y="28" text-anchor="middle" class="term-label">${PROFILE.login}@github ~ % ./profile.sh --live</text>
  <circle cx="${WIDTH - 96}" cy="23" r="4" fill="${t.green}"><animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite"/></circle>
  <text x="${WIDTH - 86}" y="28" class="term-label">LIVE</text>
  <rect x="${PANEL_X}" y="${PANEL_Y}" width="${LEFT_W}" height="${panelH}" rx="10" fill="${t.bg2}" stroke="${t.line}" stroke-width="1"/>
  <text x="${PANEL_X + 14}" y="${PANEL_Y + 14}" class="panel-title">VISUAL.MAP</text>
  <g transform="translate(0,10)">${ascii}</g>
  <rect x="${RIGHT_X - 20}" y="${PANEL_Y}" width="${RIGHT_W + 40}" height="${panelH}" rx="10" fill="${t.bg2}" stroke="${t.line}" stroke-width="1"/>
  ${body}
  <line x1="${PANEL_X}" y1="${HEIGHT - 36}" x2="${WIDTH - PANEL_X}" y2="${HEIGHT - 36}" stroke="${t.line}" stroke-width="1"/>
  <text x="${PANEL_X}" y="${HEIGHT - 15}" class="foot">Live GitHub stats below ↓</text>
  <text x="${WIDTH - PANEL_X}" y="${HEIGHT - 15}" text-anchor="end" class="foot">synced ${escapeXml(syncedAt)}</text>
  <g>
    <animateTransform attributeName="transform" type="translate" values="0,-30; 0,${HEIGHT + 30}" dur="7s" repeatCount="indefinite"/>
    <rect x="0" y="-18" width="${WIDTH}" height="36" fill="url(#scanBeam)"/>
    <line x1="0" y1="0" x2="${WIDTH}" y2="0" stroke="${t.cyan}" stroke-width="1.5" opacity="0.95"/>
    <circle cx="10" cy="0" r="2.5" fill="${t.cyan}" filter="url(#softGlow)"/>
    <circle cx="${WIDTH - 10}" cy="0" r="2.5" fill="${t.cyan}" filter="url(#softGlow)"/>
  </g>
</g>
<rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="14" fill="none" stroke="url(#borderGrad)" stroke-width="2" filter="url(#softGlow)"/>
</svg>`;
}
