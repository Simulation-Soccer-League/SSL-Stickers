import FactoryPage from "../views/FactoryPage.tsx";
import RequireAuth from "../utils/RequireAuth.tsx";

export default function FactoryRoute() {
  return (
    <RequireAuth>
      <FactoryPage />
    </RequireAuth>
  );
}
