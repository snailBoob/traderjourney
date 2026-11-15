"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/use-api";
import { AiNotice } from "./ai-notice";
import { useFilters } from "./filter-bar";
import { useAiRequest, type AiScope } from "@/lib/use-ai-request";
import type { AnalysisFilters } from "@traderjourney/core";

const SUGGESTIONS = [
  "What's my most expensive mistake?",
  "Which weekday should I stop trading?",
  "Am I better at longs or shorts?",
];

/** Natural-language questions against your own aggregates — BYO AI provider key. */
export function AskJournal() {
  const { values, query, timeZone } = useFilters();
  return <ScopedAskJournal key={`${timeZone}:${query}`} filters={values} timeZone={timeZone} />;
}

function ScopedAskJournal({ filters, timeZone }: { filters: AnalysisFilters; timeZone: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; scope: AiScope } | null>(null);
  const { run, busy, error, dismiss } = useAiRequest();
  const [lastQuestion, setLastQuestion] = useState("");

  const ask = async (q: string) => {
    if (busy || !q.trim()) return;
    q = q.trim();
    setLastQuestion(q);
    setAnswer(null);
    await run(
      () =>
        postJson<{ answer: string; scope: AiScope }>("/api/ai/ask", {
          question: q,
          filters,
          timeZone,
        }),
      setAnswer,
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask your journal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Uses the selected accounts and journal filters. Changing filters clears the answer.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim()) void ask(question);
          }}
        >
          <Input
            aria-label="Ask your journal a question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Why do my Monday shorts keep failing?"
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            <Sparkles />
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              disabled={busy}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:cursor-wait disabled:opacity-50"
              onClick={() => {
                setQuestion(suggestion);
                void ask(suggestion);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
        {error && (
          <AiNotice error={error} onRetry={() => void ask(lastQuestion)} onDismiss={dismiss} />
        )}
        {answer && (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground">{answer.scope.label}</p>
            <div className="text-sm leading-relaxed [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_li]:pl-0.5 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.answer}</ReactMarkdown>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
