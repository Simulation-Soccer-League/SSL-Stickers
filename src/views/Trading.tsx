import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryIcon from "@mui/icons-material/History";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import TradeModal from "../components/TradeModal.tsx";
import { Users } from "../api/UserApi";
import { Trades } from "../api/TradingApi.ts";

interface TradesResponse {
  trades?: number[];
  current_user_accept?: boolean[];
  user2_name?: string[];
  current_user_rarities?: Record<string, number>[];
  other_user_rarities?: Record<string, number>[];
  trade_errors?: boolean[];
  history?: TradeHistory[];
}

interface LiveTrade {
  id: number;
  otherUser: string;
  waitingOnOtherUser: boolean;
  offeredRarities: Record<string, number>;
  requestedRarities: Record<string, number>;
  hasError: boolean;
}

interface TradeHistory {
  id: number;
  other_user: string | null;
  status: "accepted" | "declined";
  offered_card_count: number;
  offered_rarity_counts: Record<string, number>;
  received_card_count: number;
  received_rarity_counts: Record<string, number>;
  completed_at: string;
}

const rarityColors: Record<string, string> = {
  Bronze: "#A97142",
  Silver: "#C0C0C0",
  Gold: "#FFD700",
  Diamond: "#B9F2FF",
};

const rarityOrder = ["Diamond", "Gold", "Silver", "Bronze"];

