import * as React from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Paper from "@mui/material/Paper";
import { CardsWithParams } from "../api/UserCardApi.ts";
import { cld } from "../lib/cloudinary.ts";
import { AdvancedImage, placeholder, lazyload } from "@cloudinary/react";
import type { CloudinaryImage } from "@cloudinary/url-gen";
import { motion, useMotionValue, useSpring } from "motion/react";
import Modal from "@mui/material/Modal";
import Typography from "@mui/material/Typography";
import TablePagination from "@mui/material/TablePagination";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import type { SelectChangeEvent } from "@mui/material/Select";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableRow from "@mui/material/TableRow";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";

interface Cards {
  card_name: string;
  api_id: string;
  cardtype: string;
  season: number;
  team: string | null;
  owned_count: number;
}

interface FilteredCardsResponse {
  cards: Cards[];
  count: number;
}

interface CardFilters {
  name: string;
  sort: string;
  includeUnowned: boolean;
}

interface CachedPage {
  cards: Cards[];
  count: number;
}

const STICKERS_PER_PAGE = 12;
const DEFAULT_SORT = "rarity_desc";

function getPageCacheKey(page: number, filters: CardFilters) {
  return `${filters.includeUnowned}:${filters.sort}:${filters.name}:${page}`;
}

function preloadCardImages(cards: Cards[]) {
  cards.forEach(({ season, cardtype, api_id }) => {
    const image = new Image();
    image.src = cld.image(`${season}/${cardtype}/${api_id}`).toURL();
  });
}

const modalStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(92vw, 620px)",
  maxHeight: "92vh",
  outline: "none",
  p: 2,
};

interface InteractiveFolderCardProps {
  image: CloudinaryImage;
  rarityColor: string;
  isOwned: boolean;
  height?: string;
}

function InteractiveFolderCard({
  image,
  rarityColor,
  isOwned,
  height = "520px",
}: InteractiveFolderCardProps) {
  const rotateXValue = useMotionValue(0);
  const rotateYValue = useMotionValue(0);
  const xValue = useMotionValue(0);
  const yValue = useMotionValue(0);
  const springConfig = { stiffness: 260, damping: 22 };
  const rotateX = useSpring(rotateXValue, springConfig);
  const rotateY = useSpring(rotateYValue, springConfig);
  const x = useSpring(xValue, springConfig);
  const y = useSpring(yValue, springConfig);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
    const vertical = (event.clientY - bounds.top) / bounds.height - 0.5;

    rotateXValue.set(vertical * -18);
    rotateYValue.set(horizontal * 18);
    xValue.set(horizontal * 16);
    yValue.set(vertical * 16);
  };

  const resetTilt = () => {
    rotateXValue.set(0);
    rotateYValue.set(0);
    xValue.set(0);
    yValue.set(0);
  };

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        perspective: 900,
      }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          opacity: { duration: 0.2 },
          scale: { duration: 0.25 },
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetTilt}
        onPointerCancel={resetTilt}
        style={{
          cursor: "move",
          perspective: 700,
          position: "relative",
          touchAction: "none",
        }}
      >
        <motion.div
          style={{
            rotateX,
            rotateY,
            x,
            y,
            transformPerspective: 700,
            transformStyle: "preserve-3d",
            border: `3px solid ${rarityColor}`,
            borderRadius: 8,
            boxShadow: `0 0 12px ${rarityColor}, 0 0 28px ${rarityColor}`,
            overflow: "hidden",
          }}
        >
          <AdvancedImage
            rel="preload"
            height={height}
            cldImg={image}
            plugins={[placeholder({ mode: "blur" })]}
            style={{
              display: "block",
              maxWidth: "85vw",
              filter: isOwned ? "none" : "grayscale(1)",
            }}
          />
        </motion.div>
      </motion.div>
    </Box>
  );
}

