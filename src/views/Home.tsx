import Box from "@mui/material/Box";

const StickersHome = "/StickersHome.mp4";

export default function Home() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
        minHeight: "60vh",
      }}
    >
      <Box
        component="video"
        src={StickersHome}
        autoPlay
        muted
        playsInline
        preload="auto"
        sx={{
          display: "block",
          width: "100%",
          maxWidth: 900,
          maxHeight: "70vh",
          objectFit: "contain",
        }}
      />
    </Box>
  );
}
