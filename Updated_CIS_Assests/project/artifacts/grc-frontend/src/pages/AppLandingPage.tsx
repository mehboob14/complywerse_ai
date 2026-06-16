import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ScrollText,
  ShieldAlert,
  Layers,
  Bug,
  Bot,
  Server,
  Sparkles,
  Search,
  Plus,
  Activity,
  ClipboardCheck,
  Users,
  FileSearch,
  Workflow,
  Building2,
  Gauge,
  AlertOctagon,
  CalendarRange,
  GitBranch,
  Network,
  BookOpen,
  ListChecks,
  PackageCheck,
  Globe2,
  Zap,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { apiClient } from "@/lib/api";

const PRODUCT_NAME = "CompliverseAI";
const WORKSPACE_PATH = "/dashboard";
const LOGO_ASSET = "/assets/compliverseai-logo.png";

const ctaGradient =
  "linear-gradient(135deg, hsl(166 76% 48%) 0%, hsl(186 84% 52%) 100%)";

const surfaceGradient =
  "radial-gradient(ellipse at 20% 0%, hsl(166 50% 96%) 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, hsl(186 60% 95%) 0%, transparent 50%), linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)";

type StatKey =
  | "frameworks"
  | "policies"
  | "controls"
  | "risks"
  | "vulns"
  | "assets"
  | "evidence"
  | "incidents"
  | "vendors"
  | "tasks";

type ModuleLink = {
  name: string;
  href: string;
  desc: string;
  statKey?: StatKey;
};

type Pillar = {
  key: string;
  label: string;
  tagline: string;
  icon: LucideIcon;
  accent: string; // hex/css color used as left border + chip
  links: ModuleLink[];
};

const PILLARS: Pillar[] = [
  {
    key: "govern",
    label: "Govern",
    tagline: "Policies, attestations, committees, regulatory change",
    icon: ScrollText,
    accent: "#14b8a6",
    links: [
      { name: "Governance hub", href: "/governance", desc: "Approvals, mappings, AI-drafted policies" },
      { name: "Policies & documents", href: "/governance/documents", desc: "Author, version, attest, archive", statKey: "policies" },
      { name: "Attestation campaigns", href: "/governance/attestations", desc: "Roll out and track sign-offs" },
      { name: "Committees & minutes", href: "/governance/committees", desc: "Run governance committees, log actions" },
      { name: "Regulatory change", href: "/governance/regulatory-changes", desc: "Track laws, assess impact, action" },
      { name: "Policy AI", href: "/governance/policy-ai", desc: "Generate policies from frameworks" },
    ],
  },
  {
    key: "risk",
    label: "Manage Risk",
    tagline: "Register, RCSA, KRIs, appetite, incidents",
    icon: ShieldAlert,
    accent: "#f59e0b",
    links: [
      { name: "Risk register", href: "/erm/risks", desc: "Inherent vs residual, owners, treatments", statKey: "risks" },
      { name: "RCSA campaigns", href: "/risks/rcsa/campaigns", desc: "Templates, assessments, findings, approvals" },
      { name: "Risk heatmap & analytics", href: "/erm/analytics/heatmap", desc: "Heatmap, bowtie, scenarios, aggregation" },
      { name: "KRIs & appetite", href: "/erm/kris", desc: "Key risk indicators, thresholds, appetite" },
      { name: "Incidents", href: "/erm/incidents", desc: "Capture, triage, root cause, lessons learned" },
      { name: "Internal controls (ERM)", href: "/erm/internal-controls", desc: "Map controls to risks, monitor" },
    ],
  },
  {
    key: "comply",
    label: "Comply",
    tagline: "Frameworks, controls, evidence, audit",
    icon: Layers,
    accent: "#0ea5e9",
    links: [
      { name: "Frameworks", href: "/frameworks", desc: "ISO 27001, SOC 2, NIST, PCI, custom", statKey: "frameworks" },
      { name: "Compliance assessments", href: "/compliance/assessments", desc: "Run assessments with approvals" },
      { name: "Control library", href: "/control-library", desc: "Normalized controls, gaps, comparisons", statKey: "controls" },
      { name: "Evidence & audit packages", href: "/evidence", desc: "Collect, link, package for auditors", statKey: "evidence" },
      { name: "Internal audit", href: "/audit", desc: "Universe, plans, engagements, findings" },
      { name: "Auditor portal", href: "/auditor-portal", desc: "Read-only view for external auditors" },
    ],
  },
  {
    key: "operate",
    label: "Operate",
    tagline: "Assets, vulnerabilities, vendors, AI",
    icon: Workflow,
    accent: "#8b5cf6",
    links: [
      { name: "IT Assets", href: "/assets", desc: "Inventory, owners, criticality", statKey: "assets" },
      { name: "Vulnerability management", href: "/vulnerabilities/dashboard", desc: "Findings, SLAs, remediation, reports", statKey: "vulns" },
      { name: "Vendor risk", href: "/vendor-risk", desc: "Onboarding, questionnaires, scoring", statKey: "vendors" },
      { name: "Workflow engine", href: "/workflow-engine", desc: "Automate cross-module workflows" },
      { name: "ComplyChat AI", href: "/complychat", desc: "Ask your GRC posture in plain English" },
      { name: "My tasks", href: "/tasks/my-tasks", desc: "Personal queue across modules", statKey: "tasks" },
    ],
  },
];

