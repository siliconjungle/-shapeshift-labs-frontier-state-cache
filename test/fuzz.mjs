import assert from 'node:assert';
import { applyPatchImmutable } from '@shapeshift-labs/frontier/patch';
import { createQueryCache, mergeOffsetPage } from '../dist/index.js';

const args = parseArgs(process.argv.slice(2));
const cases = readPositiveInt(args.cases, 500);
const seed = readPositiveInt(args.seed, 0xcac4e5);
const rng = mulberry32(seed);

for (let id = 0; id < cases; id++) {
  const localRng = mulberry32((rng() * 0xffffffff) >>> 0);
  runCase(id, localRng);
}

console.log('frontier state-cache fuzz passed cases=' + cases + ' seed=' + seed);

function runCase(caseId, rng) {
  const cache = createQueryCache({ now: () => caseId });
  const groups = makeGroups(rng);
  const expectedByGroup = new Map();
  const observedByGroup = new Map();

  for (const group of groups) {
    const queryKey = ['todos', { group }];
    const todos = makeTodos(group, rng);
    expectedByGroup.set(group, clone(todos));
    cache.writeQuery(queryKey, todos);
    if ((observedByGroup.size & 1) === 0) {
      observedByGroup.set(group, cache.getQueryData(queryKey));
      cache.watchQuery(queryKey, (patch) => {
        observedByGroup.set(group, applyPatchImmutable(observedByGroup.get(group), patch));
      });
    }
  }

  for (let step = 0; step < 20; step++) {
    const group = groups[randomInt(rng, groups.length)];
    const todos = expectedByGroup.get(group);
    const choice = randomInt(rng, 4);
    if (choice === 0 || todos.length === 0) {
      const page = [makeUniqueTodo(group, todos, rng)];
      cache.writeQuery(['todos', { group }], page, {
        merge: (existing, incoming) => mergeOffsetPage(existing, incoming, { offset: todos.length })
      });
      todos.push(clone(page[0]));
    } else {
      const index = randomInt(rng, todos.length);
      const id = todos[index].id;
      const done = !todos[index].done;
      cache.modifyEntity('Todo:' + id, (todo) => ({
        ...todo,
        done,
        revision: Number(todo?.revision || 0) + 1
      }));
      todos[index].done = done;
      todos[index].revision++;
    }

    if (step % 5 === 0) {
      const optimisticGroup = groups[randomInt(rng, groups.length)];
      const optimisticTodos = expectedByGroup.get(optimisticGroup);
      if (optimisticTodos.length > 0) {
        const optimisticIndex = randomInt(rng, optimisticTodos.length);
        const id = optimisticTodos[optimisticIndex].id;
        cache.optimistic('case-' + caseId + '-step-' + step, () => {
          cache.modifyEntity('Todo:' + id, (todo) => ({
            ...todo,
            text: String(todo?.text || '') + '-optimistic'
          }));
        });
        assert.ok(String(cache.getEntity('Todo:' + id).text).endsWith('-optimistic'));
        assert.strictEqual(cache.rollbackOptimistic('case-' + caseId + '-step-' + step), true);
      }
    }

    for (const item of groups) {
      const queryKey = ['todos', { group: item }];
      assert.deepStrictEqual(cache.getQueryData(queryKey), expectedByGroup.get(item));
      if (observedByGroup.has(item)) {
        assert.deepStrictEqual(observedByGroup.get(item), expectedByGroup.get(item));
      }
    }
  }
}

function makeGroups(rng) {
  const count = 2 + randomInt(rng, 3);
  const groups = [];
  for (let i = 0; i < count; i++) groups.push('g' + i);
  return groups;
}

function makeTodos(group, rng) {
  const count = 2 + randomInt(rng, 8);
  const todos = [];
  for (let i = 0; i < count; i++) todos.push(makeTodo(group, i, rng));
  return todos;
}

function makeTodo(group, index, rng) {
  return {
    __typename: 'Todo',
    id: group + '-' + index,
    group,
    text: 'todo-' + group + '-' + index,
    done: randomInt(rng, 2) === 0,
    revision: 0
  };
}

function makeUniqueTodo(group, todos, rng) {
  const existing = new Set(todos.map((todo) => todo.id));
  let index = todos.length + randomInt(rng, 1000);
  while (existing.has(group + '-' + index)) index++;
  return makeTodo(group, index, rng);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function randomInt(rng, max) {
  return Math.floor(rng() * max);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cases') out.cases = argv[++i];
    else if (arg === '--seed') out.seed = argv[++i];
    else throw new Error('unknown argument: ' + arg);
  }
  return out;
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