export default function FixedBottomNavigation() {
  const [cardCount, setcardCount] = React.useState(0);
  const [selectedCard, setSelectedCard] = React.useState<Cards | null>(null);
  const [page, setPage] = React.useState(0);
  const [cards, setCards] = React.useState<Cards[]>([]);
  const [open, setOpen] = React.useState(false);
  const [searchName, setSearchName] = React.useState("");
  const [sortBy, setSortBy] = React.useState(DEFAULT_SORT);
  const [showUnowned, setShowUnowned] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<CardFilters>({
    name: "",
    sort: DEFAULT_SORT,
    includeUnowned: false,
  });
  const pageCache = React.useRef(new Map<string, CachedPage>());

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      const name = searchName.trim();
      setPage(0);
      setFilters((currentFilters) => {
        if (
          currentFilters.name === name &&
          currentFilters.sort === sortBy &&
          currentFilters.includeUnowned === showUnowned
        ) {
          return currentFilters;
        }

        return { name, sort: sortBy, includeUnowned: showUnowned };
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [searchName, showUnowned, sortBy]);

  React.useEffect(() => {
    let cancelled = false;

    const fetchPage = async (pageIndex: number): Promise<CachedPage> => {
      const cacheKey = getPageCacheKey(pageIndex, filters);
      const cachedPage = pageCache.current.get(cacheKey);

      if (cachedPage) {
        return cachedPage;
      }

      const result = (await CardsWithParams(
        filters.name,
        filters.sort,
        pageIndex + 1,
        STICKERS_PER_PAGE,
        filters.includeUnowned,
      )) as FilteredCardsResponse;

      pageCache.current.set(cacheKey, result);
      return result;
    };

    const loadCurrentAndNextPage = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const currentPage = await fetchPage(page);

        if (cancelled) {
          return;
        }

        setCards(currentPage.cards);
        setcardCount(currentPage.count);
        preloadCardImages(currentPage.cards);

        const nextPage = page + 1;
        if (nextPage * STICKERS_PER_PAGE < currentPage.count) {
          const nextPageResult = await fetchPage(nextPage);
          if (!cancelled) {
            preloadCardImages(nextPageResult.cards);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load stickers",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadCurrentAndNextPage();

    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  const cardTypeColor: Record<string, string> = {
    Bronze: "#A97142",
    Silver: "silver",
    Gold: "gold",
    Diamond: "#b9f2ff",
  };

  const handleChangePage = (
    _: React.MouseEvent<HTMLButtonElement> | null, // Keep or it breaks the code, idk why
    newPage: number,
  ) => {
    setPage(newPage);
  };

  return (
    <>
      <Box
        sx={{
          pb: 1,
          minHeight: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "#393e46",
        }}
        ref={ref}
      >
        <Paper
          component="section"
          sx={{
            width: "min(1200px, 100%)",
            p: 1,
            boxSizing: "border-box",
            backgroundColor: "#222831",
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(360px, 1.2fr) minmax(260px, 1fr)",
              },
              gap: 1,
            }}
          >
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "minmax(200px, 1fr) auto",
                },
                alignItems: "center",
                gap: 1,
              }}
            >
              <TextField
                size="small"
                id="player-name-filter"
                label="Search by Player Name"
                value={searchName}
                onChange={(event) => setSearchName(event.target.value)}
                sx={{ backgroundColor: "#ffffff", borderRadius: 1 }}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={showUnowned}
                    onChange={(event) => setShowUnowned(event.target.checked)}
                    inputProps={{ "aria-label": "Show unowned stickers" }}
                  />
                }
                label="Show unowned"
                sx={{
                  m: 0,
                  px: 1,
                  minHeight: 40,
                  borderRadius: 1,
                  backgroundColor: "#ffffff",
                  color: "#111827",
                  whiteSpace: "nowrap",
                  "& .MuiFormControlLabel-label": {
                    fontSize: "0.85rem",
                    fontWeight: 700,
                  },
                }}
              />
            </Box>
            <FormControl
              size="small"
              sx={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr)",
                alignItems: "center",
                gap: 1,
                px: 1.25,
                backgroundColor: "#ffffff",
                borderRadius: 1,
              }}
            >
              <Typography
                component="span"
                sx={{
                  color: "#374151",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                Sort by
              </Typography>
              <Select
                id="folder-sort"
                value={sortBy}
                onChange={(event: SelectChangeEvent) =>
                  setSortBy(event.target.value)
                }
                variant="standard"
                disableUnderline
                inputProps={{ "aria-label": "Sort stickers" }}
                sx={{
                  minWidth: 0,
                  color: "#111827",
                  fontWeight: 600,
                  "& .MuiSelect-select": {
                    py: 1,
                  },
                }}
              >
                <MenuItem value="player_name_asc">Player Name (A-Z)</MenuItem>
                <MenuItem value="player_name_desc">Player Name (Z-A)</MenuItem>
                <MenuItem value="team_name_asc">Team Name (A-Z)</MenuItem>
                <MenuItem value="team_name_desc">Team Name (Z-A)</MenuItem>
                <MenuItem value="owned_desc">
                  Cards (Owned Most-Least)
                </MenuItem>
                <MenuItem value="owned_asc">
                  Cards (Owned Least-Most)
                </MenuItem>
                <MenuItem value="rarity_desc">
                  Rarity (Diamond-Bronze)
                </MenuItem>
                <MenuItem value="rarity_asc">
                  Rarity (Bronze-Diamond)
                </MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Paper>
        {isLoading && (
          <LinearProgress
            aria-label="Loading stickers"
            sx={{ width: "min(1200px, 100%)" }}
          />
        )}
        {loadError && (
          <Alert
            severity="error"
            sx={{ width: "min(1200px, 100%)", boxSizing: "border-box" }}
          >
            {loadError}
          </Alert>
        )}
        <TableContainer
          component={Paper}
          sx={{
            width: "min(1200px, 100%)",
            my: 1,
            backgroundColor: "transparent",
            boxShadow: "none",
          }}
        >
          <Table aria-label="Sticker collection">
            <TableBody>
              <TableRow
                sx={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(min(170px, 100%), 1fr))",
                  gap: 1.25,
                }}
              >
                {cards.map(
                  (
                    {
                      card_name,
                      api_id,
                      cardtype,
                      season,
                      team,
                      owned_count,
                    },
                    index,
                  ) => (
                    <TableCell
                      key={`${season}-${cardtype}-${api_id}-${index}`}
                      component="td"
                      onClick={() => {
                        setSelectedCard({
                          card_name,
                          api_id,
                          cardtype,
                          season,
                          team,
                          owned_count,
                        });
                        handleOpen();
                      }}
                      sx={{
                        display: "flex",
                        position: "relative",
                        minWidth: 0,
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 0.5,
                        p: 1,
                        cursor: "pointer",
                        border: `3px solid ${
                          owned_count === 0
                            ? "#6b7280"
                            : cardTypeColor[cardtype] ?? "grey"
                        }`,
                        borderRadius: 2,
                        backgroundColor:
                          owned_count === 0 ? "#374151" : "#222831",
                        transition: "transform 0.15s ease",
                        "&:hover": {
                          transform: "translateY(-3px)",
                        },
                      }}
                    >
                      <Box
                        component="span"
                        aria-label={`${owned_count} owned`}
                        sx={{
                          position: "absolute",
                          top: 6,
                          left: 6,
                          zIndex: 1,
                          minWidth: 28,
                          height: 28,
                          px: 0.75,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "14px",
                          backgroundColor: "#111827",
                          color: "#ffffff",
                          border: `2px solid ${
                            owned_count === 0
                              ? "#9ca3af"
                              : cardTypeColor[cardtype] ?? "grey"
                          }`,
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          lineHeight: 1,
                          boxShadow: "0 2px 6px rgba(0, 0, 0, 0.45)",
                        }}
                      >
                        x{owned_count}
                      </Box>
                      <AdvancedImage
                        cldImg={cld.image(
                          `${season}/${cardtype}/${api_id}`,
                        )}
                        alt={card_name}
                        style={{
                          display: "block",
                          width: "100%",
                          maxWidth: "160px",
                          height: "190px",
                          objectFit: "contain",
                          filter:
                            owned_count === 0 ? "grayscale(1)" : "none",
                          opacity: owned_count === 0 ? 0.45 : 1,
                        }}
                        plugins={[lazyload(), placeholder()]}
                      />
                      <Box
                        sx={{
                          width: "100%",
                          minHeight: "4.5rem",
                          display: "grid",
                          gridTemplateRows: "2.75rem 1.25rem",
                          alignItems: "center",
                          rowGap: 0.25,
                        }}
                      >
                        <Typography
                          component="span"
                          sx={{
                            color: "#ffffff",
                            fontWeight: 600,
                            lineHeight: 1.4,
                            textAlign: "center",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {card_name}
                        </Typography>
                        <Typography
                          component="span"
                          sx={{
                            color: "#cbd5e1",
                            fontSize: "0.85rem",
                            lineHeight: 1.25,
                            textAlign: "center",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {team || "Team unavailable"}
                        </Typography>
                      </Box>
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
        <Paper
          elevation={3}
          sx={{
            width: "min(1200px, 100%)",
            mt: 0.5,
            overflow: "hidden",
            backgroundColor: "#222831",
            color: "#ffffff",
            border: "1px solid #596273",
          }}
        >
          <TablePagination
            component="div"
            count={cardCount}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={STICKERS_PER_PAGE}
            rowsPerPageOptions={[STICKERS_PER_PAGE]}
            onRowsPerPageChange={() => undefined}
            labelDisplayedRows={({ from, to, count }) =>
              `${from}-${to} of ${count} stickers`
            }
            sx={{
              color: "#ffffff",
              "& .MuiTablePagination-toolbar": {
                minHeight: 48,
                px: 1.5,
              },
              "& .MuiTablePagination-spacer": {
                display: "none",
              },
              "& .MuiTablePagination-selectLabel, & .MuiTablePagination-input":
                {
                  display: "none",
                },
              "& .MuiTablePagination-displayedRows": {
                ml: 0,
                mr: "auto",
                fontWeight: 700,
                letterSpacing: "0.02em",
              },
              "& .MuiTablePagination-actions": {
                display: "flex",
                gap: 0.75,
                ml: 1,
              },
              "& .MuiIconButton-root": {
                width: 36,
                height: 36,
                color: "#ffffff",
                backgroundColor: "#393e46",
                border: "1px solid #77808f",
              },
              "& .MuiIconButton-root:hover": {
                backgroundColor: "#4b5563",
              },
              "& .MuiIconButton-root.Mui-disabled": {
                color: "#7c8594",
                backgroundColor: "#2d333d",
                borderColor: "#444c59",
              },
            }}
          />
        </Paper>

      </Box>
      <Modal
        open={open}
        onClose={handleClose}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
      >
        <Box sx={modalStyle}>
          {selectedCard && (
            <>
              <InteractiveFolderCard
                image={cld.image(
                  `${selectedCard.season}/${selectedCard.cardtype}/${selectedCard.api_id}`,
                )}
                rarityColor={
                  cardTypeColor[selectedCard.cardtype] ?? "grey"
                }
                isOwned={selectedCard.owned_count > 0}
              />
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: 2,
                  backgroundColor: "rgba(17, 24, 39, 0.9)",
                  color: "#ffffff",
                  textAlign: "center",
                  boxShadow: 8,
                }}
              >
                <Typography
                  id="modal-modal-title"
                  variant="h6"
                  component="h2"
                  sx={{ fontWeight: 700 }}
                >
                  {selectedCard.card_name}
                </Typography>
                <Typography
                  id="modal-modal-description"
                  sx={{ color: "#cbd5e1" }}
                >
                  {selectedCard.team || "Team unavailable"}
                </Typography>
              </Box>
            </>
          )}
        </Box>
      </Modal>
    </>
  );
}
