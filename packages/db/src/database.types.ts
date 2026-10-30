export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      ai_calls: {
        Row: {
          called_at: string;
          id: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          called_at?: string;
          id?: never;
          user_id: string;
        };
        Update: {
          called_at?: string;
          id?: never;
          user_id?: string;
        };
        Relationships: [];
      };
      ai_usage: {
        Row: {
          month: string;
          notes: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          month: string;
          notes?: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          month?: string;
          notes?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          created_at: string;
          default_targets: string[];
          default_visibility: string;
          hue: number;
          id: string;
          name: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          default_targets?: string[];
          default_visibility?: string;
          hue: number;
          id?: string;
          name: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          default_targets?: string[];
          default_visibility?: string;
          hue?: number;
          id?: string;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      event_targets: {
        Row: {
          created_at: string;
          device_calendar_key: string | null;
          device_id: string | null;
          error: string | null;
          event_id: string;
          external_id: string | null;
          fingerprint: string | null;
          google_calendar_id: string | null;
          id: string;
          kind: string;
          remove_requested: boolean;
          status: string;
          synced_at: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          device_calendar_key?: string | null;
          device_id?: string | null;
          error?: string | null;
          event_id: string;
          external_id?: string | null;
          fingerprint?: string | null;
          google_calendar_id?: string | null;
          id?: string;
          kind: string;
          remove_requested?: boolean;
          status?: string;
          synced_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          device_calendar_key?: string | null;
          device_id?: string | null;
          error?: string | null;
          event_id?: string;
          external_id?: string | null;
          fingerprint?: string | null;
          google_calendar_id?: string | null;
          id?: string;
          kind?: string;
          remove_requested?: boolean;
          status?: string;
          synced_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_targets_event_id_user_id_fkey";
            columns: ["event_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "event_targets_google_calendar_id_user_id_fkey";
            columns: ["google_calendar_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "google_calendars";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      events: {
        Row: {
          all_day: boolean;
          category_id: string | null;
          created_at: string;
          day: string;
          days: number;
          deleted_at: string | null;
          done: boolean;
          end_min: number;
          etag: string | null;
          google_calendar_id: string | null;
          google_event_id: string | null;
          id: string;
          is_mine: boolean;
          legacy_id: string | null;
          organizer_email: string | null;
          pauses: NonNullable<Json>;
          series_id: string | null;
          source: string;
          start_min: number;
          title: string;
          updated_at: string;
          user_id: string;
          visibility: string;
          win: Json | null;
          win_asked: boolean;
        };
        ComputedFields: never;
        Insert: {
          all_day?: boolean;
          category_id?: string | null;
          created_at?: string;
          day: string;
          days?: number;
          deleted_at?: string | null;
          done?: boolean;
          end_min: number;
          etag?: string | null;
          google_calendar_id?: string | null;
          google_event_id?: string | null;
          id?: string;
          is_mine?: boolean;
          legacy_id?: string | null;
          organizer_email?: string | null;
          pauses?: NonNullable<Json>;
          series_id?: string | null;
          source?: string;
          start_min: number;
          title?: string;
          updated_at?: string;
          user_id?: string;
          visibility?: string;
          win?: Json | null;
          win_asked?: boolean;
        };
        Update: {
          all_day?: boolean;
          category_id?: string | null;
          created_at?: string;
          day?: string;
          days?: number;
          deleted_at?: string | null;
          done?: boolean;
          end_min?: number;
          etag?: string | null;
          google_calendar_id?: string | null;
          google_event_id?: string | null;
          id?: string;
          is_mine?: boolean;
          legacy_id?: string | null;
          organizer_email?: string | null;
          pauses?: NonNullable<Json>;
          series_id?: string | null;
          source?: string;
          start_min?: number;
          title?: string;
          updated_at?: string;
          user_id?: string;
          visibility?: string;
          win?: Json | null;
          win_asked?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "events_category_id_user_id_fkey";
            columns: ["category_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "events_google_calendar_id_user_id_fkey";
            columns: ["google_calendar_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "google_calendars";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "events_series_id_user_id_fkey";
            columns: ["series_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "series";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      gcal_links: {
        Row: {
          map: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          map?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          map?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      goals: {
        Row: {
          category_id: string | null;
          created_at: string;
          deadline: string | null;
          hours: number;
          hue: number;
          id: string;
          legacy_id: string | null;
          outcome: string;
          start_date: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          category_id?: string | null;
          created_at?: string;
          deadline?: string | null;
          hours?: number;
          hue: number;
          id?: string;
          legacy_id?: string | null;
          outcome?: string;
          start_date?: string;
          title: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          category_id?: string | null;
          created_at?: string;
          deadline?: string | null;
          hours?: number;
          hue?: number;
          id?: string;
          legacy_id?: string | null;
          outcome?: string;
          start_date?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goals_category_id_user_id_fkey";
            columns: ["category_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      google_accounts: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          refresh_token_id: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          refresh_token_id?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          refresh_token_id?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      google_calendars: {
        Row: {
          access_role: string;
          account_id: string;
          can_publish: boolean;
          channel_expires_at: string | null;
          channel_id: string | null;
          channel_resource_id: string | null;
          color: string | null;
          created_at: string;
          full_synced_at: string | null;
          google_id: string;
          id: string;
          is_primary: boolean;
          last_synced_at: string | null;
          name: string;
          shared: boolean;
          show_in_app: boolean;
          sync_token: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          access_role?: string;
          account_id: string;
          can_publish?: boolean;
          channel_expires_at?: string | null;
          channel_id?: string | null;
          channel_resource_id?: string | null;
          color?: string | null;
          created_at?: string;
          full_synced_at?: string | null;
          google_id: string;
          id?: string;
          is_primary?: boolean;
          last_synced_at?: string | null;
          name?: string;
          shared?: boolean;
          show_in_app?: boolean;
          sync_token?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          access_role?: string;
          account_id?: string;
          can_publish?: boolean;
          channel_expires_at?: string | null;
          channel_id?: string | null;
          channel_resource_id?: string | null;
          color?: string | null;
          created_at?: string;
          full_synced_at?: string | null;
          google_id?: string;
          id?: string;
          is_primary?: boolean;
          last_synced_at?: string | null;
          name?: string;
          shared?: boolean;
          show_in_app?: boolean;
          sync_token?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_calendars_account_id_user_id_fkey";
            columns: ["account_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "google_accounts";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "google_calendars_account_id_user_id_fkey";
            columns: ["account_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "google_accounts_public";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      google_oauth_states: {
        Row: {
          account_id: string | null;
          created_at: string;
          expires_at: string;
          return_url: string;
          state_hash: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          created_at?: string;
          expires_at?: string;
          return_url: string;
          state_hash: string;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          created_at?: string;
          expires_at?: string;
          return_url?: string;
          state_hash?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_oauth_states_account_id_user_id_fkey";
            columns: ["account_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "google_accounts";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "google_oauth_states_account_id_user_id_fkey";
            columns: ["account_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "google_accounts_public";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      hidden_items: {
        Row: {
          external_key: string;
          hidden_at: string;
          id: string;
          source: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          external_key: string;
          hidden_at?: string;
          id?: string;
          source: string;
          user_id?: string;
        };
        Update: {
          external_key?: string;
          hidden_at?: string;
          id?: string;
          source?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      legacy_calendar_blobs: {
        Row: {
          data: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          data?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          data?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          prefs: NonNullable<Json>;
          tz: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          prefs?: NonNullable<Json>;
          tz?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          prefs?: NonNullable<Json>;
          tz?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      series: {
        Row: {
          created_at: string;
          freq: string;
          id: string;
          legacy_id: string | null;
          start_day: string;
          until: string | null;
          updated_at: string;
          user_id: string;
          weekdays: number[];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          freq?: string;
          id?: string;
          legacy_id?: string | null;
          start_day: string;
          until?: string | null;
          updated_at?: string;
          user_id?: string;
          weekdays: number[];
        };
        Update: {
          created_at?: string;
          freq?: string;
          id?: string;
          legacy_id?: string | null;
          start_day?: string;
          until?: string | null;
          updated_at?: string;
          user_id?: string;
          weekdays?: number[];
        };
        Relationships: [];
      };
      sync_locks: {
        Row: {
          locked_until: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          locked_until: string;
          user_id: string;
        };
        Update: {
          locked_until?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      calendars: {
        Row: {
          data: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          data?: Json | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          data?: Json | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      google_accounts_public: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          email?: string | null;
          id?: string | null;
          status?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          email?: string | null;
          id?: string | null;
          status?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      ai_claim: {
        Args: { p_limit: number; p_per_minute: number; p_user_id: string };
        Returns: {
          allowed: boolean;
          reason: string;
          retry_after: number;
          usage_month: string;
          used: number;
        }[];
      };
      ai_refund: { Args: { p_user_id: string }; Returns: number };
      consume_google_oauth_state: {
        Args: { p_state_hash: string };
        Returns: {
          account_id: string;
          return_url: string;
          user_id: string;
        }[];
      };
      create_google_oauth_state: {
        Args: {
          p_account_id?: string;
          p_return_url: string;
          p_state_hash: string;
          p_ttl_seconds?: number;
          p_user_id: string;
        };
        Returns: undefined;
      };
      enqueue_import: { Args: { p_calendar_id: string }; Returns: number };
      enqueue_import_sweep: { Args: Record<PropertyKey, never>; Returns: number };
      enqueue_publish: { Args: { p_event_id: string; p_user_id: string }; Returns: number };
      get_google_refresh_token: { Args: { p_account_id: string }; Returns: string };
      invoke_google_sync: { Args: { p_body: Json }; Returns: number };
      queue_ack: { Args: { p_msg_ids: number[]; p_queue: string }; Returns: number };
      release_sync_lock: { Args: { p_user_id: string }; Returns: undefined };
      renew_watch_channels: { Args: Record<PropertyKey, never>; Returns: number };
      run_queue_consumer: {
        Args: { p_batch?: number; p_max_attempts?: number; p_vt?: number };
        Returns: number;
      };
      set_event_google_targets: {
        Args: { p_apply_to_series?: boolean; p_calendar_ids: string[]; p_event_id: string };
        Returns: undefined;
      };
      set_google_refresh_token: {
        Args: { p_account_id: string; p_token: string };
        Returns: string;
      };
      try_sync_lock: { Args: { p_lease_seconds?: number; p_user_id: string }; Returns: boolean };
      vault_secrets_configured: { Args: Record<PropertyKey, never>; Returns: boolean };
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
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
