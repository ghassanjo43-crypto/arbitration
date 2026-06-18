import { FeeCalculatorService } from './fee-calculator.service';

describe('FeeCalculatorService', () => {
  const svc = new FeeCalculatorService();

  it('returns a filing fee even for a zero-value dispute', () => {
    const r = svc.calculate({ amountInDispute: 0 });
    expect(r.total).toBeGreaterThan(0);
    expect(r.lines.find((l) => l.category === 'FILING')?.amount).toBe(500);
  });

  it('scales the arbitrator fee with the number of arbitrators', () => {
    const sole = svc.calculate({ amountInDispute: 1_000_000, numberOfArbitrators: 1 });
    const panel = svc.calculate({ amountInDispute: 1_000_000, numberOfArbitrators: 3 });
    const soleArb = sole.lines.find((l) => l.category === 'ARBITRATOR')!.amount;
    const panelArb = panel.lines.find((l) => l.category === 'ARBITRATOR')!.amount;
    expect(panelArb).toBeCloseTo(soleArb * 3, 2);
  });

  it('adds an expedited surcharge when requested', () => {
    const normal = svc.calculate({ amountInDispute: 1_000_000 });
    const expedited = svc.calculate({ amountInDispute: 1_000_000, expedited: true });
    expect(expedited.total).toBeGreaterThan(normal.total);
    expect(expedited.lines.some((l) => /expedited/i.test(l.label))).toBe(true);
  });

  it('always includes the advisory-only disclaimer', () => {
    expect(svc.calculate({ amountInDispute: 5000 }).disclaimer).toMatch(/indicative/i);
  });
});
