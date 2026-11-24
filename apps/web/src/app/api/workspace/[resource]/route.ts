import { and, asc, desc, eq } from "drizzle-orm";
import { dayKeyOf } from "@traderjourney/core";
import {
  db,
  noteTemplates,
  progressRules,
  progressChecks,
  missedTrades,
  attachments,
  snapshots,
  playbooks,
  accounts,
  missedTradeRuleChecks,
} from "@/db";
import { handler, ok, bad, requireValue, RequestError } from "@/server/api";
import { newId, nowIso } from "@/server/ids";
import { getJournalDefaults, getTimeZone, setSetting } from "@/server/settings";
import { scheduledRules } from "@/lib/progress";
import { parseJournalDefaults } from "@/lib/journal-defaults";
import { fetchTradingViewSnapshot, validTradingViewUrl } from "@/lib/tradingview-snapshot";
import {
  createNoteTemplate,
  listNoteTemplates,
  validTemplateScopes,
} from "@/server/note-templates";

type Context = { params: Promise<{ resource: string }> };
const today = () => dayKeyOf(nowIso(), getTimeZone());
const rules = () =>
  db
    .select()
    .from(progressRules)
    .orderBy(asc(progressRules.stage), asc(progressRules.sortOrder), asc(progressRules.createdAt))
    .all()
    .map((r) => ({ ...r, weekdays: JSON.parse(r.weekdaysJson) as number[] }));
const validDate = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const text = (s: unknown, max = 100000): s is string => typeof s === "string" && s.length <= max;
const MISSED_OUTCOMES = ["back_to_entry", "extended_to_2r"] as const;

export const GET = handler(async (_request: Request, { params }: Context) => {
  const { resource } = await params;
  if (resource === "templates") {
    const scope = new URL(_request.url).searchParams.get("scope");
    return ok({ templates: listNoteTemplates(scope) });
  }
  if (resource === "progress")
    return ok({ rules: rules(), checks: db.select().from(progressChecks).all(), today: today() });
  if (resource === "missed") {
    const search = new URL(_request.url).searchParams;
    const list = (value: string | null) =>
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const from = search.get("from");
    const to = search.get("to");
    const playbookId = search.get("playbookId");
    const symbols = list(search.get("symbol")?.toUpperCase() ?? null);
    const excludedSymbols = list(search.get("excludeSymbol")?.toUpperCase() ?? null);
    const requiredTags = list(search.get("tag"));
    const outcome = search.get("status");
    const ruleFilter = search.get("missedRuleFollowed");
    const trades = db
      .select()
      .from(missedTrades)
      .orderBy(desc(missedTrades.observedAt), desc(missedTrades.createdAt))
      .all()
      .filter((trade) => {
        const day = trade.observedAt.slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
        if (playbookId && trade.playbookId !== playbookId) return false;
        if (symbols.length && !symbols.includes(trade.symbol.toUpperCase())) return false;
        if (excludedSymbols.includes(trade.symbol.toUpperCase())) return false;
        if (outcome && trade.outcome !== outcome) return false;
        if (requiredTags.length) {
          let tags: string[] = [];
          try {
            const parsed = JSON.parse(trade.tagsJson ?? "[]") as unknown;
            tags = Array.isArray(parsed)
              ? parsed.filter((tag): tag is string => typeof tag === "string")
              : [];
          } catch {
            tags = [];
          }
          if (
            !requiredTags.every((tag) =>
              tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase()),
            )
          )
            return false;
        }
        return true;
      });
    const checks = db.select().from(missedTradeRuleChecks).all();
    const playbookMap = new Map(
      db
        .select()
        .from(playbooks)
        .all()
        .map((book) => [book.id, [...new Set(JSON.parse(book.rulesJson) as string[])]]),
    );
    const checkMap = new Map<string, Map<string, boolean>>();
    for (const check of checks) {
      const list = checkMap.get(check.missedTradeId) ?? new Map<string, boolean>();
      list.set(check.rule, check.followed);
      checkMap.set(check.missedTradeId, list);
    }
    const storedSnapshots = db
      .select({ ownerId: snapshots.ownerId, id: snapshots.id })
      .from(snapshots)
      .where(eq(snapshots.ownerType, "missed"))
      .all();
    const snapshotByOwner = new Map(storedSnapshots.map(({ ownerId, id }) => [ownerId, id]));
    const mappedTrades = trades.map((trade) => {
      const rules = trade.playbookId ? (playbookMap.get(trade.playbookId) ?? []) : [];
      const storedChecks = checkMap.get(trade.id) ?? new Map<string, boolean>();
      const ruleChecks = rules.map((rule) => ({ rule, followed: storedChecks.get(rule) ?? null }));
      const assessed = ruleChecks.filter((check) => check.followed !== null);
      const followed = assessed.filter((check) => check.followed === true).length;
      return {
        ...trade,
        tags: (() => {
          try {
            const parsed = JSON.parse(trade.tagsJson ?? "[]") as unknown;
            return Array.isArray(parsed)
              ? parsed.filter((tag): tag is string => typeof tag === "string")
              : [];
          } catch {
            return [];
          }
        })(),
        snapshotAttachmentId: snapshotByOwner.has(trade.id) ? trade.id : null,
        snapshotId: snapshotByOwner.get(trade.id) ?? null,
        ruleReview: { followed, assessed: assessed.length, total: rules.length },
        ruleChecks,
      };
    });
    const filteredTrades =
      ruleFilter && ruleFilter !== "all"
        ? mappedTrades.filter((trade) => {
            if (ruleFilter === "not_assessed") return trade.ruleReview.assessed === 0;
            if (ruleFilter === "all_followed")
              return (
                trade.ruleReview.total > 0 &&
                trade.ruleReview.assessed === trade.ruleReview.total &&
                trade.ruleReview.followed === trade.ruleReview.total
              );
            if (ruleFilter === "some_broken")
              return (
                trade.ruleReview.assessed > 0 &&
                trade.ruleReview.followed < trade.ruleReview.assessed
              );
            if (ruleFilter === "none_followed")
              return trade.ruleReview.assessed > 0 && trade.ruleReview.followed === 0;
            return true;
          })
        : mappedTrades;
    // "Entries limit": the list is newest-first, so keep only the most recent entries;
    // the client computes its totals from this truncated list.
    const entriesParam = Number.parseInt(search.get("entries") ?? "", 10);
    const entries = Number.isInteger(entriesParam) && entriesParam > 0 ? entriesParam : null;
    return ok({ trades: entries ? filteredTrades.slice(0, entries) : filteredTrades });
  }
  if (resource === "defaults") return ok(getJournalDefaults());
  return bad("Unknown resource", 404);
});

