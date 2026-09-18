import { chromium, type Browser } from "playwright";
import { existsSync } from "node:fs";
import {
  CrawlError,
  parseTarget,
  safeGet,
  type ResponseData,
} from "./safe-fetch";
import type { CrawlConfig } from "./types";

export function allowedBrowserRequest(
  url: string,
  method: string,
  resourceType: string,
) {
  parseTarget(url);
  return (
    method === "GET" &&
    ["document", "script", "stylesheet", "xhr", "fetch"].includes(resourceType)
  );
}

// Chromium has no direct network path. Every permitted resource is fulfilled by
// the same DNS-pinned transport as static collection, including redirects.
export async function renderPage(
  initial: ResponseData,
  config: CrawlConfig,
  parentSignal: AbortSignal,
  beforeRequest: (url: URL) => Promise<void>,
  warn: (message: string) => void,
  get = safeGet,
): Promise<ResponseData> {
  const controller = new AbortController();
  const signal = AbortSignal.any([
    parentSignal,
    controller.signal,
    AbortSignal.timeout(30_000),
  ]);
  let browser: Browser | undefined;
  const abort = () => {
    void browser?.close().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  let blocked = 0;
  let failed = 0;
  let requested = 0;
  let bytes = initial.body.length;
  try {
    signal.throwIfAborted();
    try {
      browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
        timeout: 15000,
        ...(process.env.CRAWLSPACE_BROWSER_CHANNEL
          ? { channel: process.env.CRAWLSPACE_BROWSER_CHANNEL }
          : !existsSync(chromium.executablePath())
            ? { channel: "chrome" }
            : {}),
        args: [
          "--proxy-server=http://127.0.0.1:9",
          "--proxy-bypass-list=<-loopback>",
          "--host-resolver-rules=MAP * ~NOTFOUND",
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--disable-background-networking",
        ],
      });
    } catch {
      throw new CrawlError(
        "无法启动动态渲染浏览器。请在服务器安装 Chromium（npm run browser:install），并确认运行环境支持浏览器沙箱。",
        503,
      );
    }
    signal.throwIfAborted();
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      userAgent: "Crawlspace/1.0",
      viewport: { width: 1280, height: 900 },
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    context.on("page", (popup) => {
      if (popup !== page) void popup.close().catch(() => {});
    });
    let servedInitial = false;
    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        signal.throwIfAborted();
        if (
          !allowedBrowserRequest(
            request.url(),
            request.method(),
            request.resourceType(),
          ) ||
          (request.isNavigationRequest() &&
            (request.frame() !== page.mainFrame() || servedInitial)) ||
          ++requested > 60
        ) {
          blocked++;
          await route.abort();
          return;
        }
        let response: ResponseData;
        if (
          !servedInitial &&
          request.isNavigationRequest() &&
          request.url() === initial.url
        ) {
          servedInitial = true;
          response = initial;
        } else {
          response = await get(request.url(), signal, beforeRequest);
          bytes += response.body.length;
        }
        if (bytes > 15 * 1024 * 1024)
          throw new CrawlError("渲染资源超过 15 MB。");
        if (response.status < 200 || response.status >= 300) failed++;
        const headers: Record<string, string> = {};
        for (const name of [
          "content-type",
          "content-encoding",
          "access-control-allow-origin",
          "content-security-policy",
        ]) {
          const value = response.headers[name];
          if (typeof value === "string") headers[name] = value;
        }
        // Prevent workers/frames from creating network paths outside page routes.
        if (request.isNavigationRequest())
          headers["content-security-policy"] = [
            headers["content-security-policy"],
            "worker-src 'none'; frame-src 'none'; object-src 'none'",
          ]
            .filter(Boolean)
            .join(", ");
        await route.fulfill({
          status: response.status,
          headers,
          body: response.body,
        });
      } catch {
        failed++;
        await route.abort().catch(() => {});
      }
    });
    await page.goto(initial.url, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    if (config.waitSelector)
      await page.waitForSelector(config.waitSelector, {
        state: "attached",
        timeout: 15000,
      });
    await page.waitForTimeout(config.renderWaitMs ?? 2000);
    signal.throwIfAborted();
    const body = Buffer.from(await page.content());
    if (body.length > 3 * 1024 * 1024)
      throw new CrawlError("渲染后的网页超过 3 MB。");
    if (failed)
      warn(
        `${failed} 个渲染资源加载失败或未通过访问检查，动态内容可能不完整。`,
      );
    if (blocked)
      warn(
        `已跳过 ${blocked} 个图片、媒体、非 GET 请求或额外导航；依赖这些请求的内容可能缺失。`,
      );
    return {
      ...initial,
      body,
      headers: {
        ...initial.headers,
        "content-type": "text/html; charset=utf-8",
      },
    };
  } catch (error) {
    if (parentSignal.aborted) parentSignal.throwIfAborted();
    if (error instanceof CrawlError) throw error;
    throw new CrawlError(
      signal.aborted
        ? "动态渲染超过 30 秒，已停止。"
        : "动态渲染失败或等待元素超时，请检查等待选择器和页面。",
      408,
    );
  } finally {
    controller.abort();
    signal.removeEventListener("abort", abort);
    await browser?.close().catch(() => {});
  }
}
