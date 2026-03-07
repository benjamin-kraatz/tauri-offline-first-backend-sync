import { usersCollection } from "@/lib/tdb";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircleIcon, XCircleIcon } from "lucide-react";

export const Route = createFileRoute("/tdb")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: allUsers } = useLiveQuery((q) => {
    return (
      q
        .from({ user: usersCollection })
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
        }))
    );
  });

  console.log("All users:", allUsers);
  const verifiedUsers = allUsers?.filter((user) => {
    console.log("User emailVerified:", user.emailVerified, typeof user.emailVerified);
    return user.emailVerified === "t" || user.emailVerified === "1" || user.emailVerified === "true";
  }) ?? [];

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
          </li>
        ))}
      </ul>
    </div>
  );
}
