import assert from 'node:assert';
import { applyPatchImmutable } from '@shapeshift-labs/frontier/patch';
import {
  createQueryCache,
  hashQueryKey,
  mergeOffsetPage,
  mergeUniqueList,
  partialMatchQueryKey,
  persistQueryCache
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
  const source = ['todos', { source: 'scores' }];
  const top = ['todos', { top: 2 }];
  cache.writeQuery(source, [
    { __typename: 'Todo', id: 't1', group: 'alpha', score: 10, revision: 0 },
    { __typename: 'Todo', id: 't2', group: 'alpha', score: 8, revision: 0 },
    { __typename: 'Todo', id: 't3', group: 'alpha', score: 4, revision: 0 },
    { __typename: 'Todo', id: 't4', group: 'beta', score: 100, revision: 0 }
  ]);
  const maintained = cache.maintainQuery(top, {
    filter: (entity) => entity.__typename === 'Todo' && entity.group === 'alpha',
    sort: (left, right, leftId, rightId) => (
      Number(right.score) - Number(left.score) || leftId.localeCompare(rightId)
    ),
    limit: 2,
    select: (entity) => ({
      __typename: 'Todo',
      id: String(entity.id),
      score: Number(entity.score),
      revision: Number(entity.revision)
    })
  });
  let observed = cache.getQueryData(top);
  let callbacks = 0;
  cache.watchQuery(top, (patch) => {
    callbacks++;
    observed = applyPatchImmutable(observed, patch);
  });
  assert.deepStrictEqual(cache.getQueryData(top).map((todo) => todo.id), ['t1', 't2']);

  cache.modifyEntity('Todo:t3', (todo) => ({ ...todo, score: 12, revision: Number(todo.revision) + 1 }));
  assert.deepStrictEqual(cache.getQueryData(top).map((todo) => todo.id), ['t3', 't1']);
  assert.deepStrictEqual(observed, cache.getQueryData(top));

  cache.modifyEntity('Todo:t1', (todo) => ({ ...todo, score: 1, revision: Number(todo.revision) + 1 }));
  assert.deepStrictEqual(cache.getQueryData(top).map((todo) => todo.id), ['t3', 't2']);

  cache.optimistic('top-k', () => {
    cache.modifyEntity('Todo:t2', (todo) => ({ ...todo, score: 30, revision: Number(todo.revision) + 1 }));
  });
  assert.deepStrictEqual(cache.getQueryData(top).map((todo) => todo.id), ['t2', 't3']);
  assert.strictEqual(cache.rollbackOptimistic('top-k'), true);
  assert.deepStrictEqual(cache.getQueryData(top).map((todo) => todo.id), ['t3', 't2']);
  assert.ok(callbacks >= 3);

  maintained.unsubscribe();
  assert.strictEqual(maintained.active, false);
  cache.modifyEntity('Todo:t4', (todo) => ({ ...todo, group: 'alpha', score: 200 }));
  assert.deepStrictEqual(cache.getQueryData(top).map((todo) => todo.id), ['t3', 't2']);
}

{
  const cache = createQueryCache({ now: () => 40 });
  const changes = [];
  const saves = [];
  const storage = {
    load() {
      return null;
    },
    save(snapshot) {
      saves.push(snapshot);
    },
    appendChange(entry) {
      changes.push(entry);
    }
  };
  const persistence = persistQueryCache(cache, storage, { debounceMs: 1000 });

  assert.strictEqual(await persistence.ready, false);
  cache.writeQuery(['todo', 1], { __typename: 'Todo', id: '1', text: 'a', done: false });
  cache.modifyEntity('Todo:1', (todo) => ({ ...todo, done: true }));
  await persistence.flush();

  assert.strictEqual(saves.length, 1);
  assert.strictEqual(saves[0].queries[0].value.done, true);
  assert.strictEqual(changes.length, 4);
  assert.deepStrictEqual(changes.map((entry) => entry.seq), [1, 2, 3, 4]);
  assert.strictEqual(persistence.getStats().changeLogWrites, 4);
  persistence.dispose();
}

