import { performance } from 'node:perf_hooks';
import { createMutationPlan, select } from '@shapeshift-labs/frontier-mutation';
import {
  createQueryCache,
  createQueryCacheChangeLog,
  createQueryCacheMemoryStorageAdapter,
  mergeOffsetPage,
  persistQueryCache
} from '../dist/index.js';
import {
  commitCacheEntityMutation,
  commitCacheQueryMutation
} from '../dist/mutation.js';

const args = parseArgs(process.argv.slice(2));
const rounds = readPositiveInt(args.rounds, 3);
const rows = readPositiveInt(args.rows, 5000);
const queries = readPositiveInt(args.queries, 128);
const iterations = readPositiveInt(args.iterations, 800);

const results = [
  measureWriteQueries(rows, queries, rounds),
  measureEntityModify(rows, queries, iterations),
  measureEntityRemove(iterations),
  measureWatchedEntityModify(rows, queries, iterations),
  measureSubscriptionCatchUpRead(rows, queries, iterations),
  measureTopKRecompute(rows, Math.max(80, Math.floor(iterations / 4))),
  measureTopKMaintained(rows, Math.max(80, Math.floor(iterations / 4))),
  measureOffsetMerge(rows, iterations),
  measureDependencyScanInvalidate(rows, queries, Math.max(80, Math.floor(iterations / 4))),
  measureDependencyDagInvalidate(rows, queries, Math.max(80, Math.floor(iterations / 4))),
  await measurePersistenceFlush(rows, queries, Math.max(40, Math.floor(iterations / 8))),
  await measurePersistenceReplayHydrate(rows, queries, Math.max(20, Math.floor(iterations / 16))),
  measureChangeLogRead(rows, queries, iterations),
  measureCacheQueryMutation(rounds),
  measureCacheEntityMutation(iterations)
];

console.log('Frontier-only package measurements');
console.log(padRight('fixture', 38) + padLeft('median us', 12) + padLeft('p95 us', 10) + padLeft('events', 9));
for (const row of results) {
  console.log(
    padRight(row.fixture, 38) +
    padLeft(row.medianUs.toFixed(2), 12) +
    padLeft(row.p95Us.toFixed(2), 10) +
    padLeft(String(row.events), 9)
  );
}

function measureWriteQueries(rowCount, queryCount, runs) {
  const samples = [];
  for (let run = 0; run < runs; run++) {
    const cache = createQueryCache({ now: () => run });
    const start = performance.now();
    for (let i = 0; i < queryCount; i++) {
      const offset = (i * 31) % rowCount;
      cache.writeQuery(['todos', { page: i }], makeTodos(offset, 32));
    }
    samples.push(((performance.now() - start) * 1000) / queryCount);
  }
  return summarize('write normalized query result', samples, queryCount);
}

function measureEntityModify(rowCount, queryCount, runs) {
  const cache = seedCache(rowCount, queryCount);
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const page = i % queryCount;
    const id = 'Todo:' + String(((page * 31) % rowCount) + (i & 31));
    const start = performance.now();
    cache.modifyEntity(id, (todo) => ({
      ...todo,
      done: !todo.done,
      revision: Number(todo.revision || 0) + 1
    }));
    samples.push((performance.now() - start) * 1000);
  }
  return summarize('modify normalized entity', samples, runs);
}

function measureEntityRemove(runs) {
  const cache = createQueryCache();
  cache.writeQuery(['todos', { remove: true }], makeTodos(0, runs + 32));
  const samples = [];
  let patchOps = 0;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const patch = cache.removeEntity('Todo:' + i);
    samples.push((performance.now() - start) * 1000);
    patchOps += patch.length;
  }
  return summarize('remove normalized entity', samples, patchOps);
}

