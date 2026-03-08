# Advanced Sample: SQLite Plus oRPC

This sample is closer to a real application.

It demonstrates a pattern where:

- the host app uses SQLite instead of localStorage
- runtime storage setup is async
- pull and push handlers map through an application RPC client
- local document shape intentionally differs from the backend wire shape

This is the kind of setup the package was extracted for.

## Why SQLite Changes The Setup Shape

Once your app uses SQLite, storage creation is often no longer a one-line synchronous operation.

You may need to:

- detect the runtime
- load a WASM module
- initialize a desktop or mobile adapter
- wrap storage with validation

The package supports that by accepting `createStorage()` as an async function.

## Example

```ts
import { createReplicatedRxCollectionModule } from "@offline-first-backend-sync/rxdb-sync";
import {
  getRxStorageSQLiteTrial,
  getSQLiteBasicsTauri,
  getSQLiteBasicsWasm,
} from "rxdb/plugins/storage-sqlite";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import * as SQLite from "wa-sqlite";

type TodoDoc = {
  id: string;
  text: string;
  completed: boolean;
  updatedAt: number;
  removed?: boolean;
  flapFap?: boolean;
};

type TodoCheckpoint = { id: string; updatedAt: number } | null;

async function getSQLiteBasicsForCurrentRuntime() {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  if (isTauri) {
    const sqlite3Tauri = (await import("@tauri-apps/plugin-sql")).default;
    return getSQLiteBasicsTauri(sqlite3Tauri);
  }

  const SQLiteESMFactory = (await import("wa-sqlite/dist/wa-sqlite-async.mjs")).default;
  const sqliteModule = await SQLiteESMFactory();
  const sqlite3 = SQLite.Factory(sqliteModule);
  return getSQLiteBasicsWasm(sqlite3);
}

export const todosModule = createReplicatedRxCollectionModule<TodoDoc, TodoCheckpoint, "todos">({
  databaseName: "todos-v8",
  async createStorage() {
    return wrappedValidateAjvStorage({
      storage: getRxStorageSQLiteTrial({
        sqliteBasics: await getSQLiteBasicsForCurrentRuntime(),
        log: console.log.bind(console),
      }),
    });
  },
  collectionName: "todos",
  schema: todoSchema,
  migrationStrategies,
  enableDevMode: true,
  replication: {
    identifier: "todos-replication-v2",
    live: true,
    retryTime: 5_000,
    autoStart: true,
    toggleOnDocumentVisible: false,
    push: {
      batchSize: 10,
      handler: async (rows) => {
        const docs = rows.map((row) => {
          const nextDoc = row.newDocumentState as TodoDoc;

          return {
            assumedMasterState: row.assumedMasterState,
            newDocumentState: {
              id: nextDoc.id,
              text: nextDoc.text,
              completed: nextDoc.completed,
              removed: nextDoc.removed ?? false,
              updatedAt: nextDoc.updatedAt,
              flapFap: nextDoc.flapFap ?? true,
            },
          };
        });

        const conflicts = await client.pub__todosV2Push({ docs });
        return conflicts.map((conflict) => ({
          id: conflict.id,
          text: conflict.text,
          completed: conflict.completed,
          removed: conflict.removed ?? false,
          updatedAt: conflict.updatedAt,
          flapFap: conflict.flapFap ?? true,
          _deleted: false,
        }));
      },
    },
    pull: {
      batchSize: 50,
      modifier: (doc) => ({
        ...doc,
        _deleted: doc._deleted ?? false,
      }),
      handler: async (checkpoint, batchSize) => {
        const result = await client.pub__todosV2Pull({
          checkpoint: checkpoint ?? null,
          limit: batchSize,
        });

        return {
          documents: result.documents.map((doc) => ({
            ...doc,
            _deleted: false,
          })),
          checkpoint: result.checkpoint ?? checkpoint ?? null,
        };
      },
    },
  },
});
```

## What This Sample Shows

This sample demonstrates several important real-world points:

- storage creation can be runtime-specific and async
- the package does not need to know about Tauri or WASM directly
- the app can keep backend procedure names entirely outside the package
- local fields can differ from backend fields as long as mapping happens at the replication boundary

That is what “generic orchestration, host-owned integration” looks like in practice.
