import { cloneJson } from '@shapeshift-labs/frontier/clone';
import { OP_SET } from '@shapeshift-labs/frontier/constants';
import { diff } from '@shapeshift-labs/frontier/diff';
import { equalsJsonFast } from '@shapeshift-labs/frontier/equal';
import { hashQueryKey, identifyQueryEntity, partialMatchQueryKey } from '@shapeshift-labs/frontier-query';
import type {
  JsonObject,
  JsonPath,
  JsonValue,
  Patch,
  PatchOperation
} from '@shapeshift-labs/frontier/types';
import type { QueryEntityIdentifyContext, QueryEntityInput } from '@shapeshift-labs/frontier-query';

const REF_KEY = '\u0000frontierRef';

type QueryCacheScalarKey = string | number | boolean | null;
type QueryCacheInternalRef = { [REF_KEY]: string };
type QueryCacheInternalArray = QueryCacheInternalValue[];
type QueryCacheInternalObject = { [key: string]: QueryCacheInternalValue };
type QueryCacheInternalValue =
  | QueryCacheScalarKey
  | QueryCacheInternalRef
  | QueryCacheInternalArray
  | QueryCacheInternalObject;

type QueryCacheEntry = {
  key: QueryCacheKey;
  hash: string;
  root: QueryCacheInternalValue;
  value: JsonValue;
  dependencies: Set<string>;
  stale: boolean;
  updatedAt: number;
};

type QueryCachePendingPatch = {
  patch: Patch;
};

export type QueryCacheKey = JsonValue;
export type QueryCacheEntityId = string;
export type QueryCacheWatchCallback = (patch: Patch) => void;
export type QueryCacheEventListener = (event: QueryCacheEvent) => void;
export type QueryCacheEntityInput = QueryEntityInput;
export type QueryCacheIdentifyContext = QueryEntityIdentifyContext;

export interface QueryCacheSubscription {
  readonly active: boolean;
  unsubscribe(): void;
}

export type QueryCacheMergeContext = {
  key: QueryCacheKey;
  hash: string;
};

export type QueryCacheMergeFunction = (
  existing: JsonValue | undefined,
  incoming: JsonValue,
  context: QueryCacheMergeContext
) => JsonValue;

export interface QueryCacheOptions {
  typenameField?: string;
  idFields?: readonly string[];
  now?: () => number;
  identify?: (value: JsonObject, context: QueryCacheIdentifyContext) => QueryCacheEntityId | null | undefined;
}

export interface QueryCacheWriteOptions {
  merge?: QueryCacheMergeFunction;
  updatedAt?: number;
  stale?: boolean;
}

export interface QueryCacheFilter {
  queryKey?: QueryCacheKey;
  exact?: boolean;
  predicate?: (entry: QueryCacheEntryInfo) => boolean;
}

export interface QueryCacheEntryInfo {
  key: QueryCacheKey;
  hash: string;
  dependencies: readonly QueryCacheEntityId[];
  stale: boolean;
  updatedAt: number;
}

export interface QueryCacheSnapshot {
  entities: Record<string, JsonObject>;
  queries: QueryCacheSnapshotQuery[];
}

export interface QueryCacheSnapshotQuery {
  key: QueryCacheKey;
  hash: string;
  root: unknown;
  value: JsonValue;
  dependencies: QueryCacheEntityId[];
  stale: boolean;
  updatedAt: number;
}

