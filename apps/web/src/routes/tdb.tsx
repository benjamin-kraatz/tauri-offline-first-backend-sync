import { usersCollection, useUnverifiedUsersQuery, useVerifiedUsersQuery } from "@/lib/tdb";
import { Button } from "@offline-first-backend-sync/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircleIcon, XCircleIcon } from "lucide-react";

export const Route = createFileRoute("/tdb")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: verifiedUsers } = useVerifiedUsersQuery();
  const { data: unverifiedUsers } = useUnverifiedUsersQuery();

  return (
    <div>
      <h1>Verified Users</h1>
      <ul>
        {verifiedUsers?.map((user) => (
          <li key={user.id} className="flex items-center gap-2">
            <span>{user.name ?? "No name"}</span>{" "}
            <span className="flex items-center gap-2">
              &lt;{user.email} ({user.emailVerified ? <CheckCircleIcon /> : <XCircleIcon />})&gt;
            </span>
            <ToggleVerified id={user.id} emailVerified={user.emailVerified} />
          </li>
        ))}
      </ul>

      <div className="h-8" />

      <h1>Unverified Users</h1>
      <ul>
        {unverifiedUsers?.map((user) => (
          <li key={user.id} className="flex items-center gap-2">
            <span>{user.name ?? "No name"}</span>{" "}
            <span className="flex items-center gap-2">
              &lt;{user.email} ({user.emailVerified ? <CheckCircleIcon /> : <XCircleIcon />})&gt;
            </span>
            <ToggleVerified id={user.id} emailVerified={user.emailVerified} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToggleVerified(user: { id: string; emailVerified: number | null }) {
  const updateUser = async () => {
    usersCollection.update(user.id, (draft) => {
      draft.email_verified = user.emailVerified ? 0 : 1;
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        updateUser();
      }}
    >
      {user.emailVerified ? "Unverify" : "Verify"}
    </Button>
  );
}
