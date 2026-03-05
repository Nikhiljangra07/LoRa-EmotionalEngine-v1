import { computeMemorySummary } from '../memorySummary';

describe('computeMemorySummary', () => {
  it('counts unique bootstrap themes across entries', () => {
    const summary = computeMemorySummary({
      anchorCount: 3,
      schemaCount: 8,
      bootstrapEntries: [
        { themes: ['discipline', 'focus'] },
        { themes: ['discipline'] },
      ],
    });
    expect(summary.bootstrapThemeCount).toBe(2);
    expect(summary.anchorCount).toBe(3);
    expect(summary.schemaCount).toBe(8);
  });

  it('ignores undefined themes', () => {
    const summary = computeMemorySummary({
      anchorCount: 0,
      schemaCount: 0,
      bootstrapEntries: [{ themes: ['a'] }, {}, { themes: ['b'] }],
    });
    expect(summary.bootstrapThemeCount).toBe(2);
  });

  it('returns zero theme count for empty entries', () => {
    const summary = computeMemorySummary({
      anchorCount: 0,
      schemaCount: 0,
      bootstrapEntries: [],
    });
    expect(summary.bootstrapThemeCount).toBe(0);
  });
});
