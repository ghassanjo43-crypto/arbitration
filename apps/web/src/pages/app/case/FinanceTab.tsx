import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FeeCategory, Permission } from '@gaap/shared';
import { api } from '../../../lib/api';
import { useAuth } from '../../../auth/AuthContext';

interface Estimate { id: string; category: string; amount: string; currency: string; }
interface Invoice { id: string; number: string; status: string; total: string; currency: string; }
interface Payment { id: string; category: string; amount: string; currency: string; status: string; createdAt: string; }
interface Finance {
  estimates: Estimate[];
  invoices: Invoice[];
  payments: Payment[];
  summary: { invoiced: number; paid: number; outstanding: number };
}

const money = (n: number | string, ccy = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(Number(n));

export function FinanceTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canInvoice = !!user?.permissions.includes(Permission.INVOICE_MANAGE);
  const canPay = !!user?.permissions.includes(Permission.PAYMENT_RECORD);

  const { data, isLoading } = useQuery<Finance>({ queryKey: ['finance', caseId], queryFn: async () => (await api.get(`/cases/${caseId}/finance`)).data });

  const [invAmount, setInvAmount] = useState('');
  const createInvoice = useMutation({
    mutationFn: async () => (await api.post(`/cases/${caseId}/invoices`, { currency: 'USD', subtotal: Number(invAmount) })).data,
    onSuccess: () => { setInvAmount(''); void qc.invalidateQueries({ queryKey: ['finance', caseId] }); },
  });

  const [payAmount, setPayAmount] = useState('');
  const recordPayment = useMutation({
    mutationFn: async () => (await api.post(`/cases/${caseId}/payments`, { category: FeeCategory.FILING, amount: Number(payAmount), currency: 'USD' })).data,
    onSuccess: () => { setPayAmount(''); void qc.invalidateQueries({ queryKey: ['finance', caseId] }); },
  });

  if (isLoading) return <p className="muted">Loading…</p>;

  return (
    <div className="grid" style={{ gap: 'var(--sp-5)' }}>
      <div className="grid grid-3">
        <div className="card stat"><span className="field__hint">Invoiced</span><strong>{money(data?.summary.invoiced ?? 0)}</strong></div>
        <div className="card stat"><span className="field__hint">Paid</span><strong>{money(data?.summary.paid ?? 0)}</strong></div>
        <div className="card stat"><span className="field__hint">Outstanding</span><strong>{money(data?.summary.outstanding ?? 0)}</strong></div>
      </div>

      {(canInvoice || canPay) && (
        <div className="card">
          <h3 className="card__title">Registry actions</h3>
          <div className="grid grid-2">
            {canInvoice && (
              <form className="field-inline" onSubmit={(e) => { e.preventDefault(); if (invAmount) createInvoice.mutate(); }}>
                <input className="input" type="number" placeholder="Invoice amount" value={invAmount} onChange={(e) => setInvAmount(e.target.value)} />
                <button className="btn btn--primary" disabled={createInvoice.isPending}>Issue invoice</button>
              </form>
            )}
            {canPay && (
              <form className="field-inline" onSubmit={(e) => { e.preventDefault(); if (payAmount) recordPayment.mutate(); }}>
                <input className="input" type="number" placeholder="Payment amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                <button className="btn btn--gold" disabled={recordPayment.isPending}>Record payment</button>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Fee estimates</th><th style={{ textAlign: 'end' }}>Amount</th></tr></thead>
          <tbody>
            {data?.estimates.map((e) => (
              <tr key={e.id}><td>{e.category.replaceAll('_', ' ')}</td><td style={{ textAlign: 'end' }}>{money(e.amount, e.currency)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Invoice</th><th>Status</th><th style={{ textAlign: 'end' }}>Total</th></tr></thead>
            <tbody>
              {data?.invoices.length ? data.invoices.map((i) => (
                <tr key={i.id}><td>{i.number}</td><td><span className="badge badge--info">{i.status}</span></td><td style={{ textAlign: 'end' }}>{money(i.total, i.currency)}</td></tr>
              )) : <tr><td colSpan={3}><span className="muted">No invoices.</span></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Payment</th><th>Status</th><th style={{ textAlign: 'end' }}>Amount</th></tr></thead>
            <tbody>
              {data?.payments.length ? data.payments.map((p) => (
                <tr key={p.id}><td>{p.category.replaceAll('_', ' ')}</td><td><span className="badge badge--success">{p.status}</span></td><td style={{ textAlign: 'end' }}>{money(p.amount, p.currency)}</td></tr>
              )) : <tr><td colSpan={3}><span className="muted">No payments.</span></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
