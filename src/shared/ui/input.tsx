import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/shared/lib";
export function Input({
  label,
  error,
  className,
  id: customId,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const generatedId = useId();
  const id = customId ?? generatedId;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={cn("input", className)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      <span className="field-error" id={`${id}-error`}>
        {error}
      </span>
    </div>
  );
}
