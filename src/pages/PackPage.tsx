import PackPage from "../views/PackPage.tsx";
import RequireAuth from "../utils/RequireAuth.tsx";

export default function PackPageRoute() {
  return (
    <RequireAuth>
      <PackPage />
    </RequireAuth>
  );
}
