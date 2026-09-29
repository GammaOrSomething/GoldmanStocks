// Database types for the production schema (supabase/migrations/).
//
// Written by hand in the shape `supabase gen types typescript` produces, because generating
// needs Docker. With Docker available, `bun run db:types` regenerates this file from the local
// database; do that after any schema change and commit the result. Keep it in step with the
// migrations until then: `bun run test:rls -- --stub` checks the schema, and `tsc` checks the
// app against this file.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type AppRole = Database["public"]["Enums"]["app_role"];
type WorkerLanguage = Database["public"]["Enums"]["worker_language"];
type HealthStatus = Database["public"]["Enums"]["health_status"];
type ClientHealth = Database["public"]["Enums"]["client_health"];
type PlantKind = Database["public"]["Enums"]["plant_kind"];
type TaskKind = Database["public"]["Enums"]["task_kind"];
type TaskStatus = Database["public"]["Enums"]["task_status"];
type OfferStatus = Database["public"]["Enums"]["offer_status"];

export type Database = {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          name: string;
          timezone: string;
          plant_seq: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string;
          plant_seq?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          timezone?: string;
        };
        Relationships: [];
      };
      workers: {
        Row: {
          id: string;
          company_id: string;
          user_id: string | null;
          email: string | null;
          name: string;
          job_title: string;
          app_role: AppRole;
          language: WorkerLanguage;
          color: string;
          invited_at: string | null;
          accepted_at: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          user_id?: string | null;
          email?: string | null;
          name: string;
          job_title?: string;
          app_role?: AppRole;
          language?: WorkerLanguage;
          color?: string;
          invited_at?: string | null;
          accepted_at?: string | null;
          archived_at?: string | null;
        };
        Update: {
          user_id?: string | null;
          email?: string | null;
          name?: string;
          job_title?: string;
          app_role?: AppRole;
          language?: WorkerLanguage;
          color?: string;
          invited_at?: string | null;
          accepted_at?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          city: string;
          contact: string;
          health: ClientHealth;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          name: string;
          city?: string;
          contact?: string;
          health?: ClientHealth;
        };
        Update: {
          name?: string;
          city?: string;
          contact?: string;
          health?: ClientHealth;
        };
        Relationships: [];
      };
      client_terms: {
        Row: {
          client_id: string;
          company_id: string;
          monthly_value: number;
          contract_until: string | null;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          company_id?: string;
          monthly_value?: number;
          contract_until?: string | null;
        };
        Update: {
          monthly_value?: number;
          contract_until?: string | null;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          company_id: string;
          client_id: string;
          name: string;
          city: string;
          address: string;
          lat: number;
          lng: number;
          zones: string[];
          visits_per_month: number;
          status: HealthStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          client_id: string;
          name: string;
          city?: string;
          address?: string;
          lat: number;
          lng: number;
          zones?: string[];
          visits_per_month?: number;
          status?: HealthStatus;
        };
        Update: {
          client_id?: string;
          name?: string;
          city?: string;
          address?: string;
          lat?: number;
          lng?: number;
          zones?: string[];
          visits_per_month?: number;
          status?: HealthStatus;
        };
        Relationships: [];
      };
      project_terms: {
        Row: {
          project_id: string;
          company_id: string;
          monthly_value: number;
          contract_until: string | null;
          updated_at: string;
        };
        Insert: {
          project_id: string;
          company_id?: string;
          monthly_value?: number;
          contract_until?: string | null;
        };
        Update: {
          monthly_value?: number;
          contract_until?: string | null;
        };
        Relationships: [];
      };
      project_workers: {
        Row: {
          project_id: string;
          worker_id: string;
          company_id: string;
          is_lead: boolean;
        };
        Insert: {
          project_id: string;
          worker_id: string;
          company_id?: string;
          is_lead?: boolean;
        };
        Update: {
          is_lead?: boolean;
        };
        Relationships: [];
      };
      plants: {
        Row: {
          id: string;
          company_id: string;
          code: string;
          project_id: string;
          species: string;
          common: string;
          kind: PlantKind;
          zone: string;
          status: HealthStatus;
          last_care: string | null;
          next_care: string | null;
          next_task: string | null;
          x: number;
          y: number;
          lat: number | null;
          lng: number | null;
          photo_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          /** Set by the database; anything passed here is replaced. */
          code?: string;
          project_id: string;
          species?: string;
          common: string;
          kind: PlantKind;
          zone?: string;
          status?: HealthStatus;
          last_care?: string | null;
          next_care?: string | null;
          next_task?: string | null;
          x?: number;
          y?: number;
          lat?: number | null;
          lng?: number | null;
          photo_path?: string | null;
        };
        Update: {
          project_id?: string;
          species?: string;
          common?: string;
          kind?: PlantKind;
          zone?: string;
          status?: HealthStatus;
          last_care?: string | null;
          next_care?: string | null;
          next_task?: string | null;
          x?: number;
          y?: number;
          lat?: number | null;
          lng?: number | null;
          photo_path?: string | null;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          company_id: string;
          title: string;
          project_id: string;
          zone: string;
          plant_id: string | null;
          worker_id: string;
          day: number;
          date: string | null;
          start: number;
          duration: number;
          kind: TaskKind;
          weather_note: string | null;
          status: TaskStatus;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          title: string;
          project_id: string;
          zone?: string;
          plant_id?: string | null;
          worker_id: string;
          day: number;
          date?: string | null;
          start: number;
          duration: number;
          kind: TaskKind;
          weather_note?: string | null;
          status?: TaskStatus;
          approved_at?: string | null;
        };
        Update: {
          title?: string;
          project_id?: string;
          zone?: string;
          plant_id?: string | null;
          worker_id?: string;
          day?: number;
          date?: string | null;
          start?: number;
          duration?: number;
          kind?: TaskKind;
          weather_note?: string | null;
          status?: TaskStatus;
          approved_at?: string | null;
        };
        Relationships: [];
      };
      care_events: {
        Row: {
          id: string;
          company_id: string;
          plant_id: string;
          task_id: string | null;
          worker_id: string | null;
          date: string;
          action: string;
          done: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          plant_id: string;
          task_id?: string | null;
          worker_id?: string | null;
          date: string;
          action: string;
          done?: boolean;
        };
        Update: {
          date?: string;
          action?: string;
          done?: boolean;
        };
        Relationships: [];
      };
      task_photos: {
        Row: {
          id: string;
          company_id: string;
          task_id: string;
          storage_path: string;
          taken_at: string;
          lat: number | null;
          lng: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          task_id: string;
          storage_path: string;
          taken_at: string;
          lat?: number | null;
          lng?: number | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      offers: {
        Row: {
          id: string;
          company_id: string;
          client_id: string;
          project_id: string;
          what: string;
          value: number;
          due_date: string;
          subject: string;
          body: string;
          status: OfferStatus;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          client_id: string;
          project_id: string;
          what: string;
          value: number;
          due_date: string;
          subject: string;
          body: string;
          status?: OfferStatus;
          approved_at?: string | null;
        };
        Update: {
          what?: string;
          value?: number;
          due_date?: string;
          subject?: string;
          body?: string;
          status?: OfferStatus;
          approved_at?: string | null;
        };
        Relationships: [];
      };
      weather_cache: {
        Row: { key: string; fetched_at: string; payload: Json };
        Insert: { key: string; fetched_at?: string; payload: Json };
        Update: { fetched_at?: string; payload?: Json };
        Relationships: [];
      };
      usage_counters: {
        Row: { company_id: string; kind: string; day: string; count: number };
        Insert: {
          company_id: string;
          kind: string;
          day: string;
          count?: number;
        };
        Update: { count?: number };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_company: {
        Args: { company_name: string; full_name: string };
        Returns: string;
      };
      complete_task: {
        Args: {
          p_task_id: string;
          p_photo_path: string;
          p_taken_at: string;
          p_lat: number | null;
          p_lng: number | null;
          p_local_date: string;
        };
        Returns: Database["public"]["Tables"]["task_photos"]["Row"];
      };
      set_task_status: {
        Args: { p_task_id: string; p_status: TaskStatus };
        Returns: undefined;
      };
      update_my_profile: {
        Args: { p_language: WorkerLanguage };
        Returns: undefined;
      };
      set_project_crew: {
        Args: {
          p_project_id: string;
          p_worker_ids: string[];
          p_lead_id: string | null;
        };
        Returns: undefined;
      };
      bump_usage: {
        Args: { p_kind: "ai_plan" | "ai_outreach" | "invite" | "geocode" };
        Returns: boolean;
      };
      client_stats: {
        Args: { p_from: string; p_to: string };
        Returns: {
          client_id: string;
          sites: number;
          plants: number;
          hours: number;
        }[];
      };
      my_invitation: {
        Args: Record<PropertyKey, never>;
        Returns: { worker_id: string; company_name: string }[];
      };
      login_for_email: {
        Args: { p_email: string };
        Returns: { user_id: string; confirmed: boolean; linked: boolean }[];
      };
    };
    Enums: {
      app_role: "boss" | "worker";
      worker_language: "ET" | "LV" | "EN";
      health_status: "healthy" | "attention" | "critical";
      client_health: "good" | "watch" | "at risk";
      plant_kind: "Tree" | "Hedge" | "Lawn" | "Flower bed" | "Shrub";
      task_kind:
        | "Watering"
        | "Clipping"
        | "Mowing"
        | "Planting"
        | "Inspection"
        | "Feeding";
      task_status: "planned" | "done" | "skipped";
      offer_status: "draft" | "approved" | "dismissed";
    };
    CompositeTypes: Record<string, never>;
  };
};
