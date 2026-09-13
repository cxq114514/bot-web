import { readPath } from "./json-path";
import { CrawlError } from "./safe-fetch";
import type { CrawlConfig, CrawlRow } from "./types";

export function extractJson(
  body: Buffer,
  config: CrawlConfig,
  sourceUrl: string,
) {
  let document: unknown;
  try {
    document = JSON.parse(body.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new CrawlError("接口没有返回有效的 JSON。");
  }
  const selected = readPath(document, config.rowSelector);
  const records =
    selected === undefined || selected === null
      ? []
      : Array.isArray(selected)
        ? selected
        : [selected];
  const warnings: string[] = [];
  if (!records.length)
    warnings.push(
      "数据路径没有匹配到记录，可能已到最后一页，请核对接口返回结构。",
    );
  if (records.length > 200)
    warnings.push("本页超过 200 条记录，仅保留前 200 条。");
  const rows: CrawlRow[] = [];
  let bytes = 0;
  for (const record of records.slice(0, 200)) {
    const row: CrawlRow = Object.create(null);
    for (const field of config.fields) {
      const value = readPath(record, field.selector);
      row[field.name] = (
        value === undefined || value === null
          ? ""
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value)
      ).slice(0, 20_000);
    }
    row._source = sourceUrl;
    bytes += Buffer.byteLength(JSON.stringify(row));
    if (bytes > 1024 * 1024) {
      warnings.push("本页提取数据超过 1 MB，仅保留限额内的记录。");
      break;
    }
    rows.push(row);
  }
  for (const field of config.fields)
    if (rows.length && rows.every((row) => !row[field.name]))
      warnings.push(`「${field.name}」没有提取到内容，请核对 JSON 路径。`);
  return { rows, warnings, nextUrl: null, title: new URL(sourceUrl).hostname };
}
