import { describe, it, expect } from 'vitest';
import { CaseStage, ORDERED_STAGES, PROCEDURAL_PHASES, ProceduralPhase, phaseOfStage } from '@gaap/shared';

describe('procedural phase mapping', () => {
  it('assigns every linear (ordered) stage to exactly one phase', () => {
    for (const stage of ORDERED_STAGES) {
      const matches = PROCEDURAL_PHASES.filter((p) => p.stages.includes(stage));
      expect(matches).toHaveLength(1);
    }
  });

  it('maps representative stages to the expected phase', () => {
    expect(phaseOfStage(CaseStage.SUBMITTED)).toBe(ProceduralPhase.COMMENCEMENT);
    expect(phaseOfStage(CaseStage.NOTICE_BEING_SERVED)).toBe(ProceduralPhase.SERVICE);
    expect(phaseOfStage(CaseStage.TRIBUNAL_CONSTITUTED)).toBe(ProceduralPhase.TRIBUNAL_CONSTITUTION);
    expect(phaseOfStage(CaseStage.STATEMENT_OF_CLAIM)).toBe(ProceduralPhase.PLEADINGS);
    expect(phaseOfStage(CaseStage.WITNESS_EVIDENCE)).toBe(ProceduralPhase.EVIDENCE);
    expect(phaseOfStage(CaseStage.HEARING_IN_PROGRESS)).toBe(ProceduralPhase.HEARING);
    expect(phaseOfStage(CaseStage.AWARD_ISSUED)).toBe(ProceduralPhase.AWARD);
  });

  it('returns null for non-linear terminal states', () => {
    expect(phaseOfStage(CaseStage.SUSPENDED)).toBeNull();
    expect(phaseOfStage(CaseStage.WITHDRAWN)).toBeNull();
  });

  it('keeps phases in lifecycle order', () => {
    expect(PROCEDURAL_PHASES.map((p) => p.phase)).toEqual([
      ProceduralPhase.COMMENCEMENT, ProceduralPhase.SERVICE, ProceduralPhase.TRIBUNAL_CONSTITUTION,
      ProceduralPhase.PLEADINGS, ProceduralPhase.EVIDENCE, ProceduralPhase.HEARING, ProceduralPhase.AWARD,
    ]);
  });
});
