# Factory And Context

This guide is about the main API surface of the package:

- `createReplicatedRxCollectionModule(...)`
- `getContext()`
- `useReplicationState()`

Those three pieces are the center of the package.

## Why A Factory Exists At All

Without this package, most host apps end up repeating the same pattern:

- create the RxDB database
- add a collection
- create the replication state
- wrap the RxDB collection into a TanStack DB collection
- keep the resulting instances alive in a singleton
- expose one or two React hooks for sync state

That logic is not application-specific, but it is tedious enough to repeat badly.

The factory exists to make that repeated setup explicit and stable without hiding the host-owned decisions.

## What The Factory Does

`createReplicatedRxCollectionModule(...)` does five things:

1. It stores your configuration.
2. It lazily creates the database and collection the first time `getContext()` is called.
3. It creates the RxDB replication state.
4. It creates the TanStack DB collection from the RxDB collection.
5. It exposes a hook that observes replication state for that module instance.

That is all.

If you want a package that owns your schema, API client, UI, or CRUD conventions, this is not trying to be that package.

## Why `getContext()` Is Lazy

The package intentionally avoids top-level async initialization inside the package entrypoint.

That matters because host environments vary:

- some are fine with top-level `await`
- some bundlers are awkward about it
- some apps want initialization on first use
- some apps want initialization during bootstrap

A lazy `getContext()` lets the host app choose the timing.

If your app likes module-level initialization, you can still do:

```ts
const { collection, rxCollection, replicationState } = await todosModule.getContext();
```

If your app wants explicit bootstrap, you can call it later.

The package does not force a build-shape decision here.

## What Comes Back From `getContext()`

The returned context is:

```ts
type ReplicatedRxCollectionContext<TDoc, TCheckpoint, TCollectionName> = {
  db: RxDatabase<...>;
  rxCollection: RxCollection<TDoc>;
  collection: Collection<TDoc, string>;
  replicationState: RxReplicationState<TDoc, TCheckpoint>;
};
```

Each part has a different job.

### `db`

This is the full RxDB database.

Most host apps will not use it often after setup, but it is exposed because some applications legitimately need broader database access later.

### `rxCollection`

This is the raw RxDB collection.

Use it when:

- you want direct document operations
- you need `findOne(...)`
- you want `incrementalPatch(...)`
- you want document-level RxDB behavior rather than TanStack DB mutations

This is usually where app-specific CRUD helpers should be built.

### `collection`

This is the TanStack DB collection created from `rxdbCollectionOptions(...)`.

Use it when:

- you want the app-facing reactive read model
- you want to query through `useLiveQuery(...)`
- you want components to read cleanly without touching raw RxDB APIs

This is the piece your React UI will usually care about most.

### `replicationState`

This is the RxDB replication state returned by `replicateRxCollection(...)`.

Use it when:

- you want to observe `active$`, `error$`, or `canceled$`
- you want to call `reSync()`
- you want to build sync indicators
- you want to attach browser replication policies

## Configuration Boundaries

The factory config is intentionally explicit because that keeps the package honest.

### Things The Package Expects You To Provide

- a storage creator
- a collection name
- a schema
- optional migration strategies
- replication settings and handlers

### Things The Package Intentionally Does Not Infer

- your backend API
- your transport
- your schema field naming conventions
- your conflict resolution policy
- your UI behavior
- your mutation helper shape

That line is not accidental. It is what makes the package reusable across applications that share the same local-first architecture but not the same domain.

## Module-Bound Replication Hooks

When you create a module, you also get `module.useReplicationState()`.

That is simply a convenience wrapper over the generic `useReplicationState(replicationState)` helper.

The module-bound version is useful because it means the UI does not need to know where the replication state instance came from.

For many host apps, this is the cleanest pattern:

```ts
const todosModule = createReplicatedRxCollectionModule(...);

export function useTodosReplicationState() {
  return todosModule.useReplicationState();
}
```

That keeps the UI reading in domain language while the shared package stays generic.

## Where App Helpers Should Live

A common mistake is assuming that once this package exists, all app helpers should move into it.

That is usually the wrong move.

Keep these in the host app:

- `addTodo(...)`
- `patchTodo(...)`
- `removeTodo(...)`
- `useAllTodosQuery()`
- mapping helpers between local and remote document shapes

Move only the generic wiring into the shared package.

If you move domain helpers into the package, you usually destroy the very boundary that made the extraction useful.
