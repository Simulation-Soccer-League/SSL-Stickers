import * as React from "react";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Badge from "@mui/material/Badge";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";

import Link from "next/link";
import { useRouter } from "next/router";
import { useGlobalContext } from "../utils/ContextProvider.tsx";
import { requestLogin } from "../utils/authEvents.ts";
import {
  Trades,
  tradesUpdatedEvent,
} from "../api/TradingApi.ts";

interface TradesResponse {
  current_user_accept?: boolean[];
}

export default function FunMenu() {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [loadedPendingTradeCount, setPendingTradeCount] = React.useState(0);
  const router = useRouter();

  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!auth) {
      requestLogin();
      return;
    }

    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };
  const { auth } = useGlobalContext();
  // Logged-out visitors have no pending trades.
  const pendingTradeCount = auth ? loadedPendingTradeCount : 0;

  const fetchPendingTradeCount = React.useCallback(async (): Promise<number> => {
    if (!auth) return 0;

    try {
      const result = await Trades() as TradesResponse;
      return result.current_user_accept?.filter(
        (accepted) => !accepted,
      ).length ?? 0;
    } catch {
      return 0;
    }
  }, [auth]);

  React.useEffect(() => {
    let active = true;
    void fetchPendingTradeCount().then((count) => {
      if (active) setPendingTradeCount(count);
    });
    return () => {
      active = false;
    };
  }, [fetchPendingTradeCount, router.pathname]);

  React.useEffect(() => {
    if (!auth) {
      return;
    }

    const refreshPendingTrades = () => {
      void fetchPendingTradeCount().then(setPendingTradeCount);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshPendingTrades();
      }
    };
    const intervalId = window.setInterval(refreshPendingTrades, 30_000);

    window.addEventListener("focus", refreshPendingTrades);
    window.addEventListener(tradesUpdatedEvent, refreshPendingTrades);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshPendingTrades);
      window.removeEventListener(tradesUpdatedEvent, refreshPendingTrades);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [auth, fetchPendingTradeCount]);

  return (
    <React.Fragment>
      <Box sx={{ display: "flex", alignItems: "center", textAlign: "center" }}>
        <Button
          onClick={handleClick}
          variant="text"
          size="small"
          sx={{ height: "100%", color: "#ffffff" }}
          aria-controls={auth && open ? "account-menu" : undefined}
          aria-haspopup={auth ? "true" : undefined}
          aria-expanded={auth && open ? "true" : undefined}
          aria-label={
            pendingTradeCount > 0
              ? `Trading, ${pendingTradeCount} pending action`
              : "Trading"
          }
        >
          Trading
          {pendingTradeCount > 0 && (
            <Badge
              badgeContent={pendingTradeCount}
              color="error"
              max={9}
              sx={{ ml: 1 }}
            >
              <NotificationsActiveIcon
                sx={{ color: "#f6d365", fontSize: 20 }}
              />
            </Badge>
          )}
        </Button>
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
        {auth && (
          <MenuItem component={Link} href="/Trading" onClick={handleClose}>
            Trading
            {pendingTradeCount > 0 && (
              <Badge
                badgeContent={pendingTradeCount}
                color="error"
                max={9}
                sx={{ ml: 1.5 }}
              >
                <NotificationsActiveIcon
                  sx={{ color: "#bd9523", fontSize: 20 }}
                />
              </Badge>
            )}
          </MenuItem>
        )}
        {auth && (
          <MenuItem component={Link} href="/Factory" onClick={handleClose}>
            Factory
          </MenuItem>
        )}
      </Menu>
    </React.Fragment>
  );
}
