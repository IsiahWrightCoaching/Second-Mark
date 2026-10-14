/**
 * Core types for the analysis engine.
 *
 * The engine is pure: no database, no browser, no React. Every screen and every
 * test calls the same functions, so the numbers can never disagree.
 * Rules and thresholds are documented in the project doc second-mark-logic-spec.md.
 */

export type Exit = 'as_planned' | 'closed_early' | 'held_loser';
export type Direction = 'long' | 'short';
export type AccountType = 'challenge' | 'funded' | 'demo';
export type DrawdownMode = 'static' | 'trailing';
export type DrawdownBasis = 'balance' | 'equity';
export type Fuel = 'both' | 'water_only' | 'food_only' | 'neither';
export type Carrying = 'nothing' | 'money' | 'home' | 'work' | 'health' | 'other';
export type StrategyKind = 'rules' | 'discretionary';

export interface Strategy {
  id: string;
  name: string;
  kind: StrategyKind;
  version: number;
  checklist: string[];
  instruments: string[];
  defaultRiskPct: number;
  maxPerDay: number | null;
}

export interface Account {
  id: string;
  type: AccountType;
  firm: string;
  size: number;
  /** Profit targets per phase, in % of size. Empty for funded and demo. */
  targets: number[];
  maxDrawdownPct: number;
  dailyLossPct: number;
  ddBasis: DrawdownBasis;
  ddMode: DrawdownMode;
  fee: number;
  strategyIds: string[];
  archived: boolean;
  /** Set when a passed challenge has moved on to a funded account. */
  closedAs: 'funded' | null;
  manualFail: boolean;
  /** Timestamps (ms) of phases marked passed by hand. */
  manualPasses: number[];
}

export interface Trade {
  id: string;
  accountId: string;
  strategyId: string;
  strategyVersion: number;
  /** Entry time, ms since epoch (UTC). */
  entryAt: number;
  instrument: string;
  direction: Direction;
  planned: boolean;
  /** Reason given for an impulsive trade, empty when planned. */
  impulseReason: string;
  rulesMet: boolean;
  /** Names of checklist rules not met (rules-based strategies). Stored by name, not index. */
  missedRules: string[];
  /** Discretionary only: self-graded A, B or C setup. */
  grade: 'A' | 'B' | 'C' | null;
  exit: Exit;
  riskPct: number;
  defaultRiskPct: number;
  /** Derived from entry order within the day. Use relimit() after any change. */
  overLimit: boolean;
  /** Result in R: usd / (account size x default risk %). */
  r: number;
  usd: number;
  /** State from that day's check-in; null when no check-in was saved. */
  sleepHours: number | null;
  usualSchedule: boolean | null;
  carrying: Carrying | null;
  fuel: Fuel | null;
  sharpness: number | null;
  /** Challenge was still down on its fee when this trade was taken. */
  belowFee: boolean;
  /** The previous trade on this account was a loss. */
  afterLoss: boolean;
}

export type NoTradeReason =
  | 'no_setup'
  | 'not_right_state'
  | 'news_day'
  | 'fear'
  | 'stopped_at_limit'
  | 'rest_day'
  | 'no_time'
  | 'market_closed'
  | 'other';

export interface NoTradeDay {
  accountId: string;
  at: number;
  reason: NoTradeReason;
}

export interface SkippedSetup {
  accountId: string;
  at: number;
  reason: 'fear' | 'away' | 'too_late';
}

export interface DayRating {
  accountId: string;
  dayKey: string;
  rating: 'A' | 'B' | 'C';
}
