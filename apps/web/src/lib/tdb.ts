import { powerSyncCollectionOptions } from "@tanstack/powersync-db-collection";
import { createCollection, useLiveQuery } from "@tanstack/react-db";
import { AppSchema, connect, userSchema } from "./psync";

const db = await connect();
export const usersCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: AppSchema.props.user,
    schema: userSchema,
    onDeserializationError: (error) => {
      console.error("[TDB] Error deserializing user: ", error);
    },
  }),
);

export function useAllUsersQuery() {
  return useLiveQuery((q) => {
    return q.from({ user: usersCollection }).select(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.email_verified,
    }));
  });
}

export function useVerifiedUsersQuery() {
  const { data: allUsers } = useAllUsersQuery();
  return { data: allUsers?.filter((user) => user.emailVerified === 1)};
}

export function useUnverifiedUsersQuery() {
  const { data: allUsers } = useAllUsersQuery();
  return { data: allUsers?.filter((user) => user.emailVerified === 0) };
}
