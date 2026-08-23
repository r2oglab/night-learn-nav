import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { getUserSettings } from "@/lib/user_settings.functions";
import { applyTheme } from "@/lib/theme";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: RootLayout,
});

function RootLayout() {
  const fetchSettings = useServerFn(getUserSettings);
  const { data: settings } = useQuery({
    queryKey: ["user_settings"],
    queryFn: () => fetchSettings(),
  });

  // Nearly everything in this app is sized in rem, so scaling the root
  // font-size scales spacing and typography together — one setting instead
  // of two unrelated systems. Unset (null) is 100%, i.e. today's look,
  // unchanged for anyone who never opens this setting.
  useEffect(() => {
    document.documentElement.style.fontSize = settings?.ui_scale ? `${settings.ui_scale}%` : "";
  }, [settings?.ui_scale]);

  useEffect(() => {
    applyTheme(settings?.theme, settings?.accent_hue);
  }, [settings?.theme, settings?.accent_hue]);

  return <Outlet />;
}