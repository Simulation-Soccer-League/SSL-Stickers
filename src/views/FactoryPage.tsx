import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import FactoryIcon from "@mui/icons-material/Factory";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import RemoveIcon from "@mui/icons-material/Remove";
import { AdvancedImage, lazyload, placeholder } from "@cloudinary/react";
import { motion } from "motion/react";

import { FactoryPack, TradeCardOptions } from "../api/UserCardApi.ts";
import { cld } from "../lib/cloudinary.ts";

type Rarity = "Bronze" | "Silver" | "Gold" | "Diamond";

type CardItem = {
  card_name: string;
  season: number;
  api_id: string;
  uuid: string;
  cardtype: Rarity;
};

type FactoryCardOption = Omit<CardItem, "uuid"> & {
  owned_count: number;
  uuids: string[];
};

type ExchangeOption = {
  id: string;
  inputRarity: Rarity;
  inputCount: number;
  outputRarity: Rarity;
};

type ExchangePhase = "idle" | "dissolving" | "processing" | "revealing";

const exchangeOptions: ExchangeOption[] = [
  {
    id: "bronze-for-bronze",
    inputRarity: "Bronze",
    inputCount: 2,
    outputRarity: "Bronze",
  },
  {
    id: "bronze-for-silver",
    inputRarity: "Bronze",
    inputCount: 5,
    outputRarity: "Silver",
  },
  {
    id: "silver-for-silver",
    inputRarity: "Silver",
    inputCount: 2,
    outputRarity: "Silver",
  },
  {
    id: "silver-for-gold",
    inputRarity: "Silver",
    inputCount: 5,
    outputRarity: "Gold",
  },
  {
    id: "gold-for-gold",
    inputRarity: "Gold",
    inputCount: 2,
    outputRarity: "Gold",
  },
  {
    id: "gold-for-diamond",
    inputRarity: "Gold",
    inputCount: 5,
    outputRarity: "Diamond",
  },
  {
    id: "diamond-for-diamond",
    inputRarity: "Diamond",
    inputCount: 2,
    outputRarity: "Diamond",
  },
];

const rarityColors: Record<Rarity, string> = {
  Bronze: "#A97142",
  Silver: "#C0C0C0",
  Gold: "#FFD700",
  Diamond: "#B9F2FF",
};

const pluralizeCards = (count: number) => `${count} card${count === 1 ? "" : "s"}`;
const pickerCardsPerPage = 12;
const dissolveDurationMs = 1400;
const shredderPauseMs = 650;

function RevealParticles() {
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 3,
      }}
    >
      {Array.from({ length: 36 }).map((_, index) => {
        const column = index % 6;
        const row = Math.floor(index / 6);
        const x = (column - 2.5) * 22 + ((index * 17) % 13);
        const y = (row - 2.5) * 30 + ((index * 11) % 17);
        const delay = ((index * 7) % 18) * 0.035;

        return (
          <motion.span
            key={index}
            initial={{
              x: x * 1.8,
              y: y * 1.5,
              opacity: 0,
              scale: 0.25,
            }}
            animate={{
              x: 0,
              y: 0,
              opacity: [0, 0.85, 0],
              scale: [0.25, 1, 0.4],
            }}
            transition={{
              duration: 1.8,
              delay,
              ease: "easeOut",
            }}
            style={{
              position: "absolute",
              left: `${12 + column * 15}%`,
              top: `${10 + row * 15}%`,
              width: index % 3 === 0 ? 7 : 5,
              height: index % 3 === 0 ? 7 : 5,
              borderRadius: index % 2 === 0 ? "50%" : 1,
              backgroundColor: index % 4 === 0 ? "#f6d365" : "#d1d5db",
              boxShadow: "0 0 7px currentColor",
            }}
          />
        );
      })}
    </Box>
  );
}

