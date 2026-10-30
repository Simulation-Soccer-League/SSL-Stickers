import { DataGrid } from "@mui/x-data-grid";
import type { GridRowSelectionModel } from "@mui/x-data-grid";
import type { GridColDef } from "@mui/x-data-grid";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import { ApproveCards, DeleteCards } from "../api/CardApi.ts";
import Alert from "@mui/material/Alert";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useGlobalContext } from "../utils/ContextProvider";

import * as React from "react";

const columns: GridColDef[] = [
  { field: "id", headerName: "ID", width: 70 },
  { field: "name", headerName: "Name", width: 130 },
  { field: "cardtype", headerName: "Type", width: 130 },
  { field: "approved", headerName: "Approved", width: 130 },
];

interface Image {
  id: number;
  name: string;
  cardtype: string;
  approved: string;
}

interface TableProps {
  rows: Image[];
  // Called after a successful approve/delete; without it the page reloads.
  onChanged?: () => void;
}

const paginationModel = { page: 0, pageSize: 5 };

export default function DataTable({ rows, onChanged }: TableProps) {
  const [rowSelectionModel, setRowSelectionModel] =
    React.useState<GridRowSelectionModel>({ type: "include", ids: new Set() });
  const [submit, setSubmit] = React.useState(false);
  const [destroy, setDestroy] = React.useState(false);

  const [error, setError] = React.useState("");
  const [allRowIds, setAllRowIds] = React.useState<number[]>([]);
  const { user } = useGlobalContext();

  const darkTheme = createTheme({ palette: { mode: "dark" } });
  const afterChange = () => {
    setRowSelectionModel({ type: "include", ids: new Set() });
    setSubmit(false);
    setDestroy(false);
    if (onChanged) onChanged();
    else window.location.reload();
  };
  const handleApprove = () => {
    ApproveCards(
      rowSelectionModel.ids.size == 0 ? allRowIds : rowSelectionModel.ids
    )
      .then(afterChange)
      .catch((requestError: unknown) =>
        setError(requestError instanceof Error ? requestError.message : "Approval failed"),
      );
  };

  const handleDestroy = () => {
    DeleteCards(
      rowSelectionModel.ids.size == 0 ? allRowIds : rowSelectionModel.ids
    )
      .then(afterChange)
      .catch((requestError: unknown) =>
        setError(requestError instanceof Error ? requestError.message : "Delete failed"),
      );
  };

  React.useEffect(() => {
    if (!error) return;

    const timer = setTimeout(() => {
      setError("");
    }, 6000);

    return () => clearTimeout(timer);
  }, [error]);

  const rowSelectionModelChange = (newRowSelectionModel: GridRowSelectionModel) => {
    setRowSelectionModel(newRowSelectionModel);
    if (newRowSelectionModel.ids.size > 0) {
      setSubmit(true);
      setDestroy(true);
    } else if (newRowSelectionModel.type === "exclude") {
      const addAllRowIds = rows.map((row) => row.id);
      setAllRowIds(addAllRowIds);
      setSubmit(true);
      setDestroy(true);
    } else {
      setSubmit(false);
      setDestroy(false);
    }
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <Paper sx={{ height: 400, width: "100%" }}>
        <DataGrid
          rows={rows}
          columns={columns}
          initialState={{ pagination: { paginationModel } }}
          pageSizeOptions={[5, 10]}
          checkboxSelection
          onRowSelectionModelChange={rowSelectionModelChange}
          rowSelectionModel={rowSelectionModel}
          sx={{ border: 0 }}
        />
        {submit && user === "admin" && (
          <Button variant="contained" onClick={handleApprove}>
            Approve
          </Button>
        )}
        {destroy && user === "admin" && (
          <Button variant="contained" onClick={handleDestroy}>
            Delete
          </Button>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </Paper>
    </ThemeProvider>
  );
}
