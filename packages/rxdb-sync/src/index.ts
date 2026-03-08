import { createCollection, type Collection } from "@tanstack/db";
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection";
import { useEffect, useState } from "react";
import type {
  MigrationStrategies,
  ReplicationPullOptions,
  ReplicationPushOptions,
  RxCollection,
  RxDatabase,
  RxJsonSchema,
  RxStorage,
} from "rxdb";
import { addRxPlugin, createRxDatabase } from "rxdb/plugins/core";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import {
  replicateRxCollection,
  type RxReplicationState,
} from "rxdb/plugins/replication";

type MaybePromise<T> = T | Promise<T>;
type CollectionMap<TCollectionName extends string, TDoc extends object> = Record<
  TCollectionName,
  RxCollection<TDoc>
>;

let hasRegisteredDevModePlugin = false;
let hasRegisteredMigrationPlugin = false;

function ensurePlugins(enableDevMode: boolean, needsMigrationPlugin: boolean) {
  if (enableDevMode && !hasRegisteredDevModePlugin) {
    addRxPlugin(RxDBDevModePlugin);
    hasRegisteredDevModePlugin = true;
  }

  if (needsMigrationPlugin && !hasRegisteredMigrationPlugin) {
    addRxPlugin(RxDBMigrationSchemaPlugin);
    hasRegisteredMigrationPlugin = true;
  }
}

function getReplicationError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "parameters" in error &&
    error.parameters &&
    typeof error.parameters === "object" &&
    "errors" in error.parameters &&
    Array.isArray(error.parameters.errors) &&
    error.parameters.errors.length > 0
  ) {
    return error.parameters.errors[0];
  }

  return error;
}

export type BrowserReplicationPolicyMode = "auto" | "manual";
export type BrowserReplicationPolicyManualState = "idle" | "approval-pending" | "applying";

export type BrowserReplicationPolicyOptions<TCheckpoint> = {
  mode?: BrowserReplicationPolicyMode;
  probeIntervalMs: number;
  probeForChanges?: (checkpoint: TCheckpoint | undefined) => Promise<boolean>;
  onChangesAvailable?: (controls: { approve: () => void }) => void;
  onProbeError?: (error: unknown) => void;
  onManualStateChange?: (state: BrowserReplicationPolicyManualState) => void;
};

export type BrowserReplicationPolicyAttachOptions<TDoc extends object, TCheckpoint> = {
  replicationState: RxReplicationState<TDoc, TCheckpoint>;
  getLastAppliedPullCheckpoint: () => TCheckpoint | undefined;
};

export type BrowserReplicationPolicy<TDoc extends object, TCheckpoint> = {
  attach: (options: BrowserReplicationPolicyAttachOptions<TDoc, TCheckpoint>) => () => void;
  approve: () => void;
};

export type ReplicatedRxCollectionModuleConfig<
  TDoc extends object,
  TCheckpoint,
  TCollectionName extends string = string,
> = {
  databaseName: string;
  createStorage: () => MaybePromise<RxStorage<unknown, unknown>>;
  collectionName: TCollectionName;
  schema: RxJsonSchema<TDoc>;
  migrationStrategies?: MigrationStrategies<TDoc>;
  enableDevMode?: boolean;
  startSync?: boolean;
  browserPolicy?: BrowserReplicationPolicy<TDoc, TCheckpoint>;
  replication: {
    identifier: string;
    deletedField?: string;
    pull?: ReplicationPullOptions<TDoc, TCheckpoint>;
    push?: ReplicationPushOptions<TDoc>;
    live?: boolean;
    retryTime?: number;
    autoStart?: boolean;
    toggleOnDocumentVisible?: boolean;
  };
};

export type ReplicatedRxCollectionContext<
  TDoc extends object,
  TCheckpoint,
  TCollectionName extends string = string,
> = {
  db: RxDatabase<CollectionMap<TCollectionName, TDoc>>;
  rxCollection: RxCollection<TDoc>;
  collection: Collection<TDoc, string>;
  replicationState: RxReplicationState<TDoc, TCheckpoint>;
};

