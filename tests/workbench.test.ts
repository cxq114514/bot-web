import test from "node:test";
import assert from "node:assert/strict";
import { analyzeResponse } from "../lib/analyze-response";
import { extractPage, validateConfig } from "../lib/extract";
import { extractJson } from "../lib/extract-json";
import { crawl } from "../lib/crawler";
import { allowedBrowserRequest } from "../lib/browser-render";
import { defaultFilters, selectRows } from "../lib/result-view";
import { bookConfig, initialConfig, type CrawlEvent } from "../lib/types";
import { defaultApi, jsonConfig } from "../lib/presets";
import { persistentConfig, isConfig } from "../lib/profiles";
import { POST } from "../app/api/crawl/route";
import { consentHeader, DISCLAIMER_VERSION } from "../lib/consent";

const response = (
  body: string,
  type = "text/html",
  url = "https://example.com/list",
) => ({
  url,
  status: 200,
  headers: { "content-type": type },
  body: Buffer.from(body),
});
const html =
  '<html><body><article class="product"><h2>A</h2><a href="/a">A</a><span class="price">10</span></article><article class="product"><h2>B</h2><a href="/b">B</a><span class="price">20</span></article><a rel="next" href="?page=2">Next</a></body></html>';

test("analysis discovers HTML lists, table columns and usable JSON nested fields", () => {
  const suggestion = analyzeResponse(response(html));
  assert.equal(suggestion.rowSelector, "article.product");
  assert.equal(suggestion.nextSelector, 'a[rel="next"]');
  const config = validateConfig({
    ...initialConfig,
    ...suggestion,
    url: "https://example.com",
  });
  assert.deepEqual(
    extractPage(html, config, config.url).rows.map((row) => row.标题),
    ["A", "B"],
  );
  const table =
    "<table><thead><tr><th>姓名</th><th>分数</th></tr></thead><tbody><tr><td>A</td><td>0</td></tr><tr><td>B</td><td>10</td></tr></tbody></table>";
  const tab = analyzeResponse(response(table));
  assert.deepEqual(
    tab.fields.map((f) => f.name),
    ["姓名", "分数"],
  );
  assert.equal(
    extractPage(table, { ...initialConfig, ...tab }, "https://example.com").rows
      .length,
    2,
  );
  const repeatedHeaders = analyzeResponse(
    response(table.replace("姓名", "分数")),
  );
  assert.equal(
    new Set(repeatedHeaders.fields.map((f) => f.name)).size,
    repeatedHeaders.fields.length,
  );
  const body = JSON.stringify({
    metadata: [1, 2],
    data: {
      items: [
        { id: 0, author: { name: "A" }, enabled: false },
        { id: 2, author: { name: "B" } },
      ],
    },
  });
  const json = analyzeResponse(response(body, "application/json"));
  assert.equal(json.rowSelector, "data.items");
  const jConfig = validateConfig({
    ...jsonConfig,
    ...json,
    api: defaultApi,
    url: "https://example.com",
  });
  const result = extractJson(Buffer.from(body), jConfig, jConfig.url);
  assert.equal(result.rows[0].id, "0");
  assert.equal(result.rows[0].enabled, "false");
  assert.equal(result.rows[1]["author.name"], "B");
  const root = analyzeResponse(response('[0,false,"x"]', "text/plain"));
  assert.equal(root.rowSelector, "$");
  assert.equal(root.fields[0].selector, "$");
  assert.throws(() => analyzeResponse(response("{broken", "application/json")));
  assert.throws(() => analyzeResponse(response("binary", "image/png")));
  const empty = analyzeResponse(response('{"data":[]}', "application/json"));
  assert.equal(empty.fields[0].selector, "$");
});

test("filter, dedupe and numeric sort preserve raw records and blank identifiers", () => {
  const rows = [
    { id: "2", title: "Alpha", _source: "a" },
    { id: "2", title: "Alpha", _source: "b" },
    { id: "10", title: "Beta", _source: "c" },
    { id: "", title: "Beta", _source: "d" },
    { id: "", title: "", _source: "e" },
  ];
  const snapshot = structuredClone(rows);
  let selected = selectRows(rows, ["id", "title"], {
    ...defaultFilters,
    dedupe: "__all__",
    sort: "id",
  });
  assert.equal(selected.removed, 1);
  assert.equal(selected.rows.length, 4);
  assert.deepEqual(
    selected.rows.slice(-2).map((row) => row.id),
    ["2", "10"],
  );
  selected = selectRows(rows, ["id", "title"], {
    ...defaultFilters,
    query: "ALPHA",
    column: "title",
    dedupe: "id",
  });
  assert.equal(selected.rows.length, 1);
  assert.equal(
    selectRows(rows, ["id", "title"], { ...defaultFilters, dedupe: "id" }).rows
      .length,
    4,
  );
  assert.equal(
    selectRows(rows, ["id", "title"], { ...defaultFilters, empty: "missing" })
      .rows.length,
    2,
  );
  assert.equal(
    selectRows(rows, ["id", "title"], {
      ...defaultFilters,
      column: "title",
      empty: "filled",
    }).rows.length,
    4,
  );
  assert.deepEqual(rows, snapshot);
});

