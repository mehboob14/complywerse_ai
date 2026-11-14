"use client";

/**
 * Help Desk Settings — every Help-Desk-specific admin section, each
 * self-contained (reads via useHd, mutates via hdCall), wired to the
 * /helpdesk/* endpoints. Nothing is seeded: the owner creates every department,
 * agent, status, type, priority, template, feedback option and SLA here through
 * real Create / Edit / Delete buttons.
 *
 * Teams and roles are NOT managed here — they live in ComplyVerse Administration
 * (Role Management / Teams). The team dropdowns below read /helpdesk/teams, which
 * now sources the ComplyVerse Administration teams (grc_teams): the Help Desk USES those
 * teams for routing/assignment, it no longer keeps its own team table.
 */
import { useState } from "react";
import { Pencil, Trash2, Check, Minus } from "lucide-react";
import { Chip, Empty, ErrorBanner, Loading, Table, useHd } from "../_ui";
import {
  Modal, Field, Input, Textarea, Select, Toggle, Btn, NewBtn,
  FormError, Note, Section, hdCall, useConfirmDelete,
} from "../_admin";

// ── small shared row-action cluster ─────────────────────────────────────────
function RowActions({ onEdit, onDelete, deleting, editDisabled, deleteDisabled, title }: {
  onEdit?: () => void; onDelete?: () => void; deleting?: boolean;
  editDisabled?: boolean; deleteDisabled?: boolean; title?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-1" title={title}>
      {onEdit && (
        <button onClick={onEdit} disabled={editDisabled}
          className="grid h-7 w-7 place-items-center rounded-lg text-[#64748B] hover:bg-[#F6F7FB] disabled:opacity-40">
          <Pencil size={14} />
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} disabled={deleteDisabled || deleting}
          className="grid h-7 w-7 place-items-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-40">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

const yesNo = (v: boolean) =>
  v ? <Check size={14} className="text-emerald-600" /> : <Minus size={14} className="text-[#CBD5E1]" />;

// ════════════════════════════════════════════════════════════════════════════
// DEPARTMENTS  (full CRUD + default team)
// ════════════════════════════════════════════════════════════════════════════
export function DepartmentsSection() {
  const { data, loading, error, reload } = useHd<{ departments: any[] }>("/helpdesk/departments");
  const teams = useHd<{ teams: any[] }>("/helpdesk/teams");
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const del = useConfirmDelete();
  const rows = data?.departments || [];
  const teamList = teams.data?.teams || [];

  const start = (row?: any) => { setEdit(row || null); setOpen(true); };

  return (
    <Section title="Departments" description="Generic service-desk groups (Sales, Finance, IT…). Tickets routed to a department flow to its default team."
      action={<NewBtn label="New department" onClick={() => start()} />}>
      {error && <ErrorBanner msg={error} />}
      <Note>Teams are managed in Administration → Teams.</Note>
      {loading ? <Loading what="departments" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No departments yet" hint="Create one so new tickets can be routed." />
        : (
          <Table head={["Name", "Description", "Default team", "Enabled", ""]}>
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{d.name}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{d.description || "—"}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{d.default_team || "—"}</td>
                <td className="px-4 py-2.5">{yesNo(d.enabled)}</td>
                <td className="px-4 py-2.5">
                  <RowActions onEdit={() => start(d)} deleting={del.pending === String(d.id)}
                    onDelete={() => del.run(String(d.id), d.name, () => hdCall("delete", `/helpdesk/departments/${d.id}`), reload)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <DepartmentForm row={edit} teams={teamList} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function DepartmentForm({ row, teams, onClose, onSaved }: { row: any | null; teams: any[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name || "");
  const [description, setDescription] = useState(row?.description || "");
  const [defaultTeamId, setDefaultTeamId] = useState(row?.default_team_id ? String(row.default_team_id) : "");
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr(null);
    const body = { name: name.trim(), description: description.trim() || null, default_team_id: defaultTeamId ? Number(defaultTeamId) : null, enabled };
    const r = row ? await hdCall("put", `/helpdesk/departments/${row.id}`, body) : await hdCall("post", "/helpdesk/departments", body);
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Save failed.");
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={row ? "Edit department" : "New department"}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Save</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. IT Support" autoFocus /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Default team" hint="Tickets for this department route here, then the assignment engine picks an agent.">
          <Select value={defaultTeamId} onChange={(e) => setDefaultTeamId(e.target.value)}>
            <option value="">— None —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
          </Select>
        </Field>
        <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AGENTS  (list + invite/create + active/availability toggle)
// ════════════════════════════════════════════════════════════════════════════
export function AgentsSection() {
  const { data, loading, error, reload } = useHd<{ agents: any[] }>("/helpdesk/agents");
  const statuses = useHd<{ agent_statuses: any[] }>("/helpdesk/agent-statuses");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const rows = data?.agents || [];
  const enabledStatuses = (statuses.data?.agent_statuses || []).filter((s) => s.enabled);

  const setActive = async (email: string, is_active: boolean) => {
    setPending(email);
    const r = await hdCall("post", `/helpdesk/agents/${encodeURIComponent(email)}/active`, { is_active });
    setPending(null);
    if (r.ok) reload(); else window.alert(r.error || "Update failed.");
  };

  return (
    <Section title="Agents" description="People who work tickets. Invite an agent, set their availability, or toggle them active."
      action={<NewBtn label="New agent" onClick={() => setOpen(true)} disabled={enabledStatuses.length === 0} />}>
      {error && <ErrorBanner msg={error} />}
      {enabledStatuses.length === 0 && <Note>Create at least one enabled <b>Agent status</b> (below) before adding agents — a new agent must be given a status.</Note>}
      {loading ? <Loading what="agents" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No agents yet" hint="Invite your first agent." />
        : (
          <Table head={["Agent", "Email", "Availability", "Active", ""]}>
            {rows.map((a) => (
              <tr key={a.email} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{a.agent_name || a.email}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{a.email}</td>
                <td className="px-4 py-2.5"><Chip value={a.availability} /></td>
                <td className="px-4 py-2.5">{yesNo(!!a.is_active)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end">
                    <Btn variant={a.is_active ? "ghost" : "primary"} busy={pending === a.email} onClick={() => setActive(a.email, !a.is_active)}>
                      {a.is_active ? "Deactivate" : "Activate"}
                    </Btn>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <AgentForm statuses={enabledStatuses} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function AgentForm({ statuses, onClose, onSaved }: { statuses: any[]; onClose: () => void; onSaved: () => void }) {
  const [user, setUser] = useState("");
  const [agentName, setAgentName] = useState("");
  const [availability, setAvailability] = useState(statuses[0]?.agent_status || "");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!user.trim()) { setErr("Login email is required."); return; }
    setBusy(true); setErr(null);
    const r = await hdCall("post", "/helpdesk/agents", {
      user: user.trim(), agent_name: agentName.trim() || null, availability: availability || null, is_active: isActive,
    });
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Could not add the agent.");
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title="New agent" subtitle="Add someone as a Help Desk agent"
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Add agent</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Login email" required><Input type="email" value={user} onChange={(e) => setUser(e.target.value)} placeholder="agent@company.com" autoFocus /></Field>
        <Field label="Display name"><Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Full name" /></Field>
        <Field label="Availability" required>
          <Select value={availability} onChange={(e) => setAvailability(e.target.value)}>
            {statuses.map((s) => <option key={s.name} value={s.agent_status}>{s.agent_status}</option>)}
          </Select>
        </Field>
        <Toggle checked={isActive} onChange={setIsActive} label="Active" />
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT STATUSES  (full CRUD — availability catalogue agents are set to)
// ════════════════════════════════════════════════════════════════════════════
export function AgentStatusesSection() {
  const { data, loading, error, reload } = useHd<{ agent_statuses: any[] }>("/helpdesk/agent-statuses");
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const del = useConfirmDelete();
  const rows = data?.agent_statuses || [];

  return (
    <Section title="Agent statuses" description="The availability states agents can be in (Active, Away, Unavailable…)."
      action={<NewBtn label="New status" onClick={() => { setEdit(null); setOpen(true); }} />}>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="statuses" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No agent statuses yet" hint="Create one so agents can be given a status." />
        : (
          <Table head={["Status", "Category", "Enabled", "Default", ""]}>
            {rows.map((s) => (
              <tr key={s.name} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{s.agent_status}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{s.category}</td>
                <td className="px-4 py-2.5">{yesNo(s.enabled)}</td>
                <td className="px-4 py-2.5">{s.is_default ? <Chip value="Default" /> : <Minus size={14} className="text-[#CBD5E1]" />}</td>
                <td className="px-4 py-2.5">
                  <RowActions onEdit={() => { setEdit(s); setOpen(true); }} deleting={del.pending === s.name}
                    deleteDisabled={s.is_default} title={s.is_default ? "The default status can't be deleted" : undefined}
                    onDelete={() => del.run(s.name, s.agent_status, () => hdCall("delete", `/helpdesk/agent-statuses/${s.name}`), reload)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <AgentStatusForm row={edit} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function AgentStatusForm({ row, onClose, onSaved }: { row: any | null; onClose: () => void; onSaved: () => void }) {
  const [agentStatus, setAgentStatus] = useState(row?.agent_status || "");
  const [category, setCategory] = useState(row?.category || "Active");
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!agentStatus.trim()) { setErr("Status name is required."); return; }
    setBusy(true); setErr(null);
    const body = { agent_status: agentStatus.trim(), category, enabled };
    const r = row ? await hdCall("put", `/helpdesk/agent-statuses/${row.name}`, body) : await hdCall("post", "/helpdesk/agent-statuses", body);
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Save failed.");
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={row ? "Edit agent status" : "New agent status"}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Save</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Status name" required><Input value={agentStatus} onChange={(e) => setAgentStatus(e.target.value)} placeholder="e.g. Active" autoFocus /></Field>
        <Field label="Category" required>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {["Active", "Away", "Unavailable"].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TICKET STATUSES  (list + create + edit + disable)
// ════════════════════════════════════════════════════════════════════════════
export function TicketStatusesSection() {
  const { data, loading, error, reload } = useHd<{ ticket_statuses: any[] }>("/helpdesk/ticket-statuses");
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const rows = data?.ticket_statuses || [];

  const disable = async (s: any) => {
    if (!window.confirm(`Disable the “${s.label_agent}” status?`)) return;
    setPending(s.name);
    const r = await hdCall("post", `/helpdesk/ticket-statuses/${s.name}/disable`);
    setPending(null);
    if (r.ok) reload(); else window.alert(r.error || "Could not disable.");
  };

  return (
    <Section title="Ticket statuses" description="The workflow states a ticket moves through. Each belongs to a category (Open / Paused / Resolved)."
      action={<NewBtn label="New status" onClick={() => { setEdit(null); setOpen(true); }} />}>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="statuses" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No ticket statuses yet" hint="Create the states your tickets flow through." />
        : (
          <Table head={["Agent label", "Category", "Order", "Enabled", ""]}>
            {rows.map((s) => (
              <tr key={s.name} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{s.label_agent}</td>
                <td className="px-4 py-2.5"><Chip value={s.category} /></td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{s.order ?? "—"}</td>
                <td className="px-4 py-2.5">{yesNo(s.enabled)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => { setEdit(s); setOpen(true); }} className="grid h-7 w-7 place-items-center rounded-lg text-[#64748B] hover:bg-[#F6F7FB]"><Pencil size={14} /></button>
                    {s.enabled && <Btn busy={pending === s.name} onClick={() => disable(s)}>Disable</Btn>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <TicketStatusForm row={edit} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function TicketStatusForm({ row, onClose, onSaved }: { row: any | null; onClose: () => void; onSaved: () => void }) {
  const [labelAgent, setLabelAgent] = useState(row?.label_agent || "");
  const [labelCustomer, setLabelCustomer] = useState(row?.label_customer || "");
  const [category, setCategory] = useState(row?.category || "Open");
  const [order, setOrder] = useState<string>(row?.order != null ? String(row.order) : "");
  const [color, setColor] = useState(row?.color || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!labelAgent.trim()) { setErr("Agent label is required."); return; }
    setBusy(true); setErr(null);
    const body: any = { label_agent: labelAgent.trim(), category, label_customer: labelCustomer.trim() || null, color: color.trim() || null, order: order === "" ? null : Number(order) };
    const r = row ? await hdCall("put", `/helpdesk/ticket-statuses/${row.name}`, body) : await hdCall("post", "/helpdesk/ticket-statuses", body);
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Save failed.");
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={row ? "Edit ticket status" : "New ticket status"}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Save</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Agent label" required><Input value={labelAgent} onChange={(e) => setLabelAgent(e.target.value)} placeholder="e.g. In Progress" autoFocus /></Field>
        <Field label="Customer label"><Input value={labelCustomer} onChange={(e) => setLabelCustomer(e.target.value)} placeholder="What the customer sees" /></Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Category" required>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {["Open", "Paused", "Resolved"].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Order"><Input type="number" value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
        </div>
        <Field label="Colour" hint="Any CSS colour or token."><Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#2563EB" /></Field>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TICKET TYPES  (full CRUD — list carries id; system types can't be deleted)
// ════════════════════════════════════════════════════════════════════════════
export function TicketTypesSection() {
  const { data, loading, error, reload } = useHd<{ ticket_types: any[] }>("/helpdesk/ticket-types");
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const del = useConfirmDelete();
  const rows = data?.ticket_types || [];

  return (
    <Section title="Ticket types" description="Categories a ticket can be filed under (Question, Incident, Bug…)."
      action={<NewBtn label="New type" onClick={() => { setEdit(null); setOpen(true); }} />}>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="ticket types" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No ticket types yet" hint="Create the first type." />
        : (
          <Table head={["Type", "Description", "System", "Disabled", ""]}>
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{t.name}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.description || "—"}</td>
                <td className="px-4 py-2.5">{yesNo(!!t.is_system)}</td>
                <td className="px-4 py-2.5">{yesNo(!!t.disabled)}</td>
                <td className="px-4 py-2.5">
                  <RowActions onEdit={() => { setEdit(t); setOpen(true); }} deleting={del.pending === String(t.id)}
                    deleteDisabled={!!t.is_system} title={t.is_system ? "System types can't be deleted" : undefined}
                    onDelete={() => del.run(String(t.id), t.name, () => hdCall("delete", `/helpdesk/ticket-types/${t.id}`), reload)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <TicketTypeForm row={edit} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function TicketTypeForm({ row, onClose, onSaved }: { row: any | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name || "");
  const [description, setDescription] = useState(row?.description || "");
  const [disabled, setDisabled] = useState(!!row?.disabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr(null);
    const body = { name: name.trim(), description: description.trim() || null, disabled };
    const r = row ? await hdCall("put", `/helpdesk/ticket-types/${row.id}`, body) : await hdCall("post", "/helpdesk/ticket-types", body);
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Save failed.");
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={row ? "Edit ticket type" : "New ticket type"}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Save</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incident" autoFocus /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Toggle checked={disabled} onChange={setDisabled} label="Disabled" />
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PRIORITIES  (full CRUD — /helpdesk/priorities)
// ════════════════════════════════════════════════════════════════════════════
const PRIORITY_LEVELS = ["Urgent", "High", "Medium", "Low"];

export function PrioritiesSection() {
  const { data, loading, error, reload } = useHd<{ priorities: any[] }>("/helpdesk/priorities");
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const del = useConfirmDelete();
  const rows = data?.priorities || [];

  return (
    <Section title="Priorities" description="The urgency levels tickets can carry."
      action={<NewBtn label="New priority" onClick={() => { setEdit(null); setOpen(true); }} />}>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="priorities" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No priorities yet" hint="Create the urgency levels tickets can carry." />
        : (
          <Table head={["Priority", "Level", "Description", "Disabled", ""]}>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{p.name}</td>
                <td className="px-4 py-2.5"><Chip value={p.level} /></td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{p.description || "—"}</td>
                <td className="px-4 py-2.5">{yesNo(!!p.disabled)}</td>
                <td className="px-4 py-2.5">
                  <RowActions onEdit={() => { setEdit(p); setOpen(true); }} deleting={del.pending === String(p.id)}
                    onDelete={() => del.run(String(p.id), p.name, () => hdCall("delete", `/helpdesk/priorities/${p.id}`), reload)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <PriorityForm row={edit} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function PriorityForm({ row, onClose, onSaved }: { row: any | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name || "");
  const [level, setLevel] = useState(row?.level || "Medium");
  const [description, setDescription] = useState(row?.description || "");
  const [disabled, setDisabled] = useState(!!row?.disabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr(null);
    const body = { name: name.trim(), level, description: description.trim() || null, disabled };
    const r = row ? await hdCall("put", `/helpdesk/priorities/${row.id}`, body) : await hdCall("post", "/helpdesk/priorities", body);
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Save failed.");
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={row ? "Edit priority" : "New priority"}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Save</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. High" autoFocus /></Field>
        <Field label="Level" required>
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            {PRIORITY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Toggle checked={disabled} onChange={setDisabled} label="Disabled" />
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TICKET TEMPLATES / FORMS  (full CRUD + fields)
// ════════════════════════════════════════════════════════════════════════════
const HD_TICKET_FIELDS = [
  "subject", "raised_by", "priority", "ticket_type", "agent_group", "description",
  "customer", "contact", "status", "resolution_details", "feedback",
];

export function TemplatesSection() {
  const { data, loading, error, reload } = useHd<{ ticket_templates: any[] }>("/helpdesk/ticket-templates");
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const del = useConfirmDelete();
  const rows = data?.ticket_templates || [];

  return (
    <Section title="Ticket templates / forms" description="How the ticket form is composed — a template's fields define what agents fill in."
      action={<NewBtn label="New template" onClick={() => { setEdit(null); setOpen(true); }} />}>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="templates" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No templates yet" hint="Create a form template." />
        : (
          <Table head={["Template", "Fields", "About", ""]}>
            {rows.map((t) => (
              <tr key={t.name} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{t.template_name}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{(t.fields || []).length}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{t.about || "—"}</td>
                <td className="px-4 py-2.5">
                  <RowActions onEdit={() => { setEdit(t); setOpen(true); }} deleting={del.pending === t.name}
                    deleteDisabled={t.template_name === "Default"} title={t.template_name === "Default" ? "The Default template can't be deleted" : undefined}
                    onDelete={() => del.run(t.name, t.template_name, () => hdCall("delete", `/helpdesk/ticket-templates/${t.name}`), reload)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <TemplateForm row={edit} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function TemplateForm({ row, onClose, onSaved }: { row: any | null; onClose: () => void; onSaved: () => void }) {
  const [templateName, setTemplateName] = useState(row?.template_name || "");
  const [about, setAbout] = useState(row?.about || "");
  const [fields, setFields] = useState<any[]>(row?.fields ? row.fields.map((f: any) => ({ ...f })) : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addField = () => setFields([...fields, { fieldname: "subject", required: false, visible_to: "Everyone" }]);
  const setField = (i: number, patch: any) => setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const rmField = (i: number) => setFields(fields.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!templateName.trim()) { setErr("Template name is required."); return; }
    setBusy(true); setErr(null);
    const body = { template_name: templateName.trim(), about: about.trim() || null, fields };
    const r = row ? await hdCall("put", `/helpdesk/ticket-templates/${row.name}`, body) : await hdCall("post", "/helpdesk/ticket-templates", body);
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Save failed.");
  };

  return (
    <Modal open wide onClose={() => !busy && onClose()} title={row ? "Edit template" : "New template"}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Save</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Template name" required><Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} autoFocus /></Field>
        <Field label="About"><Textarea value={about} onChange={(e) => setAbout(e.target.value)} /></Field>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-[#475569]">Form fields</span>
            <Btn onClick={addField}>Add field</Btn>
          </div>
          {fields.length === 0 ? <p className="text-[12px] text-[#94A3B8]">No fields — the template uses the default form.</p> : (
            <div className="flex flex-col gap-2">
              {fields.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#EEF1F5] bg-[#FAFBFD] p-2">
                  <Select value={f.fieldname} onChange={(e) => setField(i, { fieldname: e.target.value })} className="max-w-[180px]">
                    {HD_TICKET_FIELDS.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
                  </Select>
                  <Select value={f.visible_to || "Everyone"} onChange={(e) => setField(i, { visible_to: e.target.value })} className="max-w-[140px]">
                    {["Everyone", "Agents"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                  <Toggle checked={!!f.required} onChange={(v) => setField(i, { required: v })} label="Required" />
                  <button onClick={() => rmField(i)} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEEDBACK OPTIONS  (full CRUD)
// ════════════════════════════════════════════════════════════════════════════
const RATINGS = [0.2, 0.4, 0.6, 0.8, 1.0];
export function FeedbackSection() {
  const { data, loading, error, reload } = useHd<{ feedback_options: any[] }>("/helpdesk/feedback-options");
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const del = useConfirmDelete();
  const rows = data?.feedback_options || [];

  return (
    <Section title="Feedback options" description="The rating choices customers pick from when they rate a resolved ticket."
      action={<NewBtn label="New option" onClick={() => { setEdit(null); setOpen(true); }} />}>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="feedback options" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No feedback options yet" hint="Add the rating choices." />
        : (
          <Table head={["Label", "Rating", "Disabled", ""]}>
            {rows.map((o) => (
              <tr key={o.name} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{o.label || "—"}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{o.rating}</td>
                <td className="px-4 py-2.5">{yesNo(!!o.disabled)}</td>
                <td className="px-4 py-2.5">
                  <RowActions onEdit={() => { setEdit(o); setOpen(true); }} deleting={del.pending === o.name}
                    onDelete={() => del.run(o.name, o.label || String(o.rating), () => hdCall("delete", `/helpdesk/feedback-options/${o.name}`), reload)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <FeedbackForm row={edit} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function FeedbackForm({ row, onClose, onSaved }: { row: any | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(row?.label || "");
  const [rating, setRating] = useState<string>(row?.rating != null ? String(row.rating) : "1");
  const [disabled, setDisabled] = useState(!!row?.disabled);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setErr(null);
    const body = { label: label.trim() || null, rating: Number(rating), disabled };
    const r = row ? await hdCall("put", `/helpdesk/feedback-options/${row.name}`, body) : await hdCall("post", "/helpdesk/feedback-options", body);
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Save failed.");
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={row ? "Edit feedback option" : "New feedback option"}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Save</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Very satisfied" autoFocus /></Field>
        <Field label="Rating" required>
          <Select value={rating} onChange={(e) => setRating(e.target.value)}>
            {RATINGS.map((r) => <option key={r} value={r}>{r} ({Math.round(r * 5)}/5)</option>)}
          </Select>
        </Field>
        <Toggle checked={disabled} onChange={setDisabled} label="Disabled" />
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SLA POLICIES & BUSINESS HOURS  (list policies + create; holiday lists CRUD)
// ════════════════════════════════════════════════════════════════════════════
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function SlaSection() {
  const { data, loading, error, reload } = useHd<{ slas: any[] }>("/helpdesk/sla");
  const holidays = useHd<{ holiday_lists: any[] }>("/helpdesk/holiday-lists");
  const priorities = useHd<{ priorities: any[] }>("/helpdesk/priorities");
  const [open, setOpen] = useState(false);
  const slas = data?.slas || [];

  // The /helpdesk/priorities catalogue is the source for the SLA priority pickers.
  const priorityMap = (priorities.data?.priorities || []).map((p) => ({ id: p.id, label: p.name }));

  return (
    <Section title="SLA policies & business hours" description="Response/resolution targets per priority, the working days they're measured against, and holiday lists."
      action={<NewBtn label="New SLA policy" onClick={() => setOpen(true)} disabled={priorityMap.length === 0} />}>
      {error && <ErrorBanner msg={error} />}
      {priorityMap.length === 0 && (
        <Note>Create at least one <b>Priority</b> first — an SLA policy sets a target for each priority to track.</Note>
      )}

      {loading ? <Loading what="SLA policies" />
        : slas.length === 0 ? <Empty icon={Pencil} title="No SLA policies yet" hint="Define response and resolution targets." />
        : (
          <Table head={["Policy", "Default", "Priorities", "Working days", "Holiday list", "Enabled"]}>
            {slas.map((s) => (
              <tr key={s.name} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{s.service_level}</td>
                <td className="px-4 py-2.5">{yesNo(!!s.default_sla)}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{(s.priorities || []).length}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{(s.service_days || []).length}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{s.holiday_list || "—"}</td>
                <td className="px-4 py-2.5">{yesNo(!!s.enabled)}</td>
              </tr>
            ))}
          </Table>
        )}

      {open && <SlaForm priorities={priorityMap} holidayLists={holidays.data?.holiday_lists || []} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}

      <div className="mt-6">
        <HolidayListsSection />
      </div>
    </Section>
  );
}

function SlaForm({ priorities, holidayLists, onClose, onSaved }: { priorities: { id: number; label: string }[]; holidayLists: any[]; onClose: () => void; onSaved: () => void }) {
  const [serviceLevel, setServiceLevel] = useState("");
  const [defaultSla, setDefaultSla] = useState(false);
  const [applyResolution, setApplyResolution] = useState(true);
  const [holidayListId, setHolidayListId] = useState("");
  const [rows, setRows] = useState(priorities.map((p, i) => ({ priority_id: p.id, label: p.label, default_priority: i === 0, response_h: "4", resolution_h: "24" })));
  const [days, setDays] = useState(WEEKDAYS.slice(0, 5).map((d) => ({ workday: d, on: true, start: "09:00", end: "17:00" })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!serviceLevel.trim()) { setErr("Policy name is required."); return; }
    setBusy(true); setErr(null);
    const body = {
      service_level: serviceLevel.trim(),
      default_sla: defaultSla,
      apply_sla_for_resolution: applyResolution,
      holiday_list_id: holidayListId ? Number(holidayListId) : null,
      priorities: rows.map((r) => ({
        priority_id: r.priority_id,
        default_priority: r.default_priority,
        response_time: Math.round(Number(r.response_h) * 3600),
        resolution_time: applyResolution ? Math.round(Number(r.resolution_h) * 3600) : null,
      })),
      service_days: days.filter((d) => d.on).map((d) => ({ workday: d.workday, start_time: d.start, end_time: d.end })),
    };
    const r = await hdCall("post", "/helpdesk/sla", body);
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Create failed.");
  };

  return (
    <Modal open wide onClose={() => !busy && onClose()} title="New SLA policy"
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Create policy</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Policy name" required><Input value={serviceLevel} onChange={(e) => setServiceLevel(e.target.value)} placeholder="e.g. Standard" autoFocus /></Field>
        <div className="flex flex-wrap gap-5">
          <Toggle checked={defaultSla} onChange={setDefaultSla} label="Default policy" />
          <Toggle checked={applyResolution} onChange={setApplyResolution} label="Track resolution time" />
        </div>

        <div>
          <span className="mb-2 block text-[11.5px] font-semibold text-[#475569]">Targets per priority (hours)</span>
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={r.priority_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#EEF1F5] bg-[#FAFBFD] p-2">
                <span className="w-24 text-[12.5px] font-medium text-[#334155]">{r.label}</span>
                <label className="flex items-center gap-1 text-[12px] text-[#64748B]">Response
                  <Input type="number" value={r.response_h} onChange={(e) => setRows(rows.map((x, idx) => idx === i ? { ...x, response_h: e.target.value } : x))} className="w-20" /></label>
                {applyResolution && (
                  <label className="flex items-center gap-1 text-[12px] text-[#64748B]">Resolution
                    <Input type="number" value={r.resolution_h} onChange={(e) => setRows(rows.map((x, idx) => idx === i ? { ...x, resolution_h: e.target.value } : x))} className="w-20" /></label>
                )}
                <label className="ml-auto flex items-center gap-1 text-[12px] text-[#64748B]">
                  <input type="radio" name="defpri" checked={r.default_priority} onChange={() => setRows(rows.map((x, idx) => ({ ...x, default_priority: idx === i })))} /> Default
                </label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-2 block text-[11.5px] font-semibold text-[#475569]">Service (working) days</span>
          <div className="flex flex-col gap-1.5">
            {days.map((d, i) => (
              <div key={d.workday} className="flex items-center gap-2 text-[12.5px]">
                <label className="flex w-32 items-center gap-2">
                  <input type="checkbox" checked={d.on} onChange={(e) => setDays(days.map((x, idx) => idx === i ? { ...x, on: e.target.checked } : x))} />
                  {d.workday}
                </label>
                <Input type="time" value={d.start} disabled={!d.on} onChange={(e) => setDays(days.map((x, idx) => idx === i ? { ...x, start: e.target.value } : x))} className="w-28" />
                <span className="text-[#94A3B8]">–</span>
                <Input type="time" value={d.end} disabled={!d.on} onChange={(e) => setDays(days.map((x, idx) => idx === i ? { ...x, end: e.target.value } : x))} className="w-28" />
              </div>
            ))}
          </div>
        </div>

        <Field label="Holiday list">
          <Select value={holidayListId} onChange={(e) => setHolidayListId(e.target.value)}>
            <option value="">— None —</option>
            {holidayLists.map((h) => <option key={h.name} value={h.name}>{h.holiday_list_name}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function HolidayListsSection() {
  const { data, loading, error, reload } = useHd<{ holiday_lists: any[] }>("/helpdesk/holiday-lists");
  const [open, setOpen] = useState(false);
  const del = useConfirmDelete();
  const rows = data?.holiday_lists || [];

  return (
    <Section title="Holiday lists" description="Non-working dates that pause SLA clocks."
      action={<NewBtn label="New holiday list" onClick={() => setOpen(true)} />}>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="holiday lists" />
        : rows.length === 0 ? <Empty icon={Pencil} title="No holiday lists yet" hint="Create one to attach to an SLA policy." />
        : (
          <Table head={["Name", "From", "To", "Weekly off", "Holidays", ""]}>
            {rows.map((h) => (
              <tr key={h.name} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{h.holiday_list_name}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{h.from_date || "—"}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{h.to_date || "—"}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{h.weekly_off || "—"}</td>
                <td className="px-4 py-2.5 text-[12.5px] text-[#475569]">{h.total_holidays ?? (h.holidays || []).length}</td>
                <td className="px-4 py-2.5">
                  <RowActions deleting={del.pending === h.name}
                    onDelete={() => del.run(h.name, h.holiday_list_name, () => hdCall("delete", `/helpdesk/holiday-lists/${h.name}`), reload)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      {open && <HolidayListForm onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Section>
  );
}

function HolidayListForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [weeklyOff, setWeeklyOff] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr(null);
    const r = await hdCall("post", "/helpdesk/holiday-lists", {
      holiday_list_name: name.trim(), from_date: fromDate || null, to_date: toDate || null, weekly_off: weeklyOff || null, holidays: [],
    });
    setBusy(false);
    r.ok ? onSaved() : setErr(r.error || "Create failed.");
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title="New holiday list"
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" onClick={save} busy={busy}>Create</Btn></>}>
      <FormError msg={err} />
      <div className="flex flex-col gap-3.5">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026 Public Holidays" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="From date"><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
          <Field label="To date"><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
        </div>
        <Field label="Weekly off day" hint="Generate recurring weekly offs from the policy's Business hours later.">
          <Select value={weeklyOff} onChange={(e) => setWeeklyOff(e.target.value)}>
            <option value="">— None —</option>
            {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// GENERAL / BRANDING  (consume existing /helpdesk/settings read + write)
// ════════════════════════════════════════════════════════════════════════════
export function GeneralSection() {
  const { data, loading, error, reload } = useHd<any>("/helpdesk/settings");
  const statuses = useHd<{ ticket_statuses: any[] }>("/helpdesk/ticket-statuses");
  const agentStatuses = useHd<{ agent_statuses: any[] }>("/helpdesk/agent-statuses");
  const [draft, setDraft] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const s = draft ?? data ?? {};
  const set = (patch: any) => setDraft({ ...s, ...patch });

  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    const r = await hdCall("post", "/helpdesk/settings", {
      brand_name: s.brand_name ?? null,
      prefer_knowledge_base: !!s.prefer_knowledge_base,
      is_feedback_mandatory: !!s.is_feedback_mandatory,
      restrict_tickets_by_agent_group: !!s.restrict_tickets_by_agent_group,
      assign_within_team: !!s.assign_within_team,
      allow_anyone_to_create_tickets: !!s.allow_anyone_to_create_tickets,
      default_ticket_status_id: s.default_ticket_status_id ? Number(s.default_ticket_status_id) : null,
      default_agent_status_id: s.default_agent_status_id ? Number(s.default_agent_status_id) : null,
    });
    setBusy(false);
    if (r.ok) { setMsg("Settings saved."); setDraft(null); reload(); } else setErr(r.error || "Save failed.");
  };

  return (
    <Section title="General" description="Branding, intake rules and the defaults new tickets and agents start from."
      action={<Btn variant="primary" busy={busy} onClick={save}>Save changes</Btn>}>
      {error && <ErrorBanner msg={error} />}
      <FormError msg={err} />
      {msg && <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">{msg}</div>}
      {loading ? <Loading what="settings" /> : (
        <div className="flex max-w-xl flex-col gap-4 rounded-xl border border-[#E2E5EC] bg-white p-4">
          <Field label="Brand name"><Input value={s.brand_name || ""} onChange={(e) => set({ brand_name: e.target.value })} placeholder="Your Help Desk name" /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Default ticket status">
              <Select value={s.default_ticket_status_id || ""} onChange={(e) => set({ default_ticket_status_id: e.target.value })}>
                <option value="">— None —</option>
                {(statuses.data?.ticket_statuses || []).map((t) => <option key={t.name} value={t.name}>{t.label_agent}</option>)}
              </Select>
            </Field>
            <Field label="Default agent status">
              <Select value={s.default_agent_status_id || ""} onChange={(e) => set({ default_agent_status_id: e.target.value })}>
                <option value="">— None —</option>
                {(agentStatuses.data?.agent_statuses || []).map((a) => <option key={a.name} value={a.name}>{a.agent_status}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex flex-col gap-2.5 border-t border-[#EEF1F5] pt-3">
            <Toggle checked={!!s.allow_anyone_to_create_tickets} onChange={(v) => set({ allow_anyone_to_create_tickets: v })} label="Allow anyone to create tickets" />
            <Toggle checked={!!s.is_feedback_mandatory} onChange={(v) => set({ is_feedback_mandatory: v })} label="Feedback mandatory on close" />
            <Toggle checked={!!s.restrict_tickets_by_agent_group} onChange={(v) => set({ restrict_tickets_by_agent_group: v })} label="Restrict tickets by team" />
            <Toggle checked={!!s.assign_within_team} onChange={(v) => set({ assign_within_team: v })} label="Assign within team only" />
            <Toggle checked={!!s.prefer_knowledge_base} onChange={(v) => set({ prefer_knowledge_base: v })} label="Prefer knowledge base" />
          </div>
        </div>
      )}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EMAIL  (consume existing /helpdesk/settings/email read + write)
// ════════════════════════════════════════════════════════════════════════════
const _EMAIL_FLAGS: [string, string][] = [
  ["send_acknowledgement_email", "Send an acknowledgement email when a ticket is created"],
  ["enable_reply_email_to_agent", "Notify the assigned agent by email when a reply is added"],
  ["enable_reply_email_via_agent", "Let agents reply to a ticket straight from their email"],
  ["enable_email_ticket_feedback", "Email a feedback request when a ticket is resolved"],
  ["instantly_send_email", "Send emails immediately instead of queueing them"],
  ["skip_email_workflow", "Turn the email workflow off entirely"],
];
const _EMAIL_TEMPLATES: [string, string, string][] = [
  ["acknowledgement_email_content", "Acknowledgement email", "Sent to the requester when their ticket is created."],
  ["reply_email_to_agent_content", "Reply notification to agent", "Sent to the assigned agent when a new reply lands."],
  ["reply_via_agent_email_content", "Agent reply email", "The email a requester receives when an agent replies."],
  ["feedback_email_content", "Feedback request email", "Sent after a ticket is resolved to collect feedback."],
];

export function EmailSection() {
  const { data, loading, error, reload } = useHd<any>("/helpdesk/settings/email");
  const [draft, setDraft] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // draft holds a flat {flag/column: value} overlay; fall back to the fetched row.
  const flags = data?.flags ?? {};
  const templates = data?.templates ?? {};
  const val = (k: string) => (draft && k in draft ? draft[k] : flags[k] ?? templates[k]?.content ?? "");
  const set = (patch: any) => setDraft({ ...(draft ?? {}), ...patch });

  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    const payload: any = {};
    for (const [k] of _EMAIL_FLAGS) payload[k] = !!val(k);
    payload.send_email_feedback_on_status_id = flags.send_email_feedback_on_status_id ?? null; // round-trip, not edited here
    for (const [col] of _EMAIL_TEMPLATES) payload[col] = val(col) || null;
    const r = await hdCall("post", "/helpdesk/settings/email", payload);
    setBusy(false);
    if (r.ok) { setMsg("Email settings saved."); setDraft(null); reload(); } else setErr(r.error || "Save failed.");
  };

  return (
    <Section title="Email" description="How the Help Desk emails requesters and agents, and the wording it uses."
      action={<Btn variant="primary" busy={busy} onClick={save}>Save changes</Btn>}>
      {error && <ErrorBanner msg={error} />}
      <FormError msg={err} />
      {msg && <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">{msg}</div>}
      {loading ? <Loading what="email settings" /> : (
        <div className="flex max-w-2xl flex-col gap-4">
          <Note>Delivery needs an outbound mail (SMTP) account configured for this workspace. Until one is, these choices are saved but no mail is sent.</Note>
          <div className="flex flex-col gap-2.5 rounded-xl border border-[#E2E5EC] bg-white p-4">
            {_EMAIL_FLAGS.map(([k, label]) => (
              <Toggle key={k} checked={!!val(k)} onChange={(v) => set({ [k]: v })} label={label} />
            ))}
          </div>
          <div className="flex flex-col gap-4 rounded-xl border border-[#E2E5EC] bg-white p-4">
            {_EMAIL_TEMPLATES.map(([col, label, hint]) => (
              <Field key={col} label={label} hint={hint}>
                <Textarea rows={4} value={val(col) || ""} onChange={(e) => set({ [col]: e.target.value })}
                  placeholder={templates[col]?.default || "Leave blank to use the built-in default wording."} />
              </Field>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