function measureWatchedEntityModify(rowCount, queryCount, runs) {
  const cache = seedCache(rowCount, queryCount);
  let callbacks = 0;
  for (let i = 0; i < queryCount; i++) {
    cache.watchQuery(['todos', { page: i }], () => { callbacks++; });
  }
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const page = i % queryCount;
    const id = 'Todo:' + String(((page * 31) % rowCount) + (i & 31));
    const start = performance.now();
    cache.modifyEntity(id, (todo) => ({
      ...todo,
      done: !todo.done,
      revision: Number(todo.revision || 0) + 1
    }));
    samples.push((performance.now() - start) * 1000);
  }
  return summarize('modify entity with query watchers', samples, callbacks);
}

function measureSubscriptionCatchUpRead(rowCount, queryCount, runs) {
  const cache = seedCache(rowCount, queryCount);
  const query = ['todos', { page: 0 }];
  let lastSeenClock = cache.getQueryCatchUpClock(query);
  const samples = [];
  let changes = 0;
  for (let i = 0; i < runs; i++) {
    const id = 'Todo:' + String(i & 31);
    cache.modifyEntity(id, (todo) => ({
      ...todo,
      done: !todo.done,
      revision: Number(todo.revision || 0) + 1
    }));
    const start = performance.now();
    const result = cache.readQueryCatchUp(query, { lastSeenClock, limit: 16 });
    samples.push((performance.now() - start) * 1000);
    changes += result.changes.length;
    lastSeenClock = result.nextLastSeenClock;
  }
  return summarize('subscription catch-up read', samples, changes);
}

function measureOffsetMerge(rowCount, runs) {
  const cache = createQueryCache();
  const query = ['todos', { list: 'all' }];
  cache.writeQuery(query, makeTodos(0, Math.min(rowCount, 512)));
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const offset = 512 + ((i * 8) % Math.max(8, rowCount - 512));
    const page = makeTodos(offset, 8);
    const start = performance.now();
    cache.writeQuery(query, page, {
      merge: (existing, incoming) => mergeOffsetPage(existing, incoming, { offset })
    });
    samples.push((performance.now() - start) * 1000);
  }
  return summarize('offset page merge write', samples, runs);
}

function measureTopKRecompute(rowCount, runs) {
  const { cache, rowsById } = seedScoredCache(rowCount);
  const query = ['todos', { top: 16, group: 'g0', mode: 'recompute' }];
  cache.writeQuery(query, computeTopKRows(rowsById, 16));
  let callbacks = 0;
  cache.watchQuery(query, () => { callbacks++; });
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const mutation = nextScoreMutation(rowsById, rowCount, i);
    const start = performance.now();
    cache.modifyEntity('Todo:' + mutation.id, (todo) => ({
      ...todo,
      score: mutation.score,
      revision: mutation.revision
    }));
    cache.writeQuery(query, computeTopKRows(rowsById, 16));
    samples.push((performance.now() - start) * 1000);
  }
  return summarize('top-k recompute scan', samples, callbacks);
}

function measureTopKMaintained(rowCount, runs) {
  const { cache, rowsById } = seedScoredCache(rowCount);
  const query = ['todos', { top: 16, group: 'g0', mode: 'maintained' }];
  cache.maintainQuery(query, {
    filter: (entity) => entity.__typename === 'Todo' && entity.group === 'g0',
    sort: compareScoreEntities,
    limit: 16,
    select: projectScoreEntity
  });
  let callbacks = 0;
  cache.watchQuery(query, () => { callbacks++; });
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const mutation = nextScoreMutation(rowsById, rowCount, i);
    const start = performance.now();
    cache.modifyEntity('Todo:' + mutation.id, (todo) => ({
      ...todo,
      score: mutation.score,
      revision: mutation.revision
    }));
    samples.push((performance.now() - start) * 1000);
  }
  return summarize('top-k maintained index', samples, callbacks);
}

async function measurePersistenceFlush(rowCount, queryCount, runs) {
  const cache = seedCache(rowCount, queryCount);
  const storage = createQueryCacheMemoryStorageAdapter();
  const persistence = persistQueryCache(cache, storage, { debounceMs: 1000000 });
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const page = i % queryCount;
    const id = 'Todo:' + String(((page * 31) % rowCount) + (i & 31));
    cache.modifyEntity(id, (todo) => ({ ...todo, persisted: Number(todo.persisted || 0) + 1 }));
    const start = performance.now();
    await persistence.flush();
    samples.push((performance.now() - start) * 1000);
  }
  const stats = persistence.getStats();
  persistence.dispose();
  return summarize('memory persistence flush', samples, stats.saves);
}

