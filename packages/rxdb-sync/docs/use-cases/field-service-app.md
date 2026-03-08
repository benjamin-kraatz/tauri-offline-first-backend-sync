# Real-World Use Case: Field Service Application

Imagine a field service application used by technicians who spend much of the day with unstable connectivity.

The product needs:

- a durable local task list
- local edits that work offline
- eventual sync with the backend
- a reactive app-facing read layer for the UI
- a structure that keeps backend specifics out of the local-state package

This package fits that shape well.

## Why The Package Helps Here

In a field workflow, the app usually has multiple responsibilities at once:

- local persistence must be durable
- sync must survive bad connectivity
- the UI must stay responsive
- the app often needs domain-specific CRUD helpers that should not live in a shared low-level package

`@offline-first-backend-sync/rxdb-sync` helps by owning the repeated local orchestration without claiming the domain logic.

That means the field service app can keep:

- task schema decisions
- storage runtime choices
- replication endpoint logic
- conflict mapping
- technician-facing UI behaviors

inside the host app, while avoiding repeated boilerplate for RxDB and TanStack bridging.

## A Plausible Setup

The app might have:

- `work-orders-sync.ts`
- `inventory-sync.ts`
- `notes-sync.ts`

Each of those host files can use the same package factory pattern, but expose domain-native helpers such as:

- `acknowledgeWorkOrder(...)`
- `markInventoryConsumed(...)`
- `submitJobNotes(...)`

That is the right separation.

The package handles:

- local collection creation
- replication wiring
- query-layer bridging

The host app handles:

- field workflow logic
- validation rules
- backend procedure semantics
- operator UI

## Why Headless Browser Policy Support Matters

Field apps are a good example of why the browser policy API should remain headless.

One field product might want:

- silent background re-sync while technicians are moving quickly

Another might want:

- explicit approval for remote task updates while a work order is being edited

Those are product decisions, not package decisions.

The package is more useful precisely because it does not force one answer.