export interface QueryCacheStorageAdapter {
  load(): QueryCacheSnapshot | null | undefined | Promise<QueryCacheSnapshot | null | undefined>;
  save(snapshot: QueryCacheSnapshot): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export interface QueryCachePersistenceOptions {
  autoHydrate?: boolean;
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

export interface QueryCachePersistenceStats {
  loads: number;
  saves: number;
  pending: boolean;
  disposed: boolean;
}

export interface QueryCachePersistence {
  hydrate(): Promise<boolean>;
  flush(): Promise<void>;
  clear(): Promise<void>;
  dispose(): void;
  getStats(): QueryCachePersistenceStats;
}

export interface QueryCacheMemoryStorageAdapter extends QueryCacheStorageAdapter {
  getSnapshot(): QueryCacheSnapshot | null;
}

export interface QueryCacheChangeLogCheckpoint {
  seq: number;
}

export interface QueryCacheChangeLogEntry {
  seq: number;
  type: QueryCacheEvent['type'];
  key?: QueryCacheKey;
  hash?: string;
  entityId?: QueryCacheEntityId;
  patch?: Patch;
  patchOperations?: number;
  stale?: boolean;
  updatedAt?: number;
}

export interface QueryCacheChangeLogOptions {
  capacity?: number;
  includePatches?: boolean;
}

export interface QueryCacheChangeLogStats {
  entries: number;
  firstSeq: number;
  lastSeq: number;
  dropped: number;
  disposed: boolean;
}

export interface QueryCacheChangeLog {
  readonly checkpoint: QueryCacheChangeLogCheckpoint;
  readSince(checkpoint?: QueryCacheChangeLogCheckpoint | number | null, limit?: number): QueryCacheChangeLogEntry[];
  ack(checkpoint: QueryCacheChangeLogCheckpoint | number): void;
  clear(): void;
  dispose(): void;
  getStats(): QueryCacheChangeLogStats;
}

export type QueryCacheEvent =
  | {
      type: 'query';
      key: QueryCacheKey;
      hash: string;
      patch: Patch;
      stale: boolean;
      updatedAt: number;
    }
  | {
      type: 'entity';
      id: QueryCacheEntityId;
      patch: Patch;
    }
  | {
      type: 'invalidate';
      key?: QueryCacheKey;
      hash?: string;
      entityId?: QueryCacheEntityId;
    }
  | {
      type: 'restore' | 'clear';
    };

export interface QueryCache {
  writeQuery(key: QueryCacheKey, data: JsonValue, options?: QueryCacheWriteOptions): Patch;
  getQueryData(key: QueryCacheKey): JsonValue | undefined;
  getQueryInfo(key: QueryCacheKey): QueryCacheEntryInfo | undefined;
  getQueryHash(key: QueryCacheKey): string;
  watchQuery(key: QueryCacheKey, callback: QueryCacheWatchCallback): QueryCacheSubscription;
  watchEntity(entity: QueryCacheEntityInput, callback: QueryCacheWatchCallback): QueryCacheSubscription;
  subscribe(listener: QueryCacheEventListener): () => void;
  identify(value: QueryCacheEntityInput, path?: JsonPath): QueryCacheEntityId | null;
  getEntity(entity: QueryCacheEntityInput): JsonObject | undefined;
  modifyEntity(
    entity: QueryCacheEntityInput,
    updater: (current: JsonObject | undefined) => JsonObject | null | undefined
  ): Patch;
  invalidateQueries(filter?: QueryCacheFilter): number;
  invalidateEntity(entity: QueryCacheEntityInput): number;
  batch<T>(callback: () => T): T;
  optimistic<T>(layerId: string, callback: () => T): T;
  resolveOptimistic(layerId: string): boolean;
  rollbackOptimistic(layerId: string): boolean;
  extract(): QueryCacheSnapshot;
  restore(snapshot: QueryCacheSnapshot): void;
  clear(): void;
}

export interface OffsetPageMergeOptions {
  offset?: number;
}

export interface UniqueListMergeOptions {
  key?: string | ((value: JsonValue, index: number) => string | number | null | undefined);
}

export function createQueryCache(options: QueryCacheOptions = {}): QueryCache {
  const typenameField = options.typenameField || '__typename';
  const idFields = options.idFields || ['id', '_id'];
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const entities = new Map<QueryCacheEntityId, QueryCacheInternalObject>();
  const queries = new Map<string, QueryCacheEntry>();
  const entityQueries = new Map<QueryCacheEntityId, Set<string>>();
  const queryWatchers = new Map<string, Set<QueryCacheWatchCallback>>();
  const entityWatchers = new Map<string, Set<QueryCacheWatchCallback>>();
  const listeners = new Set<QueryCacheEventListener>();
  const optimisticLayers = new Map<string, QueryCacheSnapshot>();
  const pendingQueries = new Map<string, QueryCachePendingPatch>();
  const pendingEntities = new Map<string, QueryCachePendingPatch>();
  const pendingEvents: QueryCacheEvent[] = [];
  let batchDepth = 0;

  function writeQuery(key: QueryCacheKey, data: JsonValue, writeOptions: QueryCacheWriteOptions = {}): Patch {
    const hash = hashQueryKey(key);
    const previous = queries.get(hash);
    const incoming = writeOptions.merge
      ? writeOptions.merge(previous ? previous.value : undefined, data, { key, hash })
      : data;
    const dependencies = new Set<QueryCacheEntityId>();
    const changedEntities = new Set<QueryCacheEntityId>();
    const root = normalizeValue(incoming, dependencies, changedEntities, []);
    collectReachableDependencies(root, dependencies, new Set());
    const value = denormalizeValue(root, new Set()) as JsonValue;
    const patch = previous === undefined
      ? rootSetPatch(value)
      : diff(previous.value, value);
    const nextEntry: QueryCacheEntry = {
      key: cloneJson(key),
      hash,
      root,
      value: cloneJson(value),
      dependencies,
      stale: writeOptions.stale === true,
      updatedAt: writeOptions.updatedAt === undefined ? now() : writeOptions.updatedAt
    };
    queries.set(hash, nextEntry);
    updateQueryDependencyIndex(hash, previous ? previous.dependencies : undefined, dependencies);
    if (patch.length !== 0) {
      queueQueryPatch(hash, patch);
    }
    refreshDependentQueries(changedEntities, hash);
    return clonePatch(patch);
  }

  function getQueryData(key: QueryCacheKey): JsonValue | undefined {
    const entry = queries.get(hashQueryKey(key));
    return entry === undefined ? undefined : cloneJson(entry.value);
  }

  function getQueryInfo(key: QueryCacheKey): QueryCacheEntryInfo | undefined {
    const entry = queries.get(hashQueryKey(key));
    return entry === undefined ? undefined : entryInfo(entry);
  }

  function watchQuery(key: QueryCacheKey, callback: QueryCacheWatchCallback): QueryCacheSubscription {
    if (typeof callback !== 'function') throw new TypeError('watchQuery callback must be a function');
    const hash = hashQueryKey(key);
    let bucket = queryWatchers.get(hash);
    if (bucket === undefined) queryWatchers.set(hash, (bucket = new Set()));
    bucket.add(callback);
    return {
      get active() {
        return bucket.has(callback);
      },
      unsubscribe() {
        bucket.delete(callback);
        if (bucket.size === 0) queryWatchers.delete(hash);
      }
    };
  }

  function watchEntity(entity: QueryCacheEntityInput, callback: QueryCacheWatchCallback): QueryCacheSubscription {
    if (typeof callback !== 'function') throw new TypeError('watchEntity callback must be a function');
    const id = identify(entity);
    if (id === null) throw new TypeError('watchEntity could not identify entity');
    let bucket = entityWatchers.get(id);
    if (bucket === undefined) entityWatchers.set(id, (bucket = new Set()));
    bucket.add(callback);
    return {
      get active() {
        return bucket.has(callback);
      },
      unsubscribe() {
        bucket.delete(callback);
        if (bucket.size === 0) entityWatchers.delete(id);
      }
    };
  }

  function subscribe(listener: QueryCacheEventListener): () => void {
    if (typeof listener !== 'function') throw new TypeError('subscribe listener must be a function');
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function identify(input: QueryCacheEntityInput, path: JsonPath = []): QueryCacheEntityId | null {
    return identifyQueryEntity(input, {
      typenameField,
      idFields,
      identify: options.identify === undefined
        ? undefined
        : (value, context) => options.identify?.(value, context)
    }, path);
  }

  function getEntity(entity: QueryCacheEntityInput): JsonObject | undefined {
    const id = identify(entity);
    if (id === null) return undefined;
    const record = entities.get(id);
    return record === undefined ? undefined : denormalizeValue(record, new Set()) as JsonObject;
  }

  function modifyEntity(
    entity: QueryCacheEntityInput,
    updater: (current: JsonObject | undefined) => JsonObject | null | undefined
  ): Patch {
    if (typeof updater !== 'function') throw new TypeError('modifyEntity updater must be a function');
    const id = identify(entity);
    if (id === null) throw new TypeError('modifyEntity could not identify entity');
    const previous = getEntity(id);
    const next = updater(previous === undefined ? undefined : cloneJson(previous));
    if (next === undefined || next === null) return [];
    const previousRecord = entities.get(id);
    const dependencies = new Set<QueryCacheEntityId>();
    const changedEntities = new Set<QueryCacheEntityId>();
    const normalized = normalizeObject(next, dependencies, changedEntities, []);
    entities.set(id, normalized);
    changedEntities.add(id);
    const previousValue = previousRecord === undefined
      ? undefined
      : denormalizeValue(previousRecord, new Set()) as JsonValue;
    const nextValue = denormalizeValue(normalized, new Set()) as JsonValue;
    const entityPatch = previousValue === undefined ? rootSetPatch(nextValue) : diff(previousValue, nextValue);
    if (entityPatch.length !== 0) queueEntityPatch(id, entityPatch);
    refreshDependentQueries(changedEntities);
    return clonePatch(entityPatch);
  }

  function invalidateQueries(filter: QueryCacheFilter = {}): number {
    let count = 0;
    for (const entry of queries.values()) {
      if (!matchesFilter(entry, filter)) continue;
      if (!entry.stale) {
        entry.stale = true;
        count++;
      }
      queueEvent({ type: 'invalidate', key: cloneJson(entry.key), hash: entry.hash });
    }
    return count;
  }

  function invalidateEntity(entity: QueryCacheEntityInput): number {
    const id = identify(entity);
    if (id === null) return 0;
    let count = 0;
    const hashes = entityQueries.get(id);
    if (hashes === undefined) return 0;
    for (const hash of Array.from(hashes)) {
      const entry = queries.get(hash);
      if (entry === undefined || !entry.dependencies.has(id)) continue;
      if (!entry.stale) {
        entry.stale = true;
        count++;
      }
      queueEvent({
        type: 'invalidate',
        key: cloneJson(entry.key),
        hash: entry.hash,
        entityId: id
      });
    }
    return count;
  }

  function batch<T>(callback: () => T): T {
    batchDepth++;
    try {
      return callback();
    } finally {
      batchDepth--;
      if (batchDepth === 0) flushPending();
    }
  }

  function optimistic<T>(layerId: string, callback: () => T): T {
    if (!optimisticLayers.has(layerId)) optimisticLayers.set(layerId, extract());
    return batch(callback);
  }

  function resolveOptimistic(layerId: string): boolean {
    return optimisticLayers.delete(layerId);
  }

  function rollbackOptimistic(layerId: string): boolean {
    const snapshot = optimisticLayers.get(layerId);
    if (snapshot === undefined) return false;
    optimisticLayers.delete(layerId);
    restore(snapshot);
    return true;
  }

  function extract(): QueryCacheSnapshot {
    const entityOut: Record<string, JsonObject> = {};
    for (const [id, value] of entities) {
      entityOut[id] = cloneInternalAsJson(value) as JsonObject;
    }
    const queryOut: QueryCacheSnapshotQuery[] = [];
    for (const entry of queries.values()) {
      queryOut[queryOut.length] = {
        key: cloneJson(entry.key),
        hash: entry.hash,
        root: cloneInternalAsJson(entry.root),
        value: cloneJson(entry.value),
        dependencies: Array.from(entry.dependencies).sort(),
        stale: entry.stale,
        updatedAt: entry.updatedAt
      };
    }
    return { entities: entityOut, queries: queryOut };
  }

  function restore(snapshot: QueryCacheSnapshot): void {
    batch(() => {
      const previousQueryValues = new Map<string, JsonValue>();
      for (const [hash, entry] of queries) previousQueryValues.set(hash, cloneJson(entry.value));
      entities.clear();
      queries.clear();
      entityQueries.clear();
      const snapshotEntities = snapshot && snapshot.entities && typeof snapshot.entities === 'object'
        ? snapshot.entities
        : {};
      for (const id of Object.keys(snapshotEntities)) {
        entities.set(id, cloneJson(snapshotEntities[id]) as QueryCacheInternalObject);
      }
      const snapshotQueries = Array.isArray(snapshot && snapshot.queries) ? snapshot.queries : [];
      for (let i = 0; i < snapshotQueries.length; i++) {
        const item = snapshotQueries[i];
        const dependencies = new Set<QueryCacheEntityId>(item.dependencies || []);
        queries.set(item.hash, {
          key: cloneJson(item.key),
          hash: item.hash,
          root: cloneInternalValue(item.root),
          value: cloneJson(item.value),
          dependencies,
          stale: item.stale === true,
          updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : now()
        });
        updateQueryDependencyIndex(item.hash, undefined, dependencies);
      }
      for (const [hash, entry] of queries) {
        const previous = previousQueryValues.get(hash);
        const patch = previous === undefined ? rootSetPatch(entry.value) : diff(previous, entry.value);
        if (patch.length !== 0) queueQueryPatch(hash, patch);
        previousQueryValues.delete(hash);
      }
      for (const [hash] of previousQueryValues) {
        queueQueryPatch(hash, rootSetPatch(null));
      }
      queueEvent({ type: 'restore' });
    });
  }

  function clear(): void {
    batch(() => {
      const previousQueries = Array.from(queries.values());
      entities.clear();
      queries.clear();
      entityQueries.clear();
      for (let i = 0; i < previousQueries.length; i++) {
        queueQueryPatch(previousQueries[i].hash, rootSetPatch(null));
      }
      queueEvent({ type: 'clear' });
    });
  }

  function normalizeValue(
    value: JsonValue,
    dependencies: Set<QueryCacheEntityId>,
    changedEntities: Set<QueryCacheEntityId>,
    path: JsonPath
  ): QueryCacheInternalValue {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const out = new Array(value.length) as QueryCacheInternalArray;
      for (let i = 0; i < value.length; i++) {
        out[i] = normalizeValue(value[i], dependencies, changedEntities, path.concat(i));
      }
      return out;
    }
    const object = normalizeObject(value, dependencies, changedEntities, path);
    const id = identify(value, path);
    if (id !== null) {
      dependencies.add(id);
      const previous = entities.get(id);
      const changed = previous === undefined || !equalsJsonFast(
        previous as unknown as JsonValue,
        object as unknown as JsonValue
      );
      entities.set(id, object);
      if (changed) changedEntities.add(id);
      if (hasEntityObservers(id)) {
        if (changed && previous !== undefined) {
          const previousValue = denormalizeValue(previous, new Set()) as JsonValue;
          const nextValue = denormalizeValue(object, new Set()) as JsonValue;
          queueEntityPatch(id, diff(previousValue, nextValue));
        } else if (changed) {
          queueEntityPatch(id, rootSetPatch(denormalizeValue(object, new Set()) as JsonValue));
        }
      }
      return createReference(id);
    }
    return object;
  }

  function normalizeObject(
    value: JsonObject,
    dependencies: Set<QueryCacheEntityId>,
    changedEntities: Set<QueryCacheEntityId>,
    path: JsonPath
  ): QueryCacheInternalObject {
    const out: QueryCacheInternalObject = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const item = value[key];
      out[key] = normalizeValue(item, dependencies, changedEntities, path.concat(key));
    }
    return out;
  }

  function denormalizeValue(value: QueryCacheInternalValue, seen: Set<QueryCacheEntityId>): JsonValue {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const out = new Array(value.length);
      for (let i = 0; i < value.length; i++) out[i] = denormalizeValue(value[i], seen);
      return out as JsonValue;
    }
    if (isReference(value)) {
      const id = value[REF_KEY];
      if (seen.has(id)) return null;
      const record = entities.get(id);
      if (record === undefined) return null;
      seen.add(id);
      const denormalized = denormalizeValue(record, seen);
      seen.delete(id);
      return denormalized;
    }
    const out: JsonObject = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      out[key] = denormalizeValue(value[key], seen);
    }
    return out;
  }

  function collectReachableDependencies(value: QueryCacheInternalValue, out: Set<QueryCacheEntityId>, seen: Set<QueryCacheEntityId>): void {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) collectReachableDependencies(value[i], out, seen);
      return;
    }
    if (isReference(value)) {
      const id = value[REF_KEY];
      if (seen.has(id)) return;
      out.add(id);
      seen.add(id);
      const record = entities.get(id);
      if (record !== undefined) collectReachableDependencies(record, out, seen);
      seen.delete(id);
      return;
    }
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) collectReachableDependencies(value[keys[i]], out, seen);
  }

  function refreshDependentQueries(ids: Set<QueryCacheEntityId>, skipHash?: string): void {
    const hashes = new Set<string>();
    for (const id of ids) {
      const bucket = entityQueries.get(id);
      if (bucket !== undefined) {
        for (const hash of bucket) hashes.add(hash);
      }
    }
    for (const hash of hashes) {
      if (hash === skipHash) continue;
      const entry = queries.get(hash);
      if (entry === undefined) continue;
      const previous = entry.value;
      const previousDependencies = entry.dependencies;
      const dependencies = new Set<QueryCacheEntityId>();
      collectReachableDependencies(entry.root, dependencies, new Set());
      const next = denormalizeValue(entry.root, new Set()) as JsonValue;
      entry.dependencies = dependencies;
      updateQueryDependencyIndex(entry.hash, previousDependencies, dependencies);
      entry.value = next;
      entry.updatedAt = now();
      entry.stale = false;
      if (!hasQueryObservers(entry.hash)) continue;
      const patch = diff(previous, next);
      if (patch.length !== 0) queueQueryPatch(entry.hash, patch);
    }
  }

  function queueQueryPatch(hash: string, patch: Patch): void {
    if (patch.length === 0) return;
    const entry = queries.get(hash);
    if (batchDepth > 0) {
      const pending = pendingQueries.get(hash);
      if (pending === undefined) pendingQueries.set(hash, { patch: clonePatch(patch) });
      else pending.patch.push(...clonePatch(patch));
      if (entry !== undefined) {
        pendingEvents.push({
          type: 'query',
          key: cloneJson(entry.key),
          hash,
          patch: clonePatch(patch),
          stale: entry.stale,
          updatedAt: entry.updatedAt
        });
      }
      return;
    }
    emitQueryPatch(hash, patch);
  }

  function queueEntityPatch(id: QueryCacheEntityId, patch: Patch): void {
    if (patch.length === 0) return;
    if (!hasEntityObservers(id)) return;
    if (batchDepth > 0) {
      const pending = pendingEntities.get(id);
      if (pending === undefined) pendingEntities.set(id, { patch: clonePatch(patch) });
      else pending.patch.push(...clonePatch(patch));
      pendingEvents.push({ type: 'entity', id, patch: clonePatch(patch) });
      return;
    }
    emitEntityPatch(id, patch);
  }

  function queueEvent(event: QueryCacheEvent): void {
    if (batchDepth > 0) {
      pendingEvents[pendingEvents.length] = event;
      return;
    }
    emitEvent(event);
  }

  function flushPending(): void {
    const queryItems = Array.from(pendingQueries);
    const entityItems = Array.from(pendingEntities);
    const events = pendingEvents.splice(0, pendingEvents.length);
    pendingQueries.clear();
    pendingEntities.clear();
    for (let i = 0; i < queryItems.length; i++) emitQueryPatch(queryItems[i][0], queryItems[i][1].patch, false);
    for (let i = 0; i < entityItems.length; i++) emitEntityPatch(entityItems[i][0], entityItems[i][1].patch, false);
    for (let i = 0; i < events.length; i++) emitEvent(events[i]);
  }

  function emitQueryPatch(hash: string, patch: Patch, emitQueryEvent = true): void {
    const bucket = queryWatchers.get(hash);
    if (bucket !== undefined) {
      const callbacks = Array.from(bucket);
      for (let i = 0; i < callbacks.length; i++) callbacks[i](clonePatch(patch));
    }
    if (!emitQueryEvent) return;
    const entry = queries.get(hash);
    if (entry !== undefined) {
      emitEvent({
        type: 'query',
        key: cloneJson(entry.key),
        hash,
        patch: clonePatch(patch),
        stale: entry.stale,
        updatedAt: entry.updatedAt
      });
    }
  }

  function emitEntityPatch(id: QueryCacheEntityId, patch: Patch, emitEntityEvent = true): void {
    const bucket = entityWatchers.get(id);
    if (bucket !== undefined) {
      const callbacks = Array.from(bucket);
      for (let i = 0; i < callbacks.length; i++) callbacks[i](clonePatch(patch));
    }
    if (emitEntityEvent) emitEvent({ type: 'entity', id, patch: clonePatch(patch) });
  }

  function hasEntityObservers(id: QueryCacheEntityId): boolean {
    const bucket = entityWatchers.get(id);
    return listeners.size !== 0 || (bucket !== undefined && bucket.size !== 0);
  }

  function hasQueryObservers(hash: string): boolean {
    const bucket = queryWatchers.get(hash);
    return listeners.size !== 0 || (bucket !== undefined && bucket.size !== 0);
  }

  function updateQueryDependencyIndex(
    hash: string,
    previous: Set<QueryCacheEntityId> | undefined,
    next: Set<QueryCacheEntityId>
  ): void {
    if (previous !== undefined) {
      for (const id of previous) {
        if (next.has(id)) continue;
        const bucket = entityQueries.get(id);
        if (bucket === undefined) continue;
        bucket.delete(hash);
        if (bucket.size === 0) entityQueries.delete(id);
      }
    }
    for (const id of next) {
      if (previous !== undefined && previous.has(id)) continue;
      let bucket = entityQueries.get(id);
      if (bucket === undefined) entityQueries.set(id, (bucket = new Set()));
      bucket.add(hash);
    }
  }

  function emitEvent(event: QueryCacheEvent): void {
    if (listeners.size === 0) return;
    const callbacks = Array.from(listeners);
    for (let i = 0; i < callbacks.length; i++) callbacks[i](cloneEvent(event));
  }

  return {
    writeQuery,
    getQueryData,
    getQueryInfo,
    getQueryHash: hashQueryKey,
    watchQuery,
    watchEntity,
    subscribe,
    identify,
    getEntity,
    modifyEntity,
    invalidateQueries,
    invalidateEntity,
    batch,
    optimistic,
    resolveOptimistic,
    rollbackOptimistic,
    extract,
    restore,
    clear
  };
}

