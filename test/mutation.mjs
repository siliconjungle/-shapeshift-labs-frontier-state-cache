import assert from 'node:assert';
import { createMutationPlan, select } from '@shapeshift-labs/frontier-mutation';
import { createQueryCache } from '../dist/index.js';
import {
  commitCacheEntityMutation,
  commitCacheQueryMutation,
  compileCacheQueryMutation
} from '../dist/mutation.js';

const queryKey = ['todos', { status: 'open' }];
const cache = createQueryCache({ now: () => 1 });
cache.writeQuery(queryKey, [
  { __typename: 'Todo', id: 't1', text: 'ship', done: false, count: 1 },
  { __typename: 'Todo', id: 't2', text: 'bench', done: false, count: 2 }
]);

const plan = createMutationPlan()
  .forEach(select('/*').where('done', '==', false).keyBy('id'), (rows) => {
    rows.increment('count', 1);
  });

const compiled = compileCacheQueryMutation(cache, queryKey, plan);
assert.strictEqual(compiled.mutation.matched, 2);
assert.deepStrictEqual(compiled.previous.map((todo) => todo.count), [1, 2]);
assert.deepStrictEqual(compiled.next.map((todo) => todo.count), [2, 3]);
assert.deepStrictEqual(cache.getQueryData(queryKey).map((todo) => todo.count), [1, 2]);

const committed = commitCacheQueryMutation(cache, queryKey, plan);
assert.strictEqual(committed.mutation.matched, 2);
assert.ok(committed.cachePatch.length > 0);
assert.deepStrictEqual(cache.getQueryData(queryKey).map((todo) => todo.count), [2, 3]);

const entityPlan = createMutationPlan()
  .set('/done', true)
  .appendText('/text', ' now');
const entityResult = commitCacheEntityMutation(cache, 'Todo:t1', entityPlan);
assert.strictEqual(entityResult.entityId, 'Todo:t1');
assert.strictEqual(entityResult.previous.done, false);
assert.strictEqual(entityResult.next.done, true);
assert.ok(entityResult.cachePatch.length > 0);
assert.deepStrictEqual(cache.getEntity('Todo:t1'), {
  __typename: 'Todo',
  id: 't1',
  text: 'ship now',
  done: true,
  count: 2
});
assert.strictEqual(cache.getQueryData(queryKey)[0].text, 'ship now');

assert.throws(
  () => commitCacheQueryMutation(cache, ['missing'], createMutationPlan().set('/x', 1)),
  /missing/
);

const created = commitCacheEntityMutation(
  cache,
  { __typename: 'Todo', id: 't3' },
  createMutationPlan().set([], { __typename: 'Todo', id: 't3', text: 'new' }),
  { missing: 'empty' }
);
assert.strictEqual(created.entityId, 'Todo:t3');
assert.deepStrictEqual(cache.getEntity('Todo:t3'), { __typename: 'Todo', id: 't3', text: 'new' });

console.log('frontier state-cache mutation bridge passed');