async function measurePersistenceReplayHydrate(rowCount, queryCount, runs) {
  const storage = await createPersistenceReplayStorage(rowCount, queryCount, Math.max(16, Math.min(64, queryCount)));
  const samples = [];
  let replayedChanges = 0;
  for (let i = 0; i < runs; i++) {
    const cache = createQueryCache({ now: () => i });
    const persistence = persistQueryCache(cache, storage, {
      replayChangeLog: true,
      debounceMs: 1000000
    });
    const start = performance.now();
    const hydrated = await persistence.hydrate();
    samples.push((performance.now() - start) * 1000);
    if (!hydrated || cache.getQueryData(['todos', { page: 0 }]) === undefined) {
      throw new Error('state-cache replay hydrate fixture did not hydrate');
    }
    replayedChanges += persistence.getStats().replayedChanges;
    persistence.dispose();
  }
  return summarize('memory replay hydrate', samples, replayedChanges);
}

function measureChangeLogRead(rowCount, queryCount, runs) {
  const cache = seedCache(rowCount, queryCount);
  const log = createQueryCacheChangeLog(cache, { capacity: 256, includePatches: false });
  const samples = [];
  let readEntries = 0;
  for (let i = 0; i < runs; i++) {
    const checkpoint = log.checkpoint;
    const page = i % queryCount;
    const id = 'Todo:' + String(((page * 31) % rowCount) + (i & 31));
    cache.modifyEntity(id, (todo) => ({ ...todo, revision: Number(todo.revision || 0) + 1 }));
    const start = performance.now();
    const entries = log.readSince(checkpoint, 16);
    samples.push((performance.now() - start) * 1000);
    readEntries += entries.length;
    if (entries.length !== 0) log.ack(entries[entries.length - 1].seq);
  }
  log.dispose();
  return summarize('bounded change-log read', samples, readEntries);
}

async function createPersistenceReplayStorage(rowCount, queryCount, mutations) {
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
      changes[changes.length] = clone(entry);
    },
    readChangeLog() {
      return changes.map(clone);
    }
  };
  const source = seedCache(rowCount, queryCount);
  const persistence = persistQueryCache(source, storage, {
    compactOnFlush: true,
    debounceMs: 1000000
  });
  await persistence.flush();
  const baselineWrites = persistence.getStats().changeLogWrites;
  for (let i = 0; i < mutations; i++) {
    const page = i % queryCount;
    const id = 'Todo:' + String(((page * 31) % rowCount) + (i & 31));
    source.modifyEntity(id, (todo) => ({
      ...todo,
      revision: Number(todo.revision || 0) + 1
    }));
  }
  await waitForChangeLogFlush(persistence, baselineWrites);
  persistence.dispose();
  return storage;
}

