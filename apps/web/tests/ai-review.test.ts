import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { linkReviewCitations } from "../src/lib/ai-review";
import { reportSelection } from "../src/lib/report-selection";
vi.mock("@/server/ai", () => ({
  runAi: vi.fn(async () => "## Review\nSee [current](#review-current)."),
}));
const oldDir = process.env.JOURNAL_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "ai-review-"));
process.env.JOURNAL_DATA_DIR = dir;
const { db, accounts, trades, executions, notes, journalDays, progressRules, progressChecks } =
  await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { queryTrades } = await import("../src/server/trades-query");
const { buildReview } = await import("../src/server/ai-review");
const { POST } = await import("../src/app/api/ai/review/route");
const { runAi } = await import("../src/server/ai");
const { setSetting, getTimeZone } = await import("../src/server/settings");
const req = (body: unknown) =>
  new Request("http://localhost/api/ai/review", { method: "POST", body: JSON.stringify(body) });
it("uses today in the configured timezone for a range without an end date", () => {
  const zone = getTimeZone();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T00:30:00Z"));
  setSetting("timeZone", "America/Los_Angeles");
  try {
    const result = buildReview({ from: "2026-10-05", accounts: "a" }, [], true);
    expect(result.current.to).toBe("2026-10-06");
    expect(result.previous.from).toBe("2026-10-03");
    expect(result.previous.to).toBe("2026-10-04");
    expect(result.previous.count).toBe(2);
    const limited = buildReview({ from: "2026-10-01", lastTrades: "2" }, [], true);
    expect(limited.previous.count).toBe(2);
    expect(limited.comparison).toContain("Previous 2 closed trades");
  } finally {
    vi.useRealTimers();
    setSetting("timeZone", zone);
  }
});
beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  for (const table of [
    trades,
    executions,
    accounts,
    notes,
    journalDays,
    progressChecks,
    progressRules,
  ])
    db.delete(table).run();
  db.insert(accounts)
    .values([
      { id: "a", name: "A", kind: "manual", createdAt: "2026-01-01" },
      { id: "b", name: "B", kind: "manual", createdAt: "2026-01-01" },
    ])
    .run();
  for (let day = 1; day <= 6; day++) {
    const date = `2026-10-0${day}`;
    insertExecutions(
      "a",
      [
        {
          symbol: `DAY${day}`,
          side: "buy",
          quantity: 1,
          price: 100,
          fee: 0,
          executedAt: `${date}T09:00:00Z`,
        },
        {
          symbol: `DAY${day}`,
          side: "sell",
          quantity: 1,
          price: 100 + day,
          fee: 0,
          executedAt: `${date}T10:00:00Z`,
        },
      ],
      "manual",
    );
  }
  db.insert(notes)
    .values({
      id: "review",
      folderId: "f",
      title: "Weekly REVIEW",
      content: "Trader hypothesis",
      createdAt: "2026-10-07",
      updatedAt: "2026-10-07",
    })
    .run();
  db.insert(journalDays)
    .values({ date: "2026-10-06", note: "Shared day reflection", updatedAt: "2026-10-06" })
    .run();
  db.insert(progressRules)
    .values({
      id: "routine",
      title: "Preparation",
      stage: "before",
      weekdaysJson: "[0,1,2,3,4,5,6]",
      createdAt: "2026-01-01",
    })
    .run();
  db.insert(progressChecks)
    .values({ id: "check", ruleId: "routine", date: "2026-10-06", done: false })
    .run();
  vi.mocked(runAi).mockClear();
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (oldDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = oldDir;
  rmSync(dir, { recursive: true, force: true });
});
it("uses the same last-N selection for Reports and review, with a disjoint previous N", () => {
  const filters = { accounts: "a", lastTrades: "2" };
  const result = buildReview(filters, [], true);
  expect(
    queryTrades(filters)
      .trades.map((t) => t.symbol)
      .sort(),
  ).toEqual(["DAY5", "DAY6"]);
  expect(result.current.count).toBe(2);
  expect(result.previous.count).toBe(2);
  expect(result.current.from).toBe("2026-10-05");
  expect(result.previous.to).toBe("2026-10-04");
  expect(result.current.metrics?.netPnl).toBe(11);
  expect(result.previous.metrics?.netPnl).toBe(7);
});
it("compares equal calendar periods and keeps undated reviews opt-in", () => {
  const result = buildReview({ accounts: "a", from: "2026-10-05", to: "2026-10-06" }, [], true);
  expect(result.previous.from).toBe("2026-10-03");
  expect(result.previous.to).toBe("2026-10-04");
  expect(result.sources.some((s) => s.text.includes("Trader hypothesis"))).toBe(false);
  expect(result.notes.find((n) => n.id === "review")?.suggested).toBe(false);
  const selected = buildReview({ accounts: "a", lastTrades: "2" }, ["review"]);
  expect(selected.sources.some((s) => s.text.includes("Trader hypothesis"))).toBe(true);
  expect(selected.sources.some((s) => s.text.includes("Shared day reflection"))).toBe(true);
  expect(selected.sources.some((s) => s.text.includes("not recorded"))).toBe(true);
});
it("rejects changed context before contacting the model and includes history and language", async () => {
  const filters = { accounts: "a", lastTrades: "2" };
  const context = buildReview(filters, []);
  const body = {
    filters,
    timeZone: "UTC",
    noteIds: [],
    contextId: context.id,
    language: "Nederlands",
    question: "",
    history: [],
  };
  const response = await POST(req(body));
  expect(response.status).toBe(200);
  expect(vi.mocked(runAi).mock.calls[0]?.[0]).toContain("Nederlands");
  const history = [
    { role: "user", content: "Review my trades" },
    { role: "assistant", content: "Earlier review" },
  ];
  expect((await POST(req({ ...body, question: "What about preparation?", history }))).status).toBe(
    200,
  );
  expect(vi.mocked(runAi).mock.calls[1]![0]).toContain(JSON.stringify(history));
  expect(vi.mocked(runAi).mock.calls[1]![2]).toContain("latest user's question language");
  db.update(journalDays).set({ note: "Changed reflection" }).run();
  expect((await POST(req(body))).status).toBe(400);
  expect(runAi).toHaveBeenCalledTimes(2);
});
it("rejects invalid trade counts and missing notes instead of widening scope", () => {
  expect(() => buildReview({ lastTrades: "0" }, [])).toThrow();
  expect(() => buildReview({}, ["deleted-note"])).toThrow();
});
it("does not accept an initial review with no verifiable source references", async () => {
  const filters = { accounts: "a", lastTrades: "2" };
  const context = buildReview(filters, []);
  vi.mocked(runAi).mockResolvedValueOnce("Unsupported summary without sources");
  const response = await POST(
    req({
      filters,
      timeZone: "UTC",
      noteIds: [],
      contextId: context.id,
      language: "English",
      question: "",
      history: [],
    }),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("source links");
});
it("links only known source IDs and preserves existing Markdown citations", () => {
  const sources = [{ id: "current", title: "Current", text: "", href: "" }];
  expect(
    linkReviewCitations("[review-current] [review-invented] [current](#review-current)", sources),
  ).toBe("[source](#review-current) [review-invented] [current](#review-current)");
});
it("does not double-encode large source text or silently truncate it", async () => {
  const text = '"'.repeat(50000) + "END_OF_NOTE";
  db.update(notes).set({ content: text }).where(eq(notes.id, "review")).run();
  const filters = { accounts: "a", lastTrades: "2" };
  const context = buildReview(filters, ["review"]);
  const response = await POST(
    req({
      filters,
      timeZone: "UTC",
      noteIds: ["review"],
      contextId: context.id,
      language: "English",
      question: "",
      history: [],
    }),
  );
  expect(response.status).toBe(200);
  expect(vi.mocked(runAi).mock.calls[0]![0]).toContain("END_OF_NOTE");
  expect(vi.mocked(runAi).mock.calls[0]![0].length).toBeLessThan(180000);
});
it("keeps excluded accounts and anchored notes out, and separates mixed currencies", () => {
  db.update(accounts).set({ currency: "EUR" }).where(eq(accounts.id, "b")).run();
  insertExecutions(
    "b",
    [
      {
        symbol: "EXCLUDED",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0,
        executedAt: "2026-10-06T09:00:00Z",
      },
      {
        symbol: "EXCLUDED",
        side: "sell",
        quantity: 1,
        price: 150,
        fee: 0,
        executedAt: "2026-10-06T12:00:00Z",
      },
    ],
    "manual",
  );
  const other = queryTrades({ accounts: "b" }).trades[0]!;
  db.insert(notes)
    .values({
      id: "other",
      folderId: "f",
      tradeKey: other.key,
      title: "Other account",
      content: "PRIVATE_OTHER",
      createdAt: "2026-10-06",
      updatedAt: "2026-10-06",
    })
    .run();
  const scoped = buildReview({ accounts: "a", lastTrades: "2" }, []);
  expect(JSON.stringify(scoped)).not.toContain("EXCLUDED");
  expect(scoped.notes.some((n) => n.id === "other")).toBe(false);
  expect(() => buildReview({ accounts: "a" }, ["other"])).toThrow();
  const mixed = buildReview({ lastTrades: "3" }, []);
  expect(mixed.current.metrics).toBeNull();
  expect(mixed.sources.some((s) => s.title === "current: EUR")).toBe(true);
  expect(mixed.sources.some((s) => s.title === "current: USD")).toBe(true);
});
it("preserves stable closing-time boundaries and reports fewer available trades", () => {
  db.update(trades).set({ closedAt: "2026-10-06T10:00:00Z" }).run();
  const selected = queryTrades({ lastTrades: "2" })
    .trades.map((t) => t.key)
    .sort();
  const review = buildReview({ lastTrades: "2" }, [], true);
  const current = review.sources
    .filter((s) => s.id.startsWith("trade-"))
    .map((s) => JSON.parse(s.text))
    .filter((t) => t.selection === "current");
  expect(current.map((t) => t.key).sort()).toEqual(selected);
  expect(
    new Set(
      review.sources.filter((s) => s.id.startsWith("trade-")).map((s) => JSON.parse(s.text).key),
    ).size,
  ).toBe(4);
  const short = buildReview({ lastTrades: "30" }, []);
  expect(short.current.count).toBe(6);
  expect(short.previous.count).toBe(0);
});
it("uses the shared entries field after date filters, without including earlier sources by default", async () => {
  const filters = reportSelection({
    accounts: "a",
    entries: "2",
    from: "2026-10-02",
    to: "2026-10-06",
  });
  expect(filters).toEqual({ accounts: "a", lastTrades: "2", from: "2026-10-02", to: "2026-10-06" });
  const current = buildReview(filters, []);
  const comparison = buildReview(filters, [], true);
  expect(current.compare).toBe(false);
  expect(current.current.count).toBe(2);
  expect(current.sources.some((s) => s.id.startsWith("previous"))).toBe(false);
  expect(JSON.stringify(current.sources)).not.toContain("DAY4");
  expect(comparison.sources.some((s) => s.id === "previous")).toBe(true);
  expect(JSON.stringify(comparison.sources)).toContain("DAY4");
  expect(comparison.id).not.toBe(current.id);
  const response = await POST(
    req({
      filters,
      noteIds: [],
      contextId: current.id,
      compare: false,
      history: [],
      question: "",
      language: "English",
    }),
  );
  expect(response.status).toBe(200);
  const prompt = vi.mocked(runAi).mock.calls[0]![0];
  expect(prompt).toContain("Comparison enabled: false");
  expect(prompt).not.toContain("#review-previous");
  expect(prompt).not.toContain("DAY4");
  expect(buildReview({}, []).label).toBe("All closed trades");
});