export function useReplicationState<TDoc extends object, TCheckpoint>(
  replicationState: RxReplicationState<TDoc, TCheckpoint>,
) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const subActive = replicationState.active$.subscribe(setActive);
    const subError = replicationState.error$.subscribe((nextError: unknown) =>
      setError(getReplicationError(nextError)),
    );

    return () => {
      subActive.unsubscribe();
      subError.unsubscribe();
    };
  }, [replicationState]);

  return { active, error, replicationState };
}

export function createBrowserReplicationPolicy<TDoc extends object, TCheckpoint>({
  mode = "auto",
  probeIntervalMs,
  probeForChanges,
  onChangesAvailable,
  onProbeError,
  onManualStateChange,
}: BrowserReplicationPolicyOptions<TCheckpoint>): BrowserReplicationPolicy<TDoc, TCheckpoint> {
  let approvePendingChanges: (() => void) | null = null;

  const approve = () => {
    approvePendingChanges?.();
  };

  return {
    approve,
    attach({ replicationState, getLastAppliedPullCheckpoint }) {
      if (typeof window === "undefined" || typeof document === "undefined") {
        return () => {};
      }

      const cleanups: Array<() => void> = [];

      const cleanup = () => {
        while (cleanups.length > 0) {
          cleanups.pop()?.();
        }
      };

      if (mode === "auto") {
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

        cleanups.push(() => window.clearInterval(intervalId));
        cleanups.push(() => window.removeEventListener("online", onOnline));
        cleanups.push(() => window.removeEventListener("focus", onFocus));
        cleanups.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));
      } else {
        if (!probeForChanges) {
          throw new Error("Manual browser replication policy requires probeForChanges.");
        }

        let hasCompletedInitialAppliedSync = false;
        let isProbeInFlight = false;
        let isApprovalPending = false;
        let isApplyInProgress = false;
        let sawApplyReplicationActivity = false;
        let isReplicationActive = false;
        let manualState: BrowserReplicationPolicyManualState = "idle";

        const setManualState = (nextState: BrowserReplicationPolicyManualState) => {
          if (manualState === nextState) return;
          manualState = nextState;
          onManualStateChange?.(nextState);
        };

        approvePendingChanges = () => {
          if (!isApprovalPending || isApplyInProgress) return;

          isApprovalPending = false;
          isApplyInProgress = true;
          sawApplyReplicationActivity = false;
          setManualState("applying");
          replicationState.reSync();
        };

        const runBackgroundProbe = async () => {
          if (
            !hasCompletedInitialAppliedSync ||
            isProbeInFlight ||
            isApprovalPending ||
            isApplyInProgress ||
            isReplicationActive ||
            document.visibilityState !== "visible"
          ) {
            return;
          }

          isProbeInFlight = true;
          try {
            const hasChanges = await probeForChanges(getLastAppliedPullCheckpoint());

            if (!hasChanges || isApprovalPending) {
              return;
            }

            isApprovalPending = true;
            setManualState("approval-pending");
            onChangesAvailable?.({ approve });
          } catch (error) {
            onProbeError?.(error);
          } finally {
            isProbeInFlight = false;
          }
        };

        const subActive = replicationState.active$.subscribe((active: boolean) => {
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
            setManualState("idle");
          }
        });

        const intervalId = window.setInterval(() => {
          void runBackgroundProbe();
        }, probeIntervalMs);
        const onOnline = () => {
          void runBackgroundProbe();
        };
        const onFocus = () => {
          void runBackgroundProbe();
        };
        const onVisibilityChange = () => {
          if (document.visibilityState === "visible") {
            void runBackgroundProbe();
          }
        };

        window.addEventListener("online", onOnline);
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibilityChange);

        cleanups.push(() => subActive.unsubscribe());
        cleanups.push(() => window.clearInterval(intervalId));
        cleanups.push(() => window.removeEventListener("online", onOnline));
        cleanups.push(() => window.removeEventListener("focus", onFocus));
        cleanups.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));
        cleanups.push(() => {
          approvePendingChanges = null;
          isApprovalPending = false;
          isApplyInProgress = false;
          setManualState("idle");
        });
      }

      const subCanceled = replicationState.canceled$.subscribe((isCanceled: boolean) => {
        if (!isCanceled) return;
        cleanup();
      });

      cleanups.push(() => subCanceled.unsubscribe());

      return cleanup;
    },
  };
}

