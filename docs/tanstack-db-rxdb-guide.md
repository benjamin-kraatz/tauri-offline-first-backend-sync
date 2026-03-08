# TanStack DB + RxDB: Start Here

This guide is the entry point for the TanStack DB + RxDB docs in this repository. It is meant to give you the mental model first, then point you to the deeper guides depending on what you are trying to do.

The short version is this:

RxDB is the local database and sync engine.

TanStack DB is the application-facing reactive query and mutation layer.

When you pair them, RxDB is responsible for durable client-side storage, schema validation, replication, and conflict-aware syncing with a backend. TanStack DB is responsible for turning that local data into something your React app can read and derive from comfortably.

That distinction matters. People get confused when they expect both libraries to solve the same problem. They do not. They complement each other.

If you like thinking in terms of layers, the stack looks like this:

Your backend stores the remote state.

RxDB replicates that state into a local client database and keeps it synchronized over time.

TanStack DB sits on top of the RxDB collection and gives your UI a stable query surface through `createCollection(...)` and `useLiveQuery(...)`.

Your components read through TanStack DB and write through either TanStack DB or small RxDB helpers, depending on which write path is the best fit for the operation.

In this repository, the concrete demo lives in:

- `apps/web/src/lib/rxdb.ts`
- `apps/web/src/routes/rxdb-playground.tsx`
- `packages/api/src/routers/index.ts`

Those files are references, not prescriptions. The docs are intentionally more general than this particular app.

## How To Read The Rest

If you are building your first setup, continue with [docs/tanstack-db-rxdb-setup.md](./tanstack-db-rxdb-setup.md). That document walks through package selection, schema design, creating the local database, adding a collection, enabling migrations, and wrapping the result with TanStack DB.

If your next question is “how do I actually build screens with this?”, go to [docs/tanstack-db-rxdb-crud-and-ui.md](./tanstack-db-rxdb-crud-and-ui.md). That guide covers reads, live queries, inserts, updates, deletes, soft deletes, status indicators, and the trade-offs between mutating through TanStack DB and mutating through RxDB directly.

If your next question is “how do I connect this to my existing backend?”, read [docs/tanstack-db-rxdb-replication-and-backend.md](./tanstack-db-rxdb-replication-and-backend.md). That guide explains checkpoints, pull handlers, push handlers, conflict documents, field mapping, backend endpoint design, and version consistency.

If your next question is “what happens when the schema changes or things start breaking?”, read [docs/tanstack-db-rxdb-migrations-and-troubleshooting.md](./tanstack-db-rxdb-migrations-and-troubleshooting.md). That guide covers migrations, versioned database names, reserved field names, common error classes, and the kinds of bugs you are likely to see during early adoption.

## A Good Way To Think About The Pairing

TanStack DB is best thought of as the “how my app reads local state” layer.

RxDB is best thought of as the “where the local state lives and how it syncs” layer.

That framing makes architectural decisions easier.

If a concern is about schema shape, persistence, storage adapters, replication, checkpoints, or conflicts, it probably belongs in the RxDB layer.

If a concern is about shaping data for the UI, deriving views, reacting to local updates, or keeping React components simple, it probably belongs in the TanStack DB layer.

If a concern is about deciding whether a client write is acceptable, ordering documents during pull, or returning conflicts for stale writes, it probably belongs in the backend replication contract.

## What This Repository Demonstrates

The current implementation shows a practical but intentionally small example:

- RxDB is backed by browser local storage.
- The collection schema includes `id`, `text`, `completed`, `updatedAt`, and `removed`.
- Replication is custom and is wired to backend procedures, not to a built-in RxDB server.
- Backend pull returns documents and checkpoints ordered by `updatedAt` and `id`.
- Backend push compares the client’s assumed master state with the current stored version and returns conflicts when they diverge.
- The frontend wraps the RxDB collection with `rxdbCollectionOptions(...)`.
- The UI reads through `useLiveQuery(...)`.

That is enough to demonstrate the stack without tying the docs too tightly to this one app.

## Recommended Reading Order

If you want the best onboarding flow, read the docs in this order:

1. [docs/tanstack-db-rxdb-guide.md](./tanstack-db-rxdb-guide.md)
2. [docs/tanstack-db-rxdb-setup.md](./tanstack-db-rxdb-setup.md)
3. [docs/tanstack-db-rxdb-crud-and-ui.md](./tanstack-db-rxdb-crud-and-ui.md)
4. [docs/tanstack-db-rxdb-replication-and-backend.md](./tanstack-db-rxdb-replication-and-backend.md)
5. [docs/tanstack-db-rxdb-migrations-and-troubleshooting.md](./tanstack-db-rxdb-migrations-and-troubleshooting.md)
That order mirrors how you would usually build the system:

You start with a mental model.

Then you create the local database.

Then you make the UI useful.

Then you wire replication to the backend.

Then you harden the design against real-world changes and failures.
