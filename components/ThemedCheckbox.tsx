"use client";

interface ThemedCheckboxProps {
  checked: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

export default function ThemedCheckbox({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  className = "",
}: ThemedCheckboxProps) {
  return (
    <span className={`relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-surface-overlay shadow-lg shadow-black/5 transition-colors hover:bg-[var(--glass-hover-background)] focus-within:ring-4 focus-within:ring-accent/15 ${checked ? "border-accent/60 bg-accent/20 text-accent-light" : "text-transparent"} ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <svg className={`pointer-events-none h-3.5 w-3.5 transition-opacity ${checked ? "opacity-100" : "opacity-0"}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
