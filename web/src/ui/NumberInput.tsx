import { useEffect, useRef, useState } from "react";

/**
 * Controlled number input that tolerates a transiently empty or partial field while
 * typing. A naive `onChange={(e) => set(Math.max(1, Number(e.target.value)))}` snaps
 * the field back to the minimum the instant it's cleared — deleting "5" to type "25"
 * becomes impossible. Here the visible draft string is local: parseable input commits
 * the clamped value immediately; an empty/garbled field commits nothing until blur,
 * which snaps the draft back to the last committed value.
 */
export function NumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  disabled,
  className,
  title,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const lastCommitted = useRef(value);

  // Sync the draft only when the OUTSIDE value genuinely changed (e.g. a Max button
  // or a row switch) — never while the user is mid-edit on their own keystrokes.
  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setDraft(String(value));
    }
  }, [value]);

  const clamp = (n: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));

  return (
    <input
      type="number"
      inputMode="numeric"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={className}
      title={title}
      onChange={(e) => {
        const s = e.target.value;
        setDraft(s);
        const n = Number(s);
        if (s !== "" && Number.isFinite(n)) {
          const c = clamp(n);
          lastCommitted.current = c;
          onCommit(c);
        }
      }}
      onBlur={() => {
        const n = Number(draft);
        const c = draft !== "" && Number.isFinite(n) ? clamp(n) : lastCommitted.current;
        lastCommitted.current = c;
        setDraft(String(c));
        onCommit(c);
      }}
    />
  );
}
