"use client";

/**
 * Help Desk — Settings hub. A single admin area (Frappe-style) with a left
 * section-nav and every entity's Create / Edit / Delete buttons. Deep-linkable
 * via ?tab=<key>. Each section is a self-contained component in _sections.tsx.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Settings, Building2, UserCog, CircleDot,
  ListChecks, Tag, Flag, FileText, Timer, Star, Mail,
} from "lucide-react";
import { PageHeader } from "../_ui";
import {
  GeneralSection, EmailSection, AgentsSection, AgentStatusesSection,
  DepartmentsSection, TicketTypesSection, TicketStatusesSection, PrioritiesSection,
  TemplatesSection, FeedbackSection, SlaSection,
} from "./_sections";

const TABS: { key: string; label: string; icon: any; render: () => JSX.Element }[] = [
  { key: "general", label: "General", icon: Settings, render: () => <GeneralSection /> },
  { key: "email", label: "Email", icon: Mail, render: () => <EmailSection /> },
  { key: "agents", label: "Agents", icon: UserCog, render: () => <AgentsSection /> },
  { key: "agent-statuses", label: "Agent statuses", icon: CircleDot, render: () => <AgentStatusesSection /> },
  { key: "departments", label: "Departments", icon: Building2, render: () => <DepartmentsSection /> },
  { key: "ticket-statuses", label: "Ticket statuses", icon: ListChecks, render: () => <TicketStatusesSection /> },
  { key: "ticket-types", label: "Ticket types", icon: Tag, render: () => <TicketTypesSection /> },
  { key: "priorities", label: "Priorities", icon: Flag, render: () => <PrioritiesSection /> },
  { key: "templates", label: "Templates / forms", icon: FileText, render: () => <TemplatesSection /> },
  { key: "sla", label: "SLA & business hours", icon: Timer, render: () => <SlaSection /> },
  { key: "feedback", label: "Feedback options", icon: Star, render: () => <FeedbackSection /> },
];

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("tab") || "departments";
  const [active, setActive] = useState(TABS.some((t) => t.key === initial) ? initial : "departments");

  const go = (key: string) => {
    setActive(key);
    router.replace(`/cyber-assurance/helpdesk/settings?tab=${key}`, { scroll: false });
  };
  const current = TABS.find((t) => t.key === active) || TABS[0];

  return (
    <div className="flex flex-col gap-4 text-[#0F172A]">
      <PageHeader icon={Settings} title="Help Desk settings" subtitle="Set up departments, agents, ticket config and SLAs. Teams and roles live in Administration." />
      <div className="flex flex-col gap-5 lg:flex-row">
        <nav className="flex shrink-0 flex-row flex-wrap gap-1 lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:w-56 lg:flex-col lg:self-start lg:overflow-y-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = t.key === active;
            return (
              <button key={t.key} onClick={() => go(t.key)}
                className={`inline-flex items-center gap-2 rounded-[9px] px-3 py-2 text-left text-[12.5px] font-semibold transition ${
                  on ? "bg-[#005B96]/10 text-[#005B96]" : "text-[#64748B] hover:bg-[#F6F7FB] hover:text-[#334155]"
                }`}>
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{current.render()}</div>
      </div>
    </div>
  );
}

export default function HelpDeskSettings() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-slate-400">Loading settings…</div>}>
      <SettingsInner />
    </Suspense>
  );
}
