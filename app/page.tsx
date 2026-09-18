"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Database,
  FileJson,
  FileSpreadsheet,
  Globe2,
  History,
  FlaskConical,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Play,
  Plus,
  Radio,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Table2,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  bookConfig,
  initialConfig,
  type CrawlConfig,
  type CrawlEvent,
  type CrawlResult,
  type CrawlRow,
  type Field,
  type CrawlOperation,
  type ProbeReport,
} from "@/lib/types";
import {
  ConsentGate,
  RenderSettings,
  ResultToolbar,
  ProbePanel,
  HistoryPanel,
} from "@/components/workbench-tools";
import {
  consentStorageKey,
  consentHeader,
  DISCLAIMER_VERSION,
} from "@/lib/consent";
import {
  listHistory,
  readHistory,
  saveHistory,
  type HistorySummary,
} from "@/lib/history";
import {
  defaultFilters,
  selectRows,
  type ResultFilters,
} from "@/lib/result-view";
import { toCsv } from "@/lib/export";
import {
  SourceSettings,
  ApiSettings,
  type SourceSettingsHandle,
} from "@/components/source-settings";
import { defaultApi } from "@/lib/presets";
import { isConfig, persistentConfig } from "@/lib/profiles";
import { APP_VERSION } from "@/lib/version";

type Log = {
  time: string;
  message: string;
  level: "info" | "success" | "warning" | "error";
};
type Status = "idle" | "running" | "done" | "error" | "stopped";
const freshConfig = () => structuredClone(initialConfig);
const statusLabels: Record<Status, string> = {
  idle: "准备就绪",
  running: "正在采集",
  done: "采集完成",
  error: "采集中断",
  stopped: "已停止",
};

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <span className="brand-icon">
        <Layers3 size={23} strokeWidth={2.2} />
      </span>
      {!compact && (
        <span>
          Crawlspace<span className="brand-dot">.</span>
        </span>
      )}
    </div>
  );
}

