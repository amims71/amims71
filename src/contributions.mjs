// Cell intensity by ratio to the window peak (spec §6).
export function levelFor(count, max) {
  if (count <= 0) return 0;
  const ratio = count / Math.max(1, max);
  if (ratio >= 0.65) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.15) return 2;
  return 1;
}

export function flattenDays(weeks) {
  return weeks.flatMap((w) => w.contributionDays);
}

export function maxCount(days) {
  return Math.max(1, ...days.map((d) => d.contributionCount));
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
