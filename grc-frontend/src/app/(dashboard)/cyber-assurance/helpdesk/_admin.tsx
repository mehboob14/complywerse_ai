"use client";

// Shared building blocks for the Help Desk Settings hub + New-Ticket flow:
// a modal, styled form controls, buttons, and a thin apiClient mutation helper.
// Everything is tenant-scoped through apiClient (auth header + X-Tenant-Slug).
// Private file: not a route.
import { useEffect, useState, type ReactNode } from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { apiClient } from "@/cyber-assurance/lib/api";

// ── apiClient mutation wrapper ──────────────────────────────────────────────
/** POST/PUT/DELETE a helpdesk endpoint; returns {ok,data} or {ok:false,error}. */
export async function hdCall(
  method: "post" | "put" | "delete",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res =
      method === "delete"
        ? await apiClient.delete(path, { data: body })
        : await apiClient[method](path, body ?? {});
    return { ok: true, data: res.data };
  } catch (e: any) {
    const detail = e?.response?.data?.detail;
    return {
      ok: false,
      error:
        (typeof detail === "string" && detail) ||
        e?.message ||
        "Something went wrong — please try again.",
    };
  }
}

// ── buttons ─────────────────────────────────────────────────────────────────
type BtnVariant = "primary" | "ghost" | "danger" | "subtle";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-[#005B96] text-white hover:bg-[#014A81]",
  ghost: "border border-[#E2E5EC] bg-white text-[#334155] hover:bg-[#F6F7FB]",
  danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
  subtle: "text-[#005B96] hover:bg-[#005B96]/5",
};
export function Btn({
  variant = "ghost",
  busy,
  icon,
  children,
  className = "",
  ...rest
}: {
  variant?: BtnVariant;
  busy?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${BTN[variant]} ${className}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function NewBtn({ onClick, label = "New", disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <Btn variant="primary" icon={<Plus size={14} />} onClick={onClick} disabled={disabled}>
      {label}
    </Btn>
  );
}

// ── modal ─────────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
  side,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  side?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  if (side) {
    // Right-side drawer (slides in from the edge) instead of a centered box.
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
        <div
          className={`flex h-full w-full ${wide ? "max-w-xl" : "max-w-md"} flex-col bg-white shadow-2xl`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#EEF1F5] px-5 py-3.5">
            <div>
              <h2 className="m-0 text-[15px] font-semibold text-[#0F172A]">{title}</h2>
              {subtitle && <p className="m-0 mt-0.5 text-[12px] text-[#64748B]">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-[#94A3B8] hover:bg-[#F6F7FB]">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] px-5 py-3">{footer}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onClick={onClose}>
      <div
        className={`mt-4 w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl bg-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#EEF1F5] px-5 py-3.5">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-[#0F172A]">{title}</h2>
            {subtitle && <p className="m-0 mt-0.5 text-[12px] text-[#64748B]">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-[#94A3B8] hover:bg-[#F6F7FB]">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ── form controls ───────────────────────────────────────────────────────────
export function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-[#475569]">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[#94A3B8]">{hint}</span>}
    </label>
  );
}

const CTRL =
  "w-full rounded-[9px] border border-[#E2E5EC] bg-white px-3 py-2 text-[13px] text-[#0F172A] outline-none placeholder:text-[#94A3B8] focus:border-[#005B96] focus:ring-2 focus:ring-[#005B96]/15";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CTRL} ${props.className || ""}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CTRL} min-h-[90px] resize-y ${props.className || ""}`} />;
}
export function Select({ children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${CTRL} ${rest.className || ""}`}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[#334155]"
    >
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-[#005B96]" : "bg-[#CBD5E1]"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

// ── inline banners ──────────────────────────────────────────────────────────
export function FormError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{msg}</div>;
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800">{children}</div>
  );
}

// ── settings section shell ──────────────────────────────────────────────────
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="m-0 text-[15.5px] font-semibold text-[#0F172A]">{title}</h2>
          {description && <p className="m-0 mt-0.5 text-[12.5px] text-[#64748B]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Confirm-then-run delete; keeps each row's own pending state. */
export function useConfirmDelete() {
  const [pending, setPending] = useState<string | null>(null);
  const run = async (key: string, label: string, fn: () => Promise<{ ok: boolean; error?: string }>, onDone: () => void) => {
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return;
    setPending(key);
    const r = await fn();
    setPending(null);
    if (r.ok) onDone();
    else window.alert(r.error || "Delete failed.");
  };
  return { pending, run };
}
