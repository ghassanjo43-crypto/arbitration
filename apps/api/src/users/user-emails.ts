import { Role, ROLE_LABELS } from '@gaap/shared';

/** Professional, plain-text account/notification email templates (no HTML needed,
 *  no plaintext passwords are ever included). */
export interface BuiltEmail { subject: string; text: string; templateKey: string }

const SIGNOFF = '\n\n—\nThis is an automated message from the Global Ad Hoc Arbitration Panel. Do not reply to this email.';
const rolesLabel = (roles: Role[]) => (roles.length ? roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') : 'Platform user');

/** New account enrollment — explains access email, role, and how to set a password. */
export function enrollmentEmail(p: { displayName: string; email: string; roles: Role[]; loginUrl: string; forgotUrl: string }): BuiltEmail {
  return {
    subject: 'You have been enrolled on the Arbitration Panel',
    templateKey: 'user.enrollment',
    text:
`Dear ${p.displayName},

You have been enrolled on the Global Ad Hoc Arbitration Panel.

  • Your login (access) email: ${p.email}
  • Your role / category: ${rolesLabel(p.roles)}

To set your password, open the sign-in page and choose "Forgot password", or use this link:
  ${p.forgotUrl}

Then sign in here:
  ${p.loginUrl}

For your security, a password is never sent by email.${SIGNOFF}`,
  };
}

/** Sent to the NEW address when a login email is changed. */
export function emailChangedNew(p: { newEmail: string; loginUrl: string }): BuiltEmail {
  return {
    subject: 'This is now your Arbitration Panel login email',
    templateKey: 'user.email_changed.new',
    text:
`Your login (access) email for the Global Ad Hoc Arbitration Panel is now:
  ${p.newEmail}

Use it to sign in here:
  ${p.loginUrl}

If you did not expect this change, contact the registry immediately.${SIGNOFF}`,
  };
}

/** Sent to the OLD address when a login email is changed (security alert). */
export function emailChangedOld(p: { oldEmail: string; newEmail: string }): BuiltEmail {
  return {
    subject: 'Your Arbitration Panel login email was changed',
    templateKey: 'user.email_changed.old',
    text:
`The login (access) email on your Global Ad Hoc Arbitration Panel account was changed
from ${p.oldEmail} to ${p.newEmail}.

If you did not request this change, contact the registry immediately.${SIGNOFF}`,
  };
}

/** Sent when roles/authorities are added or removed. */
export function roleChangedEmail(p: { displayName: string; added: Role[]; removed: Role[]; loginUrl: string }): BuiltEmail {
  const lines: string[] = [];
  if (p.added.length) lines.push(`  • Added: ${rolesLabel(p.added)}`);
  if (p.removed.length) lines.push(`  • Removed: ${rolesLabel(p.removed)}`);
  return {
    subject: 'Your Arbitration Panel roles were updated',
    templateKey: 'user.role_changed',
    text:
`Dear ${p.displayName},

Your roles/authorities on the Global Ad Hoc Arbitration Panel were updated:
${lines.join('\n')}

Roles determine what you can do on the platform; case-specific roles (Claimant,
Respondent, Arbitrator, etc.) are assigned per case. Sign in here:
  ${p.loginUrl}${SIGNOFF}`,
  };
}
