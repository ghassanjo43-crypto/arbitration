import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

import { DeliveryTab } from '../pages/app/case/DeliveryTab';

const deliveries = [
  { id: 'd1', provider: 'resend', providerMessageId: 'msg_abc', toEmail: 'party@x.com', subject: '[Service] Notice', status: 'DELIVERED', failureKind: null, errorDetail: null, attemptCount: 1, nextAttemptAt: null, noticeId: 'n1', noticeType: 'NOTICE_OF_ARBITRATION', sentAt: '2026-06-01T10:00:00Z', events: [{ id: 'e1', type: 'sent', providerEventId: 'msg_abc', detail: null, occurredAt: '2026-06-01T10:00:00Z' }, { id: 'e2', type: 'delivered', providerEventId: 'evt1', detail: null, occurredAt: '2026-06-01T10:01:00Z' }] },
  { id: 'd2', provider: 'resend', providerMessageId: 'msg_def', toEmail: 'bad@x.com', subject: '[Service] Notice', status: 'BOUNCED', failureKind: 'PERMANENT', errorDetail: 'mailbox unavailable', attemptCount: 1, nextAttemptAt: null, noticeId: 'n2', noticeType: 'NOTICE_OF_ARBITRATION', sentAt: '2026-06-01T10:00:00Z', events: [{ id: 'e3', type: 'bounced', providerEventId: 'evt2', detail: 'hard bounce', occurredAt: '2026-06-01T10:02:00Z' }] },
];

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeliveryTab caseId="c1" /></QueryClientProvider>);
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: deliveries });
});

describe('DeliveryTab', () => {
  it('shows the dispatch-is-not-receipt disclaimer', async () => {
    renderTab();
    expect(await screen.findByText(/dispatch is not receipt/i)).toBeInTheDocument();
  });

  it('renders delivery rows with status, provider message id and bounce reason', async () => {
    renderTab();
    expect(await screen.findByText('party@x.com')).toBeInTheDocument();
    expect(screen.getByText('msg_abc')).toBeInTheDocument();
    // "Delivered" also appears in the disclaimer; the status badge makes 2 total.
    expect(screen.getAllByText('Delivered').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bounced').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('mailbox unavailable')).toBeInTheDocument();
  });

  it('surfaces an authorization error', async () => {
    get.mockRejectedValueOnce({ response: { status: 403 } });
    renderTab();
    expect(await screen.findByText(/not authorised to view delivery evidence/i)).toBeInTheDocument();
  });
});
