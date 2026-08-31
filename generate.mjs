import { writeFile } from "node:fs/promises";
import { buildAscii } from "./src/ascii.mjs";
import { fetchCalendar } from "./src/github.mjs";
import { buildCardSvg } from "./src/card.mjs";
import { buildHeatmapSvg } from "./src/heatmap.mjs";

// The only place a clock is read. Pure modules take these as parameters so
// they stay deterministic and testable.
function stamps() {
  const now = new Date();
  return {
    today: now.toISOString().slice(0, 10),
    syncedAt: `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
  };
}

async function main() {
  const { today, syncedAt } = stamps();

  const [asciiRows, calendar] = await Promise.all([
    buildAscii("avatar.png"),
    fetchCalendar(),
  ]);

  // Build both SVG strings before writing either file. If buildHeatmapSvg
  // (or buildCardSvg) throws, neither file is touched and the previously
  // committed pair stays internally consistent -- never leave the repo in a
  // state that misrepresents reality (constraint C3).
  const cardSvg = buildCardSvg({
    asciiRows,
    totalContributions: calendar.totalContributions,
    syncedAt,
  });
  const heatSvg = buildHeatmapSvg({ calendar, today });

  await writeFile("card.svg", cardSvg, "utf8");
  console.log(`wrote card.svg (${calendar.totalContributions} contributions)`);

  await writeFile("heatmap.svg", heatSvg, "utf8");
  console.log(`wrote heatmap.svg (${calendar.weeks.length} weeks)`);
}

// Fail loudly. Never fall back to invented data (spec §7, constraint C3).
main().catch((err) => {
  console.error(`generate failed: ${err.message}`);
  process.exit(1);
});
