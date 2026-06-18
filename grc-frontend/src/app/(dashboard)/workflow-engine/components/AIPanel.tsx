'use client';

import { AlertCircle, CheckCircle, Loader2, Play, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { AISuggestion } from './types';

type Props = {
  onClose: () => void;
  aiPrompt: string;
  aiGenerating: boolean;
  aiSuggestions: AISuggestion[];
  optimizationTips: string[];
  onPromptChange: (v: string) => void;
  onGenerate: () => void;
  onOptimize: () => void;
  onUseSuggestion: (suggestion: AISuggestion) => void;
  hasSelectedWorkflow: boolean;
};

type Tab = 'create' | 'suggestions' | 'optimize';

export function AIPanel({
  onClose,
  aiPrompt,
  aiGenerating,
  aiSuggestions,
  optimizationTips,
  onPromptChange,
  onGenerate,
  onOptimize,
  onUseSuggestion,
  hasSelectedWorkflow,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('create');
  const canGenerate = !!aiPrompt.trim();

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canGenerate && !aiGenerating) {
      e.preventDefault();
      onGenerate();
    }
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'create', label: 'Create', icon: <Sparkles size={12} /> },
    { key: 'suggestions', label: 'Suggestions', icon: <Zap size={12} /> },
    { key: 'optimize', label: 'Optimize', icon: <RefreshCw size={12} /> },
  ];

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-white border-l border-purple-200 shadow-xl z-20 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-purple-600" />
          <span className="text-sm font-bold text-purple-900">AI Assistant</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-purple-100 text-purple-400 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-semibold transition-colors ${
              activeTab === tab.key
                ? 'text-purple-700 border-b-2 border-purple-600 bg-purple-50'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'create' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">
              Describe your workflow in plain English and AI will generate the full diagram.
            </p>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  Describe your workflow
                </label>
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={aiGenerating || !canGenerate}
                  className="inline-flex items-center gap-1 rounded-md border border-purple-300 bg-purple-50 px-2 py-1 text-[10px] font-semibold text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50"
                >
                  {aiGenerating ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  Run
                </button>
              </div>
              <textarea
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none h-28 bg-gray-50"
                placeholder="e.g., When a new vulnerability is detected with critical severity, assign it to the security team, wait for acknowledgment approval, then escalate to management if not resolved in 48 hours"
                value={aiPrompt}
                onChange={(e) => onPromptChange(e.target.value)}
                onKeyDown={handlePromptKeyDown}
              />
            </div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={aiGenerating || !canGenerate}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white text-xs font-bold py-2.5 rounded-lg transition-all disabled:opacity-50"
            >
              {aiGenerating ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles size={13} />
                  Generate Workflow
                </>
              )}
            </button>
            <div className="text-[9px] text-gray-400 text-center">
              The generated workflow will load into the canvas
            </div>

            {/* Example prompts */}
            <div className="border-t border-gray-100 pt-3">
              <div className="text-[10px] font-semibold text-gray-500 mb-2 uppercase tracking-wider">
                Example prompts
              </div>
              {[
                'Quarterly risk review with CISO approval and board reporting',
                'New employee access provisioning with manager and IT approval',
                'Policy review cycle with legal review and distribution',
                'When evidence expires, notify the compliance team and escalate if not uploaded within 7 days',
                'Vendor risk assessment with security review, legal sign-off, and onboarding approval',
                'Incident response workflow with triage, containment, root cause analysis, and post-mortem',
              ].map((example) => (
                <button
                  key={example}
                  onClick={() => onPromptChange(example)}
                  className="block w-full text-left text-[10px] text-purple-600 hover:text-purple-800 py-1.5 px-2 rounded hover:bg-purple-50 transition-colors"
                >
                  &quot;{example}&quot;
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'suggestions' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">
              Based on your active frameworks, here are workflows you should have:
            </p>
            {aiSuggestions.length === 0 && (
              <div className="text-center py-6 text-xs text-gray-400">
                <Zap size={24} className="mx-auto mb-2 text-gray-200" />
                No suggestions yet. They load automatically based on your frameworks.
              </div>
            )}
            {aiSuggestions.map((s, idx) => (
              <div
                key={idx}
                className="border border-gray-200 rounded-lg p-3 bg-white hover:border-purple-300 transition-colors"
              >
                <div className="flex items-start gap-2 mb-1.5">
                  {s.already_exists ? (
                    <CheckCircle size={13} className="text-green-500 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle size={13} className="text-orange-500 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-gray-800">{s.title}</div>
                    {s.framework_ref && (
                      <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                        {s.framework_ref}
                      </span>
                    )}
                  </div>
                  {s.already_exists ? (
                    <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                      Exists
                    </span>
                  ) : (
                    <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                      Missing
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 mb-2">{s.description}</p>
                {!s.already_exists && (
                  <button
                    onClick={() => onUseSuggestion(s)}
                    className="w-full text-[10px] font-semibold bg-purple-600 hover:bg-purple-700 text-white py-1.5 rounded-md transition-colors"
                  >
                    Create Workflow
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'optimize' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">
              AI will analyze the selected workflow and suggest optimizations.
            </p>
            <button
              onClick={onOptimize}
              disabled={aiGenerating || !hasSelectedWorkflow}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white text-xs font-bold py-2.5 rounded-lg transition-all disabled:opacity-50"
            >
              {aiGenerating ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <RefreshCw size={13} />
                  Analyze & Optimize
                </>
              )}
            </button>
            {!hasSelectedWorkflow && (
              <p className="text-[10px] text-gray-400 text-center">
                Select a saved workflow first
              </p>
            )}
            {optimizationTips.length > 0 && (
              <div className="space-y-2 mt-2">
                <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
                  Suggestions
                </div>
                {optimizationTips.map((tip, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg"
                  >
                    <AlertCircle size={12} className="text-amber-600 mt-0.5 shrink-0" />
                    <span className="text-[10px] text-amber-800">{tip}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
