import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = "", ...props }: InputProps) {
  if (!label) {
    return <input className={className} {...props} />;
  }
  return (
    <label className="input-wrap">
      <span>{label}</span>
      <input className={className} {...props} />
    </label>
  );
}
