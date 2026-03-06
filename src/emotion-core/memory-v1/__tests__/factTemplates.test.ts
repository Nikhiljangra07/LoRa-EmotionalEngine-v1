import { extractStructuredFact } from '../factTemplates';

describe('factTemplates', () => {
  describe('deployment_plan / launch_date', () => {
    it('extracts launch_date and normalizes to ISO date', () => {
      const r = extractStructuredFact('I will deploy on March 23 2026');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('deployment_plan');
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toBe('2026-03-23');
    });

    it('parses "deploy on 23rd march 2026" → value 2026-03-23', () => {
      const r = extractStructuredFact('deploy on 23rd march 2026');
      expect(r).not.toBeNull();
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toBe('2026-03-23');
    });

    it('parses Nikhil fixture: "app is almost ready and i am planning to deploy on 23rd march 2026"', () => {
      const r = extractStructuredFact('app is almost ready and i am planning to deploy on 23rd march 2026');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('deployment_plan');
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toBe('2026-03-23');
    });

    it('extracts from "deploying X on Date"', () => {
      const r = extractStructuredFact('We are deploying the app on April 15, 2026');
      expect(r).not.toBeNull();
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toBe('2026-04-15');
    });

    it('extracts "I will deploy March 13 2026" (no "on") → 2026-03-13', () => {
      const r = extractStructuredFact('I will deploy March 13 2026');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('deployment_plan');
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toBe('2026-03-13');
    });

    it('extracts update verb "change it to March 8 2026" → 2026-03-08', () => {
      const r = extractStructuredFact('Actually change it to March 8 2026');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('deployment_plan');
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toBe('2026-03-08');
    });

    it('extracts "change to March 8 2026" (no "it")', () => {
      const r = extractStructuredFact('Change to March 8 2026');
      expect(r).not.toBeNull();
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toBe('2026-03-08');
    });

    it('extracts update verb "reschedule to March 10" → normalized date', () => {
      const r = extractStructuredFact('reschedule to March 10');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('deployment_plan');
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((r!.value as string).endsWith('03-10')).toBe(true);
    });

    it('extracts update verb "move it to April 2" → normalized date', () => {
      const r = extractStructuredFact('move it to April 2');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('deployment_plan');
      expect(r!.slot).toBe('launch_date');
      expect(r!.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((r!.value as string).endsWith('04-02')).toBe(true);
    });

    it('extracts "shift it to March 20 2026" and "update to April 1 2026"', () => {
      expect(extractStructuredFact('shift it to March 20 2026')!.value).toBe('2026-03-20');
      expect(extractStructuredFact('update to April 1 2026')!.value).toBe('2026-04-01');
    });

    it('returns only type/slot/value (no transcript stored)', () => {
      const r = extractStructuredFact('change it to March 8 2026');
      expect(r).not.toBeNull();
      expect(Object.keys(r!)).toEqual(['type', 'slot', 'value']);
      expect(r!.type).toBe('deployment_plan');
      expect(r!.slot).toBe('launch_date');
      expect(typeof r!.value).toBe('string');
    });
  });

  describe('financial_commitment / money_amount', () => {
    it('extracts money amount from $2000', () => {
      const r = extractStructuredFact('Should I borrow $2000?');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('financial_commitment');
      expect(r!.slot).toBe('money_amount');
      expect(r!.value).toBe(2000);
    });

    it('extracts from "need $X"', () => {
      const r = extractStructuredFact('I need $5,000 for the project');
      expect(r).not.toBeNull();
      expect(r!.value).toBe(5000);
    });
  });

  describe('project_stage / stage', () => {
    it('extracts stage from pre-launch', () => {
      const r = extractStructuredFact('We are pre-launch right now');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('project_stage');
      expect(r!.slot).toBe('stage');
      expect(r!.value).toBeTruthy();
    });
  });

  describe('goal / objective', () => {
    it('extracts objective from "goal is to"', () => {
      const r = extractStructuredFact('My goal is to ship by Q2');
      expect(r).not.toBeNull();
      expect(r!.type).toBe('goal');
      expect(r!.slot).toBe('objective');
      expect(typeof r!.value).toBe('string');
      expect((r!.value as string).length).toBeGreaterThan(0);
    });
  });

  describe('no match', () => {
    it('returns null for unrelated text', () => {
      expect(extractStructuredFact('Hello how are you')).toBeNull();
      expect(extractStructuredFact('')).toBeNull();
    });
  });
});