{
  const cache = createQueryCache({ now: () => 42 });
  const saves = [];
  const scheduled = [];
  const scheduler = {
    schedule(task) {
      const existing = scheduled.findIndex((queued) => queued.key === task.key);
      if (existing >= 0) {
        scheduled[existing] = task;
        return task;
      }
      scheduled.push(task);
      return task;
    },
    run() {
      while (scheduled.length !== 0) scheduled.shift().run();
    }
  };
  const storage = {
    load() {
      return null;
    },
    save(snapshot) {
      saves.push(snapshot);
    }
  };
  const persistence = persistQueryCache(cache, storage, { debounceMs: 0, scheduler });
  assert.strictEqual(await persistence.ready, false);
  cache.writeQuery(['scheduled'], { __typename: 'Todo', id: 's1', text: 'queued' });
  assert.strictEqual(saves.length, 0);
  assert.strictEqual(scheduled[0].type, 'frontier.state-cache.save');
  scheduler.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(saves.length, 1);
  persistence.dispose();
}

{
  const cache = createQueryCache({ now: () => 45 });
  const changes = [];
  let reads = 0;
  const storage = {
    load() {
      return null;
    },
    save() {},
    readChangeLog() {
      reads++;
      return [{ seq: 7, type: 'clear' }];
    },
    appendChange(entry) {
      changes.push(entry);
    }
  };
  const persistence = persistQueryCache(cache, storage, { debounceMs: 1000 });

  cache.writeQuery(['todo', 1], { __typename: 'Todo', id: '1', text: 'a' });
  await persistence.flush();

  assert.strictEqual(reads, 1);
  assert.deepStrictEqual(changes.map((entry) => entry.seq), [8, 9]);
  persistence.dispose();
}

{
  const cache = createQueryCache({ now: () => 47 });
  const changes = [];
  const storage = {
    load() {
      return null;
    },
    save() {},
    appendChange(entry) {
      changes.push(entry);
    }
  };
  const persistence = persistQueryCache(cache, storage, {
    changeLog: { includePatches: false },
    debounceMs: 1000
  });

  cache.writeQuery(['todo', 1], { __typename: 'Todo', id: '1', text: 'a' });
  await persistence.flush();

  assert.ok(changes.length > 0);
  assert.ok(changes.every((entry) => entry.patch === undefined));
  assert.ok(changes.some((entry) => entry.patchOperations > 0));
  persistence.dispose();
}

{
  const cache = createQueryCache();
  let compacted = 0;
  const storage = {
    load() {
      return null;
    },
    save() {
      throw new Error('compactOnFlush should use compact when available');
    },
    compact(snapshot) {
      compacted++;
      assert.strictEqual(snapshot.queries[0].value.text, 'a');
    }
  };
  const persistence = persistQueryCache(cache, storage, {
    compactOnFlush: true,
    debounceMs: 1000
  });

  cache.writeQuery(['todo', 1], { __typename: 'Todo', id: '1', text: 'a' });
  await persistence.flush();
  assert.strictEqual(compacted, 1);
  persistence.dispose();
}

{
  const cache = createQueryCache();
  const routeA = ['route', { id: 'a' }];
  const routeB = ['route', { id: 'b' }];
  const summary = ['routes', { view: 'summary' }];
  cache.writeQuery(routeA, { route: 'a', eta: 12 });
  cache.writeQuery(routeB, { route: 'b', eta: 20 });
  cache.writeQuery(summary, { count: 2 });

  const invalidations = [];
  cache.subscribe((event) => {
    if (event.type === 'invalidate') invalidations.push(event.hash);
  });

  cache.setDependencyNode({ id: 'segment:a', dependencies: ['edge:1'] });
  cache.setDependencyNode({ id: 'route:a', dependencies: ['segment:a'], queryKey: routeA });
  cache.setDependencyNode({ id: 'route:b', dependencies: ['edge:2'], queryKey: routeB });
  cache.setDependencyNode({ id: 'routes:summary', dependencies: ['route:a', 'route:b'], queryKey: summary });

  const first = cache.invalidateDependency('edge:1');
  assert.deepStrictEqual(first, { dependencyKey: 'edge:1', visited: 4, invalidated: 2 });
  assert.strictEqual(cache.getQueryInfo(routeA).stale, true);
  assert.strictEqual(cache.getQueryInfo(summary).stale, true);
  assert.strictEqual(cache.getQueryInfo(routeB).stale, false);
  assert.strictEqual(invalidations.length, 2);

  cache.writeQuery(routeA, { route: 'a', eta: 14 });
  cache.writeQuery(summary, { count: 2 });
  cache.setDependencyNode({ id: 'route:a', dependencies: ['edge:3'], queryKey: routeA });
  const removed = cache.invalidateDependency('edge:1');
  assert.deepStrictEqual(removed, { dependencyKey: 'edge:1', visited: 2, invalidated: 0 });

  const moved = cache.invalidateDependency('edge:3');
  assert.deepStrictEqual(moved, { dependencyKey: 'edge:3', visited: 3, invalidated: 2 });
  assert.throws(
    () => cache.setDependencyNode({ id: 'edge:3', dependencies: ['routes:summary'] }),
    /cycle/
  );

  cache.writeQuery(routeA, { route: 'a', eta: 16 });
  cache.writeQuery(summary, { count: 2 });
  assert.strictEqual(cache.deleteDependencyNode('route:a'), true);
  assert.deepStrictEqual(
    cache.invalidateDependency('edge:3'),
    { dependencyKey: 'edge:3', visited: 1, invalidated: 0 }
  );
  assert.strictEqual(cache.deleteDependencyNode('route:a'), false);
  assert.deepStrictEqual(
    cache.invalidateDependency('missing'),
    { dependencyKey: 'missing', visited: 0, invalidated: 0 }
  );
}

