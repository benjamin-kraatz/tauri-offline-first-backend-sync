import {
  createBrowserReplicationPolicy,
  type BrowserReplicationPolicy,
} from "@offline-first-backend-sync/rxdb-sync";
import { client } from "@/utils/orpc";
import { toast } from "sonner";

type TodoV2Doc = {
  id: string;
  text: string;
  completed: boolean;
  updatedAt: number;
  removed?: boolean;
  flapFap?: boolean;
};

type TodoV2Checkpoint = { id: string; updatedAt: number } | null;

type CreateTodosV2RemoteApprovalPolicyOptions = {
  enabled: boolean;
  probeIntervalMs: number;
};

const REMOTE_CHANGES_TOAST_ID = "todos-v2-remote-changes";

export function createTodosV2RemoteApprovalPolicy({
  enabled,
  probeIntervalMs,
}: CreateTodosV2RemoteApprovalPolicyOptions): BrowserReplicationPolicy<
  TodoV2Doc,
  TodoV2Checkpoint
> {
  if (!enabled) {
    return createBrowserReplicationPolicy({
      mode: "auto",
      probeIntervalMs,
    });
  }

  return createBrowserReplicationPolicy({
    mode: "manual",
    probeIntervalMs,
    async probeForChanges(checkpoint) {
      const result = await client.pub__todosV2Pull({
        checkpoint: checkpoint ?? null,
        limit: 1,
      });

      return (result.documents?.length ?? 0) > 0;
    },
    onChangesAvailable({ approve }) {
      toast.info("Remote changes are ready to apply.", {
        id: REMOTE_CHANGES_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        dismissible: false,
        action: {
          label: "Apply",
          onClick: approve,
        },
      });
    },
    onProbeError(error) {
      console.warn("Error probing todos v2 remote changes", error);
    },
    onManualStateChange(state) {
      if (state !== "approval-pending") {
        toast.dismiss(REMOTE_CHANGES_TOAST_ID);
      }
    },
  });
}
