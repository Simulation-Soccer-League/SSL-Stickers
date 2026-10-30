import Box from "@mui/material/Box";
import Button from "@mui/material/Button";

import Link from "next/link";
import { useGlobalContext } from "../utils/ContextProvider.tsx";
import { requestLogin } from "../utils/authEvents.ts";
export default function StickerNavigation() {
  const { auth } = useGlobalContext();

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Button
        component={auth ? Link : "button"}
        href={auth ? "/MyFolder" : undefined}
        onClick={auth ? undefined : requestLogin}
        variant="text"
        size="small"
        sx={{ height: "100%", color: "#ffffff" }}
      >
        My Collection
      </Button>
      <Button
        component={auth ? Link : "button"}
        href={auth ? "/PackPage" : undefined}
        onClick={auth ? undefined : requestLogin}
        variant="text"
        size="small"
        sx={{ height: "100%", color: "#ffffff" }}
      >
        Open Packs
      </Button>
    </Box>
  );
}