export default function FactoryPage() {
  const [selectedOptionId, setSelectedOptionId] = React.useState("");
  const [selectedCards, setSelectedCards] = React.useState<
    Record<string, CardItem[]>
  >({});
  const [pickerOption, setPickerOption] =
    React.useState<ExchangeOption | null>(null);
  const [pickerCards, setPickerCards] = React.useState<FactoryCardOption[]>([]);
  const [pickerSelections, setPickerSelections] = React.useState<CardItem[]>([]);
  const [pickerSearch, setPickerSearch] = React.useState("");
  const [duplicatesOnly, setDuplicatesOnly] = React.useState(false);
  const [pickerPage, setPickerPage] = React.useState(1);
  const [pickerLoading, setPickerLoading] = React.useState(false);
  const [pickerError, setPickerError] = React.useState("");
  const [depletedCardWarnings, setDepletedCardWarnings] = React.useState<
    FactoryCardOption[]
  >([]);
  const [submittingId, setSubmittingId] = React.useState<string | null>(null);
  const [exchangePhase, setExchangePhase] =
    React.useState<ExchangePhase>("idle");
  const [error, setError] = React.useState("");
  const [newCard, setNewCard] = React.useState<CardItem | null>(null);

  const openCardPicker = async (option: ExchangeOption) => {
    setPickerOption(option);
    setPickerSelections([]);
    setPickerSearch("");
    setDuplicatesOnly(false);
    setPickerPage(1);
    setPickerLoading(true);
    setPickerError("");
    setDepletedCardWarnings([]);

    try {
      const result = (await TradeCardOptions()) as FactoryCardOption[];
      setPickerCards(
        (Array.isArray(result) ? result : []).filter(
          (card) => card.cardtype === option.inputRarity,
        ),
      );
    } catch (requestError) {
      setPickerError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load cards",
      );
    } finally {
      setPickerLoading(false);
    }
  };

  const closeCardPicker = () => {
    setPickerOption(null);
    setPickerCards([]);
    setPickerSelections([]);
    setPickerError("");
    setDepletedCardWarnings([]);
    setPickerPage(1);
  };

  const addPickerCard = (card: FactoryCardOption) => {
    if (!pickerOption) {
      return;
    }

    const existingCards = selectedCards[pickerOption.id] ?? [];
    if (existingCards.length + pickerSelections.length >= pickerOption.inputCount) {
      return;
    }

    const unavailableUuids = new Set([
      ...existingCards.map((selected) => selected.uuid),
      ...pickerSelections.map((selected) => selected.uuid),
    ]);
    const availableUuid = card.uuids.find(
      (uuid) => !unavailableUuids.has(uuid),
    );

    if (!availableUuid) {
      return;
    }

    setPickerSelections((current) => [
      ...current,
      {
        card_name: card.card_name,
        season: card.season,
        api_id: card.api_id,
        cardtype: card.cardtype,
        uuid: availableUuid,
      },
    ]);
  };

  const removePickerCard = (card: FactoryCardOption) => {
    setPickerSelections((current) => {
      const reversedIndex = [...current].reverse().findIndex((selected) =>
        card.uuids.includes(selected.uuid),
      );

      if (reversedIndex === -1) {
        return current;
      }

      const selectedIndex = current.length - reversedIndex - 1;
      return current.filter((_, index) => index !== selectedIndex);
    });
  };

  const commitPickerSelections = () => {
    if (!pickerOption) {
      return;
    }

    setSelectedCards((current) => ({
      ...current,
      [pickerOption.id]: [
        ...(current[pickerOption.id] ?? []),
        ...pickerSelections,
      ].slice(0, pickerOption.inputCount),
    }));
    closeCardPicker();
  };

  const addPickerSelections = () => {
    if (!pickerOption) {
      return;
    }

    const resultingSelections = [
      ...(selectedCards[pickerOption.id] ?? []),
      ...pickerSelections,
    ];
    const selectedUuids = new Set(
      resultingSelections.map((selected) => selected.uuid),
    );
    const draftUuids = new Set(
      pickerSelections.map((selected) => selected.uuid),
    );
    const depletedCards = pickerCards.filter(
      (card) =>
        card.uuids.some((uuid) => draftUuids.has(uuid)) &&
        card.uuids.every((uuid) => selectedUuids.has(uuid)),
    );

    if (depletedCards.length > 0) {
      setDepletedCardWarnings(depletedCards);
      return;
    }

    commitPickerSelections();
  };

  const filteredPickerCards = pickerCards.filter((card) => {
    const matchesSearch = card.card_name
      .toLocaleLowerCase()
      .includes(pickerSearch.trim().toLocaleLowerCase());
    const matchesDuplicates = !duplicatesOnly || card.owned_count > 1;
    return matchesSearch && matchesDuplicates;
  });
  const pickerPageCount = Math.max(
    1,
    Math.ceil(filteredPickerCards.length / pickerCardsPerPage),
  );
  const paginatedPickerCards = filteredPickerCards.slice(
    (pickerPage - 1) * pickerCardsPerPage,
    pickerPage * pickerCardsPerPage,
  );

  const submitExchange = async (option: ExchangeOption) => {
    const selections = selectedCards[option.id] ?? [];
    const uniqueSelections = new Set(selections.map((card) => card.uuid));

    if (
      selections.length !== option.inputCount ||
      uniqueSelections.size !== option.inputCount
    ) {
      return;
    }

    setSubmittingId(option.id);
    setExchangePhase("dissolving");
    setError("");

    try {
      const [result] = await Promise.all([
        FactoryPack(
          selections.map((card) => card.uuid),
          option.outputRarity,
        ),
        new Promise((resolve) => window.setTimeout(resolve, dissolveDurationMs)),
      ]);

      if (!result) {
        setError("That exchange could not be completed. Check your selected cards.");
        setExchangePhase("idle");
        return;
      }

      setExchangePhase("processing");
      await new Promise((resolve) =>
        window.setTimeout(resolve, shredderPauseMs),
      );

      setNewCard({
        card_name: result.name,
        season: result.season,
        api_id: result.api_id,
        // The response is the original card; the new copy's UUID is not returned.
        uuid: "",
        cardtype: result.cardtype,
      });
      setExchangePhase("revealing");
    } catch (requestError) {
      setExchangePhase("idle");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to complete the exchange",
      );
    } finally {
      setSubmittingId(null);
    }
  };

  const resetFactory = () => {
    setNewCard(null);
    setExchangePhase("idle");
    setSelectedOptionId("");
    setSelectedCards({});
    setError("");
  };

  const selectedOption =
    exchangeOptions.find((option) => option.id === selectedOptionId) ?? null;

  return (
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <FactoryIcon sx={{ color: "#bd9523", fontSize: 38 }} />
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              Card Factory
            </Typography>
            <Typography sx={{ mt: 0.5, color: "#cbd5e1" }}>
              Choose an exchange recipe, select the required cards, and receive
              one random card of the listed rarity.
            </Typography>
          </Box>
        </Box>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      {
        <Box
          component="section"
          sx={{
            p: { xs: 1.5, sm: 2.5 },
            borderRadius: 3,
            border: "1px solid #596273",
            backgroundColor: "#222831",
          }}
        >
          <Typography variant="h5" sx={{ color: "#ffffff", fontWeight: 800 }}>
            Choose an Exchange
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, mb: 2, color: "#9ca3af" }}>
            Select a recipe, then choose the exact cards you want to trade in.
          </Typography>

          <FormControl fullWidth sx={{ mb: selectedOption ? 2 : 0 }}>
            <InputLabel
              id="factory-exchange-label"
              sx={{
                color: "#cbd5e1",
                "&.Mui-focused": { color: "#bd9523" },
              }}
            >
              Exchange recipe
            </InputLabel>
            <Select
              labelId="factory-exchange-label"
              value={selectedOptionId}
              label="Exchange recipe"
              readOnly={exchangePhase !== "idle" || Boolean(newCard)}
              onChange={(event) => {
                if (exchangePhase !== "idle" || newCard) {
                  return;
                }

                setSelectedOptionId(event.target.value);
                setError("");
              }}
              renderValue={(value) => {
                const option = exchangeOptions.find(
                  (exchangeOption) => exchangeOption.id === value,
                );

                return option ? (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 1,
                    }}
                  >
                    <Chip
                      label={`${option.inputCount} ${option.inputRarity}`}
                      size="small"
                      sx={{
                        color: "#ffffff",
                        fontWeight: 800,
                        backgroundColor: "#111827",
                        border: `1px solid ${rarityColors[option.inputRarity]}`,
                      }}
                    />
                    <ArrowForwardIcon sx={{ color: "#9ca3af" }} />
                    <Chip
                      label={`1 ${option.outputRarity}`}
                      size="small"
                      sx={{
                        color:
                          option.outputRarity === "Diamond"
                            ? "#111827"
                            : "#ffffff",
                        fontWeight: 800,
                        backgroundColor: rarityColors[option.outputRarity],
                      }}
                    />
                  </Box>
                ) : null;
              }}
              sx={{
                color: "#ffffff",
                backgroundColor: "#1f2937",
                pointerEvents:
                  exchangePhase !== "idle" || newCard ? "none" : "auto",
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: selectedOption
                    ? rarityColors[selectedOption.outputRarity]
                    : "#6b7280",
                  borderWidth: selectedOption ? 2 : 1,
                },
                "&:hover .MuiOutlinedInput-notchedOutline": {
                  borderColor: selectedOption
                    ? rarityColors[selectedOption.outputRarity]
                    : "#9ca3af",
                },
                "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                  borderColor: selectedOption
                    ? rarityColors[selectedOption.outputRarity]
                    : "#bd9523",
                },
                "& .MuiSelect-icon": { color: "#cbd5e1" },
              }}
              MenuProps={{
                slotProps: {
                  paper: {
                    sx: {
                      mt: 0.5,
                      color: "#ffffff",
                      backgroundColor: "#111827",
                      border: "1px solid #4b5563",
                    },
                  },
                },
              }}
            >
              {exchangeOptions.map((option) => (
                <MenuItem
                  key={option.id}
                  value={option.id}
                  sx={{
                    my: 0.5,
                    mx: 1,
                    minHeight: 54,
                    color: "#ffffff",
                    border: "1px solid #4b5563",
                    borderLeft: `6px solid ${rarityColors[option.outputRarity]}`,
                    borderRadius: 1.5,
                    backgroundColor: "#1f2937",
                    "&:hover": { backgroundColor: "#2d3748" },
                    "&.Mui-selected": { backgroundColor: "#374151" },
                    "&.Mui-selected:hover": { backgroundColor: "#374151" },
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 1,
                    }}
                  >
                    <Chip
                      label={`${option.inputCount} ${option.inputRarity}`}
                      size="small"
                      sx={{
                        color: "#ffffff",
                        fontWeight: 800,
                        backgroundColor: "#111827",
                        border: `1px solid ${rarityColors[option.inputRarity]}`,
                      }}
                    />
                    <ArrowForwardIcon sx={{ color: "#9ca3af" }} />
                    <Chip
                      label={`1 ${option.outputRarity}`}
                      size="small"
                      sx={{
                        color:
                          option.outputRarity === "Diamond"
                            ? "#111827"
                            : "#ffffff",
                        fontWeight: 800,
                        backgroundColor: rarityColors[option.outputRarity],
                      }}
                    />
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {exchangeOptions
              .filter((option) => option.id === selectedOptionId)
              .map((option) => {
              const selections = selectedCards[option.id] ?? [];
              const selectedCount = selections.length;
              const canSubmit =
                selectedCount === option.inputCount &&
                new Set(selections.map((card) => card.uuid)).size ===
                  option.inputCount;
              const inputColor = rarityColors[option.inputRarity];
              const outputColor = rarityColors[option.outputRarity];

              return (
                <Box
                  key={option.id}
                  sx={{
                    color: "#ffffff",
                    border: "1px solid #4b5563",
                    borderLeft: `6px solid ${outputColor}`,
                    borderRadius: "10px",
                    backgroundColor: "#1f2937",
                  }}
                >
                  <Box
                    sx={{
                      px: { xs: 1.5, sm: 2 },
                      pt: 1.5,
                      pb: 2,
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ mt: 1, mb: 2, color: "#cbd5e1" }}
                    >
                      Select {pluralizeCards(option.inputCount)} to trade. The
                      picker is automatically filtered to{" "}
                      {option.inputRarity}.
                    </Typography>

                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "center",
                        mb: 2,
                      }}
                    >
                      <Button
                        type="button"
                        variant="outlined"
                        startIcon={<AddIcon />}
                        disabled={
                          selectedCount >= option.inputCount ||
                          exchangePhase !== "idle"
                        }
                        onClick={() => void openCardPicker(option)}
                        sx={{
                          minHeight: 44,
                          color: "#e5e7eb",
                          borderColor: "#6b7280",
                          borderStyle: "dashed",
                        }}
                      >
                        Choose Cards ({selectedCount}/{option.inputCount})
                      </Button>
                    </Box>

                    {newCard ? null : selections.length > 0 ? (
                      <Box
                        sx={{
                          mb: 0,
                          display: "flex",
                          flexWrap: "wrap",
                          justifyContent: "center",
                          alignItems: "flex-end",
                          gap: 1.5,
                          position: "relative",
                          zIndex: 3,
                        }}
                      >
                        {selections.map((card) => (
                          <Box
                            component={motion.div}
                            key={card.uuid}
                            animate={
                              submittingId === option.id &&
                              (exchangePhase === "dissolving" ||
                                exchangePhase === "processing")
                                ? {
                                    y: 115,
                                    opacity: 0,
                                    scaleY: 0.28,
                                    filter: "blur(4px) saturate(0.45)",
                                  }
                                : {
                                    y: 0,
                                    opacity: 1,
                                    scaleY: 1,
                                    filter: "blur(0px) saturate(1)",
                                  }
                            }
                            transition={{
                              duration: 1.15,
                              ease: [0.55, 0, 1, 0.45],
                            }}
                            sx={{
                              width: 150,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 0.75,
                              p: 1,
                              position: "relative",
                              overflow: "hidden",
                              transformOrigin: "bottom center",
                              border: `2px solid ${inputColor}`,
                              borderRadius: 2,
                              backgroundColor: "#111827",
                              boxShadow: `0 0 10px color-mix(in srgb, ${inputColor} 45%, transparent)`,
                            }}
                          >
                            {submittingId === option.id &&
                              exchangePhase === "dissolving" && (
                                <Box
                                  sx={{
                                    position: "absolute",
                                    inset: 8,
                                    height: 200,
                                    zIndex: 4,
                                    display: "flex",
                                    overflow: "visible",
                                    pointerEvents: "none",
                                  }}
                                >
                                  {Array.from({ length: 12 }).map(
                                    (_, stripIndex) => (
                                      <Box
                                        component={motion.div}
                                        key={stripIndex}
                                        initial={{ y: 0, opacity: 1 }}
                                        animate={{
                                          y: 150 + (stripIndex % 3) * 18,
                                          opacity: [1, 1, 0],
                                        }}
                                        transition={{
                                          duration: 1.05,
                                          delay: stripIndex * 0.025,
                                          ease: [0.55, 0, 1, 0.45],
                                        }}
                                        sx={{
                                          width: `${100 / 12}%`,
                                          height: 200,
                                          position: "relative",
                                          overflow: "hidden",
                                        }}
                                      >
                                        <AdvancedImage
                                          cldImg={cld.image(
                                            `${card.season}/${card.cardtype}/${card.api_id}`,
                                          )}
                                          style={{
                                            width: 134,
                                            maxWidth: "none",
                                            height: 200,
                                            objectFit: "contain",
                                            position: "absolute",
                                            top: 0,
                                            left: `${stripIndex * (-134 / 12)}px`,
                                          }}
                                        />
                                      </Box>
                                    ),
                                  )}
                                </Box>
                              )}
                            <AdvancedImage
                              cldImg={cld.image(
                                `${card.season}/${card.cardtype}/${card.api_id}`,
                              )}
                              plugins={[lazyload(), placeholder()]}
                              style={{
                                width: "100%",
                                height: "200px",
                                objectFit: "contain",
                              }}
                            />
                            <Typography
                              variant="body2"
                              sx={{
                                width: "100%",
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
                            <IconButton
                              aria-label={`Remove ${card.card_name}`}
                              size="small"
                              disabled={exchangePhase !== "idle"}
                              onClick={() =>
                                setSelectedCards((current) => ({
                                  ...current,
                                  [option.id]: (
                                    current[option.id] ?? []
                                  ).filter(
                                    (selected) =>
                                      selected.uuid !== card.uuid,
                                  ),
                                }))
                              }
                              sx={{
                                position: "absolute",
                                top: 5,
                                right: 5,
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
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Box
                        sx={{
                          mb: 2,
                          p: 2,
                          color: "#9ca3af",
                          textAlign: "center",
                          border: "1px dashed #6b7280",
                          borderRadius: 2,
                        }}
                      >
                        No cards selected yet.
                      </Box>
                    )}

                    <Box
                      sx={{
                        width: "min(100%, 680px)",
                        mx: "auto",
                        position: "relative",
                        pt: selections.length > 0 ? 0 : 2.5,
                      }}
                    >
                      {newCard && (
                        <Box
                          sx={{
                            minHeight: 345,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            position: "relative",
                            zIndex: 1,
                            mb: 2,
                          }}
                        >
                          <motion.div
                            initial={{
                              y: 340,
                              scaleY: 0.2,
                              opacity: 0,
                              filter: "blur(14px) saturate(0)",
                            }}
                            animate={{
                              y: 0,
                              scaleY: 1,
                              opacity: 1,
                              filter: "blur(0px) saturate(1)",
                            }}
                            transition={{
                              duration: 2.2,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            style={{
                              position: "relative",
                              transformOrigin: "bottom center",
                              textAlign: "center",
                            }}
                          >
                            {exchangePhase === "revealing" && (
                              <RevealParticles />
                            )}
                            <Box
                              sx={{
                                p: 0.75,
                                lineHeight: 0,
                                border: `3px solid ${rarityColors[newCard.cardtype]}`,
                                borderRadius: 2,
                                backgroundColor: "#111827",
                                boxShadow: `0 0 22px ${rarityColors[newCard.cardtype]}`,
                              }}
                            >
                              <AdvancedImage
                                height="260px"
                                cldImg={cld.image(
                                  `${newCard.season}/${newCard.cardtype}/${newCard.api_id}`,
                                )}
                                plugins={[placeholder({ mode: "blur" })]}
                              />
                            </Box>
                            <Typography sx={{ mt: 1.25, fontWeight: 800 }}>
                              {newCard.card_name}
                            </Typography>
                            <Chip
                              label={newCard.cardtype}
                              size="small"
                              sx={{
                                mt: 0.75,
                                color:
                                  newCard.cardtype === "Diamond"
                                    ? "#111827"
                                    : "#ffffff",
                                fontWeight: 800,
                                backgroundColor:
                                  rarityColors[newCard.cardtype],
                              }}
                            />
                          </motion.div>
                        </Box>
                      )}
                      <Box
                        sx={{
                          width: "78%",
                          height: 22,
                          mx: "auto",
                          position: "relative",
                          zIndex: 2,
                          border: "5px solid #0b0f16",
                          borderRadius: "8px 8px 3px 3px",
                          backgroundColor: "#020617",
                          boxShadow:
                            "inset 0 3px 6px #000000, 0 2px 0 #6b7280",
                        }}
                      />
                      <Paper
                        elevation={10}
                        sx={{
                          mt: -0.5,
                          minHeight: 190,
                          p: { xs: 2, sm: 3 },
                          position: "relative",
                          overflow: "hidden",
                          color: "#ffffff",
                          textAlign: "center",
                          border: "2px solid #6b7280",
                          borderRadius: "18px 18px 28px 28px",
                          background:
                            "linear-gradient(145deg, #4b5563 0%, #1f2937 42%, #111827 100%)",
                          boxShadow:
                            "inset 0 1px 0 rgba(255,255,255,0.22), 0 18px 28px rgba(0,0,0,0.35)",
                        }}
                      >
                        <Box
                          sx={{
                            position: "absolute",
                            top: 14,
                            right: 18,
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            backgroundColor: canSubmit ? "#22c55e" : "#ef4444",
                            boxShadow: `0 0 10px ${
                              canSubmit ? "#22c55e" : "#ef4444"
                            }`,
                          }}
                        />
                        <Typography
                          variant="overline"
                          sx={{
                            color: "#d1d5db",
                            letterSpacing: 3,
                            fontWeight: 900,
                          }}
                        >
                          Card Shredder
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ mt: 0.5, color: "#9ca3af" }}
                        >
                          {newCard
                            ? `Created 1 ${newCard.cardtype} card.`
                            : exchangePhase === "processing"
                            ? "Processing the shredded cards..."
                            : canSubmit
                            ? "Cards loaded. The factory is ready."
                            : `Load ${option.inputCount - selectedCount} more to unlock the shredder.`}
                        </Typography>

                        {exchangePhase === "dissolving" && (
                          <Box
                            sx={{
                              height: 44,
                              mt: 1,
                              display: "flex",
                              justifyContent: "center",
                              gap: 0.75,
                              overflow: "hidden",
                            }}
                          >
                            {Array.from({ length: 14 }).map((_, index) => (
                              <Box
                                component={motion.span}
                                key={index}
                                initial={{ y: -28, opacity: 0 }}
                                animate={{ y: 42, opacity: [0, 1, 0] }}
                                transition={{
                                  duration: 0.8,
                                  delay: index * 0.04,
                                  repeat: 1,
                                }}
                                sx={{
                                  width: 7,
                                  height: 34,
                                  display: "block",
                                  backgroundColor:
                                    index % 2 === 0
                                      ? inputColor
                                      : "#e5e7eb",
                                }}
                              />
                            ))}
                          </Box>
                        )}

                        {newCard ? (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 1.8, duration: 0.5 }}
                          >
                            <Button
                              type="button"
                              variant="contained"
                              onClick={resetFactory}
                              sx={{
                                mt: 3,
                                minHeight: 48,
                                px: 4,
                                color: "#111827",
                                fontWeight: 900,
                                backgroundColor: "#bd9523",
                                border: "2px solid #e8ca71",
                                boxShadow: "0 4px 0 #70550c",
                                "&:hover": { backgroundColor: "#d4ad3d" },
                              }}
                            >
                              Make Another Exchange
                            </Button>
                          </motion.div>
                        ) : (
                          <Button
                            type="button"
                            variant="contained"
                            disabled={
                              !canSubmit ||
                              submittingId === option.id ||
                              exchangePhase !== "idle"
                            }
                            onClick={() => void submitExchange(option)}
                            startIcon={
                              submittingId === option.id ? (
                                <CircularProgress size={18} color="inherit" />
                              ) : (
                                <AutorenewIcon />
                              )
                            }
                            sx={{
                              mt: exchangePhase === "dissolving" ? 0 : 3,
                              minHeight: 48,
                              px: 4,
                              color: "#111827",
                              fontWeight: 900,
                              backgroundColor: "#bd9523",
                              border: "2px solid #e8ca71",
                              boxShadow: "0 4px 0 #70550c",
                              "&:hover": { backgroundColor: "#d4ad3d" },
                            }}
                          >
                            {submittingId === option.id
                              ? exchangePhase === "processing"
                                ? "Processing..."
                                : "Shredding..."
                              : `Shred for 1 ${option.outputRarity}`}
                          </Button>
                        )}

                        <Box
                          sx={{
                            mt: 3,
                            height: 10,
                            borderRadius: 5,
                            opacity: 0.65,
                            background:
                              "repeating-linear-gradient(90deg, #020617 0 12px, #4b5563 12px 18px)",
                          }}
                        />
                      </Paper>
                      <Box
                        sx={{
                          width: "88%",
                          height: 20,
                          mx: "auto",
                          borderRadius: "0 0 18px 18px",
                          backgroundColor: "#080c13",
                          boxShadow: "0 8px 12px rgba(0,0,0,0.35)",
                        }}
                      />
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      }

      <Dialog
        open={pickerOption !== null}
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
              Choose Factory Cards
            </Typography>
            <Typography variant="body2" sx={{ color: "#9ca3af" }}>
              Select{" "}
              {pickerOption
                ? pluralizeCards(
                    pickerOption.inputCount -
                      (selectedCards[pickerOption.id]?.length ?? 0),
                  )
                : "cards"}{" "}
              from your collection.
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
                sm: "minmax(220px, 1fr) auto auto",
              },
              alignItems: "center",
              gap: 1.5,
            }}
          >
            <TextField
              size="small"
              label="Search by player name"
              value={pickerSearch}
              onChange={(event) => {
                setPickerSearch(event.target.value);
                setPickerPage(1);
              }}
              sx={{
                "& .MuiInputLabel-root": { color: "#9ca3af" },
                "& .MuiInputBase-input": { color: "#ffffff" },
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "#6b7280",
                },
              }}
            />
            {pickerOption && (
              <Chip
                label={`${pickerOption.inputRarity} only`}
                sx={{
                  color:
                    pickerOption.inputRarity === "Diamond"
                      ? "#111827"
                      : "#ffffff",
                  fontWeight: 800,
                  backgroundColor: rarityColors[pickerOption.inputRarity],
                }}
              />
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={duplicatesOnly}
                  onChange={(event) => {
                    setDuplicatesOnly(event.target.checked)
                    setPickerPage(1);
                  }}
                />
              }
              label="Duplicates Only"
              sx={{ m: 0, whiteSpace: "nowrap" }}
            />
          </Box>

          {pickerError && <Alert severity="error">{pickerError}</Alert>}

          {pickerLoading ? (
            <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              sx={{
                minHeight: 0,
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <Box
                sx={{
                  minHeight: 0,
                  overflowY: "auto",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, 170px)",
                  gridAutoRows: "minmax(250px, auto)",
                  alignContent: "start",
                  justifyContent: "center",
                  gap: 1.5,
                  pr: 0.5,
                }}
              >
              {paginatedPickerCards.map((card) => {
                const existingCards = pickerOption
                  ? selectedCards[pickerOption.id] ?? []
                  : [];
                const draftCopies = pickerSelections.filter((selected) =>
                  card.uuids.includes(selected.uuid),
                );
                const unavailableUuids = new Set([
                  ...existingCards.map((selected) => selected.uuid),
                  ...pickerSelections.map((selected) => selected.uuid),
                ]);
                const availableCopies = card.uuids.filter(
                  (uuid) => !unavailableUuids.has(uuid),
                ).length;
                const selectionLimitReached = pickerOption
                  ? existingCards.length + pickerSelections.length >=
                    pickerOption.inputCount
                  : true;
                const selectedCopyCount = draftCopies.length;
                const isSelected = selectedCopyCount > 0;

                return (
                  <Box
                    key={`${card.season}-${card.cardtype}-${card.api_id}`}
                    sx={{
                      position: "relative",
                      border: `3px solid ${
                        isSelected
                          ? "#22c55e"
                          : rarityColors[card.cardtype]
                      }`,
                      borderRadius: 2,
                      backgroundColor: isSelected ? "#163525" : "#1f2937",
                      overflow: "hidden",
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
                          fontSize: "0.75rem",
                          fontWeight: 900,
                        }}
                      >
                        {selectedCopyCount > 1 ? (
                          `x${selectedCopyCount}`
                        ) : (
                          <CheckIcon fontSize="small" />
                        )}
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
                        border: `2px solid ${rarityColors[card.cardtype]}`,
                        fontSize: "0.75rem",
                        fontWeight: 800,
                      }}
                    >
                      x{card.owned_count}
                    </Box>
                    <Box
                      sx={{
                        p: 1,
                        minWidth: 0,
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "stretch",
                        gap: 0.75,
                        color: "#ffffff",
                      }}
                    >
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
                    </Box>
                    <Box
                      sx={{
                        position: "absolute",
                        right: 5,
                        bottom: 5,
                        zIndex: 2,
                        display: "flex",
                        gap: 0.5,
                      }}
                    >
                      <IconButton
                        aria-label={`Remove one copy of ${card.card_name}`}
                        size="small"
                        disabled={!isSelected}
                        onClick={() => removePickerCard(card)}
                        sx={{
                          color: "#ffffff",
                          backgroundColor: "#991b1b",
                          "&:hover": { backgroundColor: "#b91c1c" },
                          "&.Mui-disabled": {
                            color: "#6b7280",
                            backgroundColor: "#374151",
                          },
                        }}
                      >
                        <RemoveIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        aria-label={`Add one copy of ${card.card_name}`}
                        size="small"
                        disabled={
                          availableCopies === 0 || selectionLimitReached
                        }
                        onClick={() => addPickerCard(card)}
                        sx={{
                          color: "#052e16",
                          backgroundColor: "#86efac",
                          "&:hover": { backgroundColor: "#4ade80" },
                          "&.Mui-disabled": {
                            color: "#6b7280",
                            backgroundColor: "#374151",
                          },
                        }}
                      >
                        <AddCircleOutlineIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
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
              {filteredPickerCards.length > pickerCardsPerPage && (
                <Pagination
                  count={pickerPageCount}
                  page={pickerPage}
                  onChange={(_event, page) => setPickerPage(page)}
                  color="primary"
                  shape="rounded"
                  sx={{
                    alignSelf: "center",
                    "& .MuiPaginationItem-root": {
                      color: "#e5e7eb",
                    },
                    "& .Mui-selected": {
                      color: "#111827",
                      backgroundColor: "#bd9523 !important",
                    },
                  }}
                />
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

      <Dialog
        open={depletedCardWarnings.length > 0}
        onClose={() => setDepletedCardWarnings([])}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              color: "#ffffff",
              backgroundColor: "#111827",
              border: "1px solid #bd9523",
            },
          },
        }}
      >
        <DialogTitle sx={{ color: "#f6d365", fontWeight: 800 }}>
          Use Your Last Copy?
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This selection will leave you with zero copies of the following
            {depletedCardWarnings.length === 1 ? " card" : " cards"}:
          </Alert>
          <Box
            component="ul"
            sx={{
              m: 0,
              pl: 3,
              color: "#e5e7eb",
              "& li + li": { mt: 0.75 },
            }}
          >
            {depletedCardWarnings.map((card) => (
              <li key={`${card.season}-${card.cardtype}-${card.api_id}`}>
                <Typography component="span" fontWeight={700}>
                  {card.card_name}
                </Typography>
                <Typography component="span" sx={{ color: "#9ca3af" }}>
                  {` (${card.cardtype}, Season ${card.season})`}
                </Typography>
              </li>
            ))}
          </Box>
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            py: 2,
            borderTop: "1px solid #374151",
          }}
        >
          <Button color="inherit" onClick={() => setDepletedCardWarnings([])}>
            Go Back
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              setDepletedCardWarnings([]);
              commitPickerSelections();
            }}
          >
            Add Anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
