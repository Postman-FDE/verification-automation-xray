/**
 * Unit tests for protocol selection (run-selection.js).
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseInteractiveSelection, resolveProtocolIndices, resolveTestLevel } from './run-selection.js';

const MOCK_PROTOCOLS = [
  { key: 'PF-501', summary: 'Protocol A' },
  { key: 'PF-502', summary: 'Protocol B' },
  { key: 'PF-503', summary: 'Protocol C' }
];

describe('parseInteractiveSelection', () => {
  it('returns all indices when selection is "all"', () => {
    assert.deepStrictEqual(
      parseInteractiveSelection('all', MOCK_PROTOCOLS),
      [0, 1, 2]
    );
  });

  it('is case-insensitive for "all"', () => {
    assert.deepStrictEqual(parseInteractiveSelection('ALL', MOCK_PROTOCOLS), [0, 1, 2]);
    assert.deepStrictEqual(parseInteractiveSelection('All', MOCK_PROTOCOLS), [0, 1, 2]);
  });

  it('parses comma-separated 1-based numbers', () => {
    assert.deepStrictEqual(
      parseInteractiveSelection('1,3', MOCK_PROTOCOLS),
      [0, 2]
    );
    assert.deepStrictEqual(
      parseInteractiveSelection('2', MOCK_PROTOCOLS),
      [1]
    );
  });

  it('ignores out-of-range and invalid entries', () => {
    assert.deepStrictEqual(
      parseInteractiveSelection('1,99,2,-1,0', MOCK_PROTOCOLS),
      [0, 1]
    );
    assert.deepStrictEqual(
      parseInteractiveSelection('1, x, 2', MOCK_PROTOCOLS),
      [0, 1]
    );
  });

  it('trims whitespace around numbers', () => {
    assert.deepStrictEqual(
      parseInteractiveSelection('  1 , 3  ', MOCK_PROTOCOLS),
      [0, 2]
    );
  });

  it('returns empty array for empty protocols', () => {
    assert.deepStrictEqual(parseInteractiveSelection('all', []), []);
    assert.deepStrictEqual(parseInteractiveSelection('1,2', []), []);
  });

  it('returns empty array when no valid numbers', () => {
    assert.deepStrictEqual(parseInteractiveSelection('', MOCK_PROTOCOLS), []);
    assert.deepStrictEqual(parseInteractiveSelection('x,y,z', MOCK_PROTOCOLS), []);
  });
});

describe('resolveProtocolIndices', () => {
  it('resolves by Jira key (case-insensitive to uppercase)', () => {
    assert.deepStrictEqual(
      resolveProtocolIndices(['PF-502', 'pf-503'], MOCK_PROTOCOLS),
      [1, 2]
    );
    assert.deepStrictEqual(
      resolveProtocolIndices(['PF-501'], MOCK_PROTOCOLS),
      [0]
    );
  });

  it('resolves by 1-based list number', () => {
    assert.deepStrictEqual(
      resolveProtocolIndices(['1', '3'], MOCK_PROTOCOLS),
      [0, 2]
    );
    assert.deepStrictEqual(
      resolveProtocolIndices(['2'], MOCK_PROTOCOLS),
      [1]
    );
  });

  it('mixes keys and numbers', () => {
    assert.deepStrictEqual(
      resolveProtocolIndices(['PF-503', '1', '2'], MOCK_PROTOCOLS),
      [2, 0, 1]
    );
  });

  it('omits unmatched inputs', () => {
    assert.deepStrictEqual(
      resolveProtocolIndices(['PF-999', '1', 'PF-502'], MOCK_PROTOCOLS),
      [0, 1]
    );
    assert.deepStrictEqual(
      resolveProtocolIndices(['PF-999', '99'], MOCK_PROTOCOLS),
      []
    );
  });

  it('trims input', () => {
    assert.deepStrictEqual(
      resolveProtocolIndices(['  PF-502  ', '  2  '], MOCK_PROTOCOLS),
      [1, 1]
    );
  });

  it('returns empty for null/empty protocolKeys', () => {
    assert.deepStrictEqual(resolveProtocolIndices(null, MOCK_PROTOCOLS), []);
    assert.deepStrictEqual(resolveProtocolIndices([], MOCK_PROTOCOLS), []);
  });

  it('returns empty when protocols list is empty', () => {
    assert.deepStrictEqual(resolveProtocolIndices(['PF-501', '1'], []), []);
  });
});

const TEST_LEVELS = ['Dev', 'IV', 'VV'];

describe('resolveTestLevel', () => {
  it('resolves by 1-based number', () => {
    assert.strictEqual(resolveTestLevel('1', TEST_LEVELS), 'Dev');
    assert.strictEqual(resolveTestLevel('2', TEST_LEVELS), 'IV');
    assert.strictEqual(resolveTestLevel('3', TEST_LEVELS), 'VV');
  });

  it('resolves by exact canonical name', () => {
    assert.strictEqual(resolveTestLevel('Dev', TEST_LEVELS), 'Dev');
    assert.strictEqual(resolveTestLevel('IV', TEST_LEVELS), 'IV');
    assert.strictEqual(resolveTestLevel('VV', TEST_LEVELS), 'VV');
  });

  it('is case-insensitive for names', () => {
    assert.strictEqual(resolveTestLevel('dev', TEST_LEVELS), 'Dev');
    assert.strictEqual(resolveTestLevel('iv', TEST_LEVELS), 'IV');
    assert.strictEqual(resolveTestLevel('vv', TEST_LEVELS), 'VV');
    assert.strictEqual(resolveTestLevel('DEV', TEST_LEVELS), 'Dev');
  });

  it('trims whitespace', () => {
    assert.strictEqual(resolveTestLevel('  1  ', TEST_LEVELS), 'Dev');
    assert.strictEqual(resolveTestLevel('  dev  ', TEST_LEVELS), 'Dev');
  });

  it('number takes priority over name match', () => {
    // "1" should resolve to index 0 (Dev), not be treated as a name
    assert.strictEqual(resolveTestLevel('1', TEST_LEVELS), 'Dev');
  });

  it('returns null for out-of-range number', () => {
    assert.strictEqual(resolveTestLevel('0', TEST_LEVELS), null);
    assert.strictEqual(resolveTestLevel('4', TEST_LEVELS), null);
    assert.strictEqual(resolveTestLevel('99', TEST_LEVELS), null);
  });

  it('returns null for unrecognised name', () => {
    assert.strictEqual(resolveTestLevel('QA', TEST_LEVELS), null);
    assert.strictEqual(resolveTestLevel('', TEST_LEVELS), null);
    assert.strictEqual(resolveTestLevel('Production', TEST_LEVELS), null);
  });
});
