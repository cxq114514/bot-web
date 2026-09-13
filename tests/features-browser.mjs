import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const base = process.env.CRAWLSPACE_QA_URL || "http://127.0.0.1:3000";
const output = process.env.CRAWLSPACE_QA_OUTPUT || fileURLToPath(new URL("../test-results/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByLabel("网站预设").selectOption("quotes");
  assert.equal(await page.getByLabel("字段 2 名称").inputValue(), "作者");
  await page.getByRole("button", { name: "保存规则", exact: true }).click();
  await page.getByRole("button", { name: "规则已保存" }).waitFor();
  const quoteId = await page.getByLabel("已保存的站点", { exact: true }).inputValue();
  assert.ok(quoteId);
  await page.getByLabel("采集页数", { exact: true }).selectOption("2");
  await run(20);
  console.log("QUOTES_OK: 20 records from 2 real pages");

  await page.getByRole("button", { name: "自定义接口", exact: true }).click();
  await page.getByLabel("接口网址").fill("https://jsonplaceholder.typicode.com/posts?userId=1");
  await page.getByLabel("数据列表路径").fill("$");
  await page.getByLabel("站点规则名称").fill("JSON API test");
  await page.getByLabel(/^自定义请求头/).fill('{"Authorization":"Bearer NOT-A-REAL-SECRET"}');
  await page.getByRole("button", { name: "保存规则", exact: true }).click();
  await page.getByRole("button", { name: "规则已保存" }).waitFor();
  const apiId = await page.getByLabel("已保存的站点", { exact: true }).inputValue();
  assert.notEqual(apiId, quoteId);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.equal(storage.includes("NOT-A-REAL-SECRET"), false);
  assert.equal(storage.includes("userId=1"), false);
  await page.getByLabel(/^自定义请求头/).fill('{"bad":');
  await page.getByRole("button", { name: "开始采集", exact: true }).click();
  await page.locator(".error-banner").waitFor();
  assert.match(await page.locator(".error-banner").innerText(), /请求头/);
  await page.getByLabel(/^自定义请求头/).fill("{}");
  await run(10);
  console.log("JSON_GET_OK: 10 real API records, invalid headers blocked, credentials not persisted");

  await page.getByLabel("请求方式").selectOption("POST");
  await page.getByLabel("接口网址").fill("https://jsonplaceholder.typicode.com/posts");
  // JSONPlaceholder documents that POST responses are simulated and do not persist server data.
  await page.getByLabel("JSON 请求体").fill('{"title":"Crawlspace integration check","userId":1}');
  await run(1);
  assert.match(await page.locator(".table-scroll tbody").innerText(), /Crawlspace integration check/);
  assert.match(await page.locator(".table-scroll tbody").innerText(), /101/);
  console.log("JSON_POST_OK: simulated public testing API returned the JSON body correctly");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "multi-site-api.png"), fullPage: true });

  await page.getByLabel("已保存的站点", { exact: true }).selectOption(quoteId);
  assert.equal(await page.getByLabel("目标网址").inputValue(), "https://quotes.toscrape.com/");
  await page.getByLabel("已保存的站点", { exact: true }).selectOption(apiId);
  assert.deepEqual(JSON.parse(await page.getByLabel(/^自定义请求头/).inputValue()), {});
  assert.equal(await page.getByLabel("接口网址").inputValue(), "https://jsonplaceholder.typicode.com/posts");
  await page.getByRole("button", { name: "删除已保存的站点规则" }).click();
  assert.equal(await page.locator(`#saved-profile option[value="${apiId}"]`).count(), 0);

  await page.getByLabel("网站预设").selectOption("quotes");
  await page.getByLabel("采集页数", { exact: true }).selectOption("10");
  await page.getByRole("button", { name: "开始采集", exact: true }).click();
  await page.getByRole("button", { name: "停止采集" }).click();
  await page.waitForFunction(() => document.querySelector(".config-footer")?.textContent.includes("已停止"));
  console.log("PROFILES_AND_CANCEL_OK: independent save/load/delete, restore without credentials, stop action");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.locator(".mobile-navigation").getByRole("button", { name: /采集结果/ }).click();
  await page.locator(".mobile-navigation").getByRole("button", { name: "采集工作台" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "multi-site-mobile.png"), fullPage: true });
  const disclaimer = await browser.newPage();
  const response = await disclaimer.goto(base + "/disclaimer");
  assert.equal(response.status(), 200);
  await disclaimer.getByRole("heading", { name: "使用说明与免责声明", exact: true }).waitFor();
  assert.ok(await disclaimer.getByRole("heading", { name: /自定义接口与凭据/ }).isVisible());
  assert.deepEqual(errors, []);
  console.log("BROWSER_FEATURES_OK: mobile navigation/layout, disclaimer route, no page errors");

  async function run(count) {
    await page.getByRole("button", { name: "开始采集", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".stop-button"), null, { timeout: 120000 });
    assert.deepEqual(await page.locator(".error-banner").allTextContents(), []);
    assert.equal(await page.locator(".count-badge").innerText(), String(count));
  }
} finally { await browser.close(); }
