# @offline-first-backend-sync/rxdb-sync

`@offline-first-backend-sync/rxdb-sync` is a small orchestration layer for teams that want to pair RxDB with TanStack DB without rewriting the same setup code for every collection.

The short version is this:

RxDB is still your local database and replication engine.

TanStack DB is still your reactive application-facing query layer.

This package sits in the seam between them.

It creates the RxDB database, adds one collection, wires replication, wraps the RxDB collection with `rxdbCollectionOptions(...)`, and gives your React app a simple surface for initialization and replication state.

It does not try to replace either library.

It does not choose your storage backend.

It does not know anything about your API client, transport, schema, or UI.

That is the point.

## What This Package Owns

This package is responsible for:

- creating a lazy singleton RxDB database and collection
- registering the RxDB dev-mode and migration plugins when needed
- starting collection replication through `replicateRxCollection(...)`
- bridging the RxDB collection into a TanStack DB collection
- exposing a small React hook for replication status
- optionally attaching browser-side replication policies such as periodic re-sync or manual remote-approval flows

## What The Host Application Still Owns

This package does not remove the need for application decisions.

The host app is still responsible for:

- choosing and creating the RxDB storage backend
- defining the document schema
- defining migration strategies
- implementing pull and push handlers
- mapping backend wire formats to local document formats
- choosing how CRUD helpers should look in the app
- deciding whether any UI should appear for replication state or remote-change approval

That separation is deliberate. A package like this should reduce repetition, not hide the parts of the system that are application-specific.

## The Mental Model

If it helps, think about the stack in four layers:

Your backend stores the remote source of truth.

RxDB stores the local durable state and performs replication.

TanStack DB turns that local state into a reactive application-facing collection.

Your app composes the storage, schema, replication handlers, and UI.

This package lives between the second and third layers. It does not try to own the first or fourth.

## Install

If you are consuming this package from a normal npm application later, the runtime dependencies you should expect are:

```bash
bun add rxdb @tanstack/db @tanstack/react-db @tanstack/rxdb-db-collection react
```

You will also need whichever RxDB plugins your app actually uses, for example:

- a storage plugin such as SQLite, IndexedDB, or localStorage
- `rxdb/plugins/validate-ajv` if you want JSON-schema validation
- any app-specific runtime adapter needed by your chosen storage backend

In this repository, the package is source-exported from the monorepo. If you publish it to npm later, you will likely want to ship compiled output instead of raw TypeScript source. That is a packaging concern, not a usage concern, but it is worth keeping in mind early.

## The Main Factory

The primary entry point is `createReplicatedRxCollectionModule(...)`.

You pass it a fully explicit configuration:

- `databaseName`
- `createStorage`
- `collectionName`
- `schema`
- `migrationStrategies`
- `enableDevMode`
- `startSync`
- `browserPolicy`
- `replication`

The return value is a small module object with:

- `getContext()`
- `useReplicationState()`

`getContext()` lazily creates the RxDB database, adds the collection, wires replication, and creates the TanStack DB collection the first time you call it.

That means the package avoids top-level async initialization in the package entrypoint itself. Consumers can still choose to await the context during module setup if their environment supports it, or they can wait until app bootstrap time.

## Quick Start

A representative setup looks like this:

```ts
import { createReplicatedRxCollectionModule } from "@offline-first-backend-sync/rxdb-sync";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage";

type TodoDoc = {
  id: string;
  text: string;
  completed: boolean;
  updatedAt: number;
  removed?: boolean;
};

type TodoCheckpoint = { id: string; updatedAt: number } | null;

const todosModule = createReplicatedRxCollectionModule<TodoDoc, TodoCheckpoint, "todos">({
  databaseName: "todos-v1",
  createStorage() {
    return wrappedValidateAjvStorage({
      storage: getRxStorageLocalstorage(),
    });
  },
  collectionName: "todos",
  schema: {
    title: "todos",
    version: 1,
    type: "object",
    primaryKey: "id",
    properties: {
      id: { type: "string", maxLength: 100 },
      text: { type: "string" },
      completed: { type: "boolean" },
      updatedAt: { type: "number" },
      removed: { type: "boolean", default: false },
    },
    required: ["id", "text", "completed", "updatedAt"],
  },
  migrationStrategies: {
    1: (oldDoc) => ({
      ...oldDoc,
      removed:
        (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean }).removed ??
        (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean }).deleted ??
        (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean })._deleted ??
        false,
      updatedAt: (oldDoc as { updatedAt?: number }).updatedAt ?? Date.now(),
    }),
  },
  enableDevMode: true,
  replication: {
    identifier: "todos-replication",
    live: true,
    retryTime: 5_000,
    autoStart: true,
    toggleOnDocumentVisible: false,
    pull: {
      batchSize: 50,
      handler: async (checkpoint, batchSize) => {
        const result = await api.todos.pull({ checkpoint, limit: batchSize });
        return {
          documents: result.documents,
          checkpoint: result.checkpoint,
        };
      },
    },
    push: {
      batchSize: 10,
      handler: async (rows) => {
        return api.todos.push({ rows });
      },
    },
  },
});
```