async function waitForChangeLogFlush(persistence, baselineWrites) {
  for (let i = 0; i < 100; i++) {
    const stats = persistence.getStats();
    if (stats.changeLogWrites > baselineWrites && stats.changeLogWrites === stats.changes) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for persistence change log flush');
}

function measureDependencyScanInvalidate(rowCount, queryCount, runs) {
  const { cache, leaves, affectedHashesByLeaf } = seedDependencyDagCache(rowCount, queryCount);
  const samples = [];
  let invalidated = 0;
  for (let i = 0; i < runs; i++) {
    const leaf = leaves[(i * 17) % leaves.length];
    const affected = affectedHashesByLeaf.get(leaf);
    const start = performance.now();
    invalidated += cache.invalidateQueries({
      predicate: (entry) => affected.has(entry.hash)
    });
    samples.push((performance.now() - start) * 1000);
  }
  return summarize('dependency scan invalidate', samples, invalidated);
}

function measureDependencyDagInvalidate(rowCount, queryCount, runs) {
  const { cache, leaves } = seedDependencyDagCache(rowCount, queryCount);
  const samples = [];
  let invalidated = 0;
  for (let i = 0; i < runs; i++) {
    const leaf = leaves[(i * 17) % leaves.length];
    const start = performance.now();
    const result = cache.invalidateDependency(leaf);
    samples.push((performance.now() - start) * 1000);
    invalidated += result.invalidated;
  }
  return summarize('dependency DAG invalidate', samples, invalidated);
}

function measureCacheQueryMutation(runs) {
  const samples = [];
  let patchOps = 0;
  for (let i = 0; i < runs; i++) {
    const cache = createQueryCache();
    const key = ['todos', { list: 'bench' }];
    cache.writeQuery(key, makeTodos(0, 512));
    const plan = createMutationPlan()
      .forEach(select('/*').where('done', '==', false).keyBy('id'), (rows) => {
        rows.increment('revision', 1);
      });
    const start = performance.now();
    const result = commitCacheQueryMutation(cache, key, plan);
    samples.push((performance.now() - start) * 1000);
    patchOps += result.patch.length + result.cachePatch.length;
  }
  return summarize('mutation bridge query commit', samples, patchOps);
}

function measureCacheEntityMutation(runs) {
  const cache = seedCache(4096, 64);
  const plan = createMutationPlan()
    .increment('/revision', 1)
    .toggle('/done');
  const samples = [];
  let patchOps = 0;
  for (let i = 0; i < runs; i++) {
    const page = i & 63;
    const id = 'Todo:' + String(((page * 31) % 4096) + (i & 31));
    const start = performance.now();
    const result = commitCacheEntityMutation(cache, id, plan);
    samples.push((performance.now() - start) * 1000);
    patchOps += result.patch.length + result.cachePatch.length;
  }
  return summarize('mutation bridge entity commit', samples, patchOps);
}

function seedCache(rowCount, queryCount) {
  const cache = createQueryCache();
  for (let i = 0; i < queryCount; i++) {
    const offset = (i * 31) % rowCount;
    cache.writeQuery(['todos', { page: i }], makeTodos(offset, 32));
  }
  return cache;
}

function seedScoredCache(rowCount) {
  const cache = createQueryCache();
  const rowsById = new Map();
  const pageSize = 32;
  for (let offset = 0; offset < rowCount; offset += pageSize) {
    const page = makeScoredTodos(offset, Math.min(pageSize, rowCount - offset));
    cache.writeQuery(['scores', { page: Math.floor(offset / pageSize) }], page);
    for (let i = 0; i < page.length; i++) rowsById.set(page[i].id, { ...page[i] });
  }
  return { cache, rowsById };
}

function seedDependencyDagCache(rowCount, queryCount) {
  const cache = createQueryCache();
  const bundleCount = Math.max(32, queryCount);
  const moduleCount = Math.max(64, bundleCount * 8);
  const leafCount = Math.max(256, Math.min(Math.max(rowCount, 1), moduleCount * 4));
  const moduleLeafDeps = new Array(moduleCount);
  const affectedHashesByLeaf = new Map();

  for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex++) {
    const dependencies = [
      'field:' + String((moduleIndex * 17) % leafCount),
      'field:' + String((moduleIndex * 17 + 193) % leafCount),
      'field:' + String((moduleIndex * 17 + 389) % leafCount),
      'field:' + String((moduleIndex * 17 + 769) % leafCount)
    ];
    moduleLeafDeps[moduleIndex] = dependencies;
    cache.setDependencyNode({ id: 'module:' + String(moduleIndex), dependencies });
  }

  for (let bundleIndex = 0; bundleIndex < bundleCount; bundleIndex++) {
    const queryKey = ['artifact', { bundle: bundleIndex }];
    cache.writeQuery(queryKey, makeDependencyBundle(bundleIndex));
    const queryHash = cache.getQueryHash(queryKey);
    const dependencies = new Array(8);
    for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex++) {
      const moduleIndex = (bundleIndex * 13 + dependencyIndex * 127) % moduleCount;
      dependencies[dependencyIndex] = 'module:' + String(moduleIndex);
      const leaves = moduleLeafDeps[moduleIndex];
      for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
        const leaf = leaves[leafIndex];
        let affected = affectedHashesByLeaf.get(leaf);
        if (affected === undefined) affectedHashesByLeaf.set(leaf, (affected = new Set()));
        affected.add(queryHash);
      }
    }
    cache.setDependencyNode({ id: 'bundle:' + String(bundleIndex), dependencies, queryKey });
  }

  return { cache, leaves: Array.from(affectedHashesByLeaf.keys()), affectedHashesByLeaf };
}

