import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const outputDirectory =
  process.env.CRAWLSPACE_QA_OUTPUT ||
  fileURLToPath(new URL("../test-results/", import.meta.url));
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(process.env.CRAWLSPACE_QA_URL || "http://127.0.0.1:3000", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.getByRole("heading", { name: /^采集工作台/ }).waitFor();
await page.getByLabel("我已阅读并同意免责声明").check();
await page.getByRole("button", { name: "同意并进入工作台" }).click();
await page.getByRole("button", { name: "使用帮助" }).click();
await page.getByRole("dialog").waitFor();
await page.keyboard.press("Escape");
await page.screenshot({
  path: path.join(outputDirectory, "crawlspace-desktop.png"),
  fullPage: true,
});
await page
  .getByRole("button", { name: "试试书籍采集示例", exact: true })
  .click();
assert.equal(
  await page.getByLabel("目标网址").inputValue(),
  "https://books.toscrape.com/",
);
assert.equal(await page.getByLabel("字段 1 名称").inputValue(), "书名");
await page.getByLabel("站点规则名称").fill("书籍测试规则");
await page.getByRole("button", { name: "保存规则", exact: true }).click();
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "规则已保存" }).waitFor();
assert.equal(await page.getByLabel("字段 1 名称").inputValue(), "书名");
await page.getByLabel("采集页数", { exact: true }).selectOption("2");
await page.getByRole("button", { name: "开始采集", exact: true }).click();
await page.waitForFunction(
  () => !document.querySelector(".stop-button"),
  null,
  { timeout: 90000 },
);
const alerts = await page.locator(".error-banner").allTextContents();
if (alerts.length) console.log("LIVE_CRAWL_ERROR", alerts.join(" "));
else {
  assert.equal(
    await page.locator(".count-badge").innerText(),
    "40",
    "Live crawl should return 40 books from 2 pages",
  );
  await page.getByRole("button", { name: "下一页结果" }).click();
  assert.equal(
    await page.locator("tbody tr").first().locator("td").first().innerText(),
    "11",
  );
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  assert.match(await page.locator(".json-wrap pre").innerText(), /书名/);
  await page.getByRole("button", { name: "导出数据" }).click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  assert.match((await pendingDownload).suggestedFilename(), /\.csv$/);
  await page.getByRole("button", { name: "表格视图" }).click();
  console.log(
    "LIVE_CRAWL_OK: 40 records, 2 pages; table pagination, JSON and CSV verified",
  );
}
await page.screenshot({
  path: path.join(outputDirectory, "crawlspace-results.png"),
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: path.join(outputDirectory, "crawlspace-mobile.png"),
  fullPage: true,
});
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  "No horizontal page overflow at 390px",
);
await page.getByRole("button", { name: "新建采集" }).click();
await page.getByLabel("目标网址").fill("http://127.0.0.1");
await page.getByRole("button", { name: "开始采集", exact: true }).click();
await page.locator(".error-banner").waitFor();
assert.match(await page.locator(".error-banner").innerText(), /内网|保留/);
assert.deepEqual(errors, []);
console.log(
  "BROWSER_OK: guide, template, saved rule restore, mobile layout, SSRF rejection; no browser errors",
);
await browser.close();
assert.deepEqual(alerts, [], "Live external crawl must succeed");
