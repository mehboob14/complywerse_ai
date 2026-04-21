'use client';

import { ChevronDown, ChevronRight, Grip } from 'lucide-react';
import { useState } from 'react';
import { NODE_GROUP_COLORS, PALETTE_DESCRIPTIONS, PaletteItem } from './types';

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
  triggers: 'border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800',
  actions: 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800',
  platform_functions: 'border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-800',
  conditions: 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800',
  approvals: 'border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-800',
  timers: 'border-cyan-300 bg-cyan-50 hover:bg-cyan-100 text-cyan-800',
  control: 'border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700',
};

export function NodePalette({ palette, onDragStart, onAddNode, locked = false }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [moduleCollapsed, setModuleCollapsed] = useState<Record<string, boolean>>({});
  const [subgroupCollapsed, setSubgroupCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  const groups: PaletteGroup[] = GROUP_ORDER.map((groupKey) => ({
    key: groupKey,
    label: GROUP_LABELS[groupKey] || groupKey,
    items: palette.filter(
      (item) =>
        item.group === groupKey &&
        (search === '' || item.label.toLowerCase().includes(search.toLowerCase()))
    ),
  })).filter((g) => g.items.length > 0);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleModule = (module: string) => {
    setModuleCollapsed((prev) => ({ ...prev, [module]: !prev[module] }));
  };

  const toggleSubgroup = (key: string) => {
    setSubgroupCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="px-3 py-3 border-b border-gray-200">
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
          Node Palette
        </h3>
        <input
          type="text"
          placeholder="Search nodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-gray-50"
        />
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => {
          const isOpen = !collapsed[group.key];
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
                {isOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </button>

              {/* Group items */}
              {isOpen && (
                <div className="p-2 space-y-1">
                  {group.key !== 'platform_functions' && group.items.map((item) => (
                    <div
                      key={item.key}
                      draggable={!locked}
                      onDragStart={locked ? undefined : (e) => onDragStart(e, item)}
                      onClick={locked ? undefined : () => onAddNode(item)}
                      title={locked ? 'Workflow creation is locked. Contact support.' : (PALETTE_DESCRIPTIONS[item.key] || item.description || item.label)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs select-none transition-colors ${locked ? 'cursor-not-allowed opacity-60 ' + pillColor : 'cursor-grab active:cursor-grabbing ' + pillColor}`}
                    >
                      <Grip size={10} className="opacity-40 shrink-0" />
                      <span className="truncate font-medium">{item.label}</span>
                      {locked && <span className="ml-auto text-[10px] opacity-50">🔒</span>}
                    </div>
                  ))}

                  {group.key === 'platform_functions' && (() => {
                    const modules = Array.from(
                      group.items.reduce((acc, item) => {
                        const mod = item.module || 'General';
                        if (!acc.has(mod)) acc.set(mod, [] as PaletteItem[]);
                        acc.get(mod)!.push(item);
                        return acc;
                      }, new Map<string, PaletteItem[]>())
                    );

                    return modules.map(([moduleName, moduleItems]) => {
                      const isModuleOpen = !moduleCollapsed[moduleName];
                      const subgroups = Array.from(
                        moduleItems.reduce((acc, item) => {
                          const subgroup = item.submodule || 'General';
                          if (!acc.has(subgroup)) acc.set(subgroup, [] as PaletteItem[]);
                          acc.get(subgroup)!.push(item);
                          return acc;
                        }, new Map<string, PaletteItem[]>())
                      );

                      return (
                        <div key={moduleName} className="border border-indigo-100 rounded-md overflow-hidden">
                          <button
                            onClick={() => toggleModule(moduleName)}
                            className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50"
                          >
                            <span className="truncate">{moduleName}</span>
                            {isModuleOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          </button>

                          {isModuleOpen && (
                            <div className="p-1.5 space-y-1 bg-white">
                              {subgroups.map(([subgroupName, subgroupItems]) => {
                                const subgroupKey = `${moduleName}::${subgroupName}`;
                                const isSubgroupOpen = !subgroupCollapsed[subgroupKey];

                                return (
                                  <div key={subgroupKey} className="border border-indigo-50 rounded-md overflow-hidden">
                                    <button
                                      onClick={() => toggleSubgroup(subgroupKey)}
                                      className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-medium text-indigo-600 bg-indigo-50"
                                    >
                                      <span className="truncate">{subgroupName}</span>
                                      {isSubgroupOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                    </button>

                                    {isSubgroupOpen && (
                                      <div className="p-1 space-y-1 bg-white">
                                        {subgroupItems.map((item) => (
                                          <div
                                            key={item.key}
                                            draggable={!locked}
                                            onDragStart={locked ? undefined : (e) => onDragStart(e, item)}
                                            onClick={locked ? undefined : () => onAddNode(item)}
                                            title={locked ? 'Workflow creation is locked. Contact support.' : item.label}
                                            className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs select-none transition-colors ${locked ? 'cursor-not-allowed opacity-60 ' + pillColor : 'cursor-grab active:cursor-grabbing ' + pillColor}`}
                                          >
                                            <Grip size={10} className="opacity-40 shrink-0" />
                                            <span className="truncate font-medium">{item.label}</span>
                                            {locked && <span className="ml-auto text-[10px] opacity-50">🔒</span>}
                                          </div>
                                        ))}
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
          <div className="p-4 text-center text-xs text-gray-400">No nodes match your search</div>
        )}
      </div>

      {/* Footer tip */}
      <div className="px-3 py-2 border-t border-gray-100 text-[9px] text-gray-400 text-center">
        Drag nodes onto the canvas
      </div>
    </div>
  );
}
