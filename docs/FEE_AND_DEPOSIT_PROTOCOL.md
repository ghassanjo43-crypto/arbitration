# Fee and Deposit Protocol (Chapter 18)

> **Counsel-review notice — money handling.** Client funds, escrow / trust
> accounts, payment-services regulation, e-money rules, banking arrangements, tax
> (VAT/GST, withholding) and cross-border invoicing **require legal and
> regulatory review before production launch.** The platform today records fee
> and deposit *accounting*; it does **not** custody client funds. Do not enable
> real money movement without cleared sign-off (see
> `docs/LEGAL_REVIEW_CHECKLIST.md`).

## Entities

`FeeSchedule` → `FeeScheduleVersion` → `FeeScheduleItem`; `FeeEstimate`;
`DepositRequest` → `DepositAllocation` → `DepositPayment`; `Invoice`;
`Payment` / `PaymentAllocation`; `Refund`; `PaymentDefault`;
`FinancialLedgerEntry` (append-only, signed amounts).

## Allocation methods

`EQUAL`, `BY_PARTY_COUNT`, `BY_CLAIM_VALUE`, `BY_CLAIM_AND_COUNTERCLAIM`,
`BY_TRIBUNAL`, `BY_AGREEMENT`, `CUSTOM` (`allocation-engine.ts`, unit-tested).

## Workflow

1. Generate a fee estimate.
2. Issue a deposit request and **allocate** among parties.
3. Generate invoices; set a payment deadline; send reminders.
4. Record payments; issue receipts.
5. Detect an unpaid share (`PaymentDefault`).
6. Permit **another party to pay the unpaid share** — recorded as a
   **substitute payment** (`DepositPayment.substitute = true`) **without
   admission or waiver**, and reflected in the ledger as a `SUBSTITUTE_PAYMENT`.
7. Refer consequences to the authorised tribunal / appointing authority.
8. Permit supplementary deposits.
9. Record final allocation in the award or a cost decision.

## Non-payment consequences

Subject to tribunal authority and the law of the seat: suspension of the affected
claim or counterclaim, continuation after substitute payment, termination of the
affected claim where legally permissible, or cost consequences. **The operating
company must not automatically terminate a claim without proper authority.**

## Finance dashboard

`GET /dashboards/finance` aggregates deposits/invoices by status, outstanding by
currency, substitute payments, refunds and recent ledger entries (gated by
`INVOICE_MANAGE` / `PAYMENT_RECORD`).

## Source

`apps/api/src/fees/`. Tests: `allocation-engine.spec.ts`,
`fee-calculator.service.spec.ts`, `deposits.service.spec.ts`.
