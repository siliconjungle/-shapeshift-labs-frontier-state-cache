import { cloneJson } from '@shapeshift-labs/frontier/clone';
import { OP_ARRAY_ASSIGN, OP_ARRAY_OBJECT_FIELD_ASSIGN, OP_SET } from '@shapeshift-labs/frontier/constants';
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
const REF_FIELDS_KEY = '\u0000frontierFields';
const EMPTY_PATH: JsonPath = [];
const OFFSET_PAGE_MERGE = Symbol('frontier.offsetPageMerge');
const MEMORY_STORAGE_SAVE_OWNED = Symbol('frontier.memoryStorageSaveOwned');
const QUERY_CACHE_EXTRACT_OWNED = Symbol('frontier.queryCacheExtractOwned');

type QueryCacheScalarKey = string | number | boolean | null;
type QueryCacheInternalRef = { [REF_KEY]: string; [REF_FIELDS_KEY]?: string[] };
type QueryCacheInternalArray = QueryCacheInternalValue[];
type QueryCacheInternalObject = { [key: string]: QueryCacheInternalValue };
type QueryCacheInternalValue =
  | QueryCacheScalarKey
  | QueryCacheInternalRef
  | QueryCacheInternalArray
  | QueryCacheInternalObject;
type QueryCacheDependencyFields = readonly string[] | Set<string> | null;

type QueryCacheEntry = {
  key: QueryCacheKey;
  hash: string;
  root: QueryCacheInternalValue;
  value: JsonValue;
  dependencies: Set<string>;
  dependencyFields: Map<QueryCacheEntityId, QueryCacheDependencyFields>;
  stale: boolean;
  updatedAt: number;
};

type QueryCachePendingPatch = {
  patch: Patch;
};

type OffsetPageMergeInfo = {
  offset: number;
  length: number;
};

type QueryCacheOwnedSnapshotStorage = {
  [MEMORY_STORAGE_SAVE_OWNED]?: (snapshot: QueryCacheSnapshot) => void | Promise<void>;
};

