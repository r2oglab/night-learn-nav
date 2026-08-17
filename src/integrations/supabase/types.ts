export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      cards: {
        Row: {
          created_at: string;
          difficulty: number;
          due: string;
          elapsed_days: number;
          id: string;
          lapses: number;
          last_review: string | null;
          pergunta: string;
          reps: number;
          resposta: string;
          scheduled_days: number;
          stability: number;
          state: number;
          deck_id: string;
          updated_at: string;
          user_id: string;
          image_url: string | null;
          occlusion_regions: Json | null;
          occlusion_target_id: string | null;
          card_type: string | null;
          image_placement: string | null;
          prev_state: Json | null;
          suspended: boolean;
          explanation: string | null;
        };
        Insert: {
          created_at?: string;
          difficulty?: number;
          due?: string;
          elapsed_days?: number;
          id?: string;
          lapses?: number;
          last_review?: string | null;
          pergunta: string;
          reps?: number;
          resposta: string;
          scheduled_days?: number;
          stability?: number;
          state?: number;
          deck_id: string;
          updated_at?: string;
          user_id: string;
          image_url?: string | null;
          occlusion_regions?: Json | null;
          occlusion_target_id?: string | null;
          card_type?: string | null;
          image_placement?: string | null;
          prev_state?: Json | null;
          suspended?: boolean;
          explanation?: string | null;
        };
        Update: {
          created_at?: string;
          difficulty?: number;
          due?: string;
          elapsed_days?: number;
          id?: string;
          lapses?: number;
          last_review?: string | null;
          pergunta?: string;
          reps?: number;
          resposta?: string;
          scheduled_days?: number;
          stability?: number;
          state?: number;
          deck_id?: string;
          updated_at?: string;
          user_id?: string;
          image_url?: string | null;
          occlusion_regions?: Json | null;
          occlusion_target_id?: string | null;
          card_type?: string | null;
          image_placement?: string | null;
          prev_state?: Json | null;
          suspended?: boolean;
          explanation?: string | null;
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
      revisions: {
        Row: {
          created_at: string;
          id: string;
          rating: number | null;
          scheduled_date: string;
          status: string;
          deck_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          rating?: number | null;
          scheduled_date: string;
          status?: string;
          deck_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          rating?: number | null;
          scheduled_date?: string;
          status?: string;
          deck_id?: string | null;
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
      decks: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          parent_id: string | null;
          daily_limit: number | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          parent_id?: string | null;
          daily_limit?: number | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          parent_id?: string | null;
          daily_limit?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "decks_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      user_settings: {
        Row: {
          created_at: string;
          daily_goal: number;
          desired_retention: number;
          last_review_date: string | null;
          display_name: string | null;
          avatar_url: string | null;
          streak: number;
          daily_limit: number | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          daily_goal?: number;
          desired_retention?: number;
          last_review_date?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          streak?: number;
          daily_limit?: number | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          daily_goal?: number;
          desired_retention?: number;
          last_review_date?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          streak?: number;
          daily_limit?: number | null;
          user_id?: string;
        };
        Relationships: [];
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