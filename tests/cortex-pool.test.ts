import { test, type TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { CortexPool } from '../src/cortex-pool';

function createPool(t: TestContext, url?: string): CortexPool {
  const pool = new CortexPool(':memory:', url);
  t.after(() => pool.close());
  return pool;
}

async function serve(t: TestContext, handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('co-reference upserts the latest entity', t => {
  const pool = createPool(t);
  const alice = pool.addEntity('Alice', 'person');
  const bob = pool.addEntity('Bob', 'person');
  pool.addCoReference('she', alice);
  pool.addCoReference('she', bob);
  assert.equal(pool.resolveCoReference('she')?.id, bob);
  assert.equal((pool as any).db.prepare('SELECT count(*) AS n FROM co_references').get().n, 1);
});

test('TPC search encodes query and accepts primary results', async t => {
  const url = await serve(t, (req, res) => {
    const request = new URL(req.url!, 'http://localhost');
    assert.equal(request.searchParams.get('q'), 'alpha & beta');
    assert.equal(request.searchParams.get('type'), 'thought');
    assert.equal(request.searchParams.get('limit'), '3');
    res.end(JSON.stringify([{ id: 1 }]));
  });
  assert.deepEqual(await createPool(t, url).fetchFromTPC('alpha & beta', 3), [{ id: 1 }]);
});

test('TPC search retries legacy type on an actual HTTP error', async t => {
  const calls: string[] = [];
  const url = await serve(t, (req, res) => {
    const type = new URL(req.url!, 'http://localhost').searchParams.get('type')!;
    calls.push(type);
    res.statusCode = type === 'thought' ? 400 : 200;
    res.end(JSON.stringify(type === 'thought' ? { error: 'unsupported type' } : [{ id: 2 }]));
  });
  assert.deepEqual(await createPool(t, url).fetchFromTPC('beta'), [{ id: 2 }]);
  assert.deepEqual(calls, ['thought', 'thoughts']);
});

test('TPC returns [] after both search attempts fail', async t => {
  const pool = createPool(t);
  let calls = 0;
  (pool as any).httpRequest = async () => { calls++; throw new Error('offline'); };
  assert.deepEqual(await pool.fetchFromTPC('gamma'), []);
  assert.equal(calls, 2);
});

test('TPC sync counts HTTP failures and excludes expired facts', async t => {
  const bodies: any[] = [];
  const url = await serve(t, (req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      bodies.push(JSON.parse(body));
      res.statusCode = bodies.length === 1 ? 201 : 503;
      res.end('{}');
    });
  });
  const pool = createPool(t, url);
  pool.addFact({ subject: 'Alice', predicate: 'uses', content: 'SQLite' });
  pool.addFact({ subject: 'Bob', predicate: 'uses', content: 'TypeScript' });
  pool.addFact({ subject: 'Expired', predicate: 'is', content: 'old', tier: 'episodic', ttl: 0 });
  assert.deepEqual(await pool.syncToTPC(), { synced: 1, failed: 1 });
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].tags, ['cortexpool', 'semantic', 'uses']);
  assert.match(bodies[0].content, /SQLite/);
});

test('direct TPC sync rejects transport errors', async t => {
  const pool = createPool(t, 'ftp://localhost');
  await assert.rejects(pool.syncFactToTPC({ subject: 'A', predicate: 'is', content: 'test', tier: 'semantic' }), /Failed to sync/);
});

test('TTL cleanup removes dependent pool and contradiction records with foreign keys enabled', t => {
  const pool = createPool(t);
  const db = (pool as any).db;
  db.pragma('foreign_keys = ON');
  const first = pool.addFact({ subject: 'A', predicate: 'is', content: 'first', tier: 'episodic', ttl: 1000 });
  const second = pool.addFact({ subject: 'A', predicate: 'is', content: 'second' });
  pool.retrieve(['A']);
  pool.detectContradictions();
  db.prepare('UPDATE facts SET createdAt = 0 WHERE id = ?').run(first);
  assert.equal(pool.cleanupExpiredEpisodic(), 1);
  assert.equal(pool.getFact(first), null);
  assert.ok(pool.getFact(second));
  assert.equal(db.prepare('SELECT count(*) AS n FROM pool WHERE factId = ?').get(first).n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM contradictions').get().n, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(pool.cleanupExpiredEpisodic(), 0);
});

test('retrieval and reflection automatically expire episodic memories; zero TTL is honored', async t => {
  const pool = createPool(t);
  const expired = pool.addFact({ subject: 'A', predicate: 'is', content: 'expired', tier: 'episodic', ttl: 0 });
  const live = pool.addFact({ subject: 'A', predicate: 'is', content: 'live', tier: 'episodic' });
  assert.deepEqual(pool.retrieve(['A']).map(f => f.id), [live]);
  assert.equal(pool.getFact(expired), null);
  const another = pool.addFact({ subject: 'B', predicate: 'is', content: 'expired', tier: 'episodic', ttl: 0 });
  await pool.reflect();
  assert.equal(pool.getFact(another), null);
});

test('invalid TTL is rejected before creating entities', t => {
  const pool = createPool(t);
  for (const ttl of [-1, Infinity, NaN]) {
    assert.throws(() => pool.addFact({ subject: 'Invalid', predicate: 'is', content: 'invalid', ttl }), RangeError);
  }
  assert.equal(JSON.parse(pool.export()).entities.length, 0);
});

test('entity aliases match whole normalized names, not SQL wildcards or substrings', t => {
  const pool = createPool(t);
  const id = pool.addEntity('Alice Wonderland');
  assert.equal(pool.resolveEntity(' ALICE WONDERLAND ')?.id, id);
  assert.equal(pool.resolveEntity('Alice'), null);
  assert.equal(pool.resolveEntity('%'), null);
  assert.equal(pool.resolveEntity('_'), null);
});

test('compression merges three facts without losing counts or leaving dangling references', async t => {
  const pool = createPool(t);
  const db = (pool as any).db;
  db.pragma('foreign_keys = ON');
  const ids = Array.from({ length: 3 }, () => pool.addFact({
    subject: 'Alice', predicate: 'uses', object: 'SQLite', content: 'Alice uses SQLite'
  }));
  ids.forEach(id => pool.useFact(id));
  pool.retrieve(['Alice']);
  const result = await pool.reflect();
  assert.equal(result.compressed, 2);
  assert.equal(pool.getFact(ids[0])?.useCount, 3);
  assert.equal(pool.getFact(ids[1]), null);
  assert.equal(pool.getFact(ids[2]), null);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('compression preserves facts about different objects and distinct edge content', async t => {
  const pool = createPool(t);
  const facts = [
    { object: 'SQLite', content: 'Alice uses SQLite every day' },
    { object: 'Postgres', content: 'Alice uses SQLite every day' },
    { object: 'SQLite', content: 'The production database is backed up at midnight' }
  ];
  const ids = facts.map(f => pool.addFact({ subject: 'Alice', predicate: 'uses', ...f }));
  await pool.reflect();
  ids.forEach(id => assert.ok(pool.getFact(id)));
});

test('activation persistence inserts only new history entries per retrieval', t => {
  const pool = createPool(t);
  const entityId = pool.addEntity('Alice');
  pool.retrieve(['Alice']);
  pool.retrieve(['Alice']);
  const rows = (pool as any).db.prepare('SELECT * FROM activation_history').all();
  assert.equal(rows.length, 2);
  assert.equal(pool.getActivationHistory(entityId).length, 2);
});