export const POST = handler(async (request: Request, { params }: Context) => {
  const { resource } = await params;
  const b = await request.json();
  if (resource === "templates") {
    requireValue(
      text(b.name, 100) && b.name.trim() && text(b.content),
      "A template needs a name and content (up to 100,000 characters).",
    );
    const scopes = b.scopes ?? ["all"];
    requireValue(validTemplateScopes(scopes), "Choose at least one valid template location.");
    return ok({ id: createNoteTemplate(b.name, b.content, scopes) });
  }
  if (resource === "progress") {
    if (Array.isArray(b.reorder)) {
      for (const item of b.reorder) {
        requireValue(
          text(item?.id, 200) && Number.isInteger(item?.sortOrder),
          "Invalid routine order.",
        );
        db.update(progressRules)
          .set({ sortOrder: item.sortOrder })
          .where(eq(progressRules.id, item.id))
          .run();
      }
      return ok({ saved: true });
    }
    if (b.ruleId) {
      requireValue(
        validDate(b.date) && b.date <= today() && typeof b.done === "boolean",
        "Choose a valid date up to today.",
      );
      requireValue(
        scheduledRules(rules(), b.date).some((r) => r.id === b.ruleId),
        "This routine is not scheduled on that date.",
      );
      const id = `${b.ruleId}:${b.date}`;
      db.insert(progressChecks)
        .values({ id, ruleId: b.ruleId, date: b.date, done: b.done })
        .onConflictDoUpdate({ target: progressChecks.id, set: { done: b.done } })
        .run();
      return ok({ saved: true });
    }
    requireValue(
      text(b.title, 200) &&
        b.title.trim() &&
        ["Before trading", "During trading", "After trading"].includes(b.stage),
      "Enter a routine title and stage.",
    );
    requireValue(
      Array.isArray(b.weekdays) &&
        b.weekdays.length > 0 &&
        b.weekdays.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 6),
      "Select at least one weekday.",
    );
    const id = newId();
    db.insert(progressRules)
      .values({
        id,
        title: b.title.trim(),
        stage: b.stage,
        weekdaysJson: JSON.stringify([...new Set(b.weekdays)]),
        createdAt: today(),
        sortOrder: (() => {
          const rows = db
            .select({ sortOrder: progressRules.sortOrder })
            .from(progressRules)
            .where(eq(progressRules.stage, b.stage))
            .all();
          return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
        })(),
      })
      .run();
    return ok({ id });
  }
  if (resource === "missed") {
    requireValue(text(b.symbol, 80) && b.symbol.trim(), "Enter a symbol.");
    requireValue(
      text(b.observedAt, 40) && /^\d{4}-\d{2}-\d{2}$/.test(b.observedAt) && validDate(b.observedAt),
      "Enter a valid observation date.",
    );
    requireValue(
      b.outcome === undefined ||
        b.outcome === null ||
        b.outcome === "" ||
        (typeof b.outcome === "string" &&
          MISSED_OUTCOMES.includes(b.outcome as (typeof MISSED_OUTCOMES)[number])),
      "Choose a valid outcome.",
    );
    requireValue(text(b.notes ?? ""), "Notes are too long.");
    requireValue(
      !b.tradingViewUrl || validTradingViewUrl(b.tradingViewUrl),
      "Enter a TradingView snapshot URL.",
    );
    requireValue(
      !b.playbookId || db.select().from(playbooks).where(eq(playbooks.id, b.playbookId)).get(),
      "Strategy not found.",
    );
    const existing = b.id
      ? db.select().from(missedTrades).where(eq(missedTrades.id, b.id)).get()
      : undefined;
    if (b.id) requireValue(existing, "Missed trade not found.");
    const id = b.id ?? newId();
    const tradingViewUrl = b.tradingViewUrl?.trim() || null;
    const existingSnapshot = db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(eq(snapshots.ownerType, "missed"), eq(snapshots.ownerId, id)))
      .all();
    const shouldFetchSnapshot =
      Boolean(tradingViewUrl) &&
      (tradingViewUrl !== existing?.tradingViewUrl || existingSnapshot.length === 0);
    let snapshot: { bytes: Buffer; mime: string } | null = null;
    if (shouldFetchSnapshot && tradingViewUrl)
      snapshot = await fetchTradingViewSnapshot(tradingViewUrl);

    const selectedBook = b.playbookId
      ? db.select().from(playbooks).where(eq(playbooks.id, b.playbookId)).get()
      : null;
    const strategyRules = selectedBook
      ? [...new Set(JSON.parse(selectedBook.rulesJson) as string[])]
      : [];
    const submittedChecks = Array.isArray(b.ruleChecks) ? b.ruleChecks : [];
    requireValue(
      submittedChecks.every(
        (check: any) =>
          check &&
          strategyRules.includes(check.rule) &&
          (check.followed === null || typeof check.followed === "boolean"),
      ),
      "Choose valid Strategy Rule Review values.",
    );
    const tags = Array.isArray(b.tags)
      ? [
          ...new Set(
            b.tags
              .filter((tag: unknown): tag is string => typeof tag === "string")
              .map((tag: string) => tag.trim())
              .filter(Boolean),
          ),
        ].slice(0, 50)
      : [];
    const values = {
      symbol: b.symbol.trim().toUpperCase(),
      observedAt: b.observedAt,
      playbookId: b.playbookId || null,
      outcome: b.outcome || null,
      tagsJson: JSON.stringify(tags),
      tradingViewUrl,
      notes: b.notes ?? "",
    };
    db.transaction(() => {
      if (existing) db.update(missedTrades).set(values).where(eq(missedTrades.id, id)).run();
      else
        db.insert(missedTrades)
          .values({ id, ...values, createdAt: nowIso() })
          .run();
      if (!tradingViewUrl || shouldFetchSnapshot) {
        for (const snapshot of existingSnapshot)
          db.delete(snapshots).where(eq(snapshots.id, snapshot.id)).run();
      }
      db.delete(missedTradeRuleChecks).where(eq(missedTradeRuleChecks.missedTradeId, id)).run();
      for (const check of submittedChecks) {
        if (check.followed === null) continue;
        db.insert(missedTradeRuleChecks)
          .values({
            id: JSON.stringify([id, selectedBook!.id, check.rule]),
            missedTradeId: id,
            playbookId: selectedBook!.id,
            rule: check.rule,
            followed: check.followed,
          })
          .run();
      }
      if (snapshot) {
        db.insert(snapshots)
          .values({
            id: newId(),
            ownerType: "missed",
            ownerId: id,
            mime: snapshot.mime,
            size: snapshot.bytes.length,
            data: snapshot.bytes,
            createdAt: nowIso(),
          })
          .run();
      }
    });
    return ok({ id });
  }
  if (resource === "defaults") {
    const known = new Set(
      db
        .select({ id: accounts.id })
        .from(accounts)
        .all()
        .map((a) => a.id),
    );
    const parsed = parseJournalDefaults(b, (id) => known.has(id));
    if (parsed.error !== undefined) return bad(parsed.error);
    setSetting("journalDefaults", JSON.stringify(parsed.defaults));
    return ok({ saved: true });
  }
  return bad("Unknown resource", 404);
});

