import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { extractPage } from "../lib/extract";
import { bookConfig, type CrawlEvent } from "../lib/types";
import { crawl } from "../lib/crawler";
import { createOriginScheduler } from "../lib/origin-scheduler";
import { readConfigBody } from "../lib/request-body";
import { POST } from "../app/api/crawl/route";
import { consentHeader, DISCLAIMER_VERSION } from "../lib/consent";
import {
  removeProfile,
  lastProfileStorageKey,
  profileStorageKey,
  persistentConfig,
  type SiteProfile,
} from "../lib/profiles";

test("base href resolves fields and pagination without changing the source URL", () => {
  const source = "https://example.com/index.html";
  const html =
    '<base href="/catalogue/"><base href="/ignored/"><article class="product_pod"><h3><a href="book.html">Book</a></h3></article><li class="next"><a href="page2.html">Next</a></li>';
  const result = extractPage(html, bookConfig, source);
  assert.equal(
    result.rows[0]["详情链接"],
    "https://example.com/catalogue/book.html",
  );
  assert.equal(result.nextUrl, "https://example.com/catalogue/page2.html");
  assert.equal(result.rows[0]._source, source);
  for (const base of ["http://[", "javascript:alert(1)"]) {
    const fallback = extractPage(
      html.replace("/catalogue/", base),
      bookConfig,
      source,
    );
    assert.equal(fallback.nextUrl, "https://example.com/page2.html");
  }
});

test("page warnings reach the client before a later failure or cancellation", async () => {
  for (const cancel of [false, true]) {
    const events: CrawlEvent[] = [];
    const aborter = new AbortController();
    await assert.rejects(
      crawl(
        { ...bookConfig, maxPages: 2 },
        aborter.signal,
        (event) => {
          events.push(event);
          if (cancel && event.type === "page") aborter.abort();
        },
        {
          get: async (url, _signal, before) => {
            if (url.endsWith("/robots.txt"))
              return { url, status: 404, headers: {}, body: Buffer.from("") };
            await before?.(new URL(url));
            if (url.includes("page=2")) throw new Error("second page failed");
            return {
              url,
              status: 200,
              headers: { "content-type": "text/html" },
              body: Buffer.from(
                '<article class="product_pod"></article><li class="next"><a href="?page=2">Next</a></li>',
              ),
            };
          },
          request: async () => {
            throw new Error("unexpected API call");
          },
        },
        async () => {},
      ),
    );
    assert.equal(events.filter((e) => e.type === "page").length, 1);
    assert.equal(
      events.filter((e) => e.type === "log" && e.level === "warning").length,
      4,
    );
    assert.equal(
      events.some((e) => e.type === "done"),
      false,
    );
  }
});

test("cross-origin base pagination remains blocked by crawler", async () => {
  const result = await crawl(
    { ...bookConfig, maxPages: 2 },
    new AbortController().signal,
    () => {},
    {
      get: async (url, _signal, before) => {
        if (url.endsWith("/robots.txt"))
          return { url, status: 404, headers: {}, body: Buffer.from("") };
        await before?.(new URL(url));
        return {
          url,
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from(
            '<base href="https://other.example.com/"><li class="next"><a href="next">Next</a></li>',
          ),
        };
      },
      request: async () => {
        throw new Error("unexpected API call");
      },
    },
    async () => {},
  );
  assert.equal(result.pages.length, 1);
  assert.ok(result.warnings.some((w) => w.includes("其他网站")));
});

