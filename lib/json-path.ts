// A deliberately small JSON path grammar: $.data.items, author.name, items[0].id.
// No eval, filters, recursive descent or prototype traversal.
export function pathTokens(path: string): string[] {
  const normalized = path.trim();
  if (normalized === "" || normalized === "$") return [];
  if (normalized.startsWith("$") && !/^\$(?:\.|\[)/.test(normalized))
    throw new Error("根节点 $ 后必须使用点号或数组下标。");
  if (normalized.length > 300)
    throw new Error("JSON 路径不能超过 300 个字符。");
  const value = normalized.startsWith("$")
    ? normalized.slice(1).replace(/^\./, "")
    : normalized;
  if (
    !/^(?:[\p{L}_][\p{L}\p{N}_-]*|\[\d+\])(?:\.[\p{L}_][\p{L}\p{N}_-]*|\[\d+\])*$/u.test(
      value,
    )
  )
    throw new Error(
      "JSON 路径仅支持点号和数字下标，例如 data.items 或 items[0].title。",
    );
  const tokens = value
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\./, "")
    .split(".");
  if (
    tokens.length > 32 ||
    tokens.some((token) =>
      ["__proto__", "constructor", "prototype"].includes(token),
    )
  )
    throw new Error("JSON 路径包含不支持的属性或嵌套过深。");
  return tokens;
}

export function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of pathTokens(path)) {
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, key)
    )
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
