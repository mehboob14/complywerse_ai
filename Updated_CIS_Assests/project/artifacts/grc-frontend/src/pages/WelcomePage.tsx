import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Bot,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

const PRODUCT_NAME = "CompliverseAI";
const PRIMARY_OUTCOME =
  "We're getting your governance, risk, and compliance workspace ready.";
const BRAND_HUE = 166;
const ROUTE_AFTER_CTA = "/landing";
const WORKSPACE_ROUTE = "/dashboard";

const radialSurface = `radial-gradient(ellipse at 30% 20%, hsl(${BRAND_HUE}, 83%, 25%) 0%, hsl(${BRAND_HUE + 19}, 83%, 15%) 55%, hsl(${BRAND_HUE + 29}, 70%, 10%) 100%)`;
const ctaGradient = `linear-gradient(135deg, hsl(${BRAND_HUE - 11}, 90%, 55%) 0%, hsl(190, 95%, 55%) 100%)`;

type Step = { label: string; ms: number };
const STEPS: Step[] = [
  { label: "Connecting your data", ms: 700 },
  { label: "Personalizing your workspace", ms: 1100 },
  { label: "You're all set", ms: 900 },
];

type Chip = { label: string; x: number; y: number; delay: number; dur: number };
const LEFT_CHIPS: Chip[] = [
  { label: "Compliance", x: 6, y: 18, delay: 0, dur: 7 },
  { label: "Risk", x: 12, y: 38, delay: 1.2, dur: 8 },
  { label: "Governance", x: 4, y: 60, delay: 0.6, dur: 9 },
  { label: "Frameworks", x: 14, y: 80, delay: 1.8, dur: 7.5 },
  { label: "Controls", x: 18, y: 12, delay: 2.4, dur: 8.5 },
];
const RIGHT_CHIPS: Chip[] = [
  { label: "Vendor Risk", x: 86, y: 22, delay: 0.4, dur: 8 },
  { label: "Audit", x: 92, y: 44, delay: 1.5, dur: 7 },
  { label: "Policy AI", x: 84, y: 66, delay: 0.9, dur: 9 },
  { label: "KRIs", x: 94, y: 84, delay: 2.1, dur: 7.5 },
  { label: "Evidence", x: 80, y: 8, delay: 1.7, dur: 8.5 },
];

const RINGS = [
  { size: 220, dur: 32, dir: "orbit" },
  { size: 350, dur: 42, dir: "orbitR" },
  { size: 480, dur: 50, dir: "orbit" },
  { size: 610, dur: 58, dir: "orbitR" },
];

function getFirstName(): string | null {
  try {
    const raw = localStorage.getItem("user") || localStorage.getItem("currentUser");
    if (raw) {
      const u = JSON.parse(raw);
      const name = u?.firstName || u?.first_name || (u?.name ? String(u.name).split(" ")[0] : null);
      if (name) return String(name);
    }
  } catch {
    // ignore
  }
  return null;
}

