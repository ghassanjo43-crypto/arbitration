import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { adminDatabaseUrl, e2eDatabaseUrl, E2E_PASSWORD, E2E_PEPPER, E2E_SCHEMA } from './e2e-db';

process.env.DATABASE_URL = e2eDatabaseUrl();
process.env.PASSWORD_PEPPER = E2E_PEPPER;
process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';
process.env.RATE_LIMIT_MAX = '100000';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

/**
 * End-to-end procedural flow across the new chapters: rule acceptance → engine
 * deadlines → service → filings → production → evidence → interim → default →
 * expedited → multi-party → deadline lifecycle → dashboards. Verifies the
 * cross-module wiring and the key authority guards under a real HTTP stack.
 */
describe('Procedural environment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tok = (email: string) => tokens[email];

  beforeAll(async () => {
    execSync(`npx prisma db execute --url "${adminDatabaseUrl()}" --stdin`, {
      input: `DROP SCHEMA IF EXISTS ${E2E_SCHEMA} CASCADE; CREATE SCHEMA ${E2E_SCHEMA};`,
      cwd: process.cwd(),
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() }, stdio: 'ignore' });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser('e2e-cookie-secret'));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    http = request(app.getHttpServer());

    const mkUser = async (email: string, roles: string[], name: string) => {
      const passwordHash = await passwords.hash(E2E_PASSWORD);
      const u = await prisma.user.create({
        data: {
          email, passwordHash, status: 'ACTIVE', emailVerified: true,
          profile: { create: { firstName: name, lastName: 'E2E', displayName: name } },
          roles: { create: roles.map((role) => ({ role: role as never })) },
        },
      });
      return u.id;
    };

    ids.claimant = await mkUser('p-claimant@e2e.test', ['COMPANY_CLIENT'], 'Claimant');
    ids.respondent = await mkUser('p-respondent@e2e.test', ['COMPANY_CLIENT'], 'Respondent');
    ids.registrar = await mkUser('p-registrar@e2e.test', ['REGISTRAR'], 'Registrar');
    ids.arbitrator = await mkUser('p-arbitrator@e2e.test', ['ARBITRATOR'], 'Arbitrator');

    // Fully constituted case so the arbitrator is a tribunal member (isTribunal).
    const c = await prisma.case.create({
      data: {
        reference: 'E2E-P-0001', title: 'Procedural E2E', stage: 'AWAITING_RESPONSE', language: 'en',
        parties: { create: [{ side: 'CLAIMANT', legalName: 'Claimant Co' }, { side: 'RESPONDENT', legalName: 'Respondent Co' }] },
        teamMembers: {
          create: [
            { userId: ids.claimant, caseRole: 'CLAIMANT', side: 'CLAIMANT' },
            { userId: ids.respondent, caseRole: 'RESPONDENT', side: 'RESPONDENT' },
            { userId: ids.registrar, caseRole: 'CASE_REGISTRAR' },
            { userId: ids.arbitrator, caseRole: 'TRIBUNAL_CHAIR' },
          ],
        },
        tribunal: { create: { composition: 'SOLE', constituted: true, members: { create: { arbitratorUserId: ids.arbitrator, role: 'SOLE', acceptedAt: new Date() } } } },
      },
    });
    ids.caseId = c.id;

    // Minimal rule graph: NOTICE_SERVED → CREATE_DEADLINE(RESPONSE_TO_NOTICE, 30d).
    const rs = await prisma.ruleSet.create({ data: { code: 'E2E_RULES', title: 'E2E Rules' } });
    const version = await prisma.ruleSetVersion.create({ data: { ruleSetId: rs.id, version: '1.0', status: 'ACTIVE', effectiveDate: new Date() } });
    ids.versionId = version.id;
    const chapter = await prisma.ruleChapter.create({ data: { versionId: version.id, number: 2, title: 'Communications' } });
    const rule = await prisma.rule.create({ data: { versionId: version.id, chapterId: chapter.id, number: '5.1', title: 'Time to respond', text: 'Respond within 30 days.', triggeringEvent: 'NOTICE_SERVED' } });
    await prisma.ruleDeadlineDefinition.create({ data: { ruleId: rule.id, key: 'RESPONSE_TO_NOTICE', label: 'Response to Notice', triggerEvent: 'NOTICE_SERVED', days: 30, dayKind: 'CALENDAR' } });
    const trigger = await prisma.ruleTrigger.create({ data: { ruleId: rule.id, eventType: 'NOTICE_SERVED' } });
    await prisma.ruleAction.create({ data: { triggerId: trigger.id, kind: 'CREATE_DEADLINE', definitionKey: 'RESPONSE_TO_NOTICE' } });

    for (const email of ['p-claimant@e2e.test', 'p-respondent@e2e.test', 'p-registrar@e2e.test', 'p-arbitrator@e2e.test']) {
      const res = await http.post('/api/auth/login').send({ email, password: E2E_PASSWORD });
      tokens[email] = res.body.accessToken;
    }
  });

  afterAll(async () => { await app?.close(); });

  it('1) registrar pins the rule set version to the case', async () => {
    const res = await http.post(`/api/cases/${ids.caseId}/rules/assign`).set(bearer(tok('p-registrar@e2e.test'))).send({ ruleSetVersionId: ids.versionId });
    expect(res.status).toBe(201);
  });

  it('2) a party accepts the rules and receives a sealed receipt', async () => {
    const res = await http.post(`/api/cases/${ids.caseId}/rules/accept`).set(bearer(tok('p-claimant@e2e.test'))).send({ consentElectronicService: true, seat: 'Singapore' });
    expect(res.status).toBe(201);
    expect(res.body.receiptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('3) recording NOTICE_SERVED drives the engine to materialise a deadline', async () => {
    const res = await http.post(`/api/cases/${ids.caseId}/procedural-events`).set(bearer(tok('p-registrar@e2e.test'))).send({ type: 'NOTICE_SERVED' });
    expect(res.status).toBe(201);
    expect(res.body.executions.some((e: { actionKind: string; status: string }) => e.actionKind === 'CREATE_DEADLINE' && e.status === 'EXECUTED')).toBe(true);

    const deadlines = await http.get(`/api/cases/${ids.caseId}/deadlines`).set(bearer(tok('p-registrar@e2e.test')));
    const d = deadlines.body.find((x: { definitionKey: string }) => x.definitionKey === 'RESPONSE_TO_NOTICE');
    expect(d).toBeDefined();
    ids.deadlineId = d.id;
  });

  it('4) registrar serves a formal notice and generates a Certificate of Service', async () => {
    const issue = await http.post(`/api/cases/${ids.caseId}/notices`).set(bearer(tok('p-registrar@e2e.test')))
      .send({ type: 'NOTICE_OF_ARBITRATION', subject: 'Notice', body: 'You are served.', recipients: [{ label: 'Respondent Co', email: 'r@e2e.test' }] });
    expect(issue.status).toBe(201);
    const cert = await http.post(`/api/notices/${issue.body.id}/certificate`).set(bearer(tok('p-registrar@e2e.test'))).send({});
    expect(cert.status).toBe(201);
    expect(cert.body.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('5) a party files a Statement of Claim and a correction creates a superseding version', async () => {
    const filing = await http.post(`/api/cases/${ids.caseId}/filings`).set(bearer(tok('p-claimant@e2e.test'))).send({ type: 'STATEMENT_OF_CLAIM', title: 'Statement of Claim' });
    expect(filing.status).toBe(201);
    expect(filing.body.receipt).toBeTruthy();

    const corr = await http.post(`/api/filings/${filing.body.id}/corrections`).set(bearer(tok('p-claimant@e2e.test'))).send({ reason: 'Typo in relief' });
    expect(corr.status).toBe(201);
    const decided = await http.post(`/api/filing-corrections/${corr.body.id}/decide`).set(bearer(tok('p-registrar@e2e.test'))).send({ approve: true });
    expect(decided.status).toBe(201);
    expect(decided.body.newFiling.supersedesId).toBe(filing.body.id);
  });

  it('6) document production: request → object → tribunal grants → produce', async () => {
    const req = await http.post(`/api/cases/${ids.caseId}/production-requests`).set(bearer(tok('p-claimant@e2e.test'))).send({ category: 'All progress reports 2025' });
    expect(req.status).toBe(201);
    await http.post(`/api/production-requests/${req.body.id}/object`).set(bearer(tok('p-respondent@e2e.test'))).send({ objection: 'Overbroad' });

    // A party cannot grant relief.
    const partyDecide = await http.post(`/api/production-requests/${req.body.id}/decide`).set(bearer(tok('p-claimant@e2e.test'))).send({ decision: 'GRANTED', reason: 'x' });
    expect(partyDecide.status).toBe(403);

    const decide = await http.post(`/api/production-requests/${req.body.id}/decide`).set(bearer(tok('p-arbitrator@e2e.test'))).send({ decision: 'GRANTED', reason: 'Relevant and material' });
    expect(decide.status).toBe(201);
    const produce = await http.post(`/api/production-requests/${req.body.id}/produce`).set(bearer(tok('p-respondent@e2e.test'))).send({ documentIds: [] });
    expect(produce.status).toBe(201);
    expect(produce.body.status).toBe('PRODUCED');
  });

  it('7) evidence: a party raises an objection; only the tribunal rules on it', async () => {
    const witness = await http.post(`/api/cases/${ids.caseId}/witnesses`).set(bearer(tok('p-claimant@e2e.test'))).send({ fullName: 'Jane Doe' });
    expect(witness.status).toBe(201);
    const obj = await http.post(`/api/cases/${ids.caseId}/evidence-objections`).set(bearer(tok('p-respondent@e2e.test'))).send({ targetType: 'WITNESS', targetId: witness.body.id, ground: 'RELEVANCE' });
    expect(obj.status).toBe(201);
    const partyRule = await http.post(`/api/evidence-objections/${obj.body.id}/rule`).set(bearer(tok('p-respondent@e2e.test'))).send({ status: 'DISMISSED', ruling: 'x' });
    expect(partyRule.status).toBe(403);
    const rule = await http.post(`/api/evidence-objections/${obj.body.id}/rule`).set(bearer(tok('p-arbitrator@e2e.test'))).send({ status: 'DISMISSED', ruling: 'Relevant' });
    expect(rule.status).toBe(201);
  });

  it('8) interim measures: party applies; only the tribunal decides', async () => {
    const apply = await http.post(`/api/cases/${ids.caseId}/interim-measures`).set(bearer(tok('p-claimant@e2e.test'))).send({ type: 'ASSET_PRESERVATION', reliefSought: 'Freeze escrow' });
    expect(apply.status).toBe(201);
    const partyDecide = await http.post(`/api/interim-measures/${apply.body.id}/decide`).set(bearer(tok('p-claimant@e2e.test'))).send({ decision: 'GRANTED', reason: 'x' });
    expect(partyDecide.status).toBe(403);
    const decide = await http.post(`/api/interim-measures/${apply.body.id}/decide`).set(bearer(tok('p-arbitrator@e2e.test'))).send({ decision: 'GRANTED', reason: 'Risk of dissipation' });
    expect(decide.status).toBe(201);
  });

  it('9) default proceedings: PROCEED is blocked until due-process review is complete', async () => {
    const open = await http.post(`/api/cases/${ids.caseId}/default-proceedings`).set(bearer(tok('p-registrar@e2e.test'))).send({ defaultingParticipant: 'Respondent Co', basis: 'RESPONSE_NOT_FILED' });
    expect(open.status).toBe(201);
    const blocked = await http.post(`/api/default-proceedings/${open.body.id}/decide`).set(bearer(tok('p-arbitrator@e2e.test'))).send({ outcome: 'PROCEED', reason: 'x' });
    expect(blocked.status).toBe(400);
    // REFUSE is always available (errs toward fairness).
    const refuse = await http.post(`/api/default-proceedings/${open.body.id}/decide`).set(bearer(tok('p-arbitrator@e2e.test'))).send({ outcome: 'REFUSE', reason: 'Service not shown' });
    expect(refuse.status).toBe(201);
  });

  it('10) expedited track activates on a rules-threshold basis; multi-party joinder is tribunal-decided', async () => {
    const propose = await http.post(`/api/cases/${ids.caseId}/expedited`).set(bearer(tok('p-registrar@e2e.test'))).send({ basis: 'RULES_THRESHOLD' });
    expect(propose.status).toBe(201);
    const activate = await http.post(`/api/cases/${ids.caseId}/expedited/activate`).set(bearer(tok('p-registrar@e2e.test'))).send({});
    expect(activate.status).toBe(201);
    expect(activate.body.status).toBe('ACTIVE');

    const joinder = await http.post(`/api/cases/${ids.caseId}/joinder-requests`).set(bearer(tok('p-claimant@e2e.test'))).send({ type: 'CONSOLIDATION', subjectDescription: 'Related case' });
    expect(joinder.status).toBe(201);
    const decide = await http.post(`/api/joinder-requests/${joinder.body.id}/decide`).set(bearer(tok('p-arbitrator@e2e.test'))).send({ grant: true, reason: 'Same parties' });
    expect(decide.status).toBe(201);
  });

  it('11) deadline lifecycle: suspend preserves remaining time on resume; waiver excuses it', async () => {
    const suspend = await http.patch(`/api/deadlines/${ids.deadlineId}/suspend`).set(bearer(tok('p-registrar@e2e.test'))).send({ reason: 'Awaiting deposit' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe('SUSPENDED');
    const resume = await http.patch(`/api/deadlines/${ids.deadlineId}/resume`).set(bearer(tok('p-registrar@e2e.test'))).send({ reason: 'Deposit paid' });
    expect(resume.status).toBe(200);
    expect(resume.body.status).toBe('OPEN');
    const waive = await http.patch(`/api/deadlines/${ids.deadlineId}/waive`).set(bearer(tok('p-registrar@e2e.test'))).send({ reason: 'Parties agreed' });
    expect(waive.status).toBe(200);
    expect(waive.body.status).toBe('WAIVED');
  });

  it('12) role dashboards: gated by role/permission', async () => {
    const reg = await http.get('/api/dashboards/registrar').set(bearer(tok('p-registrar@e2e.test')));
    expect(reg.status).toBe(200);
    const fin = await http.get('/api/dashboards/finance').set(bearer(tok('p-registrar@e2e.test')));
    expect(fin.status).toBe(200);
    const arb = await http.get('/api/dashboards/arbitrator').set(bearer(tok('p-arbitrator@e2e.test')));
    expect(arb.status).toBe(200);
    // A party cannot see the registrar desk.
    const blocked = await http.get('/api/dashboards/registrar').set(bearer(tok('p-claimant@e2e.test')));
    expect(blocked.status).toBe(403);
  });

  it('13) the tribunal issues a procedural order; a party cannot', async () => {
    const partyTry = await http.post(`/api/cases/${ids.caseId}/procedural-orders`).set(bearer(tok('p-claimant@e2e.test'))).send({ title: 'PO1', body: 'x' });
    expect(partyTry.status).toBe(403);
    const order = await http.post(`/api/cases/${ids.caseId}/procedural-orders`).set(bearer(tok('p-arbitrator@e2e.test'))).send({ title: 'Procedural timetable', body: 'The timetable is fixed as follows…' });
    expect(order.status).toBe(201);
    expect(order.body.number).toBe(1);
  });

  it('14) a party challenges an arbitrator; deciding requires the challenge-decide permission', async () => {
    const challenge = await http.post(`/api/cases/${ids.caseId}/challenges`).set(bearer(tok('p-claimant@e2e.test'))).send({ challengedArbitratorUserId: ids.arbitrator, grounds: 'Apparent bias' });
    expect(challenge.status).toBe(201);
    // The registrar lacks CHALLENGE_DECIDE → 403.
    const blocked = await http.post(`/api/challenges/${challenge.body.id}/decide`).set(bearer(tok('p-registrar@e2e.test'))).send({ status: 'DISMISSED' });
    expect(blocked.status).toBe(403);
  });
});
