import { Dialog, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { DialogProps } from "@mui/material";

export function AppDialog({
  children,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  maxWidth = "lg",
  ...props
}: DialogProps) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down("sm"));
  return (
    <Dialog
      {...props}
      fullWidth
      fullScreen={small}
      maxWidth={maxWidth}
      aria-labelledby={labelledBy}
      slotProps={{ paper: { "aria-label": label } }}
    >
      {children}
    </Dialog>
  );
}
