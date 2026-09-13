import test from "node:test";
import assert from "node:assert/strict";
import { validateApi } from "../lib/api-config";
import { extractJson } from "../lib/extract-json";
import { extractPage, validateConfig } from "../lib/extract";
import { readPath, pathTokens } from "../lib/json-path";
import {
  defaultApi,
  jsonConfig,
  matchPreset,
  quoteConfig,
} from "../lib/presets";
import { isConfig, persistentConfig, readProfiles } from "../lib/profiles";
import {
  redirectTarget,
  type RequestOptions,
  type ResponseData,
} from "../lib/safe-fetch";
import { crawl } from "../lib/crawler";
import type { CrawlConfig, CrawlEvent } from "../lib/types";

test("matches sites by exact hostname and extracts a second HTML site", () => {
  assert.equal(
    matchPreset("https://quotes.toscrape.com/page/2/")?.id,
    "quotes",
  );
  assert.equal(
    matchPreset("https://books.toscrape.com.evil.example/")?.id,
    undefined,
  );
  const page = extractPage(
    '<div class="quote"><span class="text">Example quote</span><small class="author">Example author</small><div class="tags"><a class="tag">one</a><a class="tag">two</a></div></div><ul class="pager"><li class="next"><a href="/page/2/">Next</a></li></ul>',
    quoteConfig,
    quoteConfig.url,
  );
  assert.equal(page.rows[0]["作者"], "Example author");
  assert.equal(page.rows[0]["标签"], "one\ntwo");
  assert.equal(page.nextUrl, "https://quotes.toscrape.com/page/2/");
});

test("JSON paths preserve scalar values and never traverse prototypes or evaluate expressions", () => {
  assert.equal(
    readPath({ data: [{ value: false }] }, "$.data[0].value"),
    false,
  );
  assert.equal(readPath({ data: [{ count: 0 }] }, "data[0].count"), 0);
  assert.equal(
    readPath(Object.create({ inherited: 1 }), "inherited"),
    undefined,
  );
  for (const path of [
    "$bad",
    "$.items[*]",
    "__proto__.x",
    "a.constructor",
    "$..password",
    "items[?(@.id)]",
    "a[alert(1)]",
  ])
    assert.throws(() => pathTokens(path), path);
});

test("extracts JSON root arrays, nested arrays, missing values and objects", () => {
  const config: CrawlConfig = {
    ...jsonConfig,
    rowSelector: "$.data.items",
    fields: [
      { id: "id", name: "id", selector: "id", attribute: "text" },
      {
        id: "author",
        name: "author",
        selector: "author.name",
        attribute: "text",
      },
      { id: "active", name: "active", selector: "active", attribute: "text" },
    ],
  };
  const result = extractJson(
    Buffer.from(
      JSON.stringify({
        data: {
          items: [
            { id: 0, author: { name: "测试" }, active: false },
            { id: 1 },
          ],
        },
      }),
    ),
    config,
    "https://api.example.com/items",
  );
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].id, "0");
  assert.equal(result.rows[0].active, "false");
  assert.equal(result.rows[0].author, "测试");
  assert.equal(result.rows[1].author, "");
  assert.equal(
    extractJson(
      Buffer.from("[]"),
      { ...config, rowSelector: "$" },
      "https://example.com",
    ).rows.length,
    0,
  );
  assert.throws(() =>
    extractJson(
      Buffer.from("<html>oops</html>"),
      config,
      "https://example.com",
    ),
  );
});

test("validates API headers, JSON request bodies, source types and pagination before fetching", () => {
  const valid = validateConfig({
    ...jsonConfig,
    url: "https://example.com/api",
    api: {
      ...defaultApi,
      method: "POST",
      body: '{"query":"x"}',
      headers: { Authorization: "Bearer test-only" },
    },
  });
  assert.equal(valid.api?.headers.authorization, "Bearer test-only");
  for (const headers of [
    { Host: "localhost" },
    { "Content-Length": "999" },
    { "X-Forwarded-For": "127.0.0.1" },
    { Cookie: "a=b" },
    { Authorization: "bad\r\nInjected: true" },
    { Accept: "x", accept: "y" },
  ])
    assert.throws(() => validateApi({ ...defaultApi, headers }));
  assert.throws(() => validateApi({ ...defaultApi, method: "DELETE" }));
  assert.throws(() =>
    validateApi({ ...defaultApi, method: "POST", body: "not json" }),
  );
  assert.throws(() => validateApi({ ...defaultApi, body: '{"x":1}' }));
  assert.throws(() => validateConfig({ ...jsonConfig, sourceType: "unknown" }));
  assert.throws(() => validateConfig({ ...jsonConfig, maxPages: 2 }));
  assert.throws(() =>
    validateConfig({ ...jsonConfig, rowSelector: "data[*]" }),
  );
});