export { hashQueryKey, partialMatchQueryKey } from '@shapeshift-labs/frontier-query';

export function mergeOffsetPage(existing: JsonValue | undefined, incoming: JsonValue, options: OffsetPageMergeOptions = {}): JsonValue {
  if (!Array.isArray(incoming)) return cloneJson(incoming);
  const offset = Math.max(0, Math.floor(options.offset || 0));
  const out = Array.isArray(existing) ? cloneJson(existing) : [];
  for (let i = 0; i < incoming.length; i++) out[offset + i] = cloneJson(incoming[i]);
  return out as JsonValue;
}

export function mergeUniqueList(existing: JsonValue | undefined, incoming: JsonValue, options: UniqueListMergeOptions = {}): JsonValue {
  if (!Array.isArray(incoming)) return cloneJson(incoming);
  const out = Array.isArray(existing) ? cloneJson(existing) : [];
  const seen = new Set<string | number>();
  for (let i = 0; i < out.length; i++) {
    const key = readUniqueListKey(out[i], i, options);
    if (key !== null && key !== undefined) seen.add(key);
  }
  for (let i = 0; i < incoming.length; i++) {
    const item = incoming[i];
    const key = readUniqueListKey(item, i, options);
    if (key !== null && key !== undefined) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out[out.length] = cloneJson(item);
  }
  return out as JsonValue;
}

