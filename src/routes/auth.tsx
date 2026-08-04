import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BrainCircuit } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Entrar | Estuda — Revisões e Flashcards" },
      {
        name: "description",
        content:
          "Acesse sua conta Estuda com o Google para acompanhar suas revisões espaçadas e flashcards.",
      },
      { property: "og:title", content: "Entrar | Estuda" },
      {
        property: "og:description",
        content: "Acesse suas revisões e flashcards do Estuda com uma conta Google.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [loading, user, navigate]);

  const handleGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });

    if (result.error) {
      setBusy(false);
      toast.error("Não foi possível entrar com o Google.");
      return;
    }

    if (result.redirected) return;

    navigate({ to: "/" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BrainCircuit className="size-5" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Entrar no Estuda</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use sua conta Google para salvar e acompanhar suas revisões.
        </p>
        <Button onClick={handleGoogle} disabled={busy} className="mt-6 w-full">
          {busy ? "Conectando..." : "Continuar com Google"}
        </Button>
      </div>
    </main>
  );
}