type QueryCacheOwnedSnapshotSource = {
  [QUERY_CACHE_EXTRACT_OWNED]?: () => QueryCacheSnapshot;
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
  removeEntity(entity: QueryCacheEntityInput): Patch;
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
  const identifyOption = options.identify === undefined
    ? undefined
    : (value: JsonObject, context: QueryCacheIdentifyContext) => options.identify?.(value, context);
  const identifyOptions = {
    typenameField,
    idFields,
    identify: identifyOption
  };
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
  const trackIdentifyPath = typeof options.identify === 'function';
  let batchDepth = 0;
  let sideEffectDepth = 0;

  function writeQuery(key: QueryCacheKey, data: JsonValue, writeOptions: QueryCacheWriteOptions = {}): Patch {
    if (listeners.size === 0) return writeQueryNow(key, data, writeOptions);
    enterDeferredSideEffects();
    try {
      return writeQueryNow(key, data, writeOptions);
    } finally {
      exitDeferredSideEffects();
    }
  }

  function writeQueryNow(key: QueryCacheKey, data: JsonValue, writeOptions: QueryCacheWriteOptions): Patch {
    const hash = hashQueryKey(key);
    const previous = queries.get(hash);
    const incoming = writeOptions.merge
      ? writeOptions.merge(previous ? previous.value : undefined, data, { key, hash })
      : data;
    const offsetMergeInfo = previous === undefined ? undefined : readOffsetPageMergeInfo(incoming);
    if (offsetMergeInfo !== undefined) {
      const offsetPatch = writeOffsetPageQuery(key, hash, previous, incoming, offsetMergeInfo, writeOptions);
      if (offsetPatch !== undefined) return offsetPatch;
    }
    const dependencies = new Set<QueryCacheEntityId>();
    const changedEntities = new Set<QueryCacheEntityId>();
    const changedEntityFields = new Map<QueryCacheEntityId, Set<string> | null>();
    const dependencyFields = new Map<QueryCacheEntityId, QueryCacheDependencyFields>();
    const root = normalizeValue(
      incoming,
      dependencies,
      dependencyFields,
      changedEntities,
      changedEntityFields,
      trackIdentifyPath ? [] : undefined
    );
    ensureDependencyFields(dependencyFields, dependencies);
    const value = denormalizeValue(root, new Set()) as JsonValue;
    const patch = previous === undefined
      ? rootSetPatch(value)
      : diff(previous.value, value);
    const nextEntry: QueryCacheEntry = {
      key: cloneJson(key),
      hash,
      root,
      value,
      dependencies,
      dependencyFields,
      stale: writeOptions.stale === true,
      updatedAt: writeOptions.updatedAt === undefined ? now() : writeOptions.updatedAt
    };
    queries.set(hash, nextEntry);
    updateQueryDependencyIndex(hash, previous ? previous.dependencies : undefined, dependencies);
    if (patch.length !== 0) {
      queueQueryPatch(hash, patch);
    }
    refreshDependentQueries(changedEntities, hash, changedEntityFields);
    return clonePatch(patch);
  }

  function writeOffsetPageQuery(
    key: QueryCacheKey,
    hash: string,
    previous: QueryCacheEntry,
    mergedValue: JsonValue,
    info: OffsetPageMergeInfo,
    writeOptions: QueryCacheWriteOptions
  ): Patch | undefined {
    if (!Array.isArray(previous.root) || !Array.isArray(previous.value) || !Array.isArray(mergedValue)) return undefined;
    if (mergedValue.length < info.offset + info.length) return undefined;
    const root = previous.root.slice() as QueryCacheInternalArray;
    const value = previous.value.slice() as JsonValue[];
    const changedEntities = new Set<QueryCacheEntityId>();
    const changedEntityFields = new Map<QueryCacheEntityId, Set<string> | null>();
    const pageDependencies = new Set<QueryCacheEntityId>();
    const pageDependencyFields = new Map<QueryCacheEntityId, QueryCacheDependencyFields>();
    const indexes: number[] = [];
    const values: JsonValue[] = [];
    const offset = info.offset;
    let fillsEmptySlots = true;

    for (let i = 0; i < info.length; i++) {
      const index = offset + i;
      if (previous.root[index] !== undefined) fillsEmptySlots = false;
      const normalized = normalizeValue(
        mergedValue[index],
        pageDependencies,
        pageDependencyFields,
        changedEntities,
        changedEntityFields,
        trackIdentifyPath ? [index] : undefined
      );
      root[index] = normalized;
      const nextValue = denormalizeValue(normalized, new Set()) as JsonValue;
      if (!equalsJsonFast(value[index], nextValue)) {
        indexes[indexes.length] = index;
        values[values.length] = cloneJson(nextValue);
      }
      value[index] = nextValue;
    }

    let dependencies: Set<QueryCacheEntityId>;
    let dependencyFields: Map<QueryCacheEntityId, QueryCacheDependencyFields>;
    if (indexes.length === 0 && changedEntities.size === 0) {
      dependencies = previous.dependencies;
      dependencyFields = previous.dependencyFields;
    } else if (fillsEmptySlots) {
      dependencies = new Set(previous.dependencies);
      for (const id of pageDependencies) dependencies.add(id);
      dependencyFields = cloneDependencyFields(previous.dependencyFields);
      mergeDependencyFields(dependencyFields, pageDependencyFields);
      ensureDependencyFields(dependencyFields, dependencies);
    } else {
      dependencies = new Set<QueryCacheEntityId>();
      collectReachableDependencies(root, dependencies, new Set());
      dependencyFields = collectDependencyFields(root);
      ensureDependencyFields(dependencyFields, dependencies);
    }
    const patch: Patch = indexes.length === 0
      ? []
      : [[OP_ARRAY_ASSIGN, [], indexes, values] as PatchOperation];
    const nextEntry: QueryCacheEntry = {
      key: cloneJson(key),
      hash,
      root,
      value: value as JsonValue,
      dependencies,
      dependencyFields,
      stale: writeOptions.stale === true,
      updatedAt: writeOptions.updatedAt === undefined ? now() : writeOptions.updatedAt
    };
    queries.set(hash, nextEntry);
    updateQueryDependencyIndex(hash, previous.dependencies, dependencies);
    if (patch.length !== 0) queueQueryPatch(hash, patch);
    refreshDependentQueries(changedEntities, hash, changedEntityFields);
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

  function identify(input: QueryCacheEntityInput, path?: JsonPath): QueryCacheEntityId | null {
    return identifyQueryEntity(input, identifyOptions, path || (trackIdentifyPath ? [] : EMPTY_PATH));
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
    if (listeners.size === 0) return modifyEntityNow(entity, updater);
    enterDeferredSideEffects();
    try {
      return modifyEntityNow(entity, updater);
    } finally {
      exitDeferredSideEffects();
    }
  }

  function modifyEntityNow(
    entity: QueryCacheEntityInput,
    updater: (current: JsonObject | undefined) => JsonObject | null | undefined
  ): Patch {
    if (typeof updater !== 'function') throw new TypeError('modifyEntity updater must be a function');
    const id = identify(entity);
    if (id === null) throw new TypeError('modifyEntity could not identify entity');
    const previous = getEntity(id);
    const next = updater(previous);
    if (next === undefined || next === null) return [];
    const previousRecord = entities.get(id);
    const dependencies = new Set<QueryCacheEntityId>();
    const changedEntities = new Set<QueryCacheEntityId>();
    const changedEntityFields = new Map<QueryCacheEntityId, Set<string> | null>();
    const dependencyFields = new Map<QueryCacheEntityId, QueryCacheDependencyFields>();
    const normalized = normalizeObject(
      next,
      dependencies,
      dependencyFields,
      changedEntities,
      changedEntityFields,
      trackIdentifyPath ? [] : undefined
    );
    entities.set(id, normalized);
    changedEntities.add(id);
    recordChangedEntityFields(changedEntityFields, id, collectChangedObjectFields(previousRecord, normalized));
    const previousValue = previousRecord === undefined
      ? undefined
      : denormalizeValue(previousRecord, new Set()) as JsonValue;
    const nextValue = denormalizeValue(normalized, new Set()) as JsonValue;
    const entityPatch = previousValue === undefined ? rootSetPatch(nextValue) : diff(previousValue, nextValue);
    if (entityPatch.length !== 0) queueEntityPatch(id, entityPatch);
    refreshDependentQueries(changedEntities, undefined, changedEntityFields);
    return clonePatch(entityPatch);
  }

  function removeEntity(entity: QueryCacheEntityInput): Patch {
    if (listeners.size === 0) return removeEntityNow(entity);
    enterDeferredSideEffects();
    try {
      return removeEntityNow(entity);
    } finally {
      exitDeferredSideEffects();
    }
  }

  function removeEntityNow(entity: QueryCacheEntityInput): Patch {
    const id = identify(entity);
    if (id === null) throw new TypeError('removeEntity could not identify entity');
    const previousRecord = entities.get(id);
    if (previousRecord === undefined) return [];
    const previousValue = denormalizeValue(previousRecord, new Set()) as JsonValue;
    entities.delete(id);
    const changedEntities = new Set<QueryCacheEntityId>([id]);
    const changedEntityFields = new Map<QueryCacheEntityId, Set<string> | null>([[id, null]]);
    const entityPatch = diff(previousValue, null);
    if (entityPatch.length !== 0) queueEntityPatch(id, entityPatch);
    refreshDependentQueries(changedEntities, undefined, changedEntityFields);
    return clonePatch(entityPatch);
  }

  function invalidateQueries(filter: QueryCacheFilter = {}): number {
    if (listeners.size === 0) return invalidateQueriesNow(filter);
    enterDeferredSideEffects();
    try {
      return invalidateQueriesNow(filter);
    } finally {
      exitDeferredSideEffects();
    }
  }

  function invalidateQueriesNow(filter: QueryCacheFilter): number {
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
    if (listeners.size === 0) return invalidateEntityNow(entity);
    enterDeferredSideEffects();
    try {
      return invalidateEntityNow(entity);
    } finally {
      exitDeferredSideEffects();
    }
  }

  function invalidateEntityNow(entity: QueryCacheEntityInput): number {
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

  function enterDeferredSideEffects(): void {
    sideEffectDepth++;
  }

  function exitDeferredSideEffects(): void {
    sideEffectDepth--;
    if (sideEffectDepth === 0 && batchDepth === 0) flushPending();
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

  function extractOwnedSnapshot(): QueryCacheSnapshot {
    const entityOut: Record<string, JsonObject> = {};
    for (const [id, value] of entities) {
      entityOut[id] = value as unknown as JsonObject;
    }
    const queryOut: QueryCacheSnapshotQuery[] = [];
    for (const entry of queries.values()) {
      queryOut[queryOut.length] = {
        key: entry.key,
        hash: entry.hash,
        root: entry.root,
        value: entry.value,
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
        const root = cloneInternalValue(item.root);
        const dependencyFields = collectDependencyFields(root);
        ensureDependencyFields(dependencyFields, dependencies);
        queries.set(item.hash, {
          key: cloneJson(item.key),
          hash: item.hash,
          root,
          value: cloneJson(item.value),
          dependencies,
          dependencyFields,
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
    dependencyFields: Map<QueryCacheEntityId, QueryCacheDependencyFields>,
    changedEntities: Set<QueryCacheEntityId>,
    changedEntityFields: Map<QueryCacheEntityId, Set<string> | null>,
    path: JsonPath | undefined
  ): QueryCacheInternalValue {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const out = new Array(value.length) as QueryCacheInternalArray;
      for (let i = 0; i < value.length; i++) {
        out[i] = normalizeValue(
          value[i],
          dependencies,
          dependencyFields,
          changedEntities,
          changedEntityFields,
          path === undefined ? undefined : path.concat(i)
        );
      }
      return out;
    }
    const keys = Object.keys(value);
    const object = normalizeObjectWithKeys(value, keys, dependencies, dependencyFields, changedEntities, changedEntityFields, path);
    const id = identify(value, path);
    if (id !== null) {
      dependencies.add(id);
      recordDependencyFields(dependencyFields, id, keys);
      const previous = entities.get(id);
      const merged = mergeEntityRecord(previous, object);
      const changed = previous === undefined || !equalsJsonFast(
        previous as unknown as JsonValue,
        merged as unknown as JsonValue
      );
      entities.set(id, merged);
      if (changed) {
        changedEntities.add(id);
        recordChangedEntityFields(changedEntityFields, id, collectChangedObjectFields(previous, merged));
      }
      if (hasEntityObservers(id)) {
        if (changed && previous !== undefined) {
          const previousValue = denormalizeValue(previous, new Set()) as JsonValue;
          const nextValue = denormalizeValue(merged, new Set()) as JsonValue;
          queueEntityPatch(id, diff(previousValue, nextValue));
        } else if (changed) {
          queueEntityPatch(id, rootSetPatch(denormalizeValue(merged, new Set()) as JsonValue));
        }
      }
      return createReference(id, keys);
    }
    return object;
  }

  function normalizeObject(
    value: JsonObject,
    dependencies: Set<QueryCacheEntityId>,
    dependencyFields: Map<QueryCacheEntityId, QueryCacheDependencyFields>,
    changedEntities: Set<QueryCacheEntityId>,
    changedEntityFields: Map<QueryCacheEntityId, Set<string> | null>,
    path: JsonPath | undefined
  ): QueryCacheInternalObject {
    return normalizeObjectWithKeys(
      value,
      Object.keys(value),
      dependencies,
      dependencyFields,
      changedEntities,
      changedEntityFields,
      path
    );
  }

  function normalizeObjectWithKeys(
    value: JsonObject,
    keys: readonly string[],
    dependencies: Set<QueryCacheEntityId>,
    dependencyFields: Map<QueryCacheEntityId, QueryCacheDependencyFields>,
    changedEntities: Set<QueryCacheEntityId>,
    changedEntityFields: Map<QueryCacheEntityId, Set<string> | null>,
    path: JsonPath | undefined
  ): QueryCacheInternalObject {
    const out: QueryCacheInternalObject = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const item = value[key];
      out[key] = normalizeValue(
        item,
        dependencies,
        dependencyFields,
        changedEntities,
        changedEntityFields,
        path === undefined ? undefined : path.concat(key)
      );
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
      const fields = readReferenceFields(value);
      const denormalized = fields === null
        ? denormalizeValue(record, seen)
        : denormalizeProjectedRecord(record, fields, seen);
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

  function denormalizeProjectedRecord(
    record: QueryCacheInternalObject,
    fields: readonly string[],
    seen: Set<QueryCacheEntityId>
  ): JsonValue {
    const out: JsonObject = {};
    for (let i = 0; i < fields.length; i++) {
      const key = fields[i];
      if (!Object.hasOwn(record, key)) continue;
      out[key] = denormalizeValue(record[key], seen);
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
      if (record !== undefined) {
        const fields = readReferenceFields(value);
        if (fields === null) {
          collectReachableDependencies(record, out, seen);
        } else {
          for (let i = 0; i < fields.length; i++) {
            const key = fields[i];
            if (Object.hasOwn(record, key)) collectReachableDependencies(record[key], out, seen);
          }
        }
      }
      seen.delete(id);
      return;
    }
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) collectReachableDependencies(value[keys[i]], out, seen);
  }

  function collectDependencyFields(
    value: QueryCacheInternalValue,
    out: Map<QueryCacheEntityId, QueryCacheDependencyFields> = new Map(),
    seen: Set<QueryCacheEntityId> = new Set()
  ): Map<QueryCacheEntityId, QueryCacheDependencyFields> {
    if (value === null || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) collectDependencyFields(value[i], out, seen);
      return out;
    }
    if (isReference(value)) {
      const id = value[REF_KEY];
      const fields = readReferenceFields(value);
      recordDependencyFields(out, id, fields);
      if (seen.has(id)) return out;
      const record = entities.get(id);
      if (record === undefined) return out;
      seen.add(id);
      if (fields === null) {
        collectDependencyFields(record, out, seen);
      } else {
        for (let i = 0; i < fields.length; i++) {
          const key = fields[i];
          if (Object.hasOwn(record, key)) collectDependencyFields(record[key], out, seen);
        }
      }
      seen.delete(id);
      return out;
    }
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) collectDependencyFields(value[keys[i]], out, seen);
    return out;
  }

  function cloneDependencyFields(
    fields: Map<QueryCacheEntityId, QueryCacheDependencyFields>
  ): Map<QueryCacheEntityId, QueryCacheDependencyFields> {
    const out = new Map<QueryCacheEntityId, QueryCacheDependencyFields>();
    for (const [id, value] of fields) {
      out.set(id, value === null ? null : Array.isArray(value) ? value : new Set(value));
    }
    return out;
  }

  function mergeDependencyFields(
    target: Map<QueryCacheEntityId, QueryCacheDependencyFields>,
    source: Map<QueryCacheEntityId, QueryCacheDependencyFields>
  ): void {
    for (const [id, fields] of source) {
      const previous = target.get(id);
      if (previous === null) continue;
      if (fields === null) {
        target.set(id, null);
        continue;
      }
      if (previous === undefined) {
        target.set(id, Array.isArray(fields) ? fields : new Set(fields));
        continue;
      }
      target.set(id, addDependencyFields(previous, fields));
    }
  }

  function recordDependencyFields(
    dependencyFields: Map<QueryCacheEntityId, QueryCacheDependencyFields>,
    id: QueryCacheEntityId,
    fields: readonly string[] | null
  ): void {
    const previous = dependencyFields.get(id);
    if (previous === null) return;
    if (fields === null) {
      dependencyFields.set(id, null);
      return;
    }
    if (previous === undefined) {
      dependencyFields.set(id, fields);
      return;
    }
    dependencyFields.set(id, addDependencyFields(previous, fields));
  }

  function ensureDependencyFields(
    dependencyFields: Map<QueryCacheEntityId, QueryCacheDependencyFields>,
    dependencies: Set<QueryCacheEntityId>
  ): void {
    for (const id of dependencies) {
      if (!dependencyFields.has(id)) dependencyFields.set(id, null);
    }
    for (const id of dependencyFields.keys()) {
      if (!dependencies.has(id)) dependencyFields.delete(id);
    }
  }

  function dependencyFieldsIntersect(
    dependencyFields: Map<QueryCacheEntityId, QueryCacheDependencyFields>,
    changedEntityFields: Map<QueryCacheEntityId, Set<string> | null>
  ): boolean {
    if (changedEntityFields.size === 0) return true;
    for (const [id, changedFields] of changedEntityFields) {
      const fields = dependencyFields.get(id);
      if (fields === undefined) continue;
      if (fields === null || changedFields === null) return true;
      if (fields instanceof Set) {
        if (setsIntersect(fields, changedFields)) return true;
      } else {
        let intersects = false;
        for (let i = 0; i < fields.length; i++) {
          if (changedFields.has(fields[i])) {
            intersects = true;
            break;
          }
        }
        dependencyFields.set(id, new Set(fields));
        if (intersects) return true;
      }
    }
    return false;
  }

  function addDependencyFields(
    previous: Exclude<QueryCacheDependencyFields, null>,
    fields: Exclude<QueryCacheDependencyFields, null>
  ): Exclude<QueryCacheDependencyFields, null> {
    if (previous instanceof Set) {
      if (fields instanceof Set) {
        for (const field of fields) previous.add(field);
      } else {
        for (let i = 0; i < fields.length; i++) previous.add(fields[i]);
      }
      return previous;
    }
    if (Array.isArray(fields) && sameFieldArray(previous, fields)) return previous;
    const merged = new Set(previous);
    if (fields instanceof Set) {
      for (const field of fields) merged.add(field);
    } else {
      for (let i = 0; i < fields.length; i++) merged.add(fields[i]);
    }
    return merged;
  }

  function sameFieldArray(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  function mergeEntityRecord(
    previous: QueryCacheInternalObject | undefined,
    incoming: QueryCacheInternalObject
  ): QueryCacheInternalObject {
    if (previous === undefined) return incoming;
    const merged: QueryCacheInternalObject = { ...previous };
    const keys = Object.keys(incoming);
    for (let i = 0; i < keys.length; i++) merged[keys[i]] = incoming[keys[i]];
    return merged;
  }

  function collectChangedObjectFields(
    previous: QueryCacheInternalObject | undefined,
    next: QueryCacheInternalObject
  ): Set<string> | null {
    if (previous === undefined) return null;
    const fields = new Set<string>();
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      if (!equalsJsonFast(
        previous[key] as unknown as JsonValue,
        next[key] as unknown as JsonValue
      )) {
        fields.add(key);
      }
    }
    return fields;
  }

  function recordChangedEntityFields(
    changedEntityFields: Map<QueryCacheEntityId, Set<string> | null>,
    id: QueryCacheEntityId,
    fields: Set<string> | null
  ): void {
    if (fields !== null && fields.size === 0) return;
    const previous = changedEntityFields.get(id);
    if (previous === null) return;
    if (fields === null) {
      changedEntityFields.set(id, null);
      return;
    }
    if (previous === undefined) {
      changedEntityFields.set(id, new Set(fields));
      return;
    }
    for (const field of fields) previous.add(field);
  }

  function refreshDependentQueries(
    ids: Set<QueryCacheEntityId>,
    skipHash?: string,
    changedEntityFields?: Map<QueryCacheEntityId, Set<string> | null>
  ): void {
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
      if (changedEntityFields !== undefined && !dependencyFieldsIntersect(entry.dependencyFields, changedEntityFields)) {
        continue;
      }
      if (changedEntityFields !== undefined && refreshRootArrayEntityFields(entry, ids, changedEntityFields)) {
        continue;
      }
      const previous = entry.value;
      const previousDependencies = entry.dependencies;
      const dependencies = new Set<QueryCacheEntityId>();
      collectReachableDependencies(entry.root, dependencies, new Set());
      ensureDependencyFields(entry.dependencyFields, dependencies);
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

  function refreshRootArrayEntityFields(
    entry: QueryCacheEntry,
    changedIds: Set<QueryCacheEntityId>,
    changedEntityFields: Map<QueryCacheEntityId, Set<string> | null>
  ): boolean {
    if (!Array.isArray(entry.root) || !Array.isArray(entry.value) || changedEntityFields.size !== 1) return false;
    const iterator = changedEntityFields.entries().next();
    if (iterator.done) return false;
    const id = iterator.value[0];
    const fields = iterator.value[1];
    if (!changedIds.has(id) || fields === null || fields.size === 0) return false;
    const record = entities.get(id);
    if (record === undefined) return false;
    const rowIndexes: number[] = [];
    const fieldPaths: JsonPath[] = [];
    const baseValues: JsonValue[] = [];

    for (const field of fields) {
      if (!Object.hasOwn(record, field)) return false;
      const normalized = record[field];
      if (normalized !== null && typeof normalized === 'object') return false;
      fieldPaths[fieldPaths.length] = [field];
      baseValues[baseValues.length] = normalized as JsonValue;
    }
    if (fieldPaths.length === 0) return false;

    for (let i = 0; i < entry.root.length; i++) {
      const item = entry.root[i];
      if (item === null || typeof item !== 'object' || Array.isArray(item) || !isReference(item) || item[REF_KEY] !== id) continue;
      const projectedFields = readReferenceFields(item);
      if (projectedFields === null) return false;
      for (let fieldIndex = 0; fieldIndex < fieldPaths.length; fieldIndex++) {
        if (!projectedFields.includes(fieldPaths[fieldIndex][0] as string)) return false;
      }
      rowIndexes[rowIndexes.length] = i;
    }
    if (rowIndexes.length === 0) return false;

    const nextValue = entry.value.slice() as JsonValue[];
    const values: JsonValue[] = [];
    for (let rowOffset = 0; rowOffset < rowIndexes.length; rowOffset++) {
      const index = rowIndexes[rowOffset];
      const row = nextValue[index];
      if (!isJsonObject(row)) return false;
      const nextRow: JsonObject = { ...row };
      for (let fieldIndex = 0; fieldIndex < fieldPaths.length; fieldIndex++) {
        const value = baseValues[fieldIndex];
        nextRow[fieldPaths[fieldIndex][0]] = value;
        values[values.length] = value;
      }
      nextValue[index] = nextRow;
    }

    entry.value = nextValue as JsonValue;
    entry.updatedAt = now();
    entry.stale = false;
    queueQueryPatch(entry.hash, [[OP_ARRAY_OBJECT_FIELD_ASSIGN, [], rowIndexes, fieldPaths, values] as PatchOperation]);
    return true;
  }

  function queueQueryPatch(hash: string, patch: Patch): void {
    if (patch.length === 0) return;
    if (!hasQueryObservers(hash)) return;
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
    if (listeners.size === 0) return;
    if (batchDepth !== 0 || sideEffectDepth !== 0) {
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
    if (!emitQueryEvent || listeners.size === 0) return;
    const entry = queries.get(hash);
    if (entry !== undefined) {
      queueEvent({
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
    if (emitEntityEvent && listeners.size !== 0) queueEvent({ type: 'entity', id, patch: clonePatch(patch) });
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
    if (previous === undefined) {
      addQueryDependencies(hash, next);
      return;
    }
    if (previous === next) return;
    for (const id of previous) {
      if (next.has(id)) continue;
      const bucket = entityQueries.get(id);
      if (bucket === undefined) continue;
      bucket.delete(hash);
      if (bucket.size === 0) entityQueries.delete(id);
    }
    for (const id of next) {
      if (previous.has(id)) continue;
      let bucket = entityQueries.get(id);
      if (bucket === undefined) entityQueries.set(id, (bucket = new Set()));
      bucket.add(hash);
    }
  }

  function addQueryDependencies(hash: string, dependencies: Set<QueryCacheEntityId>): void {
    for (const id of dependencies) {
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

  const api: QueryCache & QueryCacheOwnedSnapshotSource = {
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
    removeEntity,
    invalidateQueries,
    invalidateEntity,
    batch,
    optimistic,
    resolveOptimistic,
    rollbackOptimistic,
    extract,
    restore,
    clear,
    [QUERY_CACHE_EXTRACT_OWNED]: extractOwnedSnapshot
  };
  return api;
}

export { hashQueryKey, partialMatchQueryKey } from '@shapeshift-labs/frontier-query';

export function mergeOffsetPage(existing: JsonValue | undefined, incoming: JsonValue, options: OffsetPageMergeOptions = {}): JsonValue {
  if (!Array.isArray(incoming)) return cloneJson(incoming);
  const offset = Math.max(0, Math.floor(options.offset || 0));
  const out = Array.isArray(existing) ? cloneJson(existing) : [];
  for (let i = 0; i < incoming.length; i++) out[offset + i] = cloneJson(incoming[i]);
  markOffsetPageMerge(out, offset, incoming);
  return out as JsonValue;
}

function markOffsetPageMerge(out: unknown[], offset: number, incoming: readonly JsonValue[]): void {
  Object.defineProperty(out, OFFSET_PAGE_MERGE, {
    value: { offset, length: incoming.length },
    enumerable: false,
    configurable: false
  });
}

function readOffsetPageMergeInfo(value: JsonValue): OffsetPageMergeInfo | undefined {
  return Array.isArray(value)
    ? (value as unknown as { [OFFSET_PAGE_MERGE]?: OffsetPageMergeInfo })[OFFSET_PAGE_MERGE]
    : undefined;
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
  const adapter: QueryCacheMemoryStorageAdapter & QueryCacheOwnedSnapshotStorage = {
    load() {
      return snapshot === null ? null : cloneSnapshot(snapshot);
    },
    save(next: QueryCacheSnapshot) {
      snapshot = cloneSnapshot(next);
    },
    [MEMORY_STORAGE_SAVE_OWNED](next: QueryCacheSnapshot) {
      snapshot = next;
    },
    clear() {
      snapshot = null;
    },
    getSnapshot() {
      return snapshot === null ? null : cloneSnapshot(snapshot);
    }
  };
  return adapter;
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
        const saveOwned = (storage as QueryCacheOwnedSnapshotStorage)[MEMORY_STORAGE_SAVE_OWNED];
        if (saveOwned === undefined) {
          await storage.save(cache.extract());
        } else {
          const extractOwned = (cache as QueryCacheOwnedSnapshotSource)[QUERY_CACHE_EXTRACT_OWNED];
          await saveOwned.call(storage, extractOwned === undefined ? cache.extract() : extractOwned.call(cache));
        }
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
  return [[OP_SET, [], value] as PatchOperation];
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

function createReference(id: string, fields: readonly string[]): QueryCacheInternalRef {
  return { [REF_KEY]: id, [REF_FIELDS_KEY]: fields as string[] };
}

function isReference(value: QueryCacheInternalObject | QueryCacheInternalRef): value is QueryCacheInternalRef {
  return typeof value[REF_KEY] === 'string';
}

function readReferenceFields(value: QueryCacheInternalRef): readonly string[] | null {
  const fields = value[REF_FIELDS_KEY];
  return Array.isArray(fields) ? fields : null;
}

function setsIntersect(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
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