export function createQueryCacheMemoryStorageAdapter(initial: QueryCacheSnapshot | null = null): QueryCacheMemoryStorageAdapter {
  let snapshot = initial === null ? null : cloneSnapshot(initial);
  return {
    load() {
      return snapshot === null ? null : cloneSnapshot(snapshot);
    },
    save(next: QueryCacheSnapshot) {
      snapshot = cloneSnapshot(next);
    },
    clear() {
      snapshot = null;
    },
    getSnapshot() {
      return snapshot === null ? null : cloneSnapshot(snapshot);
    }
  };
}

export function persistQueryCache(
  cache: QueryCache,
  storage: QueryCacheStorageAdapter,
  options: QueryCachePersistenceOptions = {}
): QueryCachePersistence {
  if (cache === null || typeof cache !== 'object') throw new TypeError('persistQueryCache cache must be an object');
  if (storage === null || typeof storage !== 'object') throw new TypeError('persistQueryCache storage must be an object');
  if (typeof storage.load !== 'function') throw new TypeError('persistQueryCache storage.load must be a function');
  if (typeof storage.save !== 'function') throw new TypeError('persistQueryCache storage.save must be a function');

  const debounceMs = Math.max(0, Math.floor(options.debounceMs || 0));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let muted = false;
  let disposed = false;
  let saving = false;
  let saveRequested = false;
  let pending = false;
  let loads = 0;
  let saves = 0;
  let savePromise: Promise<void> = Promise.resolve();

  const unsubscribe = cache.subscribe(() => {
    if (muted || disposed) return;
    scheduleSave();
  });

  async function hydrate(): Promise<boolean> {
    if (disposed) return false;
    try {
      const snapshot = await storage.load();
      loads++;
      if (snapshot === null || snapshot === undefined) return false;
      muted = true;
      try {
        cache.restore(snapshot);
      } finally {
        muted = false;
      }
      return true;
    } catch (error) {
      reportError(error);
      throw error;
    }
  }

  async function flush(): Promise<void> {
    if (disposed) return;
    clearScheduledSave();
    await requestSave();
  }

  async function clear(): Promise<void> {
    clearScheduledSave();
    if (typeof storage.clear === 'function') {
      await storage.clear();
      return;
    }
    await storage.save({ entities: {}, queries: [] });
    saves++;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearScheduledSave();
    unsubscribe();
  }

  function getStats(): QueryCachePersistenceStats {
    return { loads, saves, pending, disposed };
  }

  function scheduleSave(): void {
    if (debounceMs === 0) {
      void requestSave().catch(() => undefined);
      return;
    }
    clearScheduledSave();
    pending = true;
    timer = setTimeout(() => {
      timer = undefined;
      void requestSave().catch(() => undefined);
    }, debounceMs);
  }

  function clearScheduledSave(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function requestSave(): Promise<void> {
    if (disposed) return Promise.resolve();
    saveRequested = true;
    pending = true;
    if (!saving) savePromise = runSaveLoop();
    return savePromise;
  }

  async function runSaveLoop(): Promise<void> {
    saving = true;
    try {
      while (saveRequested && !disposed) {
        saveRequested = false;
        await storage.save(cache.extract());
        saves++;
      }
    } catch (error) {
      saveRequested = false;
      reportError(error);
      throw error;
    } finally {
      saving = false;
      pending = saveRequested || timer !== undefined;
      if (saveRequested && !disposed) savePromise = runSaveLoop();
    }
  }

  function reportError(error: unknown): void {
    if (typeof options.onError === 'function') options.onError(error);
  }

  if (options.autoHydrate === true) void hydrate().catch(() => undefined);

  return { hydrate, flush, clear, dispose, getStats };
}

export function createQueryCacheChangeLog(
  cache: QueryCache,
  options: QueryCacheChangeLogOptions = {}
): QueryCacheChangeLog {
  if (cache === null || typeof cache !== 'object') throw new TypeError('createQueryCacheChangeLog cache must be an object');
  const capacity = Math.max(1, Math.floor(options.capacity || 1024));
  const includePatches = options.includePatches !== false;
  const entries: QueryCacheChangeLogEntry[] = [];
  let seq = 0;
  let dropped = 0;
  let disposed = false;

  const unsubscribe = cache.subscribe((event) => {
    if (disposed) return;
    const entry = eventToChangeLogEntry(++seq, event, includePatches);
    entries[entries.length] = entry;
    while (entries.length > capacity) {
      entries.shift();
      dropped++;
    }
  });

  function readSince(
    checkpoint: QueryCacheChangeLogCheckpoint | number | null = 0,
    limit?: number
  ): QueryCacheChangeLogEntry[] {
    const after = readCheckpointSeq(checkpoint);
    const max = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(limit));
    const out: QueryCacheChangeLogEntry[] = [];
    for (let i = 0; i < entries.length && out.length < max; i++) {
      if (entries[i].seq > after) out[out.length] = cloneChangeLogEntry(entries[i]);
    }
    return out;
  }

  function ack(checkpoint: QueryCacheChangeLogCheckpoint | number): void {
    const through = readCheckpointSeq(checkpoint);
    let remove = 0;
    while (remove < entries.length && entries[remove].seq <= through) remove++;
    if (remove !== 0) entries.splice(0, remove);
  }

  function clear(): void {
    entries.splice(0, entries.length);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    unsubscribe();
  }

  function getStats(): QueryCacheChangeLogStats {
    return {
      entries: entries.length,
      firstSeq: entries.length === 0 ? 0 : entries[0].seq,
      lastSeq: seq,
      dropped,
      disposed
    };
  }

  return {
    get checkpoint() {
      return { seq };
    },
    readSince,
    ack,
    clear,
    dispose,
    getStats
  };
}

