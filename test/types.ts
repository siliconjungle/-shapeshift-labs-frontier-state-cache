import {
  createQueryCache,
  createQueryCacheChangeLog,
  createQueryCacheMemoryStorageAdapter,
  mergeOffsetPage,
  mergeUniqueList,
  persistQueryCache,
  type QueryCache,
  type QueryCacheChangeLog,
  type QueryCacheSnapshot,
  type QueryCacheSubscription
} from '../dist/index.js';
import {
  cacheMutationAccessesConflict,
  commitCacheEntityMutation,
  commitCacheQueryMutation,
  compileCacheQueryMutation,
  getCacheEntityMutationAccess,
  getCacheQueryMutationAccess,
  type CacheEntityMutationCommitResult,
  type CacheMutationAccess,
  type CacheQueryMutationCommitResult,
  type CacheQueryMutationResult
} from '../dist/mutation.js';
import { createMutationPlan, getMutationPlanAccess, select, type MutationPlanAccess } from '@shapeshift-labs/frontier-mutation';
import type { JsonObject, JsonValue, Patch } from '@shapeshift-labs/frontier/types';

const cache: QueryCache = createQueryCache();
const key: JsonValue = ['todos', { status: 'open' }];
const initial: JsonValue = [
  { __typename: 'Todo', id: 't1', text: 'ship', done: false }
];

const patch: Patch = cache.writeQuery(key, initial);
const value: JsonValue | undefined = cache.getQueryData(key);
const subscription: QueryCacheSubscription = cache.watchQuery(key, (queryPatch) => {
  const received: Patch = queryPatch;
  void received;
});

const plan = createMutationPlan()
  .forEach(select('/*').where('done', '==', false), (rows) => {
    rows.set('done', true);
  });

const compiled: CacheQueryMutationResult = compileCacheQueryMutation(cache, key, plan);
const committed: CacheQueryMutationCommitResult = commitCacheQueryMutation(cache, key, plan);
const entityCommitted: CacheEntityMutationCommitResult = commitCacheEntityMutation(
  cache,
  { __typename: 'Todo', id: 't1' },
  createMutationPlan().assign([], { text: 'done' })
);
const mutationAccess: MutationPlanAccess = getMutationPlanAccess(plan);
const queryAccess: CacheMutationAccess = getCacheQueryMutationAccess(key, plan);
const entityAccess: CacheMutationAccess = getCacheEntityMutationAccess(cache, 'Todo:t1', plan);
const accessConflict: boolean = cacheMutationAccessesConflict(queryAccess, entityAccess);

const page: JsonValue = mergeOffsetPage(value, initial, { offset: 0 });
const unique: JsonValue = mergeUniqueList(value, initial, { key: 'id' });
const snapshot: QueryCacheSnapshot = cache.extract();
const storage = createQueryCacheMemoryStorageAdapter();
const persistence = persistQueryCache(cache, storage);
const log: QueryCacheChangeLog = createQueryCacheChangeLog(cache);
const entity: JsonObject | undefined = cache.getEntity('Todo:t1');
const removePatch: Patch = cache.removeEntity('Todo:t1');

void patch;
void subscription;
void compiled;
void committed;
void entityCommitted;
void mutationAccess;
void queryAccess;
void entityAccess;
void accessConflict;
void page;
void unique;
void snapshot;
void persistence;
void log;
void entity;
void removePatch;
