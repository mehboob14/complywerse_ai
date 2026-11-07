"use client";

import { useMemo, useState } from "react";
import { Contact, Search } from "lucide-react";
import { Avatar, PageHeader, RefreshBtn, Table, Empty, ErrorBanner, Loading, useHd } from "../_ui";

const full = (c: any) => [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name || "";

export default function ContactsPage() {
  const { data, loading, error, reload } = useHd<any>("/helpdesk/contacts");
  const [q, setQ] = useState("");
  const contacts: any[] = Array.isArray(data?.contacts) ? data.contacts : [];
  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return contacts.filter((c) => !s || [full(c), c.email_id, c.phone, c.company_name].some((v) => (v || "").toLowerCase().includes(s)));
  }, [contacts, q]);

  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={Contact} title="Contacts" subtitle={`${contacts.length} contact${contacts.length === 1 ? "" : "s"}`}
        actions={<>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…"
              className="w-60 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-base)]" />
          </div>
          <RefreshBtn onClick={reload} loading={loading} />
        </>} />
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="contacts" /> : rows.length === 0 ? <Empty icon={Contact} title="No contacts found" hint={q ? "Try a different search." : undefined} /> : (
        <Table head={["Name", "Email", "Phone", "Company"]}>
          {rows.map((c) => (
            <tr key={c.name} className="hover:bg-slate-50">
              <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Avatar name={full(c)} size={32} /><span className="font-medium text-[var(--color-text)]">{full(c) || "—"}</span></div></td>
              <td className="px-4 py-2.5 text-slate-600">{c.email_id || "—"}</td>
              <td className="px-4 py-2.5 text-slate-600">{c.phone || "—"}</td>
              <td className="px-4 py-2.5 text-slate-600">{c.company_name || "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
