import { test, expect } from '@playwright/test';
import { validateCoverage } from '../../scripts/validate-coverage.js';

test.describe('coverage governance', () => {
  test('every implemented importer has a mock/test mapping in the matrix', () => {
    const result = validateCoverage();
    expect(result.missing).toEqual([]);
    expect(result.implemented).toEqual(
      expect.arrayContaining(['github', 'alibaba-cloud', 'docker', 'web-url', 'api-url']),
    );
  });

  test('scaffold importers are recorded as deferred, not implemented', () => {
    const result = validateCoverage();
    for (const s of result.scaffolds) {
      expect(result.implemented).not.toContain(s);
    }
  });
});
