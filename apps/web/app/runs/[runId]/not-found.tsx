import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function RunDossierNotFound() {
  return (
    <section className="grid min-h-[28rem] place-items-center py-12 text-center">
      <div>
        <FileQuestion aria-hidden className="mx-auto" size={30} />
        <p className="mt-6 font-mono text-[0.63rem] font-bold tracking-[0.15em] text-stone-500">
          NO COMMITTED RUN
        </p>
        <h1 className="mt-3 font-serif text-5xl">Dossier unavailable.</h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-stone-600">
          Prism could not find a durable manifest for this Run. Prototype records are
          never substituted for missing runtime state.
        </p>
        <Button asChild className="mt-8">
          <Link href="/">Return to Field Desk</Link>
        </Button>
      </div>
    </section>
  );
}