export const PATCH = handler(async (request: Request, { params }: Context) => {
  const { resource } = await params;
  const b = await request.json();
  if (resource === "templates") {
    requireValue(text(b.id, 200), "Invalid id.");
    const existing = db.select().from(noteTemplates).where(eq(noteTemplates.id, b.id)).get();
    requireValue(existing, "Template not found.");
    const patch: { name?: string; content?: string; scopesJson?: string } = {};
    if (b.name !== undefined) {
      requireValue(text(b.name, 100) && b.name.trim(), "A template needs a name.");
      patch.name = b.name.trim();
    }
    if (b.content !== undefined) {
      requireValue(text(b.content), "Template content is too long.");
      patch.content = b.content;
    }
    if (b.scopes !== undefined) {
      requireValue(validTemplateScopes(b.scopes), "Choose at least one valid template location.");
      patch.scopesJson = JSON.stringify(b.scopes);
    }
    requireValue(Object.keys(patch).length > 0, "Nothing to update.");
    db.update(noteTemplates).set(patch).where(eq(noteTemplates.id, b.id)).run();
    return ok({ saved: true });
  }
  if (resource === "progress") {
    requireValue(text(b.id, 200), "Invalid id.");
    requireValue(text(b.title, 200) && b.title.trim(), "Enter a routine title.");
    db.update(progressRules).set({ title: b.title.trim() }).where(eq(progressRules.id, b.id)).run();
    return ok({ saved: true });
  }
  return bad("Unknown resource", 404);
});

