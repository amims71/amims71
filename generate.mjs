import { writeFile } from "node:fs/promises";
import { buildAscii } from "./src/ascii.mjs";
import { fetchCalendar } from "./src/github.mjs";
import { buildCardSvg } from "./src/card.mjs";
import { buildHeatmapSvg } from "./src/heatmap.mjs";
import { assertNoContributionCollapse } from "./src/integrity.mjs";

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

  // Fail loudly rather than publish something misleading. A token that cannot
  // resolve the private-inclusive calendar does not error -- it returns a
  // smaller number that is entirely real, and 94% of this account's total is
  // private, so the result would be a LIVE-badged card advertising about a
  // sixteenth of the truth with a fresh timestamp. Compared against the total
  // already in the committed card.svg and run BEFORE anything is written, so a
  // collapse leaves the previously committed pair exactly as it was. See
  // src/integrity.mjs for the threshold and why it is 50%.
  const floor = await assertNoContributionCollapse(calendar.totalContributions);
  console.log(
    floor.checked
      ? `contribution floor ok: ${calendar.totalContributions} fetched vs ${floor.committedTotal} committed`
      : `contribution floor skipped: ${floor.reason}`
  );

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
  // Log the error object, not just its message: this line is the only
  // diagnostic an unattended daily run leaves behind, and a message alone
  // discards the stack (and any `cause`), which is most of what makes a
  // 6am failure debuggable at all.
  console.error("generate failed:", err);
  process.exit(1);
});
