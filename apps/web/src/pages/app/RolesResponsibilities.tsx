/**
 * User Roles & Responsibilities — an authenticated, INFORMATIONAL help page.
 * It explains each user category, what they do, and what they must not do.
 * It is static content only: it makes no API calls and exposes no case data,
 * and it changes nothing about permissions, workflow or role enforcement.
 */

interface RoleInfo {
  name: string;
  summary: string;
  mainFunction: string;
  canEdit: string;
  cannotShort: string;
  can: string[];
  cannot: string[];
}

const ROLES: RoleInfo[] = [
  {
    name: 'Super Admin',
    summary: 'Controls the platform itself — not the merits of any arbitration. Ensures the system is properly configured and governed.',
    mainFunction: 'Platform administration & governance',
    canEdit: 'Users, roles, platform & retention settings',
    cannotShort: 'Decide disputes; access deliberations; draft/sign awards',
    can: [
      'Create users',
      'Edit users',
      'Assign roles and authorities',
      'Suspend, deactivate, reactivate, or soft-delete users',
      'Manage platform settings',
      'Manage data retention and legal-hold settings',
      'Monitor system governance',
      'Review audit/admin activity where authorized',
      'Ensure the platform is properly configured',
    ],
    cannot: [
      'Decide disputes',
      'Draft or sign awards unless separately appointed as arbitrator',
      'Access tribunal deliberations unless appointed to the tribunal',
      'Interfere with tribunal independence',
    ],
  },
  {
    name: 'Registrar',
    summary: 'Administers the arbitration file and procedure. The Registrar administers the case; the Tribunal decides it.',
    mainFunction: 'Case administration & procedure',
    canEdit: 'Administrative case details, status, notes, filings, notices, calendar',
    cannotShort: 'Decide merits; issue awards; read deliberations',
    can: [
      'Register and manage cases',
      'Check filing completeness',
      'Request missing documents',
      'Update administrative case details',
      'Update case status/stage',
      'Manage administrative notes',
      'Send and resend notices',
      'Track service and delivery',
      'Manage filing/document administration',
      'Coordinate procedural deadlines',
      'Schedule hearings or procedural meetings',
      'Coordinate tribunal appointment workflow',
      'Invite arbitrators where applicable',
      'Track arbitrator responses and disclosures',
      'Escalate conflicts or challenges to the Council',
    ],
    cannot: [
      'Decide the merits',
      'Draft, sign, or issue awards',
      'Access private tribunal deliberations',
      'Decide arbitrator challenges if reserved for Council',
      'Change platform-wide user roles or global settings unless separately authorized',
    ],
  },
  {
    name: 'Council Member / Appointing Authority',
    summary: 'The governance and appointment authority. Protects neutrality, independence and fairness of the process.',
    mainFunction: 'Governance, appointments & challenges',
    canEdit: 'Procedural/rules approvals, appointment & challenge decisions',
    cannotShort: 'Decide the merits; act as counsel; read deliberations',
    can: [
      'Review and approve procedural/rules matters',
      'Handle arbitrator appointment issues',
      'Decide or review arbitrator challenges',
      'Review conflict disclosures',
      'Approve or reject policy changes where required',
      'Act as legal/governance reviewer for sensitive platform rules',
      'Protect neutrality, independence, and fairness of the process',
    ],
    cannot: [
      'Act as party counsel',
      'Decide the merits of the dispute',
      'Draft or sign awards unless appointed as arbitrator',
      'Manage ordinary case filing tasks that belong to the Registrar',
      'Access tribunal deliberations unless part of the tribunal',
    ],
  },
  {
    name: 'Arbitrator / Tribunal',
    summary: 'The decision-maker. Conducts the proceedings, deliberates privately and issues awards, maintaining independence and impartiality.',
    mainFunction: 'Decides the dispute',
    canEdit: 'Procedural directions, deliberations, awards (where authorized)',
    cannotShort: 'Administer the platform; act as Registrar',
    can: [
      'Review case materials',
      'Disclose conflicts',
      'Accept or decline appointment',
      'Conduct hearings and procedural conferences',
      'Manage procedural directions after tribunal constitution',
      'Review evidence and submissions',
      'Deliberate privately',
      'Draft, sign, and issue awards where authorized',
      'Maintain independence and impartiality',
    ],
    cannot: [
      'Manage platform users',
      'Change global platform settings',
      'Act as Registrar',
      'Communicate privately with one party outside permitted channels',
      'Access unrelated cases',
      'Ignore conflict disclosure duties',
    ],
  },
  {
    name: 'Lawyer / Representative',
    summary: 'Represents a party and protects the client’s interests within the arbitration rules.',
    mainFunction: 'Party representation',
    canEdit: 'Own client’s submissions, evidence and filings',
    cannotShort: 'Access other parties’ accounts or deliberations',
    can: [
      'File submissions on behalf of their client',
      'Upload evidence and documents',
      'Respond to procedural directions',
      'Receive notices',
      'Attend hearings',
      'Communicate through approved case channels',
      'Protect client interests within the arbitration rules',
    ],
    cannot: [
      'Access other parties’ private accounts',
      'Change case administration settings',
      'Access tribunal deliberations',
      'Influence arbitrators improperly',
      'Manage platform users or global settings',
    ],
  },
  {
    name: 'Party / Client',
    summary: 'The claimant/respondent — a company or private individual involved in the dispute.',
    mainFunction: 'Participates in the dispute',
    canEdit: 'Own filings and documents (within permitted channels)',
    cannotShort: 'Edit the official record; access other cases/deliberations',
    can: [
      'File or respond to claims',
      'Upload required documents',
      'Review notices',
      'Attend hearings where required',
      'Appoint or instruct representatives',
      'Pay fees where applicable',
      'Comply with procedural orders and awards',
    ],
    cannot: [
      'Access tribunal deliberations',
      'Edit the official case record directly beyond permitted filings',
      'Change platform settings',
      'Manage other users',
      'Access confidential documents of other cases',
    ],
  },
  {
    name: 'Finance / Admin',
    summary: 'Administers fees and payments and supports financial reporting. Does not touch the merits.',
    mainFunction: 'Fees & payment administration',
    canEdit: 'Fee status, fee notices, payment records (where authorized)',
    cannotShort: 'Decide disputes; alter merits; override retention',
    can: [
      'View fee status',
      'Generate fee notices',
      'Mark payment received/pending where authorized',
      'Track deposits and administrative fees',
      'Support financial reporting',
    ],
    cannot: [
      'Decide disputes',
      'Access tribunal deliberations',
      'Draft/sign awards',
      'Change merits documents',
      'Override legal holds or retention settings unless separately authorized',
    ],
  },
];

