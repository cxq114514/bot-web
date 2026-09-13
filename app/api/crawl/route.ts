import { crawl } from "@/lib/crawler";
import { validateConfig } from "@/lib/extract";
import { CrawlError, parseTarget } from "@/lib/safe-fetch";
import type { CrawlEvent } from "@/lib/types";
import { readConfigBody } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
let running = 0;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const incoming = new URL(origin);
      // Next may internally use localhost while the browser uses 127.0.0.1.
      // Compare against the actual HTTP Host, never an untrusted forwarded host.
      const expected = new URL(
        `${incoming.protocol}//${request.headers.get("host") ?? new URL(request.url).host}`,
      );
      if (
        !["http:", "https:"].includes(incoming.protocol) ||
        incoming.origin !== expected.origin
      )
        throw new Error();
    } catch {
      return Response.json(
        { error: "不允许跨站发起采集任务。" },
        { status: 403 },
      );
    }
  }
  if (running >= 3)
    return Response.json(
      { error: "当前采集任务较多，请稍后重试。" },
      { status: 429 },
    );
  running++;
  const aborter = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    aborter.signal,
    AbortSignal.timeout(120_000),
  ]);
  let config;
  try {
    config = validateConfig(await readConfigBody(request));
    parseTarget(config.url);
  } catch (error) {
    running--;
    return Response.json(
      {
        error:
          error instanceof CrawlError ? error.message : "请检查采集配置格式。",
      },
      { status: error instanceof CrawlError ? error.status : 400 },
    );
  }
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const emit = (event: CrawlEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
          aborter.abort();
        }
      };
      crawl(config, signal, emit)
        .then((result) => emit({ type: "done", result }))
        .catch((error) => {
          emit({
            type: "error",
            message: signal.aborted
              ? "采集已取消或超过 120 秒，已获取的数据仍可导出。"
              : error instanceof CrawlError
                ? error.message
                : "采集失败，请检查网址和字段规则后重试。",
          });
        })
        .finally(() => {
          running--;
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      aborter.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
