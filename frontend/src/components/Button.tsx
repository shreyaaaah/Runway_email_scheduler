import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "quiet";
  children: ReactNode;
}

export function Button({ variant = "quiet", className = "", children, ...props }: ButtonProps) {
  return (
    <button className={`${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
