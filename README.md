# Frontier State Cache

Normalized query-result cache for Frontier packages and application state.

This package stores query results with normalized entities, query/entity watchers, optimistic layers, persistence helpers, and a small mutation bridge for committing `@shapeshift-labs/frontier-mutation` plans into cached queries or entities.

- npm: [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache)
- source: [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- license: MIT

## Related Packages

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): core JSON diff/apply primitives used for watcher patches.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): shared query-key, selector path, condition, identity, and table-schema primitives.
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation): optional mutation-plan bridge available from `@shapeshift-labs/frontier-state-cache/mutation`.
- [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine): planned diff engine for higher-level state and mutation layers.
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec): patch serialization, binary frames, canonical JSON, and patch-history codecs.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-mutation`](https://github.com/siliconjungle/-shapeshift-labs-frontier-mutation)
- [`siliconjungle/-shapeshift-labs-frontier-engine`](https://github.com/siliconjungle/-shapeshift-labs-frontier-engine)
- [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)

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
  type QueryCache
} from '@shapeshift-labs/frontier-state-cache';
```

Core exports:

- `createQueryCache(options?)` creates an in-memory normalized query cache.
- `cache.writeQuery(key, data, options?)` stores a query result and normalizes identifiable entities.
- `cache.getQueryData(key)` reads the current denormalized query result.
- `cache.modifyEntity(entity, updater)` updates one normalized entity and repairs dependent query snapshots.
- `cache.watchQuery(key, callback)` subscribes to compact Frontier patches for one query.
- `cache.watchEntity(entity, callback)` subscribes to compact Frontier patches for one entity.
- `cache.invalidateQueries(filter?)` and `cache.invalidateEntity(entity)` mark affected queries stale.
- `cache.optimistic(layerId, callback)`, `resolveOptimistic(layerId)`, and `rollbackOptimistic(layerId)` manage optimistic layers.
- `cache.extract()` and `cache.restore(snapshot)` move cache state across storage boundaries.

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
const persistence = persistQueryCache(cache, storage, { debounceMs: 100 });
await persistence.flush();

const log = createQueryCacheChangeLog(cache, { capacity: 256 });
const entries = log.readSince(log.checkpoint);
```

### Mutation Bridge

The mutation bridge is isolated in an optional subpath so normal cache imports do not load mutation planning code:

```js
import { createMutationPlan, select } from '@shapeshift-labs/frontier-mutation';
import { commitCacheQueryMutation } from '@shapeshift-labs/frontier-state-cache/mutation';

const plan = createMutationPlan()
  .forEach(select('/*').where('done', '==', false).keyBy('id'), (rows) => {
    rows.set('done', true);
  });

const result = commitCacheQueryMutation(cache, ['todos', { status: 'open' }], plan);

console.log(result.patch);      // mutation patch
console.log(result.cachePatch); // cache watcher patch
```

Mutation bridge exports:

- `compileCacheQueryMutation(cache, key, plan, options?)` compiles a plan against a cached query without committing it.
- `commitCacheQueryMutation(cache, key, plan, options?)` writes the resulting query value back to the cache.
- `commitCacheEntityMutation(cache, entity, plan, options?)` compiles and commits a plan against one normalized entity.

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

Latest local package benchmark on Node v26.1.0, darwin arm64, 3 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Write normalized query result | 171.06 us | 187.54 us |
| Modify normalized entity | 30.33 us | 52.33 us |
| Modify entity with query watchers | 63.04 us | 115.54 us |
| Offset page merge write | 15.97 ms | 23.28 ms |
| Memory persistence flush | 7.30 ms | 10.06 ms |
| Bounded change-log read | 0.37 us | 1.25 us |
| Mutation bridge query commit | 3.88 ms | 6.41 ms |
| Mutation bridge entity commit | 34.37 us | 61.21 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