const AI_COPILOTS: { icon: LucideIcon; title: string; body: string; href: string }[] = [
  {
    icon: Bot,
    title: "ComplyChat",
    body: "Ask plain-English questions about your risks, controls, gaps, evidence and posture.",
    href: "/complychat",
  },
  {
    icon: ScrollText,
    title: "Policy AI",
    body: "Draft, refine and align policies to ISO 27001, SOC 2, NIST and custom frameworks.",
    href: "/governance/policy-ai",
  },
  {
    icon: Network,
    title: "Auto-mapping",
    body: "Map evidence and controls to multiple frameworks at once, surface gaps automatically.",
    href: "/control-library/gaps",
  },
  {
    icon: Sparkles,
    title: "AI insights",
    body: "Executive summaries, emerging risks, board-readiness signals computed from your data.",
    href: "/dashboard",
  },
];

const TOP_FRAMEWORKS = [
  "ISO 27001",
  "ISO 27701",
  "SOC 2",
  "NIST CSF",
  "NIST 800-53",
  "PCI DSS",
  "HIPAA",
  "GDPR",
  "CIS Controls",
  "COBIT",
];

const PULSE_KEYS: { key: StatKey; label: string; icon: LucideIcon; href: string }[] = [
  { key: "frameworks", label: "Frameworks", icon: Layers, href: "/frameworks" },
  { key: "policies", label: "Policies", icon: ScrollText, href: "/governance/documents" },
  { key: "controls", label: "Controls", icon: ListChecks, href: "/control-library" },
  { key: "risks", label: "Risks", icon: ShieldAlert, href: "/erm/risks" },
  { key: "vulns", label: "Vulnerabilities", icon: Bug, href: "/vulnerabilities/dashboard" },
  { key: "assets", label: "IT Assets", icon: Server, href: "/assets" },
  { key: "evidence", label: "Evidence", icon: PackageCheck, href: "/evidence" },
  { key: "vendors", label: "Vendors", icon: Users, href: "/vendor-risk/vendors" },
];

