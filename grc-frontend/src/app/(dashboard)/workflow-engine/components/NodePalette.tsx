'use client';

import { ChevronDown, ChevronRight, Plus, X, Search, Zap } from 'lucide-react';
import { useState, useCallback } from 'react';
import { Tooltip } from './Tooltip';
import { NODE_GROUP_COLORS, PALETTE_DESCRIPTIONS, PaletteItem, isTriggerEligibleAction } from './types';

type PaletteGroup = {
  key: string;
  label: string;
  items: PaletteItem[];
};

type Props = {
  palette: PaletteItem[];
  onDragStart: (event: React.DragEvent, item: PaletteItem) => void;
  onAddNode: (item: PaletteItem) => void;
  locked?: boolean;
};

const GROUP_ORDER = ['triggers', 'actions', 'platform_functions', 'conditions', 'approvals', 'timers', 'control'];
const GROUP_LABELS: Record<string, string> = {
  triggers: 'Triggers',
  actions: 'Actions',
  platform_functions: 'Platform Functions',
  conditions: 'Conditions',
  approvals: 'Approvals',
  timers: 'Timers',
  control: 'Control',
};

const GROUP_HEADER_COLORS: Record<string, string> = {
  triggers: 'text-blue-700 bg-blue-50 border-blue-200',
  actions: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  platform_functions: 'text-indigo-700 bg-indigo-50 border-indigo-200',
  conditions: 'text-amber-700 bg-amber-50 border-amber-200',
  approvals: 'text-violet-700 bg-violet-50 border-violet-200',
  timers: 'text-cyan-700 bg-cyan-50 border-cyan-200',
  control: 'text-gray-600 bg-gray-50 border-gray-200',
};

