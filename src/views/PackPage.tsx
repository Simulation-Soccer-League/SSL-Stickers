import { motion, useMotionValue, useSpring } from "motion/react";
import Image from "next/image";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import { cld } from "../lib/cloudinary.ts";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Modal from "@mui/material/Modal";
import Typography from "@mui/material/Typography";
import { GetPackCount, OpenPack } from "../api/PackApi.ts";
import type { CardRarity, PackCard } from "../api/PackApi.ts";
import * as React from "react";
import Alert from "@mui/material/Alert";

import { AdvancedImage, placeholder } from "@cloudinary/react";
import type { CloudinaryImage } from "@cloudinary/url-gen";
import { center } from "@cloudinary/url-gen/qualifiers/textAlignment";

const StickerPackLogo = "/StickerPackLogo.png";
const SSLSticker = "/SSLSticker.png";

const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: 155,
  height: 220,
  position: "relative",
  justifyContent: "center",
  alignItems: "center",
  marginLeft: "auto",
  marginRight: "auto",
  perspective: 800,
};

const packLogo: React.CSSProperties = {
  display: "block",
  width: "300px",
  maxWidth: "100%",
  height: "auto",
};

const rarityColors: Record<CardRarity, string> = {
  Bronze: "#A97142",
  Silver: "#C0C0C0",
  Gold: "#FFD700",
  Diamond: "#B9F2FF",
};

interface RevealedCardProps {
  image: CloudinaryImage;
  card: PackCard;
  height?: string;
}

function RevealedCard({
  image,
  card,
  height = "520px",
}: RevealedCardProps) {
  const rotateXValue = useMotionValue(0);
  const rotateYValue = useMotionValue(0);
  const xValue = useMotionValue(0);
  const yValue = useMotionValue(0);

  const springConfig = { stiffness: 260, damping: 22 };
  const rotateX = useSpring(rotateXValue, springConfig);
  const rotateY = useSpring(rotateYValue, springConfig);
  const x = useSpring(xValue, springConfig);
  const y = useSpring(yValue, springConfig);
  const rarityColor = rarityColors[card.rarity];

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
        opacity: { duration: 0.8, delay: 0.5 },
        scale: { duration: 0.8, delay: 0.5 },
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      style={{
        cursor: "move",
        perspective: 700,
        position: "relative",
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
        />
      </motion.div>
    </motion.div>
    </Box>
  );
}

interface StickerThumbnailProps {
  image: CloudinaryImage;
  card: PackCard;
  onClick: () => void;
}

function StickerThumbnail({ image, card, onClick }: StickerThumbnailProps) {
  const rarityColor = rarityColors[card.rarity];

  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      style={{
        background: "transparent",
        border: `3px solid ${rarityColor}`,
        borderRadius: 6,
        boxShadow: `0 0 9px ${rarityColor}, 0 0 20px ${rarityColor}`,
        cursor: "pointer",
        padding: 0,
        position: "relative",
        overflow: "visible",
      }}
    >
      <AdvancedImage
        rel="preload"
        height="210px"
        cldImg={image}
        plugins={[placeholder({ mode: "blur" })]}
      />
      {card.new_card && (
        <Box
          component="span"
          sx={{
            position: "absolute",
            top: -13,
            left: "50%",
            transform: "translateX(-50%)",
            color: "#53e36f",
            border: "2px solid #53e36f",
            bgcolor: "#102516",
            borderRadius: 1,
            px: 0.75,
            py: 0.25,
            fontSize: "0.68rem",
            fontWeight: 800,
            lineHeight: 1,
            whiteSpace: "nowrap",
            boxShadow: "0 0 8px rgba(83, 227, 111, 0.7)",
          }}
        >
          NEW STICKER
        </Box>
      )}
    </motion.button>
  );
}

interface FlippableStickerProps {
  image: CloudinaryImage;
  card: PackCard;
  revealed: boolean;
  onReveal: () => void;
  onOpen: () => void;
}

function FlippableSticker({
  image,
  card,
  revealed,
  onReveal,
  onOpen,
}: FlippableStickerProps) {
  return (
    <motion.div
      animate={{ rotateY: revealed ? 180 : 0 }}
      transition={{ duration: 0.35, ease: "easeInOut" }}
      style={{
        width: 155,
        height: 220,
        position: "relative",
        transformStyle: "preserve-3d",
      }}
    >
      <motion.button
        type="button"
        aria-label="Reveal sticker"
        onClick={onReveal}
        whileHover={{ scale: revealed ? 1 : 1.05 }}
        whileTap={{ scale: revealed ? 1 : 0.98 }}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: 0,
          cursor: revealed ? "default" : "pointer",
          padding: 0,
          backfaceVisibility: "hidden",
        }}
      >
        <Image src={SSLSticker} alt="SSL sticker card back" width={148} height={210} />
      </motion.button>

      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: "rotateY(180deg)",
          backfaceVisibility: "hidden",
        }}
      >
        <StickerThumbnail image={image} card={card} onClick={onOpen} />
      </Box>
    </motion.div>
  );
}

