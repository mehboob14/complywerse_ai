import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, useInView } from "framer-motion";
import {
  AlertTriangle,
  ScrollText,
  Users,
  ArrowRight,
  Sparkles,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Bug,
  Server,
  Workflow,
  Layers,
  Network,
  BookOpen,
  PackageCheck,
  Plug,
  type LucideIcon,
} from "lucide-react";

const PRODUCT_NAME = "CompliverseAI";
const PRODUCT_TAGLINE = "Govern. Comply. Manage Risk.";
const HERO_VERB = "Run";
const HERO_NOUN = "your entire GRC program";
const PRIMARY_OUTCOME =
  "One platform for governance, risk, compliance, vendor risk, audits, and policy automation — powered by AI.";
const BRAND_HUE = 166;
const LOGO_ASSET = "/logo.jpeg";
const ROUTE_AFTER_CTA = "/dashboard";
const LOGIN_PATH = "/login";

type Feature = { icon: LucideIcon; title: string; desc: string };

const FEATURES: Feature[] = [
  {
    icon: ScrollText,
    title: "Policy AI & Governance",
    desc: "Draft, review, attest, and govern policies with approval workflows, committees and regulatory-change tracking.",
  },
  {
    icon: AlertTriangle,
    title: "Enterprise Risk Management",
    desc: "Risk register, RCSA campaigns, KRIs, appetite, heatmaps, bowtie analysis and incident management.",
  },
  {
    icon: Layers,
    title: "Compliance & Frameworks",
    desc: "ISO 27001, ISO 27701, SOC 2, NIST CSF / 800-53, PCI DSS, HIPAA, GDPR, COBIT — plus your custom frameworks.",
  },
  {
    icon: ClipboardCheck,
    title: "Internal Audit",
    desc: "Audit universe, plans, engagements, findings, test scripts, QAIP and continuous control monitoring (CCM).",
  },
  {
    icon: Bug,
    title: "Vulnerability Management",
    desc: "Findings from Nessus, Rapid7 and others. SLAs, departments, remediation reports and dashboards.",
  },
  {
    icon: Server,
    title: "IT Asset Inventory",
    desc: "Single source of truth for systems, owners, criticality and dependencies across the estate.",
  },
  {
    icon: Users,
    title: "Vendor & Third-Party Risk",
    desc: "Onboard vendors, send questionnaires via secure links, score and re-assess on a schedule.",
  },
  {
    icon: PackageCheck,
    title: "Evidence & Audit Packages",
    desc: "Collect evidence once, reuse across frameworks. Export auditor-ready packages in a click.",
  },
  {
    icon: Workflow,
    title: "Workflow Engine",
    desc: "Automate approvals, attestations, reviews and remediation across modules — no spreadsheets.",
  },
  {
    icon: Bot,
    title: "ComplyChat AI",
    desc: "Ask plain-English questions about your risks, controls, gaps and posture. Grounded in your data.",
  },
  {
    icon: Network,
    title: "Cross-framework mapping",
    desc: "Map controls and evidence to multiple frameworks at once. Surface gaps automatically.",
  },
  {
    icon: Plug,
    title: "Integrations",
    desc: "Connectors for vulnerability scanners, identity providers and ticketing tools — with more on the way.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Connect your stack",
    body: "Bring in evidence from cloud, identity, ticketing, and security tools through native integrations.",
  },
  {
    n: "02",
    title: "Automate with AI",
    body: "Generate policies, assess risks, and run RCSA campaigns with built-in AI copilots.",
  },
  {
    n: "03",
    title: "Stay audit-ready",
    body: "Continuous control monitoring, evidence packages, and one-click reports for any framework.",
  },
];

const darkSurface = `linear-gradient(145deg, hsl(${BRAND_HUE}, 83%, 25%) 0%, hsl(${BRAND_HUE + 19}, 83%, 15%) 55%, hsl(${BRAND_HUE + 29}, 70%, 10%) 100%)`;
const ctaGradient = `linear-gradient(135deg, hsl(${BRAND_HUE - 11}, 90%, 55%) 0%, hsl(190, 95%, 55%) 100%)`;

