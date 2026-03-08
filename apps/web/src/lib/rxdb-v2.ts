import * as SQLite from "wa-sqlite";
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
import { useEffect, useState } from "react";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { replicateRxCollection } from "rxdb/plugins/replication";
addRxPlugin(RxDBDevModePlugin);

const isTauri = window && "__TAURI_INTERNALS__" in window;
const DB_NAME = "my-todos-v5";
const SCHEMA_VERSION = 3;

function previewSql(query: string) {
  return query.replace(/\s+/g, " ").trim();
}

function wrapSqliteBasicsWithLogging<
  T extends {
    open: (...args: any[]) => Promise<any>;
    run: (...args: any[]) => Promise<any>;
    all: (...args: any[]) => Promise<any>;
  },
>(label: string, basics: T): T {
  return {
    ...basics,
    async open(...args: Parameters<T["open"]>) {
      console.info(`[RxDB SQLite:${label}] open`, { name: args[0] });
      return await basics.open(...args);
    },
    async run(...args: Parameters<T["run"]>) {
      const queryWithParams = args[1] as {
        query: string;
        params: unknown[];
        context?: unknown;
      };
      console.info(`[RxDB SQLite:${label}] run`, {
        query: previewSql(queryWithParams.query),
        params: queryWithParams.params,
        context: queryWithParams.context,
      });
      try {
        return await basics.run(...args);
      } catch (error) {
        console.error(`[RxDB SQLite:${label}] run failed`, {
          query: previewSql(queryWithParams.query),
          params: queryWithParams.params,
          context: queryWithParams.context,
          error,
        });
        throw error;
      }
    },
    async all(...args: Parameters<T["all"]>) {
      const queryWithParams = args[1] as {
        query: string;
        params: unknown[];
        context?: unknown;
      };
      console.info(`[RxDB SQLite:${label}] all`, {
        query: previewSql(queryWithParams.query),
        params: queryWithParams.params,
        context: queryWithParams.context,
      });
      try {
        return await basics.all(...args);
      } catch (error) {
        console.error(`[RxDB SQLite:${label}] all failed`, {
          query: previewSql(queryWithParams.query),
          params: queryWithParams.params,
          context: queryWithParams.context,
          error,
        });
        throw error;
      }
    },
  };
}

async function getSQLiteBasicsForCurrentRuntime() {
  if (isTauri) {
    const sqlite3Tauri = (await import("@tauri-apps/plugin-sql")).default;
    return getSQLiteBasicsTauri(sqlite3Tauri);
    // return wrapSqliteBasicsWithLogging("tauri", getSQLiteBasicsTauri(sqlite3Tauri));
  }

  const SQLiteESMFactory = (await import("wa-sqlite/dist/wa-sqlite-async.mjs")).default;
  const sqliteModule = await SQLiteESMFactory();
  const sqlite3 = SQLite.Factory(sqliteModule);
  return getSQLiteBasicsWasm(sqlite3);
  // return wrapSqliteBasicsWithLogging("wasm", getSQLiteBasicsWasm(sqlite3));
}

