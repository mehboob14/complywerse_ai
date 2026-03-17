'use client';

import {
  ChevronDown,
  Circle,
  ClipboardList,
  History,
  Loader2,
  Play,
  Plus,
  Save,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { WorkflowDefinition } from './types';

type Props = {
  definitions: WorkflowDefinition[];
  selectedId: number | null;
  selectedDefinition: WorkflowDefinition | undefined;
  name: string;
  isActive: boolean;
  saving: boolean;
  onSelectDefinition: (id: number | null) => void;
  onNameChange: (name: string) => void;
  onToggleActive: () => void;
  onSave: () => void;
  onTrigger: () => void;
  onDelete: () => void;
  onNewWorkflow: () => void;
  onShowVersions: () => void;
  onShowTemplates: () => void;
  onShowAI: () => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function TopToolbar({
  definitions,
  selectedId,
  selectedDefinition,
  name,
  isActive,
  saving,
  onSelectDefinition,
  onNameChange,
  onToggleActive,
  onSave,
  onTrigger,
  onDelete,
  onNewWorkflow,
  onShowVersions,
  onShowTemplates,
  onShowAI,
  onFitView,
  onZoomIn,
  onZoomOut,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 h-12 shrink-0">
      {/* Workflow selector */}
      <div className="flex items-center gap-1.5 min-w-0">
        <select
          className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[160px] truncate"
          value={selectedId ?? ''}
          onChange={(e) => onSelectDefinition(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— New Workflow —</option>
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          onClick={onNewWorkflow}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-colors"
          title="New workflow"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Workflow name input */}
      <input
        className="text-xs font-semibold border-0 outline-none bg-transparent min-w-[140px] max-w-[200px] text-gray-800 placeholder-gray-300"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Workflow name..."
      />

      {/* Active toggle */}
      <button
        onClick={onToggleActive}
        className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${
          isActive
            ? 'bg-green-50 border-green-300 text-green-700'
            : 'bg-gray-50 border-gray-200 text-gray-500'
        }`}
        title="Toggle active"
      >
        {isActive ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
        {isActive ? 'Active' : 'Inactive'}
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Version & Template buttons */}
      <button
        onClick={onShowTemplates}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
        title="Browse templates"
      >
        <ClipboardList size={13} />
        <span className="hidden sm:inline">Templates</span>
      </button>

      <button
        onClick={onShowVersions}
        disabled={!selectedId}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-40"
        title="Version history"
      >
        <History size={13} />
        <span className="hidden sm:inline">History</span>
      </button>

      {/* AI button */}
      <button
        onClick={onShowAI}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 font-semibold transition-colors"
        title="AI workflow assistant"
      >
        <Sparkles size={13} />
        <span className="hidden sm:inline">AI</span>
      </button>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Zoom controls */}
      <button
        onClick={onZoomOut}
        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-colors"
        title="Zoom out"
      >
        <ZoomOut size={13} />
      </button>
      <button
        onClick={onFitView}
        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-colors text-[9px] font-bold"
        title="Fit to screen"
      >
        <Circle size={13} />
      </button>
      <button
        onClick={onZoomIn}
        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-colors"
        title="Zoom in"
      >
        <ZoomIn size={13} />
      </button>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Action buttons */}
      {selectedId && (
        <>
          <button
            onClick={onTrigger}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-green-300 bg-green-50 hover:bg-green-100 text-green-700 font-semibold transition-colors"
            title="Test run this workflow"
          >
            <Play size={12} />
            <span className="hidden sm:inline">Test Run</span>
          </button>

          <button
            onClick={onDelete}
            className="p-1.5 rounded-md hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
            title="Delete workflow"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}

      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-60"
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        {selectedId ? 'Update' : 'Create'}
      </button>
    </div>
  );
}
