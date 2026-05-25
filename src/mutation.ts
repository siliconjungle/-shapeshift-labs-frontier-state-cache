import { cloneJson } from '@shapeshift-labs/frontier/clone';
import { applyPatchImmutable } from '@shapeshift-labs/frontier/patch';
import type { JsonObject, JsonValue, Patch } from '@shapeshift-labs/frontier/types';
import { compileMutationPlan } from '@shapeshift-labs/frontier-mutation';
import type {
  MutationCompileOptions,
  MutationCompileResult,
  MutationPlanLike
} from '@shapeshift-labs/frontier-mutation';
import type {
  QueryCache,
  QueryCacheEntityId,
  QueryCacheEntityInput,
  QueryCacheKey,
  QueryCacheWriteOptions
} from './index.js';

export interface CacheMutationOptions {
  mutation?: MutationCompileOptions;
  missing?: 'throw' | 'empty';
  emptyValue?: JsonValue;
}

export interface CacheQueryMutationOptions extends CacheMutationOptions {
  write?: QueryCacheWriteOptions;
}

export interface CacheQueryMutationResult {
  key: QueryCacheKey;
  previous: JsonValue;
  next: JsonValue;
  patch: Patch;
  mutation: MutationCompileResult;
}

export interface CacheQueryMutationCommitResult extends CacheQueryMutationResult {
  cachePatch: Patch;
}

export interface CacheEntityMutationOptions extends CacheMutationOptions {}

export interface CacheEntityMutationCommitResult {
  entity: QueryCacheEntityInput;
  entityId: QueryCacheEntityId | null;
  previous: JsonObject;
  next: JsonObject;
  patch: Patch;
  cachePatch: Patch;
  mutation: MutationCompileResult;
}

export function compileCacheQueryMutation(
  cache: QueryCache,
  key: QueryCacheKey,
  plan: MutationPlanLike,
  options: CacheMutationOptions = {}
): CacheQueryMutationResult {
  const previous = readExistingQuery(cache, key, options);
  const mutation = compileMutationPlan(plan, previous, options.mutation);
  const next = applyPatchImmutable(previous, mutation.patch) as JsonValue;
  return {
    key: cloneJson(key),
    previous: cloneJson(previous),
    next,
    patch: mutation.patch,
    mutation
  };
}

export function commitCacheQueryMutation(
  cache: QueryCache,
  key: QueryCacheKey,
  plan: MutationPlanLike,
  options: CacheQueryMutationOptions = {}
): CacheQueryMutationCommitResult {
  const result = compileCacheQueryMutation(cache, key, plan, options);
  const cachePatch = cache.writeQuery(key, result.next, options.write);
  return { ...result, cachePatch };
}

export function commitCacheEntityMutation(
  cache: QueryCache,
  entity: QueryCacheEntityInput,
  plan: MutationPlanLike,
  options: CacheEntityMutationOptions = {}
): CacheEntityMutationCommitResult {
  const entityId = cache.identify(entity);
  let previous: JsonObject | undefined;
  let next: JsonObject | undefined;
  let mutation: MutationCompileResult | undefined;
  const cachePatch = cache.modifyEntity(entity, (current) => {
    previous = readExistingEntity(entity, current, options);
    mutation = compileMutationPlan(plan, previous, options.mutation);
    const updated = applyPatchImmutable(previous, mutation.patch);
    if (!isJsonObject(updated)) throw new TypeError('state-cache entity mutation must produce a JSON object');
    next = updated;
    return updated;
  });
  if (previous === undefined || next === undefined || mutation === undefined) {
    throw new Error('state-cache entity mutation did not run');
  }
  return {
    entity: cloneJson(entity as JsonValue) as QueryCacheEntityInput,
    entityId,
    previous: cloneJson(previous) as JsonObject,
    next,
    patch: mutation.patch,
    cachePatch,
    mutation
  };
}

function readExistingQuery(cache: QueryCache, key: QueryCacheKey, options: CacheMutationOptions): JsonValue {
  const current = cache.getQueryData(key);
  if (current !== undefined) return current;
  if (options.missing === 'empty') return cloneJson(options.emptyValue === undefined ? null : options.emptyValue);
  throw new RangeError('state-cache query mutation target is missing');
}

function readExistingEntity(
  entity: QueryCacheEntityInput,
  current: JsonObject | undefined,
  options: CacheMutationOptions
): JsonObject {
  if (current !== undefined) return current;
  if (options.missing === 'empty') {
    const value = options.emptyValue === undefined ? {} : cloneJson(options.emptyValue);
    if (isJsonObject(value)) return value;
    throw new TypeError('state-cache missing entity emptyValue must be a JSON object');
  }
  throw new RangeError('state-cache entity mutation target is missing: ' + String(entity));
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
