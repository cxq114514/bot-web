import { chromium } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";

const base = process.env.CRAWLSPACE_QA_URL || "http://127.0.0.1:3102";
const bundle = await build({
  stdin: {
    contents: 'import * as api from "./lib/history"; window.historyApi = api;',
    resolveDir: path.resolve("."),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const checked = await page.evaluate(async () => {
    const api = window.historyApi;
    const make = (i) => ({
      id: String(i),
      createdAt: new Date(1700000000000 + i * 1000).toISOString(),
      status: "done",
      operation: "crawl",
      error: "",
      config: {
        sourceType: "json",
        url: "https://example.com/items?api_key=SECRET",
        rowSelector: "$",
        nextSelector: "",
        maxPages: 1,
        api: {
          method: "POST",
          body: '{"secret":"SECRET"}',
          headers: { Authorization: "SECRET" },
          pageParam: "",
          startPage: 1,
        },
        fields: [{ id: "value", name: "值", selector: "$", attribute: "text" }],
      },
      result: {
        rows: [{ 值: "0" }],
        fields: ["值"],
        pages: [],
        warnings: [],
        duration: 1,
        completedAt: new Date().toISOString(),
      },
    });
    await Promise.all(
      Array.from({ length: 23 }, (_, i) => api.saveHistory(make(i))),
    );
    const list = await api.listHistory();
    const entry = await api.readHistory("22");
    const old = await api.readHistory("0");
    const redacted = !JSON.stringify(entry).includes("SECRET");
    const primitive = entry.result.rows[0].值;
    // A synchronous storage failure must abort both stores, including an already queued metadata write.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "results")
        throw new DOMException(
          "Simulated storage failure",
          "QuotaExceededError",
        );
      return put.apply(this, args);
    };
    let rejected = false;
    try {
      await api.saveHistory(make(99));
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const orphan = (await api.listHistory()).some((item) => item.id === "99");
    await api.deleteHistory();
    for (let i = 0; i < 6; i++) await api.saveHistory(make(i));
    // Simulate existing 10 MB entries without allocating 60 MB on the QA machine.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("crawlspace-history-v1", 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("runs", "readwrite");
        const store = tx.objectStore("runs");
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item) {
            item.update({ ...item.value, bytes: 10 * 1024 * 1024 });
            item.continue();
          }
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    await api.saveHistory(make(7));
    const capped = await api.listHistory();
    const bytes = capped.reduce((sum, item) => sum + item.bytes, 0);
    await api.deleteHistory("7");
    const deleted = await api.readHistory("7");
    await api.deleteHistory();
    return {
      count: list.length,
      ids: list.map((item) => item.id),
      redacted,
      primitive,
      noOld: !old,
      rejected,
      orphan,
      capped: capped.length,
      bytes,
      deleted: !deleted,
      empty: (await api.listHistory()).length,
    };
  });
  assert.equal(checked.count, 20);
  assert.equal(checked.ids[0], "22");
  assert.equal(checked.ids.at(-1), "3");
  assert.ok(checked.redacted);
  assert.equal(checked.primitive, "0");
  assert.ok(checked.noOld);
  assert.ok(checked.rejected);
  assert.equal(checked.orphan, false);
  assert.equal(checked.capped, 5);
  assert.ok(checked.bytes <= 50 * 1024 * 1024);
  assert.ok(checked.deleted);
  assert.equal(checked.empty, 0);
  console.log(
    "PASS: IndexedDB atomic writes, concurrent 20-entry retention, 50 MB budget, credential redaction, failure rollback, deletion",
  );
} finally {
  await browser.close();
}
