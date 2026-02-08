'use client';

import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { certificationsApi } from '@/lib/api';
import { ControlImplementation, ImplementationEvidence } from '@/types';
import {
  X,
  Shield,
  Save,
  Check,
  CheckCircle2,
  Upload,
  FileText,
  Trash2,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Clock,
  AlertTriangle,
  ChevronDown,
  Loader2,
  Calendar,
  Link2
} from 'lucide-react';

interface ControlImplementationModalProps {
  isOpen: boolean;
  onClose: () => void;
  journeyId: number;
  control: ControlImplementation;
}

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started', color: 'bg-slate-500' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-500' },
  { value: 'implemented', label: 'Implemented', color: 'bg-blue-500' },
  { value: 'verified', label: 'Verified', color: 'bg-green-500' },
  { value: 'not_applicable', label: 'Not Applicable', color: 'bg-slate-400' },
];

export default function ControlImplementationModal({
  isOpen,
  onClose,
  journeyId,
  control,
}: ControlImplementationModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [status, setStatus] = useState(control.status);
  const [notes, setNotes] = useState(control.implementation_notes || '');
  const [priority, setPriority] = useState(control.priority);
  const [isApplicable, setIsApplicable] = useState(control.is_applicable);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const updateControlMutation = useMutation({
    mutationFn: (data: { status?: string; notes?: string; priority?: number; is_applicable?: boolean }) =>
      certificationsApi.updateControl(journeyId, control.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      queryClient.invalidateQueries({ queryKey: ['certification-progress', journeyId] });
    },
  });

  const uploadEvidenceMutation = useMutation({
    mutationFn: (formData: FormData) =>
      certificationsApi.uploadEvidence(journeyId, control.id, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
    },
  });

  const reviewEvidenceMutation = useMutation({
    mutationFn: ({ evidenceId, action, notes }: { evidenceId: number; action: string; notes?: string }) =>
      certificationsApi.reviewEvidence(journeyId, control.id, evidenceId, { action, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
    },
  });

  const handleSave = async () => {
    await updateControlMutation.mutateAsync({
      status,
      notes,
      priority,
      is_applicable: isApplicable,
    });
    onClose();
  };

  const handleMarkImplemented = async () => {
    await updateControlMutation.mutateAsync({ status: 'implemented' });
    setStatus('implemented');
  };

  const handleMarkVerified = async () => {
    await updateControlMutation.mutateAsync({ status: 'verified' });
    setStatus('verified');
  };

  const handleFileUpload = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        await uploadEvidenceMutation.mutateAsync(formData);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const getConfidenceColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50';
    if (score >= 40) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  const getReviewStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-green-50 text-green-700';
      case 'rejected': return 'bg-red-50 text-red-700';
      default: return 'bg-yellow-50 text-yellow-700';
    }
  };

  if (!isOpen) return null;

  const evidence = control.evidence_attachments || [];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-hidden bg-slate-50 shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary-50 p-2">
                <Shield className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {control.framework_control?.code}
                </h2>
                <p className="text-sm text-slate-600">Control Implementation</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-white">
                  {control.framework_control?.name}
                </h3>
                {control.framework_control?.statement && (
                  <p className="mt-2 text-sm text-slate-600">
                    {control.framework_control.statement}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Status</label>
                  <div className="relative">
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as typeof status)}
                      className="input appearance-none pr-10"
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="label">Priority</label>
                  <div className="relative">
                    <select
                      value={priority}
                      onChange={(e) => setPriority(parseInt(e.target.value))}
                      className="input appearance-none pr-10"
                    >
                      {[1, 2, 3, 4, 5].map((p) => (
                        <option key={p} value={p}>
                          Priority {p} {p === 1 ? '(Highest)' : p === 5 ? '(Lowest)' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="applicable"
                  checked={isApplicable}
                  onChange={(e) => setIsApplicable(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 bg-slate-700 text-primary-500 focus:ring-primary-500"
                />
                <label htmlFor="applicable" className="text-sm text-slate-300">
                  This control is applicable to our organization
                </label>
              </div>

              <div>
                <label className="label">Implementation Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="input resize-none"
                  placeholder="Document your implementation approach, decisions, and any relevant details..."
                />
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <label className="label mb-0">Evidence</label>
                  <span className="text-xs text-slate-500">{evidence.length} files</span>
                </div>

                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`mb-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                    isDragging
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-slate-300 hover:border-slate-500'
                  }`}
                >
                  {uploading ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
                      <span className="text-slate-600">Uploading...</span>
                    </div>
                  ) : (
                    <>
                      <Upload className="mx-auto h-8 w-8 text-slate-500" />
                      <p className="mt-2 text-sm text-slate-600">
                        Drag and drop files here, or{' '}
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-primary-600 hover:underline"
                        >
                          browse
                        </button>
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        PDF, images, documents up to 50MB
                      </p>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                  />
                </div>

                {evidence.length > 0 && (
                  <div className="space-y-3">
                    {evidence.map((ev: ImplementationEvidence) => (
                      <div
                        key={ev.id}
                        className="rounded-lg border border-slate-200 bg-white p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-slate-700 p-2">
                            <FileText className="h-5 w-5 text-slate-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium text-white">
                                {ev.file_name}
                              </p>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getReviewStatusBadge(ev.review_status)}`}>
                                {ev.review_status}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(ev.uploaded_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>

                        {ev.ai_confidence_score !== undefined && (
                          <div className="mt-3 rounded-lg bg-slate-50 p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-primary-600" />
                                <span className="text-sm font-medium text-slate-300">AI Assessment</span>
                              </div>
                              <span className={`rounded-full px-2 py-1 text-xs font-bold ${getConfidenceColor(ev.ai_confidence_score)}`}>
                                {ev.ai_confidence_score}% confidence
                              </span>
                            </div>
                            {ev.ai_assessment_notes && (
                              <p className="mt-2 text-sm text-slate-600">
                                {ev.ai_assessment_notes}
                              </p>
                            )}
                            {ev.ai_matched_controls && ev.ai_matched_controls.length > 0 && (
                              <div className="mt-2 flex items-center gap-2">
                                <Link2 className="h-3 w-3 text-slate-500" />
                                <span className="text-xs text-slate-500">
                                  May also satisfy: {ev.ai_matched_controls.length} other controls
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {ev.review_status === 'pending' && (
                          <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3">
                            <button
                              onClick={() => reviewEvidenceMutation.mutate({
                                evidenceId: ev.id,
                                action: 'approve'
                              })}
                              className="btn-primary flex-1 flex items-center justify-center gap-2 !py-2"
                            >
                              <ThumbsUp className="h-4 w-4" />
                              Approve
                            </button>
                            <button
                              onClick={() => reviewEvidenceMutation.mutate({
                                evidenceId: ev.id,
                                action: 'reject'
                              })}
                              className="btn-secondary flex-1 flex items-center justify-center gap-2 !py-2"
                            >
                              <ThumbsDown className="h-4 w-4" />
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {control.implementation_date && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Check className="h-4 w-4 text-blue-600" />
                  Implemented on {new Date(control.implementation_date).toLocaleDateString()}
                </div>
              )}

              {control.verified_date && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Verified on {new Date(control.verified_date).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex gap-2">
                {status !== 'implemented' && status !== 'verified' && (
                  <button
                    onClick={handleMarkImplemented}
                    disabled={updateControlMutation.isPending}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Check className="h-4 w-4" />
                    Mark Implemented
                  </button>
                )}
                {status === 'implemented' && (
                  <button
                    onClick={handleMarkVerified}
                    disabled={updateControlMutation.isPending}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Mark Verified
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={updateControlMutation.isPending}
                  className="btn-primary flex items-center gap-2"
                >
                  {updateControlMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
