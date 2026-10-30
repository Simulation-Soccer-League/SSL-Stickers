import { useEffect, type PropsWithChildren } from "react";
import { useRouter } from "next/router";
import { useGlobalContext } from "./ContextProvider";

interface RequireAuthProps extends PropsWithChildren {
  // Also exclude users with the "normal" role (card upload/approval pages).
  elevated?: boolean;
  // Only allow these roles (e.g. ["admin"]).
  roles?: readonly string[];
}

// Client-side guard only; API routes enforce authorization independently.
export default function RequireAuth({ children, elevated = false, roles }: RequireAuthProps) {
  const { user, auth, loading } = useGlobalContext();
  const router = useRouter();
  const allowed = auth && !(elevated && user === "normal") && (!roles || roles.includes(user));

  useEffect(() => {
    if (!loading && !allowed) {
      void router.replace("/");
    }
  }, [loading, allowed, router]);

  if (loading || !allowed) return null;

  return <>{children}</>;
}
