"use client";

/**
 * Help Desk — rich, process-aware New-Ticket form (ITSM §7, catalog v2).
 *
 * Step 1 picks the Process (Incident / Service Request / Problem / Change) +
 * Department; then process-specific fields render. Submits a single
 * POST /helpdesk/tickets with `process` + the collected extension fields.
 * The backend re-derives priority from the impact/urgency matrix
 * authoritatively — the live Priority chip here is just UX feedback.
 *
 * Template picker (catalog v2): the full library (100+) is fetched ONCE,
 * unfiltered, and grouped/filtered entirely client-side — by DEPARTMENT when no
 * department is chosen, by CATEGORY within the chosen department otherwise.
 *
 * Desync fix: the catalog fetch is NO LONGER keyed on `process`/`departmentId`.
 * Previously the request path embedded those mutable form values, so changing
 * Department (or a card click calling setProcess) refetched and reordered the
 * candidate cards under the user — and useHd keeps stale data mid-reload — so a
 * later click applied a *different* row with the same name (subject from one
 * row, description/impact from another). Now template values are written to form
 * state ONLY inside applyTemplate (the card onClick); changing the department
 * filter just changes which cards are visible and never mutates the form.
 */
import { useEffect, useMemo, useState } from "react";
import { ComboBoxInput } from "@/cyber-assurance/components/ui/ComboBoxInput";
import {
  Monitor, KeyRound, Mail, Wifi, Laptop, Download, Package, Printer, Lock,
  Server, UserPlus, Receipt, ShoppingCart, Calculator, FileText, Calendar,
  User, Thermometer, Wrench, Truck, DoorOpen, Sparkles, Shield, ShieldAlert,
  Bug, AlertTriangle, GitBranch, Rocket, Settings, Users, Building2, CreditCard,
  Phone, Globe, HardDrive, Cloud, Database, Smartphone, FileCheck, Megaphone,
  Headphones, Briefcase, GraduationCap, Network, RefreshCw, Trash2, Plus,
  type LucideIcon,
} from "lucide-react";
import { Chip, PRIORITY_CHIP, useHd } from "./_ui";
import { Modal, Field, Input, Textarea, Btn, FormError, hdCall } from "./_admin";
import { AffectedCiPicker, type CiLite } from "./_ci";

type Dept = { id: number; name: string; enabled: boolean };
type Agent = { email?: string | null; name?: string | null; agent_name?: string | null };
type Team = { id: number; name: string; team_name?: string | null; disabled?: boolean };

type Tpl = {
  id: number;
  template_name: string;
  department_id: number | null;
  department?: string | null;
  process: Process;
  default_subject?: string | null;
  default_description?: string | null;
  default_category?: string | null;
  default_subcategory?: string | null;
  default_impact?: string | null;
  default_urgency?: string | null;
  icon?: string | null;
};