export function summarizeQueryCacheChanges(entries: readonly QueryCacheChangeLogEntry[]): JsonObject {
  const byType: JsonObject = {};
  const hashes: string[] = [];
  const entityIds: string[] = [];
  const seenHashes = new Set<string>();
  const seenEntities = new Set<string>();
  let patchOperations = 0;
  let stale = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    byType[entry.type] = Number(byType[entry.type] || 0) + 1;
    patchOperations += entry.patchOperations || (entry.patch ? entry.patch.length : 0);
    if (entry.stale === true) stale++;
    if (entry.hash !== undefined && !seenHashes.has(entry.hash)) {
      seenHashes.add(entry.hash);
      if (hashes.length < 16) hashes[hashes.length] = entry.hash;
    }
    if (entry.entityId !== undefined && !seenEntities.has(entry.entityId)) {
      seenEntities.add(entry.entityId);
      if (entityIds.length < 16) entityIds[entityIds.length] = entry.entityId;
    }
  }

  return {
    count: entries.length,
    firstSeq: entries.length === 0 ? 0 : entries[0].seq,
    lastSeq: entries.length === 0 ? 0 : entries[entries.length - 1].seq,
    byType,
    patchOperations,
    stale,
    hashes,
    entityIds
  };
}

function matchesFilter(entry: QueryCacheEntry, filter: QueryCacheFilter): boolean {
  if (filter.queryKey !== undefined) {
    if (filter.exact === true) {
      if (entry.hash !== hashQueryKey(filter.queryKey)) return false;
    } else if (!partialMatchQueryKey(entry.key, filter.queryKey)) {
      return false;
    }
  }
  return filter.predicate === undefined || filter.predicate(entryInfo(entry));
}