export default function PackPage() {
  const [submit, setSubmit] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState<boolean[]>(
    Array(5).fill(false),
  );
  const [packCards, setPackCards] = React.useState<PackCard[]>([]);
  const [packsAvailable, setPacksAvailable] = React.useState<number | null>(
    null,
  );
  const [opening, setOpening] = React.useState(false);
  const [error, setError] = React.useState("");
  const [selectedCardIndex, setSelectedCardIndex] = React.useState<
    number | null
  >(null);

  React.useEffect(() => {
    GetPackCount()
      .then((result) => setPacksAvailable(result.packs_available))
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load packs",
        );
      });
  }, []);

  const handleOpenPack = async () => {
    if (!packsAvailable || opening) return;

    setOpening(true);
    setError("");

    try {
      const result = await OpenPack();
      setIsVisible(Array(5).fill(false));
      setSelectedCardIndex(null);
      setPackCards(result.cards);
      setPacksAvailable(result.packs_available);
      setSubmit(true);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to open pack",
      );
    } finally {
      setOpening(false);
    }
  };

  const allRevealed = packCards.every((_, index) => isVisible[index]);

  // Turns every card face up at once.
  const flipAll = () => setIsVisible(packCards.map(() => true));

  const returnToPacks = () => {
    setSubmit(false);
    setPackCards([]);
    setIsVisible(Array(5).fill(false));
    setSelectedCardIndex(null);
  };

  const images = React.useMemo(() => {
    return packCards.map((card) =>
      cld.image(card.public_id).quality("auto").format("auto"),
    );
  }, [packCards]);

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "calc(100vh - 112px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        boxSizing: "border-box",
      }}
    >
      {!submit && (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
          }}
        >
          <motion.div
            style={{
              width: 300,
              maxWidth: "calc(100vw - 32px)",
              borderRadius: 5,
              justifySelf: "center",
            }}
            whileTap={packsAvailable ? { scale: 0.95 } : undefined}
          >
            <Image
              src={StickerPackLogo}
              alt="Sticker pack"
              width={916}
              height={1460}
              priority
              style={packLogo}
            />
          </motion.div>
          <Typography variant="h6">
            {packsAvailable === null
              ? "Loading packs..."
              : `Packs available: ${packsAvailable}`}
          </Typography>
          <Button
            type="button"
            variant="contained"
            onClick={handleOpenPack}
            disabled={opening || !packsAvailable}
            startIcon={opening ? <CircularProgress size={18} /> : undefined}
          >
            {opening ? "Opening..." : "Open"}
          </Button>
        </Box>
      )}
      {submit && (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            width: "calc(100% - 32px)",
            maxWidth: 980,
            mx: "auto",
            mb: 2,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 2.5,
            }}
          >
            <Button
              type="button"
              variant="text"
              onClick={returnToPacks}
              sx={{
                color: "#ffffff",
                fontSize: "1rem",
                fontWeight: 600,
                lineHeight: 1.5,
                minWidth: 0,
                p: 0,
                textTransform: "none",
              }}
            >
              {"< Return to Packs"}
            </Button>
            <Typography
              sx={{ fontSize: "1rem", fontWeight: 600, lineHeight: 1.5 }}
            >
              Packs Available: {packsAvailable ?? 0}
            </Typography>
          </Box>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 1.5,
            }}
          >
            <Button
              type="button"
              variant="contained"
              onClick={flipAll}
              disabled={allRevealed}
            >
              Flip All
            </Button>
            <Button
              type="button"
              variant="outlined"
              onClick={handleOpenPack}
              disabled={opening || !packsAvailable}
              startIcon={opening ? <CircularProgress size={16} /> : undefined}
            >
              {opening ? "Opening..." : "Open Next Pack"}
            </Button>
          </Box>
        </Box>
      )}
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 2,
          alignItems: "center",
          width: "calc(100% - 32px)",
          maxWidth: 980,
          mx: "auto",
        }}
      >
        {submit &&
          images.map((id, index) => (
            <Grid
              key={`${packCards[index].public_id}-${index}`}
              display="flex"
              justifyContent="center"
              alignItems="center"
              size="auto"
              sx={{ width: 165 }}
            >
              <div style={container}>
                <FlippableSticker
                  image={id}
                  card={packCards[index]}
                  revealed={isVisible[index]}
                  onReveal={() =>
                    setIsVisible((prev) =>
                      prev.map((visible, cardIndex) =>
                        cardIndex === index ? true : visible,
                      ),
                    )
                  }
                  onOpen={() => setSelectedCardIndex(index)}
                />
              </div>
            </Grid>
          ))}
      </Box>
      {error && (
        <Alert severity="error" sx={{ mt: 20, justifySelf: center }}>
          {error}
        </Alert>
      )}
      <Modal
        open={selectedCardIndex !== null}
        onClose={() => setSelectedCardIndex(null)}
      >
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            outline: "none",
          }}
        >
          {selectedCardIndex !== null && (
            <RevealedCard
              image={images[selectedCardIndex]}
              card={packCards[selectedCardIndex]}
            />
          )}
        </Box>
      </Modal>
    </Box>
  );
}
