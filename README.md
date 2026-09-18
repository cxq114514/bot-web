<h1 align="center">
  <img src="https://s.luogu.me/f/zYfQ/%E4%B8%8B%E8%BD%BD.svg" alt="Crawlspace 图标" width="48" height="48">
  Crawlspace
</h1>
<p align="center">基于 Next.js 的多网站采集工作台</p>

<p align="center">
  <a href="https://github.com/cxq114514/bot-web/actions/workflows/ci.yml"><img src="https://github.com/cxq114514/bot-web/actions/workflows/ci.yml/badge.svg" alt="Validate crawler"></a>
  <a href="https://github.com/cxq114514/bot-web/stargazers"><img src="https://img.shields.io/github/stars/cxq114514/bot-web?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/cxq114514/bot-web/issues"><img src="https://img.shields.io/github/issues/cxq114514/bot-web?style=flat-square" alt="Issues"></a>
  <a href="https://github.com/cxq114514/bot-web/network/members"><img src="https://img.shields.io/github/forks/cxq114514/bot-web?style=flat-square" alt="Forks"></a>
  <a href="https://github.com/cxq114514/bot-web/blob/main/LICENSE"><img src="https://img.shields.io/github/license/cxq114514/bot-web?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js">
  <img src="https://img.shields.io/badge/Node.js-20.9%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 20.9+">
</p>

<p align="center">
  基于 Next.js App Router、TypeScript 和 Cheerio。支持 HTML 网页、多站点规则和自定义 JSON 接口，前端和流式抓取 API 在同一个项目中运行。
</p>

## 功能

- **多网站**：Books to Scrape、Quotes to Scrape 两个公开练习网站预设，以及通用网页、通用文章和 JSON 接口模板。按完整域名识别已知站点，其他网站可自定义规则。
- **规则管理**：按名称保存、加载、修改和删除最多 20 套本地规则；选择「新规则 / 另存为」可以另存一份。
- **HTML 采集**：CSS 选择器、列表循环、文字／属性提取、相对链接补全、中文编码识别和同源分页。
- **自定义接口**：GET／POST、自定义请求头、JSON 请求体、嵌套字段映射和 URL 页码参数。POST 只应配置明确获授权的只读查询接口。
- **结果处理**：实时日志、停止任务、表格分页、JSON 预览与复制、CSV／JSON 导出。
- **采集历史**：使用 IndexedDB 自动保存任务结果、规则快照和完成／失败／停止状态；查看、载入规则、单条删除和清空历史。最多 20 次、结果合计 50 MB，超限移除最早记录。
- **规则试运行**：仅抓一页，显示匹配数量、实际保留数量及各字段的非空命中率，不要求先配置多页分页。
- **自动分析响应**：识别 HTML／JSON，按重复元素、表格列或嵌套数据列表推断规则；预览后点击「应用分析规则」。使用本地结构分析，不需要 AI 密钥；不承诺自动推断始终准确。
- **筛选与去重**：关键词、指定列、空值筛选、按列排序、按所有字段或指定字段去重。预览、复制、CSV／JSON 导出使用当前筛选结果，原始历史数据保留；去重保留首条，不合并空标识。
- **动态网页**：可选 Playwright 浏览器渲染，支持额外等待时间与等待元素；提取 JavaScript 加载后的 DOM。
- **强制免责声明**：首次打开必须主动勾选并同意；按版本记录确认时间，声明更新后再次确认。采集、试运行和分析 API 同样要求当前版本的确认。独立的 `/disclaimer` 页面和 [免责声明](DISCLAIMER.md) 随时可查阅。

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

输入网址后，可先点「自动分析响应」预览并应用推荐规则，再用「规则试运行」检查当前字段。试运行和分析都只请求当前页，并自动保存历史。

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

任务结束（包括失败和停止）后自动保存历史；刷新后到「采集历史」查看。浏览器存储被禁用、空间不足或任务中途关闭页面时，历史可能未保存，界面会在可检测到保存失败时提示；请及时导出重要结果。历史规则快照也不保存接口请求头、请求体和查询参数，重新运行前需补齐。删除历史不删除独立保存的规则。

## 动态网页采集

在「网页加载方式」选择「动态网页 · 浏览器渲染」。可设置 0～10 秒额外等待，或填写一个应在页面加载后出现的 CSS 选择器。默认等待 2 秒，每页渲染上限 30 秒。

服务器建议安装 Chromium：

```bash
npm run browser:install
```

