import * as React from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import FolderZipIcon from "@mui/icons-material/FolderZip";
import { adminTheme } from "../components/AdminLayout.tsx";
import { uploadCards, type OriginalCard } from "../api/CardApi.ts";
import { ApiError } from "../lib/request.ts";
import { useGlobalContext } from "../utils/ContextProvider.tsx";

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const LISTED_CARDS = 20;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const cardLabel = (card: OriginalCard) =>
  [card.name ?? "(no name)", card.cardtype, `S${card.season}`, card.team ?? "no team"].join(" · ");

type UploadError = { message: string; files: string[] };

// Client-side check before sending; the server validates every entry again.
function checkZip(file: File): string | null {
  if (!/\.zip$/i.test(file.name)) return "Choose a .zip file.";
  if (file.size > MAX_ZIP_BYTES) return `That file is ${formatSize(file.size)}; the limit is 50 MB.`;
  return null;
}

export default function CardUpload() {
  // Admins publish directly; moderators' uploads wait for approval (admin area → Card Approval).
  const { user } = useGlobalContext();
  const isAdmin = user === "admin";

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploaded, setUploaded] = React.useState<OriginalCard[] | null>(null);
  const [error, setError] = React.useState<UploadError | null>(null);

  const chooseFile = (next: File | null) => {
    setUploaded(null);
    if (!next) {
      setFile(null);
      setError(null);
      return;
    }
    const problem = checkZip(next);
    setFile(problem ? null : next);
    setError(problem ? { message: problem, files: [] } : null);
  };

  const clearFile = () => {
    chooseFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    chooseFile(event.dataTransfer.files[0] ?? null);
  };

  const handleUpload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    setUploaded(null);
    try {
      const cards = await uploadCards(file);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setUploaded(cards);
    } catch (requestError) {
      const body = requestError instanceof ApiError ? (requestError.body as { files?: unknown } | null) : null;
      setError({
        message: requestError instanceof Error ? requestError.message : "Upload failed",
        files: Array.isArray(body?.files) ? body.files.map(String) : [],
      });
    } finally {
      setUploading(false);
    }
  };

  const published = uploaded?.filter((card) => card.approved) ?? [];
  const queued = uploaded?.filter((card) => !card.approved) ?? [];

  return (
    <ThemeProvider theme={adminTheme}>
      <Box
        sx={{
          width: "100%",
          maxWidth: 760,
          mx: "auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 3,
          color: "text.primary",
        }}
      >
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, display: "grid", gap: 2 }}>
          <Box>
            <Typography component="h2" variant="h6" sx={{ fontWeight: 700 }}>
              Upload cards
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
              {isAdmin
                ? "Your cards publish immediately."
                : "Your cards will be reviewed by an admin before they appear in packs."}
            </Typography>
          </Box>

          <Box sx={{ fontSize: "0.875rem", color: "text.secondary", display: "grid", gap: 0.5 }}>
            <span>Upload one .zip containing a PNG image for each card, named:</span>
            <Box
              component="code"
              sx={{ color: "primary.main", fontSize: "0.95rem", fontWeight: 700, overflowWrap: "anywhere" }}
            >
              Player_Name-rarity-season-Team_Name.png
            </Box>
            <span>
              Example: <code>John_Doe-gold-S23-Tokyo_S.C..png</code>. Underscores become spaces; rarity is bronze,
              silver, gold or diamond; the season is the first two digits of its part. The team is optional; anything
              after it is ignored (e.g. <code>-2</code> to tell two images of the same card apart). Up to 200 images
              and 50 MB.
            </span>
          </Box>

          <Box
            onDragOver={(event) => {
              event.preventDefault();
              if (!uploading) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            sx={{
              border: "2px dashed",
              borderColor: dragging ? "primary.main" : "rgba(189, 149, 35, 0.45)",
              bgcolor: dragging ? "rgba(189, 149, 35, 0.08)" : "transparent",
              borderRadius: 2,
              p: { xs: 2.5, sm: 4 },
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.5,
              textAlign: "center",
              transition: "border-color 120ms, background-color 120ms",
            }}
          >
            <CloudUploadIcon sx={{ fontSize: 40, color: "primary.main" }} />
            <Typography sx={{ color: "text.secondary" }}>Drag a .zip here, or</Typography>
            <Button variant="outlined" component="label" disabled={uploading}>
              Choose file
              <input
                ref={inputRef}
                hidden
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              />
            </Button>
          </Box>

          {file && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 1.5,
                borderRadius: 1,
                bgcolor: "rgba(255, 255, 255, 0.05)",
              }}
            >
              <FolderZipIcon sx={{ color: "primary.main" }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{file.name}</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {formatSize(file.size)}
                </Typography>
              </Box>
              <IconButton aria-label="Remove file" onClick={clearFile} disabled={uploading}>
                <CloseIcon />
              </IconButton>
            </Box>
          )}

          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              variant="contained"
              size="large"
              onClick={() => void handleUpload()}
              disabled={!file || uploading}
              startIcon={uploading ? <CircularProgress size={18} color="inherit" /> : <CloudUploadIcon />}
              sx={{ minWidth: 160 }}
            >
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </Box>

          {uploaded && (
            <Alert severity="success" onClose={() => setUploaded(null)}>
              <AlertTitle>
                {uploaded.length} {uploaded.length === 1 ? "card" : "cards"} uploaded
              </AlertTitle>
              {published.length > 0 && <div>Published: {published.length}</div>}
              {queued.length > 0 && <div>Sent for admin approval: {queued.length}</div>}
              <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                {uploaded.slice(0, LISTED_CARDS).map((card) => (
                  <li key={card.id}>{cardLabel(card)}</li>
                ))}
              </Box>
              {uploaded.length > LISTED_CARDS && <div>…and {uploaded.length - LISTED_CARDS} more</div>}
            </Alert>
          )}

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              <AlertTitle>Upload failed</AlertTitle>
              {error.message}
              {error.files.length > 0 && (
                <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                  {error.files.map((name) => (
                    <li key={name}>
                      <code>{name}</code>
                    </li>
                  ))}
                </Box>
              )}
            </Alert>
          )}
        </Paper>
      </Box>
    </ThemeProvider>
  );
}
