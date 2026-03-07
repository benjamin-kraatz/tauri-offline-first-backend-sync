import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";
import { useUsers, insertUser, updateUser, deleteUser } from "@/lib/psync";
import type { User } from "@/lib/psync";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

const TITLE_TEXT = `
 ██████╗ ███████╗████████╗████████╗███████╗██████╗
 ██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗
 ██████╔╝█████╗     ██║      ██║   █████╗  ██████╔╝
 ██╔══██╗██╔══╝     ██║      ██║   ██╔══╝  ██╔══██╗
 ██████╔╝███████╗   ██║      ██║   ███████╗██║  ██║
 ╚═════╝ ╚══════╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝

 ████████╗    ███████╗████████╗ █████╗  ██████╗██╗  ██╗
 ╚══██╔══╝    ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝
    ██║       ███████╗   ██║   ███████║██║     █████╔╝
    ██║       ╚════██║   ██║   ██╔══██║██║     ██╔═██╗
    ██║       ███████║   ██║   ██║  ██║╚██████╗██║  ██╗
    ╚═╝       ╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
 `;

function HomeComponent() {
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());
  const pwrsncGetPub = useQuery(
    orpc.pub__powersyncGet.queryOptions({
      refetchOnWindowFocus: true,
      refetchInterval: 10000,
    }),
  );

  // Live reactive query — updates automatically when local DB changes
  const { data: users, loading: usersLoading } = useUsers();

  // Insert form state
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleInsert = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newName || !newEmail) return;
    await insertUser({
      name: newName,
      email: newEmail,
      email_verified: 0,
      image: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setNewName("");
    setNewEmail("");
  };

  const handleUpdateSave = async (id: string) => {
    await updateUser(id, { name: editName, updated_at: new Date().toISOString() });
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteUser(id);
  };

  const startEdit = (user: User) => {
    setEditingId(user.id);
    setEditName(user.name ?? "");
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-2">
      <pre className="overflow-x-auto font-mono text-sm">{TITLE_TEXT}</pre>
      <div className="grid gap-6">

        {/* API Status */}
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-medium">API Status</h2>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${healthCheck.data ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-sm text-muted-foreground">
              {healthCheck.isLoading ? "Checking..." : healthCheck.data ? "Connected" : "Disconnected"}
            </span>
          </div>
        </section>

        {/* Backend query via API */}
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-medium">Read — via API (Postgres direct)</h2>
          <div className="flex items-start gap-2">
            <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${pwrsncGetPub.isLoading ? "bg-yellow-500" : pwrsncGetPub.isError ? "bg-red-500" : "bg-green-500"}`} />
            <span className="text-sm text-muted-foreground">
              {pwrsncGetPub.isLoading && <span className="text-yellow-500">Loading...</span>}
              {pwrsncGetPub.isError && <span className="text-red-500">{pwrsncGetPub.error.message}</span>}
              {pwrsncGetPub.data && (
                <pre className="overflow-x-auto font-mono text-xs">{JSON.stringify(pwrsncGetPub.data, null, 2)}</pre>
              )}
            </span>
          </div>
        </section>

        {/* Live reactive query via PowerSync watch */}
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-medium">Read — live watch (PowerSync local SQLite)</h2>
          <div className="flex items-start gap-2">
            <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${usersLoading ? "bg-yellow-500" : "bg-green-500"}`} />
            <div className="flex-1 text-sm text-muted-foreground">
              {usersLoading && <span className="text-yellow-500">Waiting for first sync...</span>}
              {!usersLoading && users.length === 0 && <span>No users found.</span>}
              {!usersLoading && users.length > 0 && (
                <ul className="space-y-2">
                  {users.map((u) => (
                    <li key={u.id} className="flex items-center gap-2">
                      {editingId === u.id ? (
                        <>
                          <input
                            className="rounded border px-2 py-0.5 text-sm"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <button
                            className="rounded bg-green-600 px-2 py-0.5 text-xs text-white"
                            onClick={() => handleUpdateSave(u.id)}
                          >
                            Save
                          </button>
                          <button
                            className="rounded bg-gray-400 px-2 py-0.5 text-xs text-white"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="font-mono text-xs">{u.name} &lt;{u.email}&gt;</span>
                          <button
                            className="rounded bg-blue-500 px-2 py-0.5 text-xs text-white"
                            onClick={() => startEdit(u)}
                          >
                            Edit
                          </button>
                          <button
                            className="rounded bg-red-500 px-2 py-0.5 text-xs text-white"
                            onClick={() => handleDelete(u.id)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        {/* Write — insert new user */}
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-medium">Write — insert user (local, syncs via uploadData)</h2>
          <form onSubmit={handleInsert} className="flex flex-wrap gap-2">
            <input
              className="rounded border px-2 py-1 text-sm"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="rounded border px-2 py-1 text-sm"
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={!newName || !newEmail}
            >
              Insert
            </button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Inserts locally into SQLite. The live watch above updates instantly. <code>uploadData</code> will be called to sync back to Postgres (currently logs a warning).
          </p>
        </section>

      </div>
    </div>
  );
}
