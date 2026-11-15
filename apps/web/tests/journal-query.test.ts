import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-query-"));
process.env.JOURNAL_DATA_DIR = scratch;
const {
  db,
  accounts,
  trades,
  journalDays,
  playbooks,
  settings,
  progressRules,
  progressChecks,
  attachments,
} = await import("../src/db");
const { GET } = await import("../src/app/api/journal/route");

async function read(query = "") {
  const response = await GET(new Request(`http://localhost/api/journal${query}`));
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  for (const table of [
    attachments,
    progressChecks,
    progressRules,
    journalDays,
    trades,
    accounts,
    playbooks,
    settings,
  ])
    db.delete(table).run();
  db.insert(settings).values({ key: "timeZone", value: "Europe/Lisbon" }).run();
  db.insert(accounts)
    .values({ id: "account", name: "Test", kind: "manual", createdAt: "2026-01-01" })
    .run();
  db.insert(playbooks)
    .values([
      { id: "s1", name: "First", createdAt: "2026-01-01" },
      { id: "s2", name: "Second", createdAt: "2026-01-01" },
    ])
    .run();
  const trade = (key: string, closedAt: string | null, netPnl: number, playbookId: string) => ({
    key,
    accountId: "account",
    symbol: key.toUpperCase(),
    assetClass: "stock",
    direction: "long" as const,
    status:
      closedAt === null ? ("open" as const) : netPnl > 0 ? ("win" as const) : ("loss" as const),
    openedAt: "2026-03-28T22:00:00.000Z",
    closedAt,
    quantity: 1,
    openQuantity: closedAt ? 0 : 1,
    avgEntry: 100,
    avgExit: closedAt ? 100 + netPnl + 2 : null,
    grossPnl: netPnl + 2,
    fees: 2,
    netPnl,
    executionCount: 2,
    executionIdsJson: "[]",
    exitsJson: "[]",
    playbookId,
  });
  db.insert(trades)
    .values([
      trade("a", "2026-03-28T23:30:00.000Z", 100, "s1"),
      trade("b", "2026-03-29T23:30:00.000Z", -40, "s1"),
      trade("c", "2026-03-29T23:45:00.000Z", 60, "s2"),
      { ...trade("open", null, 0, "s1"), openedAt: "2026-03-31T10:00:00.000Z" },
    ])
    .run();
  db.insert(journalDays)
    .values([
      { date: "2026-03-29", note: "Note only", updatedAt: "2026-04-01" },
      {
        date: "2026-03-30",
        note: "Review",
        dailyBiasPlaybooksJson: '["s1"]',
        startTime: "09:00",
        endTime: "11:00",
        updatedAt: "2026-04-01",
      },
      { date: "2026-04-01", note: "", updatedAt: "2026-04-01" },
    ])
    .run();
  db.insert(progressRules)
    .values({
      id: "r",
      title: "Plan",
      stage: "Before trading",
      weekdaysJson: "[0,1,2,3,4,5,6]",
      createdAt: "2026-03-28",
      archivedAt: "2026-04-01",
    })
    .run();
  db.insert(progressChecks)
    .values({ id: "r:2026-03-30", ruleId: "r", date: "2026-03-30", done: true })
    .run();
  db.insert(attachments)
    .values({
      id: "image",
      ownerType: "day",
      ownerId: "2026-03-29",
      name: "chart.png",
      mime: "image/png",
      size: 1,
      data: Buffer.from([0]),
      createdAt: "2026-03-29",
    })
    .run();
});

afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it("preserves local closing days across DST, note-only days and period totals", async () => {
  const result = await read();
  expect(result.days.map((day: { date: string }) => day.date)).toEqual([
    "2026-04-01",
    "2026-03-30",
    "2026-03-29",
    "2026-03-28",
  ]);
  expect(result.days[1]).toMatchObject({
    date: "2026-03-30",
    stats: { netPnl: 20, trades: 2 },
    accordingToDailyBias: 0.5,
    sessionDurationMinutes: 120,
    routine: { completed: 1, total: 1 },
  });
  expect(result.days[2]).toMatchObject({ stats: null, hasNote: true, hasScreenshots: true });
  expect(result.summary).toMatchObject({
    netPnl: 120,
    trades: 3,
    winRate: 2 / 3,
    accordingToDailyBias: 0.5,
    routineCompletion: 1 / 3,
    consecutiveWinningDays: 2,
  });
});

it("filters matching days without accidentally narrowing their trades or bias totals", async () => {
  for (const query of [
    "?symbol=b",
    "?status=loss",
    "?dailyBias=s1",
    "?from=2026-03-30&to=2026-03-30",
  ]) {
    const result = await read(query);
    expect(result.days.map((day: { date: string }) => day.date)).toEqual(["2026-03-30"]);
    expect(result.summary).toMatchObject({
      netPnl: 20,
      trades: 2,
      winRate: 0.5,
      accordingToDailyBias: 0.5,
    });
  }
  expect((await read("?playbookId=s1")).summary.trades).toBe(3);
  expect((await read("?routine=r")).days).toHaveLength(3);
});

it("applies entries before sorting and keeps null statistics last", async () => {
  const result = await read("?entries=2&sortBy=pnl&sortDir=asc");
  expect(result.days.map((day: { date: string }) => day.date)).toEqual([
    "2026-03-30",
    "2026-04-01",
  ]);
  expect(result.summary).toMatchObject({ netPnl: 20, trades: 2 });
  expect(result.pagination).toMatchObject({ total: 2, page: 1, totalPages: 1 });
  expect((await read("?symbol=missing")).summary).toMatchObject({ netPnl: 0, trades: 0 });
});

it("keeps focusDate on the right page and the existing date list independent of filters", async () => {
  const dates = Array.from({ length: 55 }, (_, i) =>
    new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
  );
  db.insert(journalDays)
    .values(dates.map((date) => ({ date, updatedAt: date })))
    .run();
  const result = await read("?focusDate=2026-01-01");
  expect(result.pagination).toMatchObject({ page: 2, total: 59, totalPages: 2 });
  expect(result.days.some((day: { date: string }) => day.date === "2026-01-01")).toBe(true);
  expect((await read("?from=2026-03-30")).existingDates).toEqual(result.existingDates);
});

it("returns only persisted journal dates in the lightweight view, including empty saved days", async () => {
  const full = await read();
  expect(await read("?view=dates")).toEqual({ existingDates: full.existingDates });
  expect(full.existingDates).toEqual(["2026-04-01", "2026-03-30", "2026-03-29"]);
});

it("returns empty dates without changing the normal empty journal response", async () => {
  db.delete(journalDays).run();
  db.delete(trades).run();
  expect(await read("?view=dates")).toEqual({ existingDates: [] });
  const full = await read();
  expect(full.days).toEqual([]);
  expect(full.pagination).toMatchObject({ page: 1, total: 0, totalPages: 1, from: 0, to: 0 });
  expect(full.summary).toMatchObject({ netPnl: 0, trades: 0 });
});
