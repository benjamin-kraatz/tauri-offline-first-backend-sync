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
      console.error("[TDB] Error deserializing user: ", error);
    },
  }),
);
