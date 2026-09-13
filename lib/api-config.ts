import { validateHeaderName, validateHeaderValue } from "node:http";
import { CrawlError } from "./safe-fetch";
import type { ApiOptions } from "./types";

export function validateApi(value: unknown): ApiOptions {
  if (!value || typeof value !== "object")
    throw new CrawlError("请填写接口请求配置。");
  const api = value as ApiOptions;
  if (api.method !== "GET" && api.method !== "POST")
    throw new CrawlError("接口仅支持 GET 和 POST 请求。");
  if (
    !api.headers ||
    typeof api.headers !== "object" ||
    Array.isArray(api.headers)
  )
    throw new CrawlError("请求头应为 JSON 对象。");
  const headers: Record<string, string> = Object.create(null);
  if (Object.keys(api.headers).length > 16)
    throw new CrawlError("最多允许 16 个自定义请求头。");
  for (const [rawName, value] of Object.entries(api.headers)) {
    const name = rawName.toLowerCase();
    if (typeof value !== "string" || value.length > 2048)
      throw new CrawlError("请求头的值必须为不超过 2048 字符的字符串。");
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
    } catch {
      throw new CrawlError("请求头名称或值无效。");
    }
    if (Object.hasOwn(headers, name))
      throw new CrawlError("请求头名称不能重复（不区分大小写）。");
    if (
      [
        "host",
        "connection",
        "content-length",
        "transfer-encoding",
        "upgrade",
        "te",
        "trailer",
        "keep-alive",
        "proxy-authorization",
        "proxy-authenticate",
        "cookie",
        "set-cookie",
        "accept-encoding",
        "user-agent",
        "expect",
        "origin",
        "referer",
        "forwarded",
      ].includes(name) ||
      name.startsWith("sec-") ||
      name.startsWith("x-forwarded-") ||
      name.startsWith("proxy-")
    )
      throw new CrawlError("请求头包含不允许自定义的传输、身份或代理字段。");
    headers[name] = value;
  }
  if (typeof api.body !== "string" || Buffer.byteLength(api.body) > 16_384)
    throw new CrawlError("JSON 请求体不能超过 16 KB。");
  if (api.method === "POST" && api.body.trim()) {
    try {
      JSON.parse(api.body);
    } catch {
      throw new CrawlError("POST 请求体必须是有效 JSON。");
    }
  }
  if (api.method === "GET" && api.body.trim())
    throw new CrawlError("GET 请求不支持请求体。");
  if (
    typeof api.pageParam !== "string" ||
    (api.pageParam && !/^[a-zA-Z_][\w.-]{0,49}$/.test(api.pageParam))
  )
    throw new CrawlError("分页参数名称无效。");
  if (
    !Number.isInteger(api.startPage) ||
    api.startPage < 0 ||
    api.startPage > 10000
  )
    throw new CrawlError("起始页码应在 0 到 10000 之间。");
  return {
    method: api.method,
    headers,
    body: api.body,
    pageParam: api.pageParam,
    startPage: api.startPage,
  };
}
