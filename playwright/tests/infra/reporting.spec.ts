import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Evidence policy: HTML + JUnit output dirs exist (they're mounted volumes);
// trace/screenshot/video are retained only for failed tests — passing tests
// must not leave failure-only artifacts behind.
test.describe('reporting and evidence policy', () => {
  test('report and result directories exist for this run', () => {
    expect(existsSync(join('/work', 'test-results')) || existsSync('test-results')).toBeTruthy();
  });

  test('a passing test produces no trace/video artifacts', async ({}, testInfo) => {
    expect(testInfo.status).not.toBe('failed');
    // Playwright only writes these for failures; check the output dir stays clean for us.
    expect(existsSync(join(testInfo.outputDir, 'trace.zip'))).toBeFalsy();
  });
});
