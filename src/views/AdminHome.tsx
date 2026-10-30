import Link from "next/link";
import { ThemeProvider } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { ADMIN_SECTIONS, adminTheme } from "../components/AdminLayout.tsx";

export default function AdminHome() {
  return (
    <ThemeProvider theme={adminTheme}>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" } }}>
        {ADMIN_SECTIONS.map((section) => (
          <Card key={section.href} variant="outlined" sx={{ borderColor: "rgba(189, 149, 35, 0.5)" }}>
            <CardActionArea component={Link} href={section.href} sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, color: "primary.main" }}>
                  {section.label}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
                  {section.description}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </ThemeProvider>
  );
}
