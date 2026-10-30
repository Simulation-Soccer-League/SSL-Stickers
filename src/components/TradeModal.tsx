import * as React from "react";
import Box from "@mui/material/Box";
import Modal from "@mui/material/Modal";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Select from "@mui/material/Select";
import type { SelectChangeEvent } from "@mui/material/Select";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import CircularProgress from "@mui/material/CircularProgress";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { AdvancedImage, placeholder, lazyload } from "@cloudinary/react";
import {
  createTrade,
  GetTrade,
  DestroyTrade,
  updateTrade,
} from "../api/TradingApi.ts";
import { TradeCardOptions } from "../api/UserCardApi.ts";
import { cld } from "../lib/cloudinary.ts";

const modalStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(1180px, 96vw)",
  maxHeight: "92vh",
  bgcolor: "#111827",
  color: "#ffffff",
  border: "1px solid #4b5563",
  borderRadius: 3,
  boxShadow: 24,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const rarityColors: Record<string, string> = {
  Bronze: "#A97142",
  Silver: "#C0C0C0",
  Gold: "#FFD700",
  Diamond: "#B9F2FF",
};

type TradeModalProps = {
  open: boolean;
  onClose: () => void;
  users: string[];
  trade_id?: number;
  setTradeId: (id?: number) => void;
};

type CardItem = {
  card_name: string;
  season: number;
  api_id: string;
  uuid: string;
  cardtype: string;
};

type TradeCardOption = Omit<CardItem, "uuid"> & {
  owned_count: number;
  uuids: string[];
  current_user_owns: boolean;
};

type TradeSide = "mine" | "theirs";

