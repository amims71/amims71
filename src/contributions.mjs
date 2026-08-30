// Cell intensity by ratio to a reference scale (spec §6). `scale` is
// typically intensityScale(days) below, not the raw window maximum -- see
// that function's comment for why.
export function levelFor(count, scale) {
  if (count <= 0) return 0;
  const ratio = count / Math.max(1, scale);
  if (ratio >= 0.65) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.15) return 2;
  return 1;
}

export function flattenDays(weeks) {
  return weeks.flatMap((w) => w.contributionDays);
}

// The window's true maximum makes a poor colour scale: one outlier day (e.g.
// a big import or a squashed-merge burst) sets the ceiling and crushes every
// ordinary active day into the dimmest non-empty shade. Measured against the
// real calendar, a single 209-contribution day pushed 61.9% of active days
// into level 1. Using the 90th percentile of non-zero days instead (nearest-
// rank method) spreads the four shades far more evenly while still reserving
// the brightest shade for genuinely exceptional days -- anything at or above
// the 90th percentile still saturates to level 4 via levelFor's >=0.65 ratio
// cutoff, it just isn't the sole day setting the scale.
export function intensityScale(days) {
  const counts = days
    .map((d) => d.contributionCount)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return 1;
  const idx = Math.min(counts.length - 1, Math.ceil(counts.length * 0.9) - 1);
  return Math.max(1, counts[idx]);
}

// `today` is injected rather than read from the clock so the function stays
// pure and testable. The GraphQL calendar pads the final week with future
// dates, which must not break or extend a streak.
export function computeStreaks(days, today) {
  let longest = 0;
  let running = 0;
  for (const d of days) {
    if (d.date > today) continue;
    if (d.contributionCount > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].date > today) continue;
    if (days[i].contributionCount > 0) current += 1;
    else break;
  }

  return { current, longest };
}