export const DELETE = handler(async (request: Request, { params }: Context) => {
  const { resource } = await params;
  const b = await request.json();
  if (resource === "missed" && b.all === true) {
    db.transaction(() => {
      db.delete(attachments).where(eq(attachments.ownerType, "missed")).run();
      db.delete(snapshots).where(eq(snapshots.ownerType, "missed")).run();
      db.delete(missedTradeRuleChecks).run();
      db.delete(missedTrades).run();
    });
    return ok({ saved: true });
  }
  requireValue(text(b.id, 200), "Invalid id.");
  if (resource === "templates") db.delete(noteTemplates).where(eq(noteTemplates.id, b.id)).run();
  else if (resource === "progress") {
    db.delete(progressChecks).where(eq(progressChecks.ruleId, b.id)).run();
    db.delete(progressRules).where(eq(progressRules.id, b.id)).run();
  } else if (resource === "missed") {
    requireValue(
      db.select().from(missedTrades).where(eq(missedTrades.id, b.id)).get(),
      "Missed trade not found.",
    );
    requireValue(b.delete === true, "Unsupported missed trade action.");
    db.delete(attachments)
      .where(and(eq(attachments.ownerType, "missed"), eq(attachments.ownerId, b.id)))
      .run();
    db.delete(snapshots)
      .where(and(eq(snapshots.ownerType, "missed"), eq(snapshots.ownerId, b.id)))
      .run();
    db.delete(missedTradeRuleChecks).where(eq(missedTradeRuleChecks.missedTradeId, b.id)).run();
    db.delete(missedTrades).where(eq(missedTrades.id, b.id)).run();
  } else return bad("Unknown resource", 404);
  return ok({ saved: true });
});
