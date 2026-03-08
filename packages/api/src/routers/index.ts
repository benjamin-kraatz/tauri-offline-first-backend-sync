import type { RouterClient } from "@orpc/server";

import { db, todo, user } from "@offline-first-backend-sync/db";
import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../index";
import { and, eq, gt, or } from "drizzle-orm";

export const userUpsertSchema = z.object({
  // ID is always required
  id: z.string(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  emailVerified: z.union([z.boolean(), z.number()]).nullish(),
  image: z.string().nullish(),
  createdAt: z
    .string()
    .nullish()
    .transform((val) => (val ? new Date(val) : null)), // Transform SQLite TEXT to Date
  updatedAt: z
    .string()
    .nullish()
    .transform((val) => (val ? new Date(val) : null)), // Transform SQLite TEXT to Date
});

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  pub__powersyncGet: publicProcedure.handler(async () => {
    // No PowerSync here, as this is the server side
    const users = await db.select().from(user);
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified ? 1 : 0,
      image: u.image,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }));
  }),
  pub__powersyncUpsert: publicProcedure.input(userUpsertSchema).handler(async ({ input }) => {
    const now = new Date();
    const validDate = (d: Date | null | undefined) =>
      d instanceof Date && !Number.isNaN(d.getTime()) ? d : now;
    const insertValues = {
      id: input.id,
      name: input.name ?? "",
      email: input.email ?? "",
      emailVerified: input.emailVerified === 1 || input.emailVerified === true,
      image: input.image ?? null,
      createdAt: validDate(input.createdAt),
      updatedAt: validDate(input.updatedAt),
    };
    const conflictSet: Record<string, unknown> = { updatedAt: now };
    if (input.name != null && input.name !== "") conflictSet.name = input.name;
    if (input.email != null && input.email !== "") conflictSet.email = input.email;
    if (input.emailVerified !== undefined)
      conflictSet.emailVerified = input.emailVerified === 1 || input.emailVerified === true;
    if (input.image !== undefined) conflictSet.image = input.image;
    // createdAt is immutable — never overwrite on conflict

    return db
      .insert(user)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [user.id],
        set: conflictSet as typeof insertValues,
      })
      .returning();
  }),
  pub__powersyncDelete: publicProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input }) => {
      return db.delete(user).where(eq(user.id, input.id)).returning();
    }),

  /** RxDB replication pull: fetch todos after checkpoint, ordered by updatedAt, id */
  pub__todosPull: publicProcedure
    .input(
      z.object({
        checkpoint: z.object({ id: z.string(), updatedAt: z.number() }).nullish(),
        limit: z.number().default(50),
      }),
    )
    .handler(async ({ input }) => {
      const cp = input.checkpoint;
      const rows = await db
        .select()
        .from(todo)
        .where(
          cp
            ? or(
                gt(todo.updatedAt, new Date(cp.updatedAt)),
                and(eq(todo.updatedAt, new Date(cp.updatedAt)), gt(todo.id, cp.id)),
              )
            : undefined,
        )
        .orderBy(todo.updatedAt, todo.id)
        .limit(input.limit);

      const documents = rows.map((r) => ({
        id: r.id,
        text: r.text,
        completed: r.completed,
        deleted: r.deleted,
        updatedAt: r.updatedAt.getTime(),
      }));

      const last = documents.at(-1);
      const checkpoint = last != null ? { id: last.id, updatedAt: last.updatedAt } : (cp ?? null);

      return { documents, checkpoint };
    }),

  pub__todosV2Pull: publicProcedure
    .input(
      z.object({
        checkpoint: z.object({ id: z.string(), updatedAt: z.number() }).nullish(),
        limit: z.number().default(50),
      }),
    )
    .handler(async ({ input }) => {
      const cp = input.checkpoint;
      const rows = await db
        .select()
        .from(todo)
        .where(
          cp
            ? or(
                gt(todo.updatedAt, new Date(cp.updatedAt)),
                and(eq(todo.updatedAt, new Date(cp.updatedAt)), gt(todo.id, cp.id)),
              )
            : undefined,
        )
        .orderBy(todo.updatedAt, todo.id)
        .limit(input.limit);

      const documents = rows.map((r) => ({
        id: r.id,
        text: r.text,
        completed: r.completed,
        removed: r.deleted,
        updatedAt: r.updatedAt.getTime(),
        flapFap: true,
      }));

      const last = documents.at(-1);
      const checkpoint = last != null ? { id: last.id, updatedAt: last.updatedAt } : (cp ?? null);

      return { documents, checkpoint };
    }),
  pub__todosV2Push: publicProcedure
    .input(
      z.object({
        docs: z.array(
          z.object({
            assumedMasterState: z.record(z.string(), z.unknown()).nullish(),
            newDocumentState: z.object({
              id: z.string(),
              text: z.string(),
              completed: z.boolean(),
              removed: z.boolean(),
              updatedAt: z.number(),
              flapFap: z.boolean().default(true),
            }),
          }),
        ),
      }),
    )
    .handler(async ({ input }) => {
      const conflicts: Record<string, unknown>[] = [];

      const stamps = [
        // "📮 PUSH RECEIVED ✨",
        // "🔄 SYNC IN PROGRESS...",
        // "📥 todos inbound!",
        // "🚀 Replicating to the mothership",
        // "🚨 ACHTUNG! 🚨",
        // `💌 ${input.docs.length} todos inbound!`,
        `👍🏼 Actually: ${JSON.stringify(input.docs)}`,
      ];
      const color = (n: number) => `\x1b[3${n}m`;
      const reset = "\x1b[0m";
      const stamp = stamps[Math.floor(Math.random() * stamps.length)] ?? "📮 PUSH RECEIVED ✨";
      const line = "─".repeat(stamp.length + 4);
      console.log(
        `\n${color(6)}  ╭${line}╮${reset}\n${color(5)}  │  ${stamp}  │${reset}\n${color(6)}  ╰${line}╯${reset}  pub__todosPush hit @ ${new Date().toISOString()}\n`,
      );

      for (const { assumedMasterState, newDocumentState } of input.docs) {
        const existing = await db
          .select()
          .from(todo)
          .where(eq(todo.id, newDocumentState.id))
          .limit(1);

        const masterUpdatedAt =
          assumedMasterState?.updatedAt != null ? Number(assumedMasterState.updatedAt) : null;
        const actualUpdatedAt = existing[0]?.updatedAt?.getTime() ?? null;

        if (masterUpdatedAt !== actualUpdatedAt && existing.length > 0) {
          conflicts.push({
            id: existing[0]!.id,
            text: existing[0]!.text,
            completed: existing[0]!.completed,
            removed: existing[0]!.deleted,
            updatedAt: existing[0]!.updatedAt.getTime(),
            flapFap: true,
          });
          continue;
        }

        const row = {
          id: newDocumentState.id,
          text: newDocumentState.text,
          completed: newDocumentState.completed,
          deleted: newDocumentState.removed,
          updatedAt: new Date(newDocumentState.updatedAt),
        };

        if (newDocumentState.removed) {
          if (existing.length === 0) {
            await db.insert(todo).values(row);
          } else {
            await db.update(todo).set(row).where(eq(todo.id, newDocumentState.id));
          }
        } else if (existing.length === 0) {
          await db.insert(todo).values(row);
        } else {
          await db.update(todo).set(row).where(eq(todo.id, newDocumentState.id));
        }
      }

      return conflicts;
    }),

  /** RxDB replication push: apply client writes, return conflicts */
  pub__todosPush: publicProcedure
    .input(
      z.object({
        docs: z.array(
          z.object({
            assumedMasterState: z.record(z.string(), z.unknown()).nullish(),
            newDocumentState: z.object({
              id: z.string(),
              text: z.string(),
              completed: z.boolean(),
              deleted: z.boolean(),
              updatedAt: z.number(),
            }),
          }),
        ),
      }),
    )
    .handler(async ({ input }) => {
      const conflicts: Record<string, unknown>[] = [];

      for (const { assumedMasterState, newDocumentState } of input.docs) {
        const existing = await db
          .select()
          .from(todo)
          .where(eq(todo.id, newDocumentState.id))
          .limit(1);

        const masterUpdatedAt =
          assumedMasterState?.updatedAt != null ? Number(assumedMasterState.updatedAt) : null;
        const actualUpdatedAt = existing[0]?.updatedAt?.getTime() ?? null;

        if (masterUpdatedAt !== actualUpdatedAt && existing.length > 0) {
          conflicts.push({
            id: existing[0]!.id,
            text: existing[0]!.text,
            completed: existing[0]!.completed,
            deleted: existing[0]!.deleted,
            updatedAt: existing[0]!.updatedAt.getTime(),
          });
          continue;
        }

        const row = {
          id: newDocumentState.id,
          text: newDocumentState.text,
          completed: newDocumentState.completed,
          deleted: newDocumentState.deleted,
          updatedAt: new Date(newDocumentState.updatedAt),
        };

        if (newDocumentState.deleted) {
          await db.delete(todo).where(eq(todo.id, newDocumentState.id));
        } else if (existing.length === 0) {
          await db.insert(todo).values(row);
        } else {
          await db.update(todo).set(row).where(eq(todo.id, newDocumentState.id));
        }
      }

      return conflicts;
    }),

  powersyncGet: protectedProcedure.handler(async () => {
    // No PowerSync here, as this is the server side
    return db.select().from(user);
  }),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
