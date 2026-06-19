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
const QUERY_CATCH_UP_VALUE_KEY = '\u0000frontierQueryValue';

type ReplayApplyPatchImmutable = (value: JsonValue, patch: Patch) => JsonValue;

let replayApplyPatchImmutable: Promise<ReplayApplyPatchImmutable> | undefined;

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
const FIELD_ARRAY_CACHE_LIMIT = 4096;

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

type QueryCacheMaintainedQueryEntry = {
  key: QueryCacheKey;
  hash: string;
  filter?: QueryCacheMaintainedQueryFilter;
  sort?: QueryCacheMaintainedQuerySort;
  select?: QueryCacheMaintainedQuerySelect;
  limit: number;
  ids: QueryCacheEntityId[];
  values: Map<QueryCacheEntityId, JsonObject>;
  visible: JsonValue;
  active: boolean;
};

type QueryCacheDependencyNodeEntry = {
  id: QueryCacheDependencyKey;
  dependencies: Set<QueryCacheDependencyKey>;
  dependents: Set<QueryCacheDependencyKey>;
  queryHash?: string;
};

type QueryCacheCatchUpEntry = {
  key: QueryCacheKey;
  hash: string;
  clock: number;
  records: Map<string, QueryCacheCatchUpRecord>;
  recordsByClock: QueryCacheCatchUpRecord[];
};

