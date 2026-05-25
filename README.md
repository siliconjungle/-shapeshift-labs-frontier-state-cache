# Frontier State Cache

Reserved package name for a future optional Frontier normalized state-cache package.

This package is not ready for production use. It exists so the package and repository names are reserved while normalized cache, selector, invalidation, and routed patch-update boundaries are finalized.

- npm: [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache)
- source: [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- core package: [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier)
- state package: [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state)
- license: MIT

## Intended Scope

When this package graduates from placeholder status, it is expected to contain:

- normalized JSON state caches and entity indexes;
- patch-aware cache updates and invalidation;
- selector caches and derived view retention;
- path, row, and key indexes for routed updates;
- snapshot/import/export helpers for cache state.

It should sit above `@shapeshift-labs/frontier` and likely above `@shapeshift-labs/frontier-state`. It should stay separate from CRDT documents, sync providers, logging, rich text, and transport codecs.

## Current Status

Use [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier) for the stable JSON diff/apply core.

The state-cache package is reserved only. No runtime API is exported yet.

## Package Family

Published or active packages:

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier)
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec)
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation)

Reserved future packages:

- `@shapeshift-labs/frontier-engine`
- `@shapeshift-labs/frontier-state`
- `@shapeshift-labs/frontier-crdt`
- `@shapeshift-labs/frontier-crdt-sync`
- `@shapeshift-labs/frontier-richtext`
- `@shapeshift-labs/frontier-logging`
- `@shapeshift-labs/frontier-event-log`
- `@shapeshift-labs/frontier-schema`

## License

MIT. See [LICENSE](./LICENSE).
