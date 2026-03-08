# TanStack DB + RxDB Migrations And Troubleshooting

This guide is about the part everyone meets sooner than they expect: schema changes, migration support, reserved field names, replication edge cases, and the errors that show up while a local-first system is still evolving.

The reason this deserves its own guide is that RxDB is not just an in-memory abstraction. It is a persistent local database with schema awareness. Once you accept that, migration and troubleshooting stop feeling like annoying exceptions and start feeling like a normal part of working with real data.

## The First Big Reality: Local Databases Remember Things

When you change frontend code, the browser does not automatically forget the old local database.

That means if your collection schema changes but your stored data still reflects the old version, you can get schema mismatch errors, migration errors, or replication failures that look surprising the first time you see them.

This is not RxDB being difficult. It is RxDB refusing to pretend that persistent data magically reshapes itself when code changes.

That is a good property, even if it is sometimes inconvenient during development.

## Why Schema Versioning Matters

RxDB collection schemas have a `version`. If you stay at version `0`, you are effectively saying “this is the initial shape.” As soon as you bump beyond `0`, you are acknowledging that older persisted documents may need to be transformed before they can safely live under the new schema.

That is why the current implementation uses:

```ts
version: 1
```

along with:

```ts
migrationStrategies: {
  1: (oldDoc) => ({
    ...oldDoc,
    removed: oldDoc._deleted ?? oldDoc.deleted ?? false,
  }),
}
```

and also enables the migration plugin:

```ts
addRxPlugin(RxDBMigrationSchemaPlugin);
```

Those three pieces belong together.

If you bump the schema version and forget either the plugin or the strategy entry for that version, RxDB will tell you.

## The Development Shortcut: Versioned Database Names

In development, you often do not actually care about preserving old local test data. You just want the app to boot cleanly after a schema change.

That is why this repository currently uses a versioned database name:

```ts
const DB_NAME = "my-todos-v2";
```

This is a simple but effective strategy. Instead of trying to reuse the exact same local storage entry while the shape is still evolving, you create a fresh local database namespace.

This should not be your only long-term strategy in production, but it is a very practical way to keep moving while you are designing the model.

## Use Real Migrations When The Data Matters

Once local data matters and you do not want to discard it between releases, you need real migration strategies.

A migration strategy should do one of three things:

transform the old document into the new shape, provide defaults for new required fields, or intentionally discard data that is no longer meaningful if that is acceptable for the product.

In the current demo, the migration is simple because the schema change is simple. It takes an old deletion representation and normalizes it to the new `removed` field. In a larger app, migrations might also rename fields, derive new properties, or split one old field into several new ones.

The important point is not that migrations are fancy. It is that they are explicit.

## Reserved Field Names Are Real

One of the easiest schema errors to hit is using a top-level field name that conflicts with RxDB document properties or reserved semantics.

The local model in this repository originally leaned toward `deleted`, but that clashes with RxDB expectations. The resulting fix was not to fight the database. The fix was to choose a safer app-facing field name, `removed`, and map it at the replication boundary.

That is a pattern worth reusing.

If RxDB says a field name is not allowed, treat that as a design constraint and adapt your app model. Do not try to squeeze a problematic field through and hope the internals will tolerate it.

## Keep Schema Shape And Replication Shape Separate

A lot of subtle errors come from assuming the backend and frontend shapes must be identical.

They do not.

In this repository:

- the local schema uses `removed`
- the backend returns and accepts `deleted`

The replication layer maps between the two.

That separation makes schema errors easier to fix and makes backend integration easier when the server shape is already established.

It also explains one common push error: if conflict documents come back from the backend with fields that are not allowed by the local schema, RxDB will reject them. That is not a random failure. It is the local schema protecting itself from unexpected document shape drift.

## A Few Common Error Types And What They Usually Mean

When RxDB says another instance created the collection with a different schema, the usual cause is that you changed the schema while keeping the same database name and did not migrate the stored data accordingly.

