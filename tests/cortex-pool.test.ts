import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CortexPool } from '../src/cortex-pool';

function createTempDbPath(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortexpool-test-'));
  return { dir, dbPath: path.join(dir, 'test.db') };
}

test('addCoReference upserts existing pronoun and resolveCoReference returns latest entity', () => {
  const { dir, dbPath } = createTempDbPath();
  try {
    const pool = new CortexPool(dbPath);

    const firstEntityId = pool.addEntity('Alice', 'person');
    const secondEntityId = pool.addEntity('Bob', 'person');

    assert.doesNotThrow(() => pool.addCoReference('she', firstEntityId, 'first mention'));
    assert.doesNotThrow(() => pool.addCoReference('she', secondEntityId, 'updated mention'));

    const db = (pool as any).db;
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM co_references WHERE pronoun = ?').get('she') as { count: number };
    assert.equal(countRow.count, 1);

    const resolved = pool.resolveCoReference('she');
    assert.ok(resolved);
    assert.equal(resolved.id, secondEntityId);
    assert.equal(resolved.name, 'Bob');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetchFromTPC succeeds when /search type=thought returns array', async () => {
  const { dir, dbPath } = createTempDbPath();
  try {
    const pool = new CortexPool(dbPath);
    const expected = [{ id: 1, content: 'ok' }];
    const calls: string[] = [];

    (pool as any).httpRequest = async (_method: string, requestPath: string) => {
      calls.push(requestPath);
      return expected;
    };

    const result = await pool.fetchFromTPC('alpha', 3);
    assert.deepEqual(result, expected);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('type=thought'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetchFromTPC retries once with type=thoughts when type=thought throws', async () => {
  const { dir, dbPath } = createTempDbPath();
  try {
    const pool = new CortexPool(dbPath);
    const expected = [{ id: 2, content: 'fallback' }];
    const calls: string[] = [];

    (pool as any).httpRequest = async (_method: string, requestPath: string) => {
      calls.push(requestPath);
      if (requestPath.includes('type=thought&')) {
        throw new Error('primary failed');
      }
      if (requestPath.includes('type=thoughts&')) {
        return expected;
      }
      return [];
    };

    const result = await pool.fetchFromTPC('beta', 5);
    assert.deepEqual(result, expected);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('type=thought'));
    assert.ok(calls[1].includes('type=thoughts'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetchFromTPC returns [] when both thought and thoughts fail', async () => {
  const { dir, dbPath } = createTempDbPath();
  try {
    const pool = new CortexPool(dbPath);

    (pool as any).httpRequest = async () => {
      throw new Error('failed');
    };

    const result = await pool.fetchFromTPC('gamma', 2);
    assert.deepEqual(result, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