test("deleting A preserves B auto-restore; deleting B clears it, including legacy storage", () => {
  const profiles: SiteProfile[] = ["A", "B"].map((id) => ({
    id,
    name: id,
    updatedAt: "",
    config: persistentConfig({ ...bookConfig, url: bookConfig.url + id }),
  }));
  for (const legacy of [false, true]) {
    const values = new Map<string, string>([
      ["crawlspace-rule-v1", JSON.stringify(profiles[1].config)],
      [profileStorageKey, JSON.stringify(profiles)],
    ]);
    if (!legacy) values.set(lastProfileStorageKey, "B");
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const next = removeProfile(storage, profiles, "A");
    assert.equal(next.length, 1);
    assert.equal(
      values.get("crawlspace-rule-v1"),
      JSON.stringify(profiles[1].config),
    );
    removeProfile(storage, next, "B");
    assert.equal(values.has("crawlspace-rule-v1"), false);
    assert.equal(values.has(lastProfileStorageKey), false);
  }
});

test("concurrent same-origin requests wait, other origins proceed, cancellation frees no reserved slot", async () => {
  let now = 0;
  const waits: { ms: number; resume: () => void }[] = [];
  const pace = createOriginScheduler(
    () => now,
    (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        waits.push({ ms, resume: resolve });
      }),
  );
  const signal = new AbortController().signal;
  await pace("https://a.example", 1000, signal);
  const second = pace("https://a.example", 2000, signal);
  const third = pace("https://a.example", 1000, signal);
  await pace("https://b.example", 1000, signal);
  assert.deepEqual(
    waits.map((w) => w.ms),
    [2000, 1000],
  );
  now = 2000;
  waits.shift()!.resume();
  await second;
  waits.shift()!.resume();
  await Promise.resolve();
  assert.equal(waits[0].ms, 2000);
  now = 4000;
  waits.shift()!.resume();
  await third;
  const aborter = new AbortController();
  const cancelled = pace("https://a.example", 1000, aborter.signal);
  aborter.abort();
  await assert.rejects(cancelled);
  now = 5000;
  await pace("https://a.example", 1000, signal);
});

function streamRequest(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  return new Request("http://localhost/api/crawl", {
    method: "POST",
    body: stream,
    signal,
    duplex: "half",
    headers: { [consentHeader]: DISCLAIMER_VERSION },
  } as RequestInit);
}

test("configuration upload times out even when stream cancellation never settles", async () => {
  let cancelled = false;
  const request = streamRequest(
    new ReadableStream({
      cancel() {
        cancelled = true;
        return new Promise(() => {});
      },
    }),
  );
  await assert.rejects(
    readConfigBody(request, 20),
    (error: any) => error.status === 408,
  );
  assert.equal(cancelled, true);
});

test("configuration upload enforces size, abort, and valid JSON", async () => {
  const oversized = streamRequest(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(32_769));
      },
      cancel() {
        return new Promise(() => {});
      },
    }),
  );
  await assert.rejects(
    readConfigBody(oversized),
    (error: any) => error.status === 413,
  );
  const aborter = new AbortController();
  const pending = readConfigBody(
    streamRequest(new ReadableStream(), aborter.signal),
  );
  aborter.abort();
  await assert.rejects(pending, (error: any) => error.status === 408);
  const valid = new Request("http://localhost", {
    method: "POST",
    body: '{"ok":true}',
  });
  assert.deepEqual(await readConfigBody(valid), { ok: true });
});

test("slow uploads occupy the three task slots and abort releases them", async () => {
  const aborters = Array.from({ length: 3 }, () => new AbortController());
  const requests = aborters.map((a) =>
    POST(streamRequest(new ReadableStream(), a.signal)),
  );
  try {
    await delay(0);
    const rejected = await POST(
      new Request("http://localhost/api/crawl", {
        method: "POST",
        body: "{}",
        headers: { [consentHeader]: DISCLAIMER_VERSION },
      }),
    );
    assert.equal(rejected.status, 429);
  } finally {
    aborters.forEach((a) => a.abort());
    assert.deepEqual(
      (await Promise.all(requests)).map((r) => r.status),
      [408, 408, 408],
    );
  }
  const next = await POST(
    new Request("http://localhost/api/crawl", {
      method: "POST",
      body: "{}",
      headers: { [consentHeader]: DISCLAIMER_VERSION },
    }),
  );
  assert.equal(next.status, 400);
});
