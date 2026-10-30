import * as React from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { getUser } from "../api/UserApi.ts";

interface SignUpProps {
  open: boolean;
  onClose: () => void;
}

export default function FormDialog({ open, onClose }: SignUpProps) {
  const textFieldSx = {
    "& .MuiInputBase-input": {
      color: "#111827",
      caretColor: "#111827",
      cursor: "text",
    },
  };

  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("UserName") ?? "");
    const password = String(formData.get("password") ?? "");

    setSubmitting(true);
    setError("");
    try {
      await getUser(username, password);
      window.location.reload();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(message === "Invalid credentials" ? "Incorrect username or password." : message || "Login failed.");
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setError("");
    onClose();
  };

  return (
    <React.Fragment>
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>Sign In</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}
          <form onSubmit={handleSubmit} id="subscription-form">
            <TextField
              autoFocus
              required
              margin="dense"
              id="name"
              name="UserName"
              label="User Name"
              type="username"
              fullWidth
              variant="standard"
              sx={textFieldSx}
            />
            <TextField
              required
              margin="dense"
              id="password"
              name="password"
              label="Password"
              type="password"
              fullWidth
              variant="standard"
              sx={textFieldSx}
            />
          </form>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button type="submit" form="subscription-form" disabled={submitting}>
            {submitting ? "Logging In…" : "Log In"}
          </Button>
        </DialogActions>
      </Dialog>
    </React.Fragment>
  );
}
