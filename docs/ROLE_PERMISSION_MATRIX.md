# Role & Permission Matrix

Two independent layers govern access. **Global permissions** (this matrix) authorise
institution-wide actions. **Case-level access** is granted separately through case membership
and is *not* implied by any global role.

## Global roles → permissions

| Permission \ Role            | Individual | Company | Lawyer | Arbitrator | Registrar | Council | Admin | Super Admin |
|------------------------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| news:manage                  |  |  |  |  |  |  | ✔ | ✔ |
| court_highlight:manage       |  |  |  |  |  |  | ✔ | ✔ |
| publication:manage           |  |  |  |  |  |  | ✔ | ✔ |
| case:view_queue              |  |  |  |  | ✔ |  |  |  |
| case:register                |  |  |  |  | ✔ |  |  |  |
| case:issue_deficiency        |  |  |  |  | ✔ |  |  |  |
| case:manage_service          |  |  |  |  | ✔ |  |  |  |
| case:manage_deadlines        |  |  |  |  | ✔ |  |  |  |
| case:schedule_hearing        |  |  |  |  | ✔ |  |  |  |
| appointment:manage           |  |  |  |  | ✔ |  |  |  |
| conflict:review              |  |  |  |  | ✔ | ✔ |  |  |
| arbitrator:approve           |  |  |  |  |  | ✔ |  |  |
| arbitrator:suspend           |  |  |  |  |  | ✔ |  |  |
| challenge:decide             |  |  |  |  |  | ✔ |  |  |
| compliance:review            |  |  |  |  |  | ✔ |  |  |
| policy:manage                |  |  |  |  |  | ✔ |  |  |
| payment:record               |  |  |  |  | ✔ |  |  |  |
| invoice:manage               |  |  |  |  | ✔ |  |  |  |
| fee_schedule:manage          |  |  |  |  |  |  | ✔ | ✔ |
| user:manage                  |  |  |  |  |  |  | ✔ | ✔ |
| role:manage                  |  |  |  |  |  |  |  | ✔ |
| audit:view                   |  |  |  |  |  |  | ✔ | ✔ |
| settings:manage              |  |  |  |  |  |  |  | ✔ |
| support:manage               |  |  |  |  | ✔ |  | ✔ | ✔ |

> **deliberation:participate** appears in no row above on purpose. It is obtainable **only** by
> being an appointed tribunal member (`TRIBUNAL_CHAIR` / `TRIBUNAL_MEMBER`) on a specific case.

## Case roles → case-scoped capabilities

| Capability \ Case Role | Claimant | Claimant Rep | Respondent | Respondent Rep | Tribunal Chair/Member | Tribunal Secretary | Case Registrar |
|------------------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| View case overview            | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| File submission for own side  | ✔ | ✔ | ✔ | ✔ |  |  |  |
| View own side PARTY_PRIVATE   | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |
| View other side PARTY_PRIVATE |  |  |  |  | ✔ |  |  |
| View TRIBUNAL_ONLY documents  |  |  |  |  | ✔ | ✔* |  |
| **Tribunal deliberations**    |  |  |  |  | ✔ |  |  |
| Issue procedural order        |  |  |  |  | ✔ |  |  |
| Manage service / deadlines    |  |  |  |  |  |  | ✔ |
| Record payments / deposits    |  |  |  |  |  |  | ✔ |

\* Tribunal secretary access to `TRIBUNAL_ONLY` material is configurable; deliberation notes
remain restricted to chair/members.

## Key invariants (enforced in code & tests)

1. A claimant cannot access respondent `PARTY_PRIVATE` documents and vice versa.
2. A respondent cannot see tribunal deliberations.
3. A lawyer only accesses clients/cases to which they are assigned (via `CaseTeamMember`).
4. An arbitrator only accesses a case after an accepted appointment creates their membership.
5. A registrar administers but cannot read deliberations or merits-private material.
6. Council and senior management do not receive confidential merits/deliberation access by default.
7. Technical administrators cannot freely browse confidential case documents.
8. Every sensitive action is written to the append-only audit log.
