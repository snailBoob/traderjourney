"use client";

import type { AnalysisFilters, BucketStats } from "@traderjourney/core";
import { useState, type ReactNode } from "react";
import { TimeHeatmap } from "./charts/time-heatmap";
import { DailyBiasPnl } from "./charts/daily-bias-pnl";
import { DailyCompletionPnl } from "./charts/daily-completion-pnl";
import { MonetaryValue } from "./privacy";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { DashboardLayout } from "./dashboard-layout";
import { useApi } from "@/lib/use-api";
import { fmtMoney, fmtPercent, pnlClass } from "@/lib/utils";
import { describeFilters } from "@/lib/filter-description";

interface CutReasonStats {
  key: string;
  trades: number;
  slHits: number;
  tpHits: number;
  cutJustified: number | null;
}
interface PossibleRStats {
  playbookId: string;
  winningTrades: number;
  higherRCount: number;
  higherRRate: number | null;
  avgExtraR: number | null;
}
interface PatternStats {
  key: string;
  trades: number;
  winRate: number | null;
  netPnl: number;
}
interface OverviewData {
  buckets: Record<
    "symbol" | "tag" | "mistake" | "playbook" | "weekday" | "hour" | "duration" | "direction",
    BucketStats[]
  >;
  overviewAnalysis: {
    cutReasons: CutReasonStats[];
    possibleR: PossibleRStats[];
    patterns: PatternStats[];
  };
  currencies: string[];
  timeZone: string;
  accounts: { id: string; name: string }[];
  playbooks: { id: string; name: string }[];
  dailyBiasPnl: { date: string; pnl: number; trades: number; wins: number }[];
  dailyCompletionPnl: { date: string; pnl: number; progress: number }[];
}

const SECTIONS = [
  { key: "symbol", title: "By symbol" },
  { key: "direction", title: "Long vs short" },
  { key: "weekday", title: "By weekday" },
  { key: "duration", title: "By holding time" },
  { key: "tag", title: "By tag" },
  { key: "mistake", title: "By mistake" },
  { key: "playbook", title: "By strategy" },
] as const;

const REPORT_OVERVIEW_LAYOUT_KEY = "journal-reports-overview-layout-v1";

const tableHead = "text-right";
const numericCell = "tnum text-right";

function StandardTable({ children, columns = 4 }: { children: ReactNode; columns?: 4 | 5 }) {
  return (
    <Table
      className={
        columns === 5
          ? "w-full table-fixed [&_th:first-child]:w-[40%] [&_td:first-child]:w-[40%] [&_th:not(:first-child)]:w-[15%] [&_td:not(:first-child)]:w-[15%] [&_th:not(:first-child)]:whitespace-nowrap"
          : "w-full table-fixed [&_th:first-child]:w-[55%] [&_td:first-child]:w-[55%] [&_th:not(:first-child)]:w-[15%] [&_td:not(:first-child)]:w-[15%] [&_th:not(:first-child)]:whitespace-nowrap"
      }
    >
      {children}
    </Table>
  );
}

