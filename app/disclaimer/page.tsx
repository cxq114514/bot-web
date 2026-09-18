import { DisclaimerContent } from "@/components/disclaimer-content";
import { DISCLAIMER_VERSION } from "@/lib/consent";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "使用说明与免责声明 · Crawlspace",
  description: "Crawlspace 的使用范围、数据权益、接口凭据处理和责任说明。",
};

export default function Disclaimer() {
  return (
    <main className="legal-page">
      <Link className="text-button" href="/">
        <ArrowLeft size={16} />
        返回采集工作台
      </Link>
      <article className="card legal-card">
        <div className="legal-icon">
          <ShieldCheck size={28} />
        </div>
        <p className="eyebrow">RESPONSIBLE DATA COLLECTION</p>
        <h1>使用说明与免责声明</h1>
        <p className="tool-note">
          版本 {DISCLAIMER_VERSION} · 使用工作台前须主动勾选并同意本声明
        </p>
        <p className="legal-intro">
          Crawlspace
          是可配置的数据采集工具。请在采集网页或调用接口前确认数据的访问权限、允许用途以及目标服务的规则。
        </p>
        <DisclaimerContent />
        <div className="legal-bottom">
          <Link className="button primary" href="/">
            返回工作台
          </Link>
          <span>如无法确认是否获准采集，请先联系目标网站或接口的管理方。</span>
        </div>
      </article>
    </main>
  );
}
