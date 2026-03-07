import { client } from "@/utils/orpc";
import {
  AbstractPowerSyncDatabase,
  column,
  PowerSyncDatabase,
  Schema,
  Table,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from "@powersync/web";
import { useEffect, useState } from "react";
import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.string().nullable(),
  image: z.string().nullable(),
  createdAt: z
    .string()
    .nullable()
    .optional()
    .transform((val) => (val ? new Date(val) : null)), // Transform SQLite TEXT to Date
  updatedAt: z
    .string()
    .nullable()
    .optional()
    .transform((val) => (val ? new Date(val) : null)), // Transform SQLite TEXT to Date
});

export const AppSchema = new Schema({
  user: new Table(
    {
      id: column.text,
      name: column.text,
      email: column.text,
      emailVerified: column.text,
      image: column.text,
      createdAt: column.text,
      updatedAt: column.text,
    },
    {
      indexes: { email: ["email"] },
    },
  ),
});

export type Database = (typeof AppSchema)["types"];
export type User = Database["user"];

const psdb = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    dbFilename: "powersync.db",
  },
});

export class PowerSyncConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials> {
    return {
      endpoint: import.meta.env.VITE_POWERSYNC_ENDPOINT,
      token: import.meta.env.VITE_POWERSYNC_DEVELOPMENT_TOKEN,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    for (const op of transaction.crud) {
      const opData = op.opData as User;
      const record = { ...opData, id: op.id };

      await client.pub__powersyncInsert({
        name: record.name,
        email: record.email,
        emailVerified: record.emailVerified === "1" || record.emailVerified === "t" ? 1 : 0,
        image: record.image,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    await transaction.complete();
  }
}

let connectPromise: Promise<void> | null = null;

// connect the database to PowerSync Service (idempotent)
export const connect = async () => {
  if (!connectPromise) {
    connectPromise = psdb.connect(new PowerSyncConnector());
  }
  await connectPromise;
  return psdb;
};

// --- Read ---

/** One-off read: resolves after first sync */
export const getUsers = async (): Promise<User[]> => {
  const db = await connect();
  await db.waitForFirstSync();
  return db.getAll<User>("SELECT * FROM user");
};

/** Reactive live query hook — re-renders whenever the `user` table changes */
export const useUsers = (): { data: User[]; loading: boolean } => {
  const [data, setData] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    const run = async () => {
      const db = await connect();
      await db.waitForFirstSync();

      const stream = db.watch("SELECT * FROM user ORDER BY name ASC", [], {
        signal: abort.signal,
      });

      for await (const result of stream) {
        if (cancelled) break;
        setData((result.rows?._array as User[]) ?? []);
        setLoading(false);
      }
    };

    run().catch(console.error);

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, []);

  return { data, loading };
};

// --- Write ---

/** Insert a new user row locally (syncs to backend via uploadData) */
export const insertUser = async (user: Omit<User, "id">) => {
  const db = await connect();
  await db.execute(
    `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
     VALUES (uuid(), ?, ?, ?, ?, ?, ?)`,
    [
      user.name,
      user.email,
      user.emailVerified ?? 0,
      user.image ?? null,
      user.createdAt ?? new Date().toISOString(),
      user.updatedAt ?? new Date().toISOString(),
    ],
  );
};

/** Update an existing user row */
export const updateUser = async (id: string, fields: Partial<Omit<User, "id">>) => {
  const db = await connect();
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const setClauses = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  await db.execute(`UPDATE user SET ${setClauses} WHERE id = ?`, [...values, id]);
};

/** Delete a user row */
export const deleteUser = async (id: string) => {
  const db = await connect();
  await db.execute("DELETE FROM user WHERE id = ?", [id]);
};
