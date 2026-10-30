import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";

function createData(
  name: string,
  bronze: number,
  silver: number,
  gold: number,
  diamond: number,
) {
  return { name, bronze, silver, gold, diamond };
}

const rows = [
  createData("Bronze", 2, 0, 0, 0),
  createData("Silver", 3, 2, 0, 0),
  createData("Gold", 0, 3, 2, 0),
  createData("Diamond", 0, 0, 3, 2),
];

export default function RequirementsTable() {
  return (
    <TableContainer
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 500,
        backgroundColor: "#393e46",
      }}
      component={Paper}
    >
      <Table size="small" aria-label="a dense table">
        <TableHead>
          <TableRow>
            <TableCell>Rarity</TableCell>
            <TableCell align="right">Bronze</TableCell>
            <TableCell align="right">Silver</TableCell>
            <TableCell align="right">Gold</TableCell>
            <TableCell align="right">Diamond</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.name}
              sx={{ "&:last-child td, &:last-child th": { border: 0 } }}
            >
              <TableCell component="th" scope="row">
                {row.name}
              </TableCell>
              <TableCell align="right">{row.bronze}</TableCell>
              <TableCell align="right">{row.silver}</TableCell>
              <TableCell align="right">{row.gold}</TableCell>
              <TableCell align="right">{row.diamond}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
