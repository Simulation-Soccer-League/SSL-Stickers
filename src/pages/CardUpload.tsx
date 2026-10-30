import CardUpload from "../views/CardUpload.tsx";
import AdminLayout from "../components/AdminLayout.tsx";
import RequireAuth from "../utils/RequireAuth.tsx";
import { useGlobalContext } from "../utils/ContextProvider.tsx";

export default function CardUploadRoute() {
  const { user } = useGlobalContext();
  return (
    <RequireAuth elevated>
      {/* Admins reach this page from the admin area, so show its navigation. */}
      {user === "admin" ? (
        <AdminLayout>
          <CardUpload />
        </AdminLayout>
      ) : (
        <CardUpload />
      )}
    </RequireAuth>
  );
}
