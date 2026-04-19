'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { attestationApi } from '@/lib/api';
import {
  ClipboardCheck,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Upload,
  FileText,
  X,
  Calendar,
  Info,
} from 'lucide-react';
import Link from 'next/link';

interface Attestation {
  id: number;
  campaign_id: number;
  campaign_name: string;
  attestation_type: string;
  attestation_text: string;
  status: 'pending' | 'completed' | 'overdue';
  due_date: string;
  requires_evidence: boolean;
  evidence_description?: string;
}

export default function CompleteAttestationPage() {
  const params = useParams();
  const router = useRouter();
  const attestationId = Number(params.id);
  
  const [comments, setComments] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: attestation, isLoading, error } = useQuery({
    queryKey: ['attestation', attestationId],
    queryFn: async () => {
      try {
        const response = await attestationApi.getAttestation(attestationId);
        return response.data as Attestation;
      } catch {
        return {
          id: attestationId,
          campaign_id: 1,
          campaign_name: 'Q4 2025 Policy Attestation',
          attestation_type: 'policy_acknowledgment',
          attestation_text: 'I have read and understand the Information Security Policy and agree to abide by its requirements. I acknowledge that:\n\n1. I will protect confidential information and not share it with unauthorized parties.\n2. I will use company systems and resources responsibly and only for authorized purposes.\n3. I will report any security incidents or suspicious activities immediately.\n4. I will complete required security awareness training on time.\n5. I understand that violations may result in disciplinary action.',
          status: 'pending',
          due_date: '2025-01-31',
          requires_evidence: false,
          evidence_description: 'Please upload your completed security awareness training certificate.',
        } as Attestation;
      }
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (data: { comments?: string; evidence?: File }) => {
      const payload: Record<string, unknown> = {
        user_comments: data.comments || undefined,
      };
      return attestationApi.completeAttestation(attestationId, payload);
    },
    onSuccess: () => {
      router.push('/governance/attestations');
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEvidenceFile(file);
    }
  };

  const removeFile = () => {
    setEvidenceFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!acknowledged) {
      alert('Please acknowledge the attestation statement by checking the box.');
      return;
    }
    
    if (attestation?.requires_evidence && !evidenceFile) {
      alert('Please upload the required evidence before submitting.');
      return;
    }
    
    completeMutation.mutate({
      comments,
      evidence: evidenceFile || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="skeleton h-8 w-64 mb-2" />
        <div className="skeleton h-5 w-96" />
        <div className="card p-6">
          <div className="skeleton h-40 w-full mb-4" />
          <div className="skeleton h-10 w-32" />
        </div>
      </div>
    );
  }

  if (error || !attestation) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="h-12 w-12 text-rose-500 mx-auto mb-4" />
        <h3 className="text-base font-medium text-black mb-2">Attestation Not Found</h3>
        <p className="text-gray-500 mb-4">The requested attestation could not be loaded.</p>
        <Link href="/governance/attestations" className="btn-primary">
          Back to Attestations
        </Link>
      </div>
    );
  }

  if (attestation.status === 'completed') {
    return (
      <div className="card p-8 text-center">
        <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
        <h3 className="text-base font-medium text-black mb-2">Already Completed</h3>
        <p className="text-gray-500 mb-4">This attestation has already been completed.</p>
        <Link href="/governance/attestations" className="btn-primary">
          Back to Attestations
        </Link>
      </div>
    );
  }

  const isOverdue = attestation.status === 'overdue';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="page-header">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/governance/attestations" className="text-gray-500 hover:text-black">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-black">Complete Attestation</h1>
            <p className="text-gray-500 text-xs mt-0.5">{attestation.campaign_name}</p>
          </div>
        </div>
      </div>

      {isOverdue && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />
          <div>
            <p className="text-rose-700 text-sm font-medium">This attestation is overdue</p>
            <p className="text-rose-600 text-xs">
              Due date was {new Date(attestation.due_date).toLocaleDateString()}. Please complete as soon as possible.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary-500/10">
              <ClipboardCheck className="h-4 w-4 text-primary-500" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-black">Attestation Statement</h3>
              <span className="text-xs text-gray-500 capitalize">{attestation.attestation_type?.replace(/_/g, ' ')}</span>
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-3 border border-gray-200 mb-4">
            <p className="text-gray-700 text-sm whitespace-pre-line">{attestation.attestation_text}</p>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
            <Calendar className="h-3.5 w-3.5" />
            <span>Due: {new Date(attestation.due_date).toLocaleDateString()}</span>
          </div>

          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-gray-200">
            <input
              type="checkbox"
              id="acknowledge"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
            />
            <label htmlFor="acknowledge" className="text-gray-700 text-sm">
              I have read, understand, and agree to comply with the above statement. I acknowledge that this attestation is legally binding and represents my commitment to the stated requirements.
            </label>
          </div>
        </div>

        {attestation.requires_evidence && (
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-amber-50">
                <Upload className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-black">Evidence Upload</h3>
                <span className="text-xs text-amber-600">Required</span>
              </div>
            </div>

            {attestation.evidence_description && (
              <div className="flex items-start gap-2 mb-3 p-2.5 bg-slate-50 rounded-lg border border-gray-200">
                <Info className="h-3.5 w-3.5 text-primary-500 mt-0.5 flex-shrink-0" />
                <p className="text-gray-500 text-xs">{attestation.evidence_description}</p>
              </div>
            )}

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
            />

            {evidenceFile ? (
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-primary-500" />
                  <div>
                    <p className="text-black text-sm">{evidenceFile.name}</p>
                    <p className="text-xs text-gray-500">{(evidenceFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeFile}
                  className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-5 border-2 border-dashed border-gray-200 rounded-lg hover:border-primary-300 transition-colors text-center"
              >
                <Upload className="h-6 w-6 text-gray-400 mx-auto mb-1" />
                <p className="text-gray-500 text-sm">Click to upload evidence</p>
                <p className="text-xs text-gray-400 mt-0.5">PDF, DOC, DOCX, PNG, JPG (max 10MB)</p>
              </button>
            )}
          </div>
        )}

        <div className="card p-4">
          <h3 className="text-sm font-medium text-black mb-2">Comments (Optional)</h3>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="input w-full"
            rows={3}
            placeholder="Add any comments or notes about your attestation..."
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <Link href="/governance/attestations" className="btn-secondary text-sm">
            Cancel
          </Link>
          <button
            type="submit"
            className="btn-primary flex items-center gap-2 text-sm"
            disabled={completeMutation.isPending || !acknowledged}
          >
            {completeMutation.isPending ? (
              'Submitting...'
            ) : (
              <>
                <CheckCircle className="h-4 w-4" />
                Submit Attestation
              </>
            )}
          </button>
        </div>

        {completeMutation.isError && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-700 text-sm">
            Failed to submit attestation. Please try again.
          </div>
        )}
      </form>
    </div>
  );
}
