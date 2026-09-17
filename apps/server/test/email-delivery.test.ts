import { readdir, readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createDb } from "@radar/db";
import { createWorkspace } from "@radar/db/workspace";
import { createResearch } from "@radar/db/research";
import { deliverEmail } from "@radar/notifications";

let runtime: Miniflare;
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let db: ReturnType<typeof createDb>;
let now: number;
const send = vi.fn<(_to: string, _subject: string, _text: string, key: string) => Promise<void>>();
const deliver = () => deliverEmail(db, { available: true, send }, "https://radar.example.com");
const row = (id: string) => d1.prepare("SELECT * FROM delivery WHERE id = ?").bind(id).first();

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: "export default {fetch() {return new Response('Test')}}",
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-01",
  });
  d1 = await runtime.getD1Database("DB");
  db = createDb({ DB: d1 });

  const folder = new URL("../../../packages/db/src/migrations/", import.meta.url);

  for (const file of (await readdir(folder)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, folder), "utf8");

    await d1.batch(
      sql
        .split("--> statement-breakpoint")
        .filter((part) => part.trim())
        .map((part) => d1.prepare(part)),
    );
  }
}, 30_000);

afterAll(async () => {
  await runtime?.dispose();
});
afterEach(() => {
  vi.restoreAllMocks();
});
beforeEach(async () => {
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  send.mockReset();
  send.mockResolvedValue(undefined);
  await d1.prepare("DELETE FROM user").run();
  await d1
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at, username) VALUES ('owner', 'Owner', 'owner@example.com', 1, 0, 0, 'owner')",
    )
    .run();
});

async function enqueue(id: string) {
  const workspace = createWorkspace(db);
  const research = createResearch(db);
  const task = await workspace.create("owner", {
    title: id,
    brief: "Find stable releases from official sources",
    category: "Technology",
    status: "active",
    frequency: "Daily",
    time: "09:00",
    language: "English",
    email: true,
    messages: [],
    revision: 0,
  });
  const runId = await research.start("owner", task.id);
  const claim = await research.claim(runId);

  if (!claim) throw new Error("Expected research claim");

  await research.complete(runId, claim.lease, {
    summary: "New release",
    sources: ["https://example.com/release"],
    findings: [
      {
        title: "Release",
        summary: "A stable release",
        reason: "Official source",
        evidence: "",
        url: "https://example.com/release",
        eventKey: "release",
        version: "1",
      },
    ],
  });
  await d1.prepare("UPDATE delivery SET id = ? WHERE run_id = ?").bind(id, runId).run();
}

it("honors a backoff established after another sender selected the same due mail", async () => {
  await enqueue("a-first");
  await enqueue("b-second");

  let nested = false;

  send.mockImplementation(async (_to, _subject, _text, key) => {
    if (key.endsWith("a-first") && !nested) {
      nested = true;
      await deliver();
    } else if (key.endsWith("b-second")) throw new Error("Temporary provider error");
  });
  await deliver();
  expect(send.mock.calls.filter((call) => call[3].endsWith("b-second"))).toHaveLength(1);
  expect(await row("b-second")).toMatchObject({
    status: "pending",
    attempts: 1,
    next_attempt: now + 120_000,
  });
});

it("uses fresh claim and retry times after a slow preceding mail", async () => {
  await enqueue("a-first");
  await enqueue("b-second");

  const started = now;

  send.mockImplementation(async (_to, _subject, _text, key) => {
    if (key.endsWith("a-first")) {
      now += 180_000;

      return;
    }

    expect(await row("b-second")).toMatchObject({ next_attempt: now, first_attempt_at: now });
    await deliver(); // A fresh claim must not be recovered as already stale.
    now += 20_000;
    throw new Error("Timeout");
  });
  await deliver();
  expect(send).toHaveBeenCalledTimes(2);
  expect(await row("b-second")).toMatchObject({ attempts: 1, next_attempt: started + 320_000 });
});

it.each(["pending", "sending"])(
  "does not resend an ambiguous %s mail after the 24-hour protection window",
  async (status) => {
    await enqueue("old-mail");
    await d1
      .prepare(
        "UPDATE delivery SET status = ?, attempts = 1, first_attempt_at = ?, next_attempt = ?",
      )
      .bind(status, now - 25 * 60 * 60 * 1000, now - 25 * 60 * 60 * 1000)
      .run();
    await deliver();
    expect(send).not.toHaveBeenCalled();
    expect(await row("old-mail")).toMatchObject({ status: "uncertain", attempts: 1 });
  },
);

it("keeps a one-minute safety margin before provider keys expire", async () => {
  await enqueue("boundary");
  await d1
    .prepare("UPDATE delivery SET attempts = 1, first_attempt_at = ?, next_attempt = 0")
    .bind(now - (24 * 60 * 60 * 1000 - 60_000))
    .run();
  await deliver();
  expect(send).not.toHaveBeenCalled();
  expect(await row("boundary")).toMatchObject({ status: "uncertain" });
});

it("does not guess the age of an attempted legacy delivery", async () => {
  await enqueue("legacy");
  await d1.prepare("UPDATE delivery SET attempts = 1, first_attempt_at = NULL").run();
  await deliver();
  expect(send).not.toHaveBeenCalled();
  expect(await row("legacy")).toMatchObject({ status: "uncertain" });
});

it("recovers recent abandoned sends with the same key and original first attempt", async () => {
  await enqueue("recent");
  send.mockRejectedValueOnce(new Error("Temporary error"));
  await deliver();

  const firstAttempt = now;

  now += 180_000;
  await d1
    .prepare("UPDATE delivery SET status = 'sending', next_attempt = ?")
    .bind(firstAttempt)
    .run();
  await deliver();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]![3]).toBe(send.mock.calls[1]![3]);
  expect(await row("recent")).toMatchObject({
    status: "sent",
    first_attempt_at: firstAttempt,
    attempts: 2,
  });
});

it("does not let a stale sender overwrite a replacement claim", async () => {
  await enqueue("leased");
  send.mockImplementationOnce(async () => {
    await d1
      .prepare("UPDATE delivery SET lease = 'replacement', attempts = 2 WHERE id = 'leased'")
      .run();
  });
  await deliver();
  expect(await row("leased")).toMatchObject({
    status: "sending",
    lease: "replacement",
    attempts: 2,
    sent_at: null,
  });
});
