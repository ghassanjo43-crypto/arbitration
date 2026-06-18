import { describe, it, expect } from 'vitest';
import { ARBITRATION_FIELD_LABELS, ArbitrationField, ORDERED_STAGES, CaseStage } from '@gaap/shared';

describe('shared domain enums', () => {
  it('labels every arbitration field', () => {
    for (const f of Object.values(ArbitrationField)) {
      expect(ARBITRATION_FIELD_LABELS[f]).toBeTruthy();
    }
  });

  it('orders stages starting at DRAFT', () => {
    expect(ORDERED_STAGES[0]).toBe(CaseStage.DRAFT);
    expect(ORDERED_STAGES).toContain(CaseStage.AWARD_ISSUED);
  });
});
