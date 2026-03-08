# Troubleshooting

This guide collects the failure modes you are most likely to hit when integrating `@offline-first-backend-sync/rxdb-sync`.

The package is intentionally thin. That means most failures are not “package bugs” in the abstract. They are usually one of these:

- a storage bootstrapping problem
- a schema mismatch
- a migration mismatch
- a replication boundary mismatch
- a host-environment mismatch

That is useful to know because it tells you where to debug first.

## The Package Builds But Replication Never Settles

First check whether the problem is actually in your pull or push handlers.

This package does not know how to speak to your backend. If replication remains active forever or surfaces generic sync errors, the most likely causes are:

- the pull handler throws
- the push handler throws
- the backend returns a shape that does not match the local schema
- the checkpoint type is inconsistent between runs

The fastest debugging move is to log the raw pull and push payloads at the host boundary before they enter RxDB.

## The UI Sees A Sync Error But The Outer Error Object Is Opaque

This package already unwraps one common RxDB replication error shape by reading `error.parameters.errors[0]` when present.

If the resulting error is still not useful, the important conclusion is that the meaningful failure probably happened before or outside that unwrap.

Look at:

- your pull handler input and output
- your push handler input and output
- your backend status and logs
- any local schema validation wrapper errors

## The Collection Fails After A Schema Change

This is almost always one of three things:

1. the database name stayed the same while local persisted data now conflicts with the new schema
2. the schema version increased but matching migration strategies are missing or incomplete
3. the backend conflict or pull shape no longer matches the local schema

The package can register the migration plugin automatically, but it cannot decide what your migration logic should be.

If you are in early development, the fastest recovery is often:

- bump the database name
- or clear local persisted data

If you are in a real migration scenario, you need correct migration strategies instead.

## Manual Approval Mode Never Detects Changes

Check these first:

- is the policy in `manual` mode?
- is `probeForChanges(...)` actually querying the backend with the last checkpoint?
- does the probe return `true` when a change exists?
- is the document visible?
- has the first applied sync completed?

The policy intentionally avoids probing during early sync and while the tab is hidden. That prevents noise, but it also means “nothing happened” can be expected if the timing assumptions are wrong.

## Manual Approval Mode Detects Changes Repeatedly

That usually means the host app never actually calls `approve()` from `onChangesAvailable(...)`, or the backend probe keeps reporting unapplied changes after approval.

Check:

- does the host UI wire the approval action correctly?
- does approval trigger `replicationState.reSync()` through the provided callback?
- does the remote pull endpoint stop returning the same pending change once it has been applied?

## The Hook Shows Errors But CRUD Still Works

That usually means local RxDB writes are fine but remote synchronization is failing.

The package does not blur those together:

- local document writes can still succeed
- the replication hook can still surface sync errors

That is often the correct behavior.

Do not assume “I can still insert documents” means replication is healthy.

## The Storage Backend Works In One Runtime But Not Another

This package does not abstract runtime-specific storage requirements.

That means:

- browser-only localStorage setups can be simple
- SQLite or desktop runtimes may need bootstrapping and runtime-specific adapters

If one runtime works and another does not, the first place to inspect is the host-owned `createStorage()` implementation.

That is usually where the incompatibility lives.

## The Package Feels Too Generic

That is often a sign that too much domain logic is still trying to live in the shared layer.

Keep the package generic and move application-specific pieces back into the host app:

- CRUD helpers
- wire-shape mappers
- UI hooks with domain names
- approval toasts and modals

If you do that, the package tends to feel clearer again.

## The Package Feels Too Thin

That can also happen, and it is a fair reaction.

In most cases, the right response is not to push domain behavior into the package. It is to add another host-level composition layer on top of the package.

Good examples:

- `lib/todos-sync.ts`
- `lib/users-sync.ts`
- `lib/orders-sync.ts`

Those files can wrap the generic package cleanly without turning the shared package into a domain-specific abstraction.
