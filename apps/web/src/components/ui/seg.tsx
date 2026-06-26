"use client";

/** Segmented control / tabs (the design's `.seg`). */
export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[] | { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="seg">
      {items.map((o) => (
        <button key={o.value} className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
