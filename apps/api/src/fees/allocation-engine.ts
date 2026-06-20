/**
 * Pure fee / deposit allocation engine.
 *
 * Splits a total deposit or fee among the parties according to the agreed
 * allocation method, and provides payment-application helpers (including
 * substitute payment by another party and default detection).
 *
 * All money is handled in integer minor units (cents) internally to avoid
 * floating-point drift; inputs/outputs are major-unit numbers rounded to 2 dp.
 * The sum of allocated shares always equals the original total exactly — any
 * rounding remainder is assigned deterministically to the largest share.
 */

export type AllocationMethod =
  | 'EQUAL'
  | 'BY_PARTY_COUNT'
  | 'BY_CLAIM_VALUE'
  | 'BY_CLAIM_AND_COUNTERCLAIM'
  | 'BY_TRIBUNAL'
  | 'BY_AGREEMENT'
  | 'CUSTOM';

export interface PartyShareInput {
  partyId: string;
  side: 'CLAIMANT' | 'RESPONDENT';
  /** Value of this party's claim (for BY_CLAIM_VALUE / claim+counterclaim). */
  claimValue?: number;
  /** Explicit weight for BY_AGREEMENT / CUSTOM. */
  weight?: number;
}

export interface AllocationShare {
  partyId: string;
  side: 'CLAIMANT' | 'RESPONDENT';
  shareAmount: number;
}

function toCents(n: number): number {
  return Math.round(n * 100);
}
function toMajor(cents: number): number {
  return Math.round(cents) / 100;
}

/** Distribute `totalCents` across `weights` proportionally, summing exactly. */
function distribute(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    // Fall back to an even split when no positive weights are provided.
    return distribute(totalCents, weights.map(() => 1));
  }
  const raw = weights.map((w) => (totalCents * w) / sum);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = totalCents - floored.reduce((a, b) => a + b, 0);
  // Hand out the leftover cents to the largest fractional parts first.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floored];
  for (let k = 0; k < remainder; k++) {
    result[order[k % order.length].i] += 1;
  }
  remainder = 0;
  return result;
}

export function allocate(
  total: number,
  method: AllocationMethod,
  parties: PartyShareInput[],
): AllocationShare[] {
  if (total < 0) throw new Error('Allocation total must not be negative.');
  if (parties.length === 0) throw new Error('At least one party is required for allocation.');
  const totalCents = toCents(total);

  let weights: number[];
  switch (method) {
    case 'EQUAL':
    case 'BY_PARTY_COUNT':
    case 'BY_TRIBUNAL':
      // Pending the tribunal's costs decision, deposits are shared equally.
      weights = parties.map(() => 1);
      break;
    case 'BY_CLAIM_VALUE':
      weights = parties.map((p) => Math.max(p.claimValue ?? 0, 0));
      break;
    case 'BY_CLAIM_AND_COUNTERCLAIM':
      // Each party bears the portion attributable to the relief it advances:
      // claimant(s) for the claim value, respondent(s) for counterclaim value.
      weights = parties.map((p) => Math.max(p.claimValue ?? 0, 0));
      break;
    case 'BY_AGREEMENT':
    case 'CUSTOM':
      weights = parties.map((p) => Math.max(p.weight ?? 0, 0));
      break;
    default:
      throw new Error(`Unknown allocation method: ${method as string}`);
  }

  const cents = distribute(totalCents, weights);
  return parties.map((p, i) => ({ partyId: p.partyId, side: p.side, shareAmount: toMajor(cents[i]) }));
}

export interface ShareLedger {
  partyId: string;
  shareAmount: number;
  paidAmount: number;
}

export interface PaymentApplication {
  partyId: string;
  /** The party that actually paid (may differ for substitute payment). */
  paidByPartyId: string;
  amount: number;
  substitute: boolean;
}

/** Outstanding amount on a share (never negative). */
export function outstanding(share: ShareLedger): number {
  return toMajor(Math.max(toCents(share.shareAmount) - toCents(share.paidAmount), 0));
}

/** Apply a payment to a share, returning the updated share. Overpayment is clamped. */
export function applyPayment(share: ShareLedger, app: PaymentApplication): ShareLedger {
  const newPaidCents = toCents(share.paidAmount) + toCents(app.amount);
  return { ...share, paidAmount: toMajor(newPaidCents) };
}

/** A share is in default when, after its due date, an amount remains outstanding. */
export function isInDefault(share: ShareLedger, dueAt: Date, now: Date = new Date()): boolean {
  return now.getTime() > dueAt.getTime() && outstanding(share) > 0;
}

/** Total outstanding across all shares (the figure another party may cover). */
export function totalOutstanding(shares: ShareLedger[]): number {
  return toMajor(shares.reduce((acc, s) => acc + toCents(outstanding(s)), 0));
}
