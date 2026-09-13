import { bookConfig, initialConfig, type CrawlConfig } from "./types";

export const defaultApi = {
  method: "GET" as const,
  headers: {},
  body: "",
  pageParam: "",
  startPage: 1,
};
export const jsonConfig: CrawlConfig = {
  url: "",
  sourceType: "json",
  api: { ...defaultApi },
  rowSelector: "data.items",
  nextSelector: "",
  maxPages: 1,
  fields: [
    { id: "id", name: "ID", selector: "id", attribute: "text" },
    { id: "title", name: "标题", selector: "title", attribute: "text" },
  ],
};
export const quoteConfig: CrawlConfig = {
  url: "https://quotes.toscrape.com/",
  sourceType: "html",
  rowSelector: ".quote",
  nextSelector: ".pager .next a",
  maxPages: 1,
  fields: [
    { id: "quote", name: "名言", selector: ".text", attribute: "text" },
    { id: "author", name: "作者", selector: ".author", attribute: "text" },
    { id: "tags", name: "标签", selector: ".tags .tag", attribute: "text" },
  ],
};
export const presets = [
  {
    id: "generic",
    name: "通用网页",
    description: "标题、描述与链接；按实际网站调整选择器",
    config: initialConfig,
  },
  {
    id: "books",
    name: "Books to Scrape · 书籍",
    description: "公开练习网站，支持书名、价格、库存和分页",
    config: bookConfig,
  },
  {
    id: "quotes",
    name: "Quotes to Scrape · 名言",
    description: "公开练习网站，支持名言、作者、标签和分页",
    config: quoteConfig,
  },
  {
    id: "article",
    name: "通用文章模板",
    description: "适用于语义化 HTML，需要核对各网站结构",
    config: {
      ...initialConfig,
      fields: [
        { id: "title", name: "标题", selector: "h1", attribute: "text" },
        { id: "body", name: "正文", selector: "article", attribute: "text" },
        {
          id: "date",
          name: "发布时间",
          selector: "time[datetime]",
          attribute: "datetime",
        },
      ],
    },
  },
  {
    id: "json",
    name: "自定义 JSON 接口",
    description: "GET / POST，请求参数与嵌套 JSON 字段映射",
    config: jsonConfig,
  },
] satisfies {
  id: string;
  name: string;
  description: string;
  config: CrawlConfig;
}[];

export function matchPreset(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return presets.find(
      (preset) =>
        preset.config.url && new URL(preset.config.url).hostname === hostname,
    );
  } catch {
    return undefined;
  }
}
