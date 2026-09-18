import * as cheerio from "cheerio";
import { pathTokens } from "./json-path";
import { CrawlError, type ResponseData } from "./safe-fetch";
import type { CrawlConfig, Field } from "./types";

type Suggestion = Pick<
  CrawlConfig,
  "sourceType" | "rowSelector" | "fields" | "nextSelector"
> & { notes: string[] };
const field = (name: string, selector: string, attribute = "text"): Field => ({
  id: `auto-${selector}-${attribute}`,
  name,
  selector,
  attribute,
});
function validPath(path: string) {
  try {
    pathTokens(path);
    return true;
  } catch {
    return false;
  }
}

function analyzeJson(body: Buffer): Suggestion {
  let data: unknown;
  try {
    data = JSON.parse(body.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new CrawlError("响应看起来是 JSON，但内容无法解析。");
  }
  const candidates: { path: string; values: unknown[]; score: number }[] = [];
  let visited = 0;
  function visit(value: unknown, path: string, depth: number) {
    if (++visited > 1500 || depth > 5) return;
    if (Array.isArray(value)) {
      if (validPath(path))
        candidates.push({
          path,
          values: value,
          score:
            (value.some((v) => v && typeof v === "object" && !Array.isArray(v))
              ? 100
              : 0) +
            Math.min(value.length, 50) -
            depth,
        });
      return;
    }
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value).slice(0, 100)) {
        const next = path === "$" ? key : `${path}.${key}`;
        if (validPath(next)) visit(child, next, depth + 1);
      }
  }
  visit(data, "$", 0);
  const chosen = candidates.sort((a, b) => b.score - a.score)[0];
  const values = chosen?.values ?? [data];
  const paths = new Set<string>();
  function collect(value: unknown, path: string, depth: number) {
    if (paths.size >= 12) return;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      depth < 3
    ) {
      for (const [key, child] of Object.entries(value).slice(0, 40)) {
        const next = path ? `${path}.${key}` : key;
        if (validPath(next)) collect(child, next, depth + 1);
      }
    } else if (validPath(path || "$")) paths.add(path || "$");
  }
  values.slice(0, 20).forEach((value) => collect(value, "", 0));
  const fields = [...paths].map((path, index) =>
    field(
      path === "$"
        ? "值"
        : path.length <= 40 &&
            !["_source", "constructor", "prototype", "__proto__"].includes(path)
          ? path
          : `字段 ${index + 1}`,
      path,
    ),
  );
  return {
    sourceType: "json",
    rowSelector: chosen?.path ?? "$",
    fields: fields.length ? fields : [field("值", "$")],
    nextSelector: "",
    notes: [
      "按响应结构推断列表和字段，请核对预览后应用。",
      ...(values.length ? [] : ["列表为空，暂时无法推断记录内的字段。"]),
      "特殊键名可能无法用当前 JSON 路径表达；分页参数需自行填写。",
    ],
  };
}

function analyzeHtml(response: ResponseData): Suggestion {
  const charset = String(response.headers["content-type"]).match(
    /charset\s*=\s*["']?([^\s;"']+)/i,
  )?.[1];
  const $ = cheerio.loadBuffer(response.body, {
    encoding: {
      transportLayerEncodingLabel: charset,
      defaultEncoding: "utf-8",
    },
  });
  $("script,style,noscript,template").remove();
  const candidates = new Map<string, number>();
  $("article,li,tr,div")
    .slice(0, 2500)
    .each((_, element) => {
      const node = $(element);
      if (node.closest("nav,header,footer").length) return;
      const tag = element.tagName;
      const className = (node.attr("class") ?? "")
        .split(/\s+/)
        .find((s) => s.length <= 120 && /^[a-zA-Z_][\w-]*$/.test(s));
      const selector = tag + (className ? `.${className}` : "");
      if (candidates.has(selector) || (tag === "div" && !className)) return;
      const siblings = node.parent().children(selector);
      if (siblings.length < 2 || !node.text().trim()) return;
      const semantic =
        (tag === "article" ? 6 : tag === "tr" ? 5 : 0) +
        (node.find("h1,h2,h3,h4").length ? 5 : 0) +
        (node.find("a[href]").length ? 2 : 0) +
        (node.find("img").length ? 1 : 0);
      candidates.set(
        selector,
        semantic * 10 +
          Math.min(siblings.length, 20) -
          Math.min(node.find("article,li,tr,div").length, 30),
      );
    });
  let rowSelector = [...candidates].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  if (rowSelector === "tr") rowSelector = "tr:has(td)";
  const sample = rowSelector ? $(rowSelector).first() : $("html");
  const fields: Field[] = [];
  const add = (name: string, selector: string, attribute = "text") => {
    if (sample.find(selector).length)
      fields.push(field(name, selector, attribute));
  };
  if (sample.is("tr")) {
    const headers = sample
      .closest("table")
      .find("thead th")
      .toArray()
      .map((el) => $(el).text().trim());
    sample
      .children("td")
      .slice(0, 12)
      .each((index) => {
        const name = headers[index];
        fields.push(
          field(
            name &&
              name.length <= 40 &&
              !fields.some((f) => f.name === name) &&
              !["_source", "__proto__", "constructor", "prototype"].includes(
                name,
              )
              ? name
              : `列 ${index + 1}`,
            `td:nth-of-type(${index + 1})`,
          ),
        );
      });
  } else {
    add("标题", "h1,h2,h3,h4");
    if (!fields.length) add("标题", "a[title]", "title");
    add("链接", "a[href]", "href");
    add("图片", "img[src]", "src");
    add("价格", '[class*="price"]');
    add("描述", "p");
    add(
      "时间",
      "time",
      sample.find("time[datetime]").length ? "datetime" : "text",
    );
  }
  if (!fields.length)
    fields.push(field("内容", rowSelector ? ":scope" : "body"));
  const nextSelector =
    [
      'a[rel="next"]',
      ".next a[href]",
      "a.next[href]",
      'a[aria-label="Next"]',
    ].find((s) => $(s).length) ?? "";
  return {
    sourceType: "html",
    rowSelector,
    fields,
    nextSelector,
    notes: [
      "按重复元素和常见语义推断规则，建议试运行后再采集多页。",
      ...(!rowSelector
        ? [
            "未发现明显列表，按整页提取；内容由 JavaScript 加载时可尝试动态渲染。",
          ]
        : []),
    ],
  };
}

export function analyzeResponse(response: ResponseData): Suggestion {
  const type = String(response.headers["content-type"] ?? "");
  const prefix = response.body
    .toString("utf8", 0, 100)
    .replace(/^\uFEFF/, "")
    .trimStart();
  let suggestion: Suggestion;
  if (
    /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(type) ||
    /^[\[{]/.test(prefix)
  )
    suggestion = analyzeJson(response.body);
  else if (
    /text\/html|application\/xhtml\+xml/i.test(type) ||
    /^<!doctype html|^<html[\s>]/i.test(prefix)
  )
    suggestion = analyzeHtml(response);
  else
    throw new CrawlError("暂时只能分析 HTML 或 JSON 响应，请检查网址或接口。");
  const names = new Set(["_source", "__proto__", "constructor", "prototype"]);
  suggestion.fields = suggestion.fields.slice(0, 12).map((item, index) => {
    let name = item.name.trim().slice(0, 40);
    let suffix = index + 1;
    while (!name || names.has(name)) name = `字段 ${suffix++}`;
    names.add(name);
    return { ...item, id: `auto-${index}`, name };
  });
  return suggestion;
}
