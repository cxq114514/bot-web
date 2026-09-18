# sharp / libvips 许可证告警核查

核查日期：2026-09-18。范围：`package-lock.json` 中报告列出的 14 个 LGPL 相关 npm 包，以及 PR #1 的依赖变化。

## 结论与处理决定

保留现有依赖，记录核查依据。报告中的“高危（70）”是该扫描器的许可证政策评级，这份报告没有给出 CVE 或可利用漏洞，不能据此认定存在 14 个安全漏洞。许可证识别本身有依据，不应把这些条目统一标为误报。

LGPL 不禁止商业使用，也不因使用库的接口就一概要求整个应用采用 LGPL 并公开全部源码；其对组合程序的发布另有条件。随产品分发库、修改库、静态链接和动态链接的具体义务应分别核对。[LGPL v3 原文及其附带的 GPL v3 条款](https://spdx.org/licenses/LGPL-3.0-or-later.html)

仓库根目录的 [LICENSE](../LICENSE) 已包含 GPL v3 文本。项目自身的许可与第三方组件许可需要分别遵守；本次核查不改变任何许可，也不等于最终分发产物已完成合规验收。

## 依赖来源与实际使用

锁文件中的依赖链为：

```text
crawlspace
└─ next@16.3.5
   └─ sharp@0.35.4（Next.js 的 optionalDependency）
      ├─ @img/sharp-libvips-* @1.3.3
      └─ @img/sharp-* @0.35.4
```

这些包属于图像处理依赖，不是 Playwright 新引入的依赖。对照 PR 基线 `1fc2ebd` 与功能提交 `d5d0499`，下列 14 个包的锁文件条目未发生变化。

`sharp` 自身标为 Apache-2.0，但预编译包包含其他组件，不能以主包许可覆盖整个依赖树。[sharp 许可说明](https://sharp.pixelplumbing.com/#licensing)、[预编译包的构建与许可说明](https://github.com/lovell/sharp-libvips#licences)

所有 14 个条目均标记为 `optional: true`。锁文件覆盖多个操作系统和 CPU 架构，不表示每台机器都安装全部 14 个包。Windows x64 验证环境实际安装了 `@img/sharp-win32-x64@0.35.4`，因此也不能把 `optional` 理解为“没有安装”或“无需核查”。

应用源码当前未直接引用 `sharp`、`next/image`、`next/og` 或 `ImageResponse`；这只是调用情况，不代表安装包、框架服务或后续发布产物中不存在相关组件。

## 告警清单

以下为锁文件的 SPDX 表达式，保留 `AND` 和 `or-later` 的原意，不改写为单一宽松许可证。

| 包名 | 版本 | 锁文件许可 |
| --- | --- | --- |
| `@img/sharp-libvips-darwin-arm64` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-darwin-x64` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm64` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-ppc64` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-riscv64` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-s390x` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-x64` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-x64` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-wasm32` | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| `@img/sharp-win32-arm64` | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-ia32` | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-x64` | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later |

## 分发时的核查范围

对外提供 Docker 镜像、安装包或附带依赖的运行目录前，应基于实际产物确认：

- 保留实际随包组件的版权、许可全文和第三方声明；不同平台的捆绑组件可能不同。
- 按适用许可提供对应版本的库源码、修改内容及所需构建材料；仅放一个上游首页链接不等于完成源码提供义务。
- 按组合方式满足 LGPL 的库替换或重新链接等要求，不能因为采用 Node.js 就默认属于满足条件的动态链接。
- 同时履行本项目根 LICENSE 及其他捆绑组件的许可要求。

依据：[LGPL v3 第 4 节及 GPL v3 第 6 节](https://spdx.org/licenses/LGPL-3.0-or-later.html)。上游 [THIRD-PARTY-NOTICES](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md) 是组件核查入口，实际分发应留存与所用版本匹配的声明和源码材料，不能只依赖可变的 main 分支。

本文件是该报告的工程核查记录，不是所有依赖的完整 SBOM，也不是二进制发布所需的完整第三方许可包。

## 扫描告警如何处理

保留锁文件中的真实许可信息。不要删除 `license` 字段、把 LGPL 改成 MIT／Apache-2.0，或添加全局忽略规则来隐藏告警。

本次未关闭告警、未修改扫描器策略。因为依赖仍保留，重新扫描仍可能报告同样的条目。若项目允许此类许可，可在核对实际使用和分发方式后，按扫描平台流程记录限于这些包及版本的许可接受决定，并引用本文件；只有完成该流程后，才应调整平台上的告警状态。依赖升级或分发方式变化时应重新核查。

设置 `images.unoptimized` 不会移除锁文件中的依赖；`npm ci --omit=optional` 也不会删除锁文件记录，并可能影响其他可选原生依赖，不能作为许可证告警已解决的证据。

## 复核方法

在仓库根目录执行以下只读检查：

```bash
node -e "const p=require('./package-lock.json'); for(const [n,v] of Object.entries(p.packages)) if((v.license||'').includes('LGPL')) console.log(n, v.version, v.license, 'optional='+v.optional)"
npm ls next sharp --all
```

第一条检查锁文件；第二条检查当前机器已安装的依赖，需要先完成安装，不能代表其他平台或发布镜像的实际内容。
