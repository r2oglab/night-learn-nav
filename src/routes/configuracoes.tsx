import { createFileRoute } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/configuracoes")({
  component: Configuracoes,
});

function Configuracoes() {
  const { user, signOut } = useAuth();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-sm font-medium">Configurações</h1>
          </header>

          <main className="flex flex-1 justify-center p-6">
            <div className="w-full max-w-2xl">
              <section className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-sm font-medium">Conta</h2>
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">{user?.email ?? "—"}</div>
                  <Button variant="destructive" onClick={() => signOut()}>
                    Sair
                  </Button>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
