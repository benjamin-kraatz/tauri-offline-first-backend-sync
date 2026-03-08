# TanStack DB + RxDB Replication And Backend Wiring

This guide is about the server-facing half of the stack: how RxDB replication works, what your backend needs to implement, how checkpoints are used, how conflict detection works, and how to connect all of this to an existing backend without rebuilding your application around RxDB-specific infrastructure.

The working demo for this repository is spread across:

- [apps/web/src/lib/rxdb.ts](../apps/web/src/lib/rxdb.ts)
- [packages/api/src/routers/index.ts](../packages/api/src/routers/index.ts)

Those files are concrete examples of the patterns described below.

## Start With The Right Assumption

RxDB replication does not require your backend to “be RxDB.”

That is the most important thing to understand before you begin. You do not need to abandon your current database, your current server framework, or your current API style. What you need is a backend contract that behaves the way RxDB expects.

At a high level, the backend only needs to do two jobs:

It must return batches of documents newer than a given checkpoint.

It must accept batches of client writes and either persist them or reject them as conflicts.

That is the heart of the protocol.

## Pull Replication: What The Client Asks

Pull replication is the client asking:

"What has changed on the server since the last checkpoint I saw?"

To answer that question correctly, the backend needs a deterministic ordering strategy. In the current implementation, the order is:

- first by `updatedAt`
- then by `id`

That combination is important because timestamps alone are not always unique. If two documents share the same update time, you need a stable tie-breaker or the checkpoint iteration becomes unreliable.

The current backend procedure `pub__todosPull` in [packages/api/src/routers/index.ts](../packages/api/src/routers/index.ts) takes a checkpoint like this:

```ts
checkpoint: { id: string; updatedAt: number } | null
```

Then it queries rows written after that checkpoint and returns:

- `documents`
- `checkpoint`

That is the full pull contract.

## Why The Checkpoint Shape Matters

The checkpoint is not just a cursor token invented for convenience. It is part of your replication model.

The checkpoint fields should correspond to the same fields you use to order remote writes. If you sort by `updatedAt` and `id`, your checkpoint should contain those fields too.

If those two things drift apart, your replication becomes fragile. You can end up skipping documents, replaying too much data, or getting different answers for the same checkpoint depending on database timing.

That is why the backend example in this repository constructs checkpoints from the last returned document:

```ts
const checkpoint =
  last != null ? { id: last.id, updatedAt: last.updatedAt } : (cp ?? null);
```

## Push Replication: What The Client Sends

Push replication is the inverse question:

"Here are the local changes I made. Are they still valid relative to the server's current state?"

For each local write, RxDB provides both:

- `newDocumentState`
- `assumedMasterState`

The client is effectively saying:

"I believe the server currently has this old version, and I want to move it to this new version."

The backend then compares the assumed master state to the actual stored record. If they match, the write can be accepted. If they do not match, the backend returns a conflict.

This is what makes offline-first editing sane. The client is not blindly overwriting whatever is on the server. It is proposing a transition from one known version to another.

## The Current Push Handler

In this repository, the push endpoint is `pub__todosPush` in [packages/api/src/routers/index.ts](../packages/api/src/routers/index.ts).

It loops over the incoming write rows, loads the current record from the database, compares:

- the client's `assumedMasterState.updatedAt`
- the actual stored `updatedAt`

and if the two diverge, it returns the current stored document as a conflict instead of applying the write.

If they match, it writes the incoming values.

That is a simple but legitimate version of conflict handling. It is not the only approach, but it is good enough to illustrate the protocol clearly.

## Preserve Version Semantics

One subtle but important lesson from the current implementation is this:

if the client uses `updatedAt` as part of conflict validation, the server cannot silently replace that field with a completely different timestamp and still expect the next client push to compare cleanly.

This repository originally hit exactly that problem. The fix was to ensure that:

- local writes stamp a fresh `updatedAt` before they are stored in RxDB
- the backend preserves the pushed `updatedAt` when persisting the accepted write

That keeps the client’s expected master version aligned with the server’s stored version.

Long term, many systems end up splitting this into two fields:

