export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      card_edit_logs: {
        Row: {
          card_id: string;
          edited_at: string;
          id: string;
          new_pergunta: string;
          new_resposta: string;
          previous_pergunta: string;
          previous_resposta: string;
          user_id: string;
        };
        Insert: {
          card_id: string;
          edited_at?: string;
          id?: string;
          new_pergunta: string;
          new_resposta: string;
          previous_pergunta: string;
          previous_resposta: string;
          user_id: string;
        };
        Update: {
          card_id?: string;
          edited_at?: string;
          id?: string;
          new_pergunta?: string;
          new_resposta?: string;
          previous_pergunta?: string;
          previous_resposta?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "card_edit_logs_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      card_links: {
        Row: {
          card_a_id: string;
          card_b_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          card_a_id: string;
          card_b_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          card_a_id?: string;
          card_b_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "card_links_card_a_id_fkey";
            columns: ["card_a_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "card_links_card_b_id_fkey";
            columns: ["card_b_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      cards: {
        Row: {
          card_type: string | null;
          created_at: string;
          deck_id: string;
          deleted_at: string | null;
          difficulty: number;
          due: string;
          elapsed_days: number;
          explanation: string | null;
          id: string;
          image_placement: string | null;
          image_url: string | null;
          lapses: number;
          last_review: string | null;
          note: string | null;
          occlusion_regions: Json | null;
          occlusion_target_id: string | null;
          pergunta: string;
          prev_state: Json | null;
          reps: number;
          resposta: string;
          scheduled_days: number;
          stability: number;
          state: number;
          suspended: boolean;
          tags: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          card_type?: string | null;
          created_at?: string;
          deck_id: string;
          deleted_at?: string | null;
          difficulty?: number;
          due?: string;
          elapsed_days?: number;
          explanation?: string | null;
          id?: string;
          image_placement?: string | null;
          image_url?: string | null;
          lapses?: number;
          last_review?: string | null;
          note?: string | null;
          occlusion_regions?: Json | null;
          occlusion_target_id?: string | null;
          pergunta: string;
          prev_state?: Json | null;
          reps?: number;
          resposta: string;
          scheduled_days?: number;
          stability?: number;
          state?: number;
          suspended?: boolean;
          tags?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          card_type?: string | null;
          created_at?: string;
          deck_id?: string;
          deleted_at?: string | null;
          difficulty?: number;
          due?: string;
          elapsed_days?: number;
          explanation?: string | null;
          id?: string;
          image_placement?: string | null;
          image_url?: string | null;
          lapses?: number;
          last_review?: string | null;
          note?: string | null;
          occlusion_regions?: Json | null;
          occlusion_target_id?: string | null;
          pergunta?: string;
          prev_state?: Json | null;
          reps?: number;
          resposta?: string;
          scheduled_days?: number;
          stability?: number;
          state?: number;
          suspended?: boolean;
          tags?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cards_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      decks: {
        Row: {
          archived: boolean;
          created_at: string;
          daily_limit: number | null;
          daily_new_limit: number | null;
          deleted_at: string | null;
          exam_date: string | null;
          id: string;
          name: string;
          parent_id: string | null;
          pinned: boolean;
          sort_order: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived?: boolean;
          created_at?: string;
          daily_limit?: number | null;
          daily_new_limit?: number | null;
          deleted_at?: string | null;
          exam_date?: string | null;
          id?: string;
          name: string;
          parent_id?: string | null;
          pinned?: boolean;
          sort_order?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived?: boolean;
          created_at?: string;
          daily_limit?: number | null;
          daily_new_limit?: number | null;
          deleted_at?: string | null;
          exam_date?: string | null;
          id?: string;
          name?: string;
          parent_id?: string | null;
          pinned?: boolean;
          sort_order?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "themes_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      review_logs: {
        Row: {
          card_id: string;
          deck_id: string;
          id: string;
          rating: number;
          reviewed_at: string;
          user_id: string;
          was_correct: boolean;
        };
        Insert: {
          card_id: string;
          deck_id: string;
          id?: string;
          rating: number;
          reviewed_at?: string;
          user_id: string;
          was_correct: boolean;
        };
        Update: {
          card_id?: string;
          deck_id?: string;
          id?: string;
          rating?: number;
          reviewed_at?: string;
          user_id?: string;
          was_correct?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "review_logs_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_logs_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      revisions: {
        Row: {
          created_at: string;
          deck_id: string | null;
          id: string;
          rating: number | null;
          scheduled_date: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          deck_id?: string | null;
          id?: string;
          rating?: number | null;
          scheduled_date: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          deck_id?: string | null;
          id?: string;
          rating?: number | null;
          scheduled_date?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "revisions_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      user_settings: {
        Row: {
          accent_hue: number | null;
          avatar_url: string | null;
          created_at: string;
          daily_goal: number;
          daily_limit: number | null;
          daily_new_limit: number | null;
          desired_retention: number;
          display_name: string | null;
          hidden_widgets: string[];
          last_review_date: string | null;
          streak: number;
          theme: string | null;
          ui_scale: number | null;
          user_id: string;
        };
        Insert: {
          accent_hue?: number | null;
          avatar_url?: string | null;
          created_at?: string;
          daily_goal?: number;
          daily_limit?: number | null;
          daily_new_limit?: number | null;
          desired_retention?: number;
          display_name?: string | null;
          hidden_widgets?: string[];
          last_review_date?: string | null;
          streak?: number;
          theme?: string | null;
          ui_scale?: number | null;
          user_id: string;
        };
        Update: {
          accent_hue?: number | null;
          avatar_url?: string | null;
          created_at?: string;
          daily_goal?: number;
          daily_limit?: number | null;
          daily_new_limit?: number | null;
          desired_retention?: number;
          display_name?: string | null;
          hidden_widgets?: string[];
          last_review_date?: string | null;
          streak?: number;
          theme?: string | null;
          ui_scale?: number | null;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;