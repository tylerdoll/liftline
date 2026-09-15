import {
  Checkbox,
  TextField,
  NativeSelect,
  OutlinedInput,
} from "@mui/material";
import type { ComponentPropsWithRef, SelectHTMLAttributes } from "react";

// Keep native input refs, names and event contracts for draft persistence and forms.
export function Field({
  className,
  ref,
  value,
  defaultValue,
  label,
  ...input
}: ComponentPropsWithRef<"input"> & { label?: string }) {
  if (input.type === "checkbox") {
    return (
      <Checkbox
        checked={input.checked}
        disabled={input.disabled}
        onChange={input.onChange}
        slotProps={{ input: { ...input, ref } }}
      />
    );
  }
  return (
    <TextField
      className={className}
      label={label}
      value={value}
      defaultValue={defaultValue}
      type={input.type}
      disabled={input.disabled}
      required={input.required}
      slotProps={{ htmlInput: { ...input, ref } }}
    />
  );
}

export function SelectField({
  className,
  children,
  value,
  defaultValue,
  ...input
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <NativeSelect
      className={className}
      value={value}
      defaultValue={defaultValue}
      input={<OutlinedInput size="small" />}
      inputProps={input}
    >
      {children}
    </NativeSelect>
  );
}
