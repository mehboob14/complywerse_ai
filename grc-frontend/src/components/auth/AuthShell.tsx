'use client';

/**
 * AuthShell — the shared frame for the login & registration screens.
 *
 * One continuous mint/teal gradient spans the whole page (no hard split), the
 * brand hero floats transparently on the left, and the form lives in a white
 * panel on the right whose edge provides the visual "cut" near the center.
 * A full-width marquee of framework chips drifts left → right along the
 * bottom, passing beneath both halves. Purely presentational.
 */
import {
  BadgeCheck,
  BarChart3,
  ClipboardCheck,
  Handshake,
  Landmark,
  LifeBuoy,
  ListChecks,
  ScrollText,
  ShieldAlert,
  Siren,
  type LucideIcon,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { FrameworkLogo } from '@/components/FrameworkLogo';

// The platform modules shown as a scrolling chip strip in the hero — the
// integrated-platform point, made visually instead of one word at a time.
const MODULES: { label: string; Icon: LucideIcon }[] = [
  { label: 'Enterprise Risk', Icon: ShieldAlert },
  { label: 'Compliance', Icon: BadgeCheck },
  { label: 'Audit', Icon: ClipboardCheck },
  { label: 'Governance', Icon: Landmark },
  { label: 'Vendor Risk', Icon: Handshake },
  { label: 'Business Continuity', Icon: LifeBuoy },
  { label: 'Incidents', Icon: Siren },
  { label: 'Issues & Actions', Icon: ListChecks },
  { label: 'Policy', Icon: ScrollText },
  { label: 'Reporting', Icon: BarChart3 },
];

function ModuleMarquee() {
  // Same seamless-loop technique as FrameworkMarquee (list rendered twice,
  // trailing padding equal to the gap), but scoped to the hero column, with
  // smaller tinted chips and the opposite scroll direction so the two strips
  // read as deliberate counterplay rather than repetition.
  const chips = [...MODULES, ...MODULES];
  return (
    <div
      className="w-full overflow-hidden"
      style={{
        maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
      }}
    >
      <div className="auth-marquee-track-reverse flex w-max items-center gap-2.5 py-1 pr-2.5">
        {chips.map(({ label, Icon }, i) => (
          <span
            key={`${label}-${i}`}
            className="flex items-center gap-2 whitespace-nowrap rounded-full border border-primary-200/70 bg-white/60 py-1.5 pl-2 pr-3.5 text-[13px] font-semibold text-primary-900 shadow-[0_6px_16px_-10px_rgba(13,148,136,0.45)] backdrop-blur-sm"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
              <Icon size={13} strokeWidth={2.2} />
            </span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Full framework catalogue for the bottom marquee. Logos are the frameworks'
// real brand marks, resolved by the shared FrameworkLogo component (same one
// the Compliance module uses), with clean fallbacks.
const FRAMEWORKS: { label: string; blurb: string }[] = [
  { label: 'ISO 27001', blurb: 'Information security' },
  { label: 'SOC 2', blurb: 'Trust services' },
  { label: 'GDPR', blurb: 'Data protection' },
  { label: 'NIST CSF', blurb: 'Cyber framework' },
  { label: 'PCI-DSS', blurb: 'Payment security' },
  { label: 'HIPAA', blurb: 'Health data' },
  { label: 'ISO 22301', blurb: 'Business continuity' },
  { label: 'ISO 27701', blurb: 'Privacy management' },
  { label: 'DORA', blurb: 'Operational resilience' },
  { label: 'NIS2', blurb: 'EU cyber directive' },
  { label: 'CIS Controls', blurb: 'Security baselines' },
  { label: 'COBIT', blurb: 'IT governance' },
  { label: 'SOX', blurb: 'Financial reporting' },
  { label: 'SAMA CSF', blurb: 'Saudi banking cyber' },
  { label: 'HITRUST', blurb: 'Health trust' },
];

function FrameworkMarquee() {
  // The card list is rendered twice back-to-back; the track slides from
  // -50% → 0 so the loop is seamless while cards travel left → right. All
  // cards sit on one aligned baseline inside an inset, pill-shaped rail that
  // stops well before the screen edges.
  const cards = [...FRAMEWORKS, ...FRAMEWORKS];
  return (
    <div className="relative z-10 w-full pb-12 pt-2">
      <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        Frameworks built in
      </p>
      <div className="mx-auto w-[min(90%,72rem)] rounded-full border border-white/70 bg-white/40 p-2 shadow-[0_18px_44px_-22px_rgba(13,148,136,0.4)] backdrop-blur-md">
        <div
          className="overflow-hidden rounded-full"
          style={{
            maskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
          }}
        >
          <div className="auth-marquee-track flex w-max items-center gap-3 pr-3 py-1">
            {cards.map(({ label, blurb }, i) => (
              <div
                key={`${label}-${i}`}
                className="group flex h-[3.75rem] items-center gap-3 rounded-full border border-white/80 bg-white py-2 pl-2.5 pr-6 shadow-[0_8px_20px_-12px_rgba(15,23,42,0.25)] transition-shadow hover:shadow-[0_12px_28px_-10px_rgba(13,148,136,0.45)]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-50 ring-1 ring-slate-200/80 transition-transform duration-300 group-hover:scale-110">
                  <FrameworkLogo name={label} size={30} className="rounded-full" eager />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="whitespace-nowrap text-sm font-bold tracking-tight text-slate-800">{label}</span>
                  <span className="whitespace-nowrap text-[11px] font-medium text-slate-500">{blurb}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthShell({
  children,
  tagline = 'One workspace for risk, compliance and audit readiness.',
}: {
  children: React.ReactNode;
  tagline?: string;
}) {
  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-gradient-to-br from-primary-100 via-primary-50 to-white lg:h-screen">
      {/* soft decorative glow — one surface across the whole page */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="auth-blob-1 absolute -left-32 -top-32 h-[26rem] w-[26rem] rounded-full bg-primary-200/50 blur-3xl" />
        <div className="auth-blob-2 absolute -bottom-40 right-1/3 h-[28rem] w-[28rem] rounded-full bg-white/70 blur-3xl" />
        <div className="auth-blob-3 absolute right-0 top-0 h-[22rem] w-[22rem] rounded-full bg-primary-200/30 blur-3xl" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[46fr_54fr]">
        {/* ── LEFT · brand hero — the integrated-platform differentiator ── */}
        <aside className="hidden min-h-0 p-8 lg:flex lg:flex-col lg:justify-between xl:p-10">
          <div className="auth-fade-up">
            <BrandLogo variant="dark" className="text-2xl" />
          </div>

          <div className="flex min-h-0 max-w-lg flex-col justify-center gap-6 py-4">
            <p
              className="auth-fade-up text-[11px] font-semibold uppercase tracking-[0.24em] text-primary-700/80"
            >
              AI-native enterprise GRC
            </p>

            <h1
              className="auth-fade-up text-3xl font-bold leading-[1.14] tracking-tight xl:text-[2.5rem]"
              style={{ animationDelay: '0.05s' }}
            >
              <span className="text-primary-950">The GRC platform</span>
              <br />
              <span className="text-primary-950">your regulators trust.</span>
            </h1>

            {/* Modules strip — the integrated-platform point, chip by chip */}
            <div className="auth-fade-up flex flex-col gap-3" style={{ animationDelay: '0.12s' }}>
              <p className="text-lg font-medium text-slate-600 xl:text-xl">
                Every module. <span className="font-semibold text-primary-700">One platform.</span>
              </p>
              <ModuleMarquee />
            </div>

            <div className="auth-fade-up h-px w-24 bg-gradient-to-r from-primary-400 to-transparent" style={{ animationDelay: '0.18s' }} />

            {/* The consolidation story, kept to three quiet facts */}
            <div className="auth-fade-up flex items-center gap-4 text-[13px] font-medium text-slate-600" style={{ animationDelay: '0.22s' }}>
              <span className="whitespace-nowrap"><span className="font-bold text-primary-800">14+</span> modules</span>
              <span className="h-3.5 w-px bg-slate-300" />
              <span className="whitespace-nowrap">AI-native</span>
              <span className="h-3.5 w-px bg-slate-300" />
              <span className="whitespace-nowrap">Replaces <span className="font-bold text-primary-800">5+</span> point tools</span>
            </div>

            <p
              className="auth-fade-up max-w-sm text-lg font-semibold leading-snug tracking-tight text-slate-800 xl:text-xl"
              style={{ animationDelay: '0.28s' }}
            >
              {tagline}
            </p>
          </div>

          {/* spacer keeps the hero vertically balanced above the marquee */}
          <div />
        </aside>

        {/* ── RIGHT · white form panel — its edge is the center "cut" ────── */}
        <main className="flex min-h-0 flex-1 items-stretch justify-center px-4 py-4 sm:px-6 lg:pl-0 lg:pr-8">
          {/* No visible scrolling on the card: content is centered and sized
              to fit. `auth-no-scrollbar` keeps overflow reachable on very
              short viewports without ever showing a scrollbar. */}
          <div className="auth-fade-up auth-no-scrollbar flex w-full flex-col items-center overflow-y-auto rounded-[28px] bg-white px-5 py-4 shadow-2xl shadow-primary-900/10 ring-1 ring-black/5 sm:px-10 lg:max-w-[33rem]" style={{ animationDelay: '0.08s' }}>
            <div className="my-auto w-full max-w-md">
              <div className="mb-6 flex justify-center lg:hidden">
                <BrandLogo variant="dark" className="text-2xl" />
              </div>
              {children}
            </div>
          </div>
        </main>
      </div>

      {/* ── BOTTOM · full-width infinite framework marquee ──────────────── */}
      <FrameworkMarquee />
    </div>
  );
}

export default AuthShell;
