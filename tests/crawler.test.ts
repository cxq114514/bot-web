import test from "node:test";
import assert from "node:assert/strict";
import { extractPage, validateConfig } from "../lib/extract";
import { parseTarget, publicAddress } from "../lib/safe-fetch";
import { toCsv } from "../lib/export";
import { bookConfig, initialConfig } from "../lib/types";

test("rejects local, private, encoded, mapped and reserved addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "192.0.2.1",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const url of [
    "http://localhost",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://[::ffff:127.0.0.1]",
    "file:///etc/passwd",
    "https://example.com:8080",
    "https://user:pass@example.com",
    "http://host.internal",
  ])
    assert.throws(() => parseTarget(url), url);
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  assert.equal(
    parseTarget("https://example.com/page#heading").href,
    "https://example.com/page",
  );
});

test("extracts records within each container and resolves links", () => {
  const html = `<html><head><title>Books</title></head><body><article class="product_pod"><h3><a title="First book" href="/books/1">First</a></h3><p class="price_color"> £ 20.00 </p><p class="instock availability"> In   stock </p></article><article class="product_pod"><h3><a title="Second book" href="books/2">Second</a></h3><p class="price_color">£10.00</p></article><li class="next"><a href="?page=2">Next</a></li></body></html>`;
  const parsed = extractPage(
    html,
    bookConfig,
    "https://example.com/catalogue/",
  );
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]["书名"], "First book");
  assert.equal(parsed.rows[0]["库存"], "In stock");
  assert.equal(parsed.rows[1]["库存"], "");
  assert.equal(parsed.rows[0]["详情链接"], "https://example.com/books/1");
  assert.equal(
    parsed.rows[1]["详情链接"],
    "https://example.com/catalogue/books/2",
  );
  assert.equal(parsed.nextUrl, "https://example.com/catalogue/?page=2");
  assert.equal(parsed.title, "Books");
});

test("whole page extraction deduplicates values and excludes executable URLs", () => {
  const parsed = extractPage(
    '<h1>A title</h1><a href="/x">x</a><a href="/x">x again</a><a href="javascript:alert(1)">bad</a><a href="data:text/html,hello">bad</a>',
    initialConfig,
    "https://example.com",
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]["标题"], "A title");
  assert.equal(parsed.rows[0]["链接"], "https://example.com/x");
  assert.ok(parsed.warnings.some((warning) => warning.includes("描述")));
});

test("supports extracting the container itself using :scope", () => {
  const config = {
    ...initialConfig,
    rowSelector: "a",
    fields: [{ id: "1", name: "url", selector: ":scope", attribute: "href" }],
  };
  assert.equal(
    extractPage('<a href="/book">Book</a>', config, "https://example.com")
      .rows[0].url,
    "https://example.com/book",
  );
});

test("decodes Chinese HTML using the HTTP charset", () => {
  const html = Buffer.from("<h1>中文标题</h1>", "utf8");
  assert.equal(
    extractPage(html, initialConfig, "https://example.com", "utf-8").rows[0][
      "标题"
    ],
    "中文标题",
  );
  const gbk = Buffer.from([
    0x3c, 0x68, 0x31, 0x3e, 0xd6, 0xd0, 0xce, 0xc4, 0x3c, 0x2f, 0x68, 0x31,
    0x3e,
  ]);
  assert.equal(
    extractPage(gbk, initialConfig, "https://example.com", "gbk").rows[0][
      "标题"
    ],
    "中文",
  );
});

test("reports a missing container and bounds page record counts", () => {
  assert.equal(
    extractPage("<div>empty</div>", bookConfig, bookConfig.url).rows.length,
    0,
  );
  const parsed = extractPage(
    '<article class="product_pod"></article>'.repeat(230),
    bookConfig,
    bookConfig.url,
  );
  assert.equal(parsed.rows.length, 200);
  assert.ok(parsed.warnings.some((warning) => warning.includes("200")));
});

test("rejects invalid rules before network access", () => {
  assert.throws(() => validateConfig({ ...initialConfig, fields: [] }));
  assert.throws(() =>
    validateConfig({
      ...initialConfig,
      fields: [initialConfig.fields[0], initialConfig.fields[0]],
    }),
  );
  assert.throws(() =>
    validateConfig({ ...initialConfig, rowSelector: "[broken" }),
  );
  assert.throws(() => validateConfig({ ...initialConfig, maxPages: 11 }));
  assert.throws(() =>
    validateConfig({
      ...initialConfig,
      fields: [{ ...initialConfig.fields[0], name: "__proto__" }],
    }),
  );
  assert.equal(validateConfig(bookConfig).fields.length, 4);
});

test("CSV preserves Unicode, quotes and newlines while neutralizing spreadsheet formulas", () => {
  const csv = toCsv(
    [
      {
        title: '书名, "quoted"\n第二行',
        price: '=HYPERLINK("bad")',
        _source: "https://example.com",
      },
    ],
    ["title", "price"],
  );
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"书名, ""quoted""\n第二行"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"_source"'));
});
