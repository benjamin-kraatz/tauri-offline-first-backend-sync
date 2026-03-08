# Browser Policies

This guide is about `createBrowserReplicationPolicy(...)`.

That API exists because browser lifecycle behavior is real application logic, but it is also repetitive enough to deserve extraction.

The package supports two browser policy modes:

- `auto`
- `manual`

## Why Browser Policies Are Separate

RxDB replication already knows how to replicate.

What it does not know is how your browser app wants to behave around:

- tab visibility
- focus changes
- network reconnects
- timed re-syncs
- remote changes that should be approved before application

Those are not database concerns. They are browser application concerns.

That is why the package keeps them in a separate API instead of mixing them into the core factory itself.

## Auto Mode

Auto mode is the simpler behavior.

It will:

- re-sync on an interval
- re-sync when the browser goes online
- re-sync on focus
- re-sync when the document becomes visible

This is a good default when:

- remote changes should be applied immediately
- the app does not need human approval before updating local state
- the UI does not need to distinguish “changes detected” from “changes applied”

Example:

```ts
import { createBrowserReplicationPolicy } from "@offline-first-backend-sync/rxdb-sync";

const browserPolicy = createBrowserReplicationPolicy({
  mode: "auto",
  probeIntervalMs: 15_000,
});
```

That is enough for many apps.

## Manual Mode

Manual mode is for the case where remote changes should be detected first and only applied after the user explicitly approves them.

That sounds niche until you hit a product where automatic cross-device changes feel disruptive.

Examples include:

- a form-heavy desktop workflow where silent remote updates are confusing
- a task-management tool where another device may change the current queue while the user is actively editing
- a review workflow where the app should surface “changes are waiting” instead of applying them instantly

In manual mode, the package keeps the orchestration headless:

- it probes for new changes
- it tracks manual-policy state
- it exposes an `approve()` callback

The host app still decides how the UI should look.

Example:

```ts
const browserPolicy = createBrowserReplicationPolicy({
  mode: "manual",
  probeIntervalMs: 15_000,
  probeForChanges: async (checkpoint) => {
    const result = await api.todos.pull({ checkpoint, limit: 1 });
    return result.documents.length > 0;
  },
  onChangesAvailable({ approve }) {
    showToast({
      message: "Remote changes are available.",
      actionLabel: "Apply",
      onAction: approve,
    });
  },
  onProbeError(error) {
    console.warn("Could not probe for remote changes", error);
  },
  onManualStateChange(state) {
    syncUiStateStore.set(state);
  },
});
```

## Manual State Meanings

Manual mode uses three states:

- `idle`
- `approval-pending`
- `applying`

These states are intentionally narrow.

They are not trying to become a full sync state machine for your entire application. They only describe the browser policy around approval.

### `idle`

No approval is pending and no manual apply cycle is currently running.

### `approval-pending`

The probe found remote changes and the host app has not approved them yet.

### `applying`

The host app approved pending changes and a re-sync cycle is now running to apply them.

## What `probeForChanges(...)` Should Do

This callback should be cheap.

The simplest good pattern is:

- call the same backend pull endpoint you already use for replication
- pass the last applied checkpoint
- request only one document
- return `true` if at least one document is present

That lets the policy ask a focused question:

“Are there unapplied remote changes?”

It does not need the whole dataset to answer that.

## What The Package Tracks Internally

The manual policy tracks enough internal state to avoid noisy or incorrect behavior:

- it does not probe while the first applied sync is still settling
- it does not probe again while a probe is in flight
- it does not probe while approval is already pending
- it does not probe while an apply cycle is in progress
- it does not probe while replication is already active
- it only probes while the document is visible

That behavior matters because otherwise manual approval flows quickly become spammy or race-prone.

## What The Host App Should Still Handle

Even in manual mode, the host app is still responsible for:

- the actual UI for prompting approval
- the language shown to users
- whether to dismiss or persist the prompt
- any telemetry, logging, or product-level state

The package intentionally stops at orchestration.
