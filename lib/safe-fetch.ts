import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { CRAWLSPACE_USER_AGENT } from "./version";

export class CrawlError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function parseTarget(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CrawlError("请输入完整的网址，例如 https://example.com");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new CrawlError("仅支持 HTTP 和 HTTPS 网页。");
  if (url.username || url.password)
    throw new CrawlError("网址不能包含用户名或密码。");
  if (url.port && !["80", "443"].includes(url.port))
    throw new CrawlError("仅支持标准网页端口 80 和 443。");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname.includes(".") && !hostname.includes(":"))
    throw new CrawlError("请输入公网网站地址。");
  if (
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    throw new CrawlError("不支持本机或内网地址。");
  if (ipaddr.isValid(hostname) && !publicAddress(hostname))
    throw new CrawlError("不支持本机、内网或保留地址。");
  url.hash = "";
  return url;
}

export type ResponseData = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: string;
};
export type RequestOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  sameOrigin?: boolean;
};
const MAX_BYTES = 3 * 1024 * 1024;

async function requestOnce(
  url: URL,
  parentSignal: AbortSignal,
  options: RequestOptions,
): Promise<ResponseData> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(15_000)]);
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await new Promise<Awaited<ReturnType<typeof resolveHost>>>(
    (resolve, reject) => {
      const abort = () => reject(new CrawlError("请求已取消或域名解析超时。"));
      signal.addEventListener("abort", abort, { once: true });
      resolveHost(hostname)
        .then(resolve, () =>
          reject(new CrawlError("无法解析该域名，请检查网址和网络。")),
        )
        .finally(() => signal.removeEventListener("abort", abort));
    },
  );
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicAddress(address))
  )
    throw new CrawlError("目标域名解析到了内网或保留地址，无法抓取。");
  signal.throwIfAborted();
  const address = addresses.find((item) => item.family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    // Connect to the validated IP. Preserve the original Host and TLS SNI to prevent DNS rebinding.
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: address.address,
        family: address.family,
        servername: hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: options.method ?? "GET",
        signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          ...options.headers,
          Host: url.host,
          "User-Agent": CRAWLSPACE_USER_AGENT,
          "Accept-Encoding": "identity",
          ...(options.body
            ? { "Content-Length": Buffer.byteLength(options.body) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const status = res.statusCode ?? 502;
        if ([301, 302, 303, 307, 308].includes(status)) {
          resolve({
            status,
            headers: res.headers,
            body: Buffer.alloc(0),
            url: url.href,
          });
          res.destroy();
          return;
        }
        if (Number(res.headers["content-length"] ?? 0) > MAX_BYTES) {
          reject(new CrawlError("网页超过 3 MB，已停止抓取。"));
          res.destroy();
          return;
        }
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            reject(new CrawlError("网页超过 3 MB，已停止抓取。"));
            res.destroy();
          } else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks),
            url: url.href,
          }),
        );
        res.on("error", () =>
          reject(new CrawlError("读取网页失败，请稍后重试。")),
        );
      },
    );
    req.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        new CrawlError(
          signal.aborted
            ? "请求已取消或超过 15 秒，请稍后重试。"
            : error.code === "ENOTFOUND"
              ? "找不到该网站，请检查网址。"
              : "无法连接目标网站，请检查网络或稍后重试。",
        ),
      ),
    );
    req.end(options.body || undefined);
  });
}

async function resolveHost(hostname: string) {
  if (ipaddr.isValid(hostname))
    return [
      {
        address: hostname,
        family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6,
      },
    ];
  return lookup(hostname, { all: true, verbatim: true });
}

export async function safeGet(
  value: string,
  signal: AbortSignal,
  beforeRequest?: (url: URL) => Promise<void>,
): Promise<ResponseData> {
  return safeRequest(value, signal, {}, beforeRequest);
}

export function redirectTarget(
  current: URL,
  location: string,
  origin: string,
  options: RequestOptions,
): URL {
  if (options.method === "POST")
    throw new CrawlError(
      "POST 接口返回重定向；请填写最终接口地址，避免重复提交。",
    );
  let target: URL;
  try {
    target = parseTarget(new URL(location, current).href);
  } catch (error) {
    if (error instanceof CrawlError) throw error;
    throw new CrawlError("网站返回了无效的跳转地址。");
  }
  if (options.sameOrigin && target.origin !== origin)
    throw new CrawlError(
      "自定义接口不允许跨站重定向，请直接填写最终接口地址。",
    );
  return target;
}

export async function safeRequest(
  value: string,
  signal: AbortSignal,
  options: RequestOptions = {},
  beforeRequest?: (url: URL) => Promise<void>,
): Promise<ResponseData> {
  let url = parseTarget(value);
  const origin = url.origin;
  for (let redirects = 0; redirects <= 5; redirects++) {
    await beforeRequest?.(url);
    const response = await requestOnce(url, signal, options);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (!response.headers.location)
      throw new CrawlError("网站返回了无效的跳转地址。");
    url = redirectTarget(url, response.headers.location, origin, options);
  }
  throw new CrawlError("网站跳转次数过多，请使用最终网页地址。");
}