export default function WelcomePage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<number>(0);
  const [paused, setPaused] = useState<boolean>(false);

  // Mount-time routing decisions: replay flag, pause flags, intro_seen, skip_landing.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const replay = url.searchParams.get("replay") === "1";
      const skipLanding = localStorage.getItem("skip_landing") === "true";
      const introSeen = localStorage.getItem("intro_seen") === "true";

      if (!replay) {
        // Power user: skip BOTH welcome and landing, go straight to workspace.
        if (skipLanding) {
          navigate(WORKSPACE_ROUTE, { replace: true });
          return;
        }
        // Repeat session: skip the boot animation, but still show /landing.
        if (introSeen) {
          navigate(ROUTE_AFTER_CTA, { replace: true });
          return;
        }
      }

      if (url.searchParams.get("pause") === "1" || sessionStorage.getItem("pause_welcome") === "1") {
        setPaused(true);
      }
    } catch {
      // ignore
    }
  }, [navigate]);

  // Drive the boot sequence
  useEffect(() => {
    if (paused) return;
    if (step >= STEPS.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEPS[step].ms);
    return () => clearTimeout(t);
  }, [step, paused]);

  const firstName = useMemo(() => getFirstName(), []);
  const heading = firstName ? `Welcome back, ${firstName}.` : `Welcome to ${PRODUCT_NAME}.`;
  const headingProductSpan = !firstName;

  const totalSteps = STEPS.length;
  const completed = Math.min(step, totalSteps);
  const isComplete = completed >= totalSteps;
  const pct = Math.round((completed / totalSteps) * 100);

  const handleEnter = () => {
    try {
      localStorage.setItem("intro_seen", "true");
    } catch {
      // ignore
    }
    navigate(ROUTE_AFTER_CTA);
  };

  return (
    <div
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden text-white"
      style={{ background: radialSurface, fontFamily: "Poppins, sans-serif" }}
    >
      <style>{`
        @keyframes orbit       { from { transform: rotate(0) }    to { transform: rotate(360deg) } }
        @keyframes orbitR      { from { transform: rotate(360deg) } to { transform: rotate(0) } }
        @keyframes nodePulse   {
          0%, 100% { box-shadow: 0 0 0 0 rgba(125,211,252,.45) }
          50%      { box-shadow: 0 0 0 8px rgba(125,211,252,0) }
        }
        @keyframes welcomeGlow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(125,211,252,.55), 0 0 60px 4px rgba(125,211,252,0);
          }
          50% {
            box-shadow: 0 0 0 14px rgba(125,211,252,0), 0 0 80px 10px rgba(125,211,252,.35);
          }
        }
        @keyframes floatChip {
          0%, 100% { transform: translate3d(0,0,0); opacity: .55 }
          25%      { transform: translate3d(8px,-10px,0); opacity: .85 }
          50%      { transform: translate3d(-6px,-18px,0); opacity: 1 }
          75%      { transform: translate3d(-10px,-6px,0); opacity: .8 }
        }
        @keyframes shimmerText {
          0%   { background-position: -200% 0 }
          100% { background-position: 200% 0 }
        }
        @keyframes barShimmer {
          0%   { transform: translateX(-100%) }
          100% { transform: translateX(300%) }
        }
        @keyframes ringSpin   { from { transform: rotate(0) } to { transform: rotate(360deg) } }
        @keyframes pingRing {
          0%   { transform: scale(0.9); opacity: .8 }
          100% { transform: scale(1.6); opacity: 0 }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px) }
          to   { opacity: 1; transform: translateY(0) }
        }

        .wp-shimmer {
          background: linear-gradient(90deg, #bae6fd 0%, #ffffff 50%, #bae6fd 100%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: shimmerText 4s linear infinite;
        }
        .wp-avatar-ring::before {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: inherit;
          background: conic-gradient(from 0deg, rgba(125,211,252,.0), rgba(125,211,252,.85), rgba(94,234,212,.75), rgba(125,211,252,.0));
          animation: ringSpin 6s linear infinite;
          z-index: 0;
          padding: 3px;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
                  mask-composite: exclude;
        }
        .wp-cta {
          background: ${ctaGradient};
          color: white;
          transition: transform .2s ease, box-shadow .2s ease;
          box-shadow: 0 12px 32px -10px rgba(34, 211, 238, .55);
        }
        .wp-cta:hover { transform: translateY(-2px); box-shadow: 0 16px 44px -10px rgba(34, 211, 238, .8); }
        .wp-fadein { animation: fadeInUp .5s ease-out both }
      `}</style>

      {/* ===== Layer 1: Orbital rings ===== */}
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        {RINGS.map((r, i) => (
          <div
            key={i}
            className="absolute rounded-full border border-white/10"
            style={{
              width: r.size,
              height: r.size,
              animation: `${r.dir} ${r.dur}s linear infinite`,
            }}
          >
            <span
              className="absolute h-2.5 w-2.5 rounded-full bg-cyan-300"
              style={{ top: -5, left: "50%", transform: "translateX(-50%)", animation: "nodePulse 2.4s ease-out infinite" }}
            />
            <span
              className="absolute h-2 w-2 rounded-full bg-emerald-300"
              style={{ bottom: -4, left: "28%", animation: "nodePulse 3s ease-out infinite" }}
            />
            {i % 2 === 0 && (
              <span
                className="absolute h-2 w-2 rounded-full bg-sky-200"
                style={{ top: "30%", right: -4, animation: "nodePulse 2.7s ease-out infinite" }}
              />
            )}
          </div>
        ))}
      </div>

      {/* ===== Layer 2: Floating chips ===== */}
      <div className="pointer-events-none absolute inset-0 z-0">
        {[...LEFT_CHIPS, ...RIGHT_CHIPS].map((c) => (
          <div
            key={`${c.label}-${c.x}-${c.y}`}
            className="absolute flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-[11px] font-medium text-blue-100 backdrop-blur"
            style={{
              left: `${c.x}%`,
              top: `${c.y}%`,
              animation: `floatChip ${c.dur}s ease-in-out ${c.delay}s infinite`,
              opacity: 0.7,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white/90" style={{ animation: "nodePulse 2.6s ease-out infinite" }} />
            {c.label}
          </div>
        ))}
      </div>

      {/* ===== Layer 3: Center card ===== */}
      <div className="relative z-10 mx-auto w-full max-w-xl px-6 text-center">
        {/* Avatar */}
        <div className="mx-auto mb-7 flex justify-center">
          <div
            className="wp-avatar-ring relative flex h-24 w-24 items-center justify-center rounded-3xl border border-white/15 bg-white/10 backdrop-blur"
            style={{ animation: "welcomeGlow 2.4s ease-in-out infinite" }}
          >
            <Bot className="relative z-10 h-10 w-10 text-cyan-200" />
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {firstName ? (
            heading
          ) : (
            <>
              Welcome to <span className="wp-shimmer">{PRODUCT_NAME}</span>.
            </>
          )}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-blue-200 sm:text-base">{PRIMARY_OUTCOME}</p>

        {/* Progress */}
        <div className="mx-auto mt-8 max-w-md">
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-blue-200">
            <span>Initializing {PRODUCT_NAME}</span>
            <span>{pct}%</span>
          </div>
          <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, #5eead4, #67e8f9)" }}
            />
            {!isComplete && (
              <div
                className="pointer-events-none absolute inset-y-0 left-0 w-1/3"
                style={{
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)",
                  animation: "barShimmer 1.8s linear infinite",
                }}
              />
            )}
          </div>
        </div>

        {/* Step checklist */}
        <ul className="mx-auto mt-6 max-w-md space-y-2 text-left">
          {STEPS.map((s, i) => {
            const state: "done" | "active" | "idle" =
              i < completed ? "done" : i === completed && !isComplete ? "active" : "idle";
            return <StepRow key={s.label} label={s.label} state={state} />;
          })}
        </ul>

        {/* CTA */}
        <div className="mt-9 flex h-12 items-center justify-center">
          {(isComplete || paused) && (
            <button onClick={handleEnter} className="wp-cta wp-fadein inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold">
              Enter {PRODUCT_NAME} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ label, state }: { label: string; state: "done" | "active" | "idle" }) {
  let Icon: LucideIcon = Sparkles;
  let bg = "bg-white/5";
  let border = "border-white/10";
  let text = "text-blue-200/70";
  let iconColor = "text-blue-200/60";
  let badge: string | null = null;

  if (state === "done") {
    Icon = CheckCircle2;
    bg = "bg-emerald-400/10";
    border = "border-emerald-300/30";
    text = "text-emerald-100";
    iconColor = "text-emerald-300";
  } else if (state === "active") {
    Icon = Sparkles;
    bg = "bg-white/12";
    border = "border-white/25";
    text = "text-white";
    iconColor = "text-cyan-200";
    badge = "in progress";
  }

  return (
    <li className={`relative flex items-center gap-3 rounded-xl border ${border} ${bg} px-3 py-2.5 backdrop-blur transition-all`}>
      <span className="relative inline-flex h-6 w-6 items-center justify-center">
        {state === "active" && (
          <span
            className="absolute inset-0 rounded-full border border-cyan-300/60"
            style={{ animation: "pingRing 1.4s ease-out infinite" }}
          />
        )}
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </span>
      <span className={`flex-1 text-sm ${text}`}>{label}</span>
      {badge && (
        <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-100">
          {badge}
        </span>
      )}
    </li>
  );
}
