"use client";

/**
 * Requester portal — "Request something".
 *
 * Guided 5-step wizard for service requests (new laptop, software, access…):
 *   1. pick a category   2. pick a business service   3. pick a request item
 *   4. fill in the details   5. review & submit.
 * This mirrors the real catalogue hierarchy (Category → Business service →
 * Request item); technical services stay internal and are never shown here.
 * Submits POST /helpdesk/portal/requests with process="service_request"; the
 * backend derives priority/SLA and routes to the right team.
 *
 * Catalogue source (end-user safe):
 *   1. GET /helpdesk/portal/catalogue — { categories:[{id,name,description?}],
 *      services:[{id,name,category_id,description?}],
 *      requests:[{id,code?,name,description?,category_id,business_service_id,
 *                 approval_required?,sla_hours?,cost?,fields?}] }
 *   2. fallback: GET /helpdesk/portal/templates — the predefined request library.
 * When a category has only one business service (or ungrouped items), the service
 * step auto-advances so the user never sees a pointless one-option page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardList, CheckCircle2, ArrowLeft, ArrowRight, Check, Search, FolderOpen, Layers, Inbox, BookOpen, ShieldCheck, Clock } from "lucide-react";
import { Empty, Loading, PageHeader, useHd } from "../../_ui";
import { Field, Input, Textarea, Select, Btn, FormError, hdCall } from "../../_admin";
import { AssetPicker, type PickedAsset } from "../_asset_picker";

type FieldDef = { key: string; label: string; type: string; required: boolean; hint?: string; options: string[] };
type Item = {
  key: string;
  requestItemId: number | null;
  name: string;
  description: string;
  categoryKey: string;
  category: string;
  serviceKey: string;
  service: string;
  approvalRequired: boolean;
  slaHours: number | null;
  cost: number | null;
  departmentId: number | null;
  impact: string;
  urgency: string;
  requestCategory: string;
  requestSubcategory: string;
  defaultDescription: string;
  fields: FieldDef[];
};
type Group = { key: string; name: string; description: string; count: number };

const STEPS = ["Category", "Service", "Request", "Details", "Review"];
const GENERAL = "__general";

const URGENCY = [
  { value: "low", label: "Whenever — it's not blocking me" },
  { value: "medium", label: "Soon — it's slowing me down" },
  { value: "high", label: "Urgent — I can't work without it" },
];
const urgencyLabel = (v: string) => URGENCY.find((u) => u.value === v)?.label || v;

// ── normalise whichever catalogue source answered ───────────────────────────
function toFields(raw: any): FieldDef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f: any) => f && (f.key || f.label))
    .map((f: any, i: number) => ({
      key: String(f.key || f.label || `field_${i}`),
      label: String(f.label || f.key),
      type: String(f.type || "text").toLowerCase(),
      required: !!f.required,
      hint: f.hint || f.help || undefined,
      options: Array.isArray(f.options) ? f.options.map((o: any) => String(o)) : [],
    }));
}

function normalise(cat: any, tpl: any): Item[] {
  const reqs: any[] = Array.isArray(cat?.requests) ? cat.requests : [];
  if (reqs.length > 0) {
    const cats: any[] = Array.isArray(cat?.categories) ? cat.categories : [];
    const svcs: any[] = Array.isArray(cat?.services) ? cat.services : [];
    return reqs.map((r: any) => {
      const categoryId = typeof r.category_id === "number" ? r.category_id : null;
      const serviceId = typeof r.business_service_id === "number" ? r.business_service_id : null;
      const catName =
        r.category || cats.find((c: any) => c.id === categoryId)?.name || "General";
      const svcName =
        r.business_service || svcs.find((s: any) => s.id === serviceId)?.name || "";
      return {
        key: `item-${r.id ?? r.code ?? r.name}`,
        requestItemId: typeof r.id === "number" ? r.id : null,
        name: String(r.name || r.code || "Request"),
        description: String(r.description || ""),
        categoryKey: categoryId != null ? `c${categoryId}` : `n:${catName}`,
        category: String(catName),
        serviceKey: serviceId != null ? `s${serviceId}` : (svcName ? `n:${svcName}` : GENERAL),
        service: String(svcName),
        approvalRequired: !!r.approval_required,
        slaHours: typeof r.sla_hours === "number" ? r.sla_hours : null,
        cost: typeof r.cost === "number" ? r.cost : null,
        departmentId: typeof r.department_id === "number" ? r.department_id : null,
        impact: String(r.default_impact || "low"),
        urgency: String(r.default_urgency || "medium"),
        requestCategory: String(catName),
        requestSubcategory: String(svcName),
        defaultDescription: "",
        fields: toFields(r.fields),
      };
    });
  }
  // Fallback: the request library that portal.py already exposes (no service layer).
  const all: any[] = Array.isArray(tpl?.templates) ? tpl.templates : [];
  const svc = all.filter((t: any) => (t.process || "") === "service_request");
  return (svc.length > 0 ? svc : all).map((t: any) => {
    const catName = String(t.default_category || t.department || "General");
    const svcName = String(t.default_subcategory || "");
    return {
      key: `tpl-${t.id}`,
      requestItemId: null,
      name: String(t.template_name || t.default_subject || "Request"),
      description: String(t.default_description || ""),
      categoryKey: `n:${catName}`,
      category: catName,
      serviceKey: svcName ? `n:${svcName}` : GENERAL,
      service: svcName,
      approvalRequired: false,
      slaHours: null,
      cost: null,
      departmentId: typeof t.department_id === "number" ? t.department_id : null,
      impact: String(t.default_impact || "low"),
      urgency: String(t.default_urgency || "medium"),
      requestCategory: catName,
      requestSubcategory: svcName,
      defaultDescription: String(t.default_description || ""),
      fields: [],
    };
  });
}

// ── page ────────────────────────────────────────────────────────────────────
export default function RequestSomething() {
  const cat = useHd<any>("/helpdesk/portal/catalogue");
  const tpl = useHd<any>("/helpdesk/portal/templates");
  const kb = useHd<{ articles: any[] }>("/helpdesk/portal/kb");

  const items = useMemo(() => normalise(cat.data, tpl.data), [cat.data, tpl.data]);

  const catMeta = useMemo(() => {
    const m = new Map<string, string>();
    (Array.isArray(cat.data?.categories) ? cat.data.categories : []).forEach((c: any) => {
      if (c?.id != null) m.set(`c${c.id}`, String(c.description || ""));
    });
    return m;
  }, [cat.data]);
  const svcMeta = useMemo(() => {
    const m = new Map<string, string>();
    (Array.isArray(cat.data?.services) ? cat.data.services : []).forEach((s: any) => {
      if (s?.id != null) m.set(`s${s.id}`, String(s.description || ""));
    });
    return m;
  }, [cat.data]);

  const categories = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    items.forEach((i) => {
      const e = m.get(i.categoryKey) || { key: i.categoryKey, name: i.category, description: catMeta.get(i.categoryKey) || "", count: 0 };
      e.count++; m.set(i.categoryKey, e);
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items, catMeta]);

  const servicesFor = (categoryKey: string | null): Group[] => {
    if (!categoryKey) return [];
    const m = new Map<string, Group>();
    items.filter((i) => i.categoryKey === categoryKey).forEach((i) => {
      const e = m.get(i.serviceKey) || { key: i.serviceKey, name: i.service || "General", description: svcMeta.get(i.serviceKey) || "", count: 0 };
      e.count++; m.set(i.serviceKey, e);
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  const [step, setStep] = useState(0);
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [serviceKey, setServiceKey] = useState<string | null>(null);
  const [serviceName, setServiceName] = useState("");
  const [search, setSearch] = useState("");
  const [item, setItem] = useState<Item | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [urgency, setUrgency] = useState("medium");
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);

  const loading = cat.loading || tpl.loading;

  const services = useMemo(() => servicesFor(categoryKey), [items, categoryKey, svcMeta]);
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.categoryKey === categoryKey &&
        i.serviceKey === serviceKey &&
        (!s || [i.name, i.description].some((v) => (v || "").toLowerCase().includes(s))),
    );
  }, [items, categoryKey, serviceKey, search]);

  // KB suggestions: published articles whose title shares a word with the chosen request.
  const suggestions = useMemo(() => {
    if (!item) return [];
    const words = item.name.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    if (words.length === 0) return [];
    const arts: any[] = Array.isArray(kb.data?.articles) ? kb.data!.articles : [];
    return arts
      .filter((a) => !/draft|archiv/i.test(a.status || ""))
      .filter((a) => words.some((w) => (a.title || "").toLowerCase().includes(w)))
      .slice(0, 3);
  }, [item, kb.data]);

  const pickCategory = (c: Group) => {
    setCategoryKey(c.key); setCategoryName(c.name);
    setServiceKey(null); setServiceName(""); setSearch(""); setItem(null); setErr(null);
    const svcs = servicesFor(c.key);
    if (svcs.length === 1) {
      // only one service (or just ungrouped items) → skip the service page
      setServiceKey(svcs[0].key); setServiceName(svcs[0].name === "General" ? "" : svcs[0].name);
      setStep(2);
    } else {
      setStep(1);
    }
  };
  const pickService = (s: Group) => {
    setServiceKey(s.key); setServiceName(s.name === "General" ? "" : s.name);
    setSearch(""); setItem(null); setErr(null); setStep(2);
  };
  const pickItem = (i: Item) => {
    setItem(i); setAnswers({}); setNotes(""); setUrgency(i.urgency || "medium"); setErr(null);
  };

  // Escape hatch: nothing in the list fits. A catch-all item whose subcategory is
  // "Other" — the requester describes it in the notes box and the agent reclassifies
  // at triage (keeps the taxonomy clean; no free-typed categories). Reuses the same
  // request_category/request_subcategory plumbing every real item already uses.
  const OTHER_KEY = "__other";
  const makeOther = (): Item => ({
    key: OTHER_KEY,
    requestItemId: null,
    name: `Something else${categoryName ? ` in ${categoryName}` : ""}`,
    description: "",
    categoryKey: categoryKey || `n:${categoryName}`,
    category: categoryName,
    serviceKey: serviceKey || GENERAL,
    service: serviceName,
    approvalRequired: false,
    slaHours: null,
    cost: null,
    departmentId: null,
    impact: "low",
    urgency: "medium",
    requestCategory: categoryName,
    requestSubcategory: "Other",
    defaultDescription: "",
    fields: [],
  });

  const validate = (s: number): string | null => {
    if (s === 0 && !categoryKey) return "Please choose a category.";
    if (s === 1 && !serviceKey) return "Please choose a service.";
    if (s === 2 && !item) return "Please choose what you'd like to request.";
    if (s === 3 && item) {
      for (const f of item.fields) {
        if (f.required && f.type !== "checkbox" && !(answers[f.key] || "").trim()) {
          return `Please fill in “${f.label}”.`;
        }
      }
    }
    return null;
  };
  const next = () => {
    const v = validate(step);
    if (v) { setErr(v); return; }
    setErr(null); setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => {
    setErr(null);
    // if the service step was auto-skipped (single service), skip it going back too
    if (step === 2 && services.length === 1) { setStep(0); return; }
    setStep((s) => Math.max(s - 1, 0));
  };
  const jump = (i: number) => {
    if (i >= step) return;
    if (i === 1 && services.length === 1) { setErr(null); setStep(0); return; }
    setErr(null); setStep(i);
  };

  // Bring the top of the wizard into view whenever the step changes (not on first paint).
  const topRef = useRef<HTMLDivElement | null>(null);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const answerLines = (): string[] =>
    (item?.fields || [])
      .map((f) => {
        const v = f.type === "checkbox" ? (answers[f.key] === "yes" ? "Yes" : "No") : (answers[f.key] || "").trim();
        return v ? `${f.label}: ${v}` : "";
      })
      .filter(Boolean);

  const submit = async () => {
    if (!item) return;
    for (let s = 0; s < 4; s++) {
      const v = validate(s);
      if (v) { setErr(v); setStep(s); return; }
    }
    setBusy(true); setErr(null);
    const description = [notes.trim() || item.defaultDescription, ...answerLines()].filter(Boolean).join("\n");
    const body: Record<string, unknown> = {
      subject: item.name,
      description: description || null,
      process: "service_request",
      urgency,
      impact: item.impact,
      request_category: item.requestCategory || item.category,
      request_subcategory: item.requestSubcategory || item.service || undefined,
      fields: answers,
    };
    if (item.departmentId != null) body.department_id = item.departmentId;
    if (item.requestItemId != null) body.request_item_id = item.requestItemId;
    if (asset) body.ci_id = asset.id;
    const r = await hdCall("post", "/helpdesk/portal/requests", body);
    setBusy(false);
    if (!r.ok || !r.data?.name) { setErr(r.error || "Sorry — we couldn't submit that. Please try again."); return; }
    setNeedsApproval(item.approvalRequired);
    setDoneId(String(r.data.name));
  };

  const reset = () => {
    setDoneId(null); setStep(0); setCategoryKey(null); setCategoryName(""); setServiceKey(null); setServiceName("");
    setSearch(""); setItem(null); setAnswers({}); setNotes(""); setUrgency("medium"); setAsset(null); setErr(null); setNeedsApproval(false);
  };

  if (doneId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-16 text-center text-[#0F172A]">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
          <CheckCircle2 size={34} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[#0F172A]">Request submitted!</h1>
          <p className="mt-1.5 text-sm text-[#64748B]">
            Your request <span className="font-mono font-semibold text-[#005B96]">#{doneId}</span> has been received.
            {needsApproval
              ? " It needs an approval first — we'll let you know as soon as it's decided."
              : " You can follow its progress and reply from My Requests."}
          </p>
        </div>

        {item && (
          <div className="w-full rounded-xl border border-[#EEF1F5] bg-white p-4 text-left">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">You requested</div>
            <div className="mt-1 font-medium">{item.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {item.category}
              {item.service ? ` · ${item.service}` : ""}
            </div>
            <ul className="mt-3 space-y-1.5 border-t border-[#EEF1F5] pt-3 text-[12.5px] text-[#475569]">
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" /> It's on its way to the right team.
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                {needsApproval ? "An approver will review it first, and you'll hear the outcome." : "Our team will pick it up and keep you posted."}
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" /> Follow progress or reply any time from My Requests.
              </li>
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href={`/cyber-assurance/helpdesk/portal/my-requests/${encodeURIComponent(doneId)}`}>
            <Btn variant="primary" className="!h-9 !px-4 !text-[13px]">View my request</Btn>
          </Link>
          <Btn variant="ghost" className="!h-9 !px-4 !text-[13px]" onClick={reset}>Request something else</Btn>
        </div>
      </div>
    );
  }

  const urgencyOptions = URGENCY.some((u) => u.value === urgency)
    ? URGENCY
    : [...URGENCY, { value: urgency, label: cap(urgency) }];

  return (
    <div ref={topRef} className="mx-auto flex max-w-3xl scroll-mt-4 flex-col gap-5 text-[#0F172A]">
      <PageHeader
        icon={ClipboardList}
        title="Request something"
        subtitle="Pick what you need and we'll take care of the rest."
      />

      <Stepper step={step} onJump={jump} />

      <div className="rounded-2xl border border-[#EEF1F5] bg-white p-5 sm:p-6">
        <FormError msg={err} />

        {loading ? (
          <Loading what="the catalogue" />
        ) : items.length === 0 ? (
          <>
            <Empty
              icon={Inbox}
              title="Nothing to request yet"
              hint="No request items are published for you yet. You can still report an issue."
            />
            <div className="mt-4 flex justify-center">
              <Link href="/cyber-assurance/helpdesk/portal/report">
                <Btn variant="primary" className="!h-9 !px-4 !text-[13px]">Report an issue</Btn>
              </Link>
            </div>
          </>
        ) : (
          <>
            {/* STEP 1 — category */}
            {step === 0 && (
              <div className="flex flex-col gap-4">
                <StepHead title="What kind of request is it?" hint="Choose a category and we'll show you the services in it." />
                <div className="grid gap-3 sm:grid-cols-2">
                  {categories.map((c) => {
                    const sel = categoryKey === c.key;
                    return (
                      <SelectCard
                        key={c.key}
                        icon={<FolderOpen size={20} />}
                        title={c.name}
                        description={c.description}
                        meta={`${c.count} ${c.count === 1 ? "item" : "items"}`}
                        selected={sel}
                        onClick={() => pickCategory(c)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* STEP 2 — business service */}
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <StepHead
                  title={`Which service in “${categoryName}”?`}
                  hint="Pick the service your request is about — you'll choose the exact item next."
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  {services.map((s) => {
                    const sel = serviceKey === s.key;
                    return (
                      <SelectCard
                        key={s.key}
                        icon={<Layers size={20} />}
                        title={s.name}
                        description={s.description}
                        meta={`${s.count} ${s.count === 1 ? "item" : "items"}`}
                        selected={sel}
                        onClick={() => pickService(s)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* STEP 3 — request item */}
            {step === 2 && (
              <div className="flex flex-col gap-4">
                <StepHead
                  title={serviceName ? `What would you like in “${serviceName}”?` : `What would you like in “${categoryName}”?`}
                  hint="Pick the one that fits best — you'll add the details next."
                />
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    aria-label="Search request items"
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#005B96] focus:ring-2 focus:ring-[#005B96]/15"
                  />
                </div>
                {visible.length === 0 ? (
                  <div className="text-xs text-[#94A3B8]">
                    No matching requests — pick “Something else” below to describe it.
                  </div>
                ) : (
                  <div className="text-xs text-[#94A3B8]">
                    {visible.length} {visible.length === 1 ? "option" : "options"}
                  </div>
                )}
                    <div role="radiogroup" aria-label="Request items" className="grid gap-3 sm:grid-cols-2">
                      {visible.map((i) => {
                        const sel = item?.key === i.key;
                        return (
                          <button
                            key={i.key}
                            type="button"
                            role="radio"
                            aria-checked={sel}
                            onClick={() => pickItem(i)}
                            className={`relative flex flex-col rounded-xl border p-4 pr-10 text-left transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#005B96]/40 ${
                              sel ? "border-[#005B96] bg-[#005B96]/5 shadow-sm" : "border-slate-200 bg-white hover:border-[#005B96]/40"
                            }`}
                          >
                            <span
                              className={`absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full border transition ${
                                sel ? "border-[#005B96] bg-[#005B96] text-white" : "border-slate-300 bg-white text-transparent"
                              }`}
                              aria-hidden="true"
                            >
                              <Check size={12} strokeWidth={3} />
                            </span>
                            <span className="block font-semibold text-[#0F172A]">{i.name}</span>
                            {i.description && (
                              <span className="mt-1 line-clamp-3 block text-xs text-slate-500">{i.description}</span>
                            )}
                            <span className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              {i.approvalRequired && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                                  <ShieldCheck size={11} /> Needs approval
                                </span>
                              )}
                              {i.slaHours != null && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={11} /> ~{i.slaHours}h to fulfil
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                      {/* Catch-all as a grid cell — fills the row like any item,
                          never a lone full-width row below. */}
                      <button
                        type="button"
                        onClick={() => pickItem(makeOther())}
                        className={`flex flex-col rounded-xl border border-dashed p-4 text-left transition hover:shadow-sm ${
                          item?.key === OTHER_KEY ? "border-[#005B96] bg-[#005B96]/5" : "border-slate-300 bg-white hover:border-[#005B96]/50"
                        }`}
                      >
                        <span className="block font-semibold text-[#0F172A]">Something else</span>
                        <span className="mt-1 block text-xs text-slate-500">
                          Can&apos;t find what you need{categoryName ? ` in ${categoryName}` : ""}? Pick this and describe it.
                        </span>
                      </button>
                    </div>
              </div>
            )}

            {/* STEP 4 — details */}
            {step === 3 && item && (
              <div className="flex flex-col gap-5">
                <StepHead title="A few details" hint="Just what we need to get this done for you." />

                <div className="flex items-start gap-3 rounded-xl border border-[#EEF1F5] bg-[#F9FAFC] p-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#005B96]/10 text-[#005B96]">
                    <ClipboardList size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{item.name}</div>
                    {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">{item.category}</span>
                      {item.service && <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">{item.service}</span>}
                      {item.approvalRequired && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                          <ShieldCheck size={11} /> Needs approval
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {suggestions.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-[#F9FAFC] p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#475569]">
                      <BookOpen size={13} /> These help articles might save you time
                    </div>
                    <ul className="space-y-1">
                      {suggestions.map((a) => (
                        <li key={a.name} className="text-[12.5px]">
                          <Link href="/cyber-assurance/helpdesk/portal/kb" className="text-[#005B96] hover:underline">
                            {a.title || a.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {item.fields.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {item.fields.map((f) => (
                      <Field key={f.key} label={f.label} required={f.required} hint={f.hint}>
                        {f.type === "textarea" ? (
                          <Textarea
                            value={answers[f.key] || ""}
                            onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                          />
                        ) : f.type === "select" ? (
                          <Select
                            value={answers[f.key] || ""}
                            onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                          >
                            <option value="">Select…</option>
                            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                          </Select>
                        ) : f.type === "checkbox" ? (
                          <span className="inline-flex items-center gap-2 text-[13px]">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 accent-[#005B96]"
                              checked={answers[f.key] === "yes"}
                              onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.checked ? "yes" : "" }))}
                            />
                            Yes
                          </span>
                        ) : (
                          <Input
                            type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                            value={answers[f.key] || ""}
                            onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-4 border-t border-[#EEF1F5] pt-5">
                  <Field label="Anything else we should know?" hint="Why you need it, who it's for, when you need it by.">
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={item.defaultDescription || "Add any details…"}
                    />
                  </Field>

                  <Field label="Is this about one of your assets?" hint="Optional — link the device or system so the team has its details.">
                    <AssetPicker value={asset} onChange={setAsset} />
                  </Field>

                  <div>
                    <span id="request-urgency-label" className="mb-1.5 block text-[11.5px] font-semibold text-[#475569]">
                      How soon do you need it?
                    </span>
                    <div role="radiogroup" aria-labelledby="request-urgency-label" className="grid gap-2 sm:grid-cols-3">
                      {urgencyOptions.map((u) => {
                        const on = urgency === u.value;
                        const [title, sub] = u.label.split(" — ");
                        return (
                          <button
                            key={u.value}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setUrgency(u.value)}
                            className={`rounded-xl border px-3.5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#005B96]/40 ${
                              on ? "border-[#005B96] bg-[#005B96]/5 shadow-sm" : "border-slate-200 bg-white hover:border-[#005B96]/40"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[u.value] || "bg-slate-400"}`} aria-hidden="true" />
                              <span className="text-[13px] font-semibold">{title}</span>
                              {on && <Check size={13} className="ml-auto text-[#005B96]" aria-hidden="true" />}
                            </span>
                            {sub && <span className="mt-0.5 block text-[11.5px] text-slate-500">{cap(sub)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5 — review */}
            {step === 4 && item && (
              <div className="flex flex-col gap-4">
                <StepHead title="Review your request" hint="Check everything looks right, then submit." />
                <dl className="divide-y divide-[#EEF1F5] overflow-hidden rounded-xl border border-[#EEF1F5] text-sm">
                  <ReviewRow label="Category" value={item.category} onEdit={() => jump(0)} />
                  {item.service && <ReviewRow label="Service" value={item.service} onEdit={() => jump(1)} />}
                  <ReviewRow label="Request" value={item.name} onEdit={() => jump(2)} />
                  {asset && <ReviewRow label="Asset" value={asset.name} onEdit={() => jump(3)} />}
                  {item.fields.map((f) => (
                    <ReviewRow
                      key={f.key}
                      label={f.label}
                      value={f.type === "checkbox" ? (answers[f.key] === "yes" ? "Yes" : "No") : answers[f.key] || "—"}
                      onEdit={() => jump(3)}
                    />
                  ))}
                  <ReviewRow label="Details" value={notes.trim() || "—"} onEdit={() => jump(3)} />
                  <ReviewRow label="Urgency" value={urgencyLabel(urgency)} onEdit={() => jump(3)} />
                </dl>
                {item.approvalRequired && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                    <ShieldCheck size={14} /> This request needs an approval before it can be fulfilled.
                  </div>
                )}
                <p className="text-xs text-[#94A3B8]">
                  After you submit, you can follow progress and reply from My Requests.
                </p>
              </div>
            )}

            {/* nav */}
            <div className="mt-6 flex items-center justify-between gap-2 border-t border-[#EEF1F5] pt-4">
              <div>
                {step > 0 ? (
                  <Btn variant="ghost" className="!h-9 !px-4 !text-[13px]" onClick={back} icon={<ArrowLeft size={14} />}>Back</Btn>
                ) : (
                  <Link href="/cyber-assurance/helpdesk/portal/my-requests"><Btn variant="ghost" className="!h-9 !px-4 !text-[13px]">Cancel</Btn></Link>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-[#94A3B8] sm:inline">Step {step + 1} of {STEPS.length}</span>
                {step < STEPS.length - 1 ? (
                  <Btn variant="primary" className="!h-9 !px-4 !text-[13px]" onClick={next}>
                    Next <ArrowRight size={14} />
                  </Btn>
                ) : (
                  <Btn variant="primary" className="!h-9 !px-4 !text-[13px]" onClick={submit} busy={busy} icon={<Check size={14} />}>
                    Submit request
                  </Btn>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── small presentational helpers ────────────────────────────────────────────
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const URGENCY_DOT: Record<string, string> = {
  low: "bg-sky-400",
  medium: "bg-amber-400",
  high: "bg-red-500",
};

/** A pick-one card used for both the category step and the service step. */
function SelectCard({ icon, title, description, meta, selected, onClick }: {
  icon: React.ReactNode; title: string; description?: string; meta?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3.5 rounded-xl border p-4 text-left transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#005B96]/40 ${
        selected ? "border-[#005B96] bg-[#005B96]/5" : "border-slate-200 bg-white hover:border-[#005B96]/40"
      }`}
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#005B96]/10 text-[#005B96] transition group-hover:bg-[#005B96] group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[#0F172A]">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500 line-clamp-2">{description}</span>}
        {meta && <span className="mt-1 block text-[11px] text-[#94A3B8]">{meta}</span>}
      </span>
      <ArrowRight size={16} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#005B96]" />
    </button>
  );
}

function StepHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[#0F172A]">{title}</h2>
      {hint && <p className="mt-0.5 text-[13px] text-[#64748B]">{hint}</p>}
    </div>
  );
}

/** Numbered progress indicator. Completed steps are buttons that jump back. */
function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          const last = i === STEPS.length - 1;
          const circle = (
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold transition ${
                done
                  ? "bg-emerald-500 text-white"
                  : active
                    ? "bg-[#005B96] text-white ring-4 ring-[#005B96]/15"
                    : "bg-[#EEF1F5] text-[#94A3B8]"
              }`}
            >
              {done ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
          );
          const text = (
            <span
              className={`text-[12.5px] font-medium ${active ? "text-[#0F172A]" : done ? "text-emerald-700" : "hidden text-[#94A3B8] sm:inline"}`}
            >
              {label}
            </span>
          );
          return (
            <li key={label} aria-current={active ? "step" : undefined} className={`flex items-center gap-2 ${last ? "" : "flex-1"}`}>
              {done ? (
                <button
                  type="button"
                  onClick={() => onJump(i)}
                  title={`Go back to ${label}`}
                  className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  {circle}
                  {text}
                </button>
              ) : (
                <>
                  {circle}
                  {text}
                </>
              )}
              {!last && <span className={`h-0.5 flex-1 rounded-full transition ${done ? "bg-emerald-300" : "bg-[#E2E5EC]"}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <dt className="w-32 shrink-0 text-[12px] font-semibold text-[#64748B]">{label}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[#0F172A]">{value}</dd>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Change ${label.toLowerCase()}`}
          className="shrink-0 rounded-md px-1.5 text-[12px] font-semibold text-[#005B96] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#005B96]/40"
        >
          Change
        </button>
      )}
    </div>
  );
}
