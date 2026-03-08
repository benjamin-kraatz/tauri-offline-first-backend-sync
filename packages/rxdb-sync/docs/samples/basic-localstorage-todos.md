# Sample: Basic LocalStorage Todos

This is the smallest useful sample for the package.

It uses:

- browser localStorage through RxDB
- JSON-schema validation
- a single `todos` collection
- a simple backend pull/push contract
- a small app-facing query helper

It is not meant to be production-perfect. It is meant to show the package boundary clearly.

## Local Document Shape

```ts
type TodoDoc = {
  id: string;
  text: string;
  completed: boolean;
  updatedAt: number;
  removed?: boolean;
};

type TodoCheckpoint = { id: string; updatedAt: number } | null;
```

## Storage

```ts
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage";

function createStorage() {
  return wrappedValidateAjvStorage({
    storage: getRxStorageLocalstorage(),
  });
}
```

## Schema

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

## Module Composition

```ts
import { createReplicatedRxCollectionModule } from "@offline-first-backend-sync/rxdb-sync";

export const todosModule = createReplicatedRxCollectionModule<TodoDoc, TodoCheckpoint, "todos">({
  databaseName: "todos-v1",
  createStorage,
  collectionName: "todos",
  schema: todoSchema,
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

## App Helpers

```ts
import { useLiveQuery } from "@tanstack/react-db";

const { rxCollection, collection } = await todosModule.getContext();

export async function addTodo(text: string) {
  const nextText = text.trim();
  if (!nextText) return;

  await rxCollection.insert({
    id: crypto.randomUUID(),
    text: nextText,
    completed: false,
    updatedAt: Date.now(),
    removed: false,
  });
}

export async function patchTodo(
  id: string,
  patch: { completed?: boolean; removed?: boolean },
) {
  const doc = await rxCollection.findOne(id).exec();
  if (!doc) return;

  await doc.incrementalPatch({
    ...patch,
    updatedAt: Date.now(),
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

## Why This Is A Good First Sample

This sample demonstrates the package boundary without adding runtime-specific complexity.

It shows:

- host-owned storage creation
- host-owned schema
- host-owned replication contract
- package-owned database and TanStack bridging
- app-owned domain helpers

That is the core usage model in its smallest practical form.
