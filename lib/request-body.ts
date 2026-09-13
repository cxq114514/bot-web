import { CrawlError } from "./safe-fetch";

export async function readConfigBody(request: Request, timeoutMs = 10_000) {
  const reader = request.body?.getReader();
  if (!reader) throw new CrawlError("请求内容不能为空。");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    const fail = (message: string) => {
      reject(new CrawlError(message, 408));
      void reader.cancel().catch(() => {});
    };
    abort = () => fail("请求已取消。");
    request.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => fail("读取采集配置超时，请重新提交。"), timeoutMs);
    if (request.signal.aborted) abort();
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await Promise.race([interrupted, reader.read()]);
      if (done) break;
      size += value.length;
      if (size > 32_768) {
        void reader.cancel().catch(() => {});
        throw new CrawlError("采集配置过大。", 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
