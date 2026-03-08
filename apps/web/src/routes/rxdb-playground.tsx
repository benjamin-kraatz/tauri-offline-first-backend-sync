import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@offline-first-backend-sync/ui/components/button";
import { Input } from "@offline-first-backend-sync/ui/components/input";

import {
  patchTodo,
  todosCollection,
  useAllTodosQuery,
  useTodosReplicationState,
} from "@/lib/rxdb";

export const Route = createFileRoute("/rxdb-playground")({
  component: RxdbPlaygroundComponent,
});

function RxdbPlaygroundComponent() {
  return (
    <div className="container mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">RxDB Playground</h1>
        <p className="text-muted-foreground text-sm">
          Interactive playground for RxDB with TanStack DB. Todos sync with the backend.
        </p>
      </div>

      <SyncStatus />

      <TodosPanel />
    </div>
  );
}

function SyncStatus() {
  const { active, error } = useTodosReplicationState();
  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-2 font-medium">Replication status</h2>
      <div className="flex items-center gap-2 text-sm">
        {error ? (
          <span className="text-destructive">{String(error)}</span>
        ) : active ? (
          <span className="text-muted-foreground">Syncing with backend…</span>
        ) : (
          <span className="text-muted-foreground">In sync</span>
        )}
      </div>
    </section>
  );
}

function TodosPanel() {
  const { data: todos } = useAllTodosQuery();
  const [newText, setNewText] = useState("");

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    const id = crypto.randomUUID();
    await todosCollection.insert({
      id,
      text: newText.trim(),
      completed: false,
      updatedAt: Date.now(),
    });
    setNewText("");
  };

  const toggleTodo = async (id: string, completed: boolean) => {
    await patchTodo(id, { completed });
  };

  const removeTodo = async (id: string) => {
    await patchTodo(id, { removed: true });
  };

  type TodoItem = { id: string; text: string; completed?: boolean; updatedAt: number; removed?: boolean };
  const visibleTodos = ((todos ?? []) as TodoItem[]).filter((t) => !t.removed);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 font-medium">Todos</h2>
      <p className="mb-4 text-muted-foreground text-xs">
        Reactive via useLiveQuery — updates automatically when data changes.
      </p>
      <form onSubmit={addTodo} className="mb-4 flex gap-2">
        <Input
          placeholder="New todo…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>
      <ul className="space-y-2">
        {visibleTodos.map((t) => (
          <li key={String(t.id)} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={t.completed ?? false}
              onChange={() => toggleTodo(String(t.id), !t.completed)}
              className="h-4 w-4"
            />
            <span className={t.completed ? "text-muted-foreground line-through" : ""}>
              {String(t.text)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => removeTodo(String(t.id))}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
      {visibleTodos.length === 0 && (
        <p className="text-muted-foreground text-sm">No todos. Add one above.</p>
      )}
    </section>
  );
}
