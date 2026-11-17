"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FILTER_KEYS, type AnalysisFilters } from "@traderjourney/core";
import type { ReviewContext, ReviewMessage, ReviewPeriod } from "@/lib/ai-review";
import { useApi, postJson } from "@/lib/use-api";
import { useAiRequest } from "@/lib/use-ai-request";
import { useFilters } from "./filter-bar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { MonetaryValue } from "./privacy";
import { reportSelection } from "@/lib/report-selection";
import { OptionSelect } from "./ui/option-select";

const languages = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  pt: "Português",
  nl: "Nederlands",
};
const languageName = (value: string) =>
  languages[value.split("-")[0] as keyof typeof languages] ?? value;

export function JournalReview() {
  const { values, timeZone } = useFilters();
  const [compare, setCompare] = useState(false);
  const selection = reportSelection(values);
  const filters = Object.fromEntries(
    FILTER_KEYS.flatMap((key) => (selection[key] ? [[key, selection[key]]] : [])),
  ) as AnalysisFilters;
  const query = new URLSearchParams(filters).toString();
  return (
    <ReviewSetup
      filters={filters}
      query={query}
      timeZone={timeZone}
      compare={compare}
      setCompare={setCompare}
    />
  );
}

function ReviewSetup({
  filters,
  query,
  timeZone,
  compare,
  setCompare,
}: {
  filters: AnalysisFilters;
  query: string;
  timeZone: string;
  compare: boolean;
  setCompare: (value: boolean) => void;
}) {
  const [noteIds, setNoteIds] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("English");
  const [customLanguage, setCustomLanguage] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [autoStart, setAutoStart] = useState(false);
  const selectionKey = `${query}:${timeZone}`;
  const [previousSelection, setPreviousSelection] = useState(selectionKey);
  if (previousSelection !== selectionKey) {
    setPreviousSelection(selectionKey);
    setNoteIds(null);
    setSearch("");
    setRefreshIndex(0);
    setAutoStart(false);
  }
  const {
    data: settings,
    error: settingsError,
    loading: settingsLoading,
  } = useApi<{ aiReviewLanguage: string | null }>("/api/settings");
  const { run: saveLanguage, busy: savingLanguage, error: languageError } = useAiRequest();
  useEffect(() => {
    if (!settings) return;
    const value = languageName(
      settings.aiReviewLanguage ||
        localStorage.getItem("tj-review-language") ||
        navigator.language ||
        "English",
    );
    setLanguage(value);
    setCustomLanguage(!Object.values(languages).includes(value));
  }, [settings?.aiReviewLanguage]);
  const {
    data: freshData,
    error,
    loading,
  } = useApi<ReviewContext>(
    `/api/ai/review?${query}&compare=${compare}&_refresh=${refreshIndex}${noteIds === null ? "" : `&noteIds=${encodeURIComponent(noteIds.join(","))}`}`,
  );
  // Keep the complete displayed scope together until its replacement is ready.
  const [displayed, setDisplayed] = useState<{
    data: ReviewContext;
    selectionKey: string;
    refreshIndex: number;
  } | null>(null);
  if (
    freshData &&
    !loading &&
    (displayed?.data !== freshData ||
      displayed.selectionKey !== selectionKey ||
      displayed.refreshIndex !== refreshIndex)
  ) {
    setDisplayed({ data: freshData, selectionKey, refreshIndex });
  }
  const data = displayed?.data;
  const pending = loading || Boolean(error) || !freshData;
  const changeLanguage = (value: string, persist = true) => {
    setLanguage(value);
    if (persist && value.trim())
      void saveLanguage(
        () => postJson("/api/settings", { aiReviewLanguage: value.trim() }, "PATCH"),
        () => {
          localStorage.removeItem("tj-review-language");
        },
      );
  };
  const selected = noteIds ?? data?.notes.filter((n) => n.suggested).map((n) => n.id) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI journal review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Use the filter button to select accounts, a period and the trade entries limit. The review
          and reports use the same selection. Day notes and routines are shared across accounts.
          Screenshots are not included.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            Initial answer language
            <OptionSelect
              aria-label="Initial answer language"
              className="w-52"
              disabled={settingsLoading || savingLanguage}
              value={customLanguage ? "other" : language}
              onValueChange={(value) => {
                setCustomLanguage(value === "other");
                changeLanguage(value === "other" ? "" : value);
              }}
            >
              {Object.values(languages).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
              <option value="other">Other…</option>
            </OptionSelect>
          </label>
          {customLanguage && (
            <Input
              aria-label="Custom answer language"
              className="w-52"
              maxLength={80}
              value={language}
              disabled={savingLanguage}
              onChange={(e) => changeLanguage(e.target.value, false)}
              onBlur={() => changeLanguage(language)}
            />
          )}
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={compare}
              aria-describedby="review-compare-help"
              onChange={(e) => {
                setCompare(e.target.checked);
                setNoteIds(null);
              }}
            />
            Compare with previous selection
          </label>
        </div>
        <p id="review-compare-help" className="max-w-3xl text-sm text-muted-foreground">
          Compare with the preceding period of equal length, or the preceding trades within the same
          filters when a trade entries limit is set. An empty end date means today.
        </p>
        {(settingsError || languageError) && (
          <p role="alert" className="text-sm text-destructive">
            {settingsError || languageError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {loading && !data && <p role="status">Loading review context…</p>}
        {data && (
          <fieldset disabled={pending} aria-busy={loading} className="min-w-0 space-y-4">
            <p className="text-sm">{data.label}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Period title="Current selection" period={data.current} />
              {data.compare && <Period title="Previous selection" period={data.previous} />}
            </div>
            {data.compare && data.previous.count === 0 && (
              <p className="text-sm text-muted-foreground">
                No previous trades are available for this selection.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {data.compare ? data.comparison : ""} Missing R values are excluded, not treated as
              zero. Monetary averages are shown only for a single currency.
            </p>
            <details className="border-y py-3">
              <summary className="cursor-pointer text-sm font-medium">
                Notebook context · {selected.length} selected
              </summary>
              <p className="my-2 text-sm text-muted-foreground">
                Linked notes are suggested. Reviews are listed first; confirm their relevance
                yourself. A creation date does not establish the period discussed. Changing notes
                starts a new review.
              </p>
              <Input
                aria-label="Find context notes"
                placeholder="Find a note or review…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="mt-2 max-h-64 overflow-y-auto">
                {data.notes
                  .filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
                  .map((n) => (
                    <label
                      key={n.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(n.id)}
                        onChange={(e) =>
                          setNoteIds(
                            e.target.checked
                              ? [...selected, n.id]
                              : selected.filter((id) => id !== n.id),
                          )
                        }
                      />
                      <span>
                        {n.title}
                        <span className="block text-xs text-muted-foreground">{n.reason}</span>
                      </span>
                    </label>
                  ))}
                {!data.notes.length && (
                  <p className="py-3 text-sm">No notebook notes available for this selection.</p>
                )}
              </div>
            </details>
            <ReviewChat
              key={`${displayed?.selectionKey}:${data.id}:${language}:${displayed?.refreshIndex}`}
              context={data}
              filters={filters}
              timeZone={timeZone}
              noteIds={selected}
              language={language}
              autoStart={autoStart && !pending}
              disabled={pending}
              onStarted={() => setAutoStart(false)}
              onNewReview={(start) => {
                setAutoStart(start);
                setRefreshIndex((value) => value + 1);
              }}
            />
            <details className="border-t pt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Sources sent with this review · {data.sources.length}
              </summary>
              <div className="mt-3 space-y-4">
                {data.sources.map((s) => (
                  <section
                    id={`review-${s.id}`}
                    key={s.id}
                    tabIndex={-1}
                    className="scroll-mt-24 border-b pb-3"
                  >
                    <h3 className="text-sm font-semibold">{s.title}</h3>
                    <p className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {s.text}
                    </p>
                  </section>
                ))}
              </div>
            </details>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}

const number = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
function Period({ title, period: p }: { title: string; period: ReviewPeriod }) {
  const m = p.metrics;
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-semibold">
        {title} · {p.count} closed trades
      </h3>
      <p className="text-sm text-muted-foreground">
        {p.from ?? "—"} → {p.to ?? "—"}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt>Net P&amp;L</dt>
        <dd>
          <MonetaryValue>
            {number(m?.netPnl)} {p.currencies.join(" / ")}
          </MonetaryValue>
        </dd>
        <dt>Win rate</dt>
        <dd>{m?.winRate == null ? "—" : `${number(m.winRate * 100)}%`}</dd>
        <dt>Average net / trade</dt>
        <dd>
          <MonetaryValue>
            {number(m?.expectancy)} {p.currencies.join(" / ")}
          </MonetaryValue>
        </dd>
        <dt>Average win / loss</dt>
        <dd>
          <MonetaryValue>
            {number(m?.avgWin)} / {number(m?.avgLoss)}
          </MonetaryValue>
        </dd>
        <dt>Profit factor</dt>
        <dd>{m?.noLosses ? "∞" : number(m?.profitFactor)}</dd>
        <dt>Average realized R</dt>
        <dd>
          {number(m?.avgRealizedR)} ({number(m?.rCount)} recorded)
        </dd>
      </dl>
    </section>
  );
}

function ReviewChat({
  context,
  filters,
  timeZone,
  noteIds,
  language,
  autoStart,
  disabled,
  onStarted,
  onNewReview,
}: {
  context: ReviewContext;
  filters: AnalysisFilters;
  timeZone: string;
  noteIds: string[];
  language: string;
  autoStart: boolean;
  disabled: boolean;
  onStarted: () => void;
  onNewReview: (start: boolean) => void;
}) {
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const { run, busy, error, dismiss } = useAiRequest();
  const send = (q: string) => {
    if (disabled) return;
    setLastQuestion(q);
    return run(
      () =>
        postJson<{ answer: string }>("/api/ai/review", {
          filters,
          timeZone,
          noteIds,
          language,
          contextId: context.id,
          history: messages,
          question: q,
          compare: context.compare,
        }),
      (result) => {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: q || "Review my trades" },
          { role: "assistant", content: result.answer },
        ]);
        setQuestion("");
        setCollapsed(false);
      },
    );
  };
  const ids = new Set(context.sources.map((s) => `#review-${s.id}`));
  useEffect(() => {
    if (autoStart) {
      onStarted();
      void send("");
    }
  }, [autoStart]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !context.current.count || !language.trim()}
          onClick={() => {
            dismiss();
            onNewReview(messages.length === 0);
          }}
        >
          {busy ? "Reviewing…" : messages.length ? "New review" : "Start review"}
        </Button>
        {messages.length > 0 && (
          <Button
            variant="outline"
            aria-expanded={!collapsed}
            aria-controls="review-conversation"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "Expand AI responses" : "Collapse AI responses"}
          </Button>
        )}
        <p className="self-center text-sm text-muted-foreground">
          Follow-up answers use your question’s language. Conversation is not saved.
        </p>
      </div>
      <div
        id="review-conversation"
        role="log"
        aria-label="Journal review conversation"
        aria-live="polite"
        className="space-y-5"
      >
        {messages.map((m, i) => (
          <div key={i} className="max-w-3xl" hidden={m.role === "assistant" && collapsed}>
            <p className="mb-1 text-sm font-semibold">{m.role === "user" ? "You" : "AI"}</p>
            <div className="break-words text-sm leading-relaxed [&_h1]:my-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_a]:text-primary [&_a]:underline">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => (ids.has(url) ? url : "")}
                components={{
                  img: () => null,
                  a: ({ href, children }) =>
                    href ? (
                      <a
                        href={href}
                        onClick={() => {
                          const el = document.getElementById(href.slice(1));
                          const details = el?.closest("details");
                          if (details) details.open = true;
                        }}
                      >
                        {children}
                      </a>
                    ) : (
                      <span>{children}</span>
                    ),
                }}
              >
                {m.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" disabled={busy} onClick={() => void send(lastQuestion)}>
            Try again
          </Button>
        </div>
      )}
      {messages.length > 0 && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) void send(question.trim());
          }}
        >
          <Input
            aria-label="Ask about this review"
            placeholder="Ask about this review, in any language…"
            value={question}
            maxLength={10000}
            onChange={(e) => setQuestion(e.target.value)}
            className="min-w-0 flex-1 basis-64"
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            Ask
          </Button>
        </form>
      )}
    </div>
  );
}
