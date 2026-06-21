import { redirect } from "next/navigation";

export default function Home() {
  // The app entry is the chat assistant (the primary surface).
  redirect("/chat");
}
