import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { adminDatabaseUrl, e2eDatabaseUrl, E2E_PASSWORD, E2E_PEPPER, E2E_SCHEMA } from './e2e-db';

// Set env BEFORE the app (and Prisma client) initialise.
process.env.DATABASE_URL = e2eDatabaseUrl();
process.env.PASSWORD_PEPPER = E2E_PEPPER;
process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';
process.env.RATE_LIMIT_MAX = '100000'; // don't throttle the test run

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Arbitration platform (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  const ids: Record<string, string> = {};
  // Tokens are obtained once per user (the login endpoint is rate-limited).
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    // Reset the isolated schema, then apply migrations to it.
    execSync(`npx prisma db execute --url "${adminDatabaseUrl()}" --stdin`, {
      input: `DROP SCHEMA IF EXISTS ${E2E_SCHEMA} CASCADE; CREATE SCHEMA ${E2E_SCHEMA};`,
      cwd: process.cwd(),
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
      stdio: 'ignore',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Rate limiting is exercised in unit scope; disable it here so the flow can log in freely.
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
          email,
          passwordHash,
          status: 'ACTIVE',
          emailVerified: true,
          profile: { create: { firstName: name, lastName: 'E2E', displayName: name } },
          roles: { create: roles.map((role) => ({ role: role as never })) },
        },
      });
      return u.id;
    };

    ids.claimant = await mkUser('claimant@e2e.test', ['COMPANY_CLIENT'], 'Claimant');
    ids.respondent = await mkUser('respondent@e2e.test', ['COMPANY_CLIENT'], 'Respondent');
    ids.outsider = await mkUser('outsider@e2e.test', ['INDIVIDUAL'], 'Outsider');
    ids.registrar = await mkUser('registrar@e2e.test', ['REGISTRAR'], 'Registrar');
    ids.superadmin = await mkUser('superadmin@e2e.test', ['SUPER_ADMIN'], 'SuperAdmin');
    ids.arbitrator = await mkUser('arbitrator@e2e.test', ['ARBITRATOR'], 'Arbitrator');

    const arbProfile = await prisma.arbitratorProfile.create({
      data: { userId: ids.arbitrator, fullName: 'Arbitrator E2E', approvalStatus: 'APPROVED', verificationStatus: 'VERIFIED' },
    });
    ids.arbProfile = arbProfile.id;

    // Case A — fully constituted (for access-control tests).
    const caseA = await prisma.case.create({
      data: {
        reference: 'E2E-A-0001',
        title: 'E2E Case A',
        stage: 'AWAITING_RESPONSE',
        language: 'en',
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
    ids.caseA = caseA.id;

    // Case B — claimant + registrar only (for the appointment critical flow).
    const caseB = await prisma.case.create({
      data: {
        reference: 'E2E-B-0001',
        title: 'E2E Case B',
        stage: 'TRIBUNAL_APPOINTMENT_PENDING',
        language: 'en',
        parties: { create: [{ side: 'CLAIMANT', legalName: 'Claimant Co' }] },
        teamMembers: { create: [{ userId: ids.claimant, caseRole: 'CLAIMANT', side: 'CLAIMANT' }, { userId: ids.registrar, caseRole: 'CASE_REGISTRAR' }] },
      },
    });
    ids.caseB = caseB.id;

    // Obtain one token per user up front to stay under the login rate limit.
    for (const email of [
      'claimant@e2e.test',
      'respondent@e2e.test',
      'outsider@e2e.test',
      'registrar@e2e.test',
      'superadmin@e2e.test',
      'arbitrator@e2e.test',
    ]) {
      const res = await http.post('/api/auth/login').send({ email, password: E2E_PASSWORD });
      tokens[email] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  // Returns the cached token for a user (login happens once in beforeAll).
  const login = async (email: string): Promise<string> => tokens[email];
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // ---- Authentication ----
  describe('authentication', () => {
    it('rejects a wrong password with 401', async () => {
      const res = await http.post('/api/auth/login').send({ email: 'claimant@e2e.test', password: 'nope' });
      expect(res.status).toBe(401);
    });

    it('issues an access token on valid credentials', async () => {
      const token = await login('claimant@e2e.test');
      expect(token).toBeTruthy();
      const me = await http.get('/api/auth/me').set(bearer(token));
      expect(me.status).toBe(200);
      expect(me.body.email).toBe('claimant@e2e.test');
    });

    it('blocks access without a token', async () => {
      const res = await http.get('/api/cases');
      expect(res.status).toBe(401);
    });
  });

  // ---- Case-level access ----
  describe('case access', () => {
    it('lets a claimant open their own case', async () => {
      const token = await login('claimant@e2e.test');
      const res = await http.get(`/api/cases/${ids.caseA}`).set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.reference).toBe('E2E-A-0001');
    });

    it('forbids an unrelated user from opening the case (403)', async () => {
      const token = await login('outsider@e2e.test');
      const res = await http.get(`/api/cases/${ids.caseA}`).set(bearer(token));
      expect(res.status).toBe(403);
    });
  });

  // ---- Tribunal deliberations ----
  describe('tribunal deliberations', () => {
    it('allows the appointed tribunal member', async () => {
      const token = await login('arbitrator@e2e.test');
      const res = await http.get(`/api/cases/${ids.caseA}/deliberations`).set(bearer(token));
      expect(res.status).toBe(200);
    });

    it('denies a party (claimant) — 403', async () => {
      const token = await login('claimant@e2e.test');
      const res = await http.get(`/api/cases/${ids.caseA}/deliberations`).set(bearer(token));
      expect(res.status).toBe(403);
    });

    it('denies the super administrator — 403', async () => {
      const token = await login('superadmin@e2e.test');
      const res = await http.get(`/api/cases/${ids.caseA}/deliberations`).set(bearer(token));
      expect(res.status).toBe(403);
    });
  });

  // ---- Document access ----
  describe('document access', () => {
    it('hides one side\'s PARTY_PRIVATE document from the opposing party but shows it to the tribunal', async () => {
      const claimantToken = await login('claimant@e2e.test');
      const upload = await http
        .post(`/api/cases/${ids.caseA}/documents`)
        .set(bearer(claimantToken))
        .field('title', 'Privileged memo')
        .field('category', 'PLEADING')
        .field('confidentiality', 'PARTY_PRIVATE')
        .attach('file', Buffer.from('claimant-only secret'), 'memo.txt');
      expect(upload.status).toBe(201);
      const docId = upload.body.id;

      const respondentToken = await login('respondent@e2e.test');
      const respList = await http.get(`/api/cases/${ids.caseA}/documents`).set(bearer(respondentToken));
      expect(respList.status).toBe(200);
      expect(respList.body.find((d: { id: string }) => d.id === docId)).toBeUndefined();

      // Direct fetch by the opposing party is forbidden.
      const respFetch = await http.get(`/api/documents/${docId}`).set(bearer(respondentToken));
      expect(respFetch.status).toBe(403);

      // The tribunal can see it.
      const arbToken = await login('arbitrator@e2e.test');
      const arbList = await http.get(`/api/cases/${ids.caseA}/documents`).set(bearer(arbToken));
      expect(arbList.body.find((d: { id: string }) => d.id === docId)).toBeDefined();
    });
  });

  // ---- Critical flow: appointment → constitution → award ----
  describe('critical flow: tribunal appointment and award', () => {
    it('runs invite → conflict disclosure → accept → constitute → award issue', async () => {
      const registrarToken = await login('registrar@e2e.test');
      const arbToken = await login('arbitrator@e2e.test');

      const invite = await http
        .post(`/api/cases/${ids.caseB}/appointments`)
        .set(bearer(registrarToken))
        .send({ arbitratorId: ids.arbProfile, proposedRole: 'SOLE' });
      expect(invite.status).toBe(201);

      const mine = await http.get('/api/appointments/mine').set(bearer(arbToken));
      const invitation = mine.body.find((i: { case: { reference: string } }) => i.case.reference === 'E2E-B-0001');
      expect(invitation).toBeDefined();

      const disclosure = await http
        .post(`/api/appointments/${invitation.id}/conflict-disclosure`)
        .set(bearer(arbToken))
        .send({ hasConflict: false, independenceDeclared: true, impartialityDeclared: true });
      expect(disclosure.status).toBe(201);

      const accept = await http
        .post(`/api/appointments/${invitation.id}/respond`)
        .set(bearer(arbToken))
        .send({ accept: true, feeAccepted: true, availabilityConfirmed: true });
      expect(accept.status).toBe(201);

      // Acceptance granted tribunal membership → the arbitrator can now reach deliberations on case B.
      const delib = await http.get(`/api/cases/${ids.caseB}/deliberations`).set(bearer(arbToken));
      expect(delib.status).toBe(200);

      const constitute = await http.post(`/api/cases/${ids.caseB}/tribunal/constitute`).set(bearer(registrarToken)).send({});
      expect(constitute.status).toBe(201);

      // Draft → sign → issue the award (tribunal only).
      const draft = await http.post(`/api/cases/${ids.caseB}/awards`).set(bearer(arbToken)).send({ type: 'FINAL' });
      expect(draft.status).toBe(201);
      const awardId = draft.body.id;

      await http.post(`/api/awards/${awardId}/sign`).set(bearer(arbToken)).send({});
      const issue = await http.post(`/api/awards/${awardId}/issue`).set(bearer(arbToken)).send({});
      expect(issue.status).toBe(201);
      expect(issue.body.deliveries).toBeGreaterThanOrEqual(1);
    });

    it('forbids the super administrator from drafting an award (403)', async () => {
      const saToken = await login('superadmin@e2e.test');
      const res = await http.post(`/api/cases/${ids.caseB}/awards`).set(bearer(saToken)).send({ type: 'INTERIM' });
      expect(res.status).toBe(403);
    });
  });
});
