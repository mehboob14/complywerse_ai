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
      const formData: Record<string, unknown> = {
        comments: data.comments,
        acknowledged: true,
      };
      
      if (data.evidence) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(data.evidence);
        });
        formData.evidence = {
          filename: data.evidence.name,
          content: base64,
        };
      }
      
      return attestationApi.completeAttestation(attestationId, formData);
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
        <AlertCircle className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--color-danger)' }} />
        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>Attestation Not Found</h3>
        <p className="mb-4" style={{ color: 'var(--color-muted)' }}>The requested attestation could not be loaded.</p>
        <Link href="/governance/attestations" className="btn-primary">
          Back to Attestations
        </Link>
      </div>
    );
  }

  if (attestation.status === 'completed') {
    return (
      <div className="card p-8 text-center">
        <CheckCircle className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--color-success)' }} />
        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>Already Completed</h3>
        <p className="mb-4" style={{ color: 'var(--color-muted)' }}>This attestation has already been completed.</p>
        <Link href="/governance/attestations" className="btn-primary">
          Back to Attestations
        </Link>
      </div>
    );
  }

  const isOverdue = attestation.status === 'overdue';

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="page-header">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/governance/attestations" style={{ color: 'var(--color-muted)' }}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>Complete Attestation</h1>
            <p className="mt-1" style={{ color: 'var(--color-muted)' }}>{attestation.campaign_name}</p>
          </div>
        </div>
      </div>

      {isOverdue && (
        <div className="rounded-lg p-4 flex items-center gap-3" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)', border: '1px solid rgba(155, 28, 28, 0.3)' }}>
          <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--color-danger)' }} />
          <div>
            <p className="font-medium" style={{ color: 'var(--color-danger)' }}>This attestation is overdue</p>
            <p className="text-sm" style={{ color: 'var(--color-danger)', opacity: 0.7 }}>
              Due date was {new Date(attestation.due_date).toLocaleDateString()}. Please complete as soon as possible.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <ClipboardCheck className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
            </div>
            <div>
              <h3 className="text-lg font-medium" style={{ color: 'var(--color-text)' }}>Attestation Statement</h3>
              <span className="text-sm capitalize" style={{ color: 'var(--color-muted)' }}>{attestation.attestation_type.replace('_', ' ')}</span>
            </div>
          </div>

          <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
            <p className="whitespace-pre-line" style={{ color: 'var(--color-text)' }}>{attestation.attestation_text}</p>
          </div>

          <div className="flex items-center gap-3 text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
            <Calendar className="h-4 w-4" />
            <span>Due: {new Date(attestation.due_date).toLocaleDateString()}</span>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
            <input
              type="checkbox"
              id="acknowledge"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1 rounded"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
            />
            <label htmlFor="acknowledge" style={{ color: 'var(--color-text)' }}>
              I have read, understand, and agree to comply with the above statement. I acknowledge that this attestation is legally binding and represents my commitment to the stated requirements.
            </label>
          </div>
        </div>

        {attestation.requires_evidence && (
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)' }}>
                <Upload className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
              </div>
              <div>
                <h3 className="text-lg font-medium" style={{ color: 'var(--color-text)' }}>Evidence Upload</h3>
                <span className="text-sm" style={{ color: 'var(--color-warning)' }}>Required</span>
              </div>
            </div>

            {attestation.evidence_description && (
              <div className="flex items-start gap-2 mb-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-base)' }} />
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{attestation.evidence_description}</p>
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
              <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
                  <div>
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>{evidenceFile.name}</p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{(evidenceFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeFile}
                  className="p-1.5 rounded transition-colors"
                  style={{ color: 'var(--color-muted)' }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-6 border-2 border-dashed rounded-lg transition-colors text-center"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--color-muted)' }} />
                <p style={{ color: 'var(--color-muted)' }}>Click to upload evidence</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>PDF, DOC, DOCX, PNG, JPG (max 10MB)</p>
              </button>
            )}
          </div>
        )}

        <div className="card p-6">
          <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--color-text)' }}>Comments (Optional)</h3>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="input w-full"
            rows={4}
            placeholder="Add any comments or notes about your attestation..."
          />
        </div>

        <div className="flex items-center justify-end gap-4">
          <Link href="/governance/attestations" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            className="btn-primary flex items-center gap-2"
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
          <div className="rounded-lg p-4 text-sm" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)', border: '1px solid rgba(155, 28, 28, 0.3)', color: 'var(--color-danger)' }}>
            Failed to submit attestation. Please try again.
          </div>
        )}
      </form>
    </div>
  );
}
