# Legal Review Checklist

> **MANDATORY NOTICE.** This platform, its procedural rules, model clauses, fee
> schedule, electronic-service protocol, and all generated legal content are
> engineering drafts. They **require review and approval by qualified arbitration
> counsel in each relevant jurisdiction before any production launch.** Nothing in
> this repository is legal advice. The operating company provides administration
> and technology only; the arbitral tribunal alone decides the merits, and the
> platform does not guarantee that an award will be recognised or enforced in any
> particular jurisdiction.

This checklist tracks the legal questions that engineering cannot resolve and
that must be cleared before go-live. It is written to be handed directly to
external counsel.

## How to use

For each item, counsel should record: **Reviewed by / Date / Outcome
(OK / Change required / Blocker) / Notes**. A launch sign-off requires every
**Blocker** cleared and every **Change required** implemented and re-verified.

> **Per-rule review is tracked in the platform.** The procedural rule *text* is
> reviewed rule-by-rule through the counsel-review workflow
> ([RULES_REVIEW_WORKFLOW.md](RULES_REVIEW_WORKFLOW.md)), which records the same
> OK / Change required / Blocker outcomes and **prevents a rule-set version from
> being activated until every rule is cleared**. This checklist covers the
> institution-level matters that sit *alongside* that per-rule review.

---

## Matters Requiring External Legal Review

The specification mandates that the following matters be reviewed by qualified
counsel. None of them are decided by code.

| # | Matter | Why it needs review | Where it surfaces in the platform |
|---|--------|---------------------|-----------------------------------|
| 1 | **Incorporation jurisdiction** | The operating company's seat affects regulatory, tax and liability exposure. | Company / operating-entity policy (off-platform). |
| 2 | **Regulatory status** | Whether the activity is regulated (arbitral institution vs. technology provider) varies by country. | Public positioning; `README`, rules preamble. |
| 3 | **Institution vs. administered ad hoc platform** | The platform is positioned as an *administered ad hoc* environment, **not** an arbitral institution and **not** a UNCITRAL body. Counsel must confirm the wording cannot be construed as appointing-authority overreach. | Rules preamble (`RuleSetVersion.mandatoryLawNotice`), `README`. |
| 4 | **Seat-specific mandatory law** | Mandatory provisions of the seat prevail over portal rules. | Engine: `CaseRuleException(mandatoryLaw=true)`; rules carry `mandatoryLawWarning`. |
| 5 | **Electronic service** | Whether electronic service is valid/sufficient differs by seat; substitute service may be required. | Chapter 2 module; `docs/ELECTRONIC_SERVICE_PROTOCOL.md`. |
| 6 | **Electronic signatures** | Validity of e-signatures on submissions, acceptances and awards. | `CaseRuleAcceptance.signatureMetadata`, `NoticeAcknowledgement.signatureMetadata`, `Award.signatureMetadata`. |
| 7 | **Electronic awards** | Some jurisdictions require a wet-ink original or specific formalities. | `Award` (electronic + wet-signature + certified-copy fields); `docs/` award notes. |
| 8 | **Payment custody** | Holding party funds may trigger payment-services / e-money regulation. | Fees/deposits module; **client funds are NOT custodied by the platform today** — see protocol. |
| 9 | **Escrow / client accounts** | Trust-account rules, segregation, audit. | `docs/FEE_AND_DEPOSIT_PROTOCOL.md` (flagged, not implemented). |
| 10 | **Tax** | VAT/GST on fees, withholding on arbitrator fees, cross-border invoicing. | Invoice/fee schedule. |
| 11 | **AML & sanctions** | KYC, sanctions screening of parties/representatives/arbitrators. | `IdentityVerification`, `ComplianceCheck` (screening integration is a stub). |
| 12 | **Data hosting** | Where personal/case data may lawfully be stored. | Deployment (Render region); `docs/DATA_RETENTION.md`. |
| 13 | **Cross-border data transfers** | Transfer mechanisms (SCCs, adequacy). | Confidentiality/data-protection chapter; retention doc. |
| 14 | **Privacy law** | GDPR / local privacy obligations, data-subject rights vs. arbitral record retention. | `docs/DATA_RETENTION.md`, privacy page. |
| 15 | **Consumer arbitration** | Many seats restrict or forbid pre-dispute consumer arbitration. | Model clause / submission agreement guidance. |
| 16 | **Employment arbitration** | Special protections and non-arbitrability in some seats. | Same as above. |
| 17 | **Arbitrability** | Subject matter that cannot be arbitrated in a given seat. | Tribunal decides jurisdiction; portal does not. |
| 18 | **Enforcement** | New York Convention reservations, public policy, due-process review. | Award wording; enforceability disclaimer. |
| 19 | **Tribunal-secretary rules** | Permissible scope of secretary tasks varies. | `CaseRole.TRIBUNAL_SECRETARY` permissions. |
| 20 | **Publication of awards** | Consent, anonymisation, confidentiality. | `Award.publicationConsent` / confidentiality chapter. |
| 21 | **Professional liability insurance** | Cover for the operating company and panel. | Operating-entity policy (off-platform). |

---

## Platform-specific legal confirmations

Beyond the list above, counsel should confirm the following design positions,
each of which is enforced in code and must be legally validated:

1. **Merits boundary.** The platform never issues a tribunal decision
   automatically. Awards, jurisdiction, admissibility, evidence rulings, interim
   measures and costs are tribunal-only (enforced in `awards`, `evidence`,
   `interim`, `defaults`, document-production services).
2. **Default proceedings (Ch17).** Proceeding in default is **blocked** until all
   nine due-process review factors are satisfied *and* a registrar report with
   verified service exists, and even then only the tribunal may authorise it. A
   default decision never establishes the claim. Counsel must confirm the factor
   list is sufficient for the intended seats.
3. **Service ≠ receipt.** Email dispatch is never treated as proof of receipt;
   the Certificate of Electronic Service distinguishes dispatch, delivery,
   access and acknowledgement. Counsel must confirm sufficiency per seat.
4. **Rule versioning.** A case is pinned to one `RuleSetVersion`; later
   amendments never change a live case. Confirm this matches party expectations
   and the agreement to arbitrate.
5. **Overrides & exceptions.** Procedural modifications require recorded
   authority (`CaseRuleOverride` = party agreement / tribunal direction;
   `CaseRuleException` = tribunal or mandatory law). Confirm authority model.
6. **Enforceability language.** The standard wording (README, rules) must be
   reviewed: *"The parties may agree that the award shall be final and binding.
   Recognition and enforcement remain subject to applicable arbitration law,
   international conventions, due-process requirements, arbitrability, public
   policy, and the law of the jurisdiction in which recognition or enforcement is
   sought."*
7. **No UNCITRAL affiliation.** UNCITRAL Arbitration Rules are used only as a
   *reference framework*; confirm no text implies official status or copies
   protected commentary.

---

## Sign-off

| Role | Name | Date | Decision |
|------|------|------|----------|
| Lead arbitration counsel (seat 1) | | | |
| Lead arbitration counsel (seat 2) | | | |
| Data-protection / privacy counsel | | | |
| Financial-services / payments counsel | | | |
| Operating-company general counsel | | | |

**Launch is not authorised until every Blocker above is cleared.**
