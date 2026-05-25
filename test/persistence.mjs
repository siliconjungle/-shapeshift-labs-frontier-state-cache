import assert from 'node:assert';
import {
  createQueryCache,
  createQueryCacheChangeLog,
  createQueryCacheMemoryStorageAdapter,
  persistQueryCache,
  summarizeQueryCacheChanges
} from '../dist/index.js';

{
  const storage = createQueryCacheMemoryStorageAdapter();
  const snapshot = {
    entities: {
      'Todo:1': { __typename: 'Todo', id: '1', text: 'saved' }
    },
    queries: []
  };
  storage.save(snapshot);
  snapshot.entities['Todo:1'].text = 'mutated';
  const stored = storage.getSnapshot();
  assert.strictEqual(stored.entities['Todo:1'].text, 'saved');
  stored.entities['Todo:1'].text = 'mutated-again';
  assert.strictEqual(storage.getSnapshot().entities['Todo:1'].text, 'saved');
}

{
  const source = createQueryCache({ now: () => 10 });
  const storage = createQueryCacheMemoryStorageAdapter();
  const persistence = persistQueryCache(source, storage, { debounceMs: 1000 });

  source.writeQuery(['todos'], [
    { __typename: 'Todo', id: '1', text: 'ship', done: false }
  ]);
  await persistence.flush();

  source.modifyEntity('Todo:1', (todo) => ({ ...todo, text: 'draft' }));
  assert.strictEqual(storage.getSnapshot().queries[0].value[0].text, 'ship');
  await persistence.flush();
  assert.strictEqual(storage.getSnapshot().queries[0].value[0].text, 'draft');

  const restored = createQueryCache();
  const restoredPersistence = persistQueryCache(restored, storage);
  assert.strictEqual(await restoredPersistence.hydrate(), true);
  assert.deepStrictEqual(restored.getQueryData(['todos']), [
    { __typename: 'Todo', id: '1', text: 'draft', done: false }
  ]);
  assert.strictEqual(restoredPersistence.getStats().loads, 1);

  await restoredPersistence.clear();
  assert.strictEqual(storage.getSnapshot(), null);

  persistence.dispose();
  restoredPersistence.dispose();
}

{
  const cache = createQueryCache({ now: () => 30 });
  const log = createQueryCacheChangeLog(cache, { capacity: 4 });

  cache.writeQuery(['viewer'], {
    viewer: { __typename: 'User', id: 'u1', name: 'Ada' }
  });
  const firstCheckpoint = log.checkpoint;
  cache.modifyEntity('User:u1', (user) => ({ ...user, name: 'Grace' }));
  cache.invalidateEntity('User:u1');

  const entries = log.readSince(firstCheckpoint);
  assert.strictEqual(entries.length, 3);
  assert.strictEqual(entries[0].type, 'entity');
  assert.strictEqual(entries[0].entityId, 'User:u1');
  assert.ok(entries[0].patch.length > 0);
  assert.strictEqual(entries[1].type, 'query');
  assert.strictEqual(entries[2].type, 'invalidate');

  const summary = summarizeQueryCacheChanges(log.readSince(0));
  assert.strictEqual(summary.count, 4);
  assert.strictEqual(summary.byType.query, 2);
  assert.strictEqual(summary.byType.entity, 1);
  assert.strictEqual(summary.byType.invalidate, 1);
  assert.ok(summary.patchOperations >= 2);

  log.ack(entries[0].seq);
  assert.strictEqual(log.readSince(0).length, 2);
  log.dispose();
}

console.log('frontier state-cache persistence passed');
