import type { IntentStatus } from "../api";

export interface Toast {
  id: string;
  intentId: string | null;
  label: string;
  status: IntentStatus | "sending" | "error";
  error?: string;
}

const STATUS_TEXT: Record<Toast["status"], string> = {
  sending: "Sending",
  queued: "Queued",
  confirmed: "Confirmed",
  failed: "Failed",
  reverted: "Reverted",
  expired: "Expired",
  cancelled: "Cancelled",
  error: "Not sent",
};

const tone = (s: Toast["status"]) =>
  s === "confirmed" ? "ok" : s === "sending" || s === "queued" ? "pending" : "bad";

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${tone(t.status)}`}>
          <p className="toast-head">
            <span className="toast-status">{STATUS_TEXT[t.status]}</span>
            <span>{t.label}</span>
          </p>
          {t.error && <p className="toast-error">{t.error}</p>}
          {t.intentId && <p className="toast-id num">Intent {t.intentId}</p>}
          <button type="button" className="toast-x" aria-label={`Dismiss ${t.label}`} onClick={() => onDismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