export default function TradeModal({
  open,
  onClose,
  users,
  trade_id,
  setTradeId,
}: TradeModalProps) {
  const [user, setUser] = React.useState("");
  const [canSubmit, setCanSubmit] = React.useState(true);
  const [alert, setAlert] = React.useState(0);
  const [actionError, setActionError] = React.useState("");
  const [problemCardIds, setProblemCardIds] = React.useState<string[]>([]);
  const [myCards, setMyCards] = React.useState<CardItem[]>([]);
  const [theirCards, setTheirCards] = React.useState<CardItem[]>([]);
  const [pickerSide, setPickerSide] = React.useState<TradeSide | null>(null);
  const [pickerCards, setPickerCards] = React.useState<TradeCardOption[]>([]);
  const [pickerSelections, setPickerSelections] = React.useState<CardItem[]>([]);
  const [pickerRarity, setPickerRarity] = React.useState("All");
  const [pickerSearch, setPickerSearch] = React.useState("");
  const [duplicatesOnly, setDuplicatesOnly] = React.useState(false);
  const [unownedOnly, setUnownedOnly] = React.useState(false);
  const [pickerLoading, setPickerLoading] = React.useState(false);
  const [pickerError, setPickerError] = React.useState<string | null>(null);
  const [actionPending, setActionPending] = React.useState(false);
  const isIncomingTrade = Boolean(trade_id && canSubmit);
  const isExistingTrade = Boolean(trade_id);
  const hasSelectedCards = myCards.length + theirCards.length > 0;
  const tradeHasUnavailableCards =
    isIncomingTrade && problemCardIds.length > 0;

  // Opening the modal for a new trade starts from a blank offer. Adjust state
  // during render when the open/trade key changes, rather than in an effect.
  const sessionKey = open ? String(trade_id ?? "new") : null;
  const [currentSessionKey, setCurrentSessionKey] = React.useState(sessionKey);
  if (sessionKey !== currentSessionKey) {
    setCurrentSessionKey(sessionKey);
    if (sessionKey === "new") {
      setMyCards([]);
      setTheirCards([]);
      setCanSubmit(true);
      setUser("");
      setActionPending(false);
    }
  }

  React.useEffect(() => {
    if (!open || !trade_id) {
      return;
    }

    GetTrade(trade_id)
      .then((result) => {
        setMyCards(result.user_trade_items ?? []);
        setTheirCards(result.user2_trade_items ?? []);
        setUser(result.user2_name ?? "");
        setCanSubmit(result.current_user_accept === false);
        const unavailableCardIds = result.unavailable_card_ids ?? [];
        setProblemCardIds(unavailableCardIds);

        if (unavailableCardIds.length > 0) {
          setActionError(
            "This trade cannot be accepted because the original owner no longer owns one or more cards.",
          );
          setAlert(2);
        } else {
          setActionError("");
          setAlert(0);
        }
      })
      .catch(() => setAlert(2));
  }, [open, trade_id]);

  React.useEffect(() => {
    if (alert !== 1) {
      return;
    }

    const timer = window.setTimeout(() => setAlert(0), 2000);
    return () => window.clearTimeout(timer);
  }, [alert]);

  const handleClose = () => {
    setMyCards([]);
    setTheirCards([]);
    setPickerSide(null);
    setCanSubmit(true);
    setActionPending(false);
    setAlert(0);
    setActionError("");
    setProblemCardIds([]);
    setUser("");
    onClose();
  };

  const handleUserChange = (_event: React.SyntheticEvent, value: string | null) => {
    setUser(value ?? "");
    setTheirCards([]);
    setTradeId(undefined);
    setCanSubmit(true);
  };

  const openCardPicker = async (side: TradeSide) => {
    setPickerSide(side);
    setPickerRarity("All");
    setPickerSearch("");
    setDuplicatesOnly(false);
    setUnownedOnly(false);
    setPickerSelections([]);
    setPickerLoading(true);
    setPickerError(null);

    try {
      const result = (await TradeCardOptions(
        side === "theirs" ? user : undefined,
      )) as TradeCardOption[];
      setPickerCards(Array.isArray(result) ? result : []);
    } catch (error) {
      setPickerError(
        error instanceof Error ? error.message : "Unable to load cards",
      );
    } finally {
      setPickerLoading(false);
    }
  };

  const closeCardPicker = () => {
    setPickerSide(null);
    setPickerCards([]);
    setPickerSelections([]);
    setPickerError(null);
  };

  const togglePickerCard = (card: TradeCardOption) => {
    if (pickerSide === null) {
      return;
    }

    const selectedCards = pickerSide === "mine" ? myCards : theirCards;
    const draftCard = pickerSelections.find((selected) =>
      card.uuids.includes(selected.uuid),
    );

    if (draftCard) {
      setPickerSelections((current) =>
        current.filter((selected) => selected.uuid !== draftCard.uuid),
      );
      return;
    }

    const selectedUuids = new Set([
      ...selectedCards.map((selected) => selected.uuid),
      ...pickerSelections.map((selected) => selected.uuid),
    ]);
    const availableUuid = card.uuids.find((uuid) => !selectedUuids.has(uuid));

    if (!availableUuid) {
      return;
    }

    setPickerSelections((current) => [...current, {
      card_name: card.card_name,
      season: card.season,
      api_id: card.api_id,
      cardtype: card.cardtype,
      uuid: availableUuid,
    }]);
  };

  const addPickerSelections = () => {
    if (pickerSide === "mine") {
      setMyCards((current) => [...current, ...pickerSelections]);
    } else {
      setTheirCards((current) => [...current, ...pickerSelections]);
    }

    closeCardPicker();
  };

  const filteredPickerCards = pickerCards.filter((card) => {
    const matchesRarity =
      pickerRarity === "All" || card.cardtype === pickerRarity;
    const matchesSearch = card.card_name
      .toLocaleLowerCase()
      .includes(pickerSearch.trim().toLocaleLowerCase());
    const matchesDuplicates = !duplicatesOnly || card.owned_count > 1;
    const matchesOwnership =
      pickerSide !== "theirs" || !unownedOnly || !card.current_user_owns;
    return (
      matchesRarity &&
      matchesSearch &&
      matchesDuplicates &&
      matchesOwnership
    );
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isExistingTrade && !isIncomingTrade) {
      return;
    }

    setActionPending(true);
    setActionError("");
    setProblemCardIds([]);

    const selectedCardIds = [...myCards, ...theirCards].map(
      (card) => card.uuid,
    );

    const request = isIncomingTrade && trade_id
      ? updateTrade(selectedCardIds, trade_id)
      : createTrade(selectedCardIds, user);

    request
      .then(() => {
        handleClose();
      })
      .catch((error) => {
        setActionPending(false);
        const tradeError = error as Error & { cardIds?: string[] };
        setActionError(
          tradeError instanceof Error
            ? tradeError.message
            : "Trade could not be saved.",
        );
        setProblemCardIds(tradeError.cardIds ?? []);
        setAlert(2);
      });
  };

  const handleDelete = async () => {
    setActionPending(true);
    setActionError("");
    setProblemCardIds([]);

    try {
      await DestroyTrade(trade_id);
      handleClose();
    } catch (error) {
      setActionPending(false);
      setActionError(
        error instanceof Error ? error.message : "Trade could not be declined.",
      );
      setAlert(2);
    }
  };

  const renderTradeSide = (
    title: string,
    subtitle: string,
    side: TradeSide,
    selectedCards: CardItem[],
  ) => {
    const setSelectedCards = side === "mine" ? setMyCards : setTheirCards;
    const addDisabled = side === "theirs" && !user;
    const readOnly = isExistingTrade;

    return (
      <Box
        component="section"
        sx={{
          minWidth: 0,
          p: 2,
          border: "1px solid #374151",
          borderRadius: 2.5,
          backgroundColor: "#0f172a",
        }}
      >
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: "#9ca3af" }}>
            {subtitle}
          </Typography>
        </Box>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            alignItems: "start",
            gap: 1.25,
          }}
        >
          {selectedCards.map((card, index) => {
            const hasProblem = problemCardIds.includes(card.uuid);
            const rarityColor = rarityColors[card.cardtype] ?? "#6b7280";

            return (
              <Box
                key={card.uuid}
                sx={{
                  minWidth: 0,
                  p: 0.75,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 0.5,
                  position: "relative",
                  overflow: "hidden",
                  border: `2px solid ${hasProblem ? "#ef4444" : rarityColor}`,
                  borderRadius: 2,
                  backgroundColor: hasProblem ? "#451a1a" : "#1f2937",
                  boxShadow: hasProblem
                    ? "0 0 12px rgba(239, 68, 68, 0.55)"
                    : `0 0 8px color-mix(in srgb, ${rarityColor} 35%, transparent)`,
                }}
              >
                {hasProblem && (
                  <Box
                    component="span"
                    sx={{
                      position: "absolute",
                      top: 5,
                      left: 5,
                      zIndex: 2,
                      px: 0.75,
                      py: 0.25,
                      color: "#ffffff",
                      fontSize: "0.65rem",
                      fontWeight: 900,
                      borderRadius: 1,
                      backgroundColor: "#dc2626",
                    }}
                  >
                    UNAVAILABLE
                  </Box>
                )}
                <AdvancedImage
                  cldImg={cld.image(
                    `${card.season}/${card.cardtype}/${card.api_id}`,
                  )}
                  plugins={[lazyload(), placeholder()]}
                  style={{
                    width: "100%",
                    height: "160px",
                    objectFit: "contain",
                    opacity: hasProblem ? 0.45 : 1,
                    filter: hasProblem ? "grayscale(1)" : "none",
                  }}
                />
                <Typography
                  variant="body2"
                  sx={{
                    minWidth: 0,
                    fontWeight: 700,
                    textAlign: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {card.card_name}
                </Typography>
                {!readOnly && (
                  <IconButton
                    aria-label={`Remove ${card.card_name}`}
                    size="small"
                    onClick={() =>
                      setSelectedCards((current) =>
                        current.filter((_, cardIndex) => cardIndex !== index),
                      )
                    }
                    sx={{
                      position: "absolute",
                      top: 5,
                      right: 5,
                      zIndex: 2,
                      color: "#ffffff",
                      backgroundColor: "rgba(17, 24, 39, 0.9)",
                      "&:hover": {
                        color: "#ffffff",
                        backgroundColor: "#991b1b",
                      },
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            );
          })}
          {!readOnly && (
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              disabled={addDisabled}
              onClick={() => void openCardPicker(side)}
              sx={{
                minHeight: 210,
                color: "#e5e7eb",
                borderColor: "#6b7280",
                borderStyle: "dashed",
                "&:hover": {
                  borderColor: "#ffffff",
                  backgroundColor: "rgba(255,255,255,0.06)",
                },
              }}
            >
              Add card
            </Button>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        aria-labelledby="trade-modal-title"
        disableEnforceFocus={pickerSide !== null}
      >
        <Box sx={modalStyle}>
        <Box
          sx={{
            px: 2.5,
            py: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            backgroundColor: "#1f2937",
          }}
        >
          <Box>
            <Typography id="trade-modal-title" variant="h5" fontWeight={800}>
              {isIncomingTrade
                ? "Review Trade"
                : isExistingTrade
                  ? "View Trade"
                  : "Create New Trade"}
            </Typography>
            <Typography variant="body2" sx={{ color: "#9ca3af" }}>
              {isIncomingTrade
                ? "Review the proposed cards, then accept or decline the trade."
                : isExistingTrade
                  ? "This offer is locked while the other user reviews it."
                : "Add as many cards as needed from either collection."}
            </Typography>
          </Box>
          <IconButton
            aria-label="Close trade"
            onClick={handleClose}
            sx={{ color: "#ffffff" }}
          >
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ borderColor: "#374151" }} />

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{ minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              display: "flex",
              alignItems: { xs: "stretch", sm: "center" },
              flexDirection: { xs: "column", sm: "row" },
              gap: 1.5,
              backgroundColor: "#111827",
            }}
          >
            <Typography sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
              Trade with
            </Typography>
            {isExistingTrade ? (
              <Typography
                sx={{
                  px: 1.5,
                  py: 0.75,
                  minWidth: { sm: 200 },
                  color: "#ffffff",
                  fontWeight: 800,
                  borderLeft: "3px solid #bd9523",
                  backgroundColor: "#1f2937",
                  borderRadius: 1,
                }}
              >
                {user}
              </Typography>
            ) : (
              <Autocomplete
                options={users}
                value={user || null}
                onChange={handleUserChange}
                autoHighlight
                openOnFocus
                noOptionsText="No users found"
                slotProps={{
                  paper: {
                    sx: { maxHeight: 320 },
                  },
                  listbox: {
                    sx: { maxHeight: 280 },
                  },
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Search users"
                    placeholder="Start typing a username"
                  />
                )}
                sx={{
                  width: { xs: "100%", sm: 280 },
                  "& .MuiInputLabel-root": { color: "#9ca3af" },
                  "& .MuiInputLabel-root.Mui-focused": { color: "#ffffff" },
                  "& .MuiInputBase-input": { color: "#ffffff" },
                  "& .MuiOutlinedInput-notchedOutline": {
                    borderColor: "#6b7280",
                  },
                  "&:hover .MuiOutlinedInput-notchedOutline": {
                    borderColor: "#9ca3af",
                  },
                  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline":
                    {
                      borderColor: "#ffffff",
                    },
                  "& .MuiSvgIcon-root": { color: "#ffffff" },
                }}
              />
            )}
            {!user && (
              <Typography variant="body2" sx={{ color: "#9ca3af" }}>
                Select a user to choose cards from their collection.
              </Typography>
            )}
          </Box>

          <Box
            sx={{
              minHeight: 0,
              overflowY: "auto",
              p: 2.5,
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 2,
              backgroundColor: "#111827",
            }}
          >
            {renderTradeSide(
              "You offer",
              "Cards leaving your collection",
              "mine",
              myCards,
            )}
            {renderTradeSide(
              user ? `${user} offers` : "They offer",
              user
                ? `Cards requested from ${user}`
                : "Select a user before adding requested cards",
              "theirs",
              theirCards,
            )}
          </Box>

          <Divider sx={{ borderColor: "#374151" }} />

          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 1.25,
              backgroundColor: "#1f2937",
            }}
          >
            {!tradeHasUnavailableCards && (
              <>
                {(!isExistingTrade || isIncomingTrade) && (
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={
                      !canSubmit ||
                      !user ||
                      actionPending ||
                      (!isExistingTrade && !hasSelectedCards)
                    }
                    sx={{ minWidth: 150 }}
                  >
                    {isIncomingTrade ? "Accept Trade" : "Submit Trade"}
                  </Button>
                )}
              </>
            )}
            {trade_id && (
              <Button
                type="button"
                variant="outlined"
                color="error"
                disabled={actionPending}
                onClick={() => void handleDelete()}
              >
                {isIncomingTrade ? "Decline Trade" : "Delete Trade"}
              </Button>
            )}
            <Button
              type="button"
              color="inherit"
              onClick={handleClose}
              sx={{ color: "#d1d5db" }}
            >
              Cancel
            </Button>
            <Box sx={{ flex: 1 }} />
            {alert === 1 && (
              <Alert severity="success">Trade saved successfully.</Alert>
            )}
            {alert === 2 && (
              <Alert severity="error">
                {actionError || "Trade could not be saved."}
              </Alert>
            )}
          </Box>
        </Box>
        </Box>
      </Modal>

      <Dialog
        open={pickerSide !== null}
        onClose={closeCardPicker}
        fullWidth
        maxWidth="lg"
        slotProps={{
          paper: {
            sx: {
              height: "min(800px, 90vh)",
              backgroundColor: "#111827",
              color: "#ffffff",
              border: "1px solid #4b5563",
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            backgroundColor: "#1f2937",
          }}
        >
          <Box>
            <Typography variant="h6" fontWeight={800}>
              Choose cards
            </Typography>
            <Typography variant="body2" sx={{ color: "#9ca3af" }}>
              {pickerSide === "theirs"
                ? `Select cards from ${user}'s collection`
                : "Select cards from your collection"}
            </Typography>
          </Box>
          <IconButton
            aria-label="Close card picker"
            onClick={closeCardPicker}
            sx={{ color: "#ffffff" }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent
          sx={{
            p: 2.5,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            backgroundColor: "#111827",
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "minmax(220px, 1fr) 180px auto auto",
              },
              alignItems: "center",
              gap: 1.5,
            }}
          >
            <TextField
              size="small"
              label="Search by player name"
              value={pickerSearch}
              onChange={(event) => setPickerSearch(event.target.value)}
              sx={{
                "& .MuiInputLabel-root": { color: "#9ca3af" },
                "& .MuiInputBase-input": { color: "#ffffff" },
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "#6b7280",
                },
              }}
            />
            <Select
              size="small"
              value={pickerRarity}
              onChange={(event: SelectChangeEvent) =>
                setPickerRarity(event.target.value)
              }
              inputProps={{ "aria-label": "Filter by rarity" }}
              sx={{
                color: "#ffffff",
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "#6b7280",
                },
                "& .MuiSvgIcon-root": { color: "#ffffff" },
              }}
            >
              <MenuItem value="All">All rarities</MenuItem>
              <MenuItem value="Diamond">Diamond</MenuItem>
              <MenuItem value="Gold">Gold</MenuItem>
              <MenuItem value="Silver">Silver</MenuItem>
              <MenuItem value="Bronze">Bronze</MenuItem>
            </Select>
            <FormControlLabel
              control={
                <Switch
                  checked={duplicatesOnly}
                  onChange={(event) =>
                    setDuplicatesOnly(event.target.checked)
                  }
                />
              }
              label="Duplicates Only"
              sx={{ m: 0, whiteSpace: "nowrap" }}
            />
            {pickerSide === "theirs" && (
              <FormControlLabel
                control={
                  <Switch
                    checked={unownedOnly}
                    onChange={(event) => setUnownedOnly(event.target.checked)}
                  />
                }
                label="Unowned Only"
                sx={{ m: 0, whiteSpace: "nowrap" }}
              />
            )}
          </Box>

          {pickerError && <Alert severity="error">{pickerError}</Alert>}

          {pickerLoading ? (
            <Box
              sx={{
                flex: 1,
                display: "grid",
                placeItems: "center",
              }}
            >
              <CircularProgress />
            </Box>
          ) : (
            <Box
              sx={{
                overflowY: "auto",
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(145px, 1fr))",
                gap: 1.5,
                pr: 0.5,
              }}
            >
              {filteredPickerCards.map((card) => {
                const selectedCards =
                  pickerSide === "theirs" ? theirCards : myCards;
                const selectedUuids = new Set(
                  selectedCards.map((selected) => selected.uuid),
                );
                const draftCard = pickerSelections.find((selected) =>
                  card.uuids.includes(selected.uuid),
                );
                const unavailableUuids = new Set([
                  ...selectedUuids,
                  ...pickerSelections.map((selected) => selected.uuid),
                ]);
                const availableCopies = card.uuids.filter(
                  (uuid) => !unavailableUuids.has(uuid),
                ).length;
                const isSelected = Boolean(draftCard);

                return (
                  <Button
                    key={`${card.season}-${card.cardtype}-${card.api_id}`}
                    disabled={!isSelected && availableCopies === 0}
                    onClick={() => togglePickerCard(card)}
                    aria-pressed={isSelected}
                    sx={{
                      p: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 0.75,
                      textTransform: "none",
                      color: "#ffffff",
                      border: `3px solid ${
                        isSelected
                          ? "#22c55e"
                          : rarityColors[card.cardtype] ?? "#6b7280"
                      }`,
                      borderRadius: 2,
                      backgroundColor: isSelected ? "#163525" : "#1f2937",
                      position: "relative",
                      "&:hover": {
                        backgroundColor: isSelected ? "#1d4d31" : "#374151",
                        transform: "translateY(-2px)",
                      },
                      "&.Mui-disabled": {
                        color: "#9ca3af",
                        opacity: 0.4,
                      },
                    }}
                    >
                    {isSelected && (
                      <Box
                        component="span"
                        sx={{
                          position: "absolute",
                          top: 5,
                          right: 5,
                          zIndex: 2,
                          width: 28,
                          height: 28,
                          display: "grid",
                          placeItems: "center",
                          borderRadius: "50%",
                          color: "#052e16",
                          backgroundColor: "#86efac",
                        }}
                      >
                        <CheckIcon fontSize="small" />
                      </Box>
                    )}
                    <Box
                      component="span"
                      sx={{
                        position: "absolute",
                        top: 5,
                        left: 5,
                        zIndex: 1,
                        minWidth: 28,
                        height: 28,
                        px: 0.75,
                        display: "grid",
                        placeItems: "center",
                        borderRadius: 14,
                        backgroundColor: "#111827",
                        border: `2px solid ${
                          rarityColors[card.cardtype] ?? "#6b7280"
                        }`,
                        fontSize: "0.75rem",
                        fontWeight: 800,
                      }}
                    >
                      x{card.owned_count}
                    </Box>
                    <AdvancedImage
                      cldImg={cld.image(
                        `${card.season}/${card.cardtype}/${card.api_id}`,
                      )}
                      plugins={[lazyload(), placeholder()]}
                      style={{
                        width: "100%",
                        height: "180px",
                        objectFit: "contain",
                      }}
                    />
                    <Typography
                      component="span"
                      sx={{
                        minHeight: "2.5rem",
                        display: "grid",
                        placeItems: "center",
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        lineHeight: 1.2,
                        textAlign: "center",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {card.card_name}
                    </Typography>
                  </Button>
                );
              })}
              {!pickerLoading && filteredPickerCards.length === 0 && (
                <Box
                  sx={{
                    gridColumn: "1 / -1",
                    py: 8,
                    textAlign: "center",
                    color: "#9ca3af",
                  }}
                >
                  No cards match these filters.
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions
          sx={{
            px: 2.5,
            py: 1.5,
            gap: 1,
            borderTop: "1px solid #374151",
            backgroundColor: "#1f2937",
          }}
        >
          <Typography variant="body2" sx={{ mr: "auto", color: "#cbd5e1" }}>
            {pickerSelections.length} selected
          </Typography>
          <Button color="inherit" onClick={closeCardPicker}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={pickerSelections.length === 0}
            onClick={addPickerSelections}
          >
            Add Selected
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