After that, the app can await the context and expose its own query and mutation helpers:

```ts
import { useLiveQuery } from "@tanstack/react-db";

const { rxCollection, collection, replicationState } = await todosModule.getContext();

export async function addTodo(text: string) {
  await rxCollection.insert({
    id: crypto.randomUUID(),
    text,
    completed: false,
    updatedAt: Date.now(),
    removed: false,
  });
}

export function useAllTodosQuery() {
  return useLiveQuery((q) =>
    q.from({ todo: collection }).select(({ todo }) => ({
      id: todo.id,
      text: todo.text,
      completed: todo.completed,
      updatedAt: todo.updatedAt,
      removed: todo.removed,
    })),
  );
}
```

And any React UI can observe the replication status:

```ts
export function useTodosReplicationState() {
  return todosModule.useReplicationState();
}
```

## Returned Context

`getContext()` resolves to:

```ts
type ReplicatedRxCollectionContext<TDoc, TCheckpoint, TCollectionName> = {
  db: RxDatabase<...>;
  rxCollection: RxCollection<TDoc>;
  collection: Collection<TDoc, string>;
  replicationState: RxReplicationState<TDoc, TCheckpoint>;
};
```

Each part has a different role:

- `db` is the RxDB database instance
- `rxCollection` is the underlying RxDB collection for document-level operations
- `collection` is the TanStack DB collection for reactive app queries
- `replicationState` is the RxDB replication state for sync lifecycle control and observation

That split is important.

When you want durable document writes or direct RxDB document operations, use `rxCollection`.

When you want the app-facing reactive read surface, use `collection`.

When you want to inspect or control replication, use `replicationState`.

## Configuration Reference

### `databaseName`

This is the RxDB database name.

Be intentional here. If you change the schema while reusing the same database name, persisted local data can become incompatible with the new code unless your migrations are correct.

During early development, versioning the database name is often a practical move.

### `createStorage`

This function must return a ready-to-use RxDB storage instance.

That means the host app can decide:

- whether to use localStorage, IndexedDB, SQLite, or another backend
- whether to wrap storage with validation
- whether runtime-specific setup is required first

The package does not try to infer any of that.

### `collectionName`

This is the name passed into `db.addCollections(...)`.

It is also the key used when pulling the resulting RxDB collection back out of the created database context.

### `schema`

This is the normal RxDB JSON schema for the collection.

The package does not transform it or inject additional app-level behavior into it.

### `migrationStrategies`

If your schema version is above `0`, pass the corresponding migration strategies here.

The package automatically registers the RxDB migration-schema plugin when it detects a schema version above `0`.

### `enableDevMode`

When `true`, the package registers RxDB dev-mode once for the runtime.

That is useful during development because it catches schema and usage errors earlier. It is usually something you would disable in production builds.

### `startSync`

This controls the `startSync` option passed into `rxdbCollectionOptions(...)`.

In practice, you usually want this enabled so the TanStack DB collection starts reflecting RxDB changes immediately.

### `replication`

This section maps almost directly to `replicateRxCollection(...)`.

It includes:

- `identifier`
- `deletedField`
- `pull`
- `push`
- `live`
- `retryTime`
- `autoStart`
- `toggleOnDocumentVisible`

The package wraps the pull handler slightly so it can remember the last applied checkpoint for browser replication policies.

Otherwise, the replication behavior remains your own.

## Browser Replication Policies

