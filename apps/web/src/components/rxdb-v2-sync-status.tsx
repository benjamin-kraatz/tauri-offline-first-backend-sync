import { useV2ReplicationState } from "@/lib/rxdb-v2";

const dotColor = {
  error: "bg-red-500",
  syncing: "bg-yellow-500",
  idle: "bg-green-500",
} as const;

const label = {
  error: "Sync error",
  syncing: "Syncing…",
  idle: "In sync",
} as const;

export default function SyncStatusV2() {
  const { active, error } = useV2ReplicationState();
  const status: keyof typeof dotColor = error ? "error" : active ? "syncing" : "idle";

  return (
    <span className="group inline-flex w-6 cursor-default items-center gap-2 overflow-hidden rounded-full border border-border bg-background py-1 pl-1.5 pr-1.5 transition-[width] duration-300 ease-out hover:w-20">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${dotColor[status]} transition-colors duration-200`}
      />
      <span className="min-w-0 truncate text-xs font-medium opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        {label[status]}
      </span>
    </span>
  );
}