const GROUP_NODE_PILL: Record<string, string> = {
  triggers: 'border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 text-blue-800',
  actions: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 text-emerald-800',
  platform_functions: 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-400 text-indigo-800',
  conditions: 'border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 text-amber-800',
  approvals: 'border-violet-200 bg-violet-50 hover:bg-violet-100 hover:border-violet-400 text-violet-800',
  timers: 'border-cyan-200 bg-cyan-50 hover:bg-cyan-100 hover:border-cyan-400 text-cyan-800',
  control: 'border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-400 text-gray-700',
};

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function NodePalette({ palette, onDragStart, onAddNode, locked = false }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [moduleCollapsed, setModuleCollapsed] = useState<Record<string, boolean>>({});
  const [subgroupCollapsed, setSubgroupCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const q = search.toLowerCase().trim();

  const groups: PaletteGroup[] = GROUP_ORDER.map((groupKey) => ({
    key: groupKey,
    label: GROUP_LABELS[groupKey] || groupKey,
    items: palette.filter(
      (item) =>
        item.group === groupKey &&
        (q === '' ||
          item.label.toLowerCase().includes(q) ||
          (item.submodule || '').toLowerCase().includes(q) ||
          (item.module || '').toLowerCase().includes(q) ||
          (item.description || '').toLowerCase().includes(q))
    ),
  })).filter((g) => g.items.length > 0);

  const totalResults = groups.reduce((sum, g) => sum + g.items.length, 0);

  const toggleGroup = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleModule = (module: string) => setModuleCollapsed((prev) => ({ ...prev, [module]: !prev[module] }));
  const toggleSubgroup = (key: string) => setSubgroupCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleAddNode = useCallback((item: PaletteItem) => {
    if (locked) return;
    onAddNode(item);
    setJustAdded(item.key);
    setTimeout(() => setJustAdded(null), 700);
  }, [locked, onAddNode]);

  const renderNodeItem = (item: PaletteItem, pillColor: string) => {
    const isFlashing = justAdded === item.key;
    // Platform Function CRUD nodes (and dedicated trigger nodes) can act as the
    // workflow trigger when placed first after Start. Surface this with a ⚡.
    const triggerEligible = item.group === 'triggers' || isTriggerEligibleAction(item.key);
    const baseTooltip = locked
      ? 'Workflow creation is locked. Contact support.'
      : (PALETTE_DESCRIPTIONS[item.key] || item.description || `Click to add "${item.label}" to canvas`);
    // Universal eligibility tooltip — both dedicated trigger nodes and
    // platform-function CRUD nodes can be the first node after Start.
    const triggerTooltipSuffix = item.group === 'triggers'
      ? '\n\n⚡ Dedicated workflow trigger — place directly after Start.'
      : '\n\n⚡ Can be used as a workflow trigger when placed directly after Start.';
    const tooltip = !locked && triggerEligible
      ? `${baseTooltip}${triggerTooltipSuffix}`
      : baseTooltip;
    return (
      <Tooltip
        key={item.key}
        content={tooltip}
      >
        <div
          draggable={!locked}
          onDragStart={locked ? undefined : (e) => onDragStart(e, item)}
          onClick={() => handleAddNode(item)}
          className={`
            flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs select-none transition-all duration-150
            ${locked
              ? 'cursor-not-allowed opacity-60 ' + pillColor
              : isFlashing
                ? 'scale-95 bg-green-100 border-green-400 text-green-800 cursor-pointer'
                : 'cursor-pointer active:scale-95 ' + pillColor
            }
          `}
        >
          <Plus
            size={10}
            className={`shrink-0 ${isFlashing ? 'text-green-600' : 'opacity-50'}`}
          />
          <span className="truncate font-medium flex-1">
            {highlightMatch(item.label, q)}
          </span>
          {triggerEligible && (
            <Zap size={10} className="shrink-0 text-amber-500" aria-label="Trigger-eligible" />
          )}
        </div>
      </Tooltip>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="px-3 py-3 border-b border-gray-200">
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
          Node Palette
        </h3>

        {/* Search input with clear button */}
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-md pl-6 pr-6 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 bg-gray-50 transition-shadow"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-0.5 rounded"
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* Result count when searching */}
        {q && (
          <p className="mt-1.5 text-[10px] text-gray-500">
            {totalResults === 0
              ? 'No results found'
              : `${totalResults} node${totalResults !== 1 ? 's' : ''} match`}
          </p>
        )}
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => {
          const isOpen = q !== '' || !collapsed[group.key];
          const headerColor = GROUP_HEADER_COLORS[group.key] || '';
          const pillColor = GROUP_NODE_PILL[group.key] || '';

          return (
            <div key={group.key} className="border-b border-gray-100">
              {/* Group header */}
              <button
                onClick={() => toggleGroup(group.key)}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold border-b ${headerColor} transition-colors`}
              >
                <span className="flex items-center gap-1.5">
                  {group.label}
                  <span className="text-[9px] font-normal opacity-60">({group.items.length})</span>
                </span>
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>

              {/* Group items */}
              {isOpen && (
                <div className="p-2 space-y-1">
                  {group.key !== 'platform_functions' && group.key !== 'actions' && group.items.map((item) =>
                    renderNodeItem(item, pillColor)
                  )}

                  {group.key === 'actions' && group.items.map((item) =>
                    renderNodeItem(item, pillColor)
                  )}

                  {group.key === 'platform_functions' && (() => {
                    const PF_MODULE_ORDER = ['Compliance', 'Control Library', 'Evidence', 'Framework Upload', 'Governance', 'Risk Management', 'Vulnerability Management', 'Chatbot', 'General'];
                    const GOVERNANCE_SUBMODULE_ORDER = [
                      'Documents', 'Attestations', 'Regulatory Changes', 'Regulatory Feeds', 'Committees',
                    ];
                    const RISK_MANAGEMENT_SUBMODULE_ORDER = ['Risk Framework', 'Risk Assessments', 'Risk Register', 'Appetite', 'Mitigation Actions', 'Internal Controls', 'KRIs', 'Incidents', 'Reviews', 'Dependencies', 'RCSA', 'Vendor Risk', 'Advanced Analytics'];
                    const COMPLIANCE_SUBMODULE_ORDER = ['Frameworks', 'Controls', 'Evidence Requirements', 'Statements', 'Assessments', 'Evidence', 'Control Library'];
                    const VULNERABILITY_MANAGEMENT_SUBMODULE_ORDER = ['Vulnerabilities', 'Departments', 'Reports', 'SLA Config'];
                    const SUBMODULE_ORDER: Record<string, string[]> = {
                      'Governance': GOVERNANCE_SUBMODULE_ORDER,
                      'Risk Management': RISK_MANAGEMENT_SUBMODULE_ORDER,
                      'Compliance': COMPLIANCE_SUBMODULE_ORDER,
                      'Vulnerability Management': VULNERABILITY_MANAGEMENT_SUBMODULE_ORDER,
                    };

                    const sortSubgroups = (moduleName: string, pairs: [string, PaletteItem[]][]) => {
                      const order = SUBMODULE_ORDER[moduleName];
                      if (!order) return pairs;
                      return [...pairs].sort(([a], [b]) => {
                        const ai = order.indexOf(a);
                        const bi = order.indexOf(b);
                        if (ai !== -1 && bi !== -1) return ai - bi;
                        if (ai !== -1) return -1;
                        if (bi !== -1) return 1;
                        return a.localeCompare(b);
                      });
                    };

                    const modules = Array.from(
                      group.items.reduce((acc, item) => {
                        const mod = item.module || 'General';
                        if (mod === 'Internal') return acc;
                        if (!acc.has(mod)) acc.set(mod, [] as PaletteItem[]);
                        acc.get(mod)!.push(item);
                        return acc;
                      }, new Map<string, PaletteItem[]>())
                    ).sort(([a], [b]) => {
                      const ai = PF_MODULE_ORDER.indexOf(a);
                      const bi = PF_MODULE_ORDER.indexOf(b);
                      if (ai !== -1 && bi !== -1) return ai - bi;
                      if (ai !== -1) return -1;
                      if (bi !== -1) return 1;
                      return a.localeCompare(b);
                    });

                    return modules.map(([moduleName, moduleItems]) => {
                      const isModuleOpen = q !== '' || !moduleCollapsed[moduleName];
                      const subgroups = sortSubgroups(moduleName, Array.from(
                        moduleItems.reduce((acc, item) => {
                          const subgroup = item.submodule || 'General';
                          if (!acc.has(subgroup)) acc.set(subgroup, [] as PaletteItem[]);
                          acc.get(subgroup)!.push(item);
                          return acc;
                        }, new Map<string, PaletteItem[]>())
                      ));

                      return (
                        <div key={moduleName} className="border border-indigo-100 rounded-md overflow-hidden">
                          <button
                            onClick={() => toggleModule(moduleName)}
                            className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                          >
                            <span className="truncate">{moduleName}</span>
                            <span className="flex items-center gap-1">
                              <span className="text-[9px] font-normal opacity-60">({moduleItems.length})</span>
                              {isModuleOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                            </span>
                          </button>

                          {isModuleOpen && (
                            <div className="p-1.5 space-y-1 bg-white">
                              {subgroups.map(([subgroupName, subgroupItems]) => {
                                const subgroupKey = `${moduleName}::${subgroupName}`;
                                const isSubgroupOpen = q !== '' || !subgroupCollapsed[subgroupKey];

                                return (
                                  <div key={subgroupKey} className="border border-indigo-50 rounded-md overflow-hidden">
                                    <button
                                      onClick={() => toggleSubgroup(subgroupKey)}
                                      className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                                    >
                                      <span className="truncate">{subgroupName}</span>
                                      <span className="flex items-center gap-1">
                                        <span className="text-[9px] font-normal opacity-50">({subgroupItems.length})</span>
                                        {isSubgroupOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                      </span>
                                    </button>

                                    {isSubgroupOpen && (
                                      <div className="p-1 space-y-1 bg-white">
                                        {subgroupItems.map((item) => renderNodeItem(item, pillColor))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          );
        })}

        {groups.length === 0 && (
          <div className="p-6 text-center">
            <Search size={20} className="mx-auto mb-2 text-gray-300" />
            <p className="text-xs text-gray-400">No nodes match</p>
            <p className="text-[10px] text-gray-300 mt-0.5">&quot;{search}&quot;</p>
          </div>
        )}
      </div>

      {/* Footer tip */}
      <div className="px-3 py-2 border-t border-gray-100 text-[9px] text-gray-400 text-center">
        Click to add · Drag to position
      </div>
    </div>
  );
}
