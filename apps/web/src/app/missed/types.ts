export const OUTCOMES = ["back_to_entry", "extended_to_2r"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type RuleCheck = { rule: string; followed: boolean | null };

export interface Missed {
  id: string;
  symbol: string;
  observedAt: string;
  createdAt: string;
  playbookId: string | null;
  outcome: Outcome | null;
  tradingViewUrl: string | null;
  notes: string;
  tags: string[];
  snapshotId: string | null;
  ruleReview: { followed: number; assessed: number; total: number };
  ruleChecks: RuleCheck[];
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  rules: string[];
}
