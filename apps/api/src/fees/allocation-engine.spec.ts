import {
  allocate,
  applyPayment,
  outstanding,
  isInDefault,
  totalOutstanding,
  PartyShareInput,
  ShareLedger,
} from './allocation-engine';

const claimant: PartyShareInput = { partyId: 'c', side: 'CLAIMANT' };
const respondent: PartyShareInput = { partyId: 'r', side: 'RESPONDENT' };

function sum(shares: { shareAmount: number }[]): number {
  return Math.round(shares.reduce((a, s) => a + s.shareAmount, 0) * 100) / 100;
}

describe('allocation-engine', () => {
  describe('allocate — methods', () => {
    it('splits equally among two parties', () => {
      const r = allocate(10000, 'EQUAL', [claimant, respondent]);
      expect(r.map((s) => s.shareAmount)).toEqual([5000, 5000]);
      expect(sum(r)).toBe(10000);
    });

    it('splits equally among three parties with exact remainder handling', () => {
      const parties = [claimant, respondent, { partyId: 'r2', side: 'RESPONDENT' as const }];
      const r = allocate(100, 'BY_PARTY_COUNT', parties);
      // 100.00 / 3 → 33.34 + 33.33 + 33.33, summing exactly to 100.00
      expect(sum(r)).toBe(100);
      expect(r.map((s) => s.shareAmount).sort()).toEqual([33.33, 33.33, 33.34]);
    });

    it('allocates by claim value proportionally', () => {
      const r = allocate(9000, 'BY_CLAIM_VALUE', [
        { partyId: 'a', side: 'CLAIMANT', claimValue: 200000 },
        { partyId: 'b', side: 'CLAIMANT', claimValue: 100000 },
      ]);
      expect(r.find((s) => s.partyId === 'a')?.shareAmount).toBe(6000);
      expect(r.find((s) => s.partyId === 'b')?.shareAmount).toBe(3000);
      expect(sum(r)).toBe(9000);
    });

    it('allocates by claim and counterclaim by relief advanced', () => {
      const r = allocate(12000, 'BY_CLAIM_AND_COUNTERCLAIM', [
        { partyId: 'c', side: 'CLAIMANT', claimValue: 300000 }, // claim
        { partyId: 'r', side: 'RESPONDENT', claimValue: 100000 }, // counterclaim
      ]);
      expect(r.find((s) => s.partyId === 'c')?.shareAmount).toBe(9000);
      expect(r.find((s) => s.partyId === 'r')?.shareAmount).toBe(3000);
      expect(sum(r)).toBe(12000);
    });

    it('allocates by explicit agreement weights', () => {
      const r = allocate(10000, 'BY_AGREEMENT', [
        { partyId: 'c', side: 'CLAIMANT', weight: 70 },
        { partyId: 'r', side: 'RESPONDENT', weight: 30 },
      ]);
      expect(r.find((s) => s.partyId === 'c')?.shareAmount).toBe(7000);
      expect(r.find((s) => s.partyId === 'r')?.shareAmount).toBe(3000);
    });

    it('falls back to an even split when claim values are all zero', () => {
      const r = allocate(10000, 'BY_CLAIM_VALUE', [claimant, respondent]);
      expect(r.map((s) => s.shareAmount)).toEqual([5000, 5000]);
    });

    it('rejects a negative total', () => {
      expect(() => allocate(-1, 'EQUAL', [claimant])).toThrow();
    });
  });

  describe('payment application + default', () => {
    const share: ShareLedger = { partyId: 'r', shareAmount: 5000, paidAmount: 0 };

    it('reduces outstanding on partial payment', () => {
      const after = applyPayment(share, { partyId: 'r', paidByPartyId: 'r', amount: 2000, substitute: false });
      expect(outstanding(after)).toBe(3000);
    });

    it('clears outstanding on full payment', () => {
      const after = applyPayment(share, { partyId: 'r', paidByPartyId: 'r', amount: 5000, substitute: false });
      expect(outstanding(after)).toBe(0);
    });

    it('supports substitute payment by another party (outstanding still clears)', () => {
      const after = applyPayment(share, { partyId: 'r', paidByPartyId: 'c', amount: 5000, substitute: true });
      expect(outstanding(after)).toBe(0);
    });

    it('flags default only after the due date with an outstanding balance', () => {
      const due = new Date('2026-06-01T00:00:00Z');
      const before = new Date('2026-05-20T00:00:00Z');
      const afterDue = new Date('2026-06-10T00:00:00Z');
      expect(isInDefault(share, due, before)).toBe(false);
      expect(isInDefault(share, due, afterDue)).toBe(true);
      const paid = applyPayment(share, { partyId: 'r', paidByPartyId: 'r', amount: 5000, substitute: false });
      expect(isInDefault(paid, due, afterDue)).toBe(false);
    });

    it('reports the total outstanding another party could cover', () => {
      const shares: ShareLedger[] = [
        { partyId: 'c', shareAmount: 5000, paidAmount: 5000 },
        { partyId: 'r', shareAmount: 5000, paidAmount: 1000 },
      ];
      expect(totalOutstanding(shares)).toBe(4000);
    });
  });
});
