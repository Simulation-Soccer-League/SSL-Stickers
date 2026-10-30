import type { PropsWithChildren } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { ThemeProvider, createTheme } from "@mui/material/styles";

// Dark MUI theme matching the site (gold accent, header navy).
export const adminTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#bd9523" },
    background: { default: "#393e46", paper: "#222831" },
  },
});

export const ADMIN_SECTIONS = [
  { href: "/CardUpload", label: "Card Upload", description: "Upload a .zip of card images." },
  { href: "/admin/approvals", label: "Card Approval", description: "Approve or delete cards uploaded by moderators." },
  { href: "/admin/users", label: "User Roles", description: "Change what each user can do on the site." },
] as const;

// Admin area wrapper: title and tabs between the admin pages. Only the title
// and tabs use the admin theme, so wrapped pages keep their own styling.
export default function AdminLayout({ children }: PropsWithChildren) {
  const { pathname } = useRouter();
  const current = ADMIN_SECTIONS.find((section) => pathname.startsWith(section.href))?.href ?? false;

  return (
    <Box sx={{ width: "100%", maxWidth: 1000, mx: "auto", color: "#ffffff" }}>
      <ThemeProvider theme={adminTheme}>
        <Typography component="h1" variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          <Link href="/admin" style={{ color: "inherit" }}>
            Admin
          </Link>
        </Typography>
        <Tabs
          value={current}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ mb: 3, borderBottom: 1, borderColor: "rgba(189, 149, 35, 0.4)" }}
        >
          {ADMIN_SECTIONS.map((section) => (
            <Tab key={section.href} value={section.href} label={section.label} component={Link} href={section.href} />
          ))}
        </Tabs>
      </ThemeProvider>
      {children}
    </Box>
  );
}
