# TanStack DB + RxDB Setup

This guide is about the actual setup work: picking packages, designing the document model, creating the local RxDB database, adding a collection schema, enabling migrations, and then wrapping the result with TanStack DB so the UI can consume it cleanly.

The examples in this guide are general, but the current repository demonstrates the ideas in [apps/web/src/lib/rxdb.ts](../apps/web/src/lib/rxdb.ts).

## Begin With The Data Shape

Before you install anything, decide what one document looks like.

If you are building todos, your first instinct might be something like:

- `id`
- `text`
- `completed`
- `updatedAt`
- a soft-delete flag

That is a good start, but what matters is not the exact fields. What matters is that you think in terms of a durable document model, not temporary UI state.

At this stage, it is also worth deciding whether your app field names and your backend wire field names will be identical. They do not have to be. In fact, they often should not be. This repository, for example, uses `removed` in the frontend schema and maps it to `deleted` at the replication boundary. That is a deliberate separation between the app model and the server contract.

## Install The Core Packages

For a React app that uses TanStack DB on top of RxDB, the key packages are:

```bash
bun add rxdb @tanstack/db @tanstack/react-db @tanstack/rxdb-db-collection
```

In a realistic setup you will usually also want:

- an RxDB storage adapter
- a schema validation plugin
- a migration plugin
- optional development tooling

The current demo app uses these RxDB modules:

- `rxdb/plugins/storage-localstorage`
- `rxdb/plugins/validate-ajv`
- `rxdb/plugins/dev-mode`
- `rxdb/plugins/migration-schema`

You can see that reflected in [apps/web/package.json](../apps/web/package.json) and [apps/web/src/lib/rxdb.ts](../apps/web/src/lib/rxdb.ts).

The big takeaway is that RxDB is intentionally modular. You do not just “use RxDB.” You choose a storage backend, then add the capabilities you need.

## Create The Local Database

The next step is creating the actual client-side database instance. A stripped-down version looks like this:

```ts
import { addRxPlugin, createRxDatabase } from "rxdb/plugins/core";
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";

addRxPlugin(RxDBDevModePlugin);
addRxPlugin(RxDBMigrationSchemaPlugin);

const db = await createRxDatabase({
  name: "my-todos-v1",
  storage: wrappedValidateAjvStorage({
    storage: getRxStorageLocalstorage(),
  }),
});
```

This block carries more design meaning than it first appears to.

The storage adapter determines where documents physically live on the client. In this repository, the demo uses local storage because it keeps the example lightweight. In another app you might prefer IndexedDB, SQLite, Dexie-backed storage, or something more durable for larger datasets.

The validation wrapper is optional, but it is highly recommended while you are getting started. It catches replication mismatches, malformed writes, and schema drift much earlier than you would otherwise catch them.

The migration plugin matters as soon as your collection schema version goes above `0`. If you evolve the schema and forget migration support, RxDB will remind you quickly.

## Be Intentional About The Database Name

One of the first confusing errors new users hit is a schema mismatch for a database name that already exists in storage.

RxDB persists schema metadata alongside your data. If you change the schema but keep reusing the same database name, the local store can become incompatible with the new code. In development, a very practical pattern is to version the database name itself:

```ts
const DB_NAME = "my-todos-v2";
```

That is exactly what the current demo does. It is not the only way to handle schema changes, but it is a very effective way to avoid getting blocked while you are still iterating quickly.

In production, you will usually want real migrations rather than continuously renaming the database. But while you are still shaping the first implementation, a versioned database name is a perfectly reasonable move.

## Add A Collection And Schema

With the database created, you add collections. A representative example:

```ts
await db.addCollections({
  todos: {
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
        removed: oldDoc._deleted ?? oldDoc.deleted ?? false,
      }),
    },
  },
});
```

There are several practical rules bundled into this schema.

The primary key should be explicit and stable.

The `updatedAt` field is there because the replication strategy needs an ordering field and, in this demo, also uses that field as part of conflict validation.

