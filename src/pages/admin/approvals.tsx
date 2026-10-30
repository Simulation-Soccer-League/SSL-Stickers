import CardApproval from "../../views/CardApproval.tsx";
import AdminLayout from "../../components/AdminLayout.tsx";
import RequireAuth from "../../utils/RequireAuth.tsx";

export default function CardApprovalRoute() {
  return (
    <RequireAuth roles={["admin"]}>
      <AdminLayout>
        <CardApproval />
      </AdminLayout>
    </RequireAuth>
  );
}
