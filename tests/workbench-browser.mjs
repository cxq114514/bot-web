import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

const base = process.env.CRAWLSPACE_QA_URL || "http://127.0.0.1:3102";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const consent = page.getByRole("dialog", {
    name: "使用前，请阅读并同意免责声明",
  });
  await consent.waitFor();
  assert.equal(
    await page.getByRole("button", { name: "同意并进入工作台" }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");
  assert.ok(await consent.isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/consent-mobile.png",
    fullPage: true,
  });
  const denied = await page.request.post(base + "/api/crawl", {
    data: { operation: "analyze" },
  });
  assert.equal(denied.status(), 403);
  await page.getByLabel("我已阅读并同意免责声明").check();
  await page.getByRole("button", { name: "同意并进入工作台" }).click();
  await consent.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByLabel("网站预设").selectOption("books");
  await page.getByLabel("采集页数", { exact: true }).selectOption("3");
  await page.getByLabel("下一页链接选择器").fill("");

  const rows = Array.from({ length: 12 }, (_, i) => ({
    书名: "Book " + String(i).padStart(2, "0"),
    价格: i === 0 ? "" : String(i),
    库存: "有货",
    详情链接: `https://example.com/book/${i}`,
    _source: "https://example.com/list",
  }));
  rows.push({ ...rows[2], _source: "https://example.com/other" });
  const modes = [];
  let fail = false;
  let slow = false;
  await page.route("**/api/crawl", async (route) => {
    const request = route.request();
    assert.equal(request.headers()["x-crawlspace-consent"], "2026-09-13-v2");
    const input = request.postDataJSON();
    modes.push(input.operation);
    if (slow) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.abort().catch(() => {});
      return;
    }
    const result = {
      rows,
      fields: Object.keys(rows[0]).filter((key) => key !== "_source"),
      pages: [
        {
          url: "https://example.com/list",
          title: "Books",
          rows: rows.length,
          duration: 20,
        },
      ],
      warnings: [],
      duration: 20,
      completedAt: new Date().toISOString(),
    };
    const report = {
      operation: input.operation,
      status: 200,
      contentType: "text/html",
      sourceType: "html",
      rendered: input.renderMode === "browser",
      matched: rows.length,
      sampled: rows.length,
      fields: input.fields.map((field) => ({
        ...field,
        filled: rows.filter((row) => !!row[field.name]).length,
      })),
      notes: ["仅抓取一页"],
      ...(input.operation === "analyze"
        ? {
            suggested: {
              sourceType: "html",
              rowSelector: ".suggested",
              fields: input.fields,
              nextSelector: ".next a",
            },
          }
        : {}),
    };
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        [
          ...(input.operation === "crawl" ? [] : [{ type: "probe", report }]),
          { type: "page", page: result.pages[0], rows },
          fail
            ? { type: "error", message: "后续页面失败" }
            : { type: "done", result },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    });
  });
  await page.getByRole("button", { name: "规则试运行", exact: true }).click();
  await page
    .getByRole("heading", { name: "规则试运行", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "开始采集", exact: true }).waitFor();
  assert.equal(modes[0], "test");
  assert.ok(
    (await page.getByRole("region", { name: "规则诊断" }).innerText()).includes(
      "12 / 13",
    ),
  );
  await page.getByLabel("搜索结果").fill("Book 02");
  await page.getByLabel("去重依据").selectOption("书名");
  assert.ok(
    (await page.locator(".filter-summary").innerText()).includes(
      "显示 1 / 13 条",
    ),
  );
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^导出 JSON/ }).click(),
  ]);
  const data = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(data.rows.length, 1);
  assert.equal(data.selection.originalCount, 13);
  await page.getByLabel("搜索结果").fill("No match at all");
  assert.ok(
    (await page.getByRole("region", { name: "采集结果" }).innerText()).includes(
      "没有符合筛选条件",
    ),
  );
  await page
    .getByRole("button", { name: "重置筛选", exact: true })
    .first()
    .click();
  await page.getByLabel("空值筛选").selectOption("missing");
  assert.ok(
    (await page.locator(".filter-summary").innerText()).includes(
      "显示 1 / 13 条",
    ),
  );
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await page.getByLabel("排序列").selectOption("价格");
  await page.getByLabel("排序方向").selectOption("desc");
  assert.ok(
    (await page.locator(".results-card tbody tr").first().innerText()).includes(
      "Book 11",
    ),
  );
  await page.screenshot({
    path: "test-results/workbench-desktop.png",
    fullPage: true,
  });

  await page.reload();
  assert.equal(await consent.isVisible(), false);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^采集历史/ })
    .click();
  await page.locator(".history-item").waitFor();
  assert.ok(
    (await page.locator(".history-item").innerText()).includes("13 条"),
  );
  await page.getByRole("button", { name: "查看结果", exact: true }).click();
  assert.ok(
    (await page.locator(".filter-summary").innerText()).includes(
      "显示 13 / 13 条",
    ),
  );
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "采集工作台", exact: true })
    .click();
  await page.getByLabel("网页加载方式").selectOption("browser");
  await page.getByLabel("等待元素（可选）").fill(".loaded");
  await page.getByRole("button", { name: "自动分析响应", exact: true }).click();
  await page
    .getByRole("button", { name: "应用分析规则", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "开始采集", exact: true }).waitFor();
  await page.getByRole("button", { name: "应用分析规则", exact: true }).click();
  assert.equal(
    await page.getByLabel("列表容器", { exact: false }).inputValue(),
    ".suggested",
  );
  assert.equal(
    await page.getByLabel("采集页数", { exact: true }).inputValue(),
    "1",
  );
  fail = true;
  await page.getByRole("button", { name: "开始采集", exact: true }).click();
  await page.locator(".error-banner").waitFor();
  await page.getByRole("button", { name: "开始采集", exact: true }).waitFor();
  slow = true;
  fail = false;
  await page.getByRole("button", { name: "规则试运行", exact: true }).click();
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await page.getByRole("button", { name: "开始采集", exact: true }).waitFor();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^采集历史/ })
    .click();
  assert.equal(await page.locator(".history-item").count(), 4);
  assert.ok(
    (await page.locator(".history-body").innerText()).includes("已中断"),
  );
  assert.ok(
    (await page.locator(".history-body").innerText()).includes("已停止"),
  );
  await page.screenshot({
    path: "test-results/history-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/history-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "查看结果", exact: true })
    .nth(1)
    .click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/results-mobile.png",
    fullPage: true,
  });
  await page
    .locator(".mobile-navigation")
    .getByRole("button", { name: "采集历史", exact: true })
    .click();
  await page.getByRole("button", { name: "删除此条历史" }).first().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-item").length === 3,
  );
  await page.getByRole("button", { name: "清空历史" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-item").length === 0,
  );
  await page.reload();
  await page
    .locator(".mobile-navigation")
    .getByRole("button", { name: "采集历史", exact: true })
    .click();
  assert.equal(await page.locator(".history-item").count(), 0);
  await page.goto(base + "/disclaimer");
  assert.ok((await page.locator("main").innerText()).includes("采集历史"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: consent enforcement, trial/analysis, filters/dedupe/export, history persistence and interrupted runs, deletion and mobile layouts",
  );
} finally {
  await browser.close();
}
