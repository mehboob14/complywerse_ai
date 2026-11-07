// Saving the Add / Edit form, once for the register and the risk page: create or update, then link the chosen assets, then keep the AI Assist suggestion with a new risk. The risk is saved
// first and what follows cannot undo it: the assets that could not be linked are returned, never swallowed, so the caller says so.
import { aiRecommendationsApi, ermApi } from '@/lib/api';
import type { RiskModalSubmitPayload } from './RiskForm';

export interface SavedRisk { id: number | undefined; created: boolean; failedAssets: number[] }

export async function saveRiskForm(editingId: number | null, { riskData, linkedAssetIds, aiSuggestions }: RiskModalSubmitPayload): Promise<SavedRisk> {
  const saved = editingId ? await ermApi.risks.update(editingId, riskData) : await ermApi.risks.create(riskData);
  const id = (saved?.data as { id?: number } | undefined)?.id ?? editingId ?? undefined;
  const failedAssets: number[] = [];
  if (id) {
    for (const assetId of linkedAssetIds ?? []) {
      try { await ermApi.risks.linkAsset(id, { asset_id: assetId }); } catch { failedAssets.push(assetId); }
    }
  }
  if (!editingId && id && aiSuggestions) {
    aiRecommendationsApi.save({
      module: 'erm_risk_suggestion', recommendation_type: 'ai_suggestion', entity_type: 'risk', entity_id: String(id),
      title: `AI suggestion · ${(riskData as { title?: string }).title || 'risk'}`, output: aiSuggestions as unknown as Record<string, unknown>,
    }).catch(() => { /* the suggestion is a convenience; the risk is saved */ });
  }
  return { id, created: !editingId, failedAssets };
}

/** The sentence for assets that could not be linked after the risk was saved ("" when all were). */
export const assetsNotLinked = (failed: readonly number[]): string =>
  failed.length === 0 ? '' : `${failed.length} linked ${failed.length === 1 ? 'asset' : 'assets'} could not be linked. Open the risk and link ${failed.length === 1 ? 'it' : 'them'} again.`;