function entryInfo(entry: QueryCacheEntry): QueryCacheEntryInfo {
  return {
    key: cloneJson(entry.key),
    hash: entry.hash,
    dependencies: Array.from(entry.dependencies).sort(),
    stale: entry.stale,
    updatedAt: entry.updatedAt
  };
}

function readUniqueListKey(value: JsonValue, index: number, options: UniqueListMergeOptions): string | number | null | undefined {
  if (typeof options.key === 'function') return options.key(value, index);
  if (typeof options.key === 'string' && isJsonObject(value)) {
    const key = value[options.key];
    return isEntityIdValue(key) ? String(key) : null;
  }
  if (isJsonObject(value)) {
    const typename = value.__typename;
    const id = value.id === undefined ? value._id : value.id;
    if (typeof typename === 'string' && isEntityIdValue(id)) return typename + ':' + String(id);
    if (isEntityIdValue(id)) return String(id);
  }
  return hashQueryKey(value);
}

function rootSetPatch(value: JsonValue): Patch {
  return [[OP_SET, [], cloneJson(value)] as PatchOperation];
}

function clonePatch(patch: Patch): Patch {
  return cloneJson(patch as JsonValue) as Patch;
}

function cloneEvent(event: QueryCacheEvent): QueryCacheEvent {
  if (event.type === 'query') {
    return {
      type: 'query',
      key: cloneJson(event.key),
      hash: event.hash,
      patch: clonePatch(event.patch),
      stale: event.stale,
      updatedAt: event.updatedAt
    };
  }
  if (event.type === 'entity') return { type: 'entity', id: event.id, patch: clonePatch(event.patch) };
  if (event.type === 'invalidate') {
    return {
      type: 'invalidate',
      key: event.key === undefined ? undefined : cloneJson(event.key),
      hash: event.hash,
      entityId: event.entityId
    };
  }
  return { type: event.type };
}

