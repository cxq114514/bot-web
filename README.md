# Crawlspace · Next.js 多网站采集工作台

[![Validate crawler](https://github.com/cxq114514/bot-web/actions/workflows/ci.yml/badge.svg)](https://github.com/cxq114514/bot-web/actions/workflows/ci.yml)

基于 Next.js App Router、TypeScript 和 Cheerio。支持 HTML 网页、多站点规则和自定义 JSON 接口，前端和流式抓取 API 在同一个项目中运行。

## 功能

- **多网站**：Books to Scrape、Quotes to Scrape 两个公开练习网站预设，以及通用网页、通用文章和 JSON 接口模板。按完整域名识别已知站点，其他网站可自定义规则。
- **规则管理**：按名称保存、加载、修改和删除最多 20 套本地规则；选择「新规则 / 另存为」可以另存一份。
- **HTML 采集**：CSS 选择器、列表循环、文字／属性提取、相对链接补全、中文编码识别和同源分页。
- **自定义接口**：GET／POST、自定义请求头、JSON 请求体、嵌套字段映射和 URL 页码参数。POST 只应配置明确获授权的只读查询接口。
- **结果处理**：实时日志、停止任务、表格分页、JSON 预览与复制、CSV／JSON 导出。
- **使用说明**：页面内提示、独立的 `/disclaimer` 页面和 [免责声明](DISCLAIMER.md)。

## 启动

需要 Node.js 20.9 或更高版本，CI 使用 Node.js 24。

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:3000。选择网站预设或点击「试试书籍采集示例」，再点击「开始采集」。通用模板需要按目标网站结构调整，不承诺所有网站无需配置即可采集。

```bash
npm test
npm run typecheck
npm run build
npm start
```

## 网页规则

填写 HTTP(S) 网址。列表页面填写重复条目的 CSS 选择器，每个匹配容器输出一条记录；留空时整个页面作为一条记录。

字段配置包括名称、容器内的 CSS 选择器和提取属性：`text` 为文字，`href` 为链接，`src` 为图片地址，也支持 `title`、`content`、`datetime` 等属性。`:scope` 提取容器本身。多个匹配值按换行合并。

采集多页时填写下一页链接的选择器，程序只跟随同源分页。可随时停止，已收到的数据仍然可以导出。CSV 使用 UTF-8 BOM 并做了公式注入防护。

## 自定义接口

切换到「自定义接口」，填写接口网址、GET／POST、请求头（JSON 字符串对象）和可选 POST JSON 请求体。

数据列表路径相对于响应根节点，例如 `data.items`，根数组填写 `$`。字段路径相对于每条记录，例如 `author.name`，也支持 `items[0].id`。不支持通配符、过滤表达式或递归查询。

采集多页时填写页码查询参数和起始页码，程序每页将该 URL 参数加一，返回空列表时停止。这不是 offset 步长、游标或 POST 请求体分页；需目标接口支持 URL 页码参数。

完整配置、响应事件、请求限制和调用示例见 [API 文档](docs/API.md)。

## 保存与隐私

填写站点规则名称后点击「保存规则」。规则存入当前浏览器的 localStorage，下次打开恢复最后保存的配置；其他规则可从已保存列表中加载，不跨设备同步。

自定义接口请求头、请求体和 URL 查询参数不随规则保存，重新加载后需重新填写。凭据会随任务经过本工具的运行服务器转发给目标接口，请只使用可信部署，且不要把密钥放在 URL 路径中。接口来源在结果和日志中省略查询参数；目标返回数据可能仍含敏感信息，导出前请核对。

采集结果仅保留在页面内存中，刷新会清空，请及时导出。

## 运行范围

- 采集原始 HTML 或接口 JSON，不执行网页 JavaScript，不包含浏览器渲染、网页登录、验证码处理或反爬绕过。
- 两种模式均检查 robots.txt。禁止或无法确认规则时停止，遵守不超过 10 秒的 Crawl-delay；同一进程的同源请求共享至少 1 秒的间隔（包括 robots 检查和重定向）。robots.txt 不构成访问或数据使用授权。
- 最多 10 页、每页 200 条、12 个字段；响应体最多 3 MB，提取结果每页最多 1 MB、任务最多 5 MB；网络请求超时 15 秒，任务总超时 120 秒。
- 每个 Node.js 进程最多 3 个并发采集任务（含正在读取配置的请求），配置读取最多 10 秒，任务总时限从开始读取配置计起；限流状态不跨进程共享。
- 仅允许公网 HTTP(S) 标准端口，拦截私网、回环和保留地址；全量校验 DNS，并固定到验证过的 IP 连接，同时保留 Host／TLS SNI。每次重定向重新校验。
- 自定义 GET 只跟随同源重定向；POST 不跟随重定向。禁止覆盖 Host、Cookie、代理／转发、编码和连接等传输头。robots 请求不携带自定义头或请求体。
- 结果以纯文本显示，不执行抓取 HTML。图片字段只提取地址，不自动加载外部图片。

## 部署

抓取接口依赖 Node.js DNS、HTTP 和 HTTPS 网络模块。使用支持 Node.js 的主机或容器运行 `npm run build` 和 `npm start`；不是静态导出项目，未适配 Cloudflare Workers／Sites。

默认监听 `127.0.0.1`。容器内需要监听所有网卡时使用 `npx next start --hostname 0.0.0.0`。当前是个人本地工具，无账户鉴权；公网部署需要补充访问控制、共享限流、出站访问策略，并确认平台支持 120 秒流式请求。

## 验证

`npm test` 包含不依赖外网的解析、安全和任务编排测试。GitHub Actions 在 PR 和 main 推送时执行测试与生产构建。

启动本地服务后，在安装了 Chrome 的环境运行：

```bash
node tests/browser-check.mjs
node tests/features-browser.mjs
```

浏览器验收依赖外部练习网站，不作为 CI 前置条件。可通过 `CRAWLSPACE_QA_URL` 设置服务地址，通过 `CRAWLSPACE_QA_OUTPUT` 设置截图目录，默认保存到被 Git 忽略的 `test-results/`。

另有不访问外部网站的浏览器回归检查，验证规则恢复、失败任务的 JSON 导出警告、免责页面及手机布局。启动本地服务后设置 `CRAWLSPACE_QA_URL` 为服务地址，运行 `node tests/regressions-browser.mjs`（默认地址为 `http://127.0.0.1:3101`，截图写入 `test-results/`）。