如果未安装下载版 Chromium，工具会尝试本机 Chrome；也可设置 `CRAWLSPACE_BROWSER_CHANNEL=chrome`。Linux 主机可使用 `npx playwright install --with-deps chromium` 安装系统依赖，运行账户需要支持 Chromium 沙箱。浏览器 API 依据 [Playwright 官方文档](https://playwright.dev/docs/api/class-browsercontext) 实现。

渲染模式把允许的 GET 文档、脚本、样式、fetch／XHR 请求交给现有安全抓取器，执行 DNS 固定、重定向检查、robots 检查和限速。每页最多 60 个允许类型的资源请求，资源总计最多 15 MB，单响应及渲染后 HTML 各不超过 3 MB。图片、媒体、字体、POST、WebSocket、Worker、iframe、额外导航和弹窗不加载；浏览器直接联网路径被禁用。不包含登录、验证码、滚动加载或点击分页，依赖这些行为的网站可能不完整，请查看警告。

## 运行范围

- 支持原始 HTML、接口 JSON 和可选浏览器渲染，不包含网页登录、验证码处理或反爬绕过。
- 两种模式均检查 robots.txt。禁止或无法确认规则时停止，遵守不超过 10 秒的 Crawl-delay；同一进程的同源请求共享至少 1 秒的间隔（包括 robots 检查和重定向）。robots.txt 不构成访问或数据使用授权。
- 最多 10 页、每页 200 条、12 个字段；响应体最多 3 MB，提取结果每页最多 1 MB、任务最多 5 MB；网络请求超时 15 秒，任务总超时 120 秒。
- 每个 Node.js 进程最多 3 个并发采集任务（含正在读取配置的请求），配置读取最多 10 秒，任务总时限从开始读取配置计起；限流状态不跨进程共享。
- 仅允许公网 HTTP(S) 标准端口，拦截私网、回环和保留地址；全量校验 DNS，并固定到验证过的 IP 连接，同时保留 Host／TLS SNI。每次重定向重新校验。
- 自定义 GET 只跟随同源重定向；POST 不跟随重定向。禁止覆盖 Host、Cookie、代理／转发、编码和连接等传输头。robots 请求不携带自定义头或请求体。
- 结果以纯文本显示，不执行抓取 HTML。图片字段只提取地址，不自动加载外部图片。

## 部署

抓取接口依赖 Node.js DNS、HTTP 和 HTTPS 网络模块。使用支持 Node.js 的主机或容器运行 `npm run build` 和 `npm start`；不是静态导出项目，未适配 Cloudflare Workers／Sites。

默认监听 `127.0.0.1`。容器内需要监听所有网卡时使用 `npx next start --hostname 0.0.0.0`。当前是个人本地工具，无账户鉴权；公网部署需要补充访问控制、共享限流、出站访问策略，并确认平台支持 120 秒流式请求。

## 第三方许可证

针对 sharp／libvips 的 14 条 LGPL 相关扫描告警，已记录依赖来源、平台包清单、分发义务与处理建议，详见 [依赖许可证核查](docs/DEPENDENCY-LICENSE-REVIEW.md)。本次保留依赖和真实许可声明，未自动关闭告警；分发运行包或镜像前仍需核对实际组件。

## 验证

`npm test` 包含不依赖外网的解析、安全和任务编排测试。GitHub Actions 在 PR 和 main 推送时执行测试与生产构建。

启动本地服务后，在安装了 Chrome 的环境运行：

```bash
node tests/browser-check.mjs
node tests/features-browser.mjs
```

浏览器验收依赖外部练习网站，不作为 CI 前置条件。可通过 `CRAWLSPACE_QA_URL` 设置服务地址，通过 `CRAWLSPACE_QA_OUTPUT` 设置截图目录，默认保存到被 Git 忽略的 `test-results/`。

另有不访问外部网站的浏览器回归检查，验证规则恢复、失败任务的 JSON 导出警告、免责页面及手机布局。启动本地服务后设置 `CRAWLSPACE_QA_URL` 为服务地址，运行 `node tests/regressions-browser.mjs`（默认地址为 `http://127.0.0.1:3101`，截图写入 `test-results/`）。

新增离线验证（UI 检查默认地址为 `http://127.0.0.1:3102`）：

```bash
node tests/workbench-browser.mjs
node tests/history-browser.mjs
npx tsx tests/browser-render-check.ts
```

前两项需要启动本地服务；浏览器渲染检查直接运行真实 Chrome／Chromium，以受控响应测试脚本执行、JSON 加载、资源限制和取消，无需目标外网。UI 检查使用本机 Chrome，覆盖强制同意、试运行、分析应用、筛选去重导出、历史恢复／删除、失败／停止任务和手机布局。
