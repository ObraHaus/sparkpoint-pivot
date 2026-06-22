"use client";

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { PRIMARY } from "@/lib/nav";

export function PrimaryNav({ active }: { active: string }) {
  return (
    <nav className="primnav">
      {PRIMARY.map((n) => (
        <Link key={n.route} href={"/" + n.route} className={active === n.route ? "active" : ""}>
          <Icon name={n.icon} size={17} />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
