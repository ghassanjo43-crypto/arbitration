import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface ScreeningSubject {
  /** Minimal identifying data — only what a sanctions/AML check actually needs. */
  name: string;
  type: string;
  country?: string;
  dateOfBirth?: string;
}

export interface ScreeningProviderResult {
  provider: string;
  providerRef: string;
  /** Provider-level outcome. CLEAR / POSSIBLE_MATCH are screening signals, not
   *  legal conclusions; FAILED means the provider could not give an answer. */
  outcome: 'CLEAR' | 'POSSIBLE_MATCH' | 'FAILED';
  riskScore?: number;
  matchCount: number;
  /** Short human-readable summary — never the full raw provider payload. */
  summary: string;
}

/**
 * KYC / AML / sanctions screening provider abstraction.
 *
 *  - `mock` (default): deterministic, credential-free screening for dev/test.
 *    Names containing a configured token (default "BLOCKED" / "SANCTION" / "OFAC")
 *    return a possible match; everything else is clear. No network, no PII leaves
 *    the process.
 *  - `http`: a real vendor behind a normalising HTTP endpoint (OpenSanctions,
 *    Dilisense, ComplyAdvantage, …). The endpoint is expected to accept the
 *    subject and return { outcome, riskScore?, matchCount, summary, reference }.
 *
 * The provider NEVER decides whether a subject may proceed — it only screens.
 * Holds, review and release are the compliance service's job.
 */
@Injectable()
export class ScreeningService {
  private readonly logger = new Logger(ScreeningService.name);
  private readonly driver: string;
  private readonly apiUrl?: string;
  private readonly apiKey?: string;
  private readonly mockBlockTokens: string[];

  constructor(config: ConfigService) {
    this.driver = config.get<string>('screening.driver') ?? 'mock';
    this.apiUrl = config.get<string>('screening.apiUrl');
    this.apiKey = config.get<string>('screening.apiKey');
    this.mockBlockTokens = (config.get<string>('screening.mockBlockTokens') ?? 'BLOCKED,SANCTION,OFAC')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (this.driver === 'http' && (!this.apiUrl || !this.apiKey)) {
      throw new Error('SCREENING_DRIVER=http requires SCREENING_API_URL and SCREENING_API_KEY.');
    }
    if (this.driver === 'http') this.logger.log(`Screening driver=http apiUrl=${this.apiUrl}`);
  }

  get providerName(): string {
    return this.driver;
  }

  async screen(subject: ScreeningSubject): Promise<ScreeningProviderResult> {
    if (this.driver === 'http') return this.screenViaHttp(subject);
    return this.screenViaMock(subject);
  }

  /** Reachability + credential check for the health endpoint. */
  async healthCheck(): Promise<boolean> {
    if (this.driver !== 'http') return true;
    try {
      const res = await fetch(`${this.apiUrl}/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch (err) {
      this.logger.error(`Screening provider health check failed: ${(err as Error).message}`);
      return false;
    }
  }

  private screenViaMock(subject: ScreeningSubject): ScreeningProviderResult {
    const hay = subject.name.toUpperCase();
    const matched = this.mockBlockTokens.some((t) => hay.includes(t));
    return {
      provider: 'mock',
      providerRef: `mock_${randomUUID()}`,
      outcome: matched ? 'POSSIBLE_MATCH' : 'CLEAR',
      riskScore: matched ? 80 : 0,
      matchCount: matched ? 1 : 0,
      summary: matched
        ? `Possible match on a watchlist token for "${subject.name}" (mock provider).`
        : 'No watchlist match (mock provider).',
    };
  }

  private async screenViaHttp(subject: ScreeningSubject): Promise<ScreeningProviderResult> {
    const res = await fetch(`${this.apiUrl}/screen`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(subject),
    });
    if (!res.ok) {
      throw new Error(`Screening provider failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      outcome: 'CLEAR' | 'POSSIBLE_MATCH' | 'FAILED';
      riskScore?: number;
      matchCount?: number;
      summary?: string;
      reference?: string;
    };
    return {
      provider: 'http',
      providerRef: data.reference ?? `http_${randomUUID()}`,
      outcome: data.outcome,
      riskScore: data.riskScore,
      matchCount: data.matchCount ?? (data.outcome === 'POSSIBLE_MATCH' ? 1 : 0),
      summary: data.summary ?? `Screening outcome: ${data.outcome}.`,
    };
  }
}
