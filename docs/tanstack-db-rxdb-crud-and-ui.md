# TanStack DB + RxDB CRUD And UI Patterns

This guide focuses on the part people usually feel first: how the UI reads data, how components stay reactive, and how CRUD actually works once TanStack DB is layered on top of RxDB.

The current repository demo is small, but it shows the essential flow in [apps/web/src/routes/rxdb-playground.tsx](../apps/web/src/routes/rxdb-playground.tsx) and the supporting helpers in [apps/web/src/lib/rxdb.ts](../apps/web/src/lib/rxdb.ts).

## Start With Reads, Not Writes

When you first wire this stack into a React app, it is tempting to think about inserts and toggles immediately. A better starting point is to get live reads working first.

The reason is simple: if your read path is not reliable and reactive, you cannot tell whether write problems are actually write problems or just stale rendering.

With TanStack DB on top of RxDB, the standard read path is:

Create a TanStack collection from an RxDB collection, then read through [useLiveQuery(...)](../apps/web/src/lib/rxdb.ts).

That gives you a stable app-level surface that reacts to both local RxDB writes and replicated remote changes.

## Reading With [useLiveQuery(...)](../apps/web/src/lib/rxdb.ts)

The current demo exposes a helper that looks like this:

```ts
export function useAllTodosQuery() {
  return useLiveQuery((q) =>
    q.from({ todo: todosCollection }).select(({ todo }) => ({
      id: todo.id,
      text: todo.text,
      completed: todo.completed,
      updatedAt: todo.updatedAt,
      removed: todo.removed,
    })),
  );
}
```

That shape is useful for two reasons.

First, it keeps components away from the lower-level details of RxDB collection access.

Second, it establishes a clear convention: components ask for app-facing query data, not raw persistence-layer objects.

That may seem like a small distinction at first, but it pays off quickly once your UI has multiple screens and multiple filtered views of the same collection.

## Filtering In The UI Layer

The current playground route pulls all todos and then filters out soft-deleted ones:

```ts
const visibleTodos = ((todos ?? []) as TodoItem[]).filter((t) => !t.removed);
```

That is a reasonable first version because it keeps the filtering logic obvious and close to the place it is rendered.

As your app grows, you may decide to move that filtering into a dedicated query helper such as `useVisibleTodosQuery()` or `useCompletedTodosQuery()`. The point is not that one location is universally correct. The point is that TanStack DB gives you a clean place to define derived views, and you should take advantage of that instead of scattering ad hoc transformations throughout the UI.

## Inserting Documents

For inserts, the current demo uses the TanStack DB collection directly:

```ts
await todosCollection.insert({
  id: crypto.randomUUID(),
  text: newText.trim(),
  completed: false,
  updatedAt: Date.now(),
});
```

This is a very natural fit for straightforward creates because the inserted shape already matches the local app model.

A good rule of thumb is that inserts through TanStack DB feel best when:

the inserted object is simple, the local shape is already complete, and you do not need extra document-level RxDB logic at creation time.

That is exactly the case in the playground example.

## Updating Documents

Updates are where the choice of mutation path becomes more interesting.

In theory, you can update through TanStack DB like this:

```ts
todosCollection.update(todoId, (draft) => {
  draft.completed = true;
});
```

That is a perfectly valid pattern in many TanStack DB setups. But once RxDB replication, local document versions, and app-specific timestamp handling enter the picture, it is often worth asking a different question: what mutation path gives the most predictable local event flow?

In this repository, the answer turned out to be a thin RxDB helper:

```ts
export async function patchTodo(
  id: string,
  patch: { completed?: boolean; removed?: boolean },
): Promise<void> {
  const doc = await db.todos.findOne(id).exec();
  if (doc) await doc.incrementalPatch({ ...patch, updatedAt: Date.now() });
}
```

The checkbox handler in the playground calls:

```ts
await patchTodo(id, { completed });
```

That approach makes the write explicit at the RxDB document level, which in turn guarantees a document event that the TanStack RxDB adapter can observe. It also guarantees that the update carries a fresh `updatedAt` value, which matters for conflict validation during replication.

This is an important practical lesson: even if two mutation paths are theoretically valid, you should choose the one that makes your data flow easiest to reason about.

## Deleting Documents

In replicated local-first systems, “delete” often really means “soft delete.”

The playground uses:

```ts
await patchTodo(id, { removed: true });
```

That leaves the document in the local database, marks it as hidden for UI purposes, and allows replication to carry that deletion state to the server and other clients.

This is usually much safer than hard deletion in distributed client systems because it preserves the information that a record was removed.

If you truly want hard deletes, use them carefully and only after you are sure your replication design can safely communicate deletion intent across all clients.

## Keep The UI Surface Thin

The current demo route is intentionally small. It does not know anything about replication checkpoints, backend conflict documents, or schema migration strategies. It only knows:

- how to read todos
- how to create a todo
- how to toggle completion
- how to soft-delete a todo
- how to show sync state

That is exactly what you want from a route or page component. The closer your component stays to “I render data and trigger intent-level actions,” the easier the whole system remains to maintain.

## Show Sync State To Users

A local-first app should not hide synchronization entirely. Users benefit from knowing whether data is currently syncing, fully in sync, or failing.

The current demo exposes:

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

The route then renders a simple status card showing either an error, an active syncing state, or an in-sync state.

This is a small pattern, but an important one. Replication errors should not live only in the console. They should be visible to the UI layer, even if the UI chooses to present them quietly.

## A Good CRUD Strategy For Beginners

If you are just starting, a very workable pattern is:

Use TanStack DB query helpers for reads.

Use `useLiveQuery(...)` for reactivity.

Use TanStack DB inserts when the created object is straightforward.

Use small RxDB document helpers for updates and soft deletes when you need direct control over timestamps, field patching, or emitted document events.

That is not a law. It is a practical way to get predictable behavior while the architecture is still settling.

## How To Decide Where A Mutation Should Live

Ask yourself three questions.

Does the mutation need direct access to the RxDB document instance?

Does it need to stamp or transform fields such as `updatedAt` before the write is stored locally?

Does it need to be tightly aligned with replication-sensitive behavior?

If the answer to those questions is yes, a thin RxDB helper is often the right place.

If the mutation is just a clean application-level create or update that already matches the collection shape, doing it directly through the TanStack collection can be very pleasant.

## What The Playground Demonstrates Well

The current [apps/web/src/routes/rxdb-playground.tsx](../apps/web/src/routes/rxdb-playground.tsx) file demonstrates a useful minimal end-to-end UI:

It creates todos through the TanStack collection.

It updates and removes todos through the [patchTodo(...)](../apps/web/src/lib/rxdb.ts) helper.

It reads todos through [useAllTodosQuery()](../apps/web/src/lib/rxdb.ts).

It derives `visibleTodos` in the UI.

It displays replication status through [useTodosReplicationState()](../apps/web/src/lib/rxdb.ts).

That is a compact but representative example of how a real app might consume this stack.

## What To Read Next

If your next question is how to connect the client setup to an actual backend contract, continue with [docs/tanstack-db-rxdb-replication-and-backend.md](./tanstack-db-rxdb-replication-and-backend.md).

If your next concern is schema changes, migration design, or error diagnosis, continue with [docs/tanstack-db-rxdb-migrations-and-troubleshooting.md](./tanstack-db-rxdb-migrations-and-troubleshooting.md).
