import { expect, it } from "vitest";
import { publicUrl } from "@radar/core/research";
import { nextRunAt } from "@radar/core/schedule";

it("keeps the local scheduled hour across DST and moves a skipped hour forward", () => {
  expect(
    new Date(
      nextRunAt("Daily", "09:00", "Europe/Berlin", Date.parse("2026-03-28T08:00:00Z")),
    ).toISOString(),
  ).toBe("2026-03-29T07:00:00.000Z");
  expect(
    new Date(
      nextRunAt("Daily", "02:30", "Europe/Berlin", Date.parse("2026-03-28T01:30:00Z")),
    ).toISOString(),
  ).toBe("2026-03-29T01:30:00.000Z");
  expect(
    new Date(
      nextRunAt("Every 3 days", "09:00", "Europe/Istanbul", Date.parse("2026-09-16T06:00:00Z")),
    ).toISOString(),
  ).toBe("2026-09-19T06:00:00.000Z");
  expect(nextRunAt("Hourly", "09:00", "UTC", 0)).toBe(3_600_000);
});
it("rejects private and non-web URLs and removes tracking without skipping adjacent keys", () => {
  for (const url of [
    "http://127.1",
    "http://2130706433",
    "http://[::1]",
    "https://localhost",
    "https://foo.local",
    "https://user:pass@example.com",
    "file:///etc/passwd",
    "http://169.254.169.254",
    "https://example.com:8080",
  ])
    expect(publicUrl(url)).toBeNull();

  expect(publicUrl("https://hono.dev/docs?utm_source=a&utm_campaign=b&version=2#top")).toBe(
    "https://hono.dev/docs?version=2",
  );
});

it("keeps relevant job pages ahead of unrelated domains when diversifying sources", async () => {
  const { selectSources } = await import("../../../packages/agent/src/retrieval");
  const jobs = [1, 2, 3, 4, 5].map((position) => ({
    url: `https://tr.linkedin.com/jobs/view/${position}`,
    title: "Chief Technology Officer CTO jobs Turkey",
    snippet: "Currently open CTO job in Turkey",
    position,
    query: "CTO jobs Turkey",
  }));
  const unrelated = ["dnr.wisconsin.gov", "ato.gov.au", "fja.gc.ca", "fw.ky.gov"].map((host) => ({
    url: `https://${host}/`,
    title: "Home",
    snippet: "Government services and information",
    position: 1,
    query: "other",
  }));

  expect(
    selectSources(
      [...jobs, ...unrelated],
      "Find currently open Chief Technology Officer CTO jobs in Turkey",
      [],
    ).map((source) => source.url),
  ).toEqual(jobs.map((source) => source.url));
});
