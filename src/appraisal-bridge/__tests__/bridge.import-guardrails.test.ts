import * as fs from 'fs';
import * as path from 'path';

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const IMPORT_PATTERN =
  /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;

function getImportPaths(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: string[] = [];
  let match;
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

const ROOT = path.resolve(__dirname, '../../..');

describe('Architectural import guardrails', () => {
  test('emotion-core does not import from appraisal-lab', () => {
    const emotionCoreDir = path.join(ROOT, 'src/emotion-core');
    const files = collectTsFiles(emotionCoreDir);
    const violations: string[] = [];

    for (const file of files) {
      const imports = getImportPaths(file);
      for (const imp of imports) {
        if (imp.includes('appraisal-lab')) {
          violations.push(
            `${path.relative(ROOT, file)} imports "${imp}"`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('appraisal-lab does not import from emotion-core', () => {
    const appraisalDir = path.join(ROOT, 'src/appraisal-lab');
    const files = collectTsFiles(appraisalDir);
    const violations: string[] = [];

    for (const file of files) {
      const imports = getImportPaths(file);
      for (const imp of imports) {
        if (imp.includes('emotion-core')) {
          violations.push(
            `${path.relative(ROOT, file)} imports "${imp}"`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('appraisal-lab does not import from appraisal-bridge', () => {
    const appraisalDir = path.join(ROOT, 'src/appraisal-lab');
    const files = collectTsFiles(appraisalDir);
    const violations: string[] = [];

    for (const file of files) {
      const imports = getImportPaths(file);
      for (const imp of imports) {
        if (imp.includes('appraisal-bridge')) {
          violations.push(
            `${path.relative(ROOT, file)} imports "${imp}"`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