function PageControl({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.ceil(total / 10);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
      <span>
        Page {page + 1} of {pages}
      </span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages - 1}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function ReportOverview({
  query,
  filters,
  customizeTarget,
}: {
  query: string;
  filters: AnalysisFilters;
  customizeTarget: HTMLDivElement | null;
}) {
  const { data, error, loading } = useApi<OverviewData>(`/api/stats?${query}`);
  const [pages, setPages] = useState<Record<string, number>>({});
  const pageFor = (key: string) => pages[key] ?? 0;
  const setPage = (key: string, page: number) =>
    setPages((current) => ({ ...current, [key]: page }));
  const paged = <T,>(key: string, rows: T[]) =>
    rows.slice(pageFor(key) * 10, pageFor(key) * 10 + 10);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (loading || !data) return <Skeleton className="h-72" />;
  if (data.currencies.length > 1)
    return (
      <p className="rounded-lg border p-4 text-sm">
        These accounts use different currencies ({data.currencies.join(", ")}). Select accounts with
        the same currency in Filters to compare monetary results.
      </p>
    );

  const currency = data.currencies[0] ?? "USD";
  const label = (dimension: string, key: string) =>
    dimension === "playbook" ? (data.playbooks.find((book) => book.id === key)?.name ?? key) : key;

  const widgets = [
    {
      id: "report-widget-time",
      label: "Trade time performance",
      size: "full" as const,
      layoutGroup: "visuals",
      content: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Trade time performance</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeHeatmap hours={data.buckets.hour} currency={currency} />
          </CardContent>
        </Card>
      ),
    },
    ...SECTIONS.map((section, index) => ({
      id: `report-widget-${section.key}`,
      label: section.title,
      size: "medium" as const,
      layoutGroup: `breakdown-${Math.floor(index / 2)}`,
      content: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.buckets[section.key].length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {section.key === "tag" || section.key === "mistake" || section.key === "playbook"
                  ? "Annotate trades to unlock this breakdown."
                  : "No data yet."}
              </p>
            ) : (
              <>
                <StandardTable columns={5}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{section.title.replace("By ", "")}</TableHead>
                      <TableHead className={tableHead}>Trades</TableHead>
                      <TableHead className={tableHead}>Win %</TableHead>
                      <TableHead className={tableHead}>Net P&amp;L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged(`bucket-${section.key}`, data.buckets[section.key]).map((bucket) => (
                      <TableRow key={bucket.key}>
                        <TableCell className="font-medium">
                          {label(section.key, bucket.key)}
                        </TableCell>
                        <TableCell className={`${numericCell} text-muted-foreground`}>
                          {bucket.trades}
                        </TableCell>
                        <TableCell className={numericCell}>
                          {fmtPercent(bucket.winRate, 0)}
                        </TableCell>
                        <TableCell className={`${numericCell} ${pnlClass(bucket.netPnl)}`}>
                          <MonetaryValue>{fmtMoney(bucket.netPnl, currency)}</MonetaryValue>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </StandardTable>
                <PageControl
                  page={pageFor(`bucket-${section.key}`)}
                  total={data.buckets[section.key].length}
                  onChange={(page) => setPage(`bucket-${section.key}`, page)}
                />
              </>
            )}
          </CardContent>
        </Card>
      ),
    })),
    {
      id: "report-widget-daily-bias-pnl",
      label: "P&L according to daily bias",
      size: "medium" as const,
      layoutGroup: "analysis-0",
      content: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>P&amp;L according to daily bias</CardTitle>
          </CardHeader>
          <CardContent>
            {data.dailyBiasPnl.length ? (
              <DailyBiasPnl data={data.dailyBiasPnl} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No closed trades on days with Daily Bias.
              </p>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      id: "report-widget-daily-completion-pnl",
      label: "Daily P&L vs Routines",
      size: "medium" as const,
      layoutGroup: "analysis-0",
      content: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Daily P&amp;L vs Routines</CardTitle>
          </CardHeader>
          <CardContent>
            {data.dailyCompletionPnl.length ? (
              <DailyCompletionPnl data={data.dailyCompletionPnl} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No data available
                <br />
                <span className="text-xs">Not enough data to display this chart.</span>
              </p>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      id: "report-widget-cut-reasons",
      label: "By reasons for cutting the trade",
      size: "medium" as const,
      layoutGroup: "analysis-0",
      content: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>By reasons for cutting the trade</CardTitle>
          </CardHeader>
          <CardContent>
            {data.overviewAnalysis.cutReasons.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No cut reasons recorded.
              </p>
            ) : (
              <>
                <StandardTable>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reason</TableHead>
                      <TableHead className={tableHead}>Trades</TableHead>
                      <TableHead className={tableHead}>SL hit</TableHead>
                      <TableHead className={tableHead}>TP hit</TableHead>
                      <TableHead className={tableHead}>Cut justified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged("cut-reasons", data.overviewAnalysis.cutReasons).map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.key}</TableCell>
                        <TableCell className={numericCell}>{row.trades}</TableCell>
                        <TableCell className={numericCell}>{row.slHits}</TableCell>
                        <TableCell className={numericCell}>{row.tpHits}</TableCell>
                        <TableCell className={numericCell}>
                          {fmtPercent(row.cutJustified, 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </StandardTable>
                <PageControl
                  page={pageFor("cut-reasons")}
                  total={data.overviewAnalysis.cutReasons.length}
                  onChange={(page) => setPage("cut-reasons", page)}
                />
              </>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      id: "report-widget-possible-r",
      label: "By total possible R",
      size: "medium" as const,
      layoutGroup: "analysis-0",
      content: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>By total possible R</CardTitle>
          </CardHeader>
          <CardContent>
            {data.overviewAnalysis.possibleR.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No winning trades recorded.
              </p>
            ) : (
              <>
                <StandardTable>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strategy</TableHead>
                      <TableHead className={tableHead}>Winning trades</TableHead>
                      <TableHead className={tableHead}>Higher R possible</TableHead>
                      <TableHead className={tableHead}>Avg. extra R</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged("possible-r", data.overviewAnalysis.possibleR).map((row) => (
                      <TableRow key={row.playbookId}>
                        <TableCell className="font-medium">
                          {label("playbook", row.playbookId)}
                        </TableCell>
                        <TableCell className={numericCell}>{row.winningTrades}</TableCell>
                        <TableCell className={numericCell}>
                          {fmtPercent(row.higherRRate, 0)}
                        </TableCell>
                        <TableCell className={numericCell}>
                          {row.avgExtraR == null
                            ? "-"
                            : `${row.avgExtraR >= 0 ? "+" : ""}${row.avgExtraR.toFixed(2)}R`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </StandardTable>
                <PageControl
                  page={pageFor("possible-r")}
                  total={data.overviewAnalysis.possibleR.length}
                  onChange={(page) => setPage("possible-r", page)}
                />
              </>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      id: "report-widget-patterns",
      label: "By pattern during trade",
      size: "medium" as const,
      layoutGroup: "analysis-1",
      content: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>By pattern during trade</CardTitle>
          </CardHeader>
          <CardContent>
            {data.overviewAnalysis.patterns.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No patterns recorded.
              </p>
            ) : (
              <>
                <StandardTable>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pattern</TableHead>
                      <TableHead className={tableHead}>Trades</TableHead>
                      <TableHead className={tableHead}>Win %</TableHead>
                      <TableHead className={tableHead}>Net P&amp;L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged("patterns", data.overviewAnalysis.patterns).map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.key}</TableCell>
                        <TableCell className={numericCell}>{row.trades}</TableCell>
                        <TableCell className={numericCell}>{fmtPercent(row.winRate, 0)}</TableCell>
                        <TableCell className={`${numericCell} ${pnlClass(row.netPnl)}`}>
                          <MonetaryValue>{fmtMoney(row.netPnl, currency)}</MonetaryValue>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </StandardTable>
                <PageControl
                  page={pageFor("patterns")}
                  total={data.overviewAnalysis.patterns.length}
                  onChange={(page) => setPage("patterns", page)}
                />
              </>
            )}
          </CardContent>
        </Card>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DashboardLayout
        widgets={widgets}
        layoutMode="two-column-last-full"
        storageKey={REPORT_OVERVIEW_LAYOUT_KEY}
        serverPreferenceKey="reportOverviewLayout"
        customizerTitle="Overview cards"
        customizeTarget={customizeTarget}
        showSavedLayouts={false}
        className="space-y-3"
      />
    </div>
  );
}
