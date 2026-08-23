import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_settings")
      .select(
        "user_id,daily_goal,desired_retention,last_review_date,streak,display_name,avatar_url,daily_limit,daily_new_limit,ui_scale",
      )
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        user_id: context.userId,
        daily_goal: 20,
        desired_retention: 0.9,
        last_review_date: null,
        streak: 0,
        display_name: null as string | null,
        avatar_url: null as string | null,
        daily_limit: null as number | null,
        daily_new_limit: null as number | null,
        ui_scale: null as number | null,
      };
    }
    return data;
  });

export const upsertUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      daily_goal?: number;
      desired_retention?: number;
      streak?: number;
      daily_limit?: number | null;
      daily_new_limit?: number | null;
      ui_scale?: number | null;
      display_name?: string;
      avatar_url?: string;
    }) => {
      const out: any = {};
      if (typeof input.daily_goal === "number")
        out.daily_goal = Math.max(0, Math.round(input.daily_goal));
      if (typeof input.desired_retention === "number")
        out.desired_retention = Math.max(0.0, Math.min(1.0, input.desired_retention));
      if (typeof input.streak === "number") out.streak = Math.max(0, Math.floor(input.streak));
      // An empty name clears the override and falls back to the account email.
      if (input.daily_limit === null) out.daily_limit = null;
      else if (typeof input.daily_limit === "number")
        out.daily_limit = Math.max(0, Math.floor(input.daily_limit));
      if (input.daily_new_limit === null) out.daily_new_limit = null;
      else if (typeof input.daily_new_limit === "number")
        out.daily_new_limit = Math.max(0, Math.floor(input.daily_new_limit));
      if (input.ui_scale === null) out.ui_scale = null;
      else if (typeof input.ui_scale === "number")
        out.ui_scale = Math.max(80, Math.min(150, Math.round(input.ui_scale)));
      if (typeof input.display_name === "string")
        out.display_name = input.display_name.trim() || null;
      if (typeof input.avatar_url === "string") out.avatar_url = input.avatar_url.trim() || null;
      return out;
    },
  )
  .handler(async ({ data, context }) => {
    const payload: any = { user_id: context.userId };
    if (data.daily_goal !== undefined) payload.daily_goal = data.daily_goal;
    if (data.desired_retention !== undefined) payload.desired_retention = data.desired_retention;
    if (data.daily_limit !== undefined) payload.daily_limit = data.daily_limit;
    if (data.daily_new_limit !== undefined) payload.daily_new_limit = data.daily_new_limit;
    if (data.ui_scale !== undefined) payload.ui_scale = data.ui_scale;
    if (data.display_name !== undefined) payload.display_name = data.display_name;
    if (data.avatar_url !== undefined) payload.avatar_url = data.avatar_url;
    if (data.streak !== undefined) payload.streak = data.streak;

    const { data: row, error } = await context.supabase
      .from("user_settings")
      .upsert(payload, { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });