# Advanced Sample: Manual Remote Approval

This sample shows how to use `createBrowserReplicationPolicy(...)` in manual mode.

The goal is:

- detect remote changes periodically
- avoid applying them silently
- let the host app decide how to prompt the user
- apply those changes only after approval

This is a good pattern when automatic remote application would be surprising or disruptive.

## Example

```ts
import { createBrowserReplicationPolicy } from "@offline-first-backend-sync/rxdb-sync";

const browserPolicy = createBrowserReplicationPolicy<TodoDoc, TodoCheckpoint>({
  mode: "manual",
  probeIntervalMs: 15_000,
  probeForChanges: async (checkpoint) => {
    const result = await client.pub__todosPull({
      checkpoint: checkpoint ?? null,
      limit: 1,
    });

    return (result.documents?.length ?? 0) > 0;
  },
  onChangesAvailable({ approve }) {
    toast.info("Remote changes are ready to apply.", {
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
      action: {
        label: "Apply",
        onClick: approve,
      },
    });
  },
  onProbeError(error) {
    console.warn("Error probing for remote changes", error);
  },
  onManualStateChange(state) {
    replicationUiStateStore.set(state);
  },
});
```

Then pass that policy into the collection module:

```ts
const todosModule = createReplicatedRxCollectionModule<TodoDoc, TodoCheckpoint, "todos">({
  // other config...
  browserPolicy,
  replication: {
    // normal replication config...
  },
});
```

## Why This Pattern Exists

Some products should not silently rewrite the current local UI state when a remote device changes data.

Examples:

- an operator is actively editing a record and does not want a list to jump unexpectedly
- a manager wants to review remote updates before they become visible to staff
- a desktop workflow treats remote changes as something to acknowledge, not something to apply immediately

Manual policy mode is for those cases.

## Good Host UI Patterns

The package is headless here, so the UI is your choice.

Good host-level UX options include:

- a sticky toast with an `Apply` action
- a sync badge that turns into a review prompt
- a sidebar inbox item
- a top-level “remote changes waiting” banner

The important part is not the UI component. The important part is that the host app owns it.

## A Bad Pattern To Avoid

Do not use manual mode if your UI immediately auto-approves the changes anyway.

If the product wants automatic application, use `auto` mode and keep the system simpler.
