import type { SkuListItem } from '../catalog/types.ts';
import type { InventoryApi } from '../inventory/inventoryApi.ts';
import type { BarcodeLookupResult, EligibleBatch } from '../inventory/types.ts';

export interface ResolvedSkuItem {
  skuId: string;
  skuCode: string;
  productName: string;
  size: string | null;
  defaultSellingPrice: string;
  batchId: string | null;
  printedMrp: string | null;
  internalBarcode: string | null;
  batchLockedByTag: boolean;
  requiresBatchSelection: boolean;
  eligibleBatches: EligibleBatch[];
}

export async function resolveSkuSelectionForBilling(
  inventory: InventoryApi,
  sku: SkuListItem,
): Promise<ResolvedSkuItem> {
  let sellableBatches: EligibleBatch[] = [];
  try {
    const invPage = await inventory.listInventory({
      skuId: sku.skuId,
      page: 0,
      size: 5,
    });
    const matched = invPage.items.find((entry) => entry.skuId === sku.skuId);
    if (matched) {
      sellableBatches = matched.batches
        .filter((batch) => batch.sellableQuantity > 0)
        .map((batch) => ({
          batchId: batch.batchId,
          receivedDate: batch.receivedDate,
          printedMrp: batch.printedMrp,
          sellableQuantity: batch.sellableQuantity,
          internalBarcode: batch.internalBarcode,
        }));
    }
  } catch {
    // Non-blocking fallback: backend correction endpoints also check batch ambiguity.
  }

  const distinctMrps = new Set(sellableBatches.map((batch) => batch.printedMrp ?? null));
  const requiresBatchSelection = sellableBatches.length > 0 && distinctMrps.size > 1;

  return {
    skuId: sku.skuId,
    skuCode: sku.skuCode,
    productName: sku.productName,
    size: sku.size,
    defaultSellingPrice: sku.defaultSellingPrice,
    batchId: null,
    printedMrp: sellableBatches.length === 1 ? sellableBatches[0].printedMrp : null,
    internalBarcode: null,
    batchLockedByTag: false,
    requiresBatchSelection,
    eligibleBatches: sellableBatches,
  };
}

export function mapBarcodeLookupToResolvedItem(result: BarcodeLookupResult): ResolvedSkuItem {
  if (result.mappingType === 'INTERNAL' && result.batchId) {
    return {
      skuId: result.skuId,
      skuCode: result.code,
      productName: result.name,
      size: result.size,
      defaultSellingPrice: result.defaultSellingPrice,
      batchId: result.batchId,
      printedMrp: result.printedMrp,
      internalBarcode: result.code,
      batchLockedByTag: true,
      requiresBatchSelection: false,
      eligibleBatches: [
        {
          batchId: result.batchId,
          receivedDate: '',
          printedMrp: result.printedMrp,
          sellableQuantity: result.batchSellableQuantity ?? result.sellableQuantity,
          internalBarcode: result.code,
        },
      ],
    };
  }

  return {
    skuId: result.skuId,
    skuCode: result.code,
    productName: result.name,
    size: result.size,
    defaultSellingPrice: result.defaultSellingPrice,
    batchId: result.batchId,
    printedMrp: result.printedMrp,
    internalBarcode: null,
    batchLockedByTag: false,
    requiresBatchSelection: result.requiresBatchSelection && result.eligibleBatches.length > 0,
    eligibleBatches: result.eligibleBatches,
  };
}
