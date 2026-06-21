# Procedural Workflow

> **Counsel-review notice.** This workflow encodes original platform rules
> (drawing on the UNCITRAL Arbitration Rules only as a reference framework) and
> requires review by qualified arbitration counsel before production launch.

End-to-end administered ad hoc flow, with the module/chapter that owns each step.
The **rules engine** ties the steps together: an authorised actor records a
`CaseProceduralEvent`, and the engine materialises the next deadlines and
worklist items within the case's pinned `RuleSetVersion` (see
`docs/RULES_ENGINE.md`).

| # | Step | Owner |
|---|------|-------|
| 1 | Individual/company files a Notice of Arbitration | `cases` (Ch3–4) |
| 2 | Registrar reviews completeness | `registry` (Ch4) |
| 3 | Deficiency notice issued and corrected | `service` + `cases` (Ch4) |
| 4 | Filing fee paid | `fees` (Ch18) |
| 5 | Case registered (commencement recorded) | `cases` / engine (Ch3) |
| 6 | Respondent served electronically | `service` (Ch2) |
| 7 | Respondent registers and responds | `cases` (Ch5) |
| 8 | Parties accept the rules (sealed receipt) | `rules` (Ch1) |
| 9 | Tribunal appointed | `appointments` (Ch7) |
| 10 | Conflict disclosures completed | `appointments` (Ch8) |
| 11 | Procedural conference scheduled | `hearings` (Ch9) |
| 12 | Procedural Order No. 1 issued | `cases` (Ch9/19) |
| 13 | Deadlines generated | `deadlines` / engine (Ch6) |
| 14 | Pleadings filed (no silent replacement) | `filings` (Ch10) |
| 15 | Fees and deposits paid | `fees` (Ch18) |
| 16 | Hearing scheduled | `hearings` (Ch15) |
| 17 | Tribunal issues an award | `awards` (Ch20) |
| 18 | Award delivered | `awards` (Ch20) |
| 19 | Correction period runs | `awards` (Ch21) |
| 20 | Case closed | `cases` (Ch22) |

Parallel / on-demand procedures: document production (`filings`, Ch12), witness &
expert evidence (`evidence`, Ch13–14), interim measures (`interim`, Ch16),
default proceedings (`defaults`, Ch17), expedited track (`casetracks`, Ch23),
consolidation & joinder (`casetracks`, Ch24).

## Authority boundaries (enforced in code)

- The **tribunal alone** decides jurisdiction, admissibility, evidence,
  procedural disputes, interim measures, merits, costs and awards.
- The portal **never** grants relief, issues a tribunal decision automatically,
  or proceeds in default without the full due-process review and tribunal
  authority.
- Mandatory law of the seat prevails over portal rules; the administrator cannot
  override a tribunal decision.

See `docs/WORKFLOW.md` for the earlier filing-wizard notes and
`docs/PROCEDURAL_WORKFLOW.md` (this file) for the full chapter flow.
