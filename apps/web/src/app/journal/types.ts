import type { DayStats, IntradayPoint } from "@traderjourney/core";
import type { ExcursionView } from "@/lib/excursions";

export interface RoutineRow {
  id: string;
  title: string;
  stage?: string;
  done?: boolean;
}
export interface JournalDay {
  date: string;
  stats: DayStats | null;
  hasNote: boolean;
  dailyBias: string[];
  accordingToDailyBias: number | null;
  hasScreenshots: boolean;
  sessionDurationMinutes: number | null;
  routine: { completed: number; total: number; score: number | null; remaining: RoutineRow[] };
}
export interface JournalListPayload {
  days: JournalDay[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    from: number;
    to: number;
  };
  summary: {
    consecutiveWinningDays: number;
    consecutiveLosingDays: number;
    accordingToDailyBias: number | null;
    routineCompletion: number | null;
  };
  strategies: { id: string; name: string }[];
  routines: { id: string; title: string }[];
  existingDates: string[];
  timeZone: string;
}
export interface TradeRow {
  excursion?: ExcursionView;
  key: string;
  symbol: string;
  direction: string;
  account: string;
  status: string;
  netPnl: number;
  grossPnl: number;
  fees: number;
  volume: number;
  avgEntry: number;
  avgExit: number | null;
  durationMs: number | null;
  netEntryNotional: number | null;
  plannedR: number | null;
  realizedR: number | null;
  totalPossibleR: number | null;
  closedAt: string | null;
  executionCount: number;
  hasSnapshot: boolean;
  tags: string[];
  rating: number | null;
  reviewed: boolean;
}
export interface DayPayload {
  date: string;
  exists: boolean;
  hasAutomaticData: boolean;
  metrics: any;
  startTime: string;
  endTime: string;
  sessionDurationMinutes: number | null;
  trades: TradeRow[];
  intraday: IntradayPoint[];
  note: string;
  dailyBiasPlaybooks: string[];
  playbooks: { id: string; name: string }[];
  accordingToDailyBias: number | null;
  dailyBiasStats: {
    matchedTrades: number;
    totalTrades: number;
    matchedPnl: number;
    notMatchedTrades: number;
    notMatchedPnl: number;
  } | null;
  routine: { completed: number; total: number; score: number | null; routines: RoutineRow[] };
  attachments: { id: string; name: string; mime: string; size: number }[];
}