The `removed` field is there because soft deletes are much easier to replicate than hard deletes.

The migration strategy exists because the schema version is `1`. Once you leave version `0`, you need to think about how old stored documents become valid under the new schema.

## Watch Out For Reserved Or Risky Field Names

One easy mistake is choosing a field name that clashes with RxDB document properties or internal behavior. If the schema checker complains that a top-level field name is not allowed, take that seriously.

In practice, it is often better to rename the field in your app-facing schema and translate it at the replication boundary. That is exactly why this repository uses `removed` locally and maps it to the backend’s `deleted` field.

This is not just a workaround. It is a useful architectural pattern. Your local model does not have to mirror your server model byte-for-byte.

## Decide How Initialization Will Run

The current implementation uses top-level `await` in [apps/web/src/lib/rxdb.ts](../apps/web/src/lib/rxdb.ts) to create the database and add collections during module evaluation.

That is convenient, but not every bundler target supports it equally well. If your toolchain complains about top-level await, you can move the same logic into:

- a lazy `getDb()` function
- a singleton `dbPromise`
- an async app bootstrap step

That is a build-shape choice, not an architecture choice. The data model and replication design stay the same.

## Wrap RxDB With TanStack DB

Once the RxDB collection exists, you can expose it to the application through TanStack DB:

```ts
import { createCollection } from "@tanstack/react-db";
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection";

export const todosCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
    startSync: true,
  }),
);
```

This is the point where the stack becomes pleasant in React.

RxDB remains the persistent local database. TanStack DB becomes the live in-memory application view over that collection. The adapter subscribes to RxDB changes and reflects them into the TanStack collection so that UI queries stay current.

The subtle but important idea here is that wrapping the collection does not replace RxDB. It gives the rest of your app a cleaner way to consume it.

## Expose Query Helpers Early

It is worth creating small query helpers early rather than letting every component query the collection directly.

A pattern like this works well:

```ts
export function useAllTodosQuery() {
  return useLiveQuery((q) =>
    q.from({ todo: todosCollection }).select(({ todo }) => ({
      id: todo.id,
      text: todo.text,
      completed: todo.completed,
      updatedAt: todo.updatedAt,
      removed: todo.removed,
    })),
  );
}
```

This keeps your components simpler and gives you one place to evolve the query shape later. It also establishes a clear contract: React components consume query helpers, not raw storage internals.

## Add Small Mutation Helpers Where It Helps

You do not need to expose every possible mutation through TanStack DB directly. Sometimes a thin RxDB helper is the clearer abstraction.

The current implementation includes:

```ts
export async function patchTodo(
  id: string,
  patch: { completed?: boolean; removed?: boolean },
): Promise<void> {
  const doc = await db.todos.findOne(id).exec();
  if (doc) await doc.incrementalPatch({ ...patch, updatedAt: Date.now() });
}
```

That helper does two useful things. It keeps patch logic out of UI components, and it ensures that every local update also stamps a fresh `updatedAt` value. In a replicated setup, that consistency matters.

## A Good Starter File Layout

If you are starting fresh, a very workable structure is:

- one file for RxDB database, schema, and replication setup
- one file for TanStack DB collection exports and query helpers
- one file or folder for backend pull/push handlers
- one small demo route or test screen to exercise the system

This repository collapses some of that into [apps/web/src/lib/rxdb.ts](../apps/web/src/lib/rxdb.ts) for simplicity, but the responsibilities are still conceptually separate.

## What To Read Next

Once your database and collection are set up, the natural next question is how to read from the collection in the UI and how to perform CRUD in a way that plays nicely with replication. That is covered in [docs/tanstack-db-rxdb-crud-and-ui.md](./tanstack-db-rxdb-crud-and-ui.md).

If your main question is instead how to connect this to an existing backend, continue with [docs/tanstack-db-rxdb-replication-and-backend.md](./tanstack-db-rxdb-replication-and-backend.md).