function makeDependencyBundle(bundleIndex) {
  const rows = new Array(4);
  for (let i = 0; i < rows.length; i++) {
    rows[i] = {
      id: 'artifact-' + bundleIndex + '-' + i,
      revision: bundleIndex + i,
      weight: (bundleIndex * 97 + i * 13) % 1000
    };
  }
  return { id: 'bundle-' + bundleIndex, rows };
}

function makeTodos(offset, count) {
  const rows = new Array(count);
  for (let i = 0; i < count; i++) {
    const id = offset + i;
    rows[i] = {
      __typename: 'Todo',
      id: String(id),
      group: 'g' + (id & 7),
      text: 'todo-' + id,
      done: (id & 1) === 0,
      revision: 0,
      owner: {
        __typename: 'User',
        id: 'u' + (id & 15),
        name: 'user-' + (id & 15)
      }
    };
  }
  return rows;
}

function makeScoredTodos(offset, count) {
  const rows = new Array(count);
  for (let i = 0; i < count; i++) {
    const id = offset + i;
    rows[i] = {
      __typename: 'Todo',
      id: String(id),
      group: 'g' + (id & 7),
      score: (id * 48271) % 100000,
      revision: 0,
      text: 'score-' + id
    };
  }
  return rows;
}

function nextScoreMutation(rowsById, rowCount, iteration) {
  const id = String((iteration * 97) % rowCount);
  const row = rowsById.get(id);
  row.score = (Number(row.score) + 7919 + iteration) % 100000;
  row.revision = Number(row.revision) + 1;
  return row;
}

function computeTopKRows(rowsById, limit) {
  const top = [];
  for (const row of rowsById.values()) {
    if (row.group !== 'g0') continue;
    insertTopKRow(top, row, limit);
  }
  const out = new Array(top.length);
  for (let i = 0; i < top.length; i++) out[i] = projectScoreEntity(top[i]);
  return out;
}

function insertTopKRow(top, row, limit) {
  let index = 0;
  const id = 'Todo:' + row.id;
  while (index < top.length && compareScoreEntities(row, top[index], id, 'Todo:' + top[index].id) >= 0) {
    index++;
  }
  if (index >= limit) return;
  top.splice(index, 0, row);
  if (top.length > limit) top.length = limit;
}

function compareScoreEntities(left, right, leftId, rightId) {
  return Number(right.score) - Number(left.score) || leftId.localeCompare(rightId);
}

function projectScoreEntity(entity) {
  return {
    __typename: 'Todo',
    id: String(entity.id),
    group: String(entity.group),
    score: Number(entity.score),
    revision: Number(entity.revision)
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function summarize(fixture, samples, events) {
  samples.sort((left, right) => left - right);
  return {
    fixture,
    medianUs: percentile(samples, 0.5),
    p95Us: percentile(samples, 0.95),
    events
  };
}

function percentile(samples, point) {
  return samples[Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * point) - 1))];
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rounds') out.rounds = argv[++i];
    else if (arg === '--rows') out.rows = argv[++i];
    else if (arg === '--queries') out.queries = argv[++i];
    else if (arg === '--iterations') out.iterations = argv[++i];
    else throw new Error('unknown argument: ' + arg);
  }
  return out;
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function padRight(value, width) {
  return String(value).padEnd(width, ' ');
}

function padLeft(value, width) {
  return String(value).padStart(width, ' ');
}
