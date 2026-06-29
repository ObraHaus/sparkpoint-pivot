import logo from "@/assets/brand/sparky-logo.png";

/**
 * Sparky brand logo — the real two-lozenge "S" mark (orange/blue + yellow
 * overlap), transparent background. Served from /_next/static (build asset),
 * so it loads on the gated landing without a gate allow-list entry.
 */
export function SparkLogo({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo.src}
      width={size}
      height={size}
      alt="Sparky"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