async function initTodosV2() {
  const db = await createRxDatabase({
    name: DB_NAME,
    storage: wrappedValidateAjvStorage({
      storage: getRxStorageSQLiteTrial({
        sqliteBasics: await getSQLiteBasicsForCurrentRuntime(),
        log: console.log.bind(console),
      }),
    }),
  });

  await db.addCollections({
    todos: {
      schema: {
        title: "todos",
        version: SCHEMA_VERSION,
        type: "object",
        primaryKey: "id",
        properties: {
          id: { type: "string", maxLength: 100 },
          text: { type: "string" },
          completed: { type: "boolean" },
          updatedAt: { type: "number" },
          removed: { type: "boolean", default: false },
          flapFap: { type: "boolean" },
        },
        required: ["id", "text", "completed", "updatedAt", "flapFap"],
      },
      migrationStrategies: {
        1: (oldDoc) => ({
          ...oldDoc,
          updatedAt: (oldDoc as { updatedAt?: number }).updatedAt ?? Date.now(),
          removed:
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean }).removed ??
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean }).deleted ??
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean })._deleted ??
            false,
          flapFap: (oldDoc as { flapFap?: boolean }).flapFap ?? true,
        }),
        2: (oldDoc) => ({
          ...oldDoc,
          updatedAt: (oldDoc as { updatedAt?: number }).updatedAt ?? Date.now(),
          removed:
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean }).removed ??
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean }).deleted ??
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean })._deleted ??
            false,
          flapFap: (oldDoc as { flapFap?: boolean }).flapFap ?? true,
        }),
        3: (oldDoc) => ({
          ...oldDoc,
          updatedAt: (oldDoc as { updatedAt?: number }).updatedAt ?? Date.now(),
          removed:
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean }).removed ??
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean }).deleted ??
            (oldDoc as { removed?: boolean; deleted?: boolean; _deleted?: boolean })._deleted ??
            false,
          flapFap: (oldDoc as { flapFap?: boolean }).flapFap ?? true,
        }),
      },
    },
  });

  const todosV2ReplicationState = replicateRxCollection({
    collection: db.todos,
    replicationIdentifier: "todos-replication-v2",
    deletedField: "removed",
    push: {
      batchSize: 10,
      handler: async (rows) => {
        const docs = rows.map((row) => {
          const d = row.newDocumentState as {
            id: string;
            text: string;
            completed: boolean;
            removed?: boolean;
            _deleted?: boolean;
            deleted?: boolean;
            updatedAt: number;
            flapFap?: boolean;
          };
          const deleted = d._deleted === true || d.removed === true || d.deleted === true;
          return {
            assumedMasterState: row.assumedMasterState,
            newDocumentState: {
              id: d.id,
              text: d.text,
              completed: d.completed,
              deleted,
              updatedAt: d.updatedAt,
              flapFap: d.flapFap ?? true,
            },
          };
        });
        const conflicts = await client.pub__todosV2Push({ docs });
        return conflicts.map((c) => {
          const doc = c as {
            id: string;
            text: string;
            completed: boolean;
            deleted: boolean;
            removed: boolean;
            updatedAt: number;
            flapFap?: boolean;
          };
          return {
            id: doc.id,
            text: doc.text,
            completed: doc.completed,
            removed: doc.deleted ?? doc.removed ?? false,
            updatedAt: doc.updatedAt,
            flapFap: doc.flapFap ?? true,
          };
        });
      },
    },
    pull: {
      batchSize: 50,
      modifier: (doc) => {
        const d = doc as { deleted?: boolean; removed?: boolean };
        const { deleted, ...rest } = d;
        return { ...rest, removed: deleted ?? d.removed ?? false };
      },
      handler: async (checkpoint, batchSize) => {
        try {
          const result = await client.pub__todosV2Pull({
            checkpoint: checkpoint as { id: string; updatedAt: number } | null,
            limit: batchSize,
          });
          return { documents: result.documents, checkpoint: result.checkpoint };
        } catch (error) {
          console.error("Error pulling todos v2", error);
          throw error;
        }
      },
    },
  });

  const todosV2Collection = createCollection(
    rxdbCollectionOptions({
      rxCollection: db.todos,
      startSync: true, // start ingesting RxDB data immediately
    }),
  );

  return { db, todosV2Collection, todosV2ReplicationState };
}

type TodosV2Context = Awaited<ReturnType<typeof initTodosV2>>;

declare global {
  var __todosV2ContextPromise: Promise<TodosV2Context> | undefined;
}

function getTodosV2Context() {
  globalThis.__todosV2ContextPromise ??= initTodosV2();
  return globalThis.__todosV2ContextPromise;
}

const { db, todosV2Collection, todosV2ReplicationState } = await getTodosV2Context();

export { db, todosV2Collection, todosV2ReplicationState };

export function useAllTodosV2Query() {
  return useLiveQuery((q) =>
    q.from({ todo: todosV2Collection }).select(({ todo }) => ({
      id: todo.id,
      text: todo.text,
      completed: todo.completed,
      updatedAt: todo.updatedAt,
      removed: todo.removed,
      flapFap: todo.flapFap,
    })),
  );
}

export function useV2ReplicationState() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const subActive = todosV2ReplicationState.active$.subscribe(setActive);
    const subError = todosV2ReplicationState.error$.subscribe((e) =>
      setError(e?.parameters?.errors?.[0] ?? e),
    );
    return () => {
      subActive.unsubscribe();
      subError.unsubscribe();
    };
  }, []);

  return { active, error, replicationState: todosV2ReplicationState };
}
