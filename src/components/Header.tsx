import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  normaliseAddress,
  readRecent,
  RECENT_KEY,
  rememberAddress,
  type RecentAddress,
} from "../address";
import type { FeedStatus } from "../useAccount";
import { formatDateTime } from "../format";

interface Props {
  address: string;
  onLoad: (address: string) => void;
  status: FeedStatus;
  mock: boolean;
  asOf?: number | string;
}
export function Header({ address, onLoad, status, mock, asOf }: Props) {
  const [draft, setDraft] = useState(
    () => new URLSearchParams(location.search).get("address") ?? "",
  );
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<RecentAddress[]>(() => {
    try {
      return readRecent(localStorage);
    } catch {
      return [];
    }
  });
  const [nickname, setNickname] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const persist = (next: RecentAddress[]) => {
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setStorageNotice("");
    } catch {
      setStorageNotice(
        "Recent addresses are available for this visit only; browser storage is unavailable.",
      );
    }
  };
  useEffect(() => {
    const query = new URLSearchParams(location.search).get("address") ?? "";
    if (!address && query && !normaliseAddress(query)) {
      setDraft(query);
      setError(
        "Use 0x followed by exactly 40 hexadecimal characters (0–9, a–f).",
      );
    } else {
      setDraft(address);
      setError("");
    }
  }, [address]);
  useEffect(() => {
    if (!address) return;
    setRecent((prev) => {
      const next = rememberAddress(prev, address);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        setStorageNotice(
          "Recent addresses are available for this visit only; browser storage is unavailable.",
        );
      }
      return next;
    });
  }, [address]);
  useEffect(() => {
    setNickname(recent.find((x) => x.address === address)?.nickname ?? "");
  }, [recent, address]);
  const load = (e: FormEvent) => {
    e.preventDefault();
    const normal = normaliseAddress(draft);
    if (!normal) {
      setError(
        "Use 0x followed by exactly 40 hexadecimal characters (0–9, a–f).",
      );
      inputRef.current?.focus();
      return;
    }
    setError("");
    setDraft(normal);
    onLoad(normal);
    persist(rememberAddress(recent, normal));
  };
  const clear = () => {
    setDraft("");
    setError("");
    onLoad("");
    inputRef.current?.focus();
  };
  return (
    <header className="header">
      <div className="topbar">
        <a className="brand" href="./" aria-label="PAPER DESK home">
          <img src="./favicon.svg" alt="" width="22" height="22" />
          <h1>PAPER DESK</h1>
        </a>
        <p className="product-label">
          Papertrade account viewer <span className="readonly">Read only</span>
        </p>
        <div className="connection">
          <span className="badge">HyperEVM</span>
          {mock && <span className="badge badge-mock">MOCK DATA</span>}
          <span className={`conn conn-${status.toLowerCase()}`} role="status">
            <span className="conn-dot" aria-hidden="true" />
            {status}
          </span>
        </div>
      </div>
      <form
        className="addressbar"
        onSubmit={load}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            clear();
          }
        }}
      >
        <label htmlFor="account-address">Public address</label>
        <div className="address-controls">
          <input
            ref={inputRef}
            id="account-address"
            name="address"
            className="input address-input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Paste a public 0x address"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError("");
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "address-error" : "address-hint"}
          />
          <button className="btn btn-primary" type="submit">
            Load account <span aria-hidden="true">↵</span>
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={clear}
            disabled={!draft && !address}
          >
            Clear
          </button>
        </div>
        <div className="address-tools">
          <label className="sr-only" htmlFor="recent-addresses">
            Recent addresses
          </label>
          <select
            id="recent-addresses"
            className="input recent-select"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                onLoad(e.target.value);
                setDraft(e.target.value);
                persist(rememberAddress(recent, e.target.value));
              }
            }}
          >
            <option value="">Recent addresses ({recent.length})</option>
            {recent.map((r) => (
              <option key={r.address} value={r.address}>
                {r.nickname ? `${r.nickname} · ` : ""}
                {r.address}
              </option>
            ))}
          </select>
          {address && (
            <details className="nickname-editor">
              <summary>Name address</summary>
              <div className="nickname-content">
                <label htmlFor="nickname">Nickname (optional)</label>
                <input
                  className="input"
                  id="nickname"
                  value={nickname}
                  maxLength={40}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Research desk"
                />
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    persist(rememberAddress(recent, address, nickname));
                    document
                      .querySelector<HTMLDetailsElement>(".nickname-editor")
                      ?.removeAttribute("open");
                  }}
                >
                  Save nickname
                </button>
              </div>
            </details>
          )}
        </div>
        <p id="address-hint" className="address-hint">
          Enter to load · Esc to clear. Any public account, no connection
          needed.
        </p>
        <p className="error address-error" id="address-error" role="alert">
          {error}
        </p>
        {storageNotice && (
          <p className="hint storage-notice" role="status">
            {storageNotice}
          </p>
        )}
      </form>
      {address && (
        <div className="account-identity">
          <p>
            <span className="ro-k">Viewing</span>{" "}
            {recent.find((r) => r.address === address)?.nickname && (
              <strong>
                {recent.find((r) => r.address === address)?.nickname} ·{" "}
              </strong>
            )}
            <span className="full-address">{address}</span>
          </p>
          <p className="hint">
            {asOf
              ? `As of ${formatDateTime(asOf)} UTC`
              : "Loading account snapshot…"}
          </p>
        </div>
      )}
    </header>
  );
}