type QueryCacheCatchUpRecord = {
  recordKey: string;
  clock: number;
  updatedAt: number;
  entityId?: QueryCacheEntityId;
  value?: JsonValue;
  removed?: boolean;
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
export type QueryCacheDependencyKey = string;
export type QueryCacheMaintainedQueryFilter = (entity: JsonObject, id: QueryCacheEntityId) => boolean;
export type QueryCacheMaintainedQuerySort = (
  left: JsonObject,
  right: JsonObject,
  leftId: QueryCacheEntityId,
  rightId: QueryCacheEntityId
) => number;
export type QueryCacheMaintainedQuerySelect = (entity: JsonObject, id: QueryCacheEntityId) => JsonValue;

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

export interface QueryCacheMaintainedQueryOptions {
  filter?: QueryCacheMaintainedQueryFilter;
  sort?: QueryCacheMaintainedQuerySort;
  limit?: number;
  select?: QueryCacheMaintainedQuerySelect;
}

export interface QueryCacheMaintainedQuery extends QueryCacheSubscription {
  refresh(): Patch;
}

export interface QueryCacheDependencyNode {
  id: QueryCacheDependencyKey;
  dependencies?: readonly QueryCacheDependencyKey[];
  queryKey?: QueryCacheKey;
}

export interface QueryCacheDependencyInvalidation {
  dependencyKey: QueryCacheDependencyKey;
  visited: number;
  invalidated: number;
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

export interface QueryCacheCatchUpOptions {
  lastSeenClock?: number;
  limit?: number;
}

export interface QueryCacheCatchUpChange {
  clock: number;
  updatedAt: number;
  entityId?: QueryCacheEntityId;
  value?: JsonValue;
  removed?: boolean;
}

export interface QueryCacheCatchUpResult {
  key: QueryCacheKey;
  hash: string;
  lastSeenClock: number;
  nextLastSeenClock: number;
  highWaterClock: number;
  complete: boolean;
  changes: QueryCacheCatchUpChange[];
}

export interface QueryCacheSnapshot {
  entities: Record<string, JsonObject>;
  queries: QueryCacheSnapshotQuery[];
  catchUpClock?: number;
  catchUp?: QueryCacheSnapshotCatchUpQuery[];
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

export interface QueryCacheSnapshotCatchUpQuery {
  key: QueryCacheKey;
  hash: string;
  clock: number;
  changes: QueryCacheCatchUpChange[];
}

export type QueryCacheMergeQueueLaneStatus = 'open' | 'draining' | 'closed';
export type QueryCacheMergeQueueTerminalDecisionStatus =
  | 'applied'
  | 'committed'
  | 'queued'
  | 'promoted'
  | 'rejected'
  | 'rerun'
  | 'blocked'
  | 'recorded';

export interface QueryCacheMergeQueueActiveLeaseInput {
  leaseId?: string;
  lane?: string;
  scopeId?: string;
  workId?: string;
  acquiredAt?: number;
  expiresAt?: number | null;
  updatedAt?: number;
  metadata?: JsonObject | null;
}

export interface QueryCacheMergeQueueActiveLease {
  leaseId: string;
  lane: string;
  scopeId?: string;
  workId?: string;
  acquiredAt: number;
  expiresAt?: number;
  updatedAt: number;
  metadata?: JsonObject;
}

export interface QueryCacheMergeQueueQueuedWorkInput {
  workId?: string;
  lane?: string;
  leaseId?: string;
  scopeId?: string;
  queuedAt?: number;
  priority?: number | null;
  metadata?: JsonObject | null;
}

export interface QueryCacheMergeQueueQueuedWork {
  workId: string;
  lane: string;
  leaseId?: string;
  scopeId?: string;
  queuedAt: number;
  priority?: number;
  metadata?: JsonObject;
}

export interface QueryCacheMergeQueueLaneLifecycleInput {
  lane?: string;
  status?: QueryCacheMergeQueueLaneStatus;
  openedAt?: number;
  updatedAt?: number;
  closedAt?: number | null;
  metadata?: JsonObject | null;
}

export interface QueryCacheMergeQueueLaneLifecycle {
  lane: string;
  status: QueryCacheMergeQueueLaneStatus;
  openedAt: number;
  updatedAt: number;
  closedAt?: number;
  metadata?: JsonObject;
}

export interface QueryCacheMergeQueueTerminalDecisionInput {
  decisionId?: string;
  workId?: string;
  lane?: string;
  status?: QueryCacheMergeQueueTerminalDecisionStatus;
  decidedAt?: number;
  reason?: string;
  metadata?: JsonObject | null;
}

export interface QueryCacheMergeQueueTerminalDecision {
  decisionId: string;
  workId: string;
  lane: string;
  status: QueryCacheMergeQueueTerminalDecisionStatus;
  decidedAt: number;
  reason?: string;
  metadata?: JsonObject;
}

export interface QueryCacheMergeQueueOpenQuestionInput {
  questionId?: string;
  questionCode?: string;
  openedAt?: number;
  updatedAt?: number;
  owner?: string;
  surface?: string;
  missingAuthority?: string;
  question?: string;
  answerCode?: string;
  metadata?: JsonObject | null;
}

export interface QueryCacheMergeQueueOpenQuestion {
  questionId: string;
  openedAt: number;
  updatedAt: number;
  questionCode?: string;
  owner?: string;
  surface?: string;
  missingAuthority?: string;
  question?: string;
  answerCode?: string;
  metadata?: JsonObject;
}

export interface QueryCacheMergeQueueConsumedAnswerCursorInput {
  questionId?: string;
  questionCode?: string;
  cursor?: string;
  sequence?: number;
  consumedAt?: number;
  updatedAt?: number;
  metadata?: JsonObject | null;
}

export interface QueryCacheMergeQueueConsumedAnswerCursor {
  questionId: string;
  cursor: string;
  sequence: number;
  consumedAt: number;
  updatedAt: number;
  questionCode?: string;
  metadata?: JsonObject;
}

export interface QueryCacheSemanticStreamCursorInput {
  streamId?: string;
  cursor?: string;
  sequence?: number;
  updatedAt?: number;
  metadata?: JsonObject | null;
}

export interface QueryCacheSemanticStreamCursor {
  streamId: string;
  cursor: string;
  sequence: number;
  updatedAt: number;
  metadata?: JsonObject;
}

export interface QueryCacheMergeQueueSnapshotInput {
  activeLeases?: readonly QueryCacheMergeQueueActiveLeaseInput[];
  queuedWork?: readonly QueryCacheMergeQueueQueuedWorkInput[];
  lanes?: readonly QueryCacheMergeQueueLaneLifecycleInput[];
  terminalDecisions?: readonly QueryCacheMergeQueueTerminalDecisionInput[];
  openQuestions?: readonly QueryCacheMergeQueueOpenQuestionInput[];
  consumedAnswerCursors?: readonly QueryCacheMergeQueueConsumedAnswerCursorInput[];
  semanticStreamCursor?: QueryCacheSemanticStreamCursorInput | null;
}

export interface QueryCacheMergeQueueSnapshot {
  activeLeases: QueryCacheMergeQueueActiveLease[];
  queuedWork: QueryCacheMergeQueueQueuedWork[];
  lanes: QueryCacheMergeQueueLaneLifecycle[];
  terminalDecisions: QueryCacheMergeQueueTerminalDecision[];
  openQuestions: QueryCacheMergeQueueOpenQuestion[];
  consumedAnswerCursors: QueryCacheMergeQueueConsumedAnswerCursor[];
  semanticStreamCursor?: QueryCacheSemanticStreamCursor;
}

export function createQueryCacheMergeQueueActiveLease(input: QueryCacheMergeQueueActiveLeaseInput): QueryCacheMergeQueueActiveLease {
  const leaseId = readMergeQueueString(input.leaseId, 'merge queue active lease leaseId');
  const lane = readMergeQueueString(input.lane, 'merge queue active lease lane');
  const acquiredAt = readMergeQueueClock(input.acquiredAt, 'merge queue active lease acquiredAt');
  const out: QueryCacheMergeQueueActiveLease = {
    leaseId,
    lane,
    acquiredAt,
    updatedAt: readMergeQueueClock(input.updatedAt, 'merge queue active lease updatedAt', acquiredAt)
  };
  if (input.scopeId !== undefined) out.scopeId = readMergeQueueString(input.scopeId, 'merge queue active lease scopeId');
  if (input.workId !== undefined) out.workId = readMergeQueueString(input.workId, 'merge queue active lease workId');
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    out.expiresAt = readMergeQueueClock(input.expiresAt, 'merge queue active lease expiresAt', acquiredAt);
  }
  if (input.metadata !== undefined && input.metadata !== null) {
    out.metadata = cloneJson(readMergeQueueJsonObject(input.metadata, 'merge queue active lease metadata'));
  }
  return out;
}

export function createQueryCacheMergeQueueQueuedWork(input: QueryCacheMergeQueueQueuedWorkInput): QueryCacheMergeQueueQueuedWork {
  const workId = readMergeQueueString(input.workId, 'merge queue queued work workId');
  const lane = readMergeQueueString(input.lane, 'merge queue queued work lane');
  const out: QueryCacheMergeQueueQueuedWork = {
    workId,
    lane,
    queuedAt: readMergeQueueClock(input.queuedAt, 'merge queue queued work queuedAt')
  };
  if (input.scopeId !== undefined) out.scopeId = readMergeQueueString(input.scopeId, 'merge queue queued work scopeId');
  if (input.leaseId !== undefined) out.leaseId = readMergeQueueString(input.leaseId, 'merge queue queued work leaseId');
  if (input.priority !== undefined && input.priority !== null) out.priority = readMergeQueueNumber(input.priority, 'merge queue queued work priority');
  if (input.metadata !== undefined && input.metadata !== null) {
    out.metadata = cloneJson(readMergeQueueJsonObject(input.metadata, 'merge queue queued work metadata'));
  }
  return out;
}

export function createQueryCacheMergeQueueLaneLifecycle(input: QueryCacheMergeQueueLaneLifecycleInput): QueryCacheMergeQueueLaneLifecycle {
  const lane = readMergeQueueString(input.lane, 'merge queue lane lifecycle lane');
  const status = readMergeQueueLaneStatus(input.status);
  const openedAt = readMergeQueueClock(input.openedAt, 'merge queue lane lifecycle openedAt');
  const out: QueryCacheMergeQueueLaneLifecycle = {
    lane,
    status,
    openedAt,
    updatedAt: readMergeQueueClock(input.updatedAt, 'merge queue lane lifecycle updatedAt', openedAt)
  };
  if (input.closedAt !== undefined && input.closedAt !== null) {
    out.closedAt = readMergeQueueClock(input.closedAt, 'merge queue lane lifecycle closedAt', openedAt);
  }
  if (input.metadata !== undefined && input.metadata !== null) {
    out.metadata = cloneJson(readMergeQueueJsonObject(input.metadata, 'merge queue lane lifecycle metadata'));
  }
  return out;
}

export function createQueryCacheMergeQueueTerminalDecision(
  input: QueryCacheMergeQueueTerminalDecisionInput
): QueryCacheMergeQueueTerminalDecision {
  const decisionId = readMergeQueueString(input.decisionId, 'merge queue terminal decision decisionId');
  const workId = readMergeQueueString(input.workId, 'merge queue terminal decision workId');
  const lane = readMergeQueueString(input.lane, 'merge queue terminal decision lane');
  const status = readMergeQueueTerminalDecisionStatus(input.status);
  const decidedAt = readMergeQueueClock(input.decidedAt, 'merge queue terminal decision decidedAt');
  const out: QueryCacheMergeQueueTerminalDecision = {
    decisionId,
    workId,
    lane,
    status,
    decidedAt
  };
  if (input.reason !== undefined) out.reason = readMergeQueueString(input.reason, 'merge queue terminal decision reason');
  if (input.metadata !== undefined && input.metadata !== null) {
    out.metadata = cloneJson(readMergeQueueJsonObject(input.metadata, 'merge queue terminal decision metadata'));
  }
  return out;
}

export function createQueryCacheMergeQueueOpenQuestion(
  input: QueryCacheMergeQueueOpenQuestionInput
): QueryCacheMergeQueueOpenQuestion {
  const questionId = readMergeQueueString(input.questionId, 'merge queue open question questionId');
  const openedAt = readMergeQueueClock(input.openedAt, 'merge queue open question openedAt');
  const out: QueryCacheMergeQueueOpenQuestion = {
    questionId,
    openedAt,
    updatedAt: readMergeQueueClock(input.updatedAt, 'merge queue open question updatedAt', openedAt)
  };
  if (input.questionCode !== undefined) out.questionCode = readMergeQueueString(input.questionCode, 'merge queue open question questionCode');
  if (input.owner !== undefined) out.owner = readMergeQueueString(input.owner, 'merge queue open question owner');
  if (input.surface !== undefined) out.surface = readMergeQueueString(input.surface, 'merge queue open question surface');
  if (input.missingAuthority !== undefined) {
    out.missingAuthority = readMergeQueueString(input.missingAuthority, 'merge queue open question missingAuthority');
  }
  if (input.question !== undefined) out.question = readMergeQueueString(input.question, 'merge queue open question question');
  if (input.answerCode !== undefined) out.answerCode = readMergeQueueString(input.answerCode, 'merge queue open question answerCode');
  if (input.metadata !== undefined && input.metadata !== null) {
    out.metadata = cloneJson(readMergeQueueJsonObject(input.metadata, 'merge queue open question metadata'));
  }
  return out;
}

export function createQueryCacheMergeQueueConsumedAnswerCursor(
  input: QueryCacheMergeQueueConsumedAnswerCursorInput
): QueryCacheMergeQueueConsumedAnswerCursor {
  const questionId = readMergeQueueString(input.questionId, 'merge queue consumed answer cursor questionId');
  const cursor = readMergeQueueString(input.cursor, 'merge queue consumed answer cursor cursor');
  const sequence = readMergeQueueClock(input.sequence, 'merge queue consumed answer cursor sequence');
  const consumedAt = readMergeQueueClock(input.consumedAt, 'merge queue consumed answer cursor consumedAt', sequence);
  const out: QueryCacheMergeQueueConsumedAnswerCursor = {
    questionId,
    cursor,
    sequence,
    consumedAt,
    updatedAt: readMergeQueueClock(input.updatedAt, 'merge queue consumed answer cursor updatedAt', consumedAt)
  };
  if (input.questionCode !== undefined) {
    out.questionCode = readMergeQueueString(input.questionCode, 'merge queue consumed answer cursor questionCode');
  }
  if (input.metadata !== undefined && input.metadata !== null) {
    out.metadata = cloneJson(readMergeQueueJsonObject(input.metadata, 'merge queue consumed answer cursor metadata'));
  }
  return out;
}

export function createQueryCacheSemanticStreamCursor(
  input: QueryCacheSemanticStreamCursorInput
): QueryCacheSemanticStreamCursor {
  const streamId = readMergeQueueString(input.streamId, 'merge queue semantic stream cursor streamId');
  const cursor = readMergeQueueString(input.cursor, 'merge queue semantic stream cursor cursor');
  const sequence = readMergeQueueClock(input.sequence, 'merge queue semantic stream cursor sequence');
  const out: QueryCacheSemanticStreamCursor = {
    streamId,
    cursor,
    sequence,
    updatedAt: readMergeQueueClock(input.updatedAt, 'merge queue semantic stream cursor updatedAt', sequence)
  };
  if (input.metadata !== undefined && input.metadata !== null) {
    out.metadata = cloneJson(readMergeQueueJsonObject(input.metadata, 'merge queue semantic stream cursor metadata'));
  }
  return out;
}

export function createQueryCacheMergeQueueSnapshot(
  input: QueryCacheMergeQueueSnapshotInput = {}
): QueryCacheMergeQueueSnapshot {
  const activeLeases = sortQueryCacheMergeQueueActiveLeases((input.activeLeases ?? []).map(createQueryCacheMergeQueueActiveLease));
  const queuedWork = sortQueryCacheMergeQueueQueuedWork((input.queuedWork ?? []).map(createQueryCacheMergeQueueQueuedWork));
  const lanes = sortQueryCacheMergeQueueLanes((input.lanes ?? []).map(createQueryCacheMergeQueueLaneLifecycle));
  const terminalDecisions = sortQueryCacheMergeQueueTerminalDecisions(
    (input.terminalDecisions ?? []).map(createQueryCacheMergeQueueTerminalDecision)
  );
  const openQuestions = sortQueryCacheMergeQueueOpenQuestions((input.openQuestions ?? []).map(createQueryCacheMergeQueueOpenQuestion));
  const consumedAnswerCursors = sortQueryCacheMergeQueueConsumedAnswerCursors(
    (input.consumedAnswerCursors ?? []).map(createQueryCacheMergeQueueConsumedAnswerCursor)
  );
  const snapshot: QueryCacheMergeQueueSnapshot = {
    activeLeases,
    queuedWork,
    lanes,
    terminalDecisions,
    openQuestions,
    consumedAnswerCursors
  };
  if (input.semanticStreamCursor !== undefined && input.semanticStreamCursor !== null) {
    snapshot.semanticStreamCursor = createQueryCacheSemanticStreamCursor(input.semanticStreamCursor);
  }
  return snapshot;
}

export function updateQueryCacheSemanticStreamCursor(
  snapshot: QueryCacheMergeQueueSnapshot,
  cursor: QueryCacheSemanticStreamCursorInput
): QueryCacheMergeQueueSnapshot {
  const next = createQueryCacheSemanticStreamCursor(cursor);
  const out = createQueryCacheMergeQueueSnapshot(snapshot);
  if (out.semanticStreamCursor === undefined || compareQueryCacheSemanticStreamCursor(next, out.semanticStreamCursor) > 0) {
    out.semanticStreamCursor = next;
  }
  return out;
}

export function updateQueryCacheConsumedAnswerCursor(
  snapshot: QueryCacheMergeQueueSnapshot,
  cursor: QueryCacheMergeQueueConsumedAnswerCursorInput
): QueryCacheMergeQueueSnapshot {
  const next = createQueryCacheMergeQueueConsumedAnswerCursor(cursor);
  const out = createQueryCacheMergeQueueSnapshot(snapshot);
  const index = out.consumedAnswerCursors.findIndex((item) => item.questionId === next.questionId && item.cursor === next.cursor);
  if (index === -1 || compareQueryCacheMergeQueueConsumedAnswerCursor(next, out.consumedAnswerCursors[index]) > 0) {
    if (index === -1) {
      out.consumedAnswerCursors[out.consumedAnswerCursors.length] = next;
    } else {
      out.consumedAnswerCursors[index] = next;
    }
    out.consumedAnswerCursors = sortQueryCacheMergeQueueConsumedAnswerCursors(out.consumedAnswerCursors);
  }
  return out;
}

export interface QueryCacheChangeLogStorageReadOptions {
  sinceSeq?: number;
  limit?: number;
}

export interface QueryCacheDurableChangeLogStorageAdapter {
  appendChange(entry: QueryCacheChangeLogEntry): void | Promise<void>;
  readChangeLog?(options?: QueryCacheChangeLogStorageReadOptions): QueryCacheChangeLogEntry[] | Promise<QueryCacheChangeLogEntry[]>;
  compact?(snapshot?: QueryCacheSnapshot): void | Promise<void>;
}

export interface QueryCacheStorageAdapter extends Partial<QueryCacheDurableChangeLogStorageAdapter> {
  load(): QueryCacheSnapshot | null | undefined | Promise<QueryCacheSnapshot | null | undefined>;
  save(snapshot: QueryCacheSnapshot): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export interface QueryCachePersistenceChangeLogOptions {
  includePatches?: boolean;
}

export interface QueryCacheSchedulerTask {
  id?: string;
  type?: string;
  lane?: string;
  area?: string;
  priority?: unknown;
  units?: number;
  key?: string;
  metadata?: Record<string, unknown>;
  run(context?: unknown): unknown;
}

export interface QueryCacheSchedulerLike {
  schedule(task: QueryCacheSchedulerTask): unknown;
  run?(options?: unknown): unknown;
  requestRun?(options?: unknown): unknown;
}

export type QueryCachePersistenceMigrationSource =
  | 'frontier.state-cache.snapshot'
  | 'frontier.state-cache.change-log';

export interface QueryCachePersistenceMigrationContext {
  readonly source: QueryCachePersistenceMigrationSource;
  readonly storage: QueryCacheStorageAdapter;
}

export interface QueryCachePersistenceMigrationResult<T> {
  readonly data: T | null | undefined;
  readonly version?: string;
  readonly changed?: boolean;
  readonly report?: unknown;
}

export type QueryCachePersistenceMigrator<T> = (
  data: T,
  context: QueryCachePersistenceMigrationContext
) => T | null | undefined | QueryCachePersistenceMigrationResult<T> | Promise<T | null | undefined | QueryCachePersistenceMigrationResult<T>>;

export interface QueryCachePersistenceOptions {
  autoHydrate?: boolean;
  debounceMs?: number;
  changeLog?: boolean | QueryCachePersistenceChangeLogOptions;
  replayChangeLog?: boolean;
  compactOnFlush?: boolean;
  scheduler?: QueryCacheSchedulerLike;
  schedulerLane?: string;
  schedulerPriority?: unknown;
  schedulerAutoRun?: boolean;
  schedulerRunOptions?: unknown;
  migrateSnapshot?: QueryCachePersistenceMigrator<QueryCacheSnapshot>;
  migrateChangeLogEntry?: QueryCachePersistenceMigrator<QueryCacheChangeLogEntry>;
  onMigrationReport?: (report: unknown, context: QueryCachePersistenceMigrationContext) => void;
  onError?: (error: unknown) => void;
}

export interface QueryCachePersistenceStats {
  loads: number;
  saves: number;
  changes: number;
  changeLogWrites: number;
  replayedChanges: number;
  pending: boolean;
  hydrating: boolean;
  hydrated: boolean;
  disposed: boolean;
}

export interface QueryCachePersistence {
  readonly ready: Promise<boolean>;
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
  getQueryCatchUpClock(key: QueryCacheKey): number;
  readQueryCatchUp(key: QueryCacheKey, options?: QueryCacheCatchUpOptions): QueryCacheCatchUpResult;
  maintainQuery(key: QueryCacheKey, options?: QueryCacheMaintainedQueryOptions): QueryCacheMaintainedQuery;
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
  setDependencyNode(node: QueryCacheDependencyNode): void;
  deleteDependencyNode(id: QueryCacheDependencyKey): boolean;
  invalidateDependency(id: QueryCacheDependencyKey): QueryCacheDependencyInvalidation;
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
  const queryCatchUps = new Map<string, QueryCacheCatchUpEntry>();
  const queryWatchers = new Map<string, Set<QueryCacheWatchCallback>>();
  const entityWatchers = new Map<string, Set<QueryCacheWatchCallback>>();
  const listeners = new Set<QueryCacheEventListener>();
  const optimisticLayers = new Map<string, QueryCacheSnapshot>();
  const pendingQueries = new Map<string, QueryCachePendingPatch>();
  const pendingEntities = new Map<string, QueryCachePendingPatch>();
  const pendingEvents: QueryCacheEvent[] = [];
  const maintainedQueries = new Map<string, QueryCacheMaintainedQueryEntry>();
  const dependencyNodes = new Map<QueryCacheDependencyKey, QueryCacheDependencyNodeEntry>();
  const trackIdentifyPath = typeof options.identify === 'function';
  let batchDepth = 0;
  let sideEffectDepth = 0;
  let maintainedRefreshDepth = 0;
  let catchUpClock = 0;

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
    recordQueryCatchUp(nextEntry, previous ? previous.dependencies : undefined, changedEntities, patch);
    if (patch.length !== 0) {
      queueQueryPatch(hash, patch);
    }
    if (maintainedQueries.size !== 0) refreshMaintainedQueries(changedEntities, hash);
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
    recordQueryCatchUp(nextEntry, previous.dependencies, changedEntities, patch);
    if (patch.length !== 0) queueQueryPatch(hash, patch);
    if (maintainedQueries.size !== 0) refreshMaintainedQueries(changedEntities, hash);
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

  function getQueryCatchUpClock(key: QueryCacheKey): number {
    const catchUp = queryCatchUps.get(hashQueryKey(key));
    return catchUp === undefined ? 0 : catchUp.clock;
  }

  function readQueryCatchUp(
    key: QueryCacheKey,
    readOptions: QueryCacheCatchUpOptions = {}
  ): QueryCacheCatchUpResult {
    const hash = hashQueryKey(key);
    const catchUp = queryCatchUps.get(hash);
    const entry = queries.get(hash);
    const lastSeenClock = normalizeCatchUpClock(readOptions.lastSeenClock, 'lastSeenClock');
    const limit = normalizeCatchUpLimit(readOptions.limit);
    const highWaterClock = catchUp === undefined ? 0 : catchUp.clock;
    const changes: QueryCacheCatchUpChange[] = [];
    let complete = true;

    if (catchUp !== undefined) {
      const records = catchUp.recordsByClock;
      for (
        let i = findCatchUpClockIndex(records, lastSeenClock);
        i < records.length;
        i++
      ) {
        const record = records[i];
        if (catchUp.records.get(record.recordKey) !== record) continue;
        if (limit !== undefined && changes.length >= limit) {
          complete = false;
          break;
        }
        changes[changes.length] = cloneCatchUpRecord(record);
      }
    }

    const completedClock = highWaterClock > lastSeenClock ? highWaterClock : lastSeenClock;
    const nextLastSeenClock = changes.length === 0
      ? complete ? completedClock : lastSeenClock
      : complete ? completedClock : changes[changes.length - 1].clock;

    return {
      key: cloneJson(catchUp === undefined ? entry === undefined ? key : entry.key : catchUp.key),
      hash,
      lastSeenClock,
      nextLastSeenClock,
      highWaterClock,
      complete,
      changes
    };
  }

  function maintainQuery(
    key: QueryCacheKey,
    maintainOptions: QueryCacheMaintainedQueryOptions = {}
  ): QueryCacheMaintainedQuery {
    const filter = maintainOptions.filter;
    const sort = maintainOptions.sort;
    const select = maintainOptions.select;
    if (filter !== undefined && typeof filter !== 'function') throw new TypeError('maintainQuery filter must be a function');
    if (sort !== undefined && typeof sort !== 'function') throw new TypeError('maintainQuery sort must be a function');
    if (select !== undefined && typeof select !== 'function') throw new TypeError('maintainQuery select must be a function');
    const limit = maintainOptions.limit === undefined
      ? Number.POSITIVE_INFINITY
      : Math.floor(maintainOptions.limit);
    if (limit < 0 || Number.isNaN(limit)) throw new RangeError('maintainQuery limit must be a non-negative number');
    const hash = hashQueryKey(key);
    const previous = maintainedQueries.get(hash);
    if (previous !== undefined) previous.active = false;
    const entry: QueryCacheMaintainedQueryEntry = {
      key: cloneJson(key),
      hash,
      filter,
      sort,
      select,
      limit,
      ids: [],
      values: new Map(),
      visible: [],
      active: true
    };
    maintainedQueries.set(hash, entry);
    refreshMaintainedQuery(entry);
    return {
      get active() {
        return entry.active && maintainedQueries.get(hash) === entry;
      },
      refresh() {
        if (!entry.active || maintainedQueries.get(hash) !== entry) return [];
        return refreshMaintainedQuery(entry);
      },
      unsubscribe() {
        if (maintainedQueries.get(hash) === entry) maintainedQueries.delete(hash);
        entry.active = false;
      }
    };
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
    if (maintainedQueries.size !== 0) refreshMaintainedQueries(changedEntities);
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
    entities.delete(id);
    const changedEntities = new Set<QueryCacheEntityId>([id]);
    const changedEntityFields = new Map<QueryCacheEntityId, Set<string> | null>([[id, null]]);
    const entityPatch = rootSetPatch(null);
    if (entityPatch.length !== 0) queueEntityPatch(id, entityPatch);
    if (maintainedQueries.size !== 0) refreshMaintainedQueries(changedEntities);
    refreshDependentQueries(changedEntities, undefined, changedEntityFields);
    return clonePatch(entityPatch);
  }

  function setDependencyNode(node: QueryCacheDependencyNode): void {
    if (node === null || typeof node !== 'object') throw new TypeError('dependency node must be an object');
    const id = validateDependencyKey(node.id, 'dependency node id');
    const dependencies = normalizeDependencyKeys(node.dependencies, id);
    if (wouldCreateDependencyCycle(id, dependencies)) {
      throw new RangeError('dependency node would create a cycle');
    }
    const entry = ensureDependencyNode(id);
    const previousDependencies = entry.dependencies;
    for (const dependency of previousDependencies) {
      if (dependencies.has(dependency)) continue;
      const dependencyEntry = dependencyNodes.get(dependency);
      if (dependencyEntry !== undefined) dependencyEntry.dependents.delete(id);
    }
    for (const dependency of dependencies) {
      const dependencyEntry = ensureDependencyNode(dependency);
      dependencyEntry.dependents.add(id);
    }
    entry.dependencies = dependencies;
    if (Object.hasOwn(node, 'queryKey')) {
      if (node.queryKey === undefined) throw new TypeError('dependency node queryKey must be a JSON query key');
      entry.queryHash = hashQueryKey(node.queryKey);
    } else {
      delete entry.queryHash;
    }
  }

  function deleteDependencyNode(id: QueryCacheDependencyKey): boolean {
    const dependencyKey = validateDependencyKey(id, 'dependency node id');
    const entry = dependencyNodes.get(dependencyKey);
    if (entry === undefined) return false;
    for (const dependency of entry.dependencies) {
      const dependencyEntry = dependencyNodes.get(dependency);
      if (dependencyEntry !== undefined) dependencyEntry.dependents.delete(dependencyKey);
    }
    for (const dependent of entry.dependents) {
      const dependentEntry = dependencyNodes.get(dependent);
      if (dependentEntry !== undefined) dependentEntry.dependencies.delete(dependencyKey);
    }
    dependencyNodes.delete(dependencyKey);
    return true;
  }

  function invalidateDependency(id: QueryCacheDependencyKey): QueryCacheDependencyInvalidation {
    if (listeners.size === 0) return invalidateDependencyNow(id);
    enterDeferredSideEffects();
    try {
      return invalidateDependencyNow(id);
    } finally {
      exitDeferredSideEffects();
    }
  }

  function invalidateDependencyNow(id: QueryCacheDependencyKey): QueryCacheDependencyInvalidation {
    const dependencyKey = validateDependencyKey(id, 'dependency key');
    const root = dependencyNodes.get(dependencyKey);
    if (root === undefined) {
      return { dependencyKey, visited: 0, invalidated: 0 };
    }
    const seen = new Set<QueryCacheDependencyKey>([dependencyKey]);
    const queue: QueryCacheDependencyKey[] = [dependencyKey];
    const affectedHashes = new Set<string>();
    let offset = 0;
    let invalidated = 0;
    while (offset < queue.length) {
      const current = queue[offset++];
      const entry = dependencyNodes.get(current);
      if (entry === undefined) continue;
      if (entry.queryHash !== undefined && !affectedHashes.has(entry.queryHash)) {
        affectedHashes.add(entry.queryHash);
        const query = queries.get(entry.queryHash);
        if (query !== undefined) {
          if (!query.stale) {
            query.stale = true;
            invalidated++;
          }
          queueEvent({ type: 'invalidate', key: cloneJson(query.key), hash: query.hash });
        }
      }
      for (const dependent of entry.dependents) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        queue[queue.length] = dependent;
      }
    }
    return { dependencyKey, visited: seen.size, invalidated };
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
    const snapshot: QueryCacheSnapshot = { entities: entityOut, queries: queryOut };
    if (queryCatchUps.size !== 0) {
      snapshot.catchUpClock = catchUpClock;
      snapshot.catchUp = extractCatchUpSnapshot();
    }
    return snapshot;
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
    const snapshot: QueryCacheSnapshot = { entities: entityOut, queries: queryOut };
    if (queryCatchUps.size !== 0) {
      snapshot.catchUpClock = catchUpClock;
      snapshot.catchUp = extractCatchUpSnapshot();
    }
    return snapshot;
  }

  function restore(snapshot: QueryCacheSnapshot): void {
    batch(() => {
      const previousQueryValues = new Map<string, JsonValue>();
      for (const [hash, entry] of queries) previousQueryValues.set(hash, cloneJson(entry.value));
      entities.clear();
      queries.clear();
      entityQueries.clear();
      queryCatchUps.clear();
      catchUpClock = 0;
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
      if (Array.isArray(snapshot && snapshot.catchUp)) {
        restoreCatchUpSnapshot(snapshot);
      } else {
        seedCatchUpFromQueries();
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
      if (maintainedQueries.size !== 0) {
        for (const entry of maintainedQueries.values()) {
          if (entry.active) refreshMaintainedQuery(entry);
        }
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
      queryCatchUps.clear();
      catchUpClock = 0;
      for (let i = 0; i < previousQueries.length; i++) {
        queueQueryPatch(previousQueries[i].hash, rootSetPatch(null));
      }
      if (maintainedQueries.size !== 0) {
        for (const entry of maintainedQueries.values()) {
          if (entry.active) refreshMaintainedQuery(entry);
        }
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
      const fields = internFieldArray(keys);
      dependencies.add(id);
      recordDependencyFields(dependencyFields, id, fields);
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
      return createReference(id, fields);
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

  const fieldArrayCache = new Map<string, string[]>();
  let lastFieldArrayValue: string[] | undefined;
  let secondLastFieldArrayValue: string[] | undefined;

  function internFieldArray(fields: readonly string[]): string[] {
    if (lastFieldArrayValue !== undefined && sameFieldArray(lastFieldArrayValue, fields)) {
      return lastFieldArrayValue;
    }
    if (secondLastFieldArrayValue !== undefined && sameFieldArray(secondLastFieldArrayValue, fields)) {
      const cached = secondLastFieldArrayValue;
      secondLastFieldArrayValue = lastFieldArrayValue;
      lastFieldArrayValue = cached;
      return cached;
    }
    const cacheKey = fieldArrayKey(fields);
    const cached = fieldArrayCache.get(cacheKey);
    if (cached !== undefined) {
      rememberFieldArray(cached);
      return cached;
    }
    if (fieldArrayCache.size >= FIELD_ARRAY_CACHE_LIMIT) fieldArrayCache.clear();
    const interned = fields.slice();
    fieldArrayCache.set(cacheKey, interned);
    rememberFieldArray(interned);
    return interned;
  }

  function rememberFieldArray(fields: string[]): void {
    if (lastFieldArrayValue === fields) return;
    secondLastFieldArrayValue = lastFieldArrayValue;
    lastFieldArrayValue = fields;
  }

  function fieldArrayKey(fields: readonly string[]): string {
    let out = String(fields.length);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      out += '|' + field.length + ':' + field;
    }
    return out;
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
    const previousKeys = Object.keys(previous);
    for (let i = 0; i < previousKeys.length; i++) {
      const key = previousKeys[i];
      if (!equalsJsonFast(
        previous[key] as unknown as JsonValue,
        next[key] as unknown as JsonValue
      )) {
        fields.add(key);
      }
    }
    const nextKeys = Object.keys(next);
    for (let i = 0; i < nextKeys.length; i++) {
      const key = nextKeys[i];
      if (!Object.hasOwn(previous, key)) fields.add(key);
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

  function refreshMaintainedQueries(
    ids: Set<QueryCacheEntityId>,
    skipHash?: string
  ): void {
    if (maintainedQueries.size === 0 || maintainedRefreshDepth !== 0 || ids.size === 0) return;
    maintainedRefreshDepth++;
    try {
      for (const entry of maintainedQueries.values()) {
        if (!entry.active || entry.hash === skipHash) continue;
        let changed = false;
        for (const id of ids) {
          if (refreshMaintainedQueryEntity(entry, id)) changed = true;
        }
        if (changed) writeMaintainedQuery(entry);
      }
    } finally {
      maintainedRefreshDepth--;
    }
  }

  function refreshMaintainedQuery(entry: QueryCacheMaintainedQueryEntry): Patch {
    if (maintainedRefreshDepth !== 0) return [];
    maintainedRefreshDepth++;
    try {
      entry.ids = [];
      entry.values.clear();
      for (const [id, record] of entities) {
        const value = denormalizeValue(record, new Set()) as JsonObject;
        if (!maintainedQueryMatches(entry, value, id)) continue;
        entry.values.set(id, value);
        insertMaintainedQueryId(entry, id);
      }
      return writeMaintainedQuery(entry);
    } finally {
      maintainedRefreshDepth--;
    }
  }

  function refreshMaintainedQueryEntity(entry: QueryCacheMaintainedQueryEntry, id: QueryCacheEntityId): boolean {
    const previous = entry.values.get(id);
    const record = entities.get(id);
    const next = record === undefined ? undefined : denormalizeValue(record, new Set()) as JsonObject;
    if (next === undefined || !maintainedQueryMatches(entry, next, id)) {
      if (previous === undefined) return false;
      entry.values.delete(id);
      removeMaintainedQueryId(entry, id);
      return true;
    }
    if (previous !== undefined && equalsJsonFast(previous as JsonValue, next as JsonValue) && entry.sort === undefined) {
      return false;
    }
    if (previous !== undefined) removeMaintainedQueryId(entry, id);
    entry.values.set(id, next);
    insertMaintainedQueryId(entry, id);
    return true;
  }

  function maintainedQueryMatches(
    entry: QueryCacheMaintainedQueryEntry,
    value: JsonObject,
    id: QueryCacheEntityId
  ): boolean {
    return entry.filter === undefined || entry.filter(value, id);
  }

  function writeMaintainedQuery(entry: QueryCacheMaintainedQueryEntry): Patch {
    const value = buildMaintainedQueryValue(entry);
    if (equalsJsonFast(entry.visible, value)) return [];
    entry.visible = cloneJson(value);
    return writeQuery(entry.key, value);
  }

  function buildMaintainedQueryValue(entry: QueryCacheMaintainedQueryEntry): JsonValue {
    const length = Math.min(entry.ids.length, entry.limit);
    const out = new Array(length);
    for (let i = 0; i < length; i++) {
      const id = entry.ids[i];
      const value = entry.values.get(id) as JsonObject;
      out[i] = cloneJson(entry.select === undefined ? value : entry.select(value, id));
    }
    return out as JsonValue;
  }

  function insertMaintainedQueryId(entry: QueryCacheMaintainedQueryEntry, id: QueryCacheEntityId): void {
    if (entry.sort === undefined) {
      entry.ids[entry.ids.length] = id;
      return;
    }
    const value = entry.values.get(id) as JsonObject;
    let low = 0;
    let high = entry.ids.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const midId = entry.ids[mid];
      const midValue = entry.values.get(midId) as JsonObject;
      if (compareMaintainedQueryValues(entry, value, midValue, id, midId) < 0) high = mid;
      else low = mid + 1;
    }
    entry.ids.splice(low, 0, id);
  }

  function removeMaintainedQueryId(entry: QueryCacheMaintainedQueryEntry, id: QueryCacheEntityId): void {
    const index = entry.ids.indexOf(id);
    if (index !== -1) entry.ids.splice(index, 1);
  }

  function compareMaintainedQueryValues(
    entry: QueryCacheMaintainedQueryEntry,
    left: JsonObject,
    right: JsonObject,
    leftId: QueryCacheEntityId,
    rightId: QueryCacheEntityId
  ): number {
    const compared = entry.sort === undefined ? 0 : entry.sort(left, right, leftId, rightId);
    if (Number.isFinite(compared) && compared !== 0) return compared;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
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
      if (maintainedQueries.has(hash)) continue;
      const entry = queries.get(hash);
      if (entry === undefined) continue;
      if (changedEntityFields !== undefined && !dependencyFieldsIntersect(entry.dependencyFields, changedEntityFields)) {
        continue;
      }
      if (changedEntityFields !== undefined && refreshRootArrayEntityRemoval(entry, ids, changedEntityFields)) {
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
      recordQueryCatchUp(entry, previousDependencies, ids);
      if (!hasQueryObservers(entry.hash)) continue;
      const patch = diff(previous, next);
      if (patch.length !== 0) queueQueryPatch(entry.hash, patch);
    }
  }

  function refreshRootArrayEntityRemoval(
    entry: QueryCacheEntry,
    changedIds: Set<QueryCacheEntityId>,
    changedEntityFields: Map<QueryCacheEntityId, Set<string> | null>
  ): boolean {
    if (!Array.isArray(entry.root) || !Array.isArray(entry.value) || changedEntityFields.size !== 1) return false;
    const iterator = changedEntityFields.entries().next();
    if (iterator.done) return false;
    const id = iterator.value[0];
    if (!changedIds.has(id) || iterator.value[1] !== null) return false;
    if (entities.has(id)) return false;
    const rowIndexes: number[] = [];
    for (let i = 0; i < entry.root.length; i++) {
      const item = entry.root[i];
      if (item !== null && typeof item === 'object' && !Array.isArray(item) && isReference(item) && item[REF_KEY] === id) {
        rowIndexes[rowIndexes.length] = i;
      }
    }
    if (rowIndexes.length === 0) return false;
    const nextValue = entry.value.slice() as JsonValue[];
    const values = new Array<JsonValue>(rowIndexes.length);
    for (let i = 0; i < rowIndexes.length; i++) {
      nextValue[rowIndexes[i]] = null;
      values[i] = null;
    }
    entry.value = nextValue as JsonValue;
    entry.updatedAt = now();
    entry.stale = false;
    recordQueryCatchUp(entry, entry.dependencies, changedIds);
    queueQueryPatch(entry.hash, [[OP_ARRAY_ASSIGN, [], rowIndexes, values] as PatchOperation]);
    return true;
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
    recordQueryCatchUp(entry, entry.dependencies, changedIds);
    queueQueryPatch(entry.hash, [[OP_ARRAY_OBJECT_FIELD_ASSIGN, [], rowIndexes, fieldPaths, values] as PatchOperation]);
    return true;
  }

  function recordQueryCatchUp(
    entry: QueryCacheEntry,
    previousDependencies: Set<QueryCacheEntityId> | undefined,
    changedEntities?: Set<QueryCacheEntityId>,
    patch?: Patch
  ): void {
    const changedIds = new Set<QueryCacheEntityId>();
    const removedIds: QueryCacheEntityId[] = [];
    const changedQueryValue = patch !== undefined && patch.length !== 0;
    const includeChangedEntities = patch === undefined || changedQueryValue;

    if (previousDependencies === undefined) {
      for (const id of entry.dependencies) changedIds.add(id);
    } else {
      for (const id of entry.dependencies) {
        if (!previousDependencies.has(id)) changedIds.add(id);
      }
      for (const id of previousDependencies) {
        if (!entry.dependencies.has(id)) removedIds[removedIds.length] = id;
      }
    }

    if (includeChangedEntities && changedEntities !== undefined) {
      for (const id of changedEntities) {
        if (entry.dependencies.has(id)) changedIds.add(id);
      }
    }

    if (changedIds.size === 0 && removedIds.length === 0) {
      if (changedQueryValue) recordQueryCatchUpValue(entry, undefined, entry.value, false);
      return;
    }

    for (const id of changedIds) {
      const value = readQueryCatchUpEntityValue(entry, id);
      if (value !== undefined) recordQueryCatchUpValue(entry, id, value, false);
    }
    for (let i = 0; i < removedIds.length; i++) {
      recordQueryCatchUpValue(entry, removedIds[i], undefined, true);
    }
  }

  function readQueryCatchUpEntityValue(entry: QueryCacheEntry, id: QueryCacheEntityId): JsonValue | undefined {
    const projected = readQueryCatchUpProjectedValue(entry.root, id);
    if (projected !== undefined) return projected;
    const record = entities.get(id);
    return record === undefined ? undefined : denormalizeValue(record, new Set()) as JsonValue;
  }

  function readQueryCatchUpProjectedValue(value: QueryCacheInternalValue, id: QueryCacheEntityId): JsonValue | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = readQueryCatchUpProjectedValue(value[i], id);
        if (item !== undefined) return item;
      }
      return undefined;
    }
    if (isReference(value)) {
      return value[REF_KEY] === id ? denormalizeValue(value, new Set()) : undefined;
    }
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const item = readQueryCatchUpProjectedValue(value[keys[i]], id);
      if (item !== undefined) return item;
    }
    return undefined;
  }

  function recordQueryCatchUpValue(
    entry: QueryCacheEntry,
    entityId: QueryCacheEntityId | undefined,
    value: JsonValue | undefined,
    removed: boolean
  ): void {
    const catchUp = ensureQueryCatchUp(entry);
    const clock = nextCatchUpClock();
    const recordKey = entityId === undefined ? QUERY_CATCH_UP_VALUE_KEY : entityId;
    const record: QueryCacheCatchUpRecord = {
      recordKey,
      clock,
      updatedAt: entry.updatedAt
    };
    if (entityId !== undefined) record.entityId = entityId;
    if (value !== undefined) record.value = cloneJson(value);
    if (removed) record.removed = true;
    catchUp.records.set(recordKey, record);
    catchUp.recordsByClock[catchUp.recordsByClock.length] = record;
    catchUp.clock = clock;
    compactCatchUpEntryIfNeeded(catchUp);
  }

  function ensureQueryCatchUp(entry: QueryCacheEntry): QueryCacheCatchUpEntry {
    let catchUp = queryCatchUps.get(entry.hash);
    if (catchUp === undefined) {
      catchUp = {
        key: cloneJson(entry.key),
        hash: entry.hash,
        clock: 0,
        records: new Map(),
        recordsByClock: []
      };
      queryCatchUps.set(entry.hash, catchUp);
    } else {
      catchUp.key = cloneJson(entry.key);
    }
    return catchUp;
  }

  function nextCatchUpClock(): number {
    catchUpClock++;
    return catchUpClock;
  }

  function extractCatchUpSnapshot(): QueryCacheSnapshotCatchUpQuery[] {
    const out: QueryCacheSnapshotCatchUpQuery[] = [];
    for (const entry of queryCatchUps.values()) {
      compactCatchUpEntry(entry);
      const changes = entry.recordsByClock.map((record) => cloneCatchUpRecord(record));
      out[out.length] = {
        key: cloneJson(entry.key),
        hash: entry.hash,
        clock: entry.clock,
        changes
      };
    }
    return out;
  }

  function restoreCatchUpSnapshot(snapshot: QueryCacheSnapshot): void {
    const snapshotClock = readSnapshotClock(snapshot.catchUpClock);
    const items = Array.isArray(snapshot.catchUp) ? snapshot.catchUp : [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === null || typeof item !== 'object') continue;
      const hash = typeof item.hash === 'string' ? item.hash : hashQueryKey(item.key);
      const entry: QueryCacheCatchUpEntry = {
        key: cloneJson(item.key),
        hash,
        clock: readSnapshotClock(item.clock),
        records: new Map(),
        recordsByClock: []
      };
      const changes = Array.isArray(item.changes)
        ? item.changes.slice().sort((left, right) => readSnapshotClock(left && left.clock) - readSnapshotClock(right && right.clock))
        : [];
      for (let changeIndex = 0; changeIndex < changes.length; changeIndex++) {
        const change = changes[changeIndex];
        if (change === null || typeof change !== 'object') continue;
        const clock = readSnapshotClock(change.clock);
        if (clock === 0) continue;
        const entityId = typeof change.entityId === 'string' ? change.entityId : undefined;
        const recordKey = entityId === undefined ? QUERY_CATCH_UP_VALUE_KEY : entityId;
        const record: QueryCacheCatchUpRecord = {
          recordKey,
          clock,
          updatedAt: readSnapshotClock(change.updatedAt)
        };
        if (entityId !== undefined) record.entityId = entityId;
        if (change.value !== undefined) record.value = cloneJson(change.value);
        if (change.removed === true) record.removed = true;
        entry.records.set(recordKey, record);
        entry.recordsByClock[entry.recordsByClock.length] = record;
        if (clock > entry.clock) entry.clock = clock;
      }
      compactCatchUpEntry(entry);
      queryCatchUps.set(hash, entry);
      if (entry.clock > catchUpClock) catchUpClock = entry.clock;
    }
    if (snapshotClock > catchUpClock) catchUpClock = snapshotClock;
  }

  function seedCatchUpFromQueries(): void {
    for (const entry of queries.values()) {
      recordQueryCatchUp(entry, undefined, undefined, rootSetPatch(entry.value));
    }
  }

  function cloneCatchUpRecord(record: QueryCacheCatchUpRecord): QueryCacheCatchUpChange {
    const out: QueryCacheCatchUpChange = {
      clock: record.clock,
      updatedAt: record.updatedAt
    };
    if (record.entityId !== undefined) out.entityId = record.entityId;
    if (record.value !== undefined) out.value = cloneJson(record.value);
    if (record.removed === true) out.removed = true;
    return out;
  }

  function findCatchUpClockIndex(records: QueryCacheCatchUpRecord[], lastSeenClock: number): number {
    let low = 0;
    let high = records.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (records[mid].clock <= lastSeenClock) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function compactCatchUpEntryIfNeeded(entry: QueryCacheCatchUpEntry): void {
    const staleRecords = entry.recordsByClock.length - entry.records.size;
    if (staleRecords <= 64 || staleRecords <= entry.records.size) return;
    compactCatchUpEntry(entry);
  }

  function compactCatchUpEntry(entry: QueryCacheCatchUpEntry): void {
    if (entry.recordsByClock.length === entry.records.size) return;
    let write = 0;
    const records = entry.recordsByClock;
    for (let readIndex = 0; readIndex < records.length; readIndex++) {
      const record = records[readIndex];
      if (entry.records.get(record.recordKey) !== record) continue;
      records[write++] = record;
    }
    records.length = write;
  }

  function normalizeCatchUpClock(value: number | undefined, name: string): number {
    if (value === undefined) return 0;
    const clock = Math.floor(value);
    if (!Number.isFinite(clock) || clock < 0) throw new RangeError('query catch-up ' + name + ' must be a non-negative number');
    return clock;
  }

  function normalizeCatchUpLimit(value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    const limit = Math.floor(value);
    if (!Number.isFinite(limit) || limit < 0) throw new RangeError('query catch-up limit must be a non-negative number');
    return limit;
  }

  function readSnapshotClock(value: unknown): number {
    const clock = Math.floor(Number(value));
    return Number.isFinite(clock) && clock > 0 ? clock : 0;
  }

  function queueQueryPatch(hash: string, patch: Patch): void {
    if (patch.length === 0) return;
    if (!hasQueryObservers(hash)) return;
    const entry = queries.get(hash);
    if (batchDepth > 0) {
      const pending = pendingQueries.get(hash);
      const queuedPatch = clonePatch(patch);
      if (pending === undefined) pendingQueries.set(hash, { patch: queuedPatch });
      else pending.patch.push(...queuedPatch);
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
      const queuedPatch = clonePatch(patch);
      if (pending === undefined) pendingEntities.set(id, { patch: queuedPatch });
      else pending.patch.push(...queuedPatch);
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

  function ensureDependencyNode(id: QueryCacheDependencyKey): QueryCacheDependencyNodeEntry {
    let entry = dependencyNodes.get(id);
    if (entry === undefined) {
      entry = {
        id,
        dependencies: new Set(),
        dependents: new Set()
      };
      dependencyNodes.set(id, entry);
    }
    return entry;
  }

  function normalizeDependencyKeys(
    dependencies: readonly QueryCacheDependencyKey[] | undefined,
    nodeId: QueryCacheDependencyKey
  ): Set<QueryCacheDependencyKey> {
    const out = new Set<QueryCacheDependencyKey>();
    if (dependencies === undefined) return out;
    if (!Array.isArray(dependencies)) throw new TypeError('dependency node dependencies must be an array');
    for (let i = 0; i < dependencies.length; i++) {
      const dependency = validateDependencyKey(dependencies[i], 'dependency key');
      if (dependency === nodeId) throw new RangeError('dependency node cannot depend on itself');
      out.add(dependency);
    }
    return out;
  }

  function validateDependencyKey(value: unknown, name: string): QueryCacheDependencyKey {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(name + ' must be a non-empty string');
    }
    return value;
  }

  function wouldCreateDependencyCycle(
    id: QueryCacheDependencyKey,
    dependencies: Set<QueryCacheDependencyKey>
  ): boolean {
    for (const dependency of dependencies) {
      if (dependencyReaches(dependency, id, new Set())) return true;
    }
    return false;
  }

  function dependencyReaches(
    start: QueryCacheDependencyKey,
    target: QueryCacheDependencyKey,
    seen: Set<QueryCacheDependencyKey>
  ): boolean {
    if (start === target) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    const entry = dependencyNodes.get(start);
    if (entry === undefined) return false;
    for (const dependency of entry.dependencies) {
      if (dependencyReaches(dependency, target, seen)) return true;
    }
    return false;
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
    getQueryCatchUpClock,
    readQueryCatchUp,
    maintainQuery,
    watchQuery,
    watchEntity,
    subscribe,
    identify,
    getEntity,
    modifyEntity,
    removeEntity,
    setDependencyNode,
    deleteDependencyNode,
    invalidateDependency,
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

export function getQueryCacheOwnedSnapshot(cache: QueryCache): QueryCacheSnapshot | undefined {
  if (cache === null || typeof cache !== 'object') {
    throw new TypeError('getQueryCacheOwnedSnapshot cache must be an object');
  }
  const owned = (cache as QueryCacheOwnedSnapshotSource)[QUERY_CACHE_EXTRACT_OWNED];
  return owned === undefined ? undefined : owned.call(cache);
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
  const appendChange = typeof storage.appendChange === 'function' && options.changeLog !== false
    ? storage.appendChange.bind(storage)
    : undefined;
  const changeLogOptions = typeof options.changeLog === 'object' && options.changeLog !== null ? options.changeLog : {};
  const includeChangeLogPatches = changeLogOptions.includePatches !== false;
  const scheduler = options.scheduler;
  const schedulerLane = options.schedulerLane ?? 'cache';
  const schedulerPriority = options.schedulerPriority ?? 'low';
  const schedulerAutoRun = options.schedulerAutoRun ?? false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let muted = false;
  let disposed = false;
  let saving = false;
  let saveRequested = false;
  let hydrating = false;
  let hydrated = false;
  let loads = 0;
  let saves = 0;
  let changes = 0;
  let changeLogWrites = 0;
  let replayedChanges = 0;
  let changeLogPending = 0;
  let changeSeq = 0;
  let saveTaskSeq = 0;
  let changeLogFailure: unknown;
  let savePromise: Promise<void> = Promise.resolve();
  let hydratePromise: Promise<boolean> | undefined;
  let changeSeqPromise: Promise<void> | undefined;
  let changeLogTail: Promise<void> = Promise.resolve();

  const unsubscribe = cache.subscribe((event) => {
    if (muted || disposed) return;
    enqueueChange(event);
    scheduleSave();
  });

  function hydrate(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (hydratePromise !== undefined) return hydratePromise;
    hydratePromise = runHydrate();
    return hydratePromise;
  }

  async function runHydrate(): Promise<boolean> {
    hydrating = true;
    try {
      const snapshot = await storage.load();
      loads++;
      const entries = await readReplayChangeLog();
      const migratedSnapshot = snapshot === null || snapshot === undefined
        ? snapshot
        : await migratePersistenceSnapshot(snapshot);
      if ((migratedSnapshot === null || migratedSnapshot === undefined) && entries.length === 0) return false;
      muted = true;
      try {
        if (migratedSnapshot !== null && migratedSnapshot !== undefined) cache.restore(migratedSnapshot);
        replayedChanges += await replayChangeLogEntries(entries);
      } finally {
        muted = false;
      }
      hydrated = true;
      return true;
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      hydrating = false;
      hydratePromise = undefined;
    }
  }

  async function flush(): Promise<void> {
    if (disposed) return;
    clearScheduledSave();
    await flushChangeLog();
    await requestSave();
  }

  async function clear(): Promise<void> {
    clearScheduledSave();
    await flushChangeLog();
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
    return {
      loads,
      saves,
      changes,
      changeLogWrites,
      replayedChanges,
      pending: isPending(),
      hydrating,
      hydrated,
      disposed
    };
  }

  function scheduleSave(): void {
    if (debounceMs === 0) {
      requestScheduledSave();
      return;
    }
    clearScheduledSave();
    timer = setTimeout(() => {
      timer = undefined;
      requestScheduledSave();
    }, debounceMs);
  }

  function requestScheduledSave(): void {
    if (scheduler === undefined) {
      void requestSave().catch(() => undefined);
      return;
    }
    scheduler.schedule({
      id: 'frontier.state-cache.save:' + ++saveTaskSeq,
      type: 'frontier.state-cache.save',
      lane: schedulerLane,
      area: 'cache',
      priority: schedulerPriority,
      units: 1,
      key: 'frontier.state-cache.save',
      metadata: { pendingChanges: changeLogPending },
      run() {
        void requestSave().catch(() => undefined);
      }
    });
    if (schedulerAutoRun) {
      if (typeof scheduler.requestRun === 'function') scheduler.requestRun(options.schedulerRunOptions);
      else if (typeof scheduler.run === 'function') scheduler.run(options.schedulerRunOptions);
    }
  }

  function clearScheduledSave(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function requestSave(): Promise<void> {
    if (disposed) return Promise.resolve();
    saveRequested = true;
    if (!saving) savePromise = runSaveLoop();
    return savePromise;
  }

  async function runSaveLoop(): Promise<void> {
    saving = true;
    try {
      while (saveRequested && !disposed) {
        saveRequested = false;
        await flushChangeLog();
        const saveOwned = (storage as QueryCacheOwnedSnapshotStorage)[MEMORY_STORAGE_SAVE_OWNED];
        const ownedSnapshot = (saveOwned !== undefined || options.compactOnFlush === true)
          ? getQueryCacheOwnedSnapshot(cache)
          : undefined;
        if (options.compactOnFlush === true && typeof storage.compact === 'function') {
          await storage.compact(ownedSnapshot ?? cache.extract());
        } else if (saveOwned === undefined) {
          await storage.save(cache.extract());
        } else {
          await saveOwned.call(storage, ownedSnapshot ?? cache.extract());
        }
        saves++;
      }
    } catch (error) {
      saveRequested = false;
      reportError(error);
      throw error;
    } finally {
      saving = false;
      if (saveRequested && !disposed) savePromise = runSaveLoop();
    }
  }

  function enqueueChange(event: QueryCacheEvent): void {
    changes++;
    if (appendChange === undefined) return;
    changeLogPending++;
    const write = changeLogTail.then(async () => {
      await ensureChangeSeq();
      const entry = eventToChangeLogEntry(++changeSeq, event, includeChangeLogPatches);
      await appendChange(entry);
      changeLogWrites++;
    });
    changeLogTail = write.catch((error) => {
      changeLogFailure = error;
      reportError(error);
    }).finally(() => {
      changeLogPending--;
    });
    void changeLogTail.catch(() => undefined);
  }

  function ensureChangeSeq(): Promise<void> {
    if (changeSeqPromise !== undefined) return changeSeqPromise;
    if (typeof storage.readChangeLog !== 'function') {
      changeSeqPromise = Promise.resolve();
      return changeSeqPromise;
    }
    changeSeqPromise = Promise.resolve(storage.readChangeLog()).then((entries) => {
      for (let i = 0; i < entries.length; i++) {
        const seq = Number(entries[i].seq);
        if (Number.isFinite(seq) && seq > changeSeq) changeSeq = Math.floor(seq);
      }
    });
    return changeSeqPromise;
  }

  async function readReplayChangeLog(): Promise<QueryCacheChangeLogEntry[]> {
    if (options.replayChangeLog !== true || typeof storage.readChangeLog !== 'function') return [];
    const entries = await storage.readChangeLog();
    const out: QueryCacheChangeLogEntry[] = [];
    for (let i = 0; i < entries.length; i++) {
      const migrated = await migratePersistenceChangeLogEntry(cloneChangeLogEntry(entries[i]));
      if (migrated !== null && migrated !== undefined) out.push(migrated);
    }
    out.sort((left, right) => left.seq - right.seq);
    for (let i = 0; i < out.length; i++) {
      const seq = Number(out[i].seq);
      if (Number.isFinite(seq) && seq > changeSeq) changeSeq = Math.floor(seq);
    }
    return out;
  }

  async function migratePersistenceSnapshot(snapshot: QueryCacheSnapshot): Promise<QueryCacheSnapshot | null | undefined> {
    if (!options.migrateSnapshot) return snapshot;
    return normalizePersistenceMigrationResult(
      await options.migrateSnapshot(snapshot, { source: 'frontier.state-cache.snapshot', storage }),
      snapshot,
      { source: 'frontier.state-cache.snapshot', storage }
    );
  }

  async function migratePersistenceChangeLogEntry(entry: QueryCacheChangeLogEntry): Promise<QueryCacheChangeLogEntry | null | undefined> {
    if (!options.migrateChangeLogEntry) return entry;
    return normalizePersistenceMigrationResult(
      await options.migrateChangeLogEntry(entry, { source: 'frontier.state-cache.change-log', storage }),
      entry,
      { source: 'frontier.state-cache.change-log', storage }
    );
  }

  function normalizePersistenceMigrationResult<T>(
    result: T | null | undefined | QueryCachePersistenceMigrationResult<T>,
    fallback: T,
    context: QueryCachePersistenceMigrationContext
  ): T | null | undefined {
    if (isPersistenceMigrationResult(result)) {
      if (result.report !== undefined) options.onMigrationReport?.(result.report, context);
      return result.data;
    }
    if (result === undefined) return fallback;
    return result;
  }

  async function replayChangeLogEntries(entries: readonly QueryCacheChangeLogEntry[]): Promise<number> {
    let replayed = 0;
    for (let i = 0; i < entries.length; i++) {
      if (await replayChangeLogEntry(entries[i])) replayed++;
    }
    return replayed;
  }

  async function replayChangeLogEntry(entry: QueryCacheChangeLogEntry): Promise<boolean> {
    if (entry.type === 'query') {
      if (entry.key === undefined) throw new Error('Cannot replay query change-log entry without a query key');
      if (entry.patch === undefined) throw new Error('Cannot replay query change-log entry without patch data');
      const current = cache.getQueryData(entry.key);
      const next = await applyReplayPatch(current === undefined ? null : current, entry.patch);
      if (current !== undefined && equalsJsonFast(current, next)) return true;
      cache.writeQuery(entry.key, next, {
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : undefined,
        stale: entry.stale === true
      });
      return true;
    }
    if (entry.type === 'entity') {
      if (entry.entityId === undefined) throw new Error('Cannot replay entity change-log entry without an entity id');
      if (entry.patch === undefined) throw new Error('Cannot replay entity change-log entry without patch data');
      const current = cache.getEntity(entry.entityId);
      const next = await applyReplayPatch(current === undefined ? null : current, entry.patch);
      if (next === null) {
        cache.removeEntity(entry.entityId);
        return true;
      }
      if (!isJsonObject(next)) throw new Error('Cannot replay entity change-log entry to a non-object value');
      if (current !== undefined && equalsJsonFast(current, next)) return true;
      cache.modifyEntity(entry.entityId, () => next);
      return true;
    }
    if (entry.type === 'invalidate') {
      if (entry.entityId !== undefined) {
        cache.invalidateEntity(entry.entityId);
        return true;
      }
      if (entry.key !== undefined) {
        cache.invalidateQueries({ queryKey: entry.key, exact: true });
        return true;
      }
      if (entry.hash !== undefined) {
        cache.invalidateQueries({ predicate: (query) => query.hash === entry.hash });
        return true;
      }
      return false;
    }
    if (entry.type === 'clear') {
      cache.clear();
      return true;
    }
    return false;
  }

  async function flushChangeLog(): Promise<void> {
    await changeLogTail;
    if (changeLogFailure !== undefined) {
      const error = changeLogFailure;
      changeLogFailure = undefined;
      throw error;
    }
  }

  function isPending(): boolean {
    return timer !== undefined || saving || saveRequested || changeLogPending !== 0 || hydrating;
  }

  function reportError(error: unknown): void {
    if (typeof options.onError === 'function') options.onError(error);
  }

  const ready = options.autoHydrate === true ? hydrate() : Promise.resolve(false);
  if (options.autoHydrate === true) void ready.catch(() => undefined);

  return { ready, hydrate, flush, clear, dispose, getStats };
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

async function applyReplayPatch(value: JsonValue, patch: Patch): Promise<JsonValue> {
  if (replayApplyPatchImmutable === undefined) {
    replayApplyPatchImmutable = import('@shapeshift-labs/frontier/apply').then((module) => module.applyPatchImmutable as ReplayApplyPatchImmutable);
  }
  const applyPatch = await replayApplyPatchImmutable;
  return applyPatch(value, patch);
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

function isPersistenceMigrationResult<T>(value: unknown): value is QueryCachePersistenceMigrationResult<T> {
  if (value === null || typeof value !== 'object' || !('data' in value)) return false;
  const candidate = value as { kind?: unknown; report?: unknown; version?: unknown; changed?: unknown };
  return candidate.kind === 'frontier.migration.result'
    || candidate.kind === 'frontier.migration.runtime-data.result'
    || candidate.report !== undefined
    || candidate.version !== undefined
    || candidate.changed !== undefined;
}

function cloneInternalAsJson(value: QueryCacheInternalValue | unknown): JsonValue {
  return cloneJson(value as JsonValue);
}

function cloneInternalValue(value: unknown): QueryCacheInternalValue {
  return cloneJson(value as JsonValue) as QueryCacheInternalValue;
}

function readMergeQueueString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(name + ' must be a non-empty string');
  }
  return value;
}

function readMergeQueueNumber(value: unknown, name: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new TypeError(name + ' must be a finite number');
  return number;
}

function readMergeQueueClock(value: unknown, name: string, minimum = 0): number {
  const clock = Math.floor(readMergeQueueNumber(value, name));
  if (clock < minimum) throw new RangeError(name + ' must be greater than or equal to ' + minimum);
  return clock;
}

function readMergeQueueJsonObject(value: JsonObject | null | undefined, name: string): JsonObject {
  if (!isJsonObject(value)) throw new TypeError(name + ' must be a JSON object');
  return value;
}

function readMergeQueueLaneStatus(value: unknown): QueryCacheMergeQueueLaneStatus {
  if (value === 'open' || value === 'draining' || value === 'closed') return value;
  throw new TypeError('merge queue lane lifecycle status must be open, draining, or closed');
}

function readMergeQueueTerminalDecisionStatus(value: unknown): QueryCacheMergeQueueTerminalDecisionStatus {
  if (
    value === 'applied'
    || value === 'committed'
    || value === 'queued'
    || value === 'promoted'
    || value === 'rejected'
    || value === 'rerun'
    || value === 'blocked'
    || value === 'recorded'
  ) return value;
  throw new TypeError('merge queue terminal decision status must be a recognized status');
}

function sortQueryCacheMergeQueueActiveLeases(
  records: QueryCacheMergeQueueActiveLease[]
): QueryCacheMergeQueueActiveLease[] {
  return records.sort((left, right) => (
    compareMergeQueueStrings(left.leaseId, right.leaseId)
    || compareMergeQueueStrings(left.lane, right.lane)
    || compareMergeQueueStrings(left.scopeId, right.scopeId)
    || compareMergeQueueStrings(left.workId, right.workId)
    || compareMergeQueueNumbers(left.acquiredAt, right.acquiredAt)
    || compareMergeQueueNumbers(left.updatedAt, right.updatedAt)
    || compareMergeQueueNumbers(left.expiresAt, right.expiresAt)
  ));
}

function sortQueryCacheMergeQueueQueuedWork(
  records: QueryCacheMergeQueueQueuedWork[]
): QueryCacheMergeQueueQueuedWork[] {
  return records.sort((left, right) => (
    compareMergeQueueStrings(left.lane, right.lane)
    || compareMergeQueueNumbers(left.queuedAt, right.queuedAt)
    || compareMergeQueueStrings(left.workId, right.workId)
    || compareMergeQueueStrings(left.scopeId, right.scopeId)
    || compareMergeQueueStrings(left.leaseId, right.leaseId)
    || compareMergeQueueNumbers(left.priority, right.priority)
  ));
}

function sortQueryCacheMergeQueueLanes(
  records: QueryCacheMergeQueueLaneLifecycle[]
): QueryCacheMergeQueueLaneLifecycle[] {
  return records.sort((left, right) => (
    compareMergeQueueStrings(left.lane, right.lane)
    || compareMergeQueueStrings(left.status, right.status)
    || compareMergeQueueNumbers(left.openedAt, right.openedAt)
    || compareMergeQueueNumbers(left.updatedAt, right.updatedAt)
    || compareMergeQueueNumbers(left.closedAt, right.closedAt)
  ));
}

function sortQueryCacheMergeQueueTerminalDecisions(
  records: QueryCacheMergeQueueTerminalDecision[]
): QueryCacheMergeQueueTerminalDecision[] {
  return records.sort((left, right) => (
    compareMergeQueueNumbers(left.decidedAt, right.decidedAt)
    || compareMergeQueueStrings(left.workId, right.workId)
    || compareMergeQueueStrings(left.lane, right.lane)
    || compareMergeQueueStrings(left.status, right.status)
    || compareMergeQueueStrings(left.decisionId, right.decisionId)
  ));
}

function sortQueryCacheMergeQueueOpenQuestions(
  records: QueryCacheMergeQueueOpenQuestion[]
): QueryCacheMergeQueueOpenQuestion[] {
  return records.sort((left, right) => (
    compareMergeQueueNumbers(left.openedAt, right.openedAt)
    || compareMergeQueueStrings(left.questionCode, right.questionCode)
    || compareMergeQueueStrings(left.questionId, right.questionId)
    || compareMergeQueueNumbers(left.updatedAt, right.updatedAt)
  ));
}

function sortQueryCacheMergeQueueConsumedAnswerCursors(
  records: QueryCacheMergeQueueConsumedAnswerCursor[]
): QueryCacheMergeQueueConsumedAnswerCursor[] {
  return records.sort((left, right) => (
    compareMergeQueueStrings(left.questionId, right.questionId)
    || compareMergeQueueStrings(left.questionCode, right.questionCode)
    || compareMergeQueueNumbers(left.sequence, right.sequence)
    || compareMergeQueueNumbers(left.consumedAt, right.consumedAt)
    || compareMergeQueueNumbers(left.updatedAt, right.updatedAt)
    || compareMergeQueueStrings(left.cursor, right.cursor)
  ));
}

function compareQueryCacheMergeQueueConsumedAnswerCursor(
  left: QueryCacheMergeQueueConsumedAnswerCursor,
  right: QueryCacheMergeQueueConsumedAnswerCursor
): number {
  return (
    compareMergeQueueStrings(left.questionId, right.questionId)
    || compareMergeQueueStrings(left.cursor, right.cursor)
    || compareMergeQueueNumbers(left.sequence, right.sequence)
    || compareMergeQueueNumbers(left.consumedAt, right.consumedAt)
    || compareMergeQueueNumbers(left.updatedAt, right.updatedAt)
  );
}

function compareQueryCacheSemanticStreamCursor(
  left: QueryCacheSemanticStreamCursor,
  right: QueryCacheSemanticStreamCursor
): number {
  return (
    compareMergeQueueStrings(left.streamId, right.streamId)
    || compareMergeQueueNumbers(left.sequence, right.sequence)
    || compareMergeQueueNumbers(left.updatedAt, right.updatedAt)
    || compareMergeQueueStrings(left.cursor, right.cursor)
  );
}

function compareMergeQueueStrings(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left.localeCompare(right);
}

function compareMergeQueueNumbers(left: number | undefined, right: number | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}
