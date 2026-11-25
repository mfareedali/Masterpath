export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      chat_usage: {
        Row: {
          client_id: string
          day: string
          output_tokens: number
        }
        Insert: {
          client_id: string
          day: string
          output_tokens?: number
        }
        Update: {
          client_id?: string
          day?: string
          output_tokens?: number
        }
        Relationships: []
      }
      conversion_rules: {
        Row: {
          evidence_snippet: string | null
          fetched_at: string | null
          formula: string
          from_scale: string
          id: string
          notes: string | null
          params: Json | null
          scope: string
          source_url: string | null
          to_scale: string
          updated_at: string
        }
        Insert: {
          evidence_snippet?: string | null
          fetched_at?: string | null
          formula: string
          from_scale: string
          id: string
          notes?: string | null
          params?: Json | null
          scope: string
          source_url?: string | null
          to_scale: string
          updated_at?: string
        }
        Update: {
          evidence_snippet?: string | null
          fetched_at?: string | null
          formula?: string
          from_scale?: string
          id?: string
          notes?: string | null
          params?: Json | null
          scope?: string
          source_url?: string | null
          to_scale?: string
          updated_at?: string
        }
        Relationships: []
      }
      country_facts: {
        Row: {
          basis: string | null
          confidence: string | null
          conflicts: Json | null
          country: string
          evidence_snippet: string | null
          fetched_at: string | null
          id: string
          key: string
          note: string | null
          review_note: string | null
          source_url: string | null
          updated_at: string
          value: Json | null
        }
        Insert: {
          basis?: string | null
          confidence?: string | null
          conflicts?: Json | null
          country: string
          evidence_snippet?: string | null
          fetched_at?: string | null
          id: string
          key: string
          note?: string | null
          review_note?: string | null
          source_url?: string | null
          updated_at?: string
          value?: Json | null
        }
        Update: {
          basis?: string | null
          confidence?: string | null
          conflicts?: Json | null
          country?: string
          evidence_snippet?: string | null
          fetched_at?: string | null
          id?: string
          key?: string
          note?: string | null
          review_note?: string | null
          source_url?: string | null
          updated_at?: string
          value?: Json | null
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          currency: string
          id: string
          pkr_per_unit: Json
          updated_at: string
        }
        Insert: {
          currency: string
          id: string
          pkr_per_unit?: Json
          updated_at?: string
        }
        Update: {
          currency?: string
          id?: string
          pkr_per_unit?: Json
          updated_at?: string
        }
        Relationships: []
      }
      institutions: {
        Row: {
          anabin_status: Json
          country: string
          hec_status: Json
          id: string
          kind: string
          name: string
          notes: string | null
          pqr_status: Json
          recognition_list_status: Json
          updated_at: string
          website: string | null
        }
        Insert: {
          anabin_status?: Json
          country: string
          hec_status?: Json
          id: string
          kind: string
          name: string
          notes?: string | null
          pqr_status?: Json
          recognition_list_status?: Json
          updated_at?: string
          website?: string | null
        }
        Update: {
          anabin_status?: Json
          country?: string
          hec_status?: Json
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          pqr_status?: Json
          recognition_list_status?: Json
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      profile_strengths: {
        Row: {
          code_data_links: Json
          collaborators: Json
          free_text: string | null
          other: Json
          publications: Json
          research: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          code_data_links?: Json
          collaborators?: Json
          free_text?: string | null
          other?: Json
          publications?: Json
          research?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          code_data_links?: Json
          collaborators?: Json
          free_text?: string | null
          other?: Json
          publications?: Json
          research?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          budget_pkr: number | null
          cgpa: number
          degree: string | null
          field: string
          min_pass: number | null
          scale: string
          target_countries: string[]
          university_id: string | null
          university_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_pkr?: number | null
          cgpa: number
          degree?: string | null
          field?: string
          min_pass?: number | null
          scale: string
          target_countries?: string[]
          university_id?: string | null
          university_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_pkr?: number | null
          cgpa?: number
          degree?: string | null
          field?: string
          min_pass?: number | null
          scale?: string
          target_countries?: string[]
          university_id?: string | null
          university_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      programs: {
        Row: {
          admissions_email: Json
          conditional_admission: Json
          country: string
          cv_requirements: Json
          deadline: Json
          degree: string
          duration_months: Json
          eligibility_note: Json
          field: string
          id: string
          institution_id: string
          intake: Json
          language_req: Json
          language_waiver: Json
          last_checked: string | null
          living_cost: Json
          lor_count: Json
          min_gpa_rule: Json
          name: string
          official_url: string | null
          pathway_type: string
          progression_guaranteed: Json
          progression_requirement: Json
          research_considered: Json
          scholarship_info: Json
          sop_requirements: Json
          status: string
          status_note: Json
          tests_required: Json
          tuition: Json
          updated_at: string
        }
        Insert: {
          admissions_email?: Json
          conditional_admission?: Json
          country: string
          cv_requirements?: Json
          deadline?: Json
          degree: string
          duration_months?: Json
          eligibility_note?: Json
          field: string
          id: string
          institution_id: string
          intake?: Json
          language_req?: Json
          language_waiver?: Json
          last_checked?: string | null
          living_cost?: Json
          lor_count?: Json
          min_gpa_rule?: Json
          name: string
          official_url?: string | null
          pathway_type?: string
          progression_guaranteed?: Json
          progression_requirement?: Json
          research_considered?: Json
          scholarship_info?: Json
          sop_requirements?: Json
          status?: string
          status_note?: Json
          tests_required?: Json
          tuition?: Json
          updated_at?: string
        }
        Update: {
          admissions_email?: Json
          conditional_admission?: Json
          country?: string
          cv_requirements?: Json
          deadline?: Json
          degree?: string
          duration_months?: Json
          eligibility_note?: Json
          field?: string
          id?: string
          institution_id?: string
          intake?: Json
          language_req?: Json
          language_waiver?: Json
          last_checked?: string | null
          living_cost?: Json
          lor_count?: Json
          min_gpa_rule?: Json
          name?: string
          official_url?: string | null
          pathway_type?: string
          progression_guaranteed?: Json
          progression_requirement?: Json
          research_considered?: Json
          scholarship_info?: Json
          sop_requirements?: Json
          status?: string
          status_note?: Json
          tests_required?: Json
          tuition?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          field: string
          id: string
          message: string
          program_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          message: string
          program_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          message?: string
          program_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "program_fact_conflicts"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "reports_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "program_facts"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "reports_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "program_facts_computed"
            referencedColumns: ["program_id"]
          },
          {
            foreignKeyName: "reports_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      country_facts_computed: {
        Row: {
          basis: string | null
          confidence: string | null
          conflicts: Json | null
          country: string | null
          evidence_snippet: string | null
          fetched_at: string | null
          id: string | null
          key: string | null
          note: string | null
          rank_value: number | null
          source_confidence: string | null
          source_url: string | null
          updated_at: string | null
          value: Json | null
          value_text: string | null
        }
        Relationships: []
      }
      program_fact_conflicts: {
        Row: {
          distinct_values: number | null
          key: string | null
          program_id: string | null
          sources: string[] | null
          value_texts: string[] | null
        }
        Relationships: []
      }
      program_facts: {
        Row: {
          basis: string | null
          evidence_snippet: string | null
          fetched_at: string | null
          in_conflict: boolean | null
          key: string | null
          note: string | null
          program_id: string | null
          rank_value: number | null
          source_index: number | null
          source_url: string | null
          value: Json | null
          value_text: string | null
        }
        Relationships: []
      }
      program_facts_computed: {
        Row: {
          basis: string | null
          confidence: string | null
          evidence_snippet: string | null
          fetched_at: string | null
          in_conflict: boolean | null
          key: string | null
          note: string | null
          program_id: string | null
          rank_value: number | null
          source_confidence: string | null
          source_index: number | null
          source_url: string | null
          value: Json | null
          value_text: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_chat_usage: {
        Args: { p_client_id: string; p_day: string; p_tokens: number }
        Returns: number
      }
      computed_confidence: {
        Args: {
          p_basis: string
          p_evidence_snippet: string
          p_fetched_at: string
          p_now?: string
          p_source_url: string
          p_value: Json
        }
        Returns: string
      }
      fact_confidence: { Args: { f: Json; p_now?: string }; Returns: string }
      fact_has_conflict: { Args: { f: Json }; Returns: boolean }
      fact_is_well_formed: { Args: { f: Json }; Returns: boolean }
      jsonb_number: { Args: { j: Json }; Returns: number }
      money_over_duration: {
        Args: { m: Json; p_months: number }
        Returns: number
      }
      money_over_duration_problem: {
        Args: { m: Json; p_label: string; p_months: number }
        Returns: string
      }
      money_per_year: { Args: { m: Json; p_months: number }; Returns: number }
      pkr_rate: {
        Args: { p_currency: string; p_now?: string }
        Returns: Record<string, unknown>
      }
      program_rank_key: {
        Args: {
          p: Database["public"]["Tables"]["programs"]["Row"]
          p_key: string
          p_now?: string
        }
        Returns: Record<string, unknown>
      }
      rank_countries: {
        Args: { p_direction?: string; p_key: string; p_now?: string }
        Returns: {
          confidence: string
          country: string
          data_missing: boolean
          evidence_snippet: string
          fetched_at: string
          missing_reason: string
          rank: number
          rank_value: number
          source_url: string
          value_text: string
        }[]
      }
      rank_programs: {
        Args: {
          p_country?: string
          p_direction?: string
          p_field?: string
          p_limit?: number
          p_now?: string
          p_offset?: number
          p_sort_key: string
        }
        Returns: {
          confidence: string
          country: string
          data_missing: boolean
          field: string
          institution_name: string
          missing_reason: string
          pathway_type: string
          program_id: string
          program_name: string
          rank: number
          sort_value: number
          total_count: number
        }[]
      }
      safe_epoch_days: { Args: { t: string }; Returns: number }
      safe_timestamptz: { Args: { t: string }; Returns: string }
      source_confidence: { Args: { p_now?: string; s: Json }; Returns: string }
      source_is_well_formed: { Args: { s: Json }; Returns: boolean }
      sources_are_well_formed: { Args: { arr: Json }; Returns: boolean }
      usd_per_unit: {
        Args: { p_currency: string; p_now?: string }
        Returns: Record<string, unknown>
      }
      weakest_confidence: { Args: { cs: string[] }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
