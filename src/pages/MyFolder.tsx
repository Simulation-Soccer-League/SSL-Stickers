import MyFolder from "../views/MyFolder.tsx";
import RequireAuth from "../utils/RequireAuth.tsx";

export default function MyFolderRoute() {
  return (
    <RequireAuth>
      <MyFolder />
    </RequireAuth>
  );
}
