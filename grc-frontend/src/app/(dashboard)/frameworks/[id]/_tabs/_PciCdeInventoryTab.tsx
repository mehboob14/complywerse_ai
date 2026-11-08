'use client';

// PCI DSS "Cardholder Data Inventory": the asset-backed inventory of cardholder-data environments. The screen is _registers/AssetInventory.
import AssetInventory from '../_registers/AssetInventory';

export default function PciCdeInventoryTab({ frameworkName }: { journeyId?: number; frameworkName?: string; tenantUsers?: unknown }) {
  return <AssetInventory kind="cde" frameworkName={frameworkName} />;
}
