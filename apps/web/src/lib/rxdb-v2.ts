// import SQLiteESMFactory from "@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs";
import { createCollection, useLiveQuery } from "@tanstack/react-db";
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection";
import { addRxPlugin, createRxDatabase } from "rxdb/plugins/core";
import {
  getRxStorageSQLiteTrial,
  getSQLiteBasicsTauri,
  getSQLiteBasicsWasm,
} from "rxdb/plugins/storage-sqlite";

// add json-schema validation (optional)
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";

// Enable dev mode (optional, recommended during development)
import { client } from "@/utils/orpc";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { replicateRxCollection } from "rxdb/plugins/replication";
addRxPlugin(RxDBDevModePlugin);

const isTauri = window && "__TAURI_INTERNALS__" in window;
console.log("Are we Tauri yet?", isTauri);

async function getSQLiteBasicsForCurrentRuntime() {
  if (isTauri) {
    const sqlite3Tauri = (await import("@tauri-apps/plugin-sql")).default;
    return getSQLiteBasicsTauri(sqlite3Tauri);
  }

  const SQLite = await import("wa-sqlite");
  const SQLiteESMFactory = (await import("wa-sqlite/dist/wa-sqlite-async.mjs")).default;
  const sqliteModule = await SQLiteESMFactory();
  const sqlite3 = SQLite.Factory(sqliteModule);
  return getSQLiteBasicsWasm(sqlite3 as any);
}

const db = await createRxDatabase({
  name: "my-todos-v2",
  storage: wrappedValidateAjvStorage({
    storage: getRxStorageSQLiteTrial({
      sqliteBasics: await getSQLiteBasicsForCurrentRuntime(),
    }),
  }),
});

await db.addCollections({
  todos: {
    schema: {
      title: "todos",
      version: 0,
      type: "object",
      primaryKey: "id",
      properties: {
        id: { type: "string", maxLength: 100 },
        text: { type: "string" },
        completed: { type: "boolean" },
      },
      required: ["id", "text", "completed"],
    },
  },
});
export const todosV2ReplicationState = replicateRxCollection({
  collection: db.todos,
  replicationIdentifier: "todos-replication-v2",
  deletedField: "removed",
  pull: {
    batchSize: 50,
    modifier: (doc) => {
      const d = doc as { deleted?: boolean; removed?: boolean };
      return { ...d, removed: d.deleted ?? d.removed ?? false, deleted: undefined };
    },
    handler: async (checkpoint, batchSize) => {
      const result = await client.pub__todosPull({
        checkpoint: checkpoint as { id: string; updatedAt: number } | null,
        limit: batchSize,
      });
      return { documents: result.documents, checkpoint: result.checkpoint };
    },
  },
});

export const todosV2Collection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
    startSync: true, // start ingesting RxDB data immediately
  }),
);

export function useAllTodosV2Query() {
  return useLiveQuery((q) => q.from({ todo: todosV2Collection }).select(({ todo }) => todo));
}
