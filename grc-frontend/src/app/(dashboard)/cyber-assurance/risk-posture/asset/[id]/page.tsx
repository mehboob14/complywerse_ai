'use client';
export const dynamic = 'force-dynamic';

// Thin wrapper — the detail screens live in _redesign/AssetPostureDetail (handoff redesign).
import { useParams } from 'next/navigation';
import AssetPostureDetail from '../../_redesign/AssetPostureDetail';

export default function RiskPostureAssetPage() {
  const params = useParams<{ id: string }>();
  const assetId = params?.id ? Number(params.id) : 0;
  return <AssetPostureDetail assetId={assetId} />;
}
