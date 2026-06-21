import { RuleEngineService } from './rule-engine.service';
import { RuleActionKind, RuleExecutionStatus } from '@prisma/client';

/**
 * The engine is the operational core: a recorded procedural event must drive the
 * workflow within the case's PINNED rule version, materialise deadlines, record
 * provenance, and never duplicate work when an event is re-processed.
 */
describe('RuleEngineService.applyEvent', () => {
  const event = {
    id: 'e1',
    caseId: 'c1',
    type: 'NOTICE_SERVED',
    occurredAt: new Date('2026-05-01T09:00:00.000Z'),
    effectiveDate: new Date('2026-05-01T09:00:00.000Z'),
    metadata: null as string | null,
  };

  function makeEngine(opts: {
    actions: { kind: RuleActionKind; definitionKey?: string | null; targetKey?: string | null; paramsJson?: string | null }[];
    conditionJson?: string | null;
    existingDeadline?: { id: string } | null;
    existingExecution?: unknown | null;
  }) {
    const deadlineCreate = jest.fn().mockResolvedValue({ id: 'd1' });
    const executionCreate = jest.fn().mockImplementation(({ data }) => ({ id: 'x1', status: data.status }));
    const auditCreate = jest.fn().mockResolvedValue({});
    const triggerFindMany = jest.fn().mockResolvedValue([
      {
        ruleId: 'r1',
        conditionJson: opts.conditionJson ?? null,
        rule: { number: '5.1' },
        actions: opts.actions.map((a, i) => ({ definitionKey: null, targetKey: null, paramsJson: null, sortOrder: i, ...a })),
      },
    ]);

    const prisma = {
      case: { findUnique: jest.fn().mockResolvedValue({ reference: 'GAAP-2026-1' }) },
      caseRuleSet: { findUnique: jest.fn().mockResolvedValue({ ruleSetVersionId: 'v1' }) },
      caseProceduralEvent: { findFirst: jest.fn().mockResolvedValue(event) },
      ruleTrigger: { findMany: triggerFindMany },
      ruleDeadlineDefinition: {
        findFirst: jest.fn().mockResolvedValue({
          key: 'RESPONSE_TO_NOTICE', ruleId: 'r1', days: 30, dayKind: 'CALENDAR',
          label: 'Response to Notice of Arbitration', requiredAction: 'File the Response.',
          reminderRule: 'P7D,P2D,P1D', responsibleRole: 'RESPONDENT',
        }),
      },
      deadline: { findFirst: jest.fn().mockResolvedValue(opts.existingDeadline ?? null), create: deadlineCreate },
      caseRuleExecution: { findFirst: jest.fn().mockResolvedValue(opts.existingExecution ?? null), create: executionCreate },
      ruleAuditLog: { create: auditCreate },
    };
    const audit = { record: jest.fn() };
    const notifications = { notifyCaseMembers: jest.fn().mockResolvedValue(undefined) };
    const engine = new RuleEngineService(prisma as never, audit as never, notifications as never);
    return { engine, prisma, deadlineCreate, executionCreate, auditCreate, triggerFindMany };
  }

  const apply = (engine: RuleEngineService) =>
    engine.applyEvent({ caseId: 'c1', eventId: 'e1', eventType: 'NOTICE_SERVED', actorUserId: 'u1' });

  it('materialises a deadline and records an execution + immutable audit row', async () => {
    const { engine, deadlineCreate, executionCreate, auditCreate } = makeEngine({
      actions: [{ kind: RuleActionKind.CREATE_DEADLINE, definitionKey: 'RESPONSE_TO_NOTICE' }],
    });
    const results = await apply(engine);

    expect(deadlineCreate).toHaveBeenCalledTimes(1);
    // 30 calendar days: exclude the trigger day, start the next day (05-02) → 06-01.
    const created = deadlineCreate.mock.calls[0][0].data;
    expect((created.dueAt as Date).toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(created.definitionKey).toBe('RESPONSE_TO_NOTICE');
    expect(executionCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ actionKind: RuleActionKind.CREATE_DEADLINE, status: RuleExecutionStatus.EXECUTED, createdEntityType: 'Deadline' });
  });

  it('resolves triggers ONLY within the case pinned rule version', async () => {
    const { engine, triggerFindMany } = makeEngine({ actions: [{ kind: RuleActionKind.CREATE_DEADLINE, definitionKey: 'RESPONSE_TO_NOTICE' }] });
    await apply(engine);
    const where = triggerFindMany.mock.calls[0][0].where;
    expect(where.rule.versionId).toBe('v1');
    expect(where.eventType).toBe('NOTICE_SERVED');
    expect(where.active).toBe(true);
  });

  it('is idempotent: an existing deadline for the same event is not duplicated', async () => {
    const { engine, deadlineCreate } = makeEngine({
      actions: [{ kind: RuleActionKind.CREATE_DEADLINE, definitionKey: 'RESPONSE_TO_NOTICE' }],
      existingDeadline: { id: 'd1' },
    });
    const results = await apply(engine);
    expect(deadlineCreate).not.toHaveBeenCalled();
    expect(results[0].status).toBe(RuleExecutionStatus.SKIPPED);
  });

  it('advisory actions (REQUIRE_NOTICE) record a worklist item, never a deadline', async () => {
    const { engine, deadlineCreate, executionCreate } = makeEngine({
      actions: [{ kind: RuleActionKind.REQUIRE_NOTICE, targetKey: 'Certificate of Electronic Service' }],
    });
    const results = await apply(engine);
    expect(deadlineCreate).not.toHaveBeenCalled();
    expect(executionCreate).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ actionKind: RuleActionKind.REQUIRE_NOTICE, status: RuleExecutionStatus.EXECUTED });
  });

  it('advisory actions are idempotent when already recorded for the event', async () => {
    const { engine, executionCreate } = makeEngine({
      actions: [{ kind: RuleActionKind.REQUIRE_NOTICE, targetKey: 'Certificate of Electronic Service' }],
      existingExecution: { id: 'x0' },
    });
    const results = await apply(engine);
    expect(executionCreate).not.toHaveBeenCalled();
    expect(results[0].status).toBe(RuleExecutionStatus.SKIPPED);
  });

  it('does nothing when a JSON condition guard does not match the event metadata', async () => {
    const { engine, deadlineCreate } = makeEngine({
      actions: [{ kind: RuleActionKind.CREATE_DEADLINE, definitionKey: 'RESPONSE_TO_NOTICE' }],
      conditionJson: JSON.stringify({ track: 'EXPEDITED' }),
    });
    const results = await apply(engine);
    expect(deadlineCreate).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });

  it('returns nothing when the case is not pinned to a rule version', async () => {
    const { engine, prisma } = makeEngine({ actions: [{ kind: RuleActionKind.CREATE_DEADLINE, definitionKey: 'X' }] });
    prisma.caseRuleSet.findUnique.mockResolvedValueOnce(null);
    expect(await apply(engine)).toEqual([]);
  });
});
