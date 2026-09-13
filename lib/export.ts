import type { CrawlRow } from "./types";

export function toCsv(rows: CrawlRow[], fields: string[]): string {
  const cell = (value: string) => {
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const columns = [...fields, "_source"];
  return (
    "\uFEFF" +
    [
      columns.map(cell).join(","),
      ...rows.map((row) =>
        columns.map((name) => cell(row[name] ?? "")).join(","),
      ),
    ].join("\r\n")
  );
}