test("probes enforce one page, report empty fields and auto-detect JSON", async () => {
  for (const operation of ["test", "analyze"] as const) {
    const events: CrawlEvent[] = [];
    let pages = 0;
    const result = await crawl(
      { ...bookConfig, maxPages: 10 },
      new AbortController().signal,
      (event) => events.push(event),
      {
        get: async (url, _signal, before) => {
          if (url.endsWith("robots.txt"))
            return { ...response("", "text/plain", url), status: 404 };
          await before?.(new URL(url));
          pages++;
          return operation === "analyze"
            ? response('{"data":[{"title":"A"}]}', "application/json", url)
            : response(
                '<article class="product_pod"><h3><a title="A"></a></h3></article>',
                "text/html",
                url,
              );
        },
        request: async () => {
          throw new Error("unexpected request");
        },
      },
      async () => {},
      { operation },
    );
    assert.equal(pages, 1);
    assert.equal(result.pages.length, 1);
    const event = events.find((event) => event.type === "probe");
    assert.ok(event && event.type === "probe");
    assert.equal(event.report.sampled, 1);
    if (operation === "analyze") {
      assert.equal(event.report.sourceType, "json");
      assert.equal(result.rows[0].title, "A");
    } else
      assert.equal(
        event.report.fields.find((f) => f.name === "价格")?.filled,
        0,
      );
  }
});

test("browser mode uses rendered DOM and preserves renderer warnings", async () => {
  let rendered = false;
  const result = await crawl(
    { ...bookConfig, renderMode: "browser" },
    new AbortController().signal,
    () => {},
    {
      get: async (url, _signal, before) => {
        if (url.endsWith("robots.txt"))
          return { ...response("", "text/plain", url), status: 404 };
        await before?.(new URL(url));
        return response("<html></html>", "text/html", url);
      },
      request: async () => {
        throw new Error("unexpected");
      },
    },
    async () => {},
    {
      render: async (initial, _config, _signal, before, warn) => {
        rendered = true;
        await before(new URL("https://cdn.example.com/app.js"));
        warn("resource warning");
        return {
          ...initial,
          body: Buffer.from(
            '<article class="product_pod"><h3><a title="Rendered"></a></h3></article>',
          ),
        };
      },
    },
  );
  assert.ok(rendered);
  assert.equal(result.rows[0].书名, "Rendered");
  assert.ok(result.warnings.includes("resource warning"));
});

test("render config and resource policies reject invalid settings and private destinations", () => {
  assert.throws(() => validateConfig({ ...bookConfig, renderWaitMs: 10001 }));
  assert.throws(() =>
    validateConfig({ ...bookConfig, waitSelector: "[broken" }),
  );
  assert.throws(() => validateConfig({ ...jsonConfig, renderMode: "browser" }));
  assert.equal(
    allowedBrowserRequest("https://example.com/app.js", "GET", "script"),
    true,
  );
  assert.equal(
    allowedBrowserRequest("https://example.com/api", "POST", "fetch"),
    false,
  );
  assert.equal(
    allowedBrowserRequest("https://example.com/a.png", "GET", "image"),
    false,
  );
  for (const url of [
    "http://127.0.0.1",
    "http://169.254.169.254",
    "file:///etc/passwd",
    "http://example.com:3000",
  ])
    assert.throws(() => allowedBrowserRequest(url, "GET", "fetch"));
  assert.ok(
    isConfig(
      persistentConfig({
        ...bookConfig,
        renderMode: "browser",
        renderWaitMs: 5000,
        waitSelector: ".product",
      }),
    ),
  );
});

test("all API operations require current disclaimer consent before network or body parsing", async () => {
  for (const operation of ["crawl", "test", "analyze"]) {
    for (const consent of ["", "old-version"]) {
      const result = await POST(
        new Request("http://localhost/api/crawl", {
          method: "POST",
          headers: { [consentHeader]: consent },
          body: JSON.stringify({ operation }),
        }),
      );
      assert.equal(result.status, 403);
      assert.match((await result.json()).error, /免责声明/);
    }
  }
  const crossSite = await POST(
    new Request("http://localhost/api/crawl", {
      method: "POST",
      headers: {
        [consentHeader]: DISCLAIMER_VERSION,
        origin: "https://attacker.example",
      },
      body: "{}",
    }),
  );
  assert.equal(crossSite.status, 403);
  const invalid = await POST(
    new Request("http://localhost/api/crawl", {
      method: "POST",
      headers: { [consentHeader]: DISCLAIMER_VERSION },
      body: '{"operation":"bad"}',
    }),
  );
  assert.equal(invalid.status, 400);
});
