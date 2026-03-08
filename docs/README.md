# Docs

This docs collection shows how to use and integrate TanStack DB + RxDB into your application.

If you are starting from zero, read these in order:

1. [docs/tanstack-db-rxdb-guide.md](./tanstack-db-rxdb-guide.md)
2. [docs/tanstack-db-rxdb-setup.md](./tanstack-db-rxdb-setup.md)
3. [docs/tanstack-db-rxdb-crud-and-ui.md](./tanstack-db-rxdb-crud-and-ui.md)
4. [docs/tanstack-db-rxdb-replication-and-backend.md](./tanstack-db-rxdb-replication-and-backend.md)
5. [docs/tanstack-db-rxdb-migrations-and-troubleshooting.md](./tanstack-db-rxdb-migrations-and-troubleshooting.md)

The documents are intentionally broader than this application. The current repository is used as a demo reference, not as the only valid architecture.

The most relevant example files in this codebase are:

- [apps/web/src/lib/rxdb.ts](../apps/web/src/lib/rxdb.ts)
- [apps/web/src/routes/rxdb-playground.tsx](../apps/web/src/routes/rxdb-playground.tsx)
- [packages/api/src/routers/index.ts](../packages/api/src/routers/index.ts)

Those three files show the end-to-end local database setup, TanStack DB wrapping, UI usage, and custom replication wiring.