export default function Trading() {
  const [open, setOpen] = React.useState(false);
  const [allUsers, setAllUsers] = React.useState<string[]>([]);
  const [liveTrades, setLiveTrades] = React.useState<LiveTrade[]>([]);
  const [tradeHistory, setTradeHistory] = React.useState<TradeHistory[]>([]);
  const [tradeIndex, setTradeIndex] = React.useState<number | undefined>();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const loadTradingPage = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const [usersResult, tradesResult] = await Promise.all([
          Users() as Promise<string[]>,
          Trades() as Promise<TradesResponse>,
        ]);

        if (cancelled) {
          return;
        }

        const tradeIds = tradesResult.trades ?? [];
        const tradeAcceptances = tradesResult.current_user_accept ?? [];
        const tradeUsers = tradesResult.user2_name ?? [];
        const currentUserRarities = tradesResult.current_user_rarities ?? [];
        const otherUserRarities = tradesResult.other_user_rarities ?? [];
        const tradeErrors = tradesResult.trade_errors ?? [];

        setAllUsers(usersResult ?? []);
        setTradeHistory(tradesResult.history ?? []);
        setLiveTrades(
          tradeIds.map((id, index) => ({
            id,
            otherUser: tradeUsers[index] ?? "Unknown user",
            waitingOnOtherUser: tradeAcceptances[index] ?? false,
            offeredRarities: currentUserRarities[index] ?? {},
            requestedRarities: otherUserRarities[index] ?? {},
            hasError: tradeErrors[index] ?? false,
          })),
        );
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Unable to load trades",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadTradingPage();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const openNewTrade = () => {
    setTradeIndex(undefined);
    setOpen(true);
  };

  const openTrade = (tradeId: number) => {
    setTradeIndex(tradeId);
    setOpen(true);
  };

  const renderRarityCounts = (counts: Record<string, number>) => {
    const rarities = rarityOrder.filter((rarity) => counts[rarity] > 0);

    if (rarities.length === 0) {
      return (
        <Typography variant="caption" sx={{ color: "#9ca3af" }}>
          No cards
        </Typography>
      );
    }

    return rarities.map((rarity) => (
      <Chip
        key={rarity}
        size="small"
        label={`${counts[rarity]} ${rarity}`}
        sx={{
          height: 24,
          color: "#ffffff",
          fontSize: "0.72rem",
          fontWeight: 800,
          backgroundColor: "#111827",
          border: `1px solid ${rarityColors[rarity]}`,
        }}
      />
    ));
  };

  const historySideSummary = (
    cardCount: number,
    rarityCounts: Record<string, number>,
  ) => {
    const raritySummary = rarityOrder
      .filter((rarity) => rarityCounts[rarity] > 0)
      .map((rarity) => `${rarityCounts[rarity]} ${rarity}`)
      .join(", ");

    return `${cardCount} card${cardCount === 1 ? "" : "s"}${
      raritySummary ? ` (${raritySummary})` : ""
    }`;
  };

  const historyCardSummary = (trade: TradeHistory) =>
    `${historySideSummary(
      trade.offered_card_count,
      trade.offered_rarity_counts,
    )} for ${historySideSummary(
      trade.received_card_count,
      trade.received_rarity_counts,
    )}`;

  return (
    <>
      <Box
        sx={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 2.5,
        }}
      >
        <Paper
          elevation={4}
          sx={{
            p: { xs: 2, sm: 3 },
            color: "#ffffff",
            background:
              "linear-gradient(135deg, #111827 0%, #222831 55%, #303846 100%)",
            border: "1px solid #596273",
            borderRadius: 3,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: { xs: "stretch", sm: "center" },
              justifyContent: "space-between",
              flexDirection: { xs: "column", sm: "row" },
              gap: 2,
            }}
          >
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                <SwapHorizIcon sx={{ color: "#bd9523", fontSize: 34 }} />
                <Typography variant="h4" sx={{ fontWeight: 800 }}>
                  Trading Center
                </Typography>
              </Box>
              <Typography sx={{ mt: 0.75, color: "#cbd5e1" }}>
                Review active offers or start a new card trade.
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openNewTrade}
              sx={{
                minHeight: 44,
                px: 2.5,
                fontWeight: 800,
                backgroundColor: "#bd9523",
                color: "#111827",
                "&:hover": { backgroundColor: "#d4ad3d" },
              }}
            >
              Create Trade
            </Button>
          </Box>
        </Paper>

        <Box
          component="section"
          sx={{
            p: { xs: 1.5, sm: 2.5 },
            borderRadius: 3,
            border: "1px solid #596273",
            backgroundColor: "#222831",
          }}
        >
          <Box
            sx={{
              mb: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="h5" sx={{ color: "#ffffff", fontWeight: 800 }}>
                Active Trades
              </Typography>
              <Typography variant="body2" sx={{ color: "#9ca3af" }}>
                Select an offer to review or update its cards.
              </Typography>
            </Box>
            <Chip
              label={`${liveTrades.length} active`}
              sx={{
                color: "#ffffff",
                fontWeight: 800,
                backgroundColor: "#374151",
                border: "1px solid #6b7280",
              }}
            />
          </Box>

          {loadError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {loadError}
            </Alert>
          )}

          {isLoading ? (
            <Box sx={{ minHeight: 220, display: "grid", placeItems: "center" }}>
              <CircularProgress />
            </Box>
          ) : liveTrades.length === 0 ? (
            <Box
              sx={{
                minHeight: 240,
                px: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                border: "1px dashed #6b7280",
                borderRadius: 2,
                color: "#cbd5e1",
                backgroundColor: "#1b2028",
              }}
            >
              <SwapHorizIcon sx={{ mb: 1, fontSize: 48, color: "#77808f" }} />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                No active trades
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, mb: 2 }}>
                Create an offer to start trading stickers with another user.
              </Typography>
              <Button variant="outlined" startIcon={<AddIcon />} onClick={openNewTrade}>
                Create Your First Trade
              </Button>
            </Box>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                },
                gap: 1.5,
              }}
            >
              {liveTrades.map((trade) => {
                const needsAction = !trade.waitingOnOtherUser;

                return (
                  <Paper
                    key={trade.id}
                    component="button"
                    type="button"
                    onClick={() => openTrade(trade.id)}
                    elevation={0}
                    sx={{
                      p: 0,
                      width: "100%",
                      overflow: "hidden",
                      display: "grid",
                      gridTemplateColumns: "7px minmax(0, 1fr) auto",
                      alignItems: "stretch",
                      textAlign: "left",
                      color: "#ffffff",
                      cursor: "pointer",
                      border: "1px solid #4b5563",
                      borderRadius: 2,
                      backgroundColor: "#1f2937",
                      transition:
                        "transform 0.16s ease, border-color 0.16s ease, background-color 0.16s ease",
                      "&:hover": {
                        transform: "translateY(-2px)",
                        borderColor: trade.hasError
                          ? "#ef4444"
                          : needsAction
                            ? "#bd9523"
                            : "#77808f",
                        backgroundColor: "#2b3442",
                      },
                    }}
                  >
                    <Box
                      sx={{
                        backgroundColor: trade.hasError
                          ? "#ef4444"
                          : needsAction
                            ? "#bd9523"
                            : "#64748b",
                      }}
                    />
                    <Box sx={{ p: 2, minWidth: 0 }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 1,
                        }}
                      >
                        <Typography
                          variant="overline"
                          sx={{ color: "#9ca3af", fontWeight: 800 }}
                        >
                          Trade #{trade.id}
                        </Typography>
                        {trade.hasError && (
                          <Chip
                            size="small"
                            label="Trade Error"
                            color="error"
                            sx={{ height: 24, fontWeight: 800 }}
                          />
                        )}
                      </Box>
                      <Typography
                        variant="h6"
                        sx={{
                          mt: -0.25,
                          fontWeight: 800,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {trade.otherUser}
                      </Typography>
                      <Box
                        sx={{
                          mt: 1.25,
                          p: 1,
                          display: "grid",
                          gridTemplateColumns: "auto minmax(0, 1fr)",
                          alignItems: "center",
                          gap: 0.75,
                          borderRadius: 1.5,
                          backgroundColor: "#18202b",
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ color: "#9ca3af", fontWeight: 800 }}
                        >
                          You give
                        </Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          {renderRarityCounts(trade.offeredRarities)}
                        </Box>
                        <Typography
                          variant="caption"
                          sx={{ color: "#9ca3af", fontWeight: 800 }}
                        >
                          You get
                        </Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          {renderRarityCounts(trade.requestedRarities)}
                        </Box>
                      </Box>
                      <Box
                        sx={{
                          mt: 1.25,
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                          color: needsAction ? "#f6d365" : "#cbd5e1",
                        }}
                      >
                        {needsAction ? (
                          <TouchAppIcon fontSize="small" />
                        ) : (
                          <HourglassTopIcon fontSize="small" />
                        )}
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {needsAction
                            ? "Your action is required"
                            : `Waiting for ${trade.otherUser}`}
                        </Typography>
                      </Box>
                    </Box>
                    <Box
                      sx={{
                        px: 1.5,
                        display: "grid",
                        placeItems: "center",
                        color: "#cbd5e1",
                      }}
                    >
                      <ArrowForwardIcon />
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          )}
        </Box>

        <Accordion
          disableGutters
          sx={{
            color: "#ffffff",
            border: "1px solid #596273",
            borderRadius: "12px !important",
            backgroundColor: "#222831",
            "&::before": { display: "none" },
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon sx={{ color: "#cbd5e1" }} />}
            aria-controls="trade-history-content"
            id="trade-history-header"
            sx={{
              minHeight: 52,
              px: 2,
              "& .MuiAccordionSummary-content": {
                my: 1,
                alignItems: "center",
                gap: 1,
              },
            }}
          >
            <HistoryIcon sx={{ color: "#bd9523" }} />
            <Typography sx={{ fontWeight: 800 }}>Trade History</Typography>
            <Chip
              size="small"
              label={tradeHistory.length}
              sx={{
                height: 22,
                color: "#d1d5db",
                backgroundColor: "#374151",
              }}
            />
          </AccordionSummary>
          <AccordionDetails id="trade-history-content" sx={{ px: 1.5, pt: 0, pb: 1.5 }}>
            {tradeHistory.length === 0 ? (
              <Typography
                variant="body2"
                sx={{ px: 0.5, py: 1, color: "#9ca3af" }}
              >
                No completed or declined trades yet.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                {tradeHistory.map((trade) => (
                  <Box
                    key={trade.id}
                    sx={{
                      minHeight: 38,
                      px: 1.25,
                      py: 0.5,
                      display: "grid",
                      gridTemplateColumns: {
                        xs: "minmax(0, 1fr) auto",
                        sm: "160px minmax(0, 1fr) 105px auto",
                      },
                      alignItems: "center",
                      gap: 1,
                      borderRadius: 1.25,
                      backgroundColor: "#1b2028",
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        minWidth: 0,
                        fontWeight: 800,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {trade.other_user ?? "Unknown user"}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        minWidth: 0,
                        color: "#cbd5e1",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: { xs: "none", sm: "block" },
                      }}
                    >
                      {historyCardSummary(trade)}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "#9ca3af",
                        display: { xs: "none", sm: "block" },
                      }}
                    >
                      {new Date(trade.completed_at).toLocaleDateString()}
                    </Typography>
                    <Chip
                      size="small"
                      label={trade.status}
                      color={trade.status === "accepted" ? "success" : "error"}
                      sx={{
                        height: 24,
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        textTransform: "capitalize",
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        gridColumn: "1 / -1",
                        color: "#9ca3af",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: { xs: "block", sm: "none" },
                      }}
                    >
                      {historyCardSummary(trade)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </AccordionDetails>
        </Accordion>
      </Box>

      <TradeModal
        open={open}
        onClose={() => {
          setOpen(false);
          setRefreshKey((current) => current + 1);
        }}
        users={allUsers}
        trade_id={tradeIndex}
        setTradeId={setTradeIndex}
      />
    </>
  );
}
