import type { ButtonHTMLAttributes, JSX } from "react";

export function Button({
  variant: _variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }): JSX.Element {
  return <button type="button" {...props} />;
}
