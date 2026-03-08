import { useEffect, useState } from "react";
import { createCollection, useLiveQuery } from "@tanstack/react-db";
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection";
import { addRxPlugin, createRxDatabase } from "rxdb/plugins/core";
import { replicateRxCollection } from "rxdb/plugins/replication";

/**
 * Here we use the localStorage based storage for RxDB.
 * RxDB has a wide range of storages based on Dexie.js, IndexedDB, SQLite, and more.
 */
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage";

// add json-schema validation (optional)
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";

// Enable dev mode (optional, recommended during development)
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { client } from "@/utils/orpc";
addRxPlugin(RxDBDevModePlugin);
addRxPlugin(RxDBMigrationSchemaPlugin);

/** Include schema version in DB name so schema changes don't conflict with existing localStorage data */
const DB_NAME = "my-todos-v2";

const db = await createRxDatabase({
  name: DB_NAME,
  storage: wrappedValidateAjvStorage({
    storage: getRxStorageLocalstorage(),
  }),
});

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
        removed: (oldDoc as { _deleted?: boolean; deleted?: boolean })._deleted
          ?? (oldDoc as { _deleted?: boolean; deleted?: boolean }).deleted
          ?? false,
      }),
    },
  },
});

export const todosReplicationState = replicateRxCollection({
  collection: db.todos,
  replicationIdentifier: "todos-replication",
  deletedField: "removed",
  pull: {
    batchSize: 50,
    modifier: (doc) => {
      const d = doc as { deleted?: boolean; removed?: boolean };
      return { ...d, removed: d.deleted ?? d.removed ?? false, deleted: undefined };
    },
    handler: async (checkpoint, batchSize) => {
      const result = await client.pub__todosPull({
        checkpoint:
          checkpoint && typeof checkpoint === "object" && "id" in checkpoint
            ? { id: (checkpoint as { id: string; updatedAt: number }).id, updatedAt: (checkpoint as { id: string; updatedAt: number }).updatedAt }
            : undefined,
        limit: batchSize,
      });
      return {
        documents: result.documents,
        checkpoint: (result.checkpoint ?? checkpoint ?? null) as { id: string; updatedAt: number } | null,
      };
    },
  },
  push: {
    batchSize: 10,
    handler: async (rows) => {
      const docs = rows.map((row) => {
        const d = row.newDocumentState as { id: string; text: string; completed: boolean; removed?: boolean; updatedAt: number };
        return {
          assumedMasterState: row.assumedMasterState,
          newDocumentState: {
            id: d.id,
            text: d.text,
            completed: d.completed,
            deleted: d.removed ?? false,
            updatedAt: d.updatedAt,
          },
        };
      });
      const conflicts = await client.pub__todosPush({ docs });
      return conflicts.map((c) => {
        const doc = c as { id: string; text: string; completed: boolean; deleted: boolean; updatedAt: number };
        return {
          id: doc.id,
          text: doc.text,
          completed: doc.completed,
          removed: doc.deleted,
          updatedAt: doc.updatedAt,
        };
      });
    },
  },
});

export const todosCollection = createCollection(
  rxdbCollectionOptions({
    rxCollection: db.todos,
    startSync: true, // start ingesting RxDB data immediately,
  }),
);

/**
 * Hook to observe todos replication state. Use for sync status indicators.
 */
export function useTodosReplicationState() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const subActive = todosReplicationState.active$.subscribe(setActive);
    const subError = todosReplicationState.error$.subscribe((e) =>
      setError(e?.parameters?.errors?.[0] ?? e),
    );
    return () => {
      subActive.unsubscribe();
      subError.unsubscribe();
    };
  }, []);

  return { active, error, replicationState: todosReplicationState };
}

/** Patch a todo in RxDB — TanStack sync will pick up the change via rxCollection.$ */
export async function patchTodo(
  id: string,
  patch: { completed?: boolean; removed?: boolean },
): Promise<void> {
  const doc = await db.todos.findOne(id).exec();
  if (doc) await doc.incrementalPatch({ ...patch, updatedAt: Date.now() });
}

/** Reactive todo list via TanStack DB (RxDB + TanStack DB) */
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
