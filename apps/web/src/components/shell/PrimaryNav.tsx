"use client";

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { PRIMARY } from "@/lib/nav";
import { useStrategiesVisible } from "@/lib/agent/useAgent";

export function PrimaryNav({ active }: { active: string }) {
  // 061 A9 — don't offer a destination that is provably empty. Known-empty only; see the hook.
  const strategiesVisible = useStrategiesVisible();
  const items = PRIMARY.filter((n) => n.route !== "strategies" || strategiesVisible);
  return (
    <nav className="primnav">
      {items.map((n) => (
        <Link key={n.route} href={"/" + n.route} className={active === n.route ? "active" : ""}>
          <Icon name={n.icon} size={17} />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