function FadeUp({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default function LandingPage() {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  useEffect(() => setYear(new Date().getFullYear()), []);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 text-slate-900" style={{ fontFamily: "Poppins, sans-serif" }}>
      <style>{`
        @keyframes lp-orbit  { from { transform: rotate(0) } to { transform: rotate(360deg) } }
        @keyframes lp-orbitR { from { transform: rotate(360deg) } to { transform: rotate(0) } }
        @keyframes lp-pulseDot {
          0%, 100% { box-shadow: 0 0 0 0 rgba(125, 211, 252, .55) }
          50%      { box-shadow: 0 0 0 10px rgba(125, 211, 252, 0) }
        }
        .lp-accent {
          background: linear-gradient(90deg, #5eead4 0%, #67e8f9 50%, #a5f3fc 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .lp-cta-primary {
          background: ${ctaGradient};
          color: white;
          transition: transform .2s ease, box-shadow .2s ease;
          box-shadow: 0 10px 30px -10px rgba(34, 211, 238, .55);
        }
        .lp-cta-primary:hover { transform: translateY(-2px); box-shadow: 0 14px 40px -10px rgba(34, 211, 238, .75); }
        .lp-glass {
          background: rgba(255,255,255,.08);
          border: 1px solid rgba(255,255,255,.15);
          backdrop-filter: blur(14px);
        }
      `}</style>

      {/* ================== SECTION 1: HERO ================== */}
      <section className="relative min-h-screen w-full overflow-hidden text-white" style={{ background: darkSurface }}>
        {/* Top nav */}
        <nav className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" className="flex items-center gap-2">
            <img src={LOGO_ASSET} alt={PRODUCT_NAME} className="h-9 w-9 rounded-lg object-cover ring-1 ring-white/20" />
            <span className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <a href="#features" className="hidden rounded-lg px-3 py-2 text-sm text-blue-200 transition hover:text-white sm:block">
              Features
            </a>
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-sm text-blue-200 transition hover:text-white sm:block">
              How it works
            </a>
            <Link
              href={LOGIN_PATH}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-blue-50"
            >
              Go to Dashboard
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </nav>

        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 pb-24 pt-12 lg:grid-cols-2 lg:px-10 lg:pt-20">
          {/* Left: copy */}
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-wider text-blue-200">
              <Sparkles className="h-3.5 w-3.5" /> {PRODUCT_TAGLINE}
            </span>
            <h1 className="mt-6 font-extrabold tracking-tight text-white" style={{ fontSize: "clamp(2.5rem, 5vw, 4.25rem)", lineHeight: 1.05 }}>
              {HERO_VERB}
              <br />
              <span className="lp-accent">{HERO_NOUN}.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-blue-200 sm:text-lg">{PRIMARY_OUTCOME}</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={ROUTE_AFTER_CTA}
                className="lp-cta-primary inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold"
              >
                Open the app <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10"
              >
                See how it works
              </a>
            </div>
          </div>

          {/* Right: orbital rings + glass card hint */}
          <div className="relative hidden h-[520px] items-center justify-center lg:flex">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {[
                { size: 220, dur: 38, dir: "lp-orbit" },
                { size: 340, dur: 48, dir: "lp-orbitR" },
                { size: 460, dur: 58, dir: "lp-orbit" },
              ].map((r, i) => (
                <div
                  key={i}
                  className="absolute rounded-full border border-white/10"
                  style={{ width: r.size, height: r.size, animation: `${r.dir} ${r.dur}s linear infinite` }}
                >
                  <span
                    className="absolute h-2.5 w-2.5 rounded-full bg-cyan-300"
                    style={{ top: -5, left: "50%", transform: "translateX(-50%)", animation: "lp-pulseDot 2.4s ease-out infinite" }}
                  />
                  <span
                    className="absolute h-2 w-2 rounded-full bg-emerald-300"
                    style={{ bottom: -4, left: "30%", animation: "lp-pulseDot 3s ease-out infinite" }}
                  />
                </div>
              ))}
            </div>

            {/* Centered glass card mock */}
            <div className="lp-glass relative z-10 w-[340px] rounded-3xl p-5 shadow-2xl shadow-black/40">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/20 text-cyan-200">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Compliance Posture</div>
                  <div className="text-xs text-blue-200">Live · 12 frameworks</div>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {[
                  { label: "ISO 27001", v: 92 },
                  { label: "SOC 2", v: 87 },
                  { label: "NIST CSF", v: 74 },
                ].map((row) => (
                  <div key={row.label}>
                    <div className="mb-1 flex justify-between text-xs text-blue-100">
                      <span>{row.label}</span>
                      <span>{row.v}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${row.v}%`, background: "linear-gradient(90deg, #5eead4, #67e8f9)" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-blue-100">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                3 evidence items collected automatically today
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================== SECTION 3: FEATURES (Section 2 omitted — no real social proof) ================== */}
      <section id="features" className="relative bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <FadeUp>
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-600">Capabilities</span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                Everything you need to govern, comply, and manage risk.
              </h2>
              <p className="mt-4 text-slate-600">A single platform that replaces a dozen spreadsheets and disconnected tools.</p>
            </div>
          </FadeUp>

          <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <FadeUp key={f.title} delay={i * 0.04}>
                  <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
                    <div
                      className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl text-teal-700"
                      style={{ background: `hsl(${BRAND_HUE}, 70%, 95%)` }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.desc}</p>
                  </div>
                </FadeUp>
              );
            })}
          </div>

          {/* Frameworks supported strip */}
          <FadeUp delay={0.1}>
            <div className="mt-16 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-700">
                <BookOpen className="h-4 w-4" /> Frameworks supported out of the box
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  "ISO 27001",
                  "ISO 27701",
                  "ISO 22301",
                  "SOC 2",
                  "NIST CSF",
                  "NIST 800-53",
                  "NIST 800-171",
                  "PCI DSS",
                  "HIPAA",
                  "GDPR",
                  "CIS Controls",
                  "COBIT",
                  "FedRAMP",
                  "CMMC",
                  "Custom uploads",
                ].map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ================== SECTION 4: HOW IT WORKS ================== */}
      <section id="how" className="relative bg-white py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <FadeUp>
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-600">How it works</span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                From zero to audit-ready in three steps.
              </h2>
            </div>
          </FadeUp>

          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <FadeUp key={s.n} delay={i * 0.08}>
                <div className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-7">
                  <div className="text-4xl font-extrabold tracking-tight text-teal-500">{s.n}</div>
                  <h3 className="mt-3 text-lg font-bold text-slate-900">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ================== SECTION 5: SECONDARY CTA ================== */}
      <section className="relative overflow-hidden py-20 text-white" style={{ background: darkSurface }}>
        <div className="mx-auto max-w-5xl px-6 text-center lg:px-10">
          <FadeUp>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Ready to <span className="lp-accent">{HERO_VERB.toLowerCase()} your GRC program</span>?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-blue-200">{PRIMARY_OUTCOME}</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href={ROUTE_AFTER_CTA} className="lp-cta-primary inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold">
                Open the app <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={LOGIN_PATH}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Sign in
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ================== SECTION 6: FOOTER ================== */}
      <footer className="border-t border-slate-200 bg-slate-50 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 lg:flex-row lg:items-center lg:px-10">
          <div className="flex items-center gap-2">
            <img src={LOGO_ASSET} alt={PRODUCT_NAME} className="h-8 w-8 rounded-md object-cover" />
            <span className="text-sm font-semibold text-slate-800">{PRODUCT_NAME}</span>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <a href="#features" className="text-slate-600 transition hover:text-slate-900">
              Features
            </a>
            <a href="#how" className="text-slate-600 transition hover:text-slate-900">
              How it works
            </a>
            <Link href={LOGIN_PATH} className="text-slate-600 transition hover:text-slate-900">
              Sign in
            </Link>
            <Link href={ROUTE_AFTER_CTA} className="text-slate-600 transition hover:text-slate-900">
              Open app
            </Link>
          </div>
          <div className="text-xs text-slate-500">© {year} {PRODUCT_NAME}. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
