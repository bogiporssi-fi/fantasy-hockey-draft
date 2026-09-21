import { MockDraftApp } from "@/components/MockDraftApp";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Luistin — Mock draft",
  description: "20 joukkueen Yahoo Fantasy Hockey snake mock draft, bottivastustajat.",
};

export default function MockPage() {
  return <MockDraftApp />;
}
