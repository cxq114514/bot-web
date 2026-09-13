# 抓取 API

`POST /api/crawl` 接收 JSON，返回 `application/x-ndjson` 事件流。HTML 为默认模式，接口模式设 `sourceType: "json"`。浏览器和程序调用使用同一套验证与限制。

所有操作都必须先由操作者阅读并同意 [免责声明](../DISCLAIMER.md)，随后携带 `X-Crawlspace-Consent: 2026-09-13-v2`。缺失或版本过期返回 403，不读取配置或发起目标请求。该声明确认不是账户鉴权。

## 试运行、自动分析和动态渲染

- `operation`：`crawl`（默认）、`test`（规则试运行）、`analyze`（响应分析）。`test` 和 `analyze` 在服务器强制只采一页；`analyze` 不要求有效的当前字段规则，但接口请求配置仍会验证。
- `renderMode`：`static`（默认）或 `browser`，后者仅支持 HTML。
- `renderWaitMs`：0～10000 的整数，默认 2000。
- `waitSelector`：可选 CSS 选择器，最长 300 字符；动态模式等待该元素出现（最多 15 秒）后再额外等待。单页整个渲染最多 30 秒，仍计入任务 120 秒总时限。

`analyze` 根据实际内容识别 HTML／JSON并推荐规则；非 HTML／JSON 响应返回错误。分析不自动修改客户端配置。试运行和分析使用同一套并发、体积、限速与出站检查。动态模式的运行依赖与资源限制见 [README](../README.md#动态网页采集)。

## HTML 请求

```json
{
  "sourceType": "html",
  "url": "https://quotes.toscrape.com/",
  "rowSelector": ".quote",
  "fields": [
    { "id": "text", "name": "名言", "selector": ".text", "attribute": "text" },
    {
      "id": "author",
      "name": "作者",
      "selector": ".author",
      "attribute": "text"
    }
  ],
  "nextSelector": ".pager .next a",
  "maxPages": 2
}
```

列表容器留空时整个页面作为一条记录；字段相对于每个容器查询。`:scope` 选择容器本身。`text` 提取文字，其他属性名提取对应 HTML 属性。

## 自定义 JSON 接口

`api.example.com` 是需要替换的示意域名。

```json
{
  "sourceType": "json",
  "url": "https://api.example.com/catalog?limit=20",
  "rowSelector": "data.items",
  "fields": [
    { "id": "id", "name": "ID", "selector": "id", "attribute": "text" },
    {
      "id": "title",
      "name": "名称",
      "selector": "details.title",
      "attribute": "text"
    }
  ],
  "nextSelector": "",
  "maxPages": 3,
  "api": {
    "method": "GET",
    "headers": { "Accept-Language": "zh-CN" },
    "body": "",
    "pageParam": "page",
    "startPage": 1
  }
}
```

接口模式需要完整的 `api` 对象。`pageParam` 可为空，此时只能采集 1 页。`startPage` 支持 0。页码写入 URL 查询参数，覆盖同名参数，空列表提前结束；请确认接口支持该方式，程序不会检测接口忽略页码的情况。

对于明确获授权的只读 POST 查询接口，设 `method: "POST"`，`body` 为序列化 JSON 字符串，例如 `"{\"query\":\"books\"}"`，默认发送 `Content-Type: application/json`。GET 不接受非空请求体。

可通过 `Authorization` 或 `X-API-Key` 请求头填写你有权使用的凭据。不要把真实密钥放进示例文件、Git、URL 路径或提交说明。保存规则时请求头、请求体和接口查询参数清空；程序调用方自行管理凭据。

### JSON 路径

| 写法                          | 含义                       |
| ----------------------------- | -------------------------- |
| `$` 或空的数据列表路径        | 整个响应；根数组逐元素输出 |
| `data.items` / `$.data.items` | 嵌套对象下的列表           |
| `author.name`                 | 每条记录的嵌套字段         |
| `items[0].id`                 | 数字数组下标               |

字段路径不能为空，需要整条记录时使用 `$`。不支持通配符、过滤器、脚本和原型访问。布尔值、0 保留为字符串；对象和数组序列化为 JSON 字符串；缺失值为空。

## 读取事件流

```js
const response = await fetch("http://127.0.0.1:3000/api/crawl", {
  method: "POST",
  // 仅在实际操作者已阅读并同意当前版本声明后传入此确认。
  headers: { "Content-Type": "application/json", "X-Crawlspace-Consent": "2026-09-13-v2" },
  body: JSON.stringify(config),
});
if (!response.ok) throw new Error((await response.json()).error);
const reader = response.body.getReader();
const decoder = new TextDecoder();
let pending = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  pending += decoder.decode(value, { stream: true });
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) if (line.trim()) console.log(JSON.parse(line));
}
pending += decoder.decode();
if (pending.trim()) console.log(JSON.parse(pending));
```

- `log`：`message` 和 `level`（info／success／warning）。警告发现时即时发送，调用方应保留，即使之后任务失败或取消。
- `page`：页面元信息 `page` 和本页记录 `rows`。
- `probe`：仅试运行／分析返回。`report` 包含 `operation`、HTTP `status`、`contentType`、实际 `sourceType`、是否 `rendered`、匹配总数 `matched`、保留数 `sampled`、各字段的 `filled` 非空数与选择器，以及 `notes`。分析另附 `suggested`（`sourceType`、`rowSelector`、`fields`、`nextSelector`）。命中率以 `sampled` 为分母，最多计算本页保留的 200 条。
- `done`：`result` 含 `rows`、`fields`、`pages`、`warnings`、`duration`（毫秒）和 `completedAt`。
- `error`：流已启动后的错误，`message` 是用户可读原因。不要只凭 HTTP 200 判断任务成功，必须收到 `done`。

配置错误返回 4xx JSON 的 `error` 属性。传入 AbortSignal 或断开连接可停止任务；已收到的数据仍可保留。结果的 `_source` 是来源地址，接口来源省略 URL 查询参数。

## 请求限制

配置最多 32 KB；POST JSON 请求体最多 16 KB；自定义请求头最多 16 个，每个值最多 2048 字符。只支持公网 HTTP(S) 标准端口 80／443。自定义 GET 不跨源跳转，POST 不跟随跳转；Cookie、Host、代理／转发和传输控制头不可覆盖。

两种模式均检查 robots.txt，检查时不携带自定义头或请求体。同一进程内同源请求共享至少 1 秒的间隔，并遵守不超过 10 秒的 Crawl-delay；不跨进程协调。每进程最多 3 个任务（包含正在读取配置的请求）；配置读取最多 10 秒，超时返回 408。每任务最多 10 页，每页 200 条，每条 12 字段。响应体最多 3 MB，输出每页最多 1 MB、任务最多 5 MB；网络请求 15 秒超时、任务从读取配置开始共 120 秒超时。

当前 API 无账户鉴权，适合个人本地运行。对外服务前需要加入认证、共享限流和出站控制。请阅读 [免责声明](../DISCLAIMER.md)。

历史记录由浏览器在收到任务结果后写入 IndexedDB，API 不保存历史。页面导出的 JSON 会带 `selection`，说明原始条数和筛选条件；`rows` 是当前筛选／排序／去重后的记录，`pages` 仍为原任务页面统计。
