'use client';

// HIPAA "ePHI Inventory": the asset-backed inventory of electronic protected health information environments. The screen is _registers/AssetInventory.
import AssetInventory from '../_registers/AssetInventory';

export default function HipaaEphiInventoryTab({ frameworkName }: { journeyId?: number; frameworkName?: string; tenantUsers?: unknown }) {
  return <AssetInventory kind="ephi" frameworkName={frameworkName} />;
}
