// Number and time formatting. Every money value leaves here as a fixed-decimal string built from
// toFixed plus digit grouping, never from locale compact notation or floating exponent output.

const MISSING = "--";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Group the integer part of a non-negative fixed-decimal string with commas. */
function group(fixed: string): string {
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/** toFixed that never falls back to exponent notation (toFixed does above 1e21). */
function toFixedSafe(abs: number, decimals: number): string {
  if (abs < 1e21) return abs.toFixed(decimals);
  const int = BigInt(Math.round(abs)).toString();
  return decimals > 0 ? `${int}.${"0".repeat(decimals)}` : int;
}

/** Decimals that keep `sig` significant digits for values under 1 (sub-penny prices). */
function subUnitDecimals(abs: number, sig: number): number {
  if (abs === 0) return 2;
  const lead = Math.ceil(-Math.log10(abs)) - 1; // zeros after the decimal point before the first digit
  return Math.min(12, Math.max(2, lead + sig));
}

/** Price with decimals chosen by magnitude: 97,123.50 / 3,412.07 / 1.2345 / 0.00001234. */
export function formatPrice(n: number | null | undefined): string {
  if (!finite(n)) return MISSING;
  const abs = Math.abs(n);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : subUnitDecimals(abs, 4);
  const s = group(toFixedSafe(abs, decimals));
  return n < 0 ? `-${s}` : s;
}

/**
 * USD amount, two decimals, grouped: $1,234,567.89. A non-zero amount under one cent keeps
 * four significant digits ($0.004210) so it never prints as $0.00.
 */
export function formatUsd(
  n: number | null | undefined,
  opts: { sign?: boolean } = {},
): string {
  if (!finite(n)) return MISSING;
  const abs = Math.abs(n);
  const decimals = abs > 0 && abs < 0.01 ? subUnitDecimals(abs, 4) : 2;
  const body = `$${group(toFixedSafe(abs, decimals))}`;
  if (n < 0 && Number(toFixedSafe(abs, decimals)) !== 0) return `-${body}`;
  if (opts.sign && n > 0) return `+${body}`;
  return body;
}

/** Large USD amounts in fixed-decimal compact form: $12.35M, $1.20B, $845.10K. */
export function formatUsdCompact(n: number | null | undefined): string {
  if (!finite(n)) return MISSING;
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const s = `$${group((abs / size).toFixed(2))}${suffix}`;
      return n < 0 ? `-${s}` : s;
    }
  }
  return formatUsd(n);
}

/** Percent with two decimals and an explicit sign: +1.25% / -0.40% / 0.00%. */
export function formatPct(n: number | null | undefined): string {
  if (!finite(n)) return MISSING;
  const fixed = Math.abs(n).toFixed(2);
  if (Number(fixed) === 0) return "0.00%";
  return `${n > 0 ? "+" : "-"}${group(fixed)}%`;
}

export function formatLeverage(n: number | null | undefined): string {
  if (!finite(n)) return MISSING;
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}x`;
}

/** 0x1234…abcd */
export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return MISSING;
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Normalise unix seconds, unix milliseconds or an ISO string to milliseconds. */
export function toMs(t: number | string | null | undefined): number | null {
  if (t === null || t === undefined) return null;
  if (typeof t === "string") {
    if (/^\d+(\.\d+)?$/.test(t)) return toMs(Number(t));
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  if (!Number.isFinite(t)) return null;
  return t < 1e12 ? t * 1000 : t;
}

/** 2026-11-01 14:05 in UTC. */
export function formatDateTime(t: number | string | null | undefined): string {
  const ms = toMs(t);
  if (ms === null) return MISSING;
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
