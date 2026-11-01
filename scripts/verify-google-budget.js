// Uses a separate random key; never changes the production budget hash.
// Run with a test Redis environment: node --env-file=.env.test.local scripts/verify-google-budget.js
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { redisCommand, RESERVE_SCRIPT } from '../lib/google-budget.js';

const key = `swarm-generator:budget-test:${randomUUID()}`;
const reserve = (month = '2026-11') => redisCommand(['EVAL', RESERVE_SCRIPT, '1', key, month, '9000']);
try {
  assert.deepEqual(await reserve(), [-1, 0]);
  await redisCommand(['HSET', key, 'month', '2026-11', 'used', '8995']);
  await redisCommand(['EXPIRE', key, '300']);
  const results = await Promise.all(Array.from({ length: 20 }, () => reserve()));
  assert.equal(results.filter(([allowed]) => allowed === 1).length, 5);
  assert.equal(await redisCommand(['HGET', key, 'used']), '9000');
  assert.deepEqual(await reserve('2026-12'), [1, 1]);
  assert.deepEqual(await reserve('2026-11'), [-2, 0]);
  assert.equal(await redisCommand(['HGET', key, 'used']), '1');
  for (const [month, used] of [['broken', '0'], ['2026-00', '0'], ['2026-13', '0'], ['2026-11', '-1'], ['2026-11', '1.5'], ['2026-11', 'bad']]) {
    await redisCommand(['HSET', key, 'month', month, 'used', used]);
    assert.deepEqual(await reserve(), [-1, 0]);
  }
  console.log('PASS: actual Redis Lua concurrency, month rollover, stale month and corrupt data checks');
} finally {
  await redisCommand(['DEL', key]);
}
