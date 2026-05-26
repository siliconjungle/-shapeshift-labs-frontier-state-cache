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
  const cache = createQueryCache();
  const queryPatch = cache.writeQuery(['clone-check'], [
    { __typename: 'Todo', id: 'c1', text: 'first' }
  ]);
  queryPatch[0][2][0].text = 'mutated';
  assert.strictEqual(cache.getQueryData(['clone-check'])[0].text, 'first');

  const entityPatch = cache.modifyEntity({ __typename: 'Todo', id: 'c2' }, () => ({
    __typename: 'Todo',
    id: 'c2',
    text: 'second'
  }));
  entityPatch[0][2].text = 'mutated';
  assert.strictEqual(cache.getEntity('Todo:c2').text, 'second');

  cache.writeQuery(['updater-detached'], {
    __typename: 'Todo',
    id: 'c3',
    text: 'third',
    nested: { done: false }
  });
  const noPatch = cache.modifyEntity('Todo:c3', (todo) => {
    todo.text = 'mutated';
    todo.nested.done = true;
    return undefined;
  });
  assert.strictEqual(noPatch.length, 0);
  assert.strictEqual(cache.getEntity('Todo:c3').text, 'third');
  assert.strictEqual(cache.getEntity('Todo:c3').nested.done, false);
}

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
  const listenerSnapshots = [];
  cache.watchQuery(['viewer'], (patch) => {
    observed = applyPatchImmutable(observed, patch);
  });
  cache.subscribe((event) => {
    if (event.type === 'query' || event.type === 'entity') {
      eventCount++;
      listenerSnapshots.push({
        observedDone: observed.viewer.todos[0].done,
        cachedDone: cache.getQueryData(['viewer']).viewer.todos[0].done
      });
    }
  });

  const entityPatch = cache.modifyEntity('Todo:t1', (todo) => ({ ...todo, done: true }));
  assert.ok(entityPatch.length > 0);
  assert.strictEqual(observed.viewer.todos[0].done, true);
  assert.strictEqual(cache.getQueryData(['viewer']).viewer.todos[0].done, true);
  assert.strictEqual(cache.getEntity('Todo:t1').done, true);
  assert.ok(eventCount >= 1);
  assert.ok(listenerSnapshots.length >= 1);
  assert.ok(listenerSnapshots.every((snapshot) => snapshot.observedDone === true && snapshot.cachedDone === true));

  const invalidated = cache.invalidateEntity('Todo:t1');
  assert.strictEqual(invalidated, 1);
  assert.strictEqual(cache.getQueryInfo(['viewer']).stale, true);
}

{
  const cache = createQueryCache();
  const query = ['tasks', { view: 'summary' }];
  cache.writeQuery(query, [
    { __typename: 'Task', id: '1', title: 'ship', status: 'open' }
  ]);
  let observed = cache.getQueryData(query);
  let callbacks = 0;
  cache.watchQuery(query, (patch) => {
    callbacks++;
    observed = applyPatchImmutable(observed, patch);
  });

  cache.modifyEntity('Task:1', (task) => ({ ...task, auditCounter: 1 }));
  assert.strictEqual(callbacks, 0);
  assert.deepStrictEqual(observed, [
    { __typename: 'Task', id: '1', title: 'ship', status: 'open' }
  ]);

  cache.modifyEntity('Task:1', (task) => ({ ...task, status: 'done' }));
  assert.strictEqual(callbacks, 1);
  assert.strictEqual(observed[0].status, 'done');
}

{
  const cache = createQueryCache();
  const query = ['todos', { view: 'owners' }];
  cache.writeQuery(query, [
    {
      __typename: 'Todo',
      id: 't1',
      text: 'ship',
      owner: { __typename: 'User', id: 'u1', name: 'Ada' }
    }
  ]);
  let observed = cache.getQueryData(query);
  let callbacks = 0;
  cache.watchQuery(query, (patch) => {
    callbacks++;
    observed = applyPatchImmutable(observed, patch);
  });

  cache.modifyEntity('User:u1', (user) => ({ ...user, name: 'Grace' }));
  assert.strictEqual(callbacks, 1);
  assert.strictEqual(observed[0].owner.name, 'Grace');
  assert.strictEqual(cache.invalidateEntity('User:u1'), 1);
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
  const existing = [{ id: 'a', nested: { value: 1 } }];
  const incoming = [{ id: 'b', nested: { value: 2 } }];
  const merged = mergeOffsetPage(existing, incoming, { offset: 1 });
  merged[0].nested.value = 10;
  merged[1].nested.value = 20;
  assert.strictEqual(existing[0].nested.value, 1);
  assert.strictEqual(incoming[0].nested.value, 2);
}

