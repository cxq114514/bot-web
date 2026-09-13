import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const base = process.env.CRAWLSPACE_QA_URL || "http://127.0.0.1:3101";
const output = path.resolve("test-results");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByLabel("网站预设").selectOption("books");
  await page.getByLabel("站点规则名称").fill("A");
  await page.getByRole("button", { name: "保存规则", exact: true }).click();
  const a = await page.getByLabel("已保存的站点", { exact: true }).inputValue();
  await page.getByLabel("网站预设").selectOption("quotes");
  await page.getByLabel("站点规则名称").fill("B");
  await page.getByRole("button", { name: /^(保存规则|规则已保存)$/ }).click();
  await page.getByLabel("已保存的站点", { exact: true }).selectOption(a);
  await page.getByRole("button", { name: "删除已保存的站点规则" }).click();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#url')?.value === "https://quotes.toscrape.com/" ||
    [...document.querySelectorAll('input')].some((i) => i.value === "https://quotes.toscrape.com/"));
  assert.equal(await page.getByLabel("目标网址").inputValue(), "https://quotes.toscrape.com/");

  const warning = "「作者」没有提取到内容，请检查选择器或属性。";
  await page.route("**/api/crawl", (route) => route.fulfill({
    contentType: "application/x-ndjson",
    body: [
      { type: "log", level: "warning", message: warning },
      { type: "page", page: {url: "https://quotes.toscrape.com/", title: "Quotes", rows: 1, duration: 10},
        rows: [{ "名言": "Example", "作者": "", _source: "https://quotes.toscrape.com/" }] },
      { type: "error", message: "第二页读取失败" },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n",
  }));
  await page.getByRole("button", { name: "开始采集", exact: true }).click();
  await page.locator(".error-banner").waitFor();
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^导出 JSON/ }).click(),
  ]);
  const result = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.deepEqual(result.warnings, [warning]);
  assert.equal(result.rows.length, 1);
  await page.screenshot({ path: path.join(output, "regressions-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "regressions-mobile.png"), fullPage: true });
  await page.goto(base + "/disclaimer");
  await page.getByRole("heading", { name: "5. 结果完整性" }).waitFor();
  assert.ok((await page.locator("main").innerText()).includes("依法不得排除的责任"));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "disclaimer-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: independent profile restore, warnings in partial JSON export, disclaimer and mobile layout");
} finally {
  await browser.close();
}
