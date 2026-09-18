"use client";

import { useEffect, useRef, useState } from "react";
import { History, FlaskConical, ShieldCheck, Trash2 } from "lucide-react";
import { consentStorageKey, DISCLAIMER_VERSION } from "@/lib/consent";
import { deleteHistory, type HistorySummary } from "@/lib/history";
import { defaultFilters, type ResultFilters } from "@/lib/result-view";
import type { CrawlConfig, ProbeReport } from "@/lib/types";
import { DisclaimerContent } from "./disclaimer-content";

export function ConsentGate({
  accepted,
  onAccept,
}: {
  accepted: boolean;
  onAccept: (stored: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (accepted) dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [accepted]);
  return (
    <dialog
      ref={dialog}
      className="consent-dialog"
      aria-labelledby="consent-title"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="consent-heading">
        <ShieldCheck size={25} />
        <div>
          <h2 id="consent-title">使用前，请阅读并同意免责声明</h2>
          <p>版本 {DISCLAIMER_VERSION} · 同意后进入采集工作台</p>
        </div>
      </div>
      <div className="consent-content" tabIndex={0}>
        <DisclaimerContent />
      </div>
      <div className="consent-actions">
        <label className="check-label">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          我已阅读并同意免责声明
        </label>
        <p>
          如不同意，请关闭本页。
          <a href="/disclaimer" target="_blank" rel="noopener noreferrer">
            在新页面阅读全文 ↗
          </a>
        </p>
        <button
          className="button primary full-width"
          disabled={!checked}
          onClick={() => {
            let stored = true;
            try {
              localStorage.setItem(
                consentStorageKey,
                JSON.stringify({
                  version: DISCLAIMER_VERSION,
                  acceptedAt: new Date().toISOString(),
                }),
              );
            } catch {
              stored = false;
            }
            onAccept(stored);
          }}
        >
          同意并进入工作台
        </button>
      </div>
    </dialog>
  );
}

export function RenderSettings({
  config,
  onChange,
}: {
  config: CrawlConfig;
  onChange: (patch: Partial<CrawlConfig>) => void;
}) {
  return (
    <div className="render-settings">
      <label htmlFor="render-mode">网页加载方式</label>
      <select
        id="render-mode"
        className="input"
        value={config.renderMode ?? "static"}
        onChange={(event) =>
          onChange({ renderMode: event.target.value as "static" | "browser" })
        }
      >
        <option value="static">静态 HTML · 快速采集</option>
        <option value="browser">动态网页 · 浏览器渲染</option>
      </select>
      {config.renderMode === "browser" && (
        <>
          <div className="render-options">
            <div>
              <label htmlFor="render-wait">额外等待</label>
              <select
                className="input"
                id="render-wait"
                value={config.renderWaitMs ?? 2000}
                onChange={(event) =>
                  onChange({ renderWaitMs: Number(event.target.value) })
                }
              >
                {[0, 1000, 2000, 5000, 10000].map((value) => (
                  <option key={value} value={value}>
                    {value / 1000} 秒
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="wait-selector">等待元素（可选）</label>
              <input
                className="input mono"
                id="wait-selector"
                placeholder="例如 .product-item"
                maxLength={300}
                value={config.waitSelector ?? ""}
                onChange={(event) =>
                  onChange({ waitSelector: event.target.value })
                }
              />
            </div>
          </div>
          <p className="tool-note">
            执行 JavaScript 后提取页面内容。支持公开页面的 GET
            数据加载；每页最多渲染 30 秒，不含登录、滚动加载和点击翻页。
          </p>
        </>
      )}
    </div>
  );
}

export function ResultToolbar({
  filters,
  onChange,
  fields,
  total,
  count,
  removed,
}: {
  filters: ResultFilters;
  onChange: (filters: ResultFilters) => void;
  fields: string[];
  total: number;
  count: number;
  removed: number;
}) {
  const update = (patch: Partial<ResultFilters>) =>
    onChange({ ...filters, ...patch });
  return (
    <div className="result-filters">
      <div className="filter-grid">
        <label>
          搜索结果
          <input
            className="input"
            placeholder="输入关键词"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
          />
        </label>
        <label>
          筛选列
          <select
            className="input"
            value={filters.column}
            onChange={(event) => update({ column: event.target.value })}
          >
            <option value="">所有列</option>
            {fields.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          空值筛选
          <select
            className="input"
            value={filters.empty}
            onChange={(event) =>
              update({ empty: event.target.value as ResultFilters["empty"] })
            }
          >
            <option value="all">全部记录</option>
            <option value="missing">含空值</option>
            <option value="filled">无空值</option>
          </select>
        </label>
        <label>
          去重依据
          <select
            className="input"
            value={filters.dedupe}
            onChange={(event) => update({ dedupe: event.target.value })}
          >
            <option value="">不去重</option>
            <option value="__all__">所有字段相同</option>
            {fields.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          排序列
          <select
            className="input"
            value={filters.sort}
            onChange={(event) => update({ sort: event.target.value })}
          >
            <option value="">原始顺序</option>
            {fields.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          排序方向
          <select
            className="input"
            disabled={!filters.sort}
            value={filters.descending ? "desc" : "asc"}
            onChange={(event) =>
              update({ descending: event.target.value === "desc" })
            }
          >
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
        </label>
      </div>
      <div className="filter-summary">
        <span>
          显示 {count} / {total} 条 · 去重隐藏 {removed} 条
        </span>
        <button
          className="text-button"
          onClick={() => onChange({ ...defaultFilters })}
        >
          重置筛选
        </button>
      </div>
      <p className="tool-note">
        预览、复制和导出均使用当前筛选结果。原始记录保留；去重保留首条，空标识不合并。
      </p>
    </div>
  );
}

export function ProbePanel({
  report,
  disabled,
  onApply,
}: {
  report: ProbeReport;
  disabled: boolean;
  onApply: () => void;
}) {
  return (
    <section className="card probe-card" aria-label="规则诊断">
      <div className="card-heading">
        <div className="heading-with-icon">
          <FlaskConical size={18} />
          <h2>{report.operation === "analyze" ? "响应分析" : "规则试运行"}</h2>
        </div>
        <span className="subtle-badge">仅当前页</span>
      </div>
      <div className="probe-body">
        <p>
          HTTP {report.status} · {report.sourceType.toUpperCase()} ·{" "}
          {report.rendered ? "已动态渲染" : "原始响应"}
        </p>
        <p className="tool-note">
          {report.contentType || "未提供 Content-Type"}
        </p>
        <p>
          匹配 <strong>{report.matched}</strong> 条，保留{" "}
          <strong>{report.sampled}</strong> 条；数据见下方预览。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>选择器 / 路径</th>
                <th>非空命中</th>
              </tr>
            </thead>
            <tbody>
              {report.fields.map((field) => (
                <tr key={field.name}>
                  <td>{field.name}</td>
                  <td>
                    <code>{field.selector}</code>
                    <small> · {field.attribute}</small>
                  </td>
                  <td className={field.filled ? "" : "inline-error"}>
                    {field.filled} / {report.sampled}（
                    {report.sampled
                      ? Math.round((field.filled / report.sampled) * 100)
                      : 0}
                    %）
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.suggested && (
          <p>
            推荐列表：<code>{report.suggested.rowSelector || "整个页面"}</code>
            {report.suggested.nextSelector && (
              <>
                {" "}
                · 下一页：<code>{report.suggested.nextSelector}</code>
              </>
            )}
          </p>
        )}
        <ul className="tool-note">
          {report.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
        {report.suggested && (
          <button
            className="button primary"
            disabled={disabled}
            onClick={onApply}
          >
            应用分析规则
          </button>
        )}
      </div>
    </section>
  );
}

export function HistoryPanel({
  entries,
  disabled,
  error,
  onRefresh,
  onOpen,
  onReuse,
}: {
  entries: HistorySummary[];
  disabled: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  onOpen: (id: string) => void;
  onReuse: (entry: HistorySummary) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  async function remove(id?: string) {
    setDeleting(true);
    try {
      await deleteHistory(id);
      await onRefresh();
      setMessage("");
    } catch {
      setMessage("历史记录删除失败，请检查浏览器存储设置。");
    } finally {
      setDeleting(false);
    }
  }
  return (
    <section className="card history-card" aria-label="采集历史记录">
      <div className="card-heading">
        <div className="heading-with-icon">
          <History size={18} />
          <h2>采集历史</h2>
          <span className="count-badge">{entries.length}</span>
        </div>
        <button
          className="button small"
          disabled={disabled || deleting || !entries.length}
          onClick={() => void remove()}
        >
          清空历史
        </button>
      </div>
      <div className="history-body">
        <p className="tool-note">
          自动保存在当前浏览器，最多 20 次、合计 50
          MB；超限自动移除最早记录。结果可能含敏感内容，共享设备用后请清理。
        </p>
        {(error || message) && (
          <p className="inline-error" role="alert">
            {message || error}
          </p>
        )}
        {!entries.length && (
          <div className="history-empty">
            还没有历史记录，完成采集或试运行后会自动保存。
          </div>
        )}
        {entries.map((entry) => (
          <article className="history-item" key={entry.id}>
            <div>
              <div className="history-item-title">
                <span className={`status-dot ${entry.status}`} />
                <strong>
                  {entry.operation === "analyze"
                    ? "响应分析"
                    : entry.operation === "test"
                      ? "规则试运行"
                      : "网页采集"}
                </strong>
                <span>
                  {entry.status === "done"
                    ? "已完成"
                    : entry.status === "stopped"
                      ? "已停止"
                      : "已中断"}
                </span>
              </div>
              <p className="history-url" title={entry.config.url}>
                {entry.config.url}
              </p>
              <p className="tool-note">
                {new Date(entry.createdAt).toLocaleString("zh-CN")} ·{" "}
                {entry.count} 条 ·{" "}
                {entry.config.renderMode === "browser"
                  ? "动态渲染"
                  : entry.config.sourceType === "json"
                    ? "JSON"
                    : "HTML"}
              </p>
              {entry.error && <p className="inline-error">{entry.error}</p>}
            </div>
            <div className="history-actions">
              <button
                className="button small"
                disabled={disabled}
                onClick={() => onOpen(entry.id)}
              >
                查看结果
              </button>
              <button
                className="button small"
                disabled={disabled}
                onClick={() => onReuse(entry)}
              >
                载入规则
              </button>
              <button
                className="icon-button"
                aria-label="删除此条历史"
                disabled={disabled || deleting}
                onClick={() => void remove(entry.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
