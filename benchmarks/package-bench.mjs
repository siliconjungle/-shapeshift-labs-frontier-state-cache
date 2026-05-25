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
  measureWatchedEntityModify(rows, queries, iterations),
  measureOffsetMerge(rows, iterations),
  await measurePersistenceFlush(rows, queries, Math.max(40, Math.floor(iterations / 8))),
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
