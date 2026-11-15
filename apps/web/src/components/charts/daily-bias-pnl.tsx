"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/utils";
import { ChartFrame } from "./chart-frame";
import { tooltipStyle, useVizTokens } from "./tokens";
import { usePrivacy } from "../privacy";

export interface DailyBiasPnlDatum {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
}

export function DailyBiasPnl({
  data,
  height = 250,
}: {
  data: DailyBiasPnlDatum[];
  height?: number;
}) {
  const t = useVizTokens();
  const privateMode = usePrivacy();
  if (!t) return <div style={{ height }} />;

  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          barCategoryGap="18%"
        >
          <CartesianGrid stroke={t.gridline} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: t.inkMuted, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: t.baseline }}
            minTickGap={42}
          />
          <YAxis
            tick={{ fill: t.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={70}
            tickFormatter={(value: number) =>
              privateMode ? "••••" : fmtMoney(value).replace(".00", "")
            }
          />
          <ReferenceLine y={0} stroke={t.baseline} />
          <Tooltip
            contentStyle={tooltipStyle(t)}
            labelFormatter={(label) => String(label)}
            formatter={(value) => [privateMode ? "Hidden" : fmtMoney(Number(value)), "Net P&L"]}
          />
          <Bar dataKey="pnl" name="Net P&L" isAnimationActive={false} maxBarSize={24}>
            {data.map((entry) => (
              <Cell
                key={entry.date}
                fill={entry.pnl >= 0 ? t.profitFill : t.loss}
                radius={(entry.pnl >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]) as unknown as number}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