When RxDB says a migration strategy is missing or there are too many, the usual cause is that the schema version and the `migrationStrategies` object are out of sync.

When schema validation complains about an additional property during replication, the usual cause is that the backend returned a document shape that does not match the local collection schema. In this stack, that often means forgetting to map `deleted` back to `removed` on conflict documents.

When local changes appear to “revert” after a write, the usual cause is that the backend and client no longer agree about the version field used for conflict validation. In this repository, that meant local changes had to stamp a new `updatedAt`, and accepted backend writes had to preserve that value instead of rewriting it arbitrarily.

Those are not separate categories of pain. They all come from one underlying rule: every layer of the system must agree on document shape and document version semantics.

## Troubleshoot In Layers

The fastest way to debug this stack is not to stare at the whole system at once. Debug it layer by layer.

First ask whether the local RxDB schema itself is valid and booting cleanly.

Then ask whether the local collection contains the document you think it contains.

Then ask whether the TanStack DB adapter is seeing RxDB changes and surfacing them to `useLiveQuery(...)`.

Then ask whether the backend pull and push endpoints are receiving and returning the shape you expect.

Then ask whether version fields such as `updatedAt` are being preserved consistently enough for conflict detection to make sense.

That layered debugging approach is dramatically more effective than treating every sync problem as an abstract “replication issue.”

## A Good Habit: Surface Replication Errors In The UI

This repository exposes a small replication status hook:

```ts
export function useTodosReplicationState() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const subActive = todosReplicationState.active$.subscribe(setActive);
    const subError = todosReplicationState.error$.subscribe((e) =>
      setError(e?.parameters?.errors?.[0] ?? e),
    );
    return () => {
      subActive.unsubscribe();
      subError.unsubscribe();
    };
  }, []);

  return { active, error, replicationState: todosReplicationState };
}
```

That pattern matters because replication failures are easier to debug when they are visible in the app instead of hidden in a terminal or browser console.

Even if your production UI only shows a quiet sync badge, having an app-level path for surfacing replication errors is extremely useful.

## Schema Evolution Is Easier If You Plan For It Up Front

A few habits make future migrations much easier:

Choose stable primary keys from the beginning.

Use explicit soft-delete fields rather than hard delete semantics where replication matters.

Be intentional about the version field or fields used for pull ordering and conflict checking.

Keep mapping logic at the replication boundary instead of scattering it through the UI.

Avoid top-level field names that are likely to collide with RxDB or document helper semantics.

Those choices do not eliminate migration work, but they reduce the amount of chaos when schema evolution arrives.

## A Sensible Upgrade Sequence

When you need to change a collection schema, a safe sequence is:

first define the new schema shape, then write the migration strategy, then add or update any replication mapping that depends on the changed fields, then update any UI-level query helpers, then test a clean boot and a migration boot separately.

That last step matters. A clean boot proves the new shape works from scratch. A migration boot proves that old persisted data can still survive the transition.

You need both.

## What This Repository Specifically Teaches

This repository is a good example of several practical lessons:

It shows why a versioned database name is a useful development tactic.

It shows why migration strategies need to match the schema version.

It shows why app-visible field names and backend wire field names may need to differ.

It shows why conflict documents must be mapped back into the local schema shape before RxDB accepts them.

It shows why version-field consistency matters for preventing local writes from looking like stale conflicts on the next push.

Those are exactly the kinds of issues that catch people when they build a local-first stack for the first time.

## Final Advice

Do not treat migration and troubleshooting as cleanup work you will do later. In a local database, they are part of the architecture from day one.

If you assume your schema will evolve, if you keep the backend and local schema boundary explicit, and if you debug the system one layer at a time, the stack becomes much easier to work with.

That is the difference between “RxDB keeps surprising me” and “RxDB is doing exactly what the current contract tells it to do.”
