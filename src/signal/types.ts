/**
 * ERL-100 (Excursion Restitution Ledger) types. Pure data only: no clock, network or DOM.
 * Specification: artifacts/papertrade-research.md §4–§6 (PAPER DESK v3 research).
 */
export type SignalSymbol = "BTC" | "ETH";
/** +1 evaluates the long side, -1 the short side (directional coordinates, §4.3). */
export type Side = 1 | -1;

export interface ErlCandle {
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
}

export interface ErlParams {
  ledgerBars: number;
  frontierBars: number;
  sweepMin: number;
  sweepMax: number;
  reclaimBuffer: number;
  confirmMin: number;
  stopPad: number;
  riskMin: number;
  riskMax: number;
  rangeMax: number;
  targetRiskMultiple: number;
  targetMin: number;
  targetMax: number;
  supportMin: number;
  obstacleMax: number;
  netRRMin: number;
  budgetMin: number;
  latencyReserve: number;
  maxHoldBars: number;
  cooldownBars: number;
  /** Timeframes (seconds) on which the 100× entry policy is enabled. */
  allowedEntryTf: readonly number[];
  /** Maximum entry drift from the reference close at the fill, fraction (2 bps). */
  maxFillDrift: number;
  /** Required gap between stop and bust on the safe side, fraction of fill (30 bps). */
  bustClearance: number;
  /** Approximate 100× bust distance used only when no actual bustPrice exists. */
  approxBust: number;
}

export interface CurveMode {
  a: number;
  z: number;
  k: number;
  exponent: number;
}

export interface PayoutProfile {
  /** Shown verbatim; never presented as a verified live quote. */
  label: string;
  verified: false;
  leverage: number;
  baseRate: number;
  rateMultiplier: number;
  referenceNotional: number;
  positionMultiplier: number;
  winFee: number;
  builderFee: number;
  standard: CurveMode;
  offHours: CurveMode;
}

/** A surviving rejected price interval in directional coordinates, with its recency weight. */
export interface WeightedInterval {
  lo: number;
  hi: number;
  w: number;
}

export interface FrozenLedger {
  /** Surviving lower rejection R- (support) in directional coordinates. */
  lower: WeightedInterval[];
  /** Surviving upper rejection R+ (overhead obstacle) in directional coordinates. */
  upper: WeightedInterval[];
}

export type GateCode =
  | "SWEEP_DEPTH"
  | "SWEEP_RECLAIM"
  | "SWEEP_RANGE"
  | "CONFIRM_RETOUCH"
  | "CONFIRM_PROGRESS"
  | "CONFIRM_RECLAIM"
  | "CONFIRM_RANGE"
  | "RISK_BOUNDS"
  | "SUPPORT"
  | "OBSTACLE"
  | "NET_RR"
  | "BUDGET"
  | "NONFINITE";

export interface SideEval {
  side: Side;
  /** Raw-price frontier (min directional close of the 12 bars before the sweep). */
  frontier: number;
  penetration: number;
  /** Null when an event gate failed before the economics were computed. */
  J: number | null;
  A: number | null;
  r: number | null;
  targetFrac: number | null;
  W: number | null;
  R: number | null;
  netRR: number | null;
  score: number | null;
  rawStop: number | null;
  rawTarget: number | null;
  failed: GateCode[];
  passed: boolean;
}

export type BarSignal = "LONG" | "SHORT" | "AMBIGUOUS" | "NONE" | "INVALID";

export interface ErlBar {
  index: number;
  t: number;
  /** Bar close time; a signal on this bar confirms here (t + Δ). */
  confirmedAt: number;
  /** False during the 25-bar segment warm-up; no evaluation is made. */
  eligible: boolean;
  long: SideEval | null;
  short: SideEval | null;
  signal: BarSignal;
}

export interface ErlCandidate {
  index: number;
  t: number;
  side: Side;
  confirmedAt: number;
  earliestFillAt: number;
  /** Reference entry expires at the end of the next bar (t + 2Δ). */
  expiresAt: number;
  entryRef: number;
  rawStop: number;
  rawTarget: number;
  frontier: number;
  sweepExtreme: number;
  r: number;
  targetFrac: number;
  J: number;
  A: number;
  W: number;
  R: number;
  netRR: number;
  score: number;
  ledger: FrozenLedger;
  /** False on timeframes where the 100× policy is disabled: geometry only. */
  entryAllowed: boolean;
}

export type DiagnosticCode =
  | "EMPTY"
  | "INVALID_ROW"
  | "DUPLICATE_TIME"
  | "OUT_OF_ORDER"
  | "OFF_GRID"
  | "GAP_SEGMENT"
  | "FORMING_EXCLUDED"
  | "INSUFFICIENT"
  | "BAD_PARAMS"
  | "TF_ENTRY_DISABLED";

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  index?: number;
}

export interface ErlResult {
  status: "OK" | "INVALID";
  /** Number of closed, usable bars (prefix of the input). */
  closedCount: number;
  bars: ErlBar[];
  candidates: ErlCandidate[];
  diagnostics: Diagnostic[];
}

export interface ErlOptions {
  symbol: SignalSymbol;
  timeframeSec: number;
  nowSec: number;
  params?: Partial<ErlParams>;
  payoutProfile?: PayoutProfile;
}
