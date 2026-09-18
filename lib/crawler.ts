import robotsParser from "robots-parser";
import { waitForOrigin } from "./origin-scheduler";
import { extractPage } from "./extract";
import { CrawlError, parseTarget, safeGet, safeRequest } from "./safe-fetch";
import { extractJson } from "./extract-json";
import { analyzeResponse } from "./analyze-response";
import type { renderPage } from "./browser-render";
import type {
  CrawlConfig,
  CrawlEvent,
  CrawlResult,
  CrawlOperation,
} from "./types";

type CrawlTransport = { get: typeof safeGet; request: typeof safeRequest };
export async function crawl(
  config: CrawlConfig,
  signal: AbortSignal,
  emit: (event: CrawlEvent) => void,
  network: CrawlTransport = { get: safeGet, request: safeRequest },
  pace = waitForOrigin,
  options: { operation?: CrawlOperation; render?: typeof renderPage } = {},
): Promise<CrawlResult> {
  const started = Date.now();
  const json = config.sourceType === "json";
  const operation = options.operation ?? "crawl";
  const result: CrawlResult = {
    rows: [],
    pages: [],
    warnings: [],
    fields: config.fields.map((field) => field.name),
    duration: 0,
    completedAt: "",
  };
  const visited = new Set<string>();
  const warn = (message: string) => {
    if (result.warnings.includes(message)) return;
    result.warnings.push(message);
    emit({ type: "log", message, level: "warning" });
  };
  const robots = new Map<string, Promise<ReturnType<typeof robotsParser>>>();
  let outputBytes = 0;
  const checkRobots = async (url: URL) => {
    if (!robots.has(url.origin)) {
      const robotsUrl = new URL("/robots.txt", url).href;
      emit({
        type: "log",
        message: `检查 ${url.hostname} 的 robots.txt`,
        level: "info",
      });
      const pending = (async () => {
        const response = await network.get(robotsUrl, signal, (target) =>
          pace(target.origin, 1_000, signal),
        );
        if ([401, 403].includes(response.status))
          throw new CrawlError("网站不允许读取抓取规则，已停止采集。");
        if (response.status >= 500 || response.status === 429)
          throw new CrawlError("网站暂时无法提供抓取规则，请稍后重试。");
        if (![200, 404, 410].includes(response.status))
          throw new CrawlError(
            `无法确认网站抓取规则（HTTP ${response.status}）。`,
          );
        return robotsParser(
          robotsUrl,
          response.status === 200 ? response.body.toString("utf8") : "",
        );
      })();
      robots.set(url.origin, pending);
    }
    const rules = await robots.get(url.origin)!;
    if (rules.isAllowed(url.href, "Crawlspace") === false)
      throw new CrawlError(
        "该网页的 robots.txt 禁止自动抓取，请选择允许采集的页面。",
      );
    const seconds = rules.getCrawlDelay("Crawlspace");
    if (seconds && seconds > 10)
      throw new CrawlError(
        "网站要求的抓取间隔超过 10 秒，当前交互式任务不支持。",
      );
    return Math.max(1_000, (seconds ?? 0) * 1000);
  };
  let current: string | null = parseTarget(config.url).href;
  if (json && config.api?.pageParam) {
    const first = new URL(current);
    first.searchParams.set(config.api.pageParam, String(config.api.startPage));
    current = first.href;
  }
  let paginationOrigin: string | null = null;
  for (
    let index = 0;
    current && index < (operation === "crawl" ? config.maxPages : 1);
    index++
  ) {
    signal.throwIfAborted();
    const normalized = parseTarget(current);
    if (visited.has(normalized.href)) {
      warn("检测到重复分页链接，已停止翻页。");
      break;
    }
    visited.add(normalized.href);
    const pageStarted = Date.now();
    emit({
      type: "log",
      message: `正在抓取第 ${index + 1} 页 · ${normalized.hostname}${normalized.pathname}`,
      level: "info",
    });
    const beforeRequest = async (target: URL) => {
      if (paginationOrigin && target.origin !== paginationOrigin)
        throw new CrawlError("分页跳转到了其他网站，已停止采集。");
      const delay = await checkRobots(target);
      await pace(target.origin, delay, signal);
    };
    const api = config.api;
    let response =
      json && api
        ? await network.request(
            normalized.href,
            signal,
            {
              method: api.method,
              sameOrigin: true,
              headers: {
                accept: "application/json",
                ...(api.method === "POST"
                  ? { "content-type": "application/json" }
                  : {}),
                ...api.headers,
              },
              body: api.method === "POST" ? api.body : undefined,
            },
            beforeRequest,
          )
        : await network.get(normalized.href, signal, beforeRequest);
    if (response.status < 200 || response.status >= 300)
      throw new CrawlError(
        `目标网站返回 HTTP ${response.status}${response.status === 403 ? "，可能需要登录或禁止自动访问" : ""}。`,
      );
    const contentType = String(response.headers["content-type"] ?? "");
    if (
      operation !== "analyze" &&
      (json
        ? !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)
        : !/text\/html|application\/xhtml\+xml/i.test(contentType))
    )
      throw new CrawlError(
        json
          ? "接口没有返回 JSON Content-Type，请核对接口地址。"
          : "目标地址不是 HTML 网页，请输入网页链接。",
      );
    const rendered =
      !json &&
      config.renderMode === "browser" &&
      /text\/html|application\/xhtml\+xml/i.test(contentType);
    if (rendered) {
      emit({
        type: "log",
        message: "正在渲染动态网页，等待页面内容加载",
        level: "info",
      });
      const render =
        options.render ?? (await import("./browser-render")).renderPage;
      response = await render(
        response,
        config,
        signal,
        async (target) => {
          const delay = await checkRobots(target);
          await pace(target.origin, delay, signal);
        },
        warn,
        network.get,
      );
    }
    paginationOrigin ??= new URL(response.url).origin;
    if (response.url !== normalized.href && visited.has(response.url)) {
      warn("分页跳转到已采集网页，已停止。");
      break;
    }
    visited.add(response.url);
    const charset = String(response.headers["content-type"]).match(
      /charset\s*=\s*["']?([^\s;"']+)/i,
    )?.[1];
    const publicUrl = new URL(response.url);
    const suggestion =
      operation === "analyze" ? analyzeResponse(response) : undefined;
    const extractionConfig = suggestion ? { ...config, ...suggestion } : config;
    const responseJson = extractionConfig.sourceType === "json";
    if (json || responseJson) publicUrl.search = "";
    const parsed = responseJson
      ? extractJson(response.body, extractionConfig, publicUrl.href)
      : extractPage(response.body, extractionConfig, publicUrl.href, charset);
    result.fields = extractionConfig.fields.map((field) => field.name);
    if (operation !== "crawl") {
      emit({
        type: "probe",
        report: {
          operation,
          status: response.status,
          contentType,
          sourceType: responseJson ? "json" : "html",
          rendered,
          matched: parsed.matched,
          sampled: parsed.rows.length,
          fields: extractionConfig.fields.map((field) => ({
            ...field,
            filled: parsed.rows.filter((row) => !!row[field.name]?.trim())
              .length,
          })),
          suggested: suggestion
            ? {
                sourceType: suggestion.sourceType,
                rowSelector: suggestion.rowSelector,
                fields: suggestion.fields,
                nextSelector: suggestion.nextSelector,
              }
            : undefined,
          notes: [
            ...(suggestion?.notes ?? [
              "仅抓取一页；命中率按实际保留的记录计算。",
            ]),
            ...parsed.warnings,
          ],
        },
      });
    }
    let atLimit = false;
    parsed.rows = parsed.rows.filter((row) => {
      outputBytes += Buffer.byteLength(JSON.stringify(row));
      if (outputBytes > 5 * 1024 * 1024) {
        atLimit = true;
        return false;
      }
      return true;
    });
    const page = {
      url: publicUrl.href,
      title: parsed.title,
      rows: parsed.rows.length,
      duration: Date.now() - pageStarted,
    };
    result.rows.push(...parsed.rows);
    result.pages.push(page);
    parsed.warnings.forEach(warn);
    emit({ type: "page", page, rows: parsed.rows });
    emit({
      type: "log",
      message: `第 ${index + 1} 页完成，提取 ${parsed.rows.length} 条记录`,
      level: "success",
    });
    if (atLimit) {
      warn("任务数据达到 5 MB 上限，已停止采集。");
      break;
    }
    if (json) {
      if (!parsed.rows.length || !api?.pageParam) break;
      const next = new URL(config.url);
      next.searchParams.set(api.pageParam, String(api.startPage + index + 1));
      current = next.href;
      continue;
    }
    if (parsed.nextUrl && new URL(parsed.nextUrl).origin !== paginationOrigin) {
      warn("下一页链接指向其他网站，已停止翻页。");
      current = null;
    } else current = parsed.nextUrl;
    if (!current && index + 1 < config.maxPages)
      emit({ type: "log", message: "没有更多分页，采集结束", level: "info" });
  }
  result.duration = Date.now() - started;
  result.completedAt = new Date().toISOString();
  return result;
}
