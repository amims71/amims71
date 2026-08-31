import { readFile } from "node:fs/promises";
import { formatInt } from "./util.mjs";

// Constraint C3 says never publish fabricated data, and the generator already
// honours it: every failure path throws instead of inventing a calendar. This
// module covers the gap C3 does not reach -- data that is real but wrong by
// omission, which is the same outcome the whole design is organised against
// ("fail loudly rather than publish something misleading").
//
// The concrete risk, measured live on 2026-08-31:
//
//   contributionCalendar.totalContributions   5,477
//   restrictedContributionsCount              5,130   (93.7% of the total)
//   public commits + PRs + issues               334
//
// The published figure is almost entirely private-repo activity, which the
// owner's "include private contributions" setting makes public on their
// profile. If the Actions default GITHUB_TOKEN cannot resolve the
// private-inclusive calendar (the spec's own open risk, §7), the GraphQL call
// does not fail -- it succeeds and returns roughly 334. Nothing in the
// generator noticed: it would rewrite both SVGs with about a sixteenth of the
// real number, under a pulsing LIVE badge and a fresh sync timestamp, and the
// daily job would go green. Not fabrication, so not a C3 violation, but
// exactly as misleading as one.

// The floor is a ratio, not an absolute number, so it needs no maintenance as
// the total grows.
//
// Why 0.5 specifically. The window is a 12-month rolling one, so consecutive
// runs differ only by the day that entered and the day that left; a normal
// day-over-day delta is single digits (5,476 -> 5,477 across this wave). For
// the total to legitimately fall below half, the owner would have to have
// stopped contributing almost entirely for about a year -- and even then it
// would arrive as a slow slide over months of daily runs, each one re-
// baselining the committed card, so no single run would see a >50% step. A
// token-visibility failure, by contrast, does not slide: it lands in one run
// as a ~16x collapse (5,477 -> ~334, 6% of the total). 0.5 therefore sits far
// outside any drift the real data can produce while still catching the failure
// this exists for by an order of magnitude. Tightening it (0.9, say) would
// start failing on legitimate quiet stretches; loosening it much further would
// let a partially-degraded token through.
export const COLLAPSE_RATIO = 0.5;

// The committed card is the published claim, so it is the right baseline to
// compare a fresh fetch against -- no separate state file to drift out of sync
// with what is actually on the profile. buildSections in src/card.mjs renders
// the CONTACT row as `<login> · 5,476 contributions`, which is what this reads
// back.
const TOTAL_IN_CARD = /·\s*([\d,]+)\s+contributions/;

export function extractCommittedTotal(cardSvg) {
  const m = TOTAL_IN_CARD.exec(String(cardSvg));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Pure decision, so the threshold is testable without touching the filesystem
// or the network. A drop of EXACTLY the ratio is allowed; only a drop past it
// fails, which is what "dropped by more than 50%" means.
export function isCollapse(fetchedTotal, committedTotal, ratio = COLLAPSE_RATIO) {
  if (!Number.isFinite(committedTotal) || committedTotal <= 0) return false;
  if (!Number.isFinite(fetchedTotal)) return false;
  return fetchedTotal < committedTotal * ratio;
}

export function collapseMessage(fetchedTotal, committedTotal, ratio = COLLAPSE_RATIO) {
  const pct = ((1 - fetchedTotal / committedTotal) * 100).toFixed(1);
  return (
    `Refusing to publish: the contribution total collapsed from ${formatInt(committedTotal)} ` +
    `(the figure in the committed card.svg) to ${formatInt(fetchedTotal)} (just fetched) -- a drop of ` +
    `${pct}%, past the ${Math.round(ratio * 100)}% floor. A 12-month rolling window cannot halve in one ` +
    `run, so this is far more likely a token that cannot see private contributions: about 94% of this ` +
    `account's total is restrictedContributionsCount, so a token resolving only public activity returns ` +
    `roughly a sixteenth of the real number. Add a fine-grained PAT with read-only user access as ` +
    `repository secret GH_TOKEN (spec §7, "Open risk"); the generator prefers it over GITHUB_TOKEN. ` +
    `If the drop is real, re-baseline deliberately by committing a card that carries the lower figure. ` +
    `Neither SVG has been written, so the previously committed pair stays intact.`
  );
}

// Reads the baseline out of the committed card and throws if the new total has
// collapsed. `read` is injectable so tests never depend on the real card.svg.
//
// A missing card.svg is the genuine first-ever run and is skipped -- there is
// nothing to compare against, and refusing to bootstrap would be a guard that
// prevents the thing it protects. A card.svg that EXISTS but yields no total
// is not skipped: that means this pattern and card.mjs's CONTACT row have
// diverged, the check is silently inoperative, and a silently inoperative
// integrity check is the failure mode this whole module exists to reject.
export async function assertNoContributionCollapse(
  fetchedTotal,
  { path = "card.svg", read = readFile, ratio = COLLAPSE_RATIO } = {}
) {
  let cardSvg;
  try {
    cardSvg = await read(path, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { checked: false, reason: `no committed ${path} yet -- first run, nothing to compare against` };
    }
    throw err;
  }

  const committedTotal = extractCommittedTotal(cardSvg);
  if (committedTotal === null) {
    throw new Error(
      `Could not read a contribution total out of the committed ${path}. The extraction pattern in ` +
        `src/integrity.mjs and the CONTACT row in src/card.mjs have diverged, which leaves the ` +
        `collapse floor silently inoperative -- fix the pattern rather than removing the check.`
    );
  }

  if (isCollapse(fetchedTotal, committedTotal, ratio)) {
    throw new Error(collapseMessage(fetchedTotal, committedTotal, ratio));
  }

  return { checked: true, committedTotal };
}
