export interface RecentAddress {
  address: string;
  nickname: string;
}
export const RECENT_KEY = "paper-desk:recent-addresses:v2";
export function normaliseAddress(value: string): string | null {
  const clean = value.trim();
  return /^0x[0-9a-f]{40}$/i.test(clean) ? clean.toLowerCase() : null;
}
export function readRecent(storage: Pick<Storage, "getItem">): RecentAddress[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(data)) return [];
    const unique = new Map<string, RecentAddress>();
    for (const item of data) {
      const address = normaliseAddress(String(item?.address ?? ""));
      if (address && !unique.has(address))
        unique.set(address, {
          address,
          nickname:
            typeof item.nickname === "string" ? item.nickname.slice(0, 40) : "",
        });
    }
    return [...unique.values()].slice(0, 10);
  } catch {
    return [];
  }
}
export function rememberAddress(
  list: RecentAddress[],
  address: string,
  nickname?: string,
): RecentAddress[] {
  return [
    {
      address,
      nickname: (
        nickname ??
        list.find((x) => x.address === address)?.nickname ??
        ""
      )
        .trim()
        .slice(0, 40),
    },
    ...list.filter((x) => x.address !== address),
  ].slice(0, 10);
}
export function addressFromUrl(): string {
  return (
    normaliseAddress(
      new URLSearchParams(location.search).get("address") ?? "",
    ) ?? ""
  );
}
export function updateAddressUrl(address: string, replace = false): void {
  const url = new URL(location.href);
  if (address) url.searchParams.set("address", address);
  else url.searchParams.delete("address");
  history[replace ? "replaceState" : "pushState"]({}, "", url);
}