{
  let tick = 0;
  const cache = createQueryCache({ now: () => ++tick });
  const key = ['todos', { catchUp: true }];
  cache.writeQuery(key, [
    { __typename: 'Todo', id: 'c1', text: 'first', done: false, revision: 0 },
    { __typename: 'Todo', id: 'c2', text: 'second', done: false, revision: 0 }
  ]);

  const initial = cache.readQueryCatchUp(key);
  assert.strictEqual(initial.complete, true);
  assert.strictEqual(initial.changes.length, 2);
  assert.deepStrictEqual(initial.changes.map((change) => change.entityId), ['Todo:c1', 'Todo:c2']);
  assert.strictEqual(cache.getQueryCatchUpClock(key), initial.highWaterClock);

  cache.modifyEntity('Todo:c2', (todo) => ({
    ...todo,
    text: 'second-updated',
    revision: Number(todo.revision) + 1
  }));
  const update = cache.readQueryCatchUp(key, { lastSeenClock: initial.highWaterClock });
  assert.strictEqual(update.complete, true);
  assert.strictEqual(update.changes.length, 1);
  assert.strictEqual(update.changes[0].entityId, 'Todo:c2');
  assert.strictEqual(update.changes[0].value.text, 'second-updated');
  assert.strictEqual(update.nextLastSeenClock, update.highWaterClock);

  const limited = cache.readQueryCatchUp(key, { lastSeenClock: 0, limit: 1 });
  assert.strictEqual(limited.complete, false);
  assert.strictEqual(limited.changes.length, 1);
  assert.strictEqual(limited.nextLastSeenClock, limited.changes[0].clock);

  const snapshot = cache.extract();
  const restored = createQueryCache();
  restored.restore(snapshot);
  const restoredUpdate = restored.readQueryCatchUp(key, { lastSeenClock: initial.highWaterClock });
  assert.strictEqual(restoredUpdate.changes.length, 1);
  assert.strictEqual(restoredUpdate.changes[0].entityId, 'Todo:c2');
  assert.strictEqual(restoredUpdate.changes[0].value.text, 'second-updated');

  const oldSnapshot = cache.extract();
  delete oldSnapshot.catchUp;
  delete oldSnapshot.catchUpClock;
  const oldRestored = createQueryCache();
  oldRestored.restore(oldSnapshot);
  assert.strictEqual(oldRestored.readQueryCatchUp(key).changes.length, 2);
}

{
  const cache = createQueryCache();
  const source = ['todos', { catchUpSource: true }];
  const open = ['todos', { catchUpOpen: true }];
  cache.writeQuery(source, [
    { __typename: 'Todo', id: 'm1', text: 'first', done: false },
    { __typename: 'Todo', id: 'm2', text: 'second', done: false }
  ]);
  const maintained = cache.maintainQuery(open, {
    filter: (entity) => entity.__typename === 'Todo' && entity.done === false,
    sort: (left, right) => String(left.id).localeCompare(String(right.id))
  });
  const baseline = cache.getQueryCatchUpClock(open);

  cache.modifyEntity('Todo:m1', (todo) => ({ ...todo, done: true }));
  const removed = cache.readQueryCatchUp(open, { lastSeenClock: baseline });
  assert.strictEqual(removed.changes.length, 1);
  assert.strictEqual(removed.changes[0].entityId, 'Todo:m1');
  assert.strictEqual(removed.changes[0].removed, true);

  maintained.unsubscribe();
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