- one field for pull ordering
- one field for optimistic write validation

That is often a cleaner model. But if you start with a single field, be disciplined about how both client and server treat it.

## Map Fields Explicitly At The Boundary

One of the best patterns in the current demo is that the local app model and the backend wire model are not assumed to be identical.

The frontend uses `removed`.

The backend uses `deleted`.

The replication config bridges the two.

On pull, the frontend uses a modifier:

```ts
modifier: (doc) => {
  const d = doc as { deleted?: boolean; removed?: boolean };
  return { ...d, removed: d.deleted ?? d.removed ?? false, deleted: undefined };
};
```

On push, the frontend maps outgoing documents explicitly:

```ts
newDocumentState: {
  id: d.id,
  text: d.text,
  completed: d.completed,
  deleted: d.removed ?? false,
  updatedAt: d.updatedAt,
}
```

And when conflicts come back, it maps conflict docs back to the local schema shape:

```ts
return {
  id: doc.id,
  text: doc.text,
  completed: doc.completed,
  removed: doc.deleted,
  updatedAt: doc.updatedAt,
};
```

This is exactly the kind of explicitness you want. It keeps each layer honest. It also prevents a lot of “mystery shape drift” bugs where a backend property silently leaks into the local collection and violates the schema.

## Soft Deletes In Replication

Deletes deserve special treatment in replicated systems because clients need to learn not only that a record existed, but also that it was removed.

In the current setup:

- the local schema uses `removed`
- the replication config tells RxDB `deletedField: "removed"`
- the backend stores `deleted`

That works because the replication boundary is doing the translation deliberately.

The larger point is that hard-deleting a row on the backend is often not enough for a local-first system. You need to communicate deletion state in a way that all clients can observe and process.

## A Good Backend Contract Shape

If you already have an existing backend, you can usually integrate RxDB by adding two purpose-built endpoints or procedures:

One pull endpoint that accepts a checkpoint and batch size, then returns documents and a new checkpoint.

One push endpoint that accepts local candidate writes, compares them with current server state, applies safe writes, and returns conflicts for stale ones.

That is much less invasive than trying to rebuild your whole API around the replication library.

This repository uses oRPC instead of generic REST, but the pattern is the same. The transport does not matter much. The contract does.

## What Your Backend Must Be Good At

To support RxDB replication well, your backend should be able to:

order writes deterministically, load the current server version for a given document, compare client assumptions to actual stored state, return conflict documents in the schema the client expects, and persist accepted writes in a version-consistent way.

That is the real checklist.

Notice what is not on that list: “understand all of RxDB internals.” Your backend does not need to become an RxDB clone. It only needs to behave consistently at the replication boundary.

## A Simple Way To Build The Endpoints

A very practical implementation sequence is:

First, implement pull without worrying about push. Get checkpoint iteration correct and make sure the client can fetch all remote changes repeatedly without missing or duplicating records.

Then implement push with a very simple conflict rule, such as comparing a version field or timestamp field.

Then add field mapping for things like soft deletes.

Then add conflict mapping so returned conflict documents always match the local schema.

Then add tests for the two endpoints because once replication is working, schema drift in either endpoint can break sync in subtle ways.

That sequence gives you a stable path forward without trying to solve everything at once.

## Where This Shows Up In The Demo

The clearest frontend replication reference is in [apps/web/src/lib/rxdb.ts](../apps/web/src/lib/rxdb.ts):

- the `replicateRxCollection(...)` call
- the pull modifier
- the pull handler
- the push handler
- the conflict mapping

The clearest backend reference is in [packages/api/src/routers/index.ts](../packages/api/src/routers/index.ts):

- `pub__todosPull`
- `pub__todosPush`

Those files are worth reading together, because replication only makes sense when you see both sides of the contract at the same time.

## What To Read Next

If your next concern is schema evolution, migration support, reserved fields, or the errors you are likely to hit while iterating on the design, continue with [docs/tanstack-db-rxdb-migrations-and-troubleshooting.md](./tanstack-db-rxdb-migrations-and-troubleshooting.md).
