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
  const storage = createQueryCacheMemoryStorageAdapter();
  storage.save({
    metadata: { dataVersion: '1' },
    entities: {
      'Todo:1': { __typename: 'Todo', id: '1', text: 'old' }
    },
    queries: []
  });
  let report;
  const cache = createQueryCache();
  const persistence = persistQueryCache(cache, storage, {
    migrateSnapshot(snapshot) {
      return {
        kind: 'frontier.migration.runtime-data.result',
        data: {
          ...snapshot,
          metadata: { dataVersion: '2' },
          entities: {
            'Todo:1': { __typename: 'Todo', id: '1', title: snapshot.entities['Todo:1'].text }
          }
        },
        version: '2',
        changed: true,
        report: { kind: 'frontier.migration.report', source: 'idb:query-cache' }
      };
    },
    onMigrationReport(nextReport) {
      report = nextReport;
    }
  });
  assert.strictEqual(await persistence.hydrate(), true);
  assert.deepStrictEqual(cache.getEntity('Todo:1'), { __typename: 'Todo', id: '1', title: 'old' });
  assert.deepStrictEqual(report, { kind: 'frontier.migration.report', source: 'idb:query-cache' });
  persistence.dispose();
}

{
  let snapshot = null;
  const changes = [];
  const storage = {
    load() {
      return snapshot === null ? null : clone(snapshot);
    },
    save(next) {
      snapshot = clone(next);
    },
    compact(next) {
      snapshot = clone(next);
      changes.length = 0;
    },
    appendChange(entry) {
      changes.push(clone(entry));
    },
    readChangeLog() {
      return changes.map(clone);
    }
  };
  const source = createQueryCache({ now: () => 20 });
  const sourcePersistence = persistQueryCache(source, storage, {
    compactOnFlush: true,
    debounceMs: 1000000
  });

  source.writeQuery(['todos'], [
    { __typename: 'Todo', id: '1', text: 'ship', done: false, revision: 0 }
  ]);
  await sourcePersistence.flush();
  assert.strictEqual(changes.length, 0);
  const baselineWrites = sourcePersistence.getStats().changeLogWrites;

  source.modifyEntity('Todo:1', (todo) => ({
    ...todo,
    done: true,
    revision: Number(todo.revision) + 1
  }));
  await waitForChangeLogFlush(sourcePersistence, baselineWrites);
  const replayChanges = storage.readChangeLog();
  assert.ok(replayChanges.length > 0);
  sourcePersistence.dispose();

  const restored = createQueryCache({ now: () => 25 });
  const restoredPersistence = persistQueryCache(restored, storage, {
    replayChangeLog: true,
    debounceMs: 1000000
  });
  assert.strictEqual(await restoredPersistence.hydrate(), true);
  assert.deepStrictEqual(restored.getQueryData(['todos']), [
    { __typename: 'Todo', id: '1', text: 'ship', done: true, revision: 1 }
  ]);
  assert.strictEqual(restoredPersistence.getStats().replayedChanges, replayChanges.length);
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

{
  let snapshot = null;
  const changes = [];
  const storage = {
    load() {
      return snapshot === null ? null : clone(snapshot);
    },
    save(next) {
      snapshot = clone(next);
    },
    compact(next) {
      snapshot = clone(next);
      changes.length = 0;
    },
    appendChange(entry) {
      changes.push(clone(entry));
    },
    readChangeLog() {
      return changes.map(clone);
    }
  };
  const source = createQueryCache({ now: () => 40 });
  const sourcePersistence = persistQueryCache(source, storage, {
    compactOnFlush: true,
    debounceMs: 1000000
  });

  source.writeQuery(['todo', 'remove'], { __typename: 'Todo', id: 'remove', text: 'gone' });
  await sourcePersistence.flush();
  const baselineWrites = sourcePersistence.getStats().changeLogWrites;
  source.removeEntity('Todo:remove');
  await waitForChangeLogFlush(sourcePersistence, baselineWrites);
  sourcePersistence.dispose();

  const restored = createQueryCache({ now: () => 41 });
  const restoredPersistence = persistQueryCache(restored, storage, {
    replayChangeLog: true,
    debounceMs: 1000000
  });
  assert.strictEqual(await restoredPersistence.hydrate(), true);
  assert.strictEqual(restored.getEntity('Todo:remove'), undefined);
  assert.strictEqual(restored.getQueryData(['todo', 'remove']), null);
  restoredPersistence.dispose();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function waitForChangeLogFlush(persistence, baselineWrites) {
  for (let i = 0; i < 50; i++) {
    const stats = persistence.getStats();
    if (stats.changeLogWrites > baselineWrites && stats.changeLogWrites === stats.changes) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for persistence change log flush');
}

console.log('frontier state-cache persistence passed');