`createBrowserReplicationPolicy(...)` exists for browser-only lifecycle behavior around replication. It is intentionally separate from the main factory config because it is not intrinsic to RxDB itself. It is application behavior.

There are two modes:

- `auto`
- `manual`

### Auto Mode

Auto mode is for the simple case:

- re-sync on interval
- re-sync when the browser comes online
- re-sync on focus
- re-sync when the document becomes visible

That is enough for many apps.

Example:

```ts
const browserPolicy = createBrowserReplicationPolicy({
  mode: "auto",
  probeIntervalMs: 15_000,
});
```

### Manual Mode

Manual mode is for apps that want to detect remote changes before applying them automatically.

In manual mode, you provide:

- `probeForChanges(checkpoint)`
- `onChangesAvailable({ approve })`
- optional error and state callbacks

That allows your host app to decide what the approval UX should look like. A toast, modal, badge, or silent custom workflow can all sit on top of the same headless policy.

Example:

```ts
const browserPolicy = createBrowserReplicationPolicy({
  mode: "manual",
  probeIntervalMs: 15_000,
  probeForChanges: async (checkpoint) => {
    const result = await api.todos.pull({ checkpoint, limit: 1 });
    return result.documents.length > 0;
  },
  onChangesAvailable({ approve }) {
    showToast({
      message: "Remote changes are available.",
      actionLabel: "Apply",
      onAction: approve,
    });
  },
});
```

That design keeps the package headless. The package can tell you when approval is needed, but it never decides what your UI should be.

## Replication State Hooks

There are two ways to consume replication state:

Use the hook directly:

```ts
import { useReplicationState } from "@offline-first-backend-sync/rxdb-sync";

const { active, error, replicationState } = useReplicationState(replicationStateInstance);
```

Or use the hook bound to a created module:

```ts
const { active, error, replicationState } = todosModule.useReplicationState();
```

The module-bound hook is usually the simpler option when your app already has a single collection module singleton.

## Error Handling

The package normalizes one common RxDB replication error shape by extracting the first nested error from `error.parameters.errors` when present.

That means your UI hooks usually receive a more useful error value than the outer wrapper object.

The package does not otherwise impose an error-handling strategy.

If your app needs richer observability, add it in your pull and push handlers or in the host UI layer.

## A Good File Layout In A Host App

If you are integrating this package into a larger application, a practical structure is:

- one file for storage bootstrap and runtime selection
- one file for collection schema and migrations
- one file for replication pull/push adapter logic
- one file that composes those pieces with `createReplicatedRxCollectionModule(...)`
- one file for app-facing CRUD/query helpers

In small apps, those responsibilities can be collapsed. In larger apps, keeping them separate makes the boundaries much easier to reason about.

## When This Package Is A Good Fit

Use this package when:

- you already want RxDB and TanStack DB together
- you want one repeated setup pattern across collections or apps
- you want the package to stay API-agnostic
- you want the app to keep control over storage and replication contracts

This package is probably not the right fit if:

- you want a complete application framework
- you want the package to generate schemas or backend contracts for you
- you want the package to own your UI or mutation conventions
- you are not actually using TanStack DB on top of RxDB

## Publishing Notes

This repository currently exports the package directly from TypeScript source because it is consumed inside a monorepo that already understands that shape.

If you publish to npm, you will probably want to add:

- a build step that emits JavaScript and declaration files
- publish-oriented `exports`
- a `files` allowlist
- repository, license, homepage, and issue metadata
- versioning and changelog conventions

That work is packaging work, not library API work. This README is written so it can remain valid after that packaging step happens.

## API Summary

The current public surface is intentionally small:

```ts
createReplicatedRxCollectionModule<TDoc, TCheckpoint, TCollectionName>(config)
useReplicationState(replicationState)
createBrowserReplicationPolicy(options)
```

And the key exported types are:

```ts
ReplicatedRxCollectionModuleConfig<TDoc, TCheckpoint, TCollectionName>
ReplicatedRxCollectionContext<TDoc, TCheckpoint, TCollectionName>
BrowserReplicationPolicyOptions<TCheckpoint>
BrowserReplicationPolicy<TDoc, TCheckpoint>
BrowserReplicationPolicyManualState
```

That small surface area is intentional. The package should be easy to understand by reading the README once and then opening the source only when you need implementation detail.
