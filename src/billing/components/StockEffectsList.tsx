import type { BillStockEffect } from '../types.ts';

export interface StockEffectsListProps {
  effects: BillStockEffect[];
  heading?: string;
}

export function StockEffectsList({
  effects,
  heading = 'Confirmed stock changes',
}: StockEffectsListProps) {
  if (effects.length === 0) {
    return null;
  }

  return (
    <div className="catalog-added-list">
      <span className="catalog-added-list__title">{heading}</span>
      <ul aria-label={heading}>
        {effects.map((effect, idx) => {
          const deltaLabel =
            effect.quantityDelta > 0 ? `+${effect.quantityDelta}` : String(effect.quantityDelta);
          const conditionText =
            effect.stockCondition === 'SELLABLE'
              ? effect.quantityDelta > 0
                ? 'added back to SELLABLE stock'
                : 'deducted from SELLABLE stock'
              : 'recorded as NON_SELLABLE (kept out of sellable stock)';
          return (
            <li key={`${effect.batchId}-${effect.movementType}-${idx}`}>
              <code>{effect.skuCode}</code>: <strong>{deltaLabel}</strong> ({conditionText}) ·
              Resulting batch quantity: <strong>{effect.resultingBatchQuantity}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
