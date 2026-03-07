import type { RouterClient } from "@orpc/server";

import { db, user } from "@offline-first-backend-sync/db";
import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../index";
import { eq } from "drizzle-orm";

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
  powersyncGet: protectedProcedure.handler(async () => {
    // No PowerSync here, as this is the server side
    return db.select().from(user);
  }),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
