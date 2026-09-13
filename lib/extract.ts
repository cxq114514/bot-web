import * as cheerio from "cheerio";
import { CrawlError } from "./safe-fetch";
import type { CrawlConfig, CrawlRow } from "./types";
import { pathTokens } from "./json-path";
import { validateApi } from "./api-config";

export function validateConfig(value: unknown): CrawlConfig {
  if (!value || typeof value !== "object")
    throw new CrawlError("采集配置格式不正确。");
  const config = value as CrawlConfig;
  if (
    config.sourceType !== undefined &&
    config.sourceType !== "html" &&
    config.sourceType !== "json"
  )
    throw new CrawlError("不支持的数据源类型。");
  const json = config.sourceType === "json";
  const api = json ? validateApi(config.api) : undefined;
  if (typeof config.url !== "string" || config.url.length > 2048)
    throw new CrawlError("网址格式不正确或过长。");
  if (
    !Array.isArray(config.fields) ||
    config.fields.length < 1 ||
    config.fields.length > 12
  )
    throw new CrawlError("请配置 1 到 12 个采集字段。");
  const names = new Set<string>();
  const $ = cheerio.load("<html><body></body></html>");
  const validateSelector = (
    selector: unknown,
    label: string,
    optional = false,
  ) => {
    if (
      typeof selector !== "string" ||
      selector.length > 300 ||
      (!optional && !selector.trim())
    )
      throw new CrawlError(`${label}不能为空，且不能超过 300 个字符。`);
    if (selector.trim()) {
      try {
        if (json) pathTokens(selector);
        else $(selector);
      } catch {
        throw new CrawlError(
          `${label}不是有效的 ${json ? "JSON 路径" : "CSS 选择器"}。`,
        );
      }
    }
  };
  validateSelector(config.rowSelector, "列表容器", true);
  if (!json) validateSelector(config.nextSelector, "下一页选择器", true);
  if (
    !Number.isInteger(config.maxPages) ||
    config.maxPages < 1 ||
    config.maxPages > 10
  )
    throw new CrawlError("采集页数应在 1 到 10 之间。");
  if (
    config.maxPages > 1 &&
    (json ? !api?.pageParam : !config.nextSelector.trim())
  )
    throw new CrawlError(
      json
        ? "采集多页时需要填写分页参数名。"
        : "采集多页时需要填写下一页链接选择器。",
    );
  const fields = config.fields.map((field) => {
    if (
      !field ||
      typeof field.name !== "string" ||
      !field.name.trim() ||
      field.name.length > 40
    )
      throw new CrawlError("请为每个字段填写名称（最多 40 个字符）。");
    const name = field.name.trim();
    if (
      names.has(name) ||
      ["__proto__", "constructor", "prototype", "_source"].includes(name)
    )
      throw new CrawlError("字段名称重复或使用了保留名称。");
    names.add(name);
    validateSelector(field.selector, `「${name}」的选择器`);
    if (
      typeof field.attribute !== "string" ||
      !/^(text|[a-zA-Z_:][\w:.-]{0,50})$/.test(field.attribute)
    )
      throw new CrawlError(`「${name}」的提取属性无效。`);
    return { ...field, name, selector: field.selector.trim() };
  });
  return {
    url: config.url,
    sourceType: json ? "json" : "html",
    api,
    maxPages: config.maxPages,
    fields,
    rowSelector: config.rowSelector.trim(),
    nextSelector: json ? "" : config.nextSelector.trim(),
  };
}

export function extractPage(
  html: Buffer | string,
  config: CrawlConfig,
  url: string,
  charset?: string,
) {
  const $ =
    typeof html === "string"
      ? cheerio.load(html)
      : cheerio.loadBuffer(html, {
          encoding: {
            transportLayerEncodingLabel: charset,
            defaultEncoding: "utf-8",
          },
        });
  $("script,style,noscript,template").remove();
  let baseUrl = url;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref !== undefined) {
    try {
      const base = new URL(baseHref, url);
      if (["http:", "https:"].includes(base.protocol)) baseUrl = base.href;
    } catch {
      // Invalid base URLs fall back to the document URL.
    }
  }
  const matches = config.rowSelector
    ? $(config.rowSelector).toArray()
    : [$.root()[0]];
  const warnings: string[] = [];
  if (!matches.length)
    warnings.push("列表容器未匹配到内容，请检查 CSS 选择器。");
  if (matches.length > 200)
    warnings.push("本页超过 200 条记录，仅保留前 200 条。");
  let outputBytes = 0;
  const rows: CrawlRow[] = [];
  for (const element of matches.slice(0, 200)) {
    const row: CrawlRow = Object.create(null);
    for (const field of config.fields) {
      const scope = $(element);
      const nodes =
        field.selector === ":scope" ? scope : scope.find(field.selector);
      const values = nodes
        .toArray()
        .slice(0, 100)
        .map((node) => {
          let value =
            field.attribute === "text"
              ? $(node).text().replace(/\s+/g, " ").trim()
              : ($(node).attr(field.attribute) ?? "").trim();
          if (
            value &&
            ["href", "src", "data-src", "action", "poster"].includes(
              field.attribute,
            )
          ) {
            try {
              const resolved = new URL(value, baseUrl);
              value = ["http:", "https:"].includes(resolved.protocol)
                ? resolved.href
                : "";
            } catch {
              value = "";
            }
          }
          return value.slice(0, 20_000);
        })
        .filter(Boolean);
      row[field.name] = [...new Set(values)].join("\n").slice(0, 20_000);
    }
    row._source = url;
    outputBytes += Buffer.byteLength(JSON.stringify(row));
    if (outputBytes > 1024 * 1024) {
      warnings.push("本页提取数据超过 1 MB，仅保留限额内的记录。");
      break;
    }
    rows.push(row);
  }
  for (const field of config.fields)
    if (rows.length && rows.every((row) => !row[field.name]))
      warnings.push(`「${field.name}」没有提取到内容，请检查选择器或属性。`);
  let nextUrl: string | null = null;
  const nextHref = config.nextSelector
    ? $(config.nextSelector).first().attr("href")
    : undefined;
  if (nextHref) {
    try {
      nextUrl = new URL(nextHref, baseUrl).href;
    } catch {
      warnings.push("下一页链接无效。");
    }
  }
  return {
    rows,
    warnings,
    nextUrl,
    title: $("title").first().text().trim() || new URL(url).hostname,
  };
}