function eventToChangeLogEntry(
  seq: number,
  event: QueryCacheEvent,
  includePatches: boolean
): QueryCacheChangeLogEntry {
  if (event.type === 'query') {
    const entry: QueryCacheChangeLogEntry = {
      seq,
      type: 'query',
      key: cloneJson(event.key),
      hash: event.hash,
      patchOperations: event.patch.length,
      stale: event.stale,
      updatedAt: event.updatedAt
    };
    if (includePatches) entry.patch = clonePatch(event.patch);
    return entry;
  }
  if (event.type === 'entity') {
    const entry: QueryCacheChangeLogEntry = {
      seq,
      type: 'entity',
      entityId: event.id,
      patchOperations: event.patch.length
    };
    if (includePatches) entry.patch = clonePatch(event.patch);
    return entry;
  }
  if (event.type === 'invalidate') {
    return {
      seq,
      type: 'invalidate',
      key: event.key === undefined ? undefined : cloneJson(event.key),
      hash: event.hash,
      entityId: event.entityId
    };
  }
  return { seq, type: event.type };
}

function cloneChangeLogEntry(entry: QueryCacheChangeLogEntry): QueryCacheChangeLogEntry {
  return {
    seq: entry.seq,
    type: entry.type,
    key: entry.key === undefined ? undefined : cloneJson(entry.key),
    hash: entry.hash,
    entityId: entry.entityId,
    patch: entry.patch === undefined ? undefined : clonePatch(entry.patch),
    patchOperations: entry.patchOperations,
    stale: entry.stale,
    updatedAt: entry.updatedAt
  };
}

function readCheckpointSeq(checkpoint: QueryCacheChangeLogCheckpoint | number | null | undefined): number {
  if (checkpoint === null || checkpoint === undefined) return 0;
  if (typeof checkpoint === 'number') return Math.max(0, Math.floor(checkpoint));
  return Math.max(0, Math.floor(checkpoint.seq || 0));
}

function cloneSnapshot(snapshot: QueryCacheSnapshot): QueryCacheSnapshot {
  return cloneJson(snapshot as unknown as JsonValue) as unknown as QueryCacheSnapshot;
}

function createReference(id: string): QueryCacheInternalRef {
  return { [REF_KEY]: id };
}

function isReference(value: QueryCacheInternalObject | QueryCacheInternalRef): value is QueryCacheInternalRef {
  return Object.keys(value).length === 1 && typeof value[REF_KEY] === 'string';
}

function isEntityIdValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneInternalAsJson(value: QueryCacheInternalValue | unknown): JsonValue {
  return cloneJson(value as JsonValue);
}

function cloneInternalValue(value: unknown): QueryCacheInternalValue {
  return cloneJson(value as JsonValue) as QueryCacheInternalValue;
}
