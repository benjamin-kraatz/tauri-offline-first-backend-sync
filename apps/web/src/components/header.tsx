import { Badge } from "@offline-first-backend-sync/ui/components/badge";
import { Link } from "@tanstack/react-router";

import { useTodosReplicationState } from "@/lib/rxdb";
import { useAllUsersQuery } from "@/lib/tdb";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/tdb", label: "With Tanstack DB" },
    { to: "/rxdb-playground", label: "RxDB Playground" },
  ] as const;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => {
            return (
              <Link key={to} to={to}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <TodosSyncBadge />
          <AllUsersCountBadge />
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}

function TodosSyncBadge() {
  const { active, error } = useTodosReplicationState();
  if (error) {
    return <Badge variant="destructive">Todos: sync error</Badge>;
  }
  if (active) {
    return <Badge variant="secondary">Todos: syncing…</Badge>;
  }
  return <Badge variant="outline">Todos: in sync</Badge>;
}

function AllUsersCountBadge() {
  const { data: allUsers } = useAllUsersQuery();
  const allUsersCount = allUsers?.length ?? 0;

  return <Badge variant="outline">{allUsersCount}</Badge>;
}
