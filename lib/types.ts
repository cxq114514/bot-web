export type Field = {
  id: string;
  name: string;
  selector: string;
  attribute: string;
};
export type CrawlConfig = {
  renderMode?: "static" | "browser";
  renderWaitMs?: number;
  waitSelector?: string;
  sourceType?: "html" | "json";
  api?: ApiOptions;
  url: string;
  rowSelector: string;
  fields: Field[];
  nextSelector: string;
  maxPages: number;
};
export type ApiOptions = {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string;
  pageParam: string;
  startPage: number;
};
export type CrawlRow = Record<string, string>;
export type CrawlPage = {
  url: string;
  title: string;
  rows: number;
  duration: number;
};
export type CrawlResult = {
  rows: CrawlRow[];
  pages: CrawlPage[];
  fields: string[];
  warnings: string[];
  duration: number;
  completedAt: string;
};
export type CrawlEvent =
  | { type: "probe"; report: ProbeReport }
  | { type: "log"; message: string; level: "info" | "success" | "warning" }
  | { type: "page"; page: CrawlPage; rows: CrawlRow[] }
  | { type: "done"; result: CrawlResult }
  | { type: "error"; message: string };

export type CrawlOperation = "crawl" | "test" | "analyze";
export type ProbeReport = {
  operation: "test" | "analyze";
  status: number;
  contentType: string;
  sourceType: "html" | "json";
  rendered: boolean;
  matched: number;
  sampled: number;
  fields: {
    name: string;
    selector: string;
    attribute: string;
    filled: number;
  }[];
  suggested?: Pick<
    CrawlConfig,
    "sourceType" | "rowSelector" | "fields" | "nextSelector"
  >;
  notes: string[];
};

export const initialConfig: CrawlConfig = {
  url: "",
  rowSelector: "",
  nextSelector: "",
  maxPages: 1,
  fields: [
    { id: "title", name: "标题", selector: "h1", attribute: "text" },
    {
      id: "description",
      name: "描述",
      selector: 'meta[name="description"]',
      attribute: "content",
    },
    { id: "links", name: "链接", selector: "a[href]", attribute: "href" },
  ],
};

export const bookConfig: CrawlConfig = {
  url: "https://books.toscrape.com/",
  rowSelector: "article.product_pod",
  nextSelector: "li.next a",
  maxPages: 1,
  fields: [
    { id: "title", name: "书名", selector: "h3 a", attribute: "title" },
    { id: "price", name: "价格", selector: ".price_color", attribute: "text" },
    {
      id: "stock",
      name: "库存",
      selector: ".instock.availability",
      attribute: "text",
    },
    { id: "link", name: "详情链接", selector: "h3 a", attribute: "href" },
  ],
};
