# Setup

This guide is about the first successful integration of `@offline-first-backend-sync/rxdb-sync`.

The package does not remove architectural choices. It makes those choices easier to assemble in one repeatable shape.

The main thing to understand before you start is this:

You are not “setting up a database package.”

You are setting up a contract between:

- a local RxDB collection
- a TanStack DB application-facing collection
- a host-owned storage backend
- a host-owned replication boundary

If you skip that distinction, your first implementation usually becomes confusing quickly.

## Step 1: Decide The Document Shape

Before installing anything, decide what one local document should look like.

A minimal todo example usually has:

- `id`
- `text`
- `completed`
- `updatedAt`
- a soft-delete flag such as `removed`

The important part is not the exact field list. The important part is that your local document model is durable and explicit.

Your local schema does not have to mirror your backend wire format exactly. In fact, it is often cleaner if it does not.

For example:

- local app model uses `removed`
- backend wire format uses `deleted`

That is a perfectly valid boundary. The host app can map between them in pull and push handlers.

## Step 2: Install The Core Dependencies

The package expects the normal RxDB and TanStack DB runtime pieces:

```bash
bun add @offline-first-backend-sync/rxdb-sync rxdb @tanstack/db @tanstack/react-db @tanstack/rxdb-db-collection react
```

You will also need whichever RxDB plugins your app actually uses. Typical examples include:

- `rxdb/plugins/validate-ajv`
- `rxdb/plugins/storage-localstorage`
- `rxdb/plugins/storage-sqlite`
- runtime-specific adapters required by the chosen storage backend

The package does not bundle storage adapters or validation wrappers because those are host decisions.

## Step 3: Create Storage In The Host App

The package asks for a `createStorage()` function instead of a raw storage object.

That is intentional.

In simple apps, storage creation may be synchronous:

```ts
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage";

function createStorage() {
  return wrappedValidateAjvStorage({
    storage: getRxStorageLocalstorage(),
  });
}
```

In more complex apps, storage creation may be async because runtime bootstrapping is required first. SQLite-on-WASM and some desktop runtimes often look like that.

This package supports both because `createStorage()` can return either a value or a promise.

## Step 4: Define Schema And Migrations

Once the storage strategy is clear, define the RxDB schema.

A representative shape looks like this:

```ts
const todoSchema = {
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
} as const;
```

If the schema version is above `0`, provide matching `migrationStrategies`.

The package will register the RxDB migration plugin automatically when it detects a schema version above `0`, but it cannot invent migration logic for you.

That still belongs to the host app because only the host app knows how old documents should be transformed.

## Step 5: Define Pull And Push Handlers

This package never talks to your backend directly.

Instead, you provide normal RxDB replication handlers.

That means the host app decides:

- which transport to use
- which endpoint or procedure names to call
- how to order remote documents
- how to represent checkpoints
- how conflicts are mapped back into local schema shape

That design is what keeps the package reusable.

## Step 6: Compose The Module

Now you can create the collection module:

```ts
import { createReplicatedRxCollectionModule } from "@offline-first-backend-sync/rxdb-sync";

const todosModule = createReplicatedRxCollectionModule<TodoDoc, TodoCheckpoint, "todos">({
  databaseName: "todos-v1",
  createStorage,
  collectionName: "todos",
  schema: todoSchema,
  migrationStrategies,
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
        return api.todos.pull({ checkpoint, limit: batchSize });
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

That one call is the main reason the package exists. It collects the repeated bootstrapping logic into one place while leaving the app-specific decisions fully visible.

## Step 7: Create App-Facing Helpers

After the module exists, the host app should still create its own small helpers.

That usually means:

- query helpers built on `collection`
- mutation helpers built on `rxCollection`
- a module-specific replication-status hook that delegates to `useReplicationState(...)`

A practical pattern is:

```ts
const { collection, rxCollection } = await todosModule.getContext();

export function useTodosReplicationState() {
  return todosModule.useReplicationState();
}

export async function addTodo(text: string) {
  await rxCollection.insert({
    id: crypto.randomUUID(),
    text,
    completed: false,
    updatedAt: Date.now(),
    removed: false,
  });
}
```

That keeps the package generic and your app API domain-specific.

## Setup Checklist

By the time your first integration is done, you should be able to answer yes to all of these:

- Does the app create storage in the host layer?
- Does the schema describe the local durable shape rather than UI convenience state?
- Are migration strategies present for every schema version above `0`?
- Do pull and push handlers map the backend contract into the local schema shape?
- Does the app expose its own query and mutation helpers instead of leaking low-level setup everywhere?
- Can the app render a small sync status view from the replication hook?

If not, the package can still work, but the integration is probably not decision-complete yet.
