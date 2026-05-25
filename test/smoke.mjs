import assert from 'node:assert';
import { applyPatchImmutable } from '@shapeshift-labs/frontier/patch';
import {
  createQueryCache,
  hashQueryKey,
  mergeOffsetPage,
  mergeUniqueList,
  partialMatchQueryKey
} from '../dist/index.js';

assert.strictEqual(
  hashQueryKey(['todos', { status: 'open', page: 1 }]),
  hashQueryKey(['todos', { page: 1, status: 'open' }])
);
assert.ok(partialMatchQueryKey(['todos', { page: 1, status: 'open' }], ['todos']));
assert.ok(partialMatchQueryKey(['todos', { page: 1, status: 'open' }], ['todos', { status: 'open' }]));
assert.strictEqual(partialMatchQueryKey(['todos'], ['todos', { page: 1 }]), false);

{
  const cache = createQueryCache({ now: () => 10 });
  let observed;
  let eventCount = 0;
  cache.writeQuery(['viewer'], {
    viewer: {
      __typename: 'User',
      id: 'u1',
      name: 'Ada',
      todos: [
        { __typename: 'Todo', id: 't1', text: 'ship', done: false },
        { __typename: 'Todo', id: 't2', text: 'bench', done: false }
      ]
    }
  });
  observed = cache.getQueryData(['viewer']);
  cache.watchQuery(['viewer'], (patch) => {
    observed = applyPatchImmutable(observed, patch);
  });
  cache.subscribe((event) => {
    if (event.type === 'query' || event.type === 'entity') eventCount++;
  });

  const entityPatch = cache.modifyEntity('Todo:t1', (todo) => ({ ...todo, done: true }));
  assert.ok(entityPatch.length > 0);
  assert.strictEqual(observed.viewer.todos[0].done, true);
  assert.strictEqual(cache.getQueryData(['viewer']).viewer.todos[0].done, true);
  assert.strictEqual(cache.getEntity('Todo:t1').done, true);
  assert.ok(eventCount >= 1);

  const invalidated = cache.invalidateEntity('Todo:t1');
  assert.strictEqual(invalidated, 1);
  assert.strictEqual(cache.getQueryInfo(['viewer']).stale, true);
}

{
  const cache = createQueryCache();
  const query = ['todos', { status: 'all' }];
  cache.writeQuery(query, [
    { __typename: 'Todo', id: 't1', text: 'first' }
  ]);
  cache.writeQuery(query, [
    { __typename: 'Todo', id: 't2', text: 'second' }
  ], {
    merge: (existing, incoming) => mergeOffsetPage(existing, incoming, { offset: 1 })
  });
  assert.deepStrictEqual(cache.getQueryData(query).map((todo) => todo.id), ['t1', 't2']);

  cache.writeQuery(query, [
    { __typename: 'Todo', id: 't2', text: 'second' },
    { __typename: 'Todo', id: 't3', text: 'third' }
  ], {
    merge: (existing, incoming) => mergeUniqueList(existing, incoming)
  });
  assert.deepStrictEqual(cache.getQueryData(query).map((todo) => todo.id), ['t1', 't2', 't3']);
}

{
  const cache = createQueryCache();
  const query = ['todo', 't1'];
  cache.writeQuery(query, { __typename: 'Todo', id: 't1', text: 'first', done: false });
  cache.optimistic('mutation:1', () => {
    cache.modifyEntity('Todo:t1', (todo) => ({ ...todo, done: true }));
  });
  assert.strictEqual(cache.getQueryData(query).done, true);
  assert.strictEqual(cache.rollbackOptimistic('mutation:1'), true);
  assert.strictEqual(cache.getQueryData(query).done, false);
}

console.log('frontier state-cache smoke passed');
