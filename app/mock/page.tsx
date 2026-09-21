import { MockDraftApp } from "@/components/MockDraftApp";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Luistin — Mock draft",
  description: "20 joukkueen Yahoo Fantasy Hockey snake mock draft, bottivastustajat ja jaettu huone.",
};

export default function MockPage() {
  return (
    <Suspense
      fallback={
        <p className="px-3 py-8 text-center text-sm text-muted">Ladataan mock draftia…</p>
      }
    >
      <MockDraftApp />
    </Suspense>
  );
}
