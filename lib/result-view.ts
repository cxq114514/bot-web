import type { CrawlRow } from "./types";

export type ResultFilters = {
  query: string;
  column: string;
  empty: "all" | "missing" | "filled";
  dedupe: string;
  sort: string;
  descending: boolean;
};
export const defaultFilters: ResultFilters = {
  query: "",
  column: "",
  empty: "all",
  dedupe: "",
  sort: "",
  descending: false,
};
const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function selectRows(
  rows: CrawlRow[],
  fields: string[],
  options: ResultFilters,
) {
  const query = options.query.trim().toLocaleLowerCase();
  const columns = fields.includes(options.column) ? [options.column] : fields;
  const filtered = rows.filter((row) => {
    const values = columns.map((key) => row[key] ?? "");
    if (
      query &&
      !values.some((value) => value.toLocaleLowerCase().includes(query))
    )
      return false;
    const missing = values.some((value) => !value.trim());
    return (
      options.empty === "all" ||
      (options.empty === "missing" ? missing : !missing)
    );
  });
  const keys =
    options.dedupe === "__all__"
      ? fields
      : fields.includes(options.dedupe)
        ? [options.dedupe]
        : [];
  const seen = new Set<string>();
  const selected = keys.length
    ? filtered.filter((row) => {
        const values = keys.map((key) => row[key] ?? "");
        // An empty identifier cannot establish that two records are the same.
        if (values.every((value) => !value.trim())) return true;
        const key = JSON.stringify(values);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
    : [...filtered];
  if (fields.includes(options.sort))
    selected.sort(
      (a, b) =>
        collator.compare(a[options.sort] ?? "", b[options.sort] ?? "") *
        (options.descending ? -1 : 1),
    );
  return {
    rows: selected,
    removed: filtered.length - selected.length,
    filteredCount: filtered.length,
  };
}
