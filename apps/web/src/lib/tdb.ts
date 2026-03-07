import { powerSyncCollectionOptions } from "@tanstack/powersync-db-collection";
import { createCollection } from "@tanstack/react-db";
import { AppSchema, connect, userSchema } from "./psync";

const db = await connect();
export const usersCollection = createCollection(
  powerSyncCollectionOptions({
    database: db,
    table: AppSchema.props.user,
    schema: userSchema,
    onDeserializationError: (error) => {
      // Present fatal error
      console.error("[TDB] Error deserializing user: ", error);
    },
    // Optional: custom column serialization
    serializer: {
      // Dates are serialized by default, this is just an example
      createdAt: (value) => (value ? value.toISOString() : null),
      updatedAt: (value) => (value ? value.toISOString() : null),
    },
  }),
);

export type UserCollectionInput = typeof userSchema;
export type UserCollectionOutput = UserCollectionInput;
