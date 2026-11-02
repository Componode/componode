import { test, expect } from '@playwright/test';
import { diffNormalStack, type NormalStackState } from '../../scripts/normal-stack.js';

test.describe('normal-stack sentinel', () => {
  test('detects container disappearance, status drift, and additions', () => {
    const before: NormalStackState = { containers: { a: 'Up 1 hour', b: 'Up 1 hour' } };
    expect(diffNormalStack(before, { containers: { a: 'Up 1 hour' } }).join(' ')).toMatch(/disappeared/);
    expect(diffNormalStack(before, { containers: { a: 'Exited', b: 'Up 1 hour' } }).join(' ')).toMatch(/status/);
    expect(diffNormalStack(before, { containers: { a: 'Up 1 hour', b: 'Up 1 hour', c: 'Up 1s' } }).join(' ')).toMatch(/new container/);
    expect(diffNormalStack(before, before)).toEqual([]);
  });
});
