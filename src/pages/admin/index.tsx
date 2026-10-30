import AdminHome from "../../views/AdminHome.tsx";
import AdminLayout from "../../components/AdminLayout.tsx";
import RequireAuth from "../../utils/RequireAuth.tsx";

export default function AdminRoute() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminLayout>
        <AdminHome />
      </AdminLayout>
    </RequireAuth>
  );
}
