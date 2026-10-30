import * as React from "react";
import Box from "@mui/material/Box";
import Avatar from "@mui/material/Avatar";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import SignUp from "./SignUp.tsx";
import Link from "next/link";
import { useGlobalContext } from "../utils/ContextProvider";
import { loginRequestedEvent } from "../utils/authEvents.ts";
import { LogOut } from "../api/UserApi.ts";
export default function AccountMenu() {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };
  const { user, auth } = useGlobalContext();

  const [SignUpopen, setOpen] = React.useState(false);

  const SingUphandleClickOpen = () => {
    setOpen(true);
  };

  const SignUphandleClose = () => {
    setOpen(false);
  };

  React.useEffect(() => {
    const handleLoginRequest = () => setOpen(true);

    window.addEventListener(loginRequestedEvent, handleLoginRequest);
    return () => {
      window.removeEventListener(loginRequestedEvent, handleLoginRequest);
    };
  }, []);

  const handleLogOut = () => {
    LogOut().then(() => {
      window.location.reload();
    });
  };

  return (
    <React.Fragment>
      <Box className="header-account" sx={{ display: "flex", alignItems: "center", textAlign: "center" }}>
        <Tooltip title="Account settings">
          <IconButton
            onClick={handleClick}
            size="small"
            sx={{ ml: 2 }}
            aria-controls={open ? "account-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={open ? "true" : undefined}
          >
            <Avatar sx={{ width: 32, height: 32 }}></Avatar>
          </IconButton>
        </Tooltip>
      </Box>
      <Menu
        anchorEl={anchorEl}
        id="account-menu"
        open={open}
        onClose={handleClose}
        slotProps={{
          paper: {
            elevation: 0,
            sx: {
              overflow: "visible",
              filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
              mt: 1.5,
              "& .MuiAvatar-root": {
                width: 32,
                height: 32,
                ml: -0.5,
                mr: 1,
              },
              "&::before": {
                content: '""',
                display: "block",
                position: "absolute",
                top: 0,
                right: 14,
                width: 10,
                height: 10,
                bgcolor: "background.paper",
                transform: "translateY(-50%) rotate(45deg)",
                zIndex: 0,
              },
            },
          },
        }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        {auth && user === "admin" && (
          <MenuItem component={Link} href="/admin" onClick={handleClose}>
            Admin
          </MenuItem>
        )}
        {auth && user === "moderator" && (
          <MenuItem component={Link} href="/CardUpload" onClick={handleClose}>
            Card Upload
          </MenuItem>
        )}
        {!auth && (
          <MenuItem
            onClick={() => {
              SingUphandleClickOpen();
              handleClose();
            }}
          >
            Log In
          </MenuItem>
        )}
        {auth && <MenuItem onClick={handleLogOut}>Log Out</MenuItem>}
      </Menu>
      <SignUp open={SignUpopen} onClose={SignUphandleClose} />
    </React.Fragment>
  );
}
