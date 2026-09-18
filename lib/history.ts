import { persistentConfig } from "./profiles";
import type {
  CrawlConfig,
  CrawlOperation,
  CrawlResult,
  ProbeReport,
} from "./types";

export type HistorySummary = {
  id: string;
  createdAt: string;
  config: CrawlConfig;
  status: "done" | "error" | "stopped";
  operation: CrawlOperation;
  count: number;
  bytes: number;
  error: string;
};
export type HistoryEntry = HistorySummary & {
  result: CrawlResult;
  report?: ProbeReport;
};
const DB_NAME = "crawlspace-history-v1";
export const MAX_HISTORY = 20;
export const MAX_HISTORY_BYTES = 50 * 1024 * 1024;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("runs", { keyPath: "id" });
      request.result.createObjectStore("results", { keyPath: "id" });
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("历史数据库被其他页面占用"));
    };
  });
}

export async function listHistory(): Promise<HistorySummary[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("runs").objectStore("runs").getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as HistorySummary[]).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
        );
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function readHistory(
  id: string,
): Promise<HistoryEntry | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["runs", "results"]);
      const summary = tx.objectStore("runs").get(id);
      const data = tx.objectStore("results").get(id);
      tx.oncomplete = () =>
        resolve(
          summary.result && data.result
            ? { ...summary.result, ...data.result }
            : undefined,
        );
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveHistory(
  entry: Omit<HistoryEntry, "bytes" | "count">,
) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["runs", "results"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("历史保存失败"));
      tx.onerror = () => reject(tx.error);
      try {
        const runs = tx.objectStore("runs");
        const results = tx.objectStore("results");
        const { result, report, ...meta } = entry;
        const bytes = new Blob([
          JSON.stringify(result),
          JSON.stringify(report ?? {}),
        ]).size;
        const safe: HistorySummary = {
          ...meta,
          config: persistentConfig(entry.config),
          count: result.rows.length,
          bytes,
        };
        if (report?.sourceType === "json") {
          const url = new URL(safe.config.url);
          url.search = "";
          url.username = "";
          url.password = "";
          safe.config.url = url.href;
        }
        runs.put(safe);
        results.put({ id: entry.id, result, report });
        const all = runs.getAll();
        all.onsuccess = () => {
          let total = 0;
          const ordered = (all.result as HistorySummary[]).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          );
          ordered.forEach((item, index) => {
            total += item.bytes;
            if (index >= MAX_HISTORY || total > MAX_HISTORY_BYTES) {
              runs.delete(item.id);
              results.delete(item.id);
            }
          });
        };
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}

export async function deleteHistory(id?: string) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["runs", "results"], "readwrite");
      for (const name of ["runs", "results"]) {
        const store = tx.objectStore(name);
        if (id) store.delete(id);
        else store.clear();
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
