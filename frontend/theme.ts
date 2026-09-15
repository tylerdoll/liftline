import { createTheme } from "@mui/material/styles";

// Use Material UI's typography, palette, spacing, and component states throughout.
export const theme = createTheme({
  cssVariables: true,
  typography: { fontFamily: "Roboto, Arial, sans-serif" },
  components: {
    MuiButton: { defaultProps: { size: "medium" } },
    MuiTextField: { defaultProps: { variant: "outlined", size: "small" } },
  },
});
