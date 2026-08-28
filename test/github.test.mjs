import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LOGIN, resolveToken, fetchCalendar } from "../src/github.mjs";

const okCalendar = {
  totalContributions: 5522,
  weeks: [
    { contributionDays: [{ date: "2026-08-23", contributionCount: 4, weekday: 0 }] },
  ],
};

const jsonResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

test("LOGIN is the account this profile belongs to", () => {
  assert.equal(LOGIN, "amims71");
});

test("resolveToken prefers GH_TOKEN over GITHUB_TOKEN", () => {
  assert.equal(resolveToken({ GH_TOKEN: "a", GITHUB_TOKEN: "b" }), "a");
});

test("resolveToken falls back to GITHUB_TOKEN", () => {
  assert.equal(resolveToken({ GITHUB_TOKEN: "b" }), "b");
});

test("resolveToken throws when neither token is present", () => {
  assert.throws(() => resolveToken({}), /GH_TOKEN|GITHUB_TOKEN/);
});

test("fetchCalendar returns the calendar on success", async () => {
  const cal = await fetchCalendar({
    env: { GH_TOKEN: "t" },
    fetchImpl: async () => jsonResponse({ data: { user: { contributionsCollection: { contributionCalendar: okCalendar } } } }),
  });
  assert.equal(cal.totalContributions, 5522);
  assert.equal(cal.weeks.length, 1);
});

test("fetchCalendar sends the token as a bearer header", async () => {
  let seen = null;
  await fetchCalendar({
    env: { GH_TOKEN: "sekrit" },
    fetchImpl: async (_url, init) => {
      seen = init;
      return jsonResponse({ data: { user: { contributionsCollection: { contributionCalendar: okCalendar } } } });
    },
  });
  assert.equal(seen.headers.Authorization, "Bearer sekrit");
  assert.equal(seen.method, "POST");
});

test("fetchCalendar rejects when no token is available", async () => {
  await assert.rejects(
    () => fetchCalendar({ env: {}, fetchImpl: async () => jsonResponse({}) }),
    /GH_TOKEN|GITHUB_TOKEN/
  );
});

test("fetchCalendar rejects on a non-2xx response", async () => {
  await assert.rejects(
    () => fetchCalendar({ env: { GH_TOKEN: "t" }, fetchImpl: async () => jsonResponse({}, false, 401) }),
    /401/
  );
});

test("fetchCalendar rejects when GraphQL returns errors", async () => {
  await assert.rejects(
    () =>
      fetchCalendar({
        env: { GH_TOKEN: "t" },
        fetchImpl: async () => jsonResponse({ errors: [{ message: "Bad credentials" }] }),
      }),
    /Bad credentials/
  );
});

test("fetchCalendar rejects when the calendar is missing", async () => {
  await assert.rejects(
    () => fetchCalendar({ env: { GH_TOKEN: "t" }, fetchImpl: async () => jsonResponse({ data: { user: null } }) }),
    /calendar/i
  );
});

test("fetchCalendar rejects when the calendar has no weeks", async () => {
  await assert.rejects(
    () =>
      fetchCalendar({
        env: { GH_TOKEN: "t" },
        fetchImpl: async () =>
          jsonResponse({ data: { user: { contributionsCollection: { contributionCalendar: { totalContributions: 0, weeks: [] } } } } }),
      }),
    /weeks/i
  );
});

test("fetchCalendar rejects when the network call throws", async () => {
  await assert.rejects(
    () =>
      fetchCalendar({
        env: { GH_TOKEN: "t" },
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    /ECONNREFUSED/
  );
});

// Constraint C3, enforced at the source level: there must be no fallback that
// invents contribution data the way the reference implementation does.
test("github.mjs contains no data synthesis of any kind", async () => {
  const src = await readFile(new URL("../src/github.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Math\.random/);
  assert.doesNotMatch(src, /synthesi[sz]e/i);
  assert.doesNotMatch(src, /placeholder/i);
  assert.doesNotMatch(src, /1103515245/); // the LCG constant used by the reference
});
