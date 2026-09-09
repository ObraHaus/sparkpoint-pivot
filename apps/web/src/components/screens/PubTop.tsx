"use client";

import { useRouter } from "next/navigation";
import { SparkMark } from "@/lib/icons";
import { ThemeToggle } from "@/components/screens/ThemeToggle";
import { StageBadge } from "@/components/ui/stage-badge";

/** Shared public top bar — brand + theme toggle + nav links + Connect wallet. */
export function PubTop() {
  const router = useRouter();
  return (
    <div className="pubtop">
      <div className="brand" style={{ cursor: "pointer" }} onClick={() => router.push("/")}>
        <SparkMark size={23} />
        Sparky
      </div>
      <div className="grow"></div>
      <StageBadge />
      <ThemeToggle />
      <a className="publink" onClick={() => router.push("/")}>
        How it works
      </a>
      <a className="publink" onClick={() => router.push("/")}>
        Trust
      </a>
      <a className="publink" onClick={() => router.push("/")}>
        Security
      </a>
      <button className="btn btn-primary btn-md" onClick={() => router.push("/connect")}>
        Connect wallet
      </button>
    </div>
  );
}