function readLs(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function getFirstName(): string {
  const raw = readLs("user_name") || readLs("user_full_name") || readLs("user_display_name");
  if (raw) return raw.split(/\s+/)[0];
  return "";
}

function useStats() {
  return useQuery({
    queryKey: ["app-landing-stats-v2"],
    queryFn: async () => {
      const settled = await Promise.allSettled([
        apiClient.get("/compliance/policies/dashboard/summary"),
        apiClient.get("/erm/risks/?limit=1"),
        apiClient.get("/vuln-management/dashboard"),
        apiClient.get("/assets/dashboard"),
        apiClient.get("/certifications"),
        apiClient.get("/control-library?limit=1"),
        apiClient.get("/evidence?limit=1"),
        apiClient.get("/vendor-risk/vendors?limit=1"),
        apiClient.get("/tasks/my-tasks?limit=1"),
        apiClient.get("/erm/incidents?limit=1"),
      ]);

      const ok = <T,>(i: number): T | null =>
        settled[i].status === "fulfilled"
          ? ((settled[i] as PromiseFulfilledResult<{ data: T }>).value.data as T)
          : null;
      const totalHeader = (i: number): number | undefined => {
        if (settled[i].status !== "fulfilled") return undefined;
        const h = (settled[i] as PromiseFulfilledResult<{ headers?: Record<string, string> }>).value
          .headers;
        const v = h?.["x-total-count"];
        return v ? Number(v) : undefined;
      };
      const arrLen = (i: number): number | undefined => {
        const d = ok<unknown>(i);
        return Array.isArray(d) ? d.length : undefined;
      };
      const numField = (i: number, ...fields: string[]): number | undefined => {
        const d = ok<Record<string, unknown>>(i);
        if (!d || typeof d !== "object") return undefined;
        for (const f of fields) {
          const v = (d as Record<string, unknown>)[f];
          if (typeof v === "number" && !Number.isNaN(v)) return v;
        }
        return undefined;
      };

      const out: Partial<Record<StatKey, number>> = {};
      const policies = numField(0, "total", "total_policies", "count");
      if (policies !== undefined) out.policies = policies;
      const risks = totalHeader(1);
      if (risks !== undefined) out.risks = risks;
      const vulns = numField(2, "total", "total_vulnerabilities", "count");
      if (vulns !== undefined) out.vulns = vulns;
      const assets = numField(3, "total_assets", "total", "count");
      if (assets !== undefined) out.assets = assets;
      const frameworks = arrLen(4);
      if (frameworks !== undefined) out.frameworks = frameworks;
      const controls = totalHeader(5) ?? arrLen(5);
      if (controls !== undefined) out.controls = controls;
      const evidence = totalHeader(6) ?? arrLen(6);
      if (evidence !== undefined) out.evidence = evidence;
      const vendors = totalHeader(7) ?? arrLen(7);
      if (vendors !== undefined) out.vendors = vendors;
      const tasks = totalHeader(8) ?? arrLen(8);
      if (tasks !== undefined) out.tasks = tasks;
      const incidents = totalHeader(9) ?? arrLen(9);
      if (incidents !== undefined) out.incidents = incidents;
      return out;
    },
    staleTime: 60_000,
    retry: false,
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export default function AppLandingPage() {
  const [, navigate] = useLocation();
  const firstName = useMemo(() => getFirstName(), []);
  const tenantName = useMemo(() => readLs("tenant_name"), []);
  const [skipLanding, setSkipLanding] = useState<boolean>(
    () => readLs("skip_landing") === "true",
  );
  const { data: stats } = useStats();

  // If the user previously opted to skip this page, send them straight to the workspace.
  useEffect(() => {
    if (skipLanding) {
      navigate(WORKSPACE_PATH, { replace: true });
    }
    // Mount only — checkbox toggle persists for next session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSkipChange = (checked: boolean) => {
    setSkipLanding(checked);
    try {
      if (checked) localStorage.setItem("skip_landing", "true");
      else localStorage.removeItem("skip_landing");
    } catch {
      /* ignore */
    }
  };

  const renderStat = (k?: StatKey) => {
    if (!k || !stats) return null;
    const v = stats[k];
    if (typeof v !== "number" || Number.isNaN(v)) return null;
    return formatNumber(v);
  };

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden"
      style={{ background: surfaceGradient, fontFamily: "Poppins, sans-serif" }}
    >
      <style>{`
        @keyframes appLandFadeUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes appLandPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(30,212,176,.55) } 50% { box-shadow: 0 0 0 8px rgba(30,212,176,0) } }
        .al-fade { animation: appLandFadeUp .55s ease-out both; }
        .al-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
        .al-card:hover { transform: translateY(-2px); box-shadow: 0 14px 34px -16px rgba(15,23,42,0.20); }
        .al-link-row { transition: background-color .15s ease, color .15s ease; }
        .al-link-row:hover { background-color: rgba(15,23,42,0.03); }
        .al-pulse-pill { transition: transform .15s ease; }
        .al-pulse-pill:hover { transform: translateY(-2px); }
      `}</style>

      <div className="mx-auto max-w-6xl px-6 py-10 lg:py-12">
        {/* ---------- Header ---------- */}
        <header className="al-fade flex items-center justify-between">
          <Link href="/landing" className="flex items-center gap-2.5">
            <img
              src={LOGO_ASSET}
              alt={PRODUCT_NAME}
              className="h-9 w-9 rounded-lg object-cover ring-1 ring-slate-200"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="text-base font-semibold tracking-tight text-slate-900">
              {PRODUCT_NAME}
            </span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {(firstName || tenantName) && (
              <span className="hidden text-slate-600 sm:inline">
                {firstName && (
                  <>
                    Signed in as{" "}
                    <span className="font-medium text-slate-900">{firstName}</span>
                  </>
                )}
                {firstName && tenantName && <span className="mx-1.5 text-slate-300">·</span>}
                {tenantName && <span className="font-medium text-slate-900">{tenantName}</span>}
              </span>
            )}
            <Link
              href="/dashboard"
              className="text-slate-500 transition hover:text-slate-900"
            >
              Skip overview
            </Link>
          </div>
        </header>

        {/* ---------- Hero ---------- */}
        <section className="al-fade mt-10" style={{ animationDelay: "60ms" }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-700">
            <Sparkles className="h-3 w-3" /> Mission control
          </div>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-slate-900 lg:text-5xl">
            {firstName ? <>Welcome, {firstName}.</> : <>You're in.</>}{" "}
            <span className="text-slate-500">
              Here is everything {PRODUCT_NAME} runs for you.
            </span>
          </h1>
          <p className="mt-3 max-w-3xl text-base text-slate-600">
            One platform for{" "}
            <span className="font-medium text-slate-800">governance</span>,{" "}
            <span className="font-medium text-slate-800">enterprise risk</span>,{" "}
            <span className="font-medium text-slate-800">compliance &amp; controls</span>,{" "}
            <span className="font-medium text-slate-800">internal audit</span>,{" "}
            <span className="font-medium text-slate-800">vendor risk</span>,{" "}
            <span className="font-medium text-slate-800">vulnerability management</span>{" "}
            and <span className="font-medium text-slate-800">IT assets</span> — all
            connected by a workflow engine and powered by AI copilots. Pick an area
            to dive in, or jump straight to your dashboard.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
              <span
                className="h-2 w-2 rounded-full bg-emerald-500"
                style={{ animation: "appLandPulse 1.8s ease-out infinite" }}
              />
              All systems online
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              <Globe2 className="h-3 w-3 text-slate-400" /> Multi-tenant SaaS
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              <Zap className="h-3 w-3 text-amber-500" /> AI-assisted
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              <CheckCircle2 className="h-3 w-3 text-teal-600" /> Audit-ready
            </div>
          </div>
        </section>

        {/* ---------- Platform pulse (live stats strip) ---------- */}
        <section className="al-fade mt-10" style={{ animationDelay: "120ms" }}>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Activity className="h-3.5 w-3.5 text-teal-600" /> Platform pulse
            <span className="text-slate-300">·</span>
            <span className="font-normal normal-case tracking-normal text-slate-500">
              live numbers from your tenant
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
            {PULSE_KEYS.map(({ key, label, icon: Icon, href }) => {
              const v = renderStat(key);
              return (
                <Link
                  key={key}
                  href={href}
                  className="al-pulse-pill rounded-xl border border-slate-200/80 bg-white px-3 py-3 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-3.5 w-3.5 text-teal-600" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                      {label}
                    </span>
                  </div>
                  <div className="mt-2 text-xl font-bold tracking-tight text-slate-900">
                    {v ?? <span className="text-slate-300">—</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ---------- AI Copilots ---------- */}
        <section className="al-fade mt-12" style={{ animationDelay: "180ms" }}>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-600">
                AI copilots
              </div>
              <h2 className="mt-1 text-xl font-bold text-slate-900">
                Built-in AI across every module
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {AI_COPILOTS.map(({ icon: Icon, title, body, href }) => (
              <Link
                key={title}
                href={href}
                className="al-card group block rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-teal-50/30 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-teal-700"
                    style={{ background: "rgba(30,212,176,0.14)" }}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{body}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* ---------- Pillars (Govern · Risk · Comply · Operate) ---------- */}
        <section className="al-fade mt-12" style={{ animationDelay: "240ms" }}>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-600">
                Capabilities
              </div>
              <h2 className="mt-1 text-xl font-bold text-slate-900">
                Four pillars, one workspace
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Every module shares the same controls library, evidence vault and
                workflow engine — so nothing is reconciled twice.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {PILLARS.map((p) => {
              const PIcon = p.icon;
              return (
                <div
                  key={p.key}
                  className="al-card overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"
                  style={{ borderLeft: `3px solid ${p.accent}` }}
                >
                  <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-xl"
                        style={{
                          background: `${p.accent}1a`,
                          color: p.accent,
                        }}
                      >
                        <PIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-slate-900">
                          {p.label}
                        </h3>
                        <p className="text-xs text-slate-500">{p.tagline}</p>
                      </div>
                    </div>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {p.links.map((l) => {
                      const v = renderStat(l.statKey);
                      return (
                        <li key={l.href}>
                          <Link
                            href={l.href}
                            className="al-link-row group flex items-start gap-3 px-5 py-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700">
                                  {l.name}
                                </span>
                                {v && (
                                  <span
                                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                    style={{
                                      background: `${p.accent}12`,
                                      color: p.accent,
                                    }}
                                  >
                                    {v}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-slate-500">
                                {l.desc}
                              </p>
                            </div>
                            <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- Frameworks supported ---------- */}
        <section className="al-fade mt-12" style={{ animationDelay: "300ms" }}>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <BookOpen className="h-3.5 w-3.5 text-teal-600" /> Frameworks supported
            <span className="text-slate-300">·</span>
            <span className="font-normal normal-case tracking-normal text-slate-500">
              plus any custom framework you upload
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {TOP_FRAMEWORKS.map((f) => (
              <Link
                key={f}
                href="/frameworks"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-teal-300 hover:text-teal-700"
              >
                {f}
              </Link>
            ))}
            {/* Restored: admin can upload custom regulatory framework PDFs
                (region-specific extensions like SBP / SAMA addenda the
                global library doesn't carry). Chip is intentionally
                styled dashed/teal to read as a secondary action — the
                pre-loaded frameworks above remain the canonical path. */}
            <Link
              href="/framework-upload"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-teal-300 bg-teal-50/60 px-3 py-1.5 text-xs font-medium text-teal-700 transition hover:bg-teal-50"
            >
              <Plus className="h-3 w-3" /> Upload custom
            </Link>
          </div>
        </section>

        {/* ---------- Quick actions ---------- */}
        <section className="al-fade mt-10" style={{ animationDelay: "340ms" }}>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Quick actions
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { href: "/erm/risks", icon: Plus, label: "New risk" },
              { href: "/governance/documents", icon: Plus, label: "New policy" },
              { href: "/erm/incidents", icon: AlertOctagon, label: "Log incident" },
              { href: "/vendor-risk/vendors", icon: Plus, label: "Onboard vendor" },
              { href: "/audit/engagements", icon: ClipboardCheck, label: "Start audit" },
              { href: "/compliance/assessments", icon: FileSearch, label: "Run assessment" },
              { href: "/governance/attestations", icon: GitBranch, label: "Launch attestation" },
              { href: "/complychat", icon: Search, label: "Ask ComplyChat" },
              { href: "/tasks/my-tasks", icon: CalendarRange, label: "My tasks" },
              { href: "/integrations", icon: Building2, label: "Connect a tool" },
              { href: "/dashboard", icon: Gauge, label: "Open dashboard" },
            ].map(({ href, icon: Icon, label }) => (
              <Link
                key={label}
                href={href}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-teal-300 hover:text-teal-700"
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </Link>
            ))}
          </div>
        </section>

        {/* ---------- Primary CTA ---------- */}
        <section
          className="al-fade mt-14 flex flex-col items-center"
          style={{ animationDelay: "400ms" }}
        >
          <button
            type="button"
            onClick={() => navigate(WORKSPACE_PATH)}
            className="inline-flex items-center gap-2 rounded-2xl px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-95"
            style={{
              background: ctaGradient,
              boxShadow: "0 10px 28px -12px rgba(20,184,166,0.55)",
            }}
          >
            Enter {PRODUCT_NAME}
            <ArrowRight className="h-4 w-4" />
          </button>

          <label className="mt-4 inline-flex select-none items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={skipLanding}
              onChange={(e) => onSkipChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            Don't show me this overview again
          </label>
        </section>

        {/* ---------- Footer ---------- */}
        <footer
          className="al-fade mt-14 flex flex-col items-center gap-2 border-t border-slate-200/70 pt-6 text-xs text-slate-500"
          style={{ animationDelay: "460ms" }}
        >
          <div>
            {PRODUCT_NAME} · build {new Date().getFullYear()}
          </div>
          <Link
            href="/welcome?replay=1"
            className="text-teal-700 transition hover:text-teal-800"
          >
            Replay welcome intro
          </Link>
        </footer>
      </div>
    </div>
  );
}