{
  const cache = createQueryCache();
  const query = ['todos', { status: 'paged' }];
  cache.writeQuery(query, [
    { __typename: 'Todo', id: 't1', text: 'first', done: false }
  ]);
  let observed = cache.getQueryData(query);
  cache.watchQuery(query, (patch) => {
    observed = applyPatchImmutable(observed, patch);
  });
  const patch = cache.writeQuery(query, [
    { __typename: 'Todo', id: 't2', text: 'second', done: false }
  ], {
    merge: (existing, incoming) => {
      const merged = mergeOffsetPage(existing, incoming, { offset: 1 });
      merged[1].text = 'second-updated';
      return merged;
    }
  });
  assert.ok(patch.length > 0);
  assert.deepStrictEqual(observed, cache.getQueryData(query));
  assert.strictEqual(cache.getQueryData(query)[1].text, 'second-updated');
  cache.modifyEntity('Todo:t2', (todo) => ({ ...todo, done: true }));
  assert.strictEqual(cache.getQueryData(query)[1].done, true);
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

{
  const seenPaths = [];
  const cache = createQueryCache({
    identify(value, context) {
      if (value.kind === 'PathEntity' && typeof value.slug === 'string') {
        seenPaths.push(context.path.join('/'));
        return 'PathEntity:' + value.slug;
      }
      return null;
    }
  });
  cache.writeQuery(['path-identify'], {
    wrapper: [
      { kind: 'PathEntity', slug: 'a', value: 1 }
    ]
  });
  assert.ok(seenPaths.includes('wrapper/0'));
  assert.strictEqual(cache.getEntity('PathEntity:a').value, 1);
}

{
  const cache = createQueryCache();
  const query = ['todos', { removeEntity: true }];
  cache.writeQuery(query, [
    { __typename: 'Todo', id: 'r1', text: 'first', done: false },
    { __typename: 'Todo', id: 'r2', text: 'second', done: false }
  ]);
  let observed = cache.getQueryData(query);
  let observedEntity = cache.getEntity('Todo:r1');
  let queryCallbacks = 0;
  let entityCallbacks = 0;
  cache.watchQuery(query, (patch) => {
    queryCallbacks++;
    observed = applyPatchImmutable(observed, patch);
  });
  cache.watchEntity('Todo:r1', (patch) => {
    entityCallbacks++;
    observedEntity = applyPatchImmutable(observedEntity, patch);
  });

  cache.batch(() => {
    const removedPatch = cache.removeEntity('Todo:r1');
    assert.ok(removedPatch.length > 0);
    assert.strictEqual(cache.getEntity('Todo:r1'), undefined);
    cache.modifyEntity('Todo:r1', () => ({
      __typename: 'Todo',
      id: 'r1',
      text: 'recreated',
      done: false
    }));
    assert.strictEqual(cache.getEntity('Todo:r1').text, 'recreated');
    assert.strictEqual(queryCallbacks, 0);
    assert.strictEqual(entityCallbacks, 0);
  });

  assert.strictEqual(cache.getQueryData(query)[0].text, 'recreated');
  assert.strictEqual(observed[0].text, 'recreated');
  assert.strictEqual(observedEntity.text, 'recreated');
  assert.strictEqual(queryCallbacks, 1);
  assert.strictEqual(entityCallbacks, 1);

  cache.removeEntity('Todo:r1');
  assert.strictEqual(cache.getEntity('Todo:r1'), undefined);
  assert.strictEqual(cache.getQueryData(query)[0], null);
}

console.log('frontier state-cache smoke passed');
