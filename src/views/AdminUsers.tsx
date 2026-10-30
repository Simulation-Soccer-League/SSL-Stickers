import * as React from "react";
import { ThemeProvider } from "@mui/material/styles";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Snackbar from "@mui/material/Snackbar";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ROLES, listUsers, setUserRole, type AdminUser } from "../api/AdminApi.ts";
import { WhoAmI, type Role } from "../api/UserApi.ts";
import { adminTheme } from "../components/AdminLayout.tsx";

const ROLE_HELP: Record<Role, string> = {
  normal: "Packs, collection, trading and factory",
  moderator: "Also uploads cards (they wait for an admin to approve them)",
  admin: "Everything: publishes uploads directly, approves or removes cards, and manages roles",
};

const roleLabel = (role: Role) => ROLES.find((r) => r.value === role)?.label ?? role;

export default function AdminUsers() {
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<Role | "">("");
  const [result, setResult] = React.useState<{ users: AdminUser[]; total: number } | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [savingId, setSavingId] = React.useState<number | null>(null);
  const [message, setMessage] = React.useState<{ text: string; severity: "success" | "error" } | null>(null);
  const [meId, setMeId] = React.useState<number | null>(null);

  React.useEffect(() => {
    void WhoAmI().then((me) => setMeId(me ? me.id : null));
  }, []);

  // Reload when the filters change, debouncing typing.
  React.useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      listUsers(search, roleFilter)
        .then((data) => {
          if (!active) return;
          setResult(data);
          setLoadError("");
        })
        .catch((error: unknown) => {
          if (active) setLoadError(error instanceof Error ? error.message : "Unable to load users");
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, roleFilter]);

  const changeRole = async (user: AdminUser, role: Role) => {
    if (role === user.role) return;
    setSavingId(user.id);
    try {
      const updated = await setUserRole(user.id, role);
      setResult((prev) =>
        prev && {
          ...prev,
          users: roleFilter && updated.role !== roleFilter
            ? prev.users.filter((u) => u.id !== updated.id)
            : prev.users.map((u) => (u.id === updated.id ? updated : u)),
        },
      );
      setMessage({ text: `${updated.username} is now ${roleLabel(updated.role)}`, severity: "success" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not change the role", severity: "error" });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <ThemeProvider theme={adminTheme}>
      <Box sx={{ display: "grid", gap: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            User Roles
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Changes take effect on the user&apos;s next page load. You cannot change your own role.
          </Typography>
        </Box>

        <Box component="ul" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.25, color: "text.secondary", fontSize: "0.875rem" }}>
          {ROLES.map((role) => (
            <li key={role.value}>
              <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
                {role.label}
              </Box>
              {`: ${ROLE_HELP[role.value]}`}
            </li>
          ))}
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <TextField
            label="Search username"
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ flex: "1 1 220px" }}
          />
          <TextField
            select
            label="Role"
            size="small"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as Role | "")}
            sx={{ flex: "0 1 180px", minWidth: 150 }}
          >
            <MenuItem value="">All roles</MenuItem>
            {ROLES.map((role) => (
              <MenuItem key={role.value} value={role.value}>
                {role.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        {loadError && <Alert severity="error">{loadError}</Alert>}

        {!result && !loadError ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          result && (
            <>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small" aria-label="Users and roles">
                  <TableHead>
                    <TableRow>
                      <TableCell>Username</TableCell>
                      <TableCell sx={{ width: 190 }}>Role</TableCell>
                      <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                        Packs
                      </TableCell>
                      <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>Joined</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.users.map((user) => {
                      const isMe = user.id === meId;
                      return (
                        <TableRow key={user.id} hover>
                          <TableCell sx={{ wordBreak: "break-word" }}>
                            {user.username}
                            {isMe && (
                              <Box component="span" sx={{ ml: 1, color: "text.secondary" }}>
                                (you)
                              </Box>
                            )}
                          </TableCell>
                          <TableCell>
                            <Select
                              size="small"
                              fullWidth
                              value={user.role}
                              disabled={isMe || savingId === user.id}
                              onChange={(event) => void changeRole(user, event.target.value as Role)}
                              inputProps={{ "aria-label": `Role for ${user.username}` }}
                            >
                              {ROLES.map((role) => (
                                <MenuItem key={role.value} value={role.value}>
                                  {role.label}
                                </MenuItem>
                              ))}
                            </Select>
                          </TableCell>
                          <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
                            {user.packs_available}
                          </TableCell>
                          <TableCell sx={{ display: { xs: "none", sm: "table-cell" }, whiteSpace: "nowrap" }}>
                            {new Date(user.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {result.users.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} sx={{ color: "text.secondary" }}>
                          No users match.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              {result.total > result.users.length && (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Showing {result.users.length} of {result.total} users. Search to narrow the list.
                </Typography>
              )}
            </>
          )
        )}

        <Snackbar
          open={message !== null}
          autoHideDuration={4000}
          onClose={() => setMessage(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          {message ? (
            <Alert severity={message.severity} onClose={() => setMessage(null)} variant="filled">
              {message.text}
            </Alert>
          ) : undefined}
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}
