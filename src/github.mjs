export const LOGIN = "amims71";

const ENDPOINT = "https://api.github.com/graphql";

const CALENDAR_QUERY = `query($login:String!){
  user(login:$login){
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
  }
}`;

export function resolveToken(env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "No GH_TOKEN or GITHUB_TOKEN in the environment. Refusing to generate cards without real data."
    );
  }
  return token;
}

// Fails loudly on every error path. There is deliberately no fallback that
// invents a calendar: a red X in Actions is recoverable, a profile quietly
// advertising fabricated activity is not (spec §7, constraint C3).
export async function fetchCalendar({ login = LOGIN, env = process.env, fetchImpl = fetch } = {}) {
  const token = resolveToken(env);

  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": login,
    },
    body: JSON.stringify({ query: CALENDAR_QUERY, variables: { login } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL responded HTTP ${res.status}`);
  }

  const body = await res.json();
  if (body.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(body.errors)}`);
  }

  const calendar = body?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error(`No contribution calendar in the response for "${login}"`);
  }
  if (!Array.isArray(calendar.weeks) || calendar.weeks.length === 0) {
    throw new Error(`Contribution calendar for "${login}" contains no weeks`);
  }

  if (!Number.isFinite(calendar.totalContributions)) {
    throw new Error(`Malformed contribution calendar for "${login}": totalContributions is not a finite number`);
  }

  for (let i = 0; i < calendar.weeks.length; i++) {
    if (!Array.isArray(calendar.weeks[i].contributionDays)) {
      throw new Error(`Malformed contribution calendar for "${login}": week ${i} missing or malformed contributionDays`);
    }
  }

  return calendar;
}
