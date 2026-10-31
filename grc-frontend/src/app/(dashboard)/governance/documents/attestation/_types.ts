// The shapes the Attestation page reads (what the server sends is modules/governance/routers/document_attestations._serialize_campaign / _serialize_ack).
import type { CampaignSortFields, CoverageSource } from './_logic';

export type Acknowledgment = {
  id: number;
  name: string;
  email: string;
  designation?: string | null;
  acknowledged_at?: string;
  has_signature?: boolean;
  esign_id?: number | null;
  esign_fingerprint?: string | null;
  signature_data_url?: string | null;
  signature_url?: string | null;
};

export type Campaign = CoverageSource & CampaignSortFields & {
  id: number;
  document_id: number;
  document_title?: string;
  name: string;
  message?: string;
  due_date?: string;
  status: string;
  public_token: string;
  public_url?: string;
  progress_label?: string | null;
  created_at?: string;
  acknowledgments?: Acknowledgment[];
  /** may change or close it: whoever may change its document (the server refuses the others) */
  can_manage?: boolean;
};

export type PublishedDoc = { id: number; title: string; status: string; current_version?: string };
