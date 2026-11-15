"use client";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { fmtMoney } from "@/lib/utils";
import { ChartFrame } from "./chart-frame";
import { tooltipStyle, useVizTokens } from "./tokens";
import { usePrivacy } from "../privacy";

export interface DailyCompletionPnlDatum {
  date: string;
  progress: number;
  pnl: number;
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function DailyCompletionPnl({
  data,
  height = 250,
}: {
  data: DailyCompletionPnlDatum[];
  height?: number;
}) {
  const t = useVizTokens();
  const privateMode = usePrivacy();
  if (!t) return <div style={{ height }} />;
  const rows = [...data].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={t.gridline} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: t.inkMuted, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: t.baseline }}
            minTickGap={18}
          />
          <YAxis
            yAxisId="pnl"
            tick={{ fill: t.inkMuted, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => (privateMode ? "••••" : fmtMoney(v).replace(/\.00$/, ""))}
          />
          <YAxis
            yAxisId="progress"
            orientation="right"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tick={{ fill: t.inkMuted, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={38}
            tickFormatter={(v: number) => `${v}%`}
          />
          <ReferenceLine yAxisId="pnl" y={0} stroke={t.baseline} />
          <Tooltip
            contentStyle={tooltipStyle(t)}
            labelFormatter={(label) => shortDate(String(label))}
            formatter={(value, name) => {
              if (name === "Routine completion") return [`${Math.round(Number(value))}%`, name];
              return [privateMode ? "Hidden" : fmtMoney(Number(value)), "Daily P&L"];
            }}
          />
          <Bar
            yAxisId="pnl"
            dataKey="pnl"
            name="Daily P&L"
            fill={t.brand}
            opacity={0.8}
            maxBarSize={18}
            radius={[3, 3, 0, 0]}
          />
          <Line
            yAxisId="progress"
            dataKey="progress"
            name="Routine completion"
            type="monotone"
            stroke={t.profit}
            strokeWidth={2}
            dot={{ r: 2.5, fill: t.profit }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: t.brand }} />
          Daily P&amp;L
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: t.profit }} />
          Routine completion
        </span>
      </div>
    </ChartFrame>
  );
}
