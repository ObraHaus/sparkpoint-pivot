/** Shared SparkPoint brand mark (the cobalt→cyan→gold→coral spark). */
export function SparkMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id="spk-mark" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4D83FF" />
          <stop offset=".5" stopColor="#38C6F4" />
          <stop offset=".8" stopColor="#F5B62E" />
          <stop offset="1" stopColor="#F2683C" />
        </linearGradient>
      </defs>
      <path d="M12 1c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8Z" fill="url(#spk-mark)" />
    </svg>
  );
}