function RoleCard({ role }: { role: RoleInfo }) {
  return (
    <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
      <h2 className="card__title">{role.name}</h2>
      <p className="muted">{role.summary}</p>
      <div className="grid grid-2" style={{ alignItems: 'start', marginTop: 'var(--sp-2)' }}>
        <div>
          <p className="eyebrow" style={{ color: 'var(--c-success)' }}>Responsibilities</p>
          <ul style={{ margin: 0, paddingInlineStart: '1.1rem', lineHeight: 1.7 }}>
            {role.can.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
        <div>
          <p className="eyebrow" style={{ color: 'var(--c-danger)' }}>Must not</p>
          <ul style={{ margin: 0, paddingInlineStart: '1.1rem', lineHeight: 1.7 }}>
            {role.cannot.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function RolesResponsibilities() {
  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Help &amp; reference</p>
        <h1>User Roles &amp; Responsibilities</h1>
        <p className="muted">
          Who does what on the platform — each user category, its responsibilities, and the limits of its authority.
        </p>

        {/* Guiding principle */}
        <div className="alert alert--legal" role="note" style={{ marginTop: 'var(--sp-3)' }}>
          <strong>Platform administration is separate from dispute decision-making.</strong> The Registrar administers
          the case, the Council protects governance, and the Tribunal decides the dispute.
        </div>

        {/* Workflow sequence */}
        <section className="card" style={{ marginTop: 'var(--sp-3)' }}>
          <h2 className="card__title">How the roles relate</h2>
          <div className="roles-flow" aria-label="Role workflow sequence">
            {['Super Admin', 'Registrar', 'Council', 'Arbitrator / Tribunal', 'Parties / Lawyers'].map((step, i, arr) => (
              <span key={step} className="roles-flow__step">
                <span className="badge badge--info">{step}</span>
                {i < arr.length - 1 && <span className="roles-flow__arrow" aria-hidden="true">→</span>}
              </span>
            ))}
          </div>
          <p className="field__hint" style={{ marginTop: 'var(--sp-2)' }}>
            The platform is configured by the Super Admin; the Registrar administers each case; the Council safeguards
            governance and appointments; the Tribunal decides; parties and their lawyers participate.
          </p>
        </section>

        {/* Comparison table */}
        <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 className="card__title">At a glance</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Role</th><th>Main function</th><th>Can edit?</th><th>Cannot do</th></tr></thead>
              <tbody>
                {ROLES.map((r) => (
                  <tr key={r.name}>
                    <td><strong>{r.name}</strong></td>
                    <td>{r.mainFunction}</td>
                    <td>{r.canEdit}</td>
                    <td className="field__hint">{r.cannotShort}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Per-role detail */}
        {ROLES.map((r) => <RoleCard key={r.name} role={r} />)}

        {/* Visibility / scope note */}
        <div className="alert alert--info" role="note" style={{ marginTop: 'var(--sp-4)' }}>
          This page is <strong>informational only</strong>. It is visible to any signed-in user, describes roles in
          general terms, and does <strong>not</strong> display confidential case data or change any permission.
        </div>
      </div>
    </div>
  );
}
