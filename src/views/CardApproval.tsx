import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import Table from "../components/Table.tsx";
import { adminTheme } from "../components/AdminLayout.tsx";
import { UnapprovedCards, type OriginalCard } from "../api/CardApi.ts";

// Admin review queue: cards uploaded by moderators that are waiting to be
// approved (published) or deleted.
export default function CardApproval() {
  const [queue, setQueue] = React.useState<OriginalCard[] | null>(null);
  const [error, setError] = React.useState("");
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    UnapprovedCards()
      .then((result) => {
        if (!active) return;
        setQueue(result.all_cards);
        setError("");
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Unable to load the queue");
      });
    return () => {
      active = false;
    };
  }, [version]);

  return (
    <ThemeProvider theme={adminTheme}>
      <Box
        sx={{
          width: "100%",
          maxWidth: 760,
          mx: "auto",
          display: "grid",
          // minmax(0, …) lets the table scroll instead of widening the page on phones.
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 1.5,
          color: "text.primary",
        }}
      >
        <Typography component="h2" variant="h6" sx={{ fontWeight: 700 }}>
          Card Approval{queue ? ` (${queue.length})` : ""}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Cards uploaded by moderators wait here. Select cards (the header checkbox selects them all), then
          <strong> Approve</strong> to publish them or <strong>Delete</strong> to remove them and their images.
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}
        {!queue && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {queue && queue.length === 0 && (
          <Typography sx={{ color: "text.secondary", py: 2 }}>Nothing is waiting for approval.</Typography>
        )}
        {queue && queue.length > 0 && (
          <Table
            rows={queue.map((card) => ({ ...card, name: card.name ?? "", approved: String(card.approved) }))}
            onChanged={() => setVersion((v) => v + 1)}
          />
        )}
      </Box>
    </ThemeProvider>
  );
}