export default function Home() {
  const [config, setConfig] = useState<CrawlConfig>(freshConfig);
  const [view, setView] = useState<"workbench" | "data" | "history">(
    "workbench",
  );
  const [tab, setTab] = useState<"table" | "json">("table");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<CrawlResult | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [guide, setGuide] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [saved, setSaved] = useState(false);
  const [headersValid, setHeadersValid] = useState(true);
  const [profileSession, setProfileSession] = useState(0);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [operation, setOperation] = useState<CrawlOperation>("crawl");
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [filters, setFilters] = useState<ResultFilters>({ ...defaultFilters });
  const sourceRef = useRef<SourceSettingsHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const running = busy;
  const jsonSource = config.sourceType === "json";
  const api = config.api ?? defaultApi;
  const originalRows = result?.rows ?? [];
  const fields = result?.fields ?? config.fields.map((field) => field.name);
  const selected = useMemo(
    () => selectRows(originalRows, fields, filters),
    [originalRows, fields, filters],
  );
  const rows = selected.rows;
  const displayResult = result
    ? {
        ...result,
        rows,
        selection: { originalCount: originalRows.length, filters },
      }
    : null;
  const pageCount = Math.max(1, Math.ceil(rows.length / 10));

  useEffect(() => {
    try {
      const consent = JSON.parse(
        localStorage.getItem(consentStorageKey) ?? "null",
      );
      if (
        consent?.version === DISCLAIMER_VERSION &&
        typeof consent.acceptedAt === "string" &&
        Number.isFinite(Date.parse(consent.acceptedAt))
      )
        setConsented(true);
    } catch {
      /* Consent remains required. */
    }
  }, []);
  useEffect(() => {
    if (consented) void refreshHistory();
  }, [consented]);
  useEffect(() => {
    setPreviewPage((page) => Math.min(page, pageCount - 1));
  }, [pageCount]);

  async function refreshHistory() {
    try {
      setHistory(await listHistory());
      setHistoryError("");
    } catch {
      setHistoryError("无法读取采集历史，请检查浏览器存储设置。");
    }
  }
  function changeFilters(next: ResultFilters) {
    setFilters(next);
    setPreviewPage(0);
  }
  function reuseHistory(entry: HistorySummary) {
    if (running) return;
    applySource(structuredClone(entry.config));
    setProfileSession((value) => value + 1);
    setView("workbench");
    setToast(
      entry.config.sourceType === "json"
        ? "已载入历史规则；请重新填写接口凭据、请求体和查询参数"
        : "已载入历史规则，可调整后再次采集",
    );
  }
  async function openHistory(id: string) {
    if (running) return;
    try {
      const entry = await readHistory(id);
      if (!entry) {
        setToast("该历史记录已被清理");
        await refreshHistory();
        return;
      }
      reuseHistory(entry);
      setResult(entry.result);
      setReport(entry.report ?? null);
      setStatus(entry.status);
      setOperation(entry.operation);
      setElapsed(entry.result.duration);
      setError(entry.error);
      setLogs([]);
      setFilters({ ...defaultFilters });
      setPreviewPage(0);
      setView("data");
      setToast("已打开历史结果");
    } catch {
      setToast("读取历史失败，请检查浏览器存储设置");
    }
  }
  function applyAnalysis() {
    if (!report?.suggested || running) return;
    const suggestion = report.suggested;
    applySource({
      ...config,
      ...suggestion,
      maxPages: 1,
      api:
        suggestion.sourceType === "json"
          ? (config.api ?? structuredClone(defaultApi))
          : undefined,
      renderMode:
        suggestion.sourceType === "json" ? "static" : config.renderMode,
    });
    setView("workbench");
    setToast("已应用分析规则，可先试运行核对字段");
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem("crawlspace-rule-v1");
      if (stored) {
        const value = JSON.parse(stored);
        if (isConfig(value)) {
          setConfig(persistentConfig(value));
          setSaved(true);
        }
      }
    } catch {
      /* Browser storage is optional. */
    }
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const panel = logEnd.current?.parentElement;
    panel?.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
  }, [logs]);
  useEffect(() => {
    if (guide) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [guide]);

  function updateConfig(patch: Partial<CrawlConfig>) {
    setReport(null);
    setConfig((current) => ({ ...current, ...patch }));
    setSaved(false);
  }
  function updateField(id: string, patch: Partial<Field>) {
    setReport(null);
    setConfig((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    }));
    setSaved(false);
  }
  function addLog(message: string, level: Log["level"] = "info") {
    setLogs((current) => [
      ...current,
      {
        message,
        level,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      },
    ]);
  }
  function useExample() {
    if (running) return;
    setProfileSession((value) => value + 1);
    setConfig(structuredClone(bookConfig));
    setReport(null);
    setSaved(false);
    setView("workbench");
    setError("");
    setGuide(false);
    setToast("已载入公开练习网站的书籍采集规则");
  }
  function newTask() {
    if (running) return;
    setReport(null);
    setFilters({ ...defaultFilters });
    setProfileSession((value) => value + 1);
    setConfig(freshConfig());
    setSaved(false);
    setResult(null);
    setLogs([]);
    setError("");
    setStatus("idle");
    setElapsed(0);
    setView("workbench");
    setPreviewPage(0);
    requestAnimationFrame(() => urlRef.current?.focus());
  }
  function saveRule() {
    sourceRef.current?.save();
  }
  function applySource(next: CrawlConfig) {
    if (running) return;
    setConfig(next);
    setReport(null);
    setSaved(false);
    setError("");
    setHeadersValid(true);
  }
  function download(format: "csv" | "json") {
    if (!rows.length) return;
    const text =
      format === "csv"
        ? toCsv(rows, fields)
        : JSON.stringify(displayResult, null, 2);
    const blob = new Blob([text], {
      type:
        format === "csv"
          ? "text/csv;charset=utf-8"
          : "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `crawlspace-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMenu(false);
    setToast(
      `已导出 ${rows.length} 条${status !== "done" ? "已采集" : ""}记录`,
    );
  }
  async function copyJson() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(displayResult, null, 2),
      );
      setToast("JSON 已复制到剪贴板");
    } catch {
      setToast("复制失败，请使用导出 JSON");
    }
  }

  async function startCrawl(kind: CrawlOperation = "crawl") {
    if (busyRef.current) return;
    if (!consented) {
      setError("请先阅读并同意免责声明。");
      return;
    }
    setError("");
    if (jsonSource && !headersValid) {
      setError("请先修正自定义请求头的 JSON 格式。");
      return;
    }
    let url: URL;
    try {
      url = new URL(config.url.trim());
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
    } catch {
      setError("请输入完整的网页地址，以 https:// 或 http:// 开头。");
      urlRef.current?.focus();
      return;
    }
    if (kind !== "analyze") {
      if (
        config.fields.some(
          (field) =>
            !field.name.trim() ||
            !field.selector.trim() ||
            !field.attribute.trim(),
        )
      ) {
        setError(
          jsonSource
            ? "请填写每个字段的名称和 JSON 路径。"
            : "请填写每个字段的名称、CSS 选择器和提取属性。",
        );
        return;
      }
      if (
        new Set(config.fields.map((field) => field.name.trim())).size !==
        config.fields.length
      ) {
        setError("字段名称不能重复。");
        return;
      }
    }
    if (
      kind === "crawl" &&
      config.maxPages > 1 &&
      (jsonSource ? !api.pageParam : !config.nextSelector.trim())
    ) {
      setError(
        jsonSource
          ? "采集多页时，请填写接口分页参数名。"
          : "采集多页时，请填写下一页链接的 CSS 选择器。",
      );
      return;
    }
    const requestConfig = structuredClone({ ...config, url: url.href });
    let collected: CrawlResult = {
      rows: [],
      fields: config.fields.map((field) => field.name.trim()),
      pages: [],
      duration: 0,
      warnings: [],
      completedAt: "",
    };
    let probe: ProbeReport | undefined;
    let endStatus: "done" | "stopped" | "error" = "error";
    let taskError = "";
    const started = Date.now();
    const createdAt = new Date().toISOString();
    busyRef.current = true;
    setBusy(true);
    setOperation(kind);
    setResult(collected);
    setReport(null);
    setFilters({ ...defaultFilters });
    setPreviewPage(0);
    setLogs([]);
    setElapsed(0);
    setStatus("running");
    addLog(
      kind === "analyze"
        ? "开始分析响应结构，仅请求当前页"
        : kind === "test"
          ? "开始规则试运行，仅采集当前页"
          : "任务已创建，开始连接目标网站",
    );
    const aborter = new AbortController();
    abortRef.current = aborter;
    let terminalEvent = false;
    const handleEvent = (message: CrawlEvent) => {
      if (terminalEvent) return;
      if (message.type === "probe") {
        probe = message.report;
        setReport(message.report);
      }
      if (message.type === "log") {
        addLog(message.message, message.level);
        if (message.level === "warning")
          collected = {
            ...collected,
            warnings: [...new Set([...collected.warnings, message.message])],
          };
      }
      if (message.type === "page")
        collected = {
          ...collected,
          rows: [...collected.rows, ...message.rows],
          pages: [...collected.pages, message.page],
          fields: probe ? probe.fields.map((f) => f.name) : collected.fields,
        };
      if (message.type === "done") {
        terminalEvent = true;
        endStatus = "done";
        collected = message.result;
        addLog(
          (kind === "crawl"
            ? "采集完成"
            : kind === "test"
              ? "试运行完成"
              : "分析完成") +
            "，共 " +
            collected.rows.length +
            " 条记录",
          "success",
        );
      }
      if (message.type === "error") {
        terminalEvent = true;
        taskError = message.message;
        setError(taskError);
        addLog(taskError, "error");
      }
      setResult(collected);
    };
    try {
      const response = await fetch("/api/crawl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [consentHeader]: DISCLAIMER_VERSION,
        },
        body: JSON.stringify({ ...requestConfig, operation: kind }),
        signal: aborter.signal,
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "采集请求失败。");
      }
      if (!response.body) throw new Error("浏览器不支持读取采集进度。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines)
            if (line.trim()) handleEvent(JSON.parse(line));
        }
        buffer += decoder.decode();
        if (buffer.trim()) handleEvent(JSON.parse(buffer));
      } finally {
        reader.releaseLock();
      }
      if (!terminalEvent)
        throw new Error("连接意外中断，已采集的数据仍可导出。");
    } catch (cause) {
      if (aborter.signal.aborted) {
        endStatus = "stopped";
        taskError = "用户已停止任务，保留已获取的数据。";
        addLog(taskError, "warning");
      } else {
        endStatus = "error";
        taskError =
          cause instanceof Error ? cause.message : "连接失败，请稍后重试。";
        setError(taskError);
        addLog(taskError, "error");
      }
    } finally {
      collected = {
        ...collected,
        duration: collected.duration || Date.now() - started,
        completedAt: collected.completedAt || new Date().toISOString(),
      };
      if (taskError)
        collected = {
          ...collected,
          warnings: [...new Set([...collected.warnings, taskError])],
        };
      setResult(collected);
      setElapsed(collected.duration);
      setStatus(endStatus);
      try {
        await saveHistory({
          id: crypto.randomUUID(),
          createdAt,
          config: requestConfig,
          status: endStatus,
          operation: kind,
          result: collected,
          report: probe,
          error: taskError,
        });
        await refreshHistory();
      } catch {
        setHistoryError(
          "本次历史保存失败，请及时导出结果并检查浏览器存储空间。",
        );
        setToast("历史保存失败，当前结果仍可导出");
      }
      abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  }

  const renderResults = () => (
    <section className="card results-card" aria-label="采集结果">
      <div className="card-heading results-heading">
        <div className="heading-with-icon">
          <span className="section-icon">
            <Table2 size={18} />
          </span>
          <h2>数据预览</h2>
          <span className="count-badge">{rows.length}</span>
        </div>
        <div className="export-wrap">
          <button
            className="button small"
            disabled={!rows.length}
            onClick={() => setExportMenu(!exportMenu)}
            aria-expanded={exportMenu}
          >
            <ArrowDownToLine size={15} />
            导出数据
            <ChevronDown size={13} />
          </button>
          {exportMenu && (
            <>
              <button
                className="menu-dismiss"
                tabIndex={-1}
                aria-label="关闭导出菜单"
                onClick={() => setExportMenu(false)}
              />
              <div className="dropdown">
                <button onClick={() => download("csv")}>
                  <FileSpreadsheet size={16} />
                  导出 CSV<span>Excel 可用</span>
                </button>
                <button onClick={() => download("json")}>
                  <FileJson size={16} />
                  导出 JSON<span>当前筛选</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {!!originalRows.length && (
        <ResultToolbar
          filters={filters}
          onChange={changeFilters}
          fields={fields}
          total={originalRows.length}
          count={rows.length}
          removed={selected.removed}
        />
      )}
      {result?.warnings.length ? (
        <details className="result-warnings">
          <summary>本次任务有 {result.warnings.length} 条提示</summary>
          <ul>
            {result.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="results-toolbar">
        <div className="tabs">
          <button
            className={tab === "table" ? "active" : ""}
            onClick={() => setTab("table")}
          >
            <Table2 size={14} />
            表格视图
          </button>
          <button
            className={tab === "json" ? "active" : ""}
            onClick={() => setTab("json")}
          >
            <Code2 size={15} />
            JSON
          </button>
        </div>
        <span className="preview-note">
          {running
            ? "数据实时更新"
            : status === "done"
              ? `${result?.pages.length ?? 0} 个网页 · ${fields.length} 个字段`
              : "采集后自动显示结果"}
        </span>
      </div>
      {rows.length ? (
        tab === "table" ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="row-number">#</th>
                    {fields.map((field) => (
                      <th key={field}>{field}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice(previewPage * 10, (previewPage + 1) * 10)
                    .map((row: CrawlRow, index) => (
                      <tr key={previewPage * 10 + index}>
                        <td className="row-number">
                          {String(previewPage * 10 + index + 1).padStart(
                            2,
                            "0",
                          )}
                        </td>
                        {fields.map((field) => (
                          <td key={field}>
                            <span className="cell-value" title={row[field]}>
                              {/^https?:\/\/\S+$/.test(row[field] ?? "") ? (
                                <a
                                  href={row[field]}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {row[field]}
                                  <ArrowUpRight size={12} />
                                </a>
                              ) : (
                                row[field] || <span className="muted">—</span>
                              )}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                共 {rows.length} 条记录
                {status !== "done" ? " · 当前已获取" : ""}
              </span>
              <div>
                <button
                  className="icon-button"
                  disabled={previewPage === 0}
                  onClick={() => setPreviewPage((page) => page - 1)}
                  aria-label="上一页结果"
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {previewPage + 1} / {pageCount}
                </span>
                <button
                  className="icon-button"
                  disabled={previewPage >= pageCount - 1}
                  onClick={() => setPreviewPage((page) => page + 1)}
                  aria-label="下一页结果"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="json-wrap">
            <button className="button small copy-button" onClick={copyJson}>
              <Copy size={14} />
              复制
            </button>
            <pre>{JSON.stringify(displayResult, null, 2)}</pre>
          </div>
        )
      ) : originalRows.length ? (
        <div className="history-empty">
          没有符合筛选条件的记录。
          <button
            className="text-button"
            onClick={() => changeFilters({ ...defaultFilters })}
          >
            重置筛选
          </button>
        </div>
      ) : (
        <div className={`empty-state ${running ? "is-loading" : ""}`}>
          <div className="empty-illustration">
            <div className="empty-grid" />
            <div className="empty-sheet">
              <span />
              <span />
              <span />
              <Table2 size={22} />
            </div>
            <span className="empty-spark">
              {running ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}
            </span>
          </div>
          <h3>
            {running
              ? "正在寻找你需要的数据"
              : status === "error"
                ? "本次尚未获取到数据"
                : "让网页里的数据，在这里井然有序"}
          </h3>
          <p>
            {running
              ? "采集结果会实时出现在这里，稍等片刻。"
              : status === "error"
                ? "根据上方提示调整网址或规则，然后重新采集。"
                : "填写目标网址和采集字段，开始你的第一次采集。"}
          </p>
          {status === "idle" && (
            <button className="text-button" onClick={useExample}>
              先试试书籍采集示例
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
    </section>
  );

  return (
    <>
      <ConsentGate
        accepted={consented}
        onAccept={(stored) => {
          setConsented(true);
          if (!stored)
            setToast("已同意；浏览器未能保存确认记录，下次打开需重新确认");
        }}
      />
      <div className="app-shell" inert={!consented}>
        <aside className="sidebar">
          <a className="brand-link" href="/" aria-label="Crawlspace 首页">
            <Brand />
          </a>
          <div className="workspace-switch">
            <div className="workspace-avatar">
              <Layers3 size={17} />
            </div>
            <div>
              <strong>我的工作空间</strong>
              <span>个人空间</span>
            </div>
            <span className="workspace-tag">LOCAL</span>
          </div>
          <div className="nav-label">工作空间</div>
          <nav aria-label="主导航">
            <button
              className={`nav-item ${view === "workbench" ? "active" : ""}`}
              onClick={() => setView("workbench")}
            >
              <LayoutDashboard size={18} />
              <span>采集工作台</span>
              {view === "workbench" && <span className="active-mark" />}
            </button>
            <button
              className={`nav-item ${view === "data" ? "active" : ""}`}
              onClick={() => setView("data")}
            >
              <Database size={18} />
              <span>采集结果</span>
              <span className="nav-count">{rows.length}</span>
            </button>
            <button
              className={`nav-item ${view === "history" ? "active" : ""}`}
              onClick={() => setView("history")}
            >
              <History size={18} />
              <span>采集历史</span>
              <span className="nav-count">{history.length}</span>
            </button>
          </nav>
          <div className="nav-label second">资源</div>
          <button className="nav-item" onClick={() => setGuide(true)}>
            <BookOpen size={18} />
            <span>规则指南</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <span className="tip-icon">
                <Zap size={17} />
              </span>
              <strong>从网页到数据，只差一步</strong>
              <p>试试预设规则，了解一次完整的采集过程。</p>
              <button onClick={useExample} disabled={running}>
                体验示例
                <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="sidebar-footer">
              <span className="local-indicator" />
              本地工作空间<span>v{APP_VERSION}</span>
            </div>
          </div>
        </aside>

        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              <span className="mobile-brand">
                <Brand compact />
              </span>
              <span>工作空间</span>
              <ChevronRight size={13} />
              <strong>
                {view === "workbench"
                  ? "采集工作台"
                  : view === "history"
                    ? "采集历史"
                    : "采集结果"}
              </strong>
            </div>
            <div className="topbar-actions">
              <span className={`top-status ${running ? "busy" : ""}`}>
                <span />
                {running ? "任务运行中" : "工作台已就绪"}
              </span>
              <span className="topbar-divider" />
              <button className="help-button" onClick={() => setGuide(true)}>
                <CircleHelp size={17} />
                <span>使用帮助</span>
              </button>
            </div>
          </header>
          <main>
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR WEB, STRUCTURED.</div>
                <h1>
                  {view === "workbench"
                    ? "采集工作台"
                    : view === "history"
                      ? "采集历史"
                      : "采集结果"}
                  <span className="title-symbol">✳</span>
                </h1>
                <p>
                  {view === "workbench"
                    ? "把网页上的信息，变成触手可及的数据。"
                    : view === "history"
                      ? "找回之前的数据和规则，继续你的采集工作。"
                      : "筛选、去重并导出当前数据，原始记录保留在历史中。"}
                </p>
              </div>
              <button
                className="button new-task"
                onClick={newTask}
                disabled={running}
              >
                <Plus size={16} />
                新建采集
              </button>
            </div>

            <nav className="mobile-navigation" aria-label="切换工作视图">
              <button
                className={view === "workbench" ? "selected" : ""}
                onClick={() => setView("workbench")}
              >
                <LayoutDashboard size={15} />
                采集工作台
              </button>
              <button
                className={view === "data" ? "selected" : ""}
                onClick={() => setView("data")}
              >
                <Database size={15} />
                采集结果 · {rows.length}
              </button>
              <button
                className={view === "history" ? "selected" : ""}
                onClick={() => setView("history")}
              >
                <History size={15} />
                采集历史
              </button>
            </nav>
            <div className="content-grid">
              <div className="primary-column">
                {view === "workbench" && (
                  <form
                    className="card config-card"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void startCrawl();
                    }}
                  >
                    <div className="card-heading">
                      <div className="heading-with-icon">
                        <span className="section-icon">
                          <Settings2 size={18} />
                        </span>
                        <h2>采集配置</h2>
                      </div>
                      <span className="subtle-badge">自定义规则</span>
                    </div>
                    <fieldset disabled={running} className="config-fields">
                      <SourceSettings
                        key={profileSession}
                        ref={sourceRef}
                        config={config}
                        disabled={running}
                        onChange={updateConfig}
                        onApply={applySource}
                        onNotify={setToast}
                        onSaved={() => setSaved(true)}
                      />
                      <div className="form-section">
                        <div className="label-row">
                          <label htmlFor="target-url">
                            {jsonSource ? "接口网址" : "目标网址"}
                            <span className="required">*</span>
                          </label>
                          <span>从你想采集的页面开始</span>
                        </div>
                        <div className="url-input">
                          <span className="method-tag">
                            {jsonSource ? api.method : "GET"}
                          </span>
                          <input
                            id="target-url"
                            ref={urlRef}
                            value={config.url}
                            onChange={(event) =>
                              updateConfig({ url: event.target.value })
                            }
                            placeholder="https://example.com"
                            type="url"
                            required
                            autoComplete="url"
                            spellCheck={false}
                          />
                          <Globe2 size={18} />
                        </div>
                      </div>

                      {!jsonSource && (
                        <RenderSettings
                          config={config}
                          onChange={updateConfig}
                        />
                      )}
                      <div className="probe-actions">
                        <button
                          type="button"
                          className="button"
                          disabled={!consented || running}
                          onClick={() => void startCrawl("analyze")}
                        >
                          <Sparkles size={15} />
                          自动分析响应
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={!consented || running}
                          onClick={() => void startCrawl("test")}
                        >
                          <FlaskConical size={15} />
                          规则试运行
                        </button>
                      </div>
                      <p className="tool-note">
                        分析可推荐列表和字段；试运行检查当前规则。两者仅请求一页。
                      </p>
                      <div className="form-section rules-section">
                        <div className="label-row">
                          <label htmlFor="row-selector">
                            {jsonSource ? "数据列表路径" : "列表容器"}
                            <span className="optional">可选</span>
                          </label>
                          <span
                            className="info-text"
                            title="一个容器提取一条记录；留空时，整个页面提取为一条记录。"
                          >
                            <CircleHelp size={13} />
                            {jsonSource
                              ? "相对于接口响应，例如 data.items"
                              : "每个匹配元素生成一条数据"}
                          </span>
                        </div>
                        <input
                          id="row-selector"
                          className="input mono"
                          value={config.rowSelector}
                          onChange={(event) =>
                            updateConfig({ rowSelector: event.target.value })
                          }
                          placeholder={
                            jsonSource
                              ? "例如 data.items；根数组填写 $"
                              : "例如 .product-item，留空则提取整个页面"
                          }
                          spellCheck={false}
                        />
                      </div>

                      {jsonSource && (
                        <ApiSettings
                          config={config}
                          disabled={running}
                          onChange={updateConfig}
                          onValidity={setHeadersValid}
                        />
                      )}
                      <div className="form-section field-section">
                        <div className="label-row">
                          <label>
                            采集字段
                            <span className="field-count">
                              {config.fields.length} 个字段
                            </span>
                          </label>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => setGuide(true)}
                          >
                            <Code2 size={14} />
                            选择器怎么写
                            <ArrowUpRight size={12} />
                          </button>
                        </div>
                        <div className="field-table">
                          <div className="field-table-head">
                            <span>字段名称</span>
                            <span>
                              {jsonSource ? "JSON 路径" : "CSS 选择器"}
                            </span>
                            <span>
                              {jsonSource ? "自动转为文本" : "提取属性"}
                            </span>
                            <span />
                          </div>
                          {config.fields.map((field, index) => (
                            <div className="field-row" key={field.id}>
                              <div className="field-name">
                                <span className="field-index">{index + 1}</span>
                                <input
                                  aria-label={`字段 ${index + 1} 名称`}
                                  value={field.name}
                                  onChange={(event) =>
                                    updateField(field.id, {
                                      name: event.target.value,
                                    })
                                  }
                                  maxLength={40}
                                  required
                                />
                              </div>
                              <input
                                className="mono"
                                aria-label={`字段 ${index + 1} ${jsonSource ? "JSON 路径" : "CSS 选择器"}`}
                                placeholder={
                                  jsonSource ? "例如 author.name" : "例如 h2 a"
                                }
                                value={field.selector}
                                onChange={(event) =>
                                  updateField(field.id, {
                                    selector: event.target.value,
                                  })
                                }
                                maxLength={300}
                                required
                                spellCheck={false}
                              />
                              <input
                                className="mono attribute-input"
                                readOnly={jsonSource}
                                aria-label={`字段 ${index + 1} 提取属性`}
                                list="attributes"
                                value={field.attribute}
                                onChange={(event) =>
                                  updateField(field.id, {
                                    attribute: event.target.value,
                                  })
                                }
                                required
                                spellCheck={false}
                              />
                              <button
                                type="button"
                                className="icon-button delete-field"
                                aria-label={`删除字段 ${index + 1}`}
                                disabled={config.fields.length <= 1}
                                onClick={() =>
                                  updateConfig({
                                    fields: config.fields.filter(
                                      (item) => item.id !== field.id,
                                    ),
                                  })
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <datalist id="attributes">
                          {[
                            "text",
                            "href",
                            "src",
                            "content",
                            "title",
                            "datetime",
                            "alt",
                            "value",
                          ].map((attribute) => (
                            <option value={attribute} key={attribute} />
                          ))}
                        </datalist>
                        <button
                          className="add-field"
                          type="button"
                          disabled={config.fields.length >= 12}
                          onClick={() =>
                            updateConfig({
                              fields: [
                                ...config.fields,
                                {
                                  id: crypto.randomUUID(),
                                  name: "",
                                  selector: "",
                                  attribute: "text",
                                },
                              ],
                            })
                          }
                        >
                          <Plus size={14} />
                          添加字段<span>{config.fields.length}/12</span>
                        </button>
                      </div>

                      <div className="pagination-settings">
                        <div className="page-limit">
                          <label htmlFor="max-pages">
                            <Layers3 size={15} />
                            采集页数
                          </label>
                          <select
                            id="max-pages"
                            value={config.maxPages}
                            onChange={(event) =>
                              updateConfig({
                                maxPages: Number(event.target.value),
                              })
                            }
                          >
                            {[1, 2, 3, 5, 10].map((count) => (
                              <option value={count} key={count}>
                                {count === 1 ? "仅当前页" : `最多 ${count} 页`}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="pagination-hint">
                          <ShieldCheck size={14} />
                          自动遵循网站抓取规则
                        </div>
                      </div>
                      {config.maxPages > 1 && !jsonSource && (
                        <div className="next-selector">
                          <label htmlFor="next-selector">
                            下一页链接选择器
                          </label>
                          <input
                            id="next-selector"
                            className="input mono"
                            placeholder="例如 .pagination .next a"
                            value={config.nextSelector}
                            onChange={(event) =>
                              updateConfig({ nextSelector: event.target.value })
                            }
                            required
                          />
                        </div>
                      )}
                      {jsonSource && config.maxPages > 1 && (
                        <div className="api-pagination">
                          <div>
                            <label htmlFor="page-param">分页查询参数</label>
                            <input
                              id="page-param"
                              className="input mono"
                              placeholder="例如 page 或 _page"
                              value={api.pageParam}
                              onChange={(event) =>
                                updateConfig({
                                  api: {
                                    ...api,
                                    pageParam: event.target.value,
                                  },
                                })
                              }
                              required
                            />
                          </div>
                          <div>
                            <label htmlFor="start-page">起始页码</label>
                            <input
                              id="start-page"
                              className="input"
                              type="number"
                              min={0}
                              max={10000}
                              value={api.startPage}
                              onChange={(event) =>
                                updateConfig({
                                  api: {
                                    ...api,
                                    startPage: Number(event.target.value),
                                  },
                                })
                              }
                            />
                          </div>
                          <p>
                            页码作为 URL 查询参数递增；返回空列表时提前停止。
                          </p>
                        </div>
                      )}
                      <p className="disclaimer-inline">
                        <ShieldCheck size={14} />{" "}
                        已同意免责声明，请仅采集你有权访问的数据。
                        <a
                          href="/disclaimer"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          查看免责声明 ↗
                        </a>
                      </p>
                    </fieldset>
                    {error && (
                      <div className="error-banner" role="alert">
                        <CircleHelp size={16} />
                        <span>{error}</span>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => setError("")}
                          aria-label="关闭错误提示"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    <div className="config-footer">
                      <span>
                        <span className={`status-dot ${status}`} />
                        {statusLabels[status]}
                      </span>
                      <div>
                        <button
                          type="button"
                          className={`button save-button ${saved ? "is-saved" : ""}`}
                          onClick={saveRule}
                          disabled={running}
                        >
                          {saved ? <Check size={15} /> : <Save size={15} />}
                          {saved ? "规则已保存" : "保存规则"}
                        </button>
                        {running ? (
                          <button
                            type="button"
                            className="button primary stop-button"
                            onClick={() => abortRef.current?.abort()}
                          >
                            <Square size={14} />
                            {operation === "crawl" ? "停止采集" : "停止任务"}
                          </button>
                        ) : (
                          <button
                            className="button primary"
                            type="submit"
                            disabled={!consented}
                          >
                            <Play size={15} fill="currentColor" />
                            开始采集
                            <ArrowRight size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  </form>
                )}

                {view === "history" ? (
                  <HistoryPanel
                    entries={history}
                    disabled={running}
                    error={historyError}
                    onRefresh={refreshHistory}
                    onOpen={(id) => void openHistory(id)}
                    onReuse={reuseHistory}
                  />
                ) : (
                  <>
                    {view === "data" && error && (
                      <div className="error-banner" role="alert">
                        {error}
                      </div>
                    )}
                    {historyError && (
                      <p className="inline-error" role="alert">
                        {historyError}
                      </p>
                    )}
                    {report && (
                      <ProbePanel
                        report={report}
                        disabled={running}
                        onApply={applyAnalysis}
                      />
                    )}
                    <div className="metrics">
                      <div className="metric">
                        <div className="metric-icon purple">
                          <Database size={19} />
                        </div>
                        <div>
                          <span>已采集记录</span>
                          <strong>
                            {status === "idle" ? "—" : originalRows.length}
                            <small>条</small>
                          </strong>
                        </div>
                        <span className="metric-spark">
                          <svg viewBox="0 0 52 24" aria-hidden="true">
                            <path d="M1 21h10l6-7 7 4 9-12 7 5 11-9" />
                          </svg>
                        </span>
                      </div>
                      <div className="metric">
                        <div className="metric-icon blue">
                          <Globe2 size={19} />
                        </div>
                        <div>
                          <span>已完成页面</span>
                          <strong>
                            {status === "idle"
                              ? "—"
                              : (result?.pages.length ?? 0)}
                            <small>页</small>
                          </strong>
                        </div>
                      </div>
                      <div className="metric">
                        <div className="metric-icon orange">
                          <Zap size={19} />
                        </div>
                        <div>
                          <span>任务耗时</span>
                          <strong>
                            {status === "idle"
                              ? "—"
                              : (elapsed / 1000).toFixed(1)}
                            <small>秒</small>
                          </strong>
                        </div>
                        {running && (
                          <LoaderCircle
                            className="spin metric-spinner"
                            size={17}
                          />
                        )}
                      </div>
                    </div>
                    {renderResults()}
                  </>
                )}
              </div>

              <aside className="secondary-column">
                <section className="getting-started">
                  <div className="guide-card-title">
                    <span>
                      <Sparkles size={18} />
                      第一次使用？
                    </span>
                    <span className="little-badge">QUICK START</span>
                  </div>
                  <h2>三步，完成一次采集。</h2>
                  <div className="steps">
                    <div className="step">
                      <span className="step-number">1</span>
                      <div>
                        <h3>输入目标网址</h3>
                        <p>找到想要采集的公开网页。</p>
                      </div>
                    </div>
                    <div className="step">
                      <span className="step-number">2</span>
                      <div>
                        <h3>定义你需要的字段</h3>
                        <p>用 CSS 或 JSON 路径定位内容。</p>
                      </div>
                    </div>
                    <div className="step">
                      <span className="step-number">3</span>
                      <div>
                        <h3>开始采集，导出数据</h3>
                        <p>支持 CSV 和 JSON 格式。</p>
                      </div>
                    </div>
                  </div>
                  <button
                    className="example-button"
                    onClick={useExample}
                    disabled={running}
                  >
                    <Play size={14} />
                    试试书籍采集示例
                    <ArrowUpRight size={15} />
                  </button>
                  <div className="example-note">使用专门用于练习的公开网站</div>
                </section>

                <section className="card activity-card">
                  <div className="card-heading">
                    <div className="heading-with-icon">
                      <Terminal size={17} />
                      <h2>运行日志</h2>
                    </div>
                    <span
                      className={`activity-status ${running ? "live" : ""}`}
                    >
                      {running ? (
                        <>
                          <Radio size={12} />
                          LIVE
                        </>
                      ) : (
                        "本次任务"
                      )}
                    </span>
                  </div>
                  <div
                    className={`log-body ${logs.length ? "has-logs" : ""}`}
                    role="log"
                    aria-live="polite"
                  >
                    {logs.length ? (
                      logs.map((log, index) => (
                        <div className={`log-entry ${log.level}`} key={index}>
                          <time>{log.time}</time>
                          <span className="log-marker">
                            {log.level === "success"
                              ? "✓"
                              : log.level === "error"
                                ? "!"
                                : "›"}
                          </span>
                          <span>{log.message}</span>
                        </div>
                      ))
                    ) : (
                      <>
                        <div className="terminal-placeholder">
                          <span>›</span> 等待启动采集任务
                          <span className="terminal-cursor" />
                        </div>
                        <p>
                          连接状态、采集进度和提示
                          <br />
                          都会显示在这里。
                        </p>
                      </>
                    )}
                    <div ref={logEnd} />
                  </div>
                  <div className="log-footer">
                    <span className={`status-dot ${status}`} />
                    {status === "idle" ? "等待任务" : statusLabels[status]}
                    <span>
                      {logs.length ? `${logs.length} 条日志` : "准备好了"}
                    </span>
                  </div>
                </section>

                <div className="note-card">
                  <div>
                    <ShieldCheck size={19} />
                    <strong>有节制地采集</strong>
                  </div>
                  <p>
                    仅采集获准使用的内容。同一进程内，同源请求间隔至少 1
                    秒，并检查网站的 robots.txt
                    规则。公开可访问不等于获得使用授权。
                  </p>
                  <p>
                    采集结果可能缺失或截断；中断导出仅含已收到的数据，请核对警告和原始来源。
                    <a
                      href="/disclaimer"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      使用说明与免责声明
                    </a>
                  </p>
                  <span>支持静态 HTML、动态网页和 JSON 接口</span>
                </div>
              </aside>
            </div>
            <footer className="page-footer">
              <span>Crawlspace · 让信息自由流动</span>
              <a href="/disclaimer" target="_blank" rel="noopener noreferrer">
                使用说明与免责声明
              </a>
              <span>
                <span className="footer-line" />
                为你的下一次发现而造
              </span>
            </footer>
          </main>
        </div>

        <dialog
          ref={modalRef}
          className="guide-dialog"
          onCancel={() => setGuide(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setGuide(false);
          }}
          aria-labelledby="guide-title"
        >
          <div className="dialog-inner">
            <div className="dialog-heading">
              <span className="section-icon">
                <BookOpen size={21} />
              </span>
              <button
                className="icon-button"
                onClick={() => setGuide(false)}
                aria-label="关闭规则指南"
              >
                <X size={21} />
              </button>
            </div>
            <h2 id="guide-title">给网页数据，一套清晰的规则。</h2>
            <p>
              在浏览器中右键网页内容，选择「检查」，查看元素的标签和
              class，再填写对应的 CSS 选择器。
            </p>
            <div className="guide-example">
              <span>网页结构</span>
              <pre>
                {
                  '<article class="product">\n  <h2>一本好书</h2>\n  <span class="price">¥ 39.00</span>\n  <a href="/book/1">查看详情</a>\n</article>'
                }
              </pre>
            </div>
            <table className="guide-table">
              <thead>
                <tr>
                  <th>配置项</th>
                  <th>选择器</th>
                  <th>提取属性</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>列表容器</td>
                  <td>
                    <code>.product</code>
                  </td>
                  <td>—</td>
                </tr>
                <tr>
                  <td>书名</td>
                  <td>
                    <code>h2</code>
                  </td>
                  <td>
                    <code>text</code>
                  </td>
                </tr>
                <tr>
                  <td>价格</td>
                  <td>
                    <code>.price</code>
                  </td>
                  <td>
                    <code>text</code>
                  </td>
                </tr>
                <tr>
                  <td>详情链接</td>
                  <td>
                    <code>a</code>
                  </td>
                  <td>
                    <code>href</code>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="guide-notes">
              <p>
                <strong>列表容器：</strong>
                一组重复内容对应多条记录；留空则整个页面作为一条记录。提取容器本身使用{" "}
                <code>:scope</code>。
              </p>
              <p>
                <strong>提取属性：</strong>
                <code>text</code> 获取文字，<code>href</code> 获取链接，
                <code>src</code> 获取图片地址，也可以填写任意 HTML
                属性名。多个匹配值按换行分隔。
              </p>
              <p>
                <strong>分页：</strong>
                选择最多采集页数，并填写下一页链接的选择器；仅跟随同一网站内的链接，单页最多
                200 条。
              </p>
              <p>
                <strong>JSON 接口：</strong>切换到「自定义接口」，配置 GET /
                POST 和请求头。数据列表路径相对于响应根节点，例如{" "}
                <code>data.items</code>；字段路径相对于每条记录，例如{" "}
                <code>author.name</code>
                。支持点号和数字下标，不支持通配符。分页通过 URL 页码参数递增。
              </p>
              <p>
                <strong>适用范围：</strong>支持静态
                HTML、动态浏览器渲染和有授权的 JSON
                接口，不包含网页登录或验证码处理。规则和历史保存在当前浏览器；自动分析后请核对试运行结果。
              </p>
            </div>
            <button
              className="button primary full-width"
              onClick={useExample}
              disabled={running}
            >
              <Play size={15} />
              载入书籍采集示例
              <ArrowRight size={15} />
            </button>
          </div>
        </dialog>
        {toast && (
          <div className="toast" role="status">
            <CheckCheck size={17} />
            {toast}
            <button onClick={() => setToast("")} aria-label="关闭提示">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
