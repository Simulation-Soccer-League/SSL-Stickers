import AdminUsers from "../../views/AdminUsers.tsx";
import AdminLayout from "../../components/AdminLayout.tsx";
import RequireAuth from "../../utils/RequireAuth.tsx";

export default function AdminUsersRoute() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminLayout>
        <AdminUsers />
      </AdminLayout>
    </RequireAuth>
  );
}
