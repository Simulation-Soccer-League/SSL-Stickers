import Trading from "../views/Trading.tsx";
import RequireAuth from "../utils/RequireAuth.tsx";

export default function TradingRoute() {
  return (
    <RequireAuth>
      <Trading />
    </RequireAuth>
  );
}