// Resolve a template's lucide icon name (kebab or Pascal) to a component; any
// unknown name falls back to a generic card icon. Keyed by alnum-lowercased name.
const ICONS: Record<string, LucideIcon> = {
  monitor: Monitor, keyround: KeyRound, key: KeyRound, mail: Mail, wifi: Wifi,
  laptop: Laptop, download: Download, package: Package, printer: Printer,
  lock: Lock, shieldcheck: Shield, shield: Shield, shieldalert: ShieldAlert,
  server: Server, userplus: UserPlus, receipt: Receipt,
  shoppingcart: ShoppingCart, cart: ShoppingCart, calculator: Calculator,
  filetext: FileText, file: FileText, filecheck: FileCheck, calendar: Calendar,
  calendarclock: Calendar, user: User, users: Users, thermometer: Thermometer,
  wrench: Wrench, truck: Truck, move: Truck, dooropen: DoorOpen, bug: Bug,
  alerttriangle: AlertTriangle, gitbranch: GitBranch, rocket: Rocket,
  settings: Settings, building: Building2, building2: Building2,
  creditcard: CreditCard, phone: Phone, globe: Globe, harddrive: HardDrive,
  cloud: Cloud, database: Database, smartphone: Smartphone, megaphone: Megaphone,
  headphones: Headphones, briefcase: Briefcase, graduationcap: GraduationCap,
  network: Network, refreshcw: RefreshCw, trash2: Trash2, trash: Trash2, plus: Plus,
};
const iconFor = (name?: string | null): LucideIcon =>
  ICONS[(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")] || Sparkles;

const PROCESSES = [
  { value: "incident", label: "Incident" },
  { value: "service_request", label: "Service Request" },
  { value: "problem", label: "Problem" },
  { value: "change", label: "Change" },
] as const;
type Process = (typeof PROCESSES)[number]["value"];

// Colour-coded process badge (card + "Creating:" line). Distinct hue per ITIL process.
const PROCESS_BADGE: Record<Process, { label: string; cls: string }> = {
  incident: { label: "Incident", cls: "bg-rose-100 text-rose-700" },
  service_request: { label: "Service Request", cls: "bg-sky-100 text-sky-700" },
  problem: { label: "Problem", cls: "bg-amber-100 text-amber-700" },
  change: { label: "Change", cls: "bg-violet-100 text-violet-700" },
};

// §4 priority matrix (impact row × urgency column). Backend is authoritative.
const MATRIX: Record<string, Record<string, string>> = {
  high: { high: "Urgent", medium: "High", low: "Medium" },
  medium: { high: "High", medium: "Medium", low: "Low" },
  low: { high: "Medium", medium: "Low", low: "Low" },
};
const derivePriority = (impact: string, urgency: string): string | null =>
  impact && urgency ? MATRIX[impact]?.[urgency] ?? null : null;

const LEVELS = ["low", "medium", "high"];

type Section = { header: string; items: Tpl[] };

export function NewTicketDialog({
  open,
  onClose,
  onCreated,
  lockProcess,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  lockProcess?: Process;
}) {
  const depts = useHd<{ departments: Dept[] }>("/helpdesk/departments");
  // Shape: a map of category → [subcategories] (§3.5). Tolerate a {catalog:…} wrapper or absence.
  const sc = useHd<any>("/helpdesk/service-catalog");
  // Full template library — fetched ONCE, unfiltered. Grouping/filtering is client-side
  // so changing the department filter never refetches or reorders under the user (desync fix).
  const tpls = useHd<{ templates: Tpl[] }>("/helpdesk/request-templates");
  const agentsRes = useHd<{ agents: Agent[] }>("/helpdesk/agents");
  const teamsRes = useHd<{ teams: Team[] }>("/helpdesk/teams");
  const sgRes = useHd<{ support_groups: { code: string; name: string; mapped: boolean }[] }>("/helpdesk/support-groups");
  // Customers list — {name: "<id>", customer_name}. The picker sends customer_id = Number(name).
  const customersRes = useHd<{ customers: { name: string; customer_name?: string | null }[] }>("/helpdesk/customers");
  // Governance change types (grc_hd_change_type) for the Change form — sourced from
  // the tenant's seeded/configured types, not a hardcoded list (so "Major" + any
  // custom type appear). Falls back to the ITIL defaults if the read is empty.
  const changeTypesRes = useHd<{ change_types: { code: string; name: string }[] }>("/helpdesk/change-types");
  const changeTypes = (changeTypesRes.data?.change_types?.length
    ? changeTypesRes.data.change_types
    : [{ code: "standard", name: "Standard" }, { code: "normal", name: "Normal" }, { code: "emergency", name: "Emergency" }]);

  const [process, setProcess] = useState<Process>(lockProcess ?? "incident");
  const [departmentId, setDepartmentId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [customerId, setCustomerId] = useState("");

  // assignment (optional — unassigned routes by department)
  const [assignee, setAssignee] = useState("");
  const [team, setTeam] = useState("");
  const [supportGroup, setSupportGroup] = useState("");

  // affected CI (optional — agents set it at triage; requesters don't pick CIs)
  const [ci, setCi] = useState<CiLite | null>(null);

  // shared (incident + service_request)
  const [impact, setImpact] = useState("");
  const [urgency, setUrgency] = useState("");
  // service_request
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  // incident/problem/change — per-process category taxonomy (id of the chosen node)
  const [catId, setCatId] = useState("");
  const [subcatId, setSubcatId] = useState("");
  // problem
  const [rootCause, setRootCause] = useState("");
  const [linkedIncs, setLinkedIncs] = useState<number[]>([]);
  // change
  const [changeType, setChangeType] = useState("normal");
  const [changeRisk, setChangeRisk] = useState("medium");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [implPlan, setImplPlan] = useState("");
  const [backoutPlan, setBackoutPlan] = useState("");
  const [originProblem, setOriginProblem] = useState(""); // problem this change addresses (ticket name == id)

  const [hideTemplates, setHideTemplates] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const deptList = (depts.data?.departments || []).filter((d) => d.enabled);
  const agentList = agentsRes.data?.agents || [];
  const teamList = (teamsRes.data?.teams || []).filter((t) => !t.disabled);

  const catalog: Record<string, string[]> = useMemo(() => {
    const raw = sc.data;
    if (!raw || typeof raw !== "object") return {};
    const map = raw.catalog && typeof raw.catalog === "object" ? raw.catalog : raw;
    const out: Record<string, string[]> = {};
    for (const k of Object.keys(map)) if (Array.isArray(map[k])) out[k] = map[k];
    return out;
  }, [sc.data]);
  const categories = Object.keys(catalog);
  const subs = category ? catalog[category] || [] : [];

  const derived = derivePriority(impact, urgency);

  // §A5 real SLA target for the chosen process + derived priority (fallback Medium).
  // Keyed on process/priority only — display-only, never writes form state.
  const slaPrev = useHd<{ policy?: string | null; response?: string | null; resolution?: string | null }>(
    `/helpdesk/sla-preview?process=${encodeURIComponent(process)}&priority=${encodeURIComponent(derived || "Medium")}`,
  );
  const slaResp = slaPrev.data?.response;
  const slaRes = slaPrev.data?.resolution;

  // Per-process category tree (incident/problem/change). Refetches when the process
  // changes; service_request uses the catalogue so its list comes back empty here.
  const procCats = useHd<{ categories: { id: number; name: string; level: string; parent_id: number | null }[] }>(
    `/helpdesk/process-categories?process=${encodeURIComponent(process)}`,
  );
  const topCats = (procCats.data?.categories || []).filter((c) => c.level === "category");
  const subCats = catId
    ? (procCats.data?.categories || []).filter((c) => c.level === "subcategory" && c.parent_id === Number(catId))
    : [];
  useEffect(() => { setCatId(""); setSubcatId(""); }, [process]);

  // Open incidents to link into a Problem (ITIL: a problem groups recurring incidents).
  const probIncidents = useHd<{ tickets: { name: string; subject?: string }[] }>("/helpdesk/incidents");
  // Problems a Change can be raised to address (ITIL: a change implements a problem's fix).
  const changeProblems = useHd<{ tickets: { name: string; subject?: string }[] }>("/helpdesk/problems");

  // Group/filter the full library client-side (§2a). No department → section per
  // department; department chosen → that department's cards, sub-grouped by category.
  const sections: Section[] = useMemo(() => {
    const all = tpls.data?.templates || [];
    const push = (m: Map<string, Tpl[]>, k: string, t: Tpl) => {
      const arr = m.get(k) || [];
      arr.push(t);
      m.set(k, arr);
    };
    const m = new Map<string, Tpl[]>();
    if (departmentId) {
      const did = Number(departmentId);
      for (const t of all) if (t.department_id === did) push(m, t.default_category || "General", t);
    } else {
      for (const t of all) push(m, t.department || "Other", t);
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([header, items]) => ({ header, items }));
  }, [tpls.data, departmentId]);
  const templateCount = sections.reduce((n, s) => n + s.items.length, 0);

  // §2c atomic full autofill — the ONLY place template values touch form state.
  const applyTemplate = (t: Tpl) => {
    if (t.process && t.process !== process) setProcess(t.process);
    setSubject(t.default_subject || t.template_name || "");
    setDescription(t.default_description || "");
    setCategory(t.default_category || "");
    setSubcategory(t.default_subcategory || "");
    setImpact(t.default_impact || "");
    setUrgency(t.default_urgency || "");
  };

  const reset = () => {
    setProcess("incident");
    setDepartmentId(""); setSubject(""); setDescription(""); setContact(""); setCustomerId("");
    setAssignee(""); setTeam(""); setSupportGroup(""); setCi(null);
    setImpact(""); setUrgency("");
    setCategory(""); setSubcategory("");
    setCatId(""); setSubcatId("");
    setRootCause(""); setLinkedIncs([]);
    setChangeType("normal"); setChangeRisk("medium");
    setPlannedStart(""); setPlannedEnd(""); setImplPlan(""); setBackoutPlan("");
    setOriginProblem("");
    setHideTemplates(false);
    setErr(null);
  };

  const close = () => { if (!busy) { reset(); onClose(); } };

  const submit = async () => {
    if (!subject.trim()) { setErr("Subject is required."); return; }
    setBusy(true); setErr(null);

    const payload: Record<string, unknown> = {
      process,
      subject: subject.trim(),
      description: description.trim() || null,
      department_id: departmentId ? Number(departmentId) : null,
    };
    if (contact.trim()) payload.contact = contact.trim();
    if (customerId) payload.customer_id = Number(customerId);
    if (assignee) payload.assigned_agent = assignee; // explicit assignee (wins over auto-assign)
    if (team) payload.team = team;
    if (supportGroup) payload.support_group_code = supportGroup; // routes to the group's mapped team
    if (ci) payload.ci_id = ci.id; // affected configuration item

    if (process === "incident" || process === "service_request") {
      if (impact) payload.impact = impact;
      if (urgency) payload.urgency = urgency;
    }
    if (process === "service_request") {
      if (category) payload.request_category = category;
      if (subcategory) payload.request_subcategory = subcategory;
    }
    if (process === "problem") {
      if (rootCause.trim()) payload.root_cause = rootCause.trim();
      if (linkedIncs.length) payload.linked_incident_ids = linkedIncs;
    }
    if (process === "change") {
      payload.change_type = changeType;
      payload.change_risk = changeRisk;
      if (plannedStart) payload.planned_start = plannedStart;
      if (plannedEnd) payload.planned_end = plannedEnd;
      if (implPlan.trim()) payload.implementation_plan = implPlan.trim();
      if (backoutPlan.trim()) payload.backout_plan = backoutPlan.trim();
      if (originProblem) { payload.origin_ticket_id = Number(originProblem); payload.origin_process = "problem"; }
    }

    // per-process category (incident/problem/change) — leaf chosen wins (subcategory over category)
    const leafCat = subcatId || catId;
    if (leafCat) {
      if (process === "incident") payload.incident_category_id = Number(leafCat);
      else if (process === "problem") payload.problem_category_id = Number(leafCat);
      else if (process === "change") payload.change_category_id = Number(leafCat);
    }

    const create = await hdCall("post", "/helpdesk/tickets", payload);
    setBusy(false);
    if (!create.ok || !create.data?.name) {
      setErr(create.error || "Could not create the ticket.");
      return;
    }
    reset();
    onCreated();
  };

  const activeBadge = PROCESS_BADGE[process];

  return (
    <Modal
      open={open}
      onClose={close}
      title={lockProcess ? `New ${PROCESS_BADGE[lockProcess].label.toLowerCase()}` : "New ticket"}
      subtitle={lockProcess ? "Fill in what it needs" : "Pick a process, then fill in what it needs"}
      wide
      side
      footer={
        <>
          <Btn variant="ghost" onClick={close} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} busy={busy}>
            {process === "change" ? "Create draft change" : "Create ticket"}
          </Btn>
        </>
      }
    >
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        {/* Step 1 — process (hidden when the dialog is locked to one process,
            e.g. opened from a dedicated Incidents/Problems/Changes page) */}
        {!lockProcess && (
          <div>
            <span className="mb-1.5 block text-[11.5px] font-semibold text-[#475569]">Process</span>
            <div className="flex flex-wrap gap-2">
              {PROCESSES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProcess(p.value)}
                  className={`rounded-[9px] border px-3 py-1.5 text-[12.5px] font-semibold transition ${
                    process === p.value
                      ? "border-[#005B96] bg-[#005B96] text-white"
                      : "border-[#E2E5EC] bg-white text-[#334155] hover:bg-[#F6F7FB]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[#64748B]">
              Creating:
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${activeBadge.cls}`}>
                {activeBadge.label}
              </span>
            </span>
          </div>
        )}

        {/* §2d prominent SLA callout — updates live with process × derived priority. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-[#005B96]/20 bg-[#005B96]/[0.06] px-3.5 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#005B96]">SLA</span>
          {slaResp || slaRes ? (
            <>
              <span className="text-[12.5px] text-[#334155]">
                First response <span className="font-semibold text-[#0F172A]">{slaResp || "—"}</span>
              </span>
              <span className="text-[12.5px] text-[#334155]">
                Resolution <span className="font-semibold text-[#0F172A]">{slaRes || "—"}</span>
              </span>
            </>
          ) : (
            <span className="text-[12.5px] text-[#64748B]">
              {slaPrev.loading ? "Loading target…" : "No SLA policy configured for this process."}
            </span>
          )}
          <span className="ml-auto text-[11px] text-[#94A3B8]">
            {activeBadge.label} · {derived || "Medium"} priority
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Department" hint={!deptList.length ? "No departments yet — create one in Settings → Departments." : process === "service_request" ? "Filters the templates below." : "Routes this to the right team."}>
            <ComboBoxInput
              ariaLabel="Department"
              value={departmentId}
              onChange={setDepartmentId}
              options={deptList.map((d) => ({ value: String(d.id), label: d.name }))}
              placeholder="All departments"
              allowCustom={false}
              displayLabelInsteadOfValue
            />
          </Field>
          <Field label="Subject" required>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary of the request" autoFocus />
          </Field>
        </div>

        {/* §2a/2b/2c template picker — grouped, scrollable, process-badged; click = full autofill.
            Only Service Requests order from the catalogue of common requests; Incident/Problem/
            Change use a clean process form instead, so the template browser is gated to them. */}
        {process === "service_request" && (!hideTemplates ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] font-semibold text-[#475569]">
                Common requests{departmentId ? "" : " — by department"}
                {templateCount > 0 && <span className="ml-1 font-normal text-[#94A3B8]">({templateCount})</span>}
              </span>
              <button
                type="button"
                onClick={() => setHideTemplates(true)}
                className="text-[11px] font-semibold text-[#005B96] hover:underline"
              >
                Start from scratch
              </button>
            </div>
            {templateCount === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[#E2E5EC] bg-[#F9FAFB] px-3 py-4 text-center text-[12px] text-[#94A3B8]">
                {tpls.loading ? "Loading templates…" : departmentId ? "No templates for this department yet." : "No templates configured yet."}
              </div>
            ) : (
              <div className="max-h-[320px] space-y-3 overflow-y-auto rounded-[10px] border border-[#EEF1F5] bg-[#F9FAFB] p-2.5">
                {sections.map((sec) => (
                  <div key={sec.header}>
                    <div className="sticky top-0 z-[1] mb-1.5 bg-[#F9FAFB] px-0.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#64748B]">
                      {sec.header}
                      <span className="ml-1 font-normal normal-case text-[#A3AEBE]">({sec.items.length})</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {sec.items.map((t) => {
                        const Icon = iconFor(t.icon);
                        const badge = PROCESS_BADGE[t.process] || PROCESS_BADGE.incident;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => applyTemplate(t)}
                            className="flex items-start gap-2 rounded-[10px] border border-[#E2E5EC] bg-white px-3 py-2.5 text-left transition hover:border-[#005B96] hover:bg-[#F6F7FB]"
                          >
                            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#005B96]/10 text-[#005B96]">
                              <Icon size={16} strokeWidth={1.9} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium text-[#334155]">{t.default_subject || t.template_name}</span>
                              <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setHideTemplates(false)}
            className="self-start text-[11px] font-semibold text-[#005B96] hover:underline"
          >
            Browse common requests
          </button>
        ))}

        {/* Category + subcategory — incident/problem/change pick from their own
            per-process taxonomy (same source the end-user side uses for incidents). */}
        {(process === "incident" || process === "problem" || process === "change") && (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Category" hint="What area is this about?">
              <ComboBoxInput
                ariaLabel="Category"
                value={catId}
                onChange={(v) => { setCatId(v); setSubcatId(""); }}
                options={topCats.map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder="Search a category…"
                allowCustom={false}
                displayLabelInsteadOfValue
              />
            </Field>
            <Field label="Subcategory" hint={catId ? "Optional — narrow it down." : "Pick a category first."}>
              <ComboBoxInput
                ariaLabel="Subcategory"
                value={subcatId}
                onChange={setSubcatId}
                options={subCats.map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder={catId ? "Search a subcategory…" : "Pick a category first"}
                allowCustom={false}
                disabled={!catId || subCats.length === 0}
                displayLabelInsteadOfValue
              />
            </Field>
          </div>
        )}

        {/* Incident */}
        {process === "incident" && (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Impact">
              <ComboBoxInput ariaLabel="Impact" value={impact} onChange={setImpact}
                options={LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))}
                placeholder="— Select —" allowCustom={false} displayLabelInsteadOfValue />
            </Field>
            <Field label="Urgency">
              <ComboBoxInput ariaLabel="Urgency" value={urgency} onChange={setUrgency}
                options={LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))}
                placeholder="— Select —" allowCustom={false} displayLabelInsteadOfValue />
            </Field>
            <Field label="Priority" hint="Derived from impact × urgency.">
              <div className="flex h-[38px] items-center">
                {derived ? <Chip value={derived} map={PRIORITY_CHIP} /> : <span className="text-[12px] text-[#94A3B8]">Pick impact + urgency</span>}
              </div>
            </Field>
          </div>
        )}

        {/* Service Request */}
        {process === "service_request" && (
          <>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="Category">
                <ComboBoxInput ariaLabel="Category" value={category}
                  onChange={(v) => { setCategory(v); setSubcategory(""); }}
                  options={categories.map((c) => ({ value: c, label: c }))}
                  placeholder={categories.length ? "— Select —" : "No catalog configured"} allowCustom={false} />
              </Field>
              <Field label="Subcategory">
                <ComboBoxInput ariaLabel="Subcategory" value={subcategory} onChange={setSubcategory}
                  options={subs.map((s) => ({ value: s, label: s }))}
                  placeholder={subs.length ? "— Select —" : "—"} allowCustom={false} disabled={!subs.length} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <Field label="Impact">
                <ComboBoxInput ariaLabel="Impact" value={impact} onChange={setImpact}
                  options={LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))}
                  placeholder="— Optional —" allowCustom={false} displayLabelInsteadOfValue />
              </Field>
              <Field label="Urgency">
                <ComboBoxInput ariaLabel="Urgency" value={urgency} onChange={setUrgency}
                  options={LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))}
                  placeholder="— Optional —" allowCustom={false} displayLabelInsteadOfValue />
              </Field>
              <Field label="Priority" hint="Derived from impact × urgency.">
                <div className="flex h-[38px] items-center">
                  {derived ? <Chip value={derived} map={PRIORITY_CHIP} /> : <span className="text-[12px] text-[#94A3B8]">Default</span>}
                </div>
              </Field>
            </div>
          </>
        )}

        {/* Problem */}
        {process === "problem" && (
          <>
            <Field label="Root cause" hint="Optional — the suspected or confirmed cause behind these incidents.">
              <Textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Suspected or confirmed root cause…" />
            </Field>
            <div>
              <p className="mb-1 text-[11.5px] font-semibold text-[#475569]">Link related incidents</p>
              <p className="m-0 mb-1.5 text-[11px] text-[#94A3B8]">Pick the recurring incidents this problem investigates — grouping them is what a problem is for.</p>
              {linkedIncs.length > 0 && (
                <ul className="m-0 mb-2 flex list-none flex-col gap-1 p-0">
                  {linkedIncs.map((lid) => {
                    const t = (probIncidents.data?.tickets || []).find((x) => Number(x.name) === lid);
                    return (
                      <li key={lid} className="flex items-center gap-2 rounded-[9px] border border-[#E2E5EC] bg-white px-2.5 py-1.5 text-[12.5px]">
                        <span className="font-mono text-[11px] text-[#005B96]">#{lid}</span>
                        <span className="min-w-0 flex-1 truncate text-[#334155]">{t?.subject || "(incident)"}</span>
                        <button type="button" onClick={() => setLinkedIncs((l) => l.filter((x) => x !== lid))} className="text-[11.5px] font-semibold text-rose-600 hover:text-rose-700">Remove</button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <ComboBoxInput
                ariaLabel="Add an incident"
                value=""
                onChange={(v) => { const n = Number(v); if (n && !linkedIncs.includes(n)) setLinkedIncs((l) => [...l, n]); }}
                options={(probIncidents.data?.tickets || [])
                  .filter((t) => !linkedIncs.includes(Number(t.name)))
                  .map((t) => ({ value: String(t.name), label: t.subject || `Incident ${t.name}` }))}
                placeholder="Search incidents to link…"
                allowCustom={false}
              />
            </div>
          </>
        )}

        {/* Change */}
        {process === "change" && (
          <>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="Change type">
                <ComboBoxInput ariaLabel="Change type" value={changeType} onChange={setChangeType}
                  options={changeTypes.map((c) => ({ value: c.code, label: c.name }))}
                  placeholder="Select a change type…" allowCustom={false} displayLabelInsteadOfValue />
              </Field>
              <Field label="Risk">
                <ComboBoxInput ariaLabel="Risk" value={changeRisk} onChange={setChangeRisk}
                  options={LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))}
                  placeholder="— Select —" allowCustom={false} displayLabelInsteadOfValue />
              </Field>
              <Field label="Planned start">
                <Input type="datetime-local" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
              </Field>
              <Field label="Planned end">
                <Input type="datetime-local" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
              </Field>
            </div>
            <Field label="Implementation plan">
              <Textarea value={implPlan} onChange={(e) => setImplPlan(e.target.value)} placeholder="Steps to implement the change…" />
            </Field>
            <Field label="Backout plan">
              <Textarea value={backoutPlan} onChange={(e) => setBackoutPlan(e.target.value)} placeholder="How to roll back if it goes wrong…" />
            </Field>
            <Field label="Addresses problem" hint="Optional — the problem this change was raised to fix. Leave blank for a standalone change.">
              <ComboBoxInput ariaLabel="Addresses problem" value={originProblem} onChange={setOriginProblem}
                options={(changeProblems.data?.tickets || []).map((t) => ({ value: String(t.name), label: t.subject || `Problem ${t.name}` }))}
                placeholder="Search problems…" allowCustom={false} displayLabelInsteadOfValue />
            </Field>
          </>
        )}

        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's going on? Steps, context, impact…" />
        </Field>

        {/* Affected CI — optional; agents link the configuration item this ticket is about. */}
        <Field label="Affected CI" hint="Optional — the configuration item this ticket is about. Drives exposure-aware change governance.">
          <AffectedCiPicker value={ci} onChange={setCi} />
        </Field>

        {/* §2e assignment — optional; unassigned routes by department. */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Assignee" hint="Optional — leave blank to auto-route by department.">
            <ComboBoxInput ariaLabel="Assignee" value={assignee} onChange={setAssignee}
              options={agentList.map((a) => ({ value: a.email || a.name || "", label: a.agent_name || a.name || a.email || "" }))}
              placeholder="Unassigned (auto-route)" allowCustom={false} displayLabelInsteadOfValue />
          </Field>
          <Field label="Team" hint="Optional — overrides the department's default team.">
            <ComboBoxInput ariaLabel="Team" value={team} onChange={setTeam}
              options={teamList.map((tm) => ({ value: tm.name, label: tm.team_name || tm.name }))}
              placeholder={teamList.length ? "— Select —" : "No teams configured"} allowCustom={false} disabled={!teamList.length} displayLabelInsteadOfValue />
          </Field>
          <Field label="Support group" hint="Optional — routes to the group's mapped team (Governance → Support groups).">
            <ComboBoxInput ariaLabel="Support group" value={supportGroup} onChange={setSupportGroup}
              options={(sgRes.data?.support_groups || []).map((g) => ({ value: g.code, label: `${g.name}${g.mapped ? "" : " (unmapped)"}` }))}
              placeholder="— Select —" allowCustom={false} displayLabelInsteadOfValue />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Customer" hint="Optional — the organisation this ticket belongs to.">
            <ComboBoxInput ariaLabel="Customer" value={customerId} onChange={setCustomerId}
              options={(customersRes.data?.customers || []).map((c) => ({ value: c.name, label: c.customer_name || c.name }))}
              placeholder={(customersRes.data?.customers || []).length ? "— None —" : "No customers configured"} allowCustom={false} disabled={!(customersRes.data?.customers || []).length} displayLabelInsteadOfValue />
          </Field>
          <Field label="Contact email" hint="Who raised this, if not an internal user.">
            <Input type="email" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="person@company.com" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