test("custom API redirects cannot leak credentials to another origin or replay POST", () => {
  const current = new URL("https://api.example.com/a");
  assert.equal(
    redirectTarget(current, "/b", current.origin, { sameOrigin: true }).href,
    "https://api.example.com/b",
  );
  assert.throws(() =>
    redirectTarget(current, "https://other.example.com", current.origin, {
      sameOrigin: true,
    }),
  );
  assert.throws(() =>
    redirectTarget(current, "/b", current.origin, { method: "POST" }),
  );
  assert.throws(() =>
    redirectTarget(current, "http://127.0.0.1", current.origin, {}),
  );
});

test("saved profiles redact all API request credentials/body/query values and tolerate bad storage", () => {
  const config: CrawlConfig = {
    ...jsonConfig,
    url: "https://example.com/api?access_token=secret&page=2",
    api: {
      ...defaultApi,
      headers: { Authorization: "Bearer secret" },
      body: '{"secret":"value"}',
    },
  };
  const saved = persistentConfig(config);
  assert.deepEqual(saved.api?.headers, {});
  assert.equal(saved.api?.body, "");
  assert.equal(saved.url, "https://example.com/api");
  assert.match(config.url, /secret/);
  assert.equal(isConfig({ ...jsonConfig, api: null }), false);
  assert.deepEqual(readProfiles({ getItem: () => "corrupt" }), []);
  const profiles = readProfiles({
    getItem: () =>
      JSON.stringify([
        { id: "one", name: "API", config, updatedAt: "2026-09-12" },
        { id: "bad", config: {} },
      ]),
  });
  assert.equal(profiles.length, 1);
  assert.equal(JSON.stringify(profiles).includes("secret"), false);
});

function response(
  url: string,
  body: unknown,
  status = 200,
  type = "application/json",
): ResponseData {
  return {
    url,
    status,
    headers: { "content-type": type },
    body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

test("API orchestration respects robots, forwards POST only to the endpoint, paginates from zero, and redacts output URLs", async () => {
  const calls: { url: string; options?: RequestOptions }[] = [];
  const events: CrawlEvent[] = [];
  const config = validateConfig({
    ...jsonConfig,
    url: "https://api.example.com/items?token=not-a-real-secret",
    rowSelector: "data.items",
    maxPages: 3,
    api: {
      ...defaultApi,
      method: "POST",
      headers: { authorization: "Bearer test-only" },
      body: '{"filter":"all"}',
      pageParam: "page",
      startPage: 0,
    },
  });
  const result = await crawl(
    config,
    new AbortController().signal,
    (event) => events.push(event),
    {
      get: async (url) => {
        calls.push({ url });
        return response(url, "User-agent: *\nAllow: /", 200, "text/plain");
      },
      request: async (url, _signal, options, before) => {
        await before?.(new URL(url));
        calls.push({ url, options });
        const page = Number(new URL(url).searchParams.get("page"));
        return response(url, {
          data: { items: page < 1 ? [{ id: 1, title: "Result" }] : [] },
        });
      },
    },
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.pages.length, 2);
  assert.deepEqual(
    calls
      .filter((call) => call.options)
      .map((call) => new URL(call.url).searchParams.get("page")),
    ["0", "1"],
  );
  assert.equal(calls[0].url, "https://api.example.com/robots.txt");
  assert.equal(calls[0].options, undefined);
  assert.equal(calls[1].options?.method, "POST");
  assert.equal(calls[1].options?.headers?.authorization, "Bearer test-only");
  assert.equal(calls[1].options?.body, '{"filter":"all"}');
  assert.equal(
    JSON.stringify({ result, events }).includes("not-a-real-secret"),
    false,
  );
  assert.equal(JSON.stringify({ result, events }).includes("test-only"), false);
});

test("robots denial and cancellation stop before an API request is sent", async () => {
  let sent = false;
  const config = validateConfig({
    ...jsonConfig,
    url: "https://api.example.com/private",
  });
  const network = {
    get: async (url: string) =>
      response(url, "User-agent: *\nDisallow: /", 200, "text/plain"),
    request: async (
      url: string,
      _signal: AbortSignal,
      _options?: RequestOptions,
      before?: (url: URL) => Promise<void>,
    ) => {
      await before?.(new URL(url));
      sent = true;
      return response(url, {});
    },
  };
  await assert.rejects(
    crawl(config, new AbortController().signal, () => {}, network),
    /robots/,
  );
  assert.equal(sent, false);
  const aborter = new AbortController();
  aborter.abort();
  await assert.rejects(crawl(config, aborter.signal, () => {}, network));
  assert.equal(sent, false);
});
