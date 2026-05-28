# Frontier State Cache

Normalized query-result cache for Frontier packages and application state.

This package stores query results with normalized entities, query/entity watchers, optimistic layers, persistence helpers, and a small mutation bridge for committing `@shapeshift-labs/frontier-mutation` plans into cached queries or entities.

- npm: [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache)
- source: [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- license: MIT

## Related Packages

The published Frontier package family is generated from one shared package catalog so READMEs stay in sync across packages:

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): Core JSON diff/apply, compact patch tuples, JSON Pointer, equality, clone, validation, Unicode helpers.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): Shared query-key, selector path, condition, entity identity, and table-shape primitives.
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec): Patch serialization, binary frames, canonical JSON, and patch-history codecs.
- [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine): Stateful planned diff engine, adaptive profiles, schema plans, and engine-level history helpers.
- [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state): Patch-routed app-state subscriptions, owned commits, maintained views, and path mapping.
- [`@shapeshift-labs/frontier-state-cache-idb`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-idb): IndexedDB persistence adapter for Frontier state-cache snapshots.
- [`@shapeshift-labs/frontier-state-cache-file`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-file): Structured file persistence adapter for Frontier state-cache snapshots and change logs.
- [`@shapeshift-labs/frontier-state-cache-sql`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-sql): SQL persistence adapter for Frontier state-cache snapshots and change logs.
- [`@shapeshift-labs/frontier-schema`](https://www.npmjs.com/package/@shapeshift-labs/frontier-schema): JSON Schema validation, Frontier profile generation, CloudEvent envelopes, and query/table schema helpers.
- [`@shapeshift-labs/frontier-event-log`](https://www.npmjs.com/package/@shapeshift-labs/frontier-event-log): Bounded event logs, replay cursors, consumer acknowledgements, keyed compaction, checkpoints, and Frontier patch event records.
- [`@shapeshift-labs/frontier-scheduler`](https://www.npmjs.com/package/@shapeshift-labs/frontier-scheduler): Deterministic work scheduling, lanes, cancellation, backpressure, frame policies, replay snapshots, and work graphs.
- [`@shapeshift-labs/frontier-logging`](https://www.npmjs.com/package/@shapeshift-labs/frontier-logging): Opt-in structured logging, browser telemetry, file sinks, exporters, benchmark traces, and Frontier patch/update summaries.
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation): Explicit mutation and selector plans compiled to Frontier patches or CRDT operations.
- [`@shapeshift-labs/frontier-virtual`](https://www.npmjs.com/package/@shapeshift-labs/frontier-virtual): DOM-neutral virtualization, layout providers, range materialization, grids, spatial culling, frustum culling, and serializable layout state.
- [`@shapeshift-labs/frontier-dom`](https://www.npmjs.com/package/@shapeshift-labs/frontier-dom): Patch-native DOM and host renderer bindings, manifest hydration, JSX runtime/compiler helpers, SSR, devtools, and logging bridges.
- [`@shapeshift-labs/frontier-crdt`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt): Native CRDT documents, update tooling, awareness, branches, conflict introspection, version frames, and undo.
- [`@shapeshift-labs/frontier-crdt-sync`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-sync): CRDT sync endpoints, repo/storage/provider contracts, document URLs, local networks, model checking, forensics, and text binding contracts.
- [`@shapeshift-labs/frontier-crdt-websocket`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-websocket): WebSocket client/server transports for Frontier CRDT sync providers.
- [`@shapeshift-labs/frontier-react`](https://www.npmjs.com/package/@shapeshift-labs/frontier-react): React external-store hooks and adapters for Frontier state, cache, and CRDT surfaces.
- [`@shapeshift-labs/frontier-richtext`](https://www.npmjs.com/package/@shapeshift-labs/frontier-richtext): Rich text Delta normalization/application, marks, embeds, ranges, and cursor/selection transforms for local editor integrations.
- [`@shapeshift-labs/frontier-realtime`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime): Shared realtime command, tick, snapshot, prediction, reconciliation, interpolation, rollback, message, and delta primitives.
- [`@shapeshift-labs/frontier-realtime-server`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime-server): Authoritative realtime room, tick, command validation, rate-limit, session, and snapshot-history runtime.
- [`@shapeshift-labs/frontier-realtime-websocket`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime-websocket): WebSocket client, wire, and Node room-server transport for Frontier realtime.
- [`@shapeshift-labs/frontier-game`](https://www.npmjs.com/package/@shapeshift-labs/frontier-game): Game-facing entity, component, player, room, ownership, spatial interest, rollback, physics, and replication helpers above realtime.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)
- [`siliconjungle/-shapeshift-labs-frontier-engine`](https://github.com/siliconjungle/-shapeshift-labs-frontier-engine)
- [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-idb`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-idb)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-file`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-file)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-sql`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-sql)
- [`siliconjungle/-shapeshift-labs-frontier-schema`](https://github.com/siliconjungle/-shapeshift-labs-frontier-schema)
- [`siliconjungle/-shapeshift-labs-frontier-event-log`](https://github.com/siliconjungle/-shapeshift-labs-frontier-event-log)
- [`siliconjungle/-shapeshift-labs-frontier-scheduler`](https://github.com/siliconjungle/-shapeshift-labs-frontier-scheduler)
- [`siliconjungle/-shapeshift-labs-frontier-logging`](https://github.com/siliconjungle/-shapeshift-labs-frontier-logging)
- [`siliconjungle/-shapeshift-labs-frontier-mutation`](https://github.com/siliconjungle/-shapeshift-labs-frontier-mutation)
- [`siliconjungle/-shapeshift-labs-frontier-virtual`](https://github.com/siliconjungle/-shapeshift-labs-frontier-virtual)
- [`siliconjungle/-shapeshift-labs-frontier-dom`](https://github.com/siliconjungle/-shapeshift-labs-frontier-dom)
- [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-sync`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-sync)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-websocket)
- [`siliconjungle/-shapeshift-labs-frontier-react`](https://github.com/siliconjungle/-shapeshift-labs-frontier-react)
- [`siliconjungle/-shapeshift-labs-frontier-richtext`](https://github.com/siliconjungle/-shapeshift-labs-frontier-richtext)
- [`siliconjungle/-shapeshift-labs-frontier-realtime`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime)
- [`siliconjungle/-shapeshift-labs-frontier-realtime-server`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-server)
- [`siliconjungle/-shapeshift-labs-frontier-realtime-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-websocket)
- [`siliconjungle/-shapeshift-labs-frontier-game`](https://github.com/siliconjungle/-shapeshift-labs-frontier-game)

## Install

```sh
npm install @shapeshift-labs/frontier @shapeshift-labs/frontier-query @shapeshift-labs/frontier-state-cache
```

Install mutation too if you use the mutation bridge:

```sh
npm install @shapeshift-labs/frontier-mutation
```

## Usage

```js
import { createQueryCache } from '@shapeshift-labs/frontier-state-cache';

const cache = createQueryCache();
const key = ['todos', { status: 'open' }];

cache.writeQuery(key, [
  { __typename: 'Todo', id: 't1', text: 'ship', done: false }
]);

cache.watchQuery(key, (patch) => {
  console.log('query patch', patch);
});

cache.modifyEntity('Todo:t1', (todo) => ({
  ...todo,
  done: true
}));

console.log(cache.getQueryData(key));
```

## API

```ts
import {
  createQueryCache,
  createQueryCacheChangeLog,
  createQueryCacheMemoryStorageAdapter,
  mergeOffsetPage,
  mergeUniqueList,
  persistQueryCache,
  summarizeQueryCacheChanges,
  type QueryCache,
  type QueryCacheCatchUpResult,
  type QueryCacheDependencyNode,
  type QueryCacheMaintainedQueryOptions
} from '@shapeshift-labs/frontier-state-cache';
```

Core exports:

- `createQueryCache(options?)` creates an in-memory normalized query cache.
- `cache.writeQuery(key, data, options?)` stores a query result and normalizes identifiable entities.
- `cache.getQueryData(key)` reads the current denormalized query result.
- `cache.modifyEntity(entity, updater)` updates one normalized entity and repairs dependent query snapshots.
- `cache.removeEntity(entity)` removes one normalized entity, repairs dependent query snapshots, and emits the entity removal through the same deferred batch/change-log path as writes.
- `cache.maintainQuery(key, options?)` keeps a derived query result repaired from normalized entities.
- `cache.setDependencyNode(node)` and `cache.invalidateDependency(id)` track explicit producer-supplied dependency DAGs for derived query invalidation.
- `cache.readQueryCatchUp(key, { lastSeenClock?, limit? })` reads per-query element changes newer than a subscriber's stored clock.
- `cache.getQueryCatchUpClock(key)` returns the current high-water catch-up clock for a query.
- `cache.watchQuery(key, callback)` subscribes to compact Frontier patches for one query.
- `cache.watchEntity(entity, callback)` subscribes to compact Frontier patches for one entity.
- `cache.invalidateQueries(filter?)` and `cache.invalidateEntity(entity)` mark affected queries stale.
- `cache.optimistic(layerId, callback)`, `resolveOptimistic(layerId)`, and `rollbackOptimistic(layerId)` manage optimistic layers.
- `cache.extract()` and `cache.restore(snapshot)` move cache state across storage boundaries.

### Maintained Queries

Use maintained queries for generic top-k, latest-N, filtered-list, or query-repair views that should update when normalized entities change:

```js
const topOpen = ['todos', { status: 'open', top: 10 }];

const handle = cache.maintainQuery(topOpen, {
  filter: (entity) => entity.__typename === 'Todo' && entity.status === 'open',
  sort: (left, right, leftId, rightId) => (
    Number(right.score) - Number(left.score) || leftId.localeCompare(rightId)
  ),
  limit: 10,
  select: (entity) => ({
    __typename: 'Todo',
    id: entity.id,
    score: entity.score,
    title: entity.title
  })
});

cache.modifyEntity('Todo:t1', (todo) => ({ ...todo, score: Number(todo.score) + 1 }));
console.log(cache.getQueryData(topOpen));

handle.unsubscribe();
```

### Subscription Catch-Up Clocks

Use query catch-up clocks when a subscriber reconnects with a stored `lastSeenClock` and should receive only rows changed since that clock:

```js
const key = ['todos', { status: 'open' }];

cache.writeQuery(key, [
  { __typename: 'Todo', id: 't1', title: 'Ship', done: false }
]);

const first = cache.readQueryCatchUp(key);
sendToClient(first.changes);

cache.modifyEntity('Todo:t1', (todo) => ({ ...todo, done: true }));

const next = cache.readQueryCatchUp(key, {
  lastSeenClock: first.highWaterClock,
  limit: 64
});

sendToClient(next.changes);
storeClientClock(next.nextLastSeenClock);
```

Catch-up clocks are monotonically increasing server-side metadata outside the JSON value. Entity rows, maintained-query insertions, and maintained-query removals receive per-query clocks; scalar or aggregate query rewrites fall back to a full query-value catch-up record. `limit` responses set `complete: false` and advance `nextLastSeenClock` only to the last emitted change.

### Dependency DAG Invalidation

Use dependency nodes when an application already knows the footprint for a derived result, such as a route, compiler artifact, order-book slice, or dashboard aggregate. Frontier does not trace reads; producers supply stable dependency ids.

```js
const routeKey = ['route', { id: 'a' }];

cache.writeQuery(routeKey, { id: 'a', eta: 12 });
cache.setDependencyNode({ id: 'segment:a', dependencies: ['edge:1', 'traffic:1'] });
cache.setDependencyNode({ id: 'route:a', dependencies: ['segment:a'], queryKey: routeKey });

const result = cache.invalidateDependency('traffic:1');
console.log(result.invalidated); // 1
```

`setDependencyNode()` rejects cycles, `deleteDependencyNode(id)` removes a node and its edges, and `invalidateDependency(id)` walks reverse edges to mark only reachable attached queries stale.

### Entity Identity

By default entities are identified by `__typename` plus `id` or `_id`.

```js
const cache = createQueryCache({
  identify(value) {
    if (value.kind === 'Issue' && typeof value.slug === 'string') {
      return 'Issue:' + value.slug;
    }
    return null;
  }
});
```

### Merge Policies

`writeQuery()` accepts merge functions for pagination and list repair:

```js
import { mergeOffsetPage, mergeUniqueList } from '@shapeshift-labs/frontier-state-cache';

cache.writeQuery(['todos'], nextPage, {
  merge: (existing, incoming) => mergeOffsetPage(existing, incoming, { offset: 40 })
});

cache.writeQuery(['todos'], incomingRows, {
  merge: (existing, incoming) => mergeUniqueList(existing, incoming, { key: 'id' })
});
```

### Persistence And Change Logs

```js
import {
  createQueryCacheChangeLog,
  createQueryCacheMemoryStorageAdapter,
  persistQueryCache
} from '@shapeshift-labs/frontier-state-cache';

const storage = createQueryCacheMemoryStorageAdapter();
const persistence = persistQueryCache(cache, storage, {
  autoHydrate: true,
  debounceMs: 100,
  compactOnFlush: true,
  replayChangeLog: true,
  scheduler
});

await persistence.ready;
await persistence.flush();

const log = createQueryCacheChangeLog(cache, { capacity: 256 });
const entries = log.readSince(log.checkpoint);
```

`persistQueryCache()` owns hydrate/flush/debounce scheduling for the cache. Pass a structural `scheduler` to route save work through a deterministic lane with backpressure; without one it falls back to the package-local debounce path. The returned `persistence.ready` promise resolves the first auto-hydrate attempt. Storage adapters that expose `appendChange(entry)` also receive durable change-log entries automatically unless `changeLog: false` is passed; if they also expose `readChangeLog()`, persistence seeds new entries from the highest retained `seq` after a restart.

Pass `replayChangeLog: true` to hydrate a stored snapshot and then apply retained post-checkpoint query/entity/invalidation entries from `readChangeLog()`. This is intentionally opt-in: adapters should pair it with `compactOnFlush: true` or an equivalent checkpoint policy so retained log entries represent changes after the loaded snapshot. Storage adapters that expose `compact(snapshot)` can be used with `compactOnFlush: true` to checkpoint a snapshot and trim adapter-owned logs during flush.

### Mutation Bridge

The mutation bridge is isolated in an optional subpath so normal cache imports do not load mutation planning code:

```js
import { createMutationPlan, select } from '@shapeshift-labs/frontier-mutation';
import {
  cacheMutationAccessesConflict,
  commitCacheQueryMutation,
  getCacheQueryMutationAccess
} from '@shapeshift-labs/frontier-state-cache/mutation';

const plan = createMutationPlan()
  .forEach(select('/*').where('done', '==', false).keyBy('id'), (rows) => {
    rows.set('done', true);
  });

const result = commitCacheQueryMutation(cache, ['todos', { status: 'open' }], plan, { access: true });
const retryAccess = getCacheQueryMutationAccess(['todos', { status: 'open' }], plan);

console.log(result.patch);      // mutation patch
console.log(result.cachePatch); // cache watcher patch
console.log(cacheMutationAccessesConflict(result.access, retryAccess));
```

Mutation bridge exports:

- `compileCacheQueryMutation(cache, key, plan, options?)` compiles a plan against a cached query without committing it.
- `commitCacheQueryMutation(cache, key, plan, options?)` writes the resulting query value back to the cache.
- `commitCacheEntityMutation(cache, entity, plan, options?)` compiles and commits a plan against one normalized entity.
- `getCacheQueryMutationAccess(...)`, `getCacheEntityMutationAccess(...)`, and `cacheMutationAccessesConflict(...)` expose opt-in read/write/effect metadata for optimistic safety and batching. Passing `{ access: true }` attaches the metadata to commit results.

## Subpath Imports

```ts
import { createQueryCache } from '@shapeshift-labs/frontier-state-cache';
import { commitCacheEntityMutation } from '@shapeshift-labs/frontier-state-cache/mutation';
```

## Package Scope

This package owns normalized query-result storage:

- query-key hashing and partial matching through `@shapeshift-labs/frontier-query`,
- entity normalization and denormalized query repair,
- query/entity patch watchers,
- optimistic layers,
- persistence snapshots and bounded change logs,
- optional mutation bridge helpers.

It does not own selector syntax, core diff/apply, planned diff engines, CRDT documents, sync providers, rich text, or patch codecs.

## TypeScript

The package ships ESM JavaScript plus `.d.ts` declarations for the root export and the `./mutation` subpath. The package-local TypeScript source lives in `src/` and compiles directly to `dist/`.

## Validation

```sh
npm test
npm run fuzz
npm run bench
npm run pack:dry
```

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package benchmark on Node v26.1.0, darwin arm64, 9 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Write normalized query result | 272.93 us | 299.11 us |
| Modify normalized entity | 11.33 us | 23.25 us |
| Remove normalized entity | 445.79 us | 1.42 ms |
| Modify entity with query watchers | 9.63 us | 16.37 us |
| Subscription catch-up read | 1.21 us | 3.08 us |
| Top-k recompute scan | 100.58 us | 308.50 us |
| Top-k maintained index | 12.25 us | 53.46 us |
| Offset page merge write | 1.36 ms | 2.57 ms |
| Dependency scan invalidate | 28.62 us | 49.25 us |
| Dependency DAG invalidate | 1.79 us | 4.50 us |
| Memory persistence flush | 1.71 ms | 2.62 ms |
| Memory replay hydrate | 31.15 ms | 39.44 ms |
| Bounded change-log read | 0.29 us | 0.71 us |
| Mutation bridge query commit | 5.57 ms | 7.27 ms |
| Mutation bridge entity commit | 10.46 us | 20.79 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
