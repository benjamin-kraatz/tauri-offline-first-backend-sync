import {
  createReplicatedRxCollectionModule,
  useReplicationState,
} from "@offline-first-backend-sync/rxdb-sync";
import { useLiveQuery } from "@tanstack/react-db";
import {
  getRxStorageSQLiteTrial,
  getSQLiteBasicsTauri,
  getSQLiteBasicsWasm,
} from "rxdb/plugins/storage-sqlite";
import * as SQLite from "wa-sqlite";

import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";

import { createTodosV2RemoteApprovalPolicy } from "@/lib/rxdb-v2-remote-approval";
import { client } from "@/utils/orpc";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DB_NAME = "my-todos-v8";
const SCHEMA_VERSION = 3;
const CROSS_DEVICE_RESYNC_INTERVAL_MS = 15_000;
const ENABLE_TODOS_V2_REMOTE_APPROVAL = false;

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
  }

  const SQLiteESMFactory = (await import("wa-sqlite/dist/wa-sqlite-async.mjs")).default;
  const sqliteModule = await SQLiteESMFactory();
  const sqlite3 = SQLite.Factory(sqliteModule);
  return getSQLiteBasicsWasm(sqlite3);
}

const todosV2Module = createReplicatedRxCollectionModule<TodoV2Doc, TodoV2Checkpoint, "todos">({
  databaseName: DB_NAME,
  async createStorage() {
    return wrappedValidateAjvStorage({
      storage: getRxStorageSQLiteTrial({
        sqliteBasics: await getSQLiteBasicsForCurrentRuntime(),
        log: console.log.bind(console),
      }),
    });
  },
  collectionName: "todos",
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
          const nextDoc = row.newDocumentState as TodoV2Doc;
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
        return conflicts.map((conflict) =>
          normalizePulledTodoV2(conflict as TodoV2Doc & { _deleted?: boolean }),
        );
      },
    },
    pull: {
      batchSize: 50,
      modifier: (doc) => normalizePulledTodoV2(doc as TodoV2Doc & { _deleted?: boolean }),
      handler: async (checkpoint, batchSize) => {
        try {
          const result = await client.pub__todosV2Pull({
            checkpoint: (checkpoint ?? null) as TodoV2Checkpoint,
            limit: batchSize,
          });

          return {
            documents: result.documents.map((doc) =>
              normalizePulledTodoV2(doc as TodoV2Doc & { _deleted?: boolean }),
            ),
            checkpoint: (result.checkpoint ?? checkpoint ?? null) as TodoV2Checkpoint,
          };
        } catch (error) {
          console.error("Error pulling todos v2", error);
          throw error;
        }
      },
    },
  },
  browserPolicy: createTodosV2RemoteApprovalPolicy({
    enabled: ENABLE_TODOS_V2_REMOTE_APPROVAL,
    probeIntervalMs: CROSS_DEVICE_RESYNC_INTERVAL_MS,
  }),
});

const {
  db,
  collection: todosV2Collection,
  rxCollection: todosV2RxCollection,
  replicationState: todosV2ReplicationState,
} = await todosV2Module.getContext();

export { db, todosV2Collection, todosV2ReplicationState };

export async function addTodoV2(text: string) {
  const nextText = text.trim();
  if (!nextText) return;

  await todosV2RxCollection.insert({
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
  const doc = await todosV2RxCollection.findOne(id).exec();
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
  return useReplicationState(todosV2ReplicationState);
}
