import { Injectable } from '@nestjs/common';

export interface FeeCalculationInput {
  amountInDispute: number;
  currency?: string;
  numberOfArbitrators?: number;
  expedited?: boolean;
}

export interface FeeLine {
  category: string;
  label: string;
  amount: number;
}

export interface FeeCalculationResult {
  currency: string;
  lines: FeeLine[];
  total: number;
  disclaimer: string;
}

/**
 * Indicative ad valorem fee schedule. Values are illustrative and configurable
 * via SystemSetting in production. The calculator is advisory only — the
 * tribunal and the agreed rules govern final costs.
 */
@Injectable()
export class FeeCalculatorService {
  private readonly bands = [
    { upTo: 50_000, admin: 0.04, arbitrator: 0.08 },
    { upTo: 500_000, admin: 0.025, arbitrator: 0.06 },
    { upTo: 2_000_000, admin: 0.015, arbitrator: 0.04 },
    { upTo: 10_000_000, admin: 0.008, arbitrator: 0.025 },
    { upTo: Infinity, admin: 0.004, arbitrator: 0.015 },
  ];

  calculate(input: FeeCalculationInput): FeeCalculationResult {
    const currency = input.currency ?? 'USD';
    const amount = Math.max(input.amountInDispute, 0);
    const arbitrators = input.numberOfArbitrators ?? 1;

    const filing = amount > 0 ? Math.min(2_500, Math.max(500, amount * 0.005)) : 500;
    const band = this.bands.find((b) => amount <= b.upTo) ?? this.bands[this.bands.length - 1];
    const admin = amount * band.admin;
    const arbitrator = amount * band.arbitrator * arbitrators;
    const hearingTech = 750 * arbitrators;
    const expedited = input.expedited ? (admin + arbitrator) * 0.1 : 0;

    const lines: FeeLine[] = [
      { category: 'FILING', label: 'Filing fee (non-refundable where applicable)', amount: round(filing) },
      { category: 'ADMINISTRATIVE', label: 'Estimated administrative fee', amount: round(admin) },
      { category: 'ARBITRATOR', label: `Estimated arbitrator fee (${arbitrators})`, amount: round(arbitrator) },
      { category: 'HEARING', label: 'Hearing technology fee', amount: round(hearingTech) },
    ];
    if (expedited > 0) lines.push({ category: 'OTHER', label: 'Expedited handling', amount: round(expedited) });

    const total = round(lines.reduce((s, l) => s + l.amount, 0));
    return {
      currency,
      lines,
      total,
      disclaimer:
        'Estimates are indicative only, exclude taxes and bank charges, and do not constitute a quotation. ' +
        'Final fees and their allocation are determined under the agreed rules and by the tribunal.',
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
