import { client } from "@/utils/orpc";
import { toast } from "sonner";

type TodoV2Checkpoint = { id: string; updatedAt: number } | null;

type TodosV2ReplicationState = {
  reSync: () => void;
  active$: { subscribe: (handler: (active: boolean) => void) => { unsubscribe: () => void } };
  canceled$: {
    subscribe: (handler: (isCanceled: boolean) => void) => { unsubscribe: () => void };
  };
};

type ConfigureTodosV2RemoteApprovalOptions = {
  enabled: boolean;
  replicationState: TodosV2ReplicationState;
  getLastAppliedPullCheckpoint: () => TodoV2Checkpoint;
  probeIntervalMs: number;
};

const REMOTE_CHANGES_TOAST_ID = "todos-v2-remote-changes";

let hasCompletedInitialAppliedSync = false;
let isProbeInFlight = false;
let isApprovalToastVisible = false;
let isApplyInProgress = false;
let sawApplyReplicationActivity = false;
let isReplicationActive = false;
let applyApprovedTodosV2Changes: (() => void) | null = null;

async function probeForRemoteTodosV2Changes(getLastAppliedPullCheckpoint: () => TodoV2Checkpoint) {
  if (
    !hasCompletedInitialAppliedSync ||
    isProbeInFlight ||
    isApprovalToastVisible ||
    isApplyInProgress ||
    isReplicationActive ||
    document.visibilityState !== "visible"
  ) {
    return;
  }

  isProbeInFlight = true;
  try {
    const result = await client.pub__todosV2Pull({
      checkpoint: getLastAppliedPullCheckpoint(),
      limit: 1,
    });

    if ((result.documents?.length ?? 0) > 0) {
      isApprovalToastVisible = true;
      toast.info("Remote changes are ready to apply.", {
        id: REMOTE_CHANGES_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        dismissible: false,
        action: {
          label: "Apply",
          onClick: () => {
            applyApprovedTodosV2Changes?.();
          },
        },
      });
    }
  } catch (error) {
    console.warn("Error probing todos v2 remote changes", error);
  } finally {
    isProbeInFlight = false;
  }
}

export function configureTodosV2RemoteApproval({
  enabled,
  replicationState,
  getLastAppliedPullCheckpoint,
  probeIntervalMs,
}: ConfigureTodosV2RemoteApprovalOptions) {
  if (!enabled) {
    const runAutoResync = () => {
      if (document.visibilityState === "visible") {
        replicationState.reSync();
      }
    };

    const intervalId = window.setInterval(runAutoResync, probeIntervalMs);
    const onOnline = () => replicationState.reSync();
    const onFocus = () => replicationState.reSync();
    const onVisibilityChange = () => runAutoResync();

    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const subCanceled = replicationState.canceled$.subscribe((isCanceled) => {
      if (!isCanceled) return;
      subCanceled.unsubscribe();
      window.clearInterval(intervalId);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });

    return;
  }

  applyApprovedTodosV2Changes = () => {
    if (isApplyInProgress) return;

    isApprovalToastVisible = false;
    isApplyInProgress = true;
    sawApplyReplicationActivity = false;
    toast.dismiss(REMOTE_CHANGES_TOAST_ID);
    replicationState.reSync();
  };

  const runBackgroundProbe = () => {
    void probeForRemoteTodosV2Changes(getLastAppliedPullCheckpoint);
  };

  const subActive = replicationState.active$.subscribe((active) => {
    const wasActive = isReplicationActive;
    isReplicationActive = active;

    if (active) {
      if (isApplyInProgress) {
        sawApplyReplicationActivity = true;
      }
      return;
    }

    if (wasActive && !hasCompletedInitialAppliedSync) {
      hasCompletedInitialAppliedSync = true;
    }

    if (isApplyInProgress && sawApplyReplicationActivity) {
      isApplyInProgress = false;
      sawApplyReplicationActivity = false;
    }
  });

  const intervalId = window.setInterval(runBackgroundProbe, probeIntervalMs);
  const onOnline = () => runBackgroundProbe();
  const onFocus = () => runBackgroundProbe();
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      runBackgroundProbe();
    }
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);

  const subCanceled = replicationState.canceled$.subscribe((isCanceled) => {
    if (!isCanceled) return;
    subActive.unsubscribe();
    subCanceled.unsubscribe();
    window.clearInterval(intervalId);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    applyApprovedTodosV2Changes = null;
  });
}
