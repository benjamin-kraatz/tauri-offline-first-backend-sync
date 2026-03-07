import type { RouterClient } from "@orpc/server";

import { db, user } from "@offline-first-backend-sync/db";
import { protectedProcedure, publicProcedure } from "../index";
import { z } from "zod";

export const userSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.union([z.boolean(), z.number()]).nullable(),
  image: z.string().nullish(),
  createdAt: z
    .string()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)), // Transform SQLite TEXT to Date
  updatedAt: z
    .string()
    .nullable()
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
  pub__powersyncInsert: publicProcedure.input(userSchema).handler(async ({ input }) => {
    return db.insert(user).values({
      id: crypto.randomUUID(),
      name: input.name ?? "",
      email: input.email ?? "",
      emailVerified: input.emailVerified === 1 || input.emailVerified === true,
      image: input.image ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }),
  powersyncGet: protectedProcedure.handler(async () => {
    // No PowerSync here, as this is the server side
    return db.select().from(user);
  }),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