export function createReplicatedRxCollectionModule<
  TDoc extends object,
  TCheckpoint,
  TCollectionName extends string = string,
>(
  config: ReplicatedRxCollectionModuleConfig<TDoc, TCheckpoint, TCollectionName>,
) {
  type Context = ReplicatedRxCollectionContext<TDoc, TCheckpoint, TCollectionName>;

  let contextPromise: Promise<Context> | undefined;

  const getContext = () => {
    contextPromise ??= initContext();
    return contextPromise;
  };

  async function initContext(): Promise<Context> {
    const needsMigrationPlugin =
      typeof config.schema.version === "number" && config.schema.version > 0;
    ensurePlugins(config.enableDevMode ?? false, needsMigrationPlugin);

    const db = (await createRxDatabase({
      name: config.databaseName,
      storage: await config.createStorage(),
    })) as RxDatabase<CollectionMap<TCollectionName, TDoc>>;

    await db.addCollections({
      [config.collectionName]: {
        schema: config.schema,
        migrationStrategies: config.migrationStrategies,
      },
    } as Record<
      TCollectionName,
      {
        schema: RxJsonSchema<TDoc>;
        migrationStrategies?: MigrationStrategies<TDoc>;
      }
    >);

    const rxCollection = db[config.collectionName];
    let lastAppliedPullCheckpoint =
      config.replication.pull?.initialCheckpoint as TCheckpoint | undefined;

    const replicationState = replicateRxCollection<TDoc, TCheckpoint>({
      collection: rxCollection,
      replicationIdentifier: config.replication.identifier,
      deletedField: config.replication.deletedField,
      pull: config.replication.pull
        ? {
            ...config.replication.pull,
            handler: async (checkpoint, batchSize) => {
              const result = await config.replication.pull!.handler(checkpoint, batchSize);
              lastAppliedPullCheckpoint = (result.checkpoint ?? checkpoint) as
                | TCheckpoint
                | undefined;
              return result;
            },
          }
        : undefined,
      push: config.replication.push,
      live: config.replication.live,
      retryTime: config.replication.retryTime,
      autoStart: config.replication.autoStart,
      toggleOnDocumentVisible: config.replication.toggleOnDocumentVisible,
    });

    config.browserPolicy?.attach({
      replicationState,
      getLastAppliedPullCheckpoint: () => lastAppliedPullCheckpoint,
    });

    const collection = createCollection(
      rxdbCollectionOptions({
        rxCollection,
        startSync: config.startSync ?? true,
      }),
    );

    return {
      db,
      rxCollection,
      collection,
      replicationState,
    };
  }

  return {
    getContext,
    useReplicationState() {
      const [snapshot, setSnapshot] = useState<{
        active: boolean;
        error: unknown;
        replicationState?: RxReplicationState<TDoc, TCheckpoint>;
      }>({
        active: false,
        error: null,
      });

      useEffect(() => {
        let isDisposed = false;
        let subActive: { unsubscribe: () => void } | undefined;
        let subError: { unsubscribe: () => void } | undefined;

        void getContext()
          .then(({ replicationState }) => {
            if (isDisposed) return;

            setSnapshot((current) => ({
              ...current,
              replicationState,
            }));

            subActive = replicationState.active$.subscribe((active: boolean) => {
              setSnapshot((current) => ({
                ...current,
                active,
              }));
            });

            subError = replicationState.error$.subscribe((error: unknown) => {
              setSnapshot((current) => ({
                ...current,
                error: getReplicationError(error),
              }));
            });
          })
          .catch((error) => {
            if (isDisposed) return;

            setSnapshot((current) => ({
              ...current,
              error,
            }));
          });

        return () => {
          isDisposed = true;
          subActive?.unsubscribe();
          subError?.unsubscribe();
        };
      }, []);

      return snapshot;
    },
  };
}
