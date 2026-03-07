import { usersCollection } from "@/lib/tdb";
import { Button } from "@offline-first-backend-sync/ui/components/button";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircleIcon, XCircleIcon } from "lucide-react";

export const Route = createFileRoute("/tdb")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: verifiedUsers } = useLiveQuery((q) => {
    return q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.email_verified, 1))
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.email_verified,
      }));
  });
  const { data: unverifiedUsers } = useLiveQuery((q) => {
    return q
      .from({ user: usersCollection })
      .where(({ user }) => eq(user.email_verified, 0))
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.email_verified,
      }));
  });

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
    await usersCollection.update(user.id, (draft) => {
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
