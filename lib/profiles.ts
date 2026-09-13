import type { CrawlConfig } from "./types";

export type SiteProfile = {
  id: string;
  name: string;
  config: CrawlConfig;
  updatedAt: string;
};
export const profileStorageKey = "crawlspace-profiles-v2";
export const lastProfileStorageKey = "crawlspace-last-profile-id";

export function removeProfile(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  profiles: SiteProfile[],
  id: string,
): SiteProfile[] {
  const deleted = profiles.find((profile) => profile.id === id);
  const lastId = storage.getItem(lastProfileStorageKey);
  let removeLast = lastId === id;
  // Migrate older storage that has a config snapshot but no profile identity.
  if (!lastId && deleted) {
    try {
      const snapshot = JSON.parse(
        storage.getItem("crawlspace-rule-v1") ?? "null",
      );
      removeLast =
        isConfig(snapshot) &&
        JSON.stringify(persistentConfig(snapshot)) ===
          JSON.stringify(deleted.config);
    } catch {
      /* Leave an unrelated snapshot alone. */
    }
  }
  const next = profiles.filter((profile) => profile.id !== id);
  storage.setItem(profileStorageKey, JSON.stringify(next));
  if (removeLast) {
    storage.removeItem("crawlspace-rule-v1");
    storage.removeItem(lastProfileStorageKey);
  }
  return next;
}

export function isConfig(value: unknown): value is CrawlConfig {
  if (!value || typeof value !== "object") return false;
  const c = value as CrawlConfig;
  if (
    ![undefined, "static", "browser"].includes(c.renderMode) ||
    (c.renderWaitMs !== undefined &&
      (!Number.isInteger(c.renderWaitMs) ||
        c.renderWaitMs < 0 ||
        c.renderWaitMs > 10000)) ||
    (c.waitSelector !== undefined &&
      (typeof c.waitSelector !== "string" || c.waitSelector.length > 300))
  )
    return false;
  if (
    typeof c.url !== "string" ||
    c.url.length > 2048 ||
    typeof c.rowSelector !== "string" ||
    typeof c.nextSelector !== "string" ||
    !Number.isInteger(c.maxPages) ||
    c.maxPages < 1 ||
    c.maxPages > 10
  )
    return false;
  if (
    ![undefined, "html", "json"].includes(c.sourceType) ||
    !Array.isArray(c.fields) ||
    c.fields.length < 1 ||
    c.fields.length > 12
  )
    return false;
  if (
    !c.fields.every(
      (f) =>
        f &&
        [f.id, f.name, f.selector, f.attribute].every(
          (x) => typeof x === "string" && x.length <= 300,
        ),
    )
  )
    return false;
  if (c.sourceType === "json") {
    const a = c.api;
    if (
      !a ||
      !["GET", "POST"].includes(a.method) ||
      !a.headers ||
      typeof a.headers !== "object" ||
      Array.isArray(a.headers) ||
      !Object.values(a.headers).every((v) => typeof v === "string") ||
      typeof a.body !== "string" ||
      typeof a.pageParam !== "string" ||
      !Number.isInteger(a.startPage) ||
      a.startPage < 0 ||
      a.startPage > 10000
    )
      return false;
  }
  return true;
}

export function persistentConfig(config: CrawlConfig): CrawlConfig {
  const safe = structuredClone(config);
  // Request credentials/body and API query parameters are never written to browser storage.
  if (safe.api) safe.api = { ...safe.api, headers: {}, body: "" };
  if (safe.sourceType === "json") {
    try {
      const url = new URL(safe.url);
      url.search = "";
      url.username = "";
      url.password = "";
      safe.url = url.href;
    } catch {
      safe.url = "";
    }
  }
  return safe;
}

export function readProfiles(storage: Pick<Storage, "getItem">): SiteProfile[] {
  try {
    const values: unknown = JSON.parse(
      storage.getItem(profileStorageKey) ?? "[]",
    );
    if (!Array.isArray(values)) return [];
    const ids = new Set<string>();
    return values
      .filter((p): p is SiteProfile => {
        if (
          !p ||
          typeof p.id !== "string" ||
          ids.has(p.id) ||
          typeof p.name !== "string" ||
          !p.name.trim() ||
          p.name.length > 50 ||
          typeof p.updatedAt !== "string" ||
          !isConfig(p.config)
        )
          return false;
        ids.add(p.id);
        return true;
      })
      .slice(0, 20)
      .map((p) => ({ ...p, config: persistentConfig(p.config) }));
  } catch {
    return [];
  }
}
