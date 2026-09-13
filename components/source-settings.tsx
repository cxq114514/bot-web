"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Bookmark,
  Code2,
  Globe2,
  Save,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { defaultApi, jsonConfig, matchPreset, presets } from "@/lib/presets";
import { initialConfig, type CrawlConfig } from "@/lib/types";
import {
  persistentConfig,
  profileStorageKey,
  readProfiles,
  removeProfile,
  lastProfileStorageKey,
  type SiteProfile,
} from "@/lib/profiles";

export type SourceSettingsHandle = { save: () => void };
type Props = {
  config: CrawlConfig;
  disabled: boolean;
  onChange: (patch: Partial<CrawlConfig>) => void;
  onApply: (config: CrawlConfig) => void;
  onNotify: (message: string) => void;
  onSaved: () => void;
};

export const SourceSettings = forwardRef<SourceSettingsHandle, Props>(
  function SourceSettings(
    { config, disabled, onChange, onApply, onNotify, onSaved },
    ref,
  ) {
    const [profiles, setProfiles] = useState<SiteProfile[]>([]);
    const [selected, setSelected] = useState("");
    const [name, setName] = useState("");
    const json = config.sourceType === "json";
    const matched = matchPreset(config.url);
    useEffect(() => {
      try {
        setProfiles(readProfiles(localStorage));
      } catch {
        /* Storage may be disabled. */
      }
    }, []);

    function save() {
      if (disabled) return;
      const profileName = name.trim();
      if (!profileName) {
        onNotify("先给当前站点规则起个名字，再保存");
        document.getElementById("profile-name")?.focus();
        return;
      }
      if (config.fields.some((f) => !f.name.trim() || !f.selector.trim())) {
        onNotify("请先补全字段名称和选择器，再保存规则");
        return;
      }
      const existing = profiles.find((profile) => profile.id === selected);
      if (!existing && profiles.length >= 20) {
        onNotify("最多保存 20 套规则，请先删除不再使用的规则");
        return;
      }
      const profile: SiteProfile = {
        id: existing?.id ?? crypto.randomUUID(),
        name: profileName,
        config: persistentConfig(config),
        updatedAt: new Date().toISOString(),
      };
      const next = existing
        ? profiles.map((p) => (p.id === existing.id ? profile : p))
        : [...profiles, profile];
      try {
        localStorage.setItem(profileStorageKey, JSON.stringify(next));
        localStorage.setItem(
          "crawlspace-rule-v1",
          JSON.stringify(profile.config),
        );
        localStorage.setItem(lastProfileStorageKey, profile.id);
        setProfiles(next);
        setSelected(profile.id);
        onSaved();
        onNotify(
          json
            ? "规则已保存；请求头、请求体和接口查询参数不会保存"
            : "站点规则已保存在当前浏览器",
        );
      } catch {
        onNotify("保存失败，请检查浏览器存储空间或隐私设置");
      }
    }
    useImperativeHandle(ref, () => ({ save }));

    function remove() {
      try {
        const next = removeProfile(localStorage, profiles, selected);
        setProfiles(next);
        setSelected("");
        onChange({});
        onNotify("已删除保存的规则，当前配置仍可继续编辑");
      } catch {
        onNotify("无法删除，请检查浏览器存储设置");
      }
    }

    return (
      <section className="source-settings" aria-label="网站与数据源">
        <div className="source-mode" role="group" aria-label="数据源类型">
          <button
            type="button"
            disabled={disabled}
            className={!json ? "selected" : ""}
            onClick={() => {
              onApply({ ...structuredClone(initialConfig), url: config.url });
              setSelected("");
            }}
          >
            <Globe2 size={15} />
            网页 HTML
          </button>
          <button
            type="button"
            disabled={disabled}
            className={json ? "selected" : ""}
            onClick={() => {
              onApply({ ...structuredClone(jsonConfig), url: config.url });
              setSelected("");
            }}
          >
            <Code2 size={15} />
            自定义接口
          </button>
        </div>
        <div className="profile-grid">
          <div>
            <label htmlFor="preset">网站预设</label>
            <select
              id="preset"
              disabled={disabled}
              value=""
              onChange={(event) => {
                const preset = presets.find((p) => p.id === event.target.value);
                if (preset) {
                  onApply(structuredClone(preset.config));
                  setName(preset.name);
                  setSelected("");
                }
              }}
            >
              <option value="" disabled>
                选择预设或自行配置
              </option>
              {presets.map((preset) => (
                <option value={preset.id} key={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="saved-profile">
              <Bookmark size={13} />
              已保存的站点
            </label>
            <select
              id="saved-profile"
              disabled={disabled}
              value={selected}
              onChange={(event) => {
                const profile = profiles.find(
                  (p) => p.id === event.target.value,
                );
                setSelected(event.target.value);
                if (profile) {
                  onApply(structuredClone(profile.config));
                  setName(profile.name);
                }
              }}
            >
              <option value="">新规则 / 另存为</option>
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="profile-name-row">
          <input
            id="profile-name"
            aria-label="站点规则名称"
            placeholder="规则名称，例如：我的商品列表"
            maxLength={50}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={disabled}
          />
          <button
            type="button"
            className="icon-button"
            disabled={disabled || !selected}
            onClick={remove}
            aria-label="删除已保存的站点规则"
          >
            <Trash2 size={15} />
          </button>
        </div>
        {matched && !json && (
          <button
            className="text-button detect-preset"
            type="button"
            disabled={disabled}
            onClick={() => {
              onApply({ ...structuredClone(matched.config), url: config.url });
              setName(matched.name);
              setSelected("");
              onNotify("已按域名应用站点规则");
            }}
          >
            <WandSparkles size={14} />
            识别到 {matched.name}，应用规则
          </button>
        )}
        <p className="profile-note">
          可独立保存 20 套站点规则；切换预设会替换当前字段。
          <Save size={12} />
          在下方保存
        </p>
      </section>
    );
  },
);

export function ApiSettings({
  config,
  disabled,
  onChange,
  onValidity,
}: Pick<Props, "config" | "disabled" | "onChange"> & {
  onValidity: (valid: boolean) => void;
}) {
  const api = config.api ?? defaultApi;
  const [headers, setHeaders] = useState(JSON.stringify(api.headers, null, 2));
  const editedHeaders = useRef<Record<string, string> | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (editedHeaders.current === api.headers) return;
    setHeaders(JSON.stringify(api.headers, null, 2));
    setInvalid(false);
    onValidity(true);
  }, [api.headers, onValidity]);
  const update = (patch: Partial<typeof api>) =>
    onChange({ api: { ...api, ...patch } });

  return (
    <div className="api-settings">
      <div className="api-method">
        <label htmlFor="api-method">请求方式</label>
        <select
          id="api-method"
          value={api.method}
          disabled={disabled}
          onChange={(event) =>
            update({ method: event.target.value as "GET" | "POST", body: "" })
          }
        >
          <option>GET</option>
          <option>POST</option>
        </select>
        <span>
          {api.method === "POST"
            ? "仅用于你获授权的只读查询接口"
            : "查询参数直接填写在接口网址中"}
        </span>
      </div>
      <label htmlFor="api-headers">
        自定义请求头 <span>JSON 对象，可填 Authorization 或 X-API-Key</span>
      </label>
      <textarea
        id="api-headers"
        className="input mono"
        disabled={disabled}
        spellCheck={false}
        rows={3}
        value={headers}
        aria-invalid={invalid}
        onChange={(event) => {
          setHeaders(event.target.value);
          try {
            const value = JSON.parse(event.target.value || "{}");
            if (
              !value ||
              typeof value !== "object" ||
              Array.isArray(value) ||
              !Object.values(value).every((v) => typeof v === "string")
            )
              throw new Error();
            editedHeaders.current = value;
            update({ headers: value });
            setInvalid(false);
            onValidity(true);
          } catch {
            setInvalid(true);
            onValidity(false);
          }
        }}
      />
      {invalid && (
        <p className="inline-error">
          请填写有效 JSON 对象，所有请求头的值需为字符串。
        </p>
      )}
      {api.method === "POST" && (
        <>
          <label htmlFor="api-body">JSON 请求体</label>
          <textarea
            id="api-body"
            className="input mono"
            rows={4}
            value={api.body}
            placeholder={'{"query":"example"}'}
            disabled={disabled}
            onChange={(event) => update({ body: event.target.value })}
            spellCheck={false}
          />
        </>
      )}
      <p className="credential-note">
        请求头、请求体和接口 URL
        的查询参数仅在本次会话使用，不写入保存的规则。请勿把密钥放在 URL
        路径中。
      </p>
    </div>
  );
}
