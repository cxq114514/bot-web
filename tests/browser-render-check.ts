import assert from "node:assert/strict";
import { renderPage } from "../lib/browser-render";
import { extractPage } from "../lib/extract";
import { initialConfig } from "../lib/types";

const initial = {
  url: "https://example.com/dynamic",
  status: 200,
  headers: { "content-type": "text/html" },
  body: Buffer.from(
    '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>',
  ),
};
const config = {
  ...initialConfig,
  renderMode: "browser" as const,
  renderWaitMs: 100,
  waitSelector: ".loaded",
  rowSelector: ".loaded",
  fields: [{ id: "name", name: "名称", selector: ":scope", attribute: "text" }],
};
const requested: string[] = [];
const checks: string[] = [];
const warnings: string[] = [];
async function main() {
  const rendered = await renderPage(
    initial,
    config,
    new AbortController().signal,
    async (url) => {
      checks.push(url.href);
    },
    (message) => warnings.push(message),
    async (url, signal, before) => {
      signal.throwIfAborted();
      requested.push(url);
      await before?.(new URL(url));
      if (url.endsWith("/app.js"))
        return {
          url,
          status: 200,
          headers: { "content-type": "application/javascript" },
          body: Buffer.from(`
    fetch('/data').then(r=>r.json()).then(data=> { document.querySelector('#root').innerHTML='<div class="loaded">'+data.name+'</div>'; });
    fetch('http://127.0.0.1/private').catch(()=>{});
    fetch('/mutate', {method:'POST', body:'no'}).catch(()=>{});
    new WebSocket('wss://example.com/socket');
    const image = new Image(); image.src='/tracking.png';
  `),
        };
      if (url.endsWith("/data"))
        return {
          url,
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from('{"name":"动态内容已加载"}'),
        };
      throw new Error("Unexpected browser request: " + url);
    },
  );
  assert.equal(
    extractPage(rendered.body, config, initial.url).rows[0].名称,
    "动态内容已加载",
  );
  assert.deepEqual(requested.sort(), [
    "https://example.com/app.js",
    "https://example.com/data",
  ]);
  assert.deepEqual(checks.sort(), requested);
  assert.ok(warnings.some((message) => message.includes("跳过")));
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), 300);
  await assert.rejects(
    renderPage(
      initial,
      { ...config, waitSelector: ".never" },
      aborter.signal,
      async () => {},
      () => {},
    ),
  );
  clearTimeout(timer);
  console.log(
    "PASS: real Chromium executes external script + JSON fetch, blocks private/POST/media/socket paths, and cleans up cancellation",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
