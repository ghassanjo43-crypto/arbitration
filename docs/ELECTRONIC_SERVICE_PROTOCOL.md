# Electronic Service Protocol (Chapter 2)

> **Counsel-review notice.** Whether electronic service is valid and sufficient,
> and when substitute service is required, depends on the law of the seat and
> must be confirmed by qualified arbitration counsel before production launch.

## Core principle

**Email dispatch is never treated as conclusive proof of receipt.** A served
notice only advances to `ACCESSED` / `ACKNOWLEDGED` on real portal access or an
explicit acknowledgement — never from sending an email.

## Entities

- `FormalNotice` → `NoticeRecipient`
- `NoticeDocument` — the served file(s); a content hash seals exactly what was
  served
- `NoticeDeliveryAttempt` — per-channel attempt (portal, email, …) with outcome
- `NoticeAccessEvent` — opened / downloaded
- `NoticeAcknowledgement` — an immutable, SHA-256-sealed acknowledgement of
  receipt (distinct from a mere access)
- `NoticeFailure` — an explicit delivery failure, linkable to the substitute
  order that resolves it
- `SubstituteServiceOrder` — additional service by courier / registered mail /
  personal delivery / publication / other lawful means
- `ServiceCertificate` — the immutable Certificate of Electronic Service

## Status model

`DRAFT → ISSUED → PORTAL_AVAILABLE → EMAIL_SENT → DELIVERED → DELIVERY_FAILED →
ACCESSED → ACKNOWLEDGED → SUBSTITUTE_SERVICE_REQUIRED → SERVICE_COMPLETED →
SERVICE_DISPUTED`.

## Flow

1. The registry issues a notice. The document is made `PORTAL_AVAILABLE` (always
   recorded as a delivery attempt) and an email *notice-to-collect* is attempted
   per recipient.
2. A successful send → `EMAIL_SENT`; a failure → `DELIVERY_FAILED` **and** a
   `NoticeFailure` row (failures are never silently dropped).
3. Real access is recorded as a `NoticeAccessEvent` and advances the recipient to
   `ACCESSED`. A formal acknowledgement writes a sealed `NoticeAcknowledgement`
   and sets `ACKNOWLEDGED`.
4. On failure, the registry/tribunal may order **substitute service**; the
   outstanding `NoticeFailure`s are linked to that order and resolved.
5. The **Certificate of Electronic Service** snapshots case number, document(s)
   with hashes, issuing party, recipients, methods, timestamps, delivery/access
   status, failures and acknowledgements, sealed with a SHA-256 hash.

## Engine link

When the rules engine records a `REQUIRE_NOTICE` action for a case, it appears on
`GET /cases/:id/notice-requirements` so the registry knows which formal notices
the rules require.

## Source

`apps/api/src/service/`. Tests: `service.service.spec.ts` (dispatch ≠ receipt,
explicit failure capture, served-document hashing, sealed acknowledgement).
