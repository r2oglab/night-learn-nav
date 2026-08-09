import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Repeat,
  Layers,
  Settings,
  BrainCircuit,
  Plus,
  LogIn,
  LogOut,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";

const items = [
  { title: "Dashboard", icon: LayoutDashboard, to: "/" as const },
  { title: "Revisões", icon: Repeat, to: "/revisoes" as const },
  { title: "Flashcards", icon: Layers, to: "/flashcards" as const },
  { title: "Criação", icon: Plus, to: "/criacao" as const },
  { title: "Configurações", icon: Settings, to: "/configuracoes" as const },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { user, signOut } = useAuth();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BrainCircuit className="size-4" />
          </div>
          {!collapsed && <span className="text-sm font-semibold tracking-tight">Estuda</span>}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link to={item.to} activeProps={{ "data-active": "true" }}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {user ? (
              <SidebarMenuButton onClick={() => signOut()} tooltip="Sair">
                <LogOut className="size-4" />
                <span className="truncate">{user.email ?? "Sair"}</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton asChild tooltip="Entrar">
                <Link to="/auth">
                  <LogIn className="size-4" />
                  <span>Entrar</span>
                </Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
