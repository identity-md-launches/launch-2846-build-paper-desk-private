// The leverage slider runs on a log scale so 1x..20x is not crushed into the first 2% of a
// 1..1000 track. Slider positions are integers 0..SLIDER_STEPS.

export const LEVERAGE_PRESETS = [10, 50, 100, 250, 500, 1000] as const;
export const SLIDER_STEPS = 1000;

export function sliderToLeverage(pos: number, max: number): number {
  const clamped = Math.min(SLIDER_STEPS, Math.max(0, pos));
  return Math.min(max, Math.max(1, Math.round(Math.exp((clamped / SLIDER_STEPS) * Math.log(max)))));
}

export function leverageToSlider(lev: number, max: number): number {
  if (max <= 1) return 0;
  const clamped = Math.min(max, Math.max(1, lev));
  return Math.round((Math.log(clamped) / Math.log(max)) * SLIDER_STEPS);
}

export interface TicketInput {
  marginUsd: number;
  leverage: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
}

export interface TicketLimits {
  available: number;
  maxMarginUsd: number;
  maxLeverage: number;
}

export type TicketErrors = Partial<Record<keyof TicketInput, string>>;

/** Field errors for the ticket, worded as the fix. Empty object when the order can be reviewed. */
export function validateTicket(input: TicketInput, limits: TicketLimits): TicketErrors {
  const e: TicketErrors = {};
  const { marginUsd, leverage, takeProfitPct, stopLossPct } = input;
  if (!Number.isFinite(marginUsd) || marginUsd <= 0) e.marginUsd = "Enter a margin above $0.";
  else if (marginUsd > limits.maxMarginUsd) e.marginUsd = `Enter at most $${limits.maxMarginUsd.toFixed(2)}, the per-order limit.`;
  else if (marginUsd > limits.available) e.marginUsd = `Enter at most $${limits.available.toFixed(2)}, your available balance.`;
  if (!Number.isFinite(leverage) || leverage < 1) e.leverage = "Choose leverage of at least 1x.";
  else if (leverage > limits.maxLeverage) e.leverage = `Choose at most ${limits.maxLeverage}x for this market.`;
  if (takeProfitPct !== null && (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0)) {
    e.takeProfitPct = "Enter a take profit above 0%, or leave it empty.";
  }
  if (stopLossPct !== null) {
    if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) e.stopLossPct = "Enter a stop loss above 0%, or leave it empty.";
    else if (!e.leverage && stopLossPct >= 100 / leverage) {
      e.stopLossPct = `Enter less than ${(100 / leverage).toFixed(3)}%; at ${leverage}x the position busts first.`;
    }
  }
  return e;
}
