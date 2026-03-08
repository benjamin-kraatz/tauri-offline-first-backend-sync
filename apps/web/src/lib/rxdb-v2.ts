import { createCollection, useLiveQuery } from "@tanstack/react-db";
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection";
import { addRxPlugin, createRxDatabase } from "rxdb/plugins/core";
import {
  getRxStorageSQLiteTrial,
  getSQLiteBasicsTauri,
  getSQLiteBasicsWasm,
} from "rxdb/plugins/storage-sqlite";
import * as SQLite from "wa-sqlite";

// add json-schema validation (optional)
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";

// Enable dev mode (optional, recommended during development)
import { client } from "@/utils/orpc";
import { useEffect, useState } from "react";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { replicateRxCollection } from "rxdb/plugins/replication";
addRxPlugin(RxDBDevModePlugin);

const isTauri = window && "__TAURI_INTERNALS__" in window;
const DB_NAME = "my-todos-v8";
const SCHEMA_VERSION = 3;
const CROSS_DEVICE_RESYNC_INTERVAL_MS = 15_000;

type TodoV2Doc = {
  id: string;
  text: string;
  completed: boolean;
  updatedAt: number;
  removed?: boolean;
  flapFap?: boolean;
};

type TodoV2Checkpoint = { id: string; updatedAt: number } | null;

function normalizeTodoV2(doc: TodoV2Doc) {
  return {
    id: doc.id,
    text: doc.text,
    completed: doc.completed,
    removed: doc.removed ?? false,
    updatedAt: doc.updatedAt,
    flapFap: doc.flapFap ?? true,
  };
}

function normalizePulledTodoV2(doc: TodoV2Doc & { _deleted?: boolean }) {
  return {
    ...normalizeTodoV2(doc),
    _deleted: doc._deleted ?? false,
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
    live: true,
    retryTime: 5_000,
    autoStart: true,
    toggleOnDocumentVisible: true,
    push: {
      batchSize: 10,
      handler: async (rows) => {
        const docs = rows.map((row) => {
          const d = row.newDocumentState as TodoV2Doc;
          return {
            assumedMasterState: row.assumedMasterState,
            newDocumentState: {
              id: d.id,
              text: d.text,
              completed: d.completed,
              removed: d.removed ?? false,
              updatedAt: d.updatedAt,
              flapFap: d.flapFap ?? true,
            },
          };
        });
        const conflicts = await client.pub__todosV2Push({ docs });
        return conflicts.map((c) => normalizeTodoV2(c as TodoV2Doc));
      },
    },
    pull: {
      batchSize: 50,
      modifier: (doc) => normalizePulledTodoV2(doc as TodoV2Doc & { _deleted?: boolean }),
      handler: async (checkpoint, batchSize) => {
        try {
          const result = await client.pub__todosV2Pull({
            checkpoint: checkpoint as TodoV2Checkpoint,
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

  startTodosV2CrossDeviceSync(todosV2ReplicationState);

  const todosV2Collection = createCollection(
    rxdbCollectionOptions({
      rxCollection: db.todos,
      startSync: true, // start ingesting RxDB data immediately
    }),
  );

  return { db, todosV2Collection, todosV2ReplicationState };
}

function startTodosV2CrossDeviceSync(replicationState: { reSync: () => void }) {
  const reSync = () => {
    if (document.visibilityState === "visible") {
      replicationState.reSync();
    }
  };

  window.setInterval(reSync, CROSS_DEVICE_RESYNC_INTERVAL_MS);
  const onOnline = () => replicationState.reSync();
  const onFocus = () => replicationState.reSync();
  const onVisibilityChange = () => reSync();

  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);
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

export async function addTodoV2(text: string) {
  const nextText = text.trim();
  if (!nextText) return;

  await db.todos.insert({
    id: crypto.randomUUID(),
    text: nextText,
    completed: false,
    updatedAt: Date.now(),
    removed: false,
    flapFap: true,
  });
}

export async function patchTodoV2(
  id: string,
  patch: { text?: string; completed?: boolean; removed?: boolean },
) {
  const doc = await db.todos.findOne(id).exec();
  if (!doc) return;

  await doc.incrementalPatch({
    ...patch,
    updatedAt: Date.now(),
  });
}

export async function removeTodoV2(id: string) {
  await patchTodoV2(id, { removed: true });
}

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
