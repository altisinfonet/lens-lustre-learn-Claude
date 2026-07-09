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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      _v3_preflight_snapshot_competition_entries: {
        Row: {
          _snapshot_at: string | null
          ai_detection_result: Json | null
          certificate_ready: boolean | null
          competition_id: string | null
          created_at: string | null
          current_round: string | null
          description: string | null
          exif_data: Json | null
          id: string | null
          is_ai_advisory: boolean | null
          is_ai_generated: boolean | null
          is_pinned: boolean | null
          is_trending: boolean | null
          photo_meta: Json | null
          photo_thumbnails: string[] | null
          photos: string[] | null
          placement: string | null
          progression_decision: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          view_count: number | null
        }
        Insert: {
          _snapshot_at?: string | null
          ai_detection_result?: Json | null
          certificate_ready?: boolean | null
          competition_id?: string | null
          created_at?: string | null
          current_round?: string | null
          description?: string | null
          exif_data?: Json | null
          id?: string | null
          is_ai_advisory?: boolean | null
          is_ai_generated?: boolean | null
          is_pinned?: boolean | null
          is_trending?: boolean | null
          photo_meta?: Json | null
          photo_thumbnails?: string[] | null
          photos?: string[] | null
          placement?: string | null
          progression_decision?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          view_count?: number | null
        }
        Update: {
          _snapshot_at?: string | null
          ai_detection_result?: Json | null
          certificate_ready?: boolean | null
          competition_id?: string | null
          created_at?: string | null
          current_round?: string | null
          description?: string | null
          exif_data?: Json | null
          id?: string | null
          is_ai_advisory?: boolean | null
          is_ai_generated?: boolean | null
          is_pinned?: boolean | null
          is_trending?: boolean | null
          photo_meta?: Json | null
          photo_thumbnails?: string[] | null
          photos?: string[] | null
          placement?: string | null
          progression_decision?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          view_count?: number | null
        }
        Relationships: []
      }
      _v3_preflight_snapshot_judge_decisions: {
        Row: {
          _snapshot_at: string | null
          created_at: string | null
          decision: string | null
          entry_id: string | null
          id: string | null
          judge_id: string | null
          photo_index: number | null
          round_number: number | null
          updated_at: string | null
        }
        Insert: {
          _snapshot_at?: string | null
          created_at?: string | null
          decision?: string | null
          entry_id?: string | null
          id?: string | null
          judge_id?: string | null
          photo_index?: number | null
          round_number?: number | null
          updated_at?: string | null
        }
        Update: {
          _snapshot_at?: string | null
          created_at?: string | null
          decision?: string | null
          entry_id?: string | null
          id?: string | null
          judge_id?: string | null
          photo_index?: number | null
          round_number?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _v3_preflight_snapshot_judge_tag_assignments: {
        Row: {
          _snapshot_at: string | null
          created_at: string | null
          entry_id: string | null
          id: string | null
          judge_id: string | null
          photo_index: number | null
          round_number: number | null
          tag_id: string | null
        }
        Insert: {
          _snapshot_at?: string | null
          created_at?: string | null
          entry_id?: string | null
          id?: string | null
          judge_id?: string | null
          photo_index?: number | null
          round_number?: number | null
          tag_id?: string | null
        }
        Update: {
          _snapshot_at?: string | null
          created_at?: string | null
          entry_id?: string | null
          id?: string | null
          judge_id?: string | null
          photo_index?: number | null
          round_number?: number | null
          tag_id?: string | null
        }
        Relationships: []
      }
      _v3_preflight_snapshot_judging_tags: {
        Row: {
          _snapshot_at: string | null
          color: string | null
          created_at: string | null
          created_by: string | null
          icon: string | null
          id: string | null
          image_url: string | null
          is_active: boolean | null
          is_quality_tag: boolean | null
          is_system: boolean | null
          is_visible: boolean | null
          label: string | null
          sort_order: number | null
          visible_in_round: number[] | null
        }
        Insert: {
          _snapshot_at?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          icon?: string | null
          id?: string | null
          image_url?: string | null
          is_active?: boolean | null
          is_quality_tag?: boolean | null
          is_system?: boolean | null
          is_visible?: boolean | null
          label?: string | null
          sort_order?: number | null
          visible_in_round?: number[] | null
        }
        Update: {
          _snapshot_at?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          icon?: string | null
          id?: string | null
          image_url?: string | null
          is_active?: boolean | null
          is_quality_tag?: boolean | null
          is_system?: boolean | null
          is_visible?: boolean | null
          label?: string | null
          sort_order?: number | null
          visible_in_round?: number[] | null
        }
        Relationships: []
      }
      _v3_quarantine_decisions: {
        Row: {
          decision: string
          entry_id: string
          judge_id: string
          photo_index: number | null
          quarantine_id: string
          quarantine_phase: string
          quarantine_reason: string
          quarantined_at: string
          round_number: number
          source_created_at: string
          source_id: string
          source_updated_at: string
        }
        Insert: {
          decision: string
          entry_id: string
          judge_id: string
          photo_index?: number | null
          quarantine_id?: string
          quarantine_phase: string
          quarantine_reason: string
          quarantined_at?: string
          round_number: number
          source_created_at: string
          source_id: string
          source_updated_at: string
        }
        Update: {
          decision?: string
          entry_id?: string
          judge_id?: string
          photo_index?: number | null
          quarantine_id?: string
          quarantine_phase?: string
          quarantine_reason?: string
          quarantined_at?: string
          round_number?: number
          source_created_at?: string
          source_id?: string
          source_updated_at?: string
        }
        Relationships: []
      }
      _v3_quarantine_tag_assignments: {
        Row: {
          entry_id: string
          id: string
          judge_id: string
          original_created_at: string
          photo_index: number
          quarantine_phase: string
          quarantine_reason: string
          quarantined_at: string
          raw_payload: Json | null
          source_id: string
          tag_id: string
          tag_label_snapshot: string | null
        }
        Insert: {
          entry_id: string
          id?: string
          judge_id: string
          original_created_at: string
          photo_index: number
          quarantine_phase?: string
          quarantine_reason: string
          quarantined_at?: string
          raw_payload?: Json | null
          source_id: string
          tag_id: string
          tag_label_snapshot?: string | null
        }
        Update: {
          entry_id?: string
          id?: string
          judge_id?: string
          original_created_at?: string
          photo_index?: number
          quarantine_phase?: string
          quarantine_reason?: string
          quarantined_at?: string
          raw_payload?: Json | null
          source_id?: string
          tag_id?: string
          tag_label_snapshot?: string | null
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action_category: string
          action_type: string
          created_at: string
          description: string | null
          id: string
          ip_address: string | null
          is_archived: boolean
          metadata: Json | null
          page_path: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action_category?: string
          action_type: string
          created_at?: string
          description?: string | null
          id?: string
          ip_address?: string | null
          is_archived?: boolean
          metadata?: Json | null
          page_path?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action_category?: string
          action_type?: string
          created_at?: string
          description?: string | null
          id?: string
          ip_address?: string | null
          is_archived?: boolean
          metadata?: Json | null
          page_path?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ad_conversions: {
        Row: {
          ad_id: string
          conversion_type: string
          conversion_value: number
          created_at: string
          device: string
          id: string
          metadata: Json | null
          placement: string
          user_id: string | null
        }
        Insert: {
          ad_id: string
          conversion_type: string
          conversion_value?: number
          created_at?: string
          device?: string
          id?: string
          metadata?: Json | null
          placement: string
          user_id?: string | null
        }
        Update: {
          ad_id?: string
          conversion_type?: string
          conversion_value?: number
          created_at?: string
          device?: string
          id?: string
          metadata?: Json | null
          placement?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ad_impressions: {
        Row: {
          ad_source: string
          country: string | null
          created_at: string
          device: string
          event_type: string
          id: string
          placement: string
          revenue_estimate: number
          slot_id: string
        }
        Insert: {
          ad_source?: string
          country?: string | null
          created_at?: string
          device?: string
          event_type?: string
          id?: string
          placement: string
          revenue_estimate?: number
          slot_id: string
        }
        Update: {
          ad_source?: string
          country?: string | null
          created_at?: string
          device?: string
          event_type?: string
          id?: string
          placement?: string
          revenue_estimate?: number
          slot_id?: string
        }
        Relationships: []
      }
      admin_notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          reference_id: string | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          reference_id?: string | null
          title: string
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          reference_id?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      admin_vote_adjustments: {
        Row: {
          adjustment_value: number
          admin_id: string
          competition_id: string
          created_at: string
          entry_id: string
          id: string
          photo_index: number
          reason: string | null
        }
        Insert: {
          adjustment_value: number
          admin_id: string
          competition_id: string
          created_at?: string
          entry_id: string
          id?: string
          photo_index?: number
          reason?: string | null
        }
        Update: {
          adjustment_value?: number
          admin_id?: string
          competition_id?: string
          created_at?: string
          entry_id?: string
          id?: string
          photo_index?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_vote_adjustments_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_vote_adjustments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_vote_adjustments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "admin_vote_adjustments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      ai_chat_usage: {
        Row: {
          created_at: string
          device_id: string
          id: string
          question_count: number
          session_date: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          question_count?: number
          session_date?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          question_count?: number
          session_date?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      album_photos: {
        Row: {
          album_id: string
          caption: string | null
          created_at: string
          id: string
          image_url: string
          post_id: string | null
          sort_order: number
        }
        Insert: {
          album_id: string
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          post_id?: string | null
          sort_order?: number
        }
        Update: {
          album_id?: string
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          post_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "album_photos_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "photo_albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_photos_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      badge_definitions: {
        Row: {
          badge_class: string
          created_at: string
          icon: string
          id: string
          is_active: boolean
          label: string
          ribbon_class: string
          sort_order: number
          type_key: string
        }
        Insert: {
          badge_class?: string
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          label: string
          ribbon_class?: string
          sort_order?: number
          type_key: string
        }
        Update: {
          badge_class?: string
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          label?: string
          ribbon_class?: string
          sort_order?: number
          type_key?: string
        }
        Relationships: []
      }
      bank_details: {
        Row: {
          bank_account_name: string | null
          bank_account_number: string | null
          bank_ifsc: string | null
          bank_name: string | null
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      blocked_keywords: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          keyword: string
          severity: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          keyword: string
          severity?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          keyword?: string
          severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      certificate_testimonials: {
        Row: {
          certificate_id: string
          created_at: string
          id: string
          is_visible: boolean
          photo_url: string | null
          sort_order: number
          testimonial: string
          updated_at: string
          user_id: string
        }
        Insert: {
          certificate_id: string
          created_at?: string
          id?: string
          is_visible?: boolean
          photo_url?: string | null
          sort_order?: number
          testimonial: string
          updated_at?: string
          user_id: string
        }
        Update: {
          certificate_id?: string
          created_at?: string
          id?: string
          is_visible?: boolean
          photo_url?: string | null
          sort_order?: number
          testimonial?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificate_testimonials_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates: {
        Row: {
          certificate_id: string | null
          description: string | null
          featured_order: number
          featured_quote: string | null
          file_url: string | null
          id: string
          is_featured: boolean
          is_revoked: boolean
          issued_at: string
          reference_id: string | null
          revoked_at: string | null
          revoked_reason: string | null
          title: string
          type: string
          user_id: string
          verification_token: string | null
        }
        Insert: {
          certificate_id?: string | null
          description?: string | null
          featured_order?: number
          featured_quote?: string | null
          file_url?: string | null
          id?: string
          is_featured?: boolean
          is_revoked?: boolean
          issued_at?: string
          reference_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          title: string
          type: string
          user_id: string
          verification_token?: string | null
        }
        Update: {
          certificate_id?: string | null
          description?: string | null
          featured_order?: number
          featured_quote?: string | null
          file_url?: string | null
          id?: string
          is_featured?: boolean
          is_revoked?: boolean
          issued_at?: string
          reference_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          title?: string
          type?: string
          user_id?: string
          verification_token?: string | null
        }
        Relationships: []
      }
      chat_questions: {
        Row: {
          ai_answer: string | null
          ask_count: number
          created_at: string
          id: string
          last_asked_at: string
          promoted_to_faq: boolean
          question_fingerprint: string
          question_text: string
        }
        Insert: {
          ai_answer?: string | null
          ask_count?: number
          created_at?: string
          id?: string
          last_asked_at?: string
          promoted_to_faq?: boolean
          question_fingerprint: string
          question_text: string
        }
        Update: {
          ai_answer?: string | null
          ask_count?: number
          created_at?: string
          id?: string
          last_asked_at?: string
          promoted_to_faq?: boolean
          question_fingerprint?: string
          question_text?: string
        }
        Relationships: []
      }
      comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          reaction_type?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_reports: {
        Row: {
          admin_action: string | null
          comment_id: string | null
          created_at: string
          details: string | null
          id: string
          post_comment_id: string | null
          reason: string
          reporter_id: string
          reviewed_by: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_action?: string | null
          comment_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          post_comment_id?: string | null
          reason?: string
          reporter_id: string
          reviewed_by?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_action?: string | null
          comment_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          post_comment_id?: string | null
          reason?: string
          reporter_id?: string
          reviewed_by?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "image_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reports_post_comment_id_fkey"
            columns: ["post_comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          article_id: string | null
          content: string
          created_at: string
          entry_id: string | null
          id: string
          is_pinned: boolean
          parent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          article_id?: string | null
          content?: string
          created_at?: string
          entry_id?: string | null
          id?: string
          is_pinned?: boolean
          parent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          article_id?: string | null
          content?: string
          created_at?: string
          entry_id?: string | null
          id?: string
          is_pinned?: boolean
          parent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "journal_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_entries: {
        Row: {
          ai_detection_result: Json | null
          certificate_ready: boolean
          competition_id: string
          created_at: string
          current_round: string | null
          current_round_int: number | null
          description: string | null
          exif_data: Json | null
          id: string
          is_ai_advisory: boolean
          is_ai_generated: boolean
          is_pinned: boolean
          is_trending: boolean
          photo_meta: Json
          photo_thumbnails: string[] | null
          photos: string[]
          placement: string | null
          progression_decision: string | null
          public_placement_derived: string | null
          public_progression_note_derived: string | null
          public_r4_tags_derived: string[] | null
          public_round_derived: string | null
          public_status_derived: string | null
          stage_key: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
          view_count: number
        }
        Insert: {
          ai_detection_result?: Json | null
          certificate_ready?: boolean
          competition_id: string
          created_at?: string
          current_round?: string | null
          current_round_int?: number | null
          description?: string | null
          exif_data?: Json | null
          id?: string
          is_ai_advisory?: boolean
          is_ai_generated?: boolean
          is_pinned?: boolean
          is_trending?: boolean
          photo_meta?: Json
          photo_thumbnails?: string[] | null
          photos?: string[]
          placement?: string | null
          progression_decision?: string | null
          public_placement_derived?: string | null
          public_progression_note_derived?: string | null
          public_r4_tags_derived?: string[] | null
          public_round_derived?: string | null
          public_status_derived?: string | null
          stage_key?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          view_count?: number
        }
        Update: {
          ai_detection_result?: Json | null
          certificate_ready?: boolean
          competition_id?: string
          created_at?: string
          current_round?: string | null
          current_round_int?: number | null
          description?: string | null
          exif_data?: Json | null
          id?: string
          is_ai_advisory?: boolean
          is_ai_generated?: boolean
          is_pinned?: boolean
          is_trending?: boolean
          photo_meta?: Json
          photo_thumbnails?: string[] | null
          photos?: string[]
          placement?: string | null
          progression_decision?: string | null
          public_placement_derived?: string | null
          public_progression_note_derived?: string | null
          public_r4_tags_derived?: string[] | null
          public_round_derived?: string | null
          public_status_derived?: string | null
          stage_key?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "competition_entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entries_stage_key_fkey"
            columns: ["stage_key"]
            isOneToOne: false
            referencedRelation: "v3_stage_catalog"
            referencedColumns: ["stage_key"]
          },
        ]
      }
      competition_judges: {
        Row: {
          assigned_at: string
          assigned_by: string
          competition_id: string
          id: string
          judge_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          competition_id: string
          id?: string
          judge_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          competition_id?: string
          id?: string
          judge_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_judges_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_judging_tags: {
        Row: {
          competition_id: string
          id: string
          tag_id: string
        }
        Insert: {
          competition_id: string
          id?: string
          tag_id: string
        }
        Update: {
          competition_id?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_judging_tags_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_judging_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "judging_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_orders: {
        Row: {
          amount: number
          competition_id: string
          created_at: string
          entry_id: string | null
          id: string
          metadata: Json | null
          order_no: string
          order_type: string
          status: string
          updated_at: string
          user_id: string
          wallet_txn_id: string | null
        }
        Insert: {
          amount: number
          competition_id: string
          created_at?: string
          entry_id?: string | null
          id?: string
          metadata?: Json | null
          order_no: string
          order_type?: string
          status?: string
          updated_at?: string
          user_id: string
          wallet_txn_id?: string | null
        }
        Update: {
          amount?: number
          competition_id?: string
          created_at?: string
          entry_id?: string | null
          id?: string
          metadata?: Json | null
          order_no?: string
          order_type?: string
          status?: string
          updated_at?: string
          user_id?: string
          wallet_txn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_orders_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_orders_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_orders_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "competition_orders_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "competition_orders_wallet_txn_id_fkey"
            columns: ["wallet_txn_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_payment_details: {
        Row: {
          bank_details: string | null
          competition_id: string
          created_at: string
          id: string
          paypal_email: string | null
          updated_at: string
          upi_id: string | null
        }
        Insert: {
          bank_details?: string | null
          competition_id: string
          created_at?: string
          id?: string
          paypal_email?: string | null
          updated_at?: string
          upi_id?: string | null
        }
        Update: {
          bank_details?: string | null
          competition_id?: string
          created_at?: string
          id?: string
          paypal_email?: string | null
          updated_at?: string
          upi_id?: string | null
        }
        Relationships: []
      }
      competition_round_publish: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          competition_id: string
          created_at: string
          published_at: string | null
          published_by: string | null
          round_number: number
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          competition_id: string
          created_at?: string
          published_at?: string | null
          published_by?: string | null
          round_number: number
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          competition_id?: string
          created_at?: string
          published_at?: string | null
          published_by?: string | null
          round_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_round_publish_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_votes: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          photo_index: number
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          photo_index?: number
          user_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          photo_index?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_votes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_votes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "competition_votes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      competitions: {
        Row: {
          ai_images_allowed: boolean
          category: string
          cover_image_url: string | null
          created_at: string
          created_by: string
          current_round: string | null
          description: string | null
          ends_at: string
          entry_fee: number | null
          id: string
          judge_assignment_mode: string
          judging_completed: boolean
          max_entries_per_user: number | null
          max_photos_per_entry: number | null
          notification_sent: boolean
          phase: string
          prize_info: string | null
          slug: string | null
          starts_at: string
          status: string
          title: string
          updated_at: string
          voting_ends_at: string | null
        }
        Insert: {
          ai_images_allowed?: boolean
          category?: string
          cover_image_url?: string | null
          created_at?: string
          created_by: string
          current_round?: string | null
          description?: string | null
          ends_at: string
          entry_fee?: number | null
          id?: string
          judge_assignment_mode?: string
          judging_completed?: boolean
          max_entries_per_user?: number | null
          max_photos_per_entry?: number | null
          notification_sent?: boolean
          phase?: string
          prize_info?: string | null
          slug?: string | null
          starts_at: string
          status?: string
          title: string
          updated_at?: string
          voting_ends_at?: string | null
        }
        Update: {
          ai_images_allowed?: boolean
          category?: string
          cover_image_url?: string | null
          created_at?: string
          created_by?: string
          current_round?: string | null
          description?: string | null
          ends_at?: string
          entry_fee?: number | null
          id?: string
          judge_assignment_mode?: string
          judging_completed?: boolean
          max_entries_per_user?: number | null
          max_photos_per_entry?: number | null
          notification_sent?: boolean
          phase?: string
          prize_info?: string | null
          slug?: string | null
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
          voting_ends_at?: string | null
        }
        Relationships: []
      }
      course_enrollments: {
        Row: {
          course_id: string
          enrolled_at: string
          id: string
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_modules: {
        Row: {
          course_id: string | null
          created_at: string | null
          id: string
          sort_order: number | null
          title: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string | null
          id?: string
          sort_order?: number | null
          title: string
        }
        Update: {
          course_id?: string | null
          created_at?: string | null
          id?: string
          sort_order?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          admin_rating: number | null
          admin_rating_count: number | null
          admin_students: number | null
          author_id: string
          category: string
          cover_image_url: string | null
          created_at: string
          description: string | null
          difficulty: string
          id: string
          is_featured: boolean
          is_free: boolean
          labels: string[]
          notification_sent: boolean
          price: number | null
          published_at: string | null
          reviews_enabled: boolean | null
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          admin_rating?: number | null
          admin_rating_count?: number | null
          admin_students?: number | null
          author_id: string
          category?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          difficulty?: string
          id?: string
          is_featured?: boolean
          is_free?: boolean
          labels?: string[]
          notification_sent?: boolean
          price?: number | null
          published_at?: string | null
          reviews_enabled?: boolean | null
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          admin_rating?: number | null
          admin_rating_count?: number | null
          admin_students?: number | null
          author_id?: string
          category?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          difficulty?: string
          id?: string
          is_featured?: boolean
          is_free?: boolean
          labels?: string[]
          notification_sent?: boolean
          price?: number | null
          published_at?: string | null
          reviews_enabled?: boolean | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_url_history: {
        Row: {
          created_at: string | null
          custom_url: string
          id: string
          is_current: boolean | null
          released_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          custom_url: string
          id?: string
          is_current?: boolean | null
          released_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          custom_url?: string
          id?: string
          is_current?: boolean | null
          released_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_url_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      db_audit_logs: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          operation: string
          row_id: string | null
          table_name: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation: string
          row_id?: string | null
          table_name: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation?: string
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body_html: string
          body_text: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          subject: string
          template_key: string
          updated_at: string
          updated_by: string | null
          variables: string[]
        }
        Insert: {
          body_html?: string
          body_text?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          subject?: string
          template_key: string
          updated_at?: string
          updated_by?: string | null
          variables?: string[]
        }
        Update: {
          body_html?: string
          body_text?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          subject?: string
          template_key?: string
          updated_at?: string
          updated_by?: string | null
          variables?: string[]
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      entry_score_cache: {
        Row: {
          avg_score: number | null
          entry_id: string
          last_updated: string | null
          total_scores: number | null
        }
        Insert: {
          avg_score?: number | null
          entry_id: string
          last_updated?: string | null
          total_scores?: number | null
        }
        Update: {
          avg_score?: number | null
          entry_id?: string
          last_updated?: string | null
          total_scores?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "entry_score_cache_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_score_cache_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "entry_score_cache_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      faq_entries: {
        Row: {
          answer: string
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          question: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          question: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          question?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      featured_artists: {
        Row: {
          artist_avatar_url: string | null
          artist_bio: string | null
          artist_name: string | null
          author_profile_id: string | null
          body: string
          cover_image_url: string | null
          created_at: string
          created_by: string
          excerpt: string | null
          id: string
          is_active: boolean
          photo_gallery: string[]
          published_at: string | null
          slug: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          artist_avatar_url?: string | null
          artist_bio?: string | null
          artist_name?: string | null
          author_profile_id?: string | null
          body?: string
          cover_image_url?: string | null
          created_at?: string
          created_by: string
          excerpt?: string | null
          id?: string
          is_active?: boolean
          photo_gallery?: string[]
          published_at?: string | null
          slug: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          artist_avatar_url?: string | null
          artist_bio?: string | null
          artist_name?: string | null
          author_profile_id?: string | null
          body?: string
          cover_image_url?: string | null
          created_at?: string
          created_by?: string
          excerpt?: string | null
          id?: string
          is_active?: boolean
          photo_gallery?: string[]
          published_at?: string | null
          slug?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "featured_artists_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      featured_photos: {
        Row: {
          created_at: string
          id: string
          image_url: string
          sort_order: number
          thumbnail_url: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          sort_order?: number
          thumbnail_url?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          sort_order?: number
          thumbnail_url?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      feed_events: {
        Row: {
          author_id: string
          created_at: string
          dwell_ms: number | null
          event_type: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          dwell_ms?: number | null
          event_type: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          dwell_ms?: number | null
          event_type?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_events_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: []
      }
      friendships: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          status: string
          updated_at: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      gift_announcements: {
        Row: {
          amount: number
          created_at: string
          expires_at: string | null
          gift_credit_id: string
          id: string
          is_expired: boolean
          is_read: boolean
          reason: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          expires_at?: string | null
          gift_credit_id: string
          id?: string
          is_expired?: boolean
          is_read?: boolean
          reason: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          expires_at?: string | null
          gift_credit_id?: string
          id?: string
          is_expired?: boolean
          is_read?: boolean
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_announcements_gift_credit_id_fkey"
            columns: ["gift_credit_id"]
            isOneToOne: false
            referencedRelation: "gift_credits"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_credits: {
        Row: {
          admin_id: string
          amount: number
          auto_apply_future: boolean
          created_at: string
          expires_at: string | null
          id: string
          reason: string
          recipients_count: number
          status: string
          target_type: string
          target_value: string | null
        }
        Insert: {
          admin_id: string
          amount: number
          auto_apply_future?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          reason: string
          recipients_count?: number
          status?: string
          target_type: string
          target_value?: string | null
        }
        Update: {
          admin_id?: string
          amount?: number
          auto_apply_future?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          reason?: string
          recipients_count?: number
          status?: string
          target_type?: string
          target_value?: string | null
        }
        Relationships: []
      }
      hero_banners: {
        Row: {
          active_from: string | null
          active_until: string | null
          category: string
          created_at: string
          id: string
          image_url: string
          is_active: boolean
          sort_order: number
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          category?: string
          created_at?: string
          id?: string
          image_url: string
          is_active?: boolean
          sort_order?: number
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          category?: string
          created_at?: string
          id?: string
          image_url?: string
          is_active?: boolean
          sort_order?: number
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      highlight_items: {
        Row: {
          caption: string | null
          created_at: string
          highlight_id: string
          id: string
          image_url: string
          sort_order: number
        }
        Insert: {
          caption?: string | null
          created_at?: string
          highlight_id: string
          id?: string
          image_url: string
          sort_order?: number
        }
        Update: {
          caption?: string | null
          created_at?: string
          highlight_id?: string
          id?: string
          image_url?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "highlight_items_highlight_id_fkey"
            columns: ["highlight_id"]
            isOneToOne: false
            referencedRelation: "highlights"
            referencedColumns: ["id"]
          },
        ]
      }
      highlights: {
        Row: {
          cover_url: string | null
          created_at: string
          id: string
          sort_order: number
          title: string
          user_id: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          user_id: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      image_comments: {
        Row: {
          content: string
          created_at: string
          flag_reason: string | null
          id: string
          image_id: string
          image_type: string
          is_admin_seed: boolean
          is_flagged: boolean
          is_pinned: boolean
          parent_id: string | null
          photo_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          flag_reason?: string | null
          id?: string
          image_id: string
          image_type: string
          is_admin_seed?: boolean
          is_flagged?: boolean
          is_pinned?: boolean
          parent_id?: string | null
          photo_index?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          flag_reason?: string | null
          id?: string
          image_id?: string
          image_type?: string
          is_admin_seed?: boolean
          is_flagged?: boolean
          is_pinned?: boolean
          parent_id?: string | null
          photo_index?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "image_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      image_reactions: {
        Row: {
          created_at: string
          id: string
          image_id: string
          image_type: string
          photo_index: number
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_id: string
          image_type: string
          photo_index?: number
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_id?: string
          image_type?: string
          photo_index?: number
          reaction_type?: string
          user_id?: string
        }
        Relationships: []
      }
      journal_articles: {
        Row: {
          author_id: string
          body: string
          cover_image_url: string | null
          created_at: string
          excerpt: string | null
          id: string
          is_featured: boolean
          notification_sent: boolean
          photo_gallery: string[]
          published_at: string | null
          slug: string
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body?: string
          cover_image_url?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          is_featured?: boolean
          notification_sent?: boolean
          photo_gallery?: string[]
          published_at?: string | null
          slug: string
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          cover_image_url?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          is_featured?: boolean
          notification_sent?: boolean
          photo_gallery?: string[]
          published_at?: string | null
          slug?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      judge_activity_logs: {
        Row: {
          action_type: string
          competition_id: string | null
          created_at: string
          details: Json | null
          entry_id: string | null
          id: string
          judge_id: string
          round_number: number | null
        }
        Insert: {
          action_type: string
          competition_id?: string | null
          created_at?: string
          details?: Json | null
          entry_id?: string | null
          id?: string
          judge_id: string
          round_number?: number | null
        }
        Update: {
          action_type?: string
          competition_id?: string | null
          created_at?: string
          details?: Json | null
          entry_id?: string | null
          id?: string
          judge_id?: string
          round_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_activity_logs_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_activity_logs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_activity_logs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_activity_logs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      judge_award_tags: {
        Row: {
          created_at: string
          decision_token: string
          entry_id: string
          id: string
          judge_id: string
          photo_index: number
          round_number: number
          source_assignment_id: string | null
          stage_key: string
          tag_id: string | null
          tag_label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision_token: string
          entry_id: string
          id?: string
          judge_id: string
          photo_index: number
          round_number: number
          source_assignment_id?: string | null
          stage_key: string
          tag_id?: string | null
          tag_label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision_token?: string
          entry_id?: string
          id?: string
          judge_id?: string
          photo_index?: number
          round_number?: number
          source_assignment_id?: string | null
          stage_key?: string
          tag_id?: string | null
          tag_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "judge_award_tags_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_award_tags_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_award_tags_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_award_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "judging_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      judge_comments: {
        Row: {
          comment: string
          created_at: string
          entry_id: string
          id: string
          judge_id: string
          photo_index: number
          round_id: string | null
          updated_at: string
        }
        Insert: {
          comment: string
          created_at?: string
          entry_id: string
          id?: string
          judge_id: string
          photo_index?: number
          round_id?: string | null
          updated_at?: string
        }
        Update: {
          comment?: string
          created_at?: string
          entry_id?: string
          id?: string
          judge_id?: string
          photo_index?: number
          round_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "judge_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_comments_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "judging_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      judge_decisions: {
        Row: {
          created_at: string
          decision: string
          entry_id: string
          id: string
          judge_id: string
          photo_index: number
          round_number: number
          stage_key: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision: string
          entry_id: string
          id?: string
          judge_id: string
          photo_index?: number
          round_number: number
          stage_key?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision?: string
          entry_id?: string
          id?: string
          judge_id?: string
          photo_index?: number
          round_number?: number
          stage_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "judge_decisions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_decisions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_decisions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      judge_entry_assignments: {
        Row: {
          assigned_at: string
          competition_id: string
          entry_id: string
          id: string
          judge_id: string
        }
        Insert: {
          assigned_at?: string
          competition_id: string
          entry_id: string
          id?: string
          judge_id: string
        }
        Update: {
          assigned_at?: string
          competition_id?: string
          entry_id?: string
          id?: string
          judge_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "judge_entry_assignments_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_entry_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_entry_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_entry_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      judge_entry_locks: {
        Row: {
          entry_id: string
          expires_at: string
          id: string
          judge_id: string
          locked_at: string
          photo_index: number
        }
        Insert: {
          entry_id: string
          expires_at?: string
          id?: string
          judge_id: string
          locked_at?: string
          photo_index?: number
        }
        Update: {
          entry_id?: string
          expires_at?: string
          id?: string
          judge_id?: string
          locked_at?: string
          photo_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "judge_entry_locks_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_entry_locks_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_entry_locks_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      judge_scores: {
        Row: {
          balance_score: number | null
          color_palette_score: number | null
          composition_score: number | null
          created_at: string
          depth_score: number | null
          entry_id: string
          feedback: string | null
          form_score: number | null
          id: string
          judge_id: string
          light_score: number | null
          line_score: number | null
          photo_index: number
          round_number: number
          score: number | null
          shape_score: number | null
          space_score: number | null
          technique_score: number | null
          texture_score: number | null
          tone_score: number | null
          updated_at: string
        }
        Insert: {
          balance_score?: number | null
          color_palette_score?: number | null
          composition_score?: number | null
          created_at?: string
          depth_score?: number | null
          entry_id: string
          feedback?: string | null
          form_score?: number | null
          id?: string
          judge_id: string
          light_score?: number | null
          line_score?: number | null
          photo_index?: number
          round_number?: number
          score?: number | null
          shape_score?: number | null
          space_score?: number | null
          technique_score?: number | null
          texture_score?: number | null
          tone_score?: number | null
          updated_at?: string
        }
        Update: {
          balance_score?: number | null
          color_palette_score?: number | null
          composition_score?: number | null
          created_at?: string
          depth_score?: number | null
          entry_id?: string
          feedback?: string | null
          form_score?: number | null
          id?: string
          judge_id?: string
          light_score?: number | null
          line_score?: number | null
          photo_index?: number
          round_number?: number
          score?: number | null
          shape_score?: number | null
          space_score?: number | null
          technique_score?: number | null
          texture_score?: number | null
          tone_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "judge_scores_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_scores_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_scores_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      judge_sessions: {
        Row: {
          competition_id: string
          created_at: string
          elapsed_seconds: number | null
          heartbeat_at: string
          id: string
          judge_id: string
          last_entry_id: string | null
          last_entry_index: number | null
          last_photo_index: number
          round_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          elapsed_seconds?: number | null
          heartbeat_at?: string
          id?: string
          judge_id: string
          last_entry_id?: string | null
          last_entry_index?: number | null
          last_photo_index?: number
          round_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          elapsed_seconds?: number | null
          heartbeat_at?: string
          id?: string
          judge_id?: string
          last_entry_id?: string | null
          last_entry_index?: number | null
          last_photo_index?: number
          round_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "judge_sessions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_sessions_last_entry_id_fkey"
            columns: ["last_entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_sessions_last_entry_id_fkey"
            columns: ["last_entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_sessions_last_entry_id_fkey"
            columns: ["last_entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_sessions_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "judging_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      judge_tag_assignments: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          judge_id: string
          photo_index: number
          round_number: number
          tag_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          judge_id: string
          photo_index?: number
          round_number: number
          tag_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          judge_id?: string
          photo_index?: number
          round_number?: number
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "judging_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      judging_config: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          min_judges: number
          round_number: number
          threshold: number
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          min_judges?: number
          round_number?: number
          threshold?: number
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          min_judges?: number
          round_number?: number
          threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "judging_config_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      judging_preflight_log: {
        Row: {
          caller_id: string
          caller_role: string
          competition_id: string
          created_at: string
          db_count: number
          db_only_sample: Json
          diff_count: number
          drift_detected: boolean
          id: string
          round_number: number
          ui_count: number
          ui_only_sample: Json
        }
        Insert: {
          caller_id: string
          caller_role: string
          competition_id: string
          created_at?: string
          db_count: number
          db_only_sample?: Json
          diff_count: number
          drift_detected: boolean
          id?: string
          round_number: number
          ui_count: number
          ui_only_sample?: Json
        }
        Update: {
          caller_id?: string
          caller_role?: string
          competition_id?: string
          created_at?: string
          db_count?: number
          db_only_sample?: Json
          diff_count?: number
          drift_detected?: boolean
          id?: string
          round_number?: number
          ui_count?: number
          ui_only_sample?: Json
        }
        Relationships: []
      }
      judging_rounds: {
        Row: {
          competition_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          round_number: number
          status: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          round_number?: number
          status?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          round_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "judging_rounds_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      judging_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_quality_tag: boolean | null
          is_system: boolean
          is_visible: boolean
          label: string
          sort_order: number
          visible_in_round: number[]
        }
        Insert: {
          color?: string
          created_at?: string
          created_by: string
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_quality_tag?: boolean | null
          is_system?: boolean
          is_visible?: boolean
          label: string
          sort_order?: number
          visible_in_round: number[]
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_quality_tag?: boolean | null
          is_system?: boolean
          is_visible?: boolean
          label?: string
          sort_order?: number
          visible_in_round?: number[]
        }
        Relationships: []
      }
      lesson_progress: {
        Row: {
          completed: boolean
          completed_at: string | null
          id: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          id?: string
          lesson_id: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          id?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          content: string
          course_id: string
          created_at: string
          id: string
          image_url: string | null
          module_id: string | null
          sort_order: number
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          content?: string
          course_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          module_id?: string | null
          sort_order?: number
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          content?: string
          course_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          module_id?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscribers: {
        Row: {
          email: string
          id: string
          is_active: boolean
          source: string
          subscribed_at: string
          user_id: string | null
        }
        Insert: {
          email: string
          id?: string
          is_active?: boolean
          source?: string
          subscribed_at?: string
          user_id?: string | null
        }
        Update: {
          email?: string
          id?: string
          is_active?: boolean
          source?: string
          subscribed_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      notification_emit_log: {
        Row: {
          created_at: string
          email_message_id: string | null
          email_template: string | null
          entity_id: string
          id: string
          in_app_notification_id: string | null
          kind: string
          payload: Json
          recipient_email: string | null
          recipient_user_id: string | null
          round_number: number | null
        }
        Insert: {
          created_at?: string
          email_message_id?: string | null
          email_template?: string | null
          entity_id: string
          id?: string
          in_app_notification_id?: string | null
          kind: string
          payload?: Json
          recipient_email?: string | null
          recipient_user_id?: string | null
          round_number?: number | null
        }
        Update: {
          created_at?: string
          email_message_id?: string | null
          email_template?: string | null
          entity_id?: string
          id?: string
          in_app_notification_id?: string | null
          kind?: string
          payload?: Json
          recipient_email?: string | null
          recipient_user_id?: string | null
          round_number?: number | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_certificates: boolean
          email_comments: boolean
          email_competition_updates: boolean
          email_course_updates: boolean
          email_friend_requests: boolean
          email_gift_credits: boolean
          email_new_followers: boolean
          email_reactions: boolean
          email_reengagement: boolean
          email_weekly_digest: boolean
          id: string
          inapp_comments: boolean
          inapp_competitions: boolean
          inapp_reactions: boolean
          inapp_social: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_certificates?: boolean
          email_comments?: boolean
          email_competition_updates?: boolean
          email_course_updates?: boolean
          email_friend_requests?: boolean
          email_gift_credits?: boolean
          email_new_followers?: boolean
          email_reactions?: boolean
          email_reengagement?: boolean
          email_weekly_digest?: boolean
          id?: string
          inapp_comments?: boolean
          inapp_competitions?: boolean
          inapp_reactions?: boolean
          inapp_social?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_certificates?: boolean
          email_comments?: boolean
          email_competition_updates?: boolean
          email_course_updates?: boolean
          email_friend_requests?: boolean
          email_gift_credits?: boolean
          email_new_followers?: boolean
          email_reactions?: boolean
          email_reengagement?: boolean
          email_weekly_digest?: boolean
          id?: string
          inapp_comments?: boolean
          inapp_competitions?: boolean
          inapp_reactions?: boolean
          inapp_social?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      photo_albums: {
        Row: {
          album_type: string
          cover_url: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          album_type?: string
          cover_url?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          album_type?: string
          cover_url?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      photo_of_the_day: {
        Row: {
          active_from: string | null
          active_until: string | null
          created_at: string
          created_by: string
          description: string | null
          featured_date: string
          id: string
          image_url: string
          is_active: boolean
          photographer_id: string | null
          photographer_name: string | null
          source_entry_id: string | null
          source_type: string
          thumbnail_url: string | null
          title: string
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          featured_date?: string
          id?: string
          image_url: string
          is_active?: boolean
          photographer_id?: string | null
          photographer_name?: string | null
          source_entry_id?: string | null
          source_type?: string
          thumbnail_url?: string | null
          title: string
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          featured_date?: string
          id?: string
          image_url?: string
          is_active?: boolean
          photographer_id?: string | null
          photographer_name?: string | null
          source_entry_id?: string | null
          source_type?: string
          thumbnail_url?: string | null
          title?: string
        }
        Relationships: []
      }
      portfolio_images: {
        Row: {
          active_from: string | null
          active_until: string | null
          category: string
          created_at: string
          id: string
          image_url: string
          is_pinned: boolean
          is_trending: boolean
          is_visible: boolean
          sort_order: number
          thumbnail_url: string | null
          title: string
          uploaded_by: string
          view_count: number
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          category?: string
          created_at?: string
          id?: string
          image_url: string
          is_pinned?: boolean
          is_trending?: boolean
          is_visible?: boolean
          sort_order?: number
          thumbnail_url?: string | null
          title: string
          uploaded_by: string
          view_count?: number
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          category?: string
          created_at?: string
          id?: string
          image_url?: string
          is_pinned?: boolean
          is_trending?: boolean
          is_visible?: boolean
          sort_order?: number
          thumbnail_url?: string | null
          title?: string
          uploaded_by?: string
          view_count?: number
        }
        Relationships: []
      }
      post_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          reaction_type?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          is_pinned: boolean
          parent_id: string | null
          post_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          parent_id?: string | null
          post_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          parent_id?: string | null
          post_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          id: string
          post_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          reaction_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reports: {
        Row: {
          admin_action: string | null
          created_at: string
          details: string | null
          id: string
          post_id: string
          reason: string
          reporter_id: string
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_action?: string | null
          created_at?: string
          details?: string | null
          id?: string
          post_id: string
          reason?: string
          reporter_id: string
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_action?: string | null
          created_at?: string
          details?: string | null
          id?: string
          post_id?: string
          reason?: string
          reporter_id?: string
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_shares: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_shares_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_tags: {
        Row: {
          created_at: string
          id: string
          photo_index: number
          post_id: string
          responded_at: string | null
          status: Database["public"]["Enums"]["post_tag_status"]
          tagged_user_id: string
          tagger_id: string
          updated_at: string
          x_position: number
          y_position: number
        }
        Insert: {
          created_at?: string
          id?: string
          photo_index?: number
          post_id: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["post_tag_status"]
          tagged_user_id: string
          tagger_id: string
          updated_at?: string
          x_position: number
          y_position: number
        }
        Update: {
          created_at?: string
          id?: string
          photo_index?: number
          post_id?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["post_tag_status"]
          tagged_user_id?: string
          tagger_id?: string
          updated_at?: string
          x_position?: number
          y_position?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_tags_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          comments_count: number
          content: string
          content_hash: string | null
          created_at: string
          id: string
          image_url: string | null
          image_urls: string[]
          indexing_disabled: boolean
          likes_count: number
          privacy: string
          shares_count: number
          thumbnail_url: string | null
          thumbnail_urls: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          comments_count?: number
          content?: string
          content_hash?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          image_urls?: string[]
          indexing_disabled?: boolean
          likes_count?: number
          privacy?: string
          shares_count?: number
          thumbnail_url?: string | null
          thumbnail_urls?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          comments_count?: number
          content?: string
          content_hash?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          image_urls?: string[]
          indexing_disabled?: boolean
          likes_count?: number
          privacy?: string
          shares_count?: number
          thumbnail_url?: string | null
          thumbnail_urls?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_views: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          viewer_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          viewer_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          viewer_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          bio: string | null
          city: string | null
          country: string | null
          cover_position: number
          cover_url: string | null
          cover_video_url: string | null
          created_at: string
          current_city: string | null
          custom_url: string | null
          custom_url_changed_at: string | null
          date_of_birth: string | null
          education: string | null
          facebook_url: string | null
          full_name: string | null
          id: string
          indexing_disabled: boolean
          instagram_url: string | null
          is_banned: boolean
          is_suspended: boolean
          last_active_at: string | null
          last_reengagement_sent_at: string | null
          national_id_url: string | null
          notification_sound_enabled: boolean | null
          onboarding_completed: boolean
          onboarding_skipped_at: string | null
          phone: string | null
          photography_interests: string[] | null
          portfolio_url: string | null
          postal_code: string | null
          preferred_language: string
          privacy_settings: Json
          pronouns: string | null
          reengagement_sends_count: number
          state: string | null
          suspended_until: string | null
          suspension_reason: string | null
          twitter_url: string | null
          updated_at: string
          user_type: string | null
          website_url: string | null
          whatsapp: string | null
          workplace: string | null
          youtube_url: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          country?: string | null
          cover_position?: number
          cover_url?: string | null
          cover_video_url?: string | null
          created_at?: string
          current_city?: string | null
          custom_url?: string | null
          custom_url_changed_at?: string | null
          date_of_birth?: string | null
          education?: string | null
          facebook_url?: string | null
          full_name?: string | null
          id: string
          indexing_disabled?: boolean
          instagram_url?: string | null
          is_banned?: boolean
          is_suspended?: boolean
          last_active_at?: string | null
          last_reengagement_sent_at?: string | null
          national_id_url?: string | null
          notification_sound_enabled?: boolean | null
          onboarding_completed?: boolean
          onboarding_skipped_at?: string | null
          phone?: string | null
          photography_interests?: string[] | null
          portfolio_url?: string | null
          postal_code?: string | null
          preferred_language?: string
          privacy_settings?: Json
          pronouns?: string | null
          reengagement_sends_count?: number
          state?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          twitter_url?: string | null
          updated_at?: string
          user_type?: string | null
          website_url?: string | null
          whatsapp?: string | null
          workplace?: string | null
          youtube_url?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          country?: string | null
          cover_position?: number
          cover_url?: string | null
          cover_video_url?: string | null
          created_at?: string
          current_city?: string | null
          custom_url?: string | null
          custom_url_changed_at?: string | null
          date_of_birth?: string | null
          education?: string | null
          facebook_url?: string | null
          full_name?: string | null
          id?: string
          indexing_disabled?: boolean
          instagram_url?: string | null
          is_banned?: boolean
          is_suspended?: boolean
          last_active_at?: string | null
          last_reengagement_sent_at?: string | null
          national_id_url?: string | null
          notification_sound_enabled?: boolean | null
          onboarding_completed?: boolean
          onboarding_skipped_at?: string | null
          phone?: string | null
          photography_interests?: string[] | null
          portfolio_url?: string | null
          postal_code?: string | null
          preferred_language?: string
          privacy_settings?: Json
          pronouns?: string | null
          reengagement_sends_count?: number
          state?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          twitter_url?: string | null
          updated_at?: string
          user_type?: string | null
          website_url?: string | null
          whatsapp?: string | null
          workplace?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      profiles_public_data: {
        Row: {
          avatar_url: string | null
          bio: string | null
          cover_position: number | null
          cover_url: string | null
          cover_video_url: string | null
          created_at: string | null
          current_city: string | null
          custom_url: string | null
          education: string | null
          facebook_url: string | null
          full_name: string | null
          id: string
          instagram_url: string | null
          is_banned: boolean | null
          is_suspended: boolean | null
          last_active_at: string | null
          notification_sound_enabled: boolean | null
          photography_interests: string[] | null
          portfolio_url: string | null
          preferred_language: string | null
          pronouns: string | null
          twitter_url: string | null
          updated_at: string | null
          website_url: string | null
          workplace: string | null
          youtube_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          cover_position?: number | null
          cover_url?: string | null
          cover_video_url?: string | null
          created_at?: string | null
          current_city?: string | null
          custom_url?: string | null
          education?: string | null
          facebook_url?: string | null
          full_name?: string | null
          id: string
          instagram_url?: string | null
          is_banned?: boolean | null
          is_suspended?: boolean | null
          last_active_at?: string | null
          notification_sound_enabled?: boolean | null
          photography_interests?: string[] | null
          portfolio_url?: string | null
          preferred_language?: string | null
          pronouns?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          website_url?: string | null
          workplace?: string | null
          youtube_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          cover_position?: number | null
          cover_url?: string | null
          cover_video_url?: string | null
          created_at?: string | null
          current_city?: string | null
          custom_url?: string | null
          education?: string | null
          facebook_url?: string | null
          full_name?: string | null
          id?: string
          instagram_url?: string | null
          is_banned?: boolean | null
          is_suspended?: boolean | null
          last_active_at?: string | null
          notification_sound_enabled?: boolean | null
          photography_interests?: string[] | null
          portfolio_url?: string | null
          preferred_language?: string | null
          pronouns?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          website_url?: string | null
          workplace?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      raw_commitments: {
        Row: {
          admin_verified_at: string | null
          admin_verified_by: string | null
          committed_at: string
          competition_id: string
          entry_id: string
          id: string
          notes: string | null
          photo_index: number
          raw_delivered_at: string | null
          raw_file_url: string | null
          raw_required: boolean
          source: string
          user_id: string
        }
        Insert: {
          admin_verified_at?: string | null
          admin_verified_by?: string | null
          committed_at?: string
          competition_id: string
          entry_id: string
          id?: string
          notes?: string | null
          photo_index: number
          raw_delivered_at?: string | null
          raw_file_url?: string | null
          raw_required: boolean
          source: string
          user_id: string
        }
        Update: {
          admin_verified_at?: string | null
          admin_verified_by?: string | null
          committed_at?: string
          competition_id?: string
          entry_id?: string
          id?: string
          notes?: string | null
          photo_index?: number
          raw_delivered_at?: string | null
          raw_file_url?: string | null
          raw_required?: boolean
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_commitments_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_commitments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_commitments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "raw_commitments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referral_code_id: string
          referred_id: string
          referrer_id: string
          reward_amount: number | null
          rewarded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          referral_code_id: string
          referred_id: string
          referrer_id: string
          reward_amount?: number | null
          rewarded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          referral_code_id?: string
          referred_id?: string
          referrer_id?: string
          reward_amount?: number | null
          rewarded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referral_code_id_fkey"
            columns: ["referral_code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reporter_id: string
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          reporter_id: string
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reporter_id?: string
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      role_applications: {
        Row: {
          admin_message: string | null
          created_at: string
          experience: string | null
          id: string
          portfolio_url: string | null
          reason: string | null
          requested_role: Database["public"]["Enums"]["app_role"]
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_message?: string | null
          created_at?: string
          experience?: string | null
          id?: string
          portfolio_url?: string | null
          reason?: string | null
          requested_role: Database["public"]["Enums"]["app_role"]
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_message?: string | null
          created_at?: string
          experience?: string | null
          id?: string
          portfolio_url?: string | null
          reason?: string | null
          requested_role?: Database["public"]["Enums"]["app_role"]
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_display_config: {
        Row: {
          created_at: string
          icon: string
          id: string
          label: string
          pill_class: string
          role_key: string
          show_inline: boolean
          sort_order: number
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          label: string
          pill_class?: string
          role_key: string
          show_inline?: boolean
          sort_order?: number
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          label?: string
          pill_class?: string
          role_key?: string
          show_inline?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      round_snapshots: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          round_number: number
          snapshot_data: Json
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          round_number: number
          snapshot_data?: Json
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          round_number?: number
          snapshot_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "round_snapshots_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_boosts: {
        Row: {
          applied_amount: number
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          image_id: string
          image_type: string
          increment_per_hour: number
          reaction_type: string
          starts_at: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          applied_amount?: number
          created_at?: string
          created_by: string
          ends_at?: string | null
          id?: string
          image_id: string
          image_type: string
          increment_per_hour?: number
          reaction_type?: string
          starts_at?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          applied_amount?: number
          created_at?: string
          created_by?: string
          ends_at?: string | null
          id?: string
          image_id?: string
          image_type?: string
          increment_per_hour?: number
          reaction_type?: string
          starts_at?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_posts: {
        Row: {
          attempt_count: number
          content: string | null
          created_at: string
          id: string
          image_url: string | null
          image_urls: string[]
          last_error: string | null
          last_shift_reason: string | null
          original_scheduled_for: string
          published_post_id: string | null
          scheduled_for: string
          shifted_count: number
          status: string
          tagged_user_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          content?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          image_urls?: string[]
          last_error?: string | null
          last_shift_reason?: string | null
          original_scheduled_for: string
          published_post_id?: string | null
          scheduled_for: string
          shifted_count?: number
          status?: string
          tagged_user_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          content?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          image_urls?: string[]
          last_error?: string | null
          last_shift_reason?: string | null
          original_scheduled_for?: string
          published_post_id?: string | null
          scheduled_for?: string
          shifted_count?: number
          status?: string
          tagged_user_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      stories: {
        Row: {
          caption: string | null
          created_at: string
          expires_at: string
          id: string
          image_url: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          image_url: string
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          image_url?: string
          user_id?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          created_at: string
          id: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_flags: {
        Row: {
          created_at: string | null
          key: string
          value: boolean
        }
        Insert: {
          created_at?: string | null
          key: string
          value?: boolean
        }
        Update: {
          created_at?: string | null
          key?: string
          value?: boolean
        }
        Relationships: []
      }
      system_tag_decision_map: {
        Row: {
          created_at: string
          decision: string
          round_number: number
          tag_id: string
        }
        Insert: {
          created_at?: string
          decision: string
          round_number: number
          tag_id: string
        }
        Update: {
          created_at?: string
          decision?: string
          round_number?: number
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_tag_decision_map_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: true
            referencedRelation: "judging_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      test_agent_config: {
        Row: {
          enabled: boolean
          id: boolean
          interval_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          interval_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: boolean
          interval_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      test_agent_runs: {
        Row: {
          branch: string | null
          commit_sha: string | null
          created_at: string
          dual_emit_status: string | null
          duration_ms: number | null
          eslint_pass: boolean | null
          failures: Json | null
          github_run_url: string | null
          id: string
          nr_drift_5min: number | null
          report_url: string | null
          rpc_parity_pass: boolean | null
          run_id: string
          status: string
          trigger: string
          tsc_pass: boolean | null
          vitest_pass: boolean | null
        }
        Insert: {
          branch?: string | null
          commit_sha?: string | null
          created_at?: string
          dual_emit_status?: string | null
          duration_ms?: number | null
          eslint_pass?: boolean | null
          failures?: Json | null
          github_run_url?: string | null
          id?: string
          nr_drift_5min?: number | null
          report_url?: string | null
          rpc_parity_pass?: boolean | null
          run_id: string
          status: string
          trigger: string
          tsc_pass?: boolean | null
          vitest_pass?: boolean | null
        }
        Update: {
          branch?: string | null
          commit_sha?: string | null
          created_at?: string
          dual_emit_status?: string | null
          duration_ms?: number | null
          eslint_pass?: boolean | null
          failures?: Json | null
          github_run_url?: string | null
          id?: string
          nr_drift_5min?: number | null
          report_url?: string | null
          rpc_parity_pass?: boolean | null
          run_id?: string
          status?: string
          trigger?: string
          tsc_pass?: boolean | null
          vitest_pass?: boolean | null
        }
        Relationships: []
      }
      ticket_replies: {
        Row: {
          attachment_name: string | null
          attachment_url: string | null
          created_at: string
          id: string
          is_admin: boolean
          message: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_url?: string | null
          created_at?: string
          id?: string
          is_admin?: boolean
          message: string
          ticket_id: string
          user_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_url?: string | null
          created_at?: string
          id?: string
          is_admin?: boolean
          message?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_replies_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          assigned_at: string
          assigned_by: string
          badge_type: string
          id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          badge_type: string
          id?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          badge_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_devices: {
        Row: {
          browser: string | null
          created_at: string
          device_id: string
          device_type: string | null
          id: string
          ip_address: string | null
          is_current: boolean | null
          last_active_at: string
          os: string | null
          user_id: string
        }
        Insert: {
          browser?: string | null
          created_at?: string
          device_id: string
          device_type?: string | null
          id?: string
          ip_address?: string | null
          is_current?: boolean | null
          last_active_at?: string
          os?: string | null
          user_id: string
        }
        Update: {
          browser?: string | null
          created_at?: string
          device_id?: string
          device_type?: string | null
          id?: string
          ip_address?: string | null
          is_current?: boolean | null
          last_active_at?: string
          os?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          email_sent: boolean
          id: string
          is_read: boolean
          message: string
          reference_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          email_sent?: boolean
          id?: string
          is_read?: boolean
          message: string
          reference_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          email_sent?: boolean
          id?: string
          is_read?: boolean
          message?: string
          reference_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      v3_mirror_log: {
        Row: {
          action: string
          decision_token: string | null
          entry_id: string | null
          error_message: string | null
          id: string
          judge_id: string | null
          matched_stage: string | null
          occurred_at: string
          photo_index: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_note: string | null
          round_number: number | null
          source_tag_id: string | null
          tag_id: string | null
          tag_label: string | null
          trigger_op: string
          write_path: string | null
        }
        Insert: {
          action: string
          decision_token?: string | null
          entry_id?: string | null
          error_message?: string | null
          id?: string
          judge_id?: string | null
          matched_stage?: string | null
          occurred_at?: string
          photo_index?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_note?: string | null
          round_number?: number | null
          source_tag_id?: string | null
          tag_id?: string | null
          tag_label?: string | null
          trigger_op: string
          write_path?: string | null
        }
        Update: {
          action?: string
          decision_token?: string | null
          entry_id?: string | null
          error_message?: string | null
          id?: string
          judge_id?: string | null
          matched_stage?: string | null
          occurred_at?: string
          photo_index?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_note?: string | null
          round_number?: number | null
          source_tag_id?: string | null
          tag_id?: string | null
          tag_label?: string | null
          trigger_op?: string
          write_path?: string | null
        }
        Relationships: []
      }
      v3_stage_catalog: {
        Row: {
          advances_to_round: number | null
          blocks_from_round: number | null
          cert_eligible: boolean
          created_at: string
          decision_token: string
          description: string
          family: string
          id: string
          is_active: boolean
          round_number: number
          stage_key: string
          tag_label_canonical: string
          updated_at: string
        }
        Insert: {
          advances_to_round?: number | null
          blocks_from_round?: number | null
          cert_eligible?: boolean
          created_at?: string
          decision_token: string
          description: string
          family: string
          id?: string
          is_active?: boolean
          round_number: number
          stage_key: string
          tag_label_canonical: string
          updated_at?: string
        }
        Update: {
          advances_to_round?: number | null
          blocks_from_round?: number | null
          cert_eligible?: boolean
          created_at?: string
          decision_token?: string
          description?: string
          family?: string
          id?: string
          is_active?: boolean
          round_number?: number
          stage_key?: string
          tag_label_canonical?: string
          updated_at?: string
        }
        Relationships: []
      }
      v3_tag_label_alias: {
        Row: {
          alias_label: string
          canonical_stage_key: string
          created_at: string
          id: string
          notes: string | null
          round_number: number
          updated_at: string
        }
        Insert: {
          alias_label: string
          canonical_stage_key: string
          created_at?: string
          id?: string
          notes?: string | null
          round_number: number
          updated_at?: string
        }
        Update: {
          alias_label?: string
          canonical_stage_key?: string
          created_at?: string
          id?: string
          notes?: string | null
          round_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "v3_tag_label_alias_canonical_stage_key_fkey"
            columns: ["canonical_stage_key"]
            isOneToOne: false
            referencedRelation: "v3_stage_catalog"
            referencedColumns: ["stage_key"]
          },
        ]
      }
      vote_adjustment_cleanup_log: {
        Row: {
          adjustment_id: string
          cleaned_at: string
          competition_id: string
          entry_id: string
          id: string
          new_value: number
          original_value: number
          photo_index: number
          reason: string
        }
        Insert: {
          adjustment_id: string
          cleaned_at?: string
          competition_id: string
          entry_id: string
          id?: string
          new_value: number
          original_value: number
          photo_index: number
          reason: string
        }
        Update: {
          adjustment_id?: string
          cleaned_at?: string
          competition_id?: string
          entry_id?: string
          id?: string
          new_value?: number
          original_value?: number
          photo_index?: number
          reason?: string
        }
        Relationships: []
      }
      wallet_ledger_audit_log: {
        Row: {
          actor_user_id: string | null
          amount: number | null
          balance_after: number | null
          balance_before: number | null
          captured_at: string
          dry_run: boolean
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          op: string
          request_jwt_role: string | null
          result: string
          source_path: string | null
          target_user_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          amount?: number | null
          balance_after?: number | null
          balance_before?: number | null
          captured_at?: string
          dry_run: boolean
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          op: string
          request_jwt_role?: string | null
          result: string
          source_path?: string | null
          target_user_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          amount?: number | null
          balance_after?: number | null
          balance_before?: number | null
          captured_at?: string
          dry_run?: boolean
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          op?: string
          request_jwt_role?: string | null
          result?: string
          source_path?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      wallet_ledger_idempotency: {
        Row: {
          created_at: string
          idempotency_key: string
          op: string
          result_balance_after: number | null
          result_txn_id: string | null
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          op: string
          result_balance_after?: number | null
          result_txn_id?: string | null
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          op?: string
          result_balance_after?: number | null
          result_txn_id?: string | null
        }
        Relationships: []
      }
      wallet_ledger_shadow_log: {
        Row: {
          captured_at: string
          computed_balance_after: number | null
          computed_balance_before: number | null
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          intended_amount: number | null
          intended_user_id: string | null
          op: string
          source_path: string | null
          validation_ok: boolean | null
        }
        Insert: {
          captured_at?: string
          computed_balance_after?: number | null
          computed_balance_before?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          intended_amount?: number | null
          intended_user_id?: string | null
          op: string
          source_path?: string | null
          validation_ok?: boolean | null
        }
        Update: {
          captured_at?: string
          computed_balance_after?: number | null
          computed_balance_before?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          intended_amount?: number | null
          intended_user_id?: string | null
          op?: string
          source_path?: string | null
          validation_ok?: boolean | null
        }
        Relationships: []
      }
      wallet_ledger_v2_diff_log: {
        Row: {
          alert_fired: boolean
          amount_mismatch: number
          error_count: number
          id: string
          latest_mismatch_at: string | null
          live_wallet_transactions_total: number
          matched: number
          mismatch_count: number
          notes: string | null
          ran_at: string
          raw_report: Json | null
          reference_mismatch: number
          safe_for_shadow_wiring: boolean | null
          shadow_log_total: number
          type_mismatch: number
          unmatched_live: number
          unmatched_shadow: number
          user_mismatch: number
          wallets_checksum: string | null
          window_end: string | null
          window_interval: string
          window_start: string | null
        }
        Insert: {
          alert_fired?: boolean
          amount_mismatch?: number
          error_count?: number
          id?: string
          latest_mismatch_at?: string | null
          live_wallet_transactions_total?: number
          matched?: number
          mismatch_count?: number
          notes?: string | null
          ran_at?: string
          raw_report?: Json | null
          reference_mismatch?: number
          safe_for_shadow_wiring?: boolean | null
          shadow_log_total?: number
          type_mismatch?: number
          unmatched_live?: number
          unmatched_shadow?: number
          user_mismatch?: number
          wallets_checksum?: string | null
          window_end?: string | null
          window_interval: string
          window_start?: string | null
        }
        Update: {
          alert_fired?: boolean
          amount_mismatch?: number
          error_count?: number
          id?: string
          latest_mismatch_at?: string | null
          live_wallet_transactions_total?: number
          matched?: number
          mismatch_count?: number
          notes?: string | null
          ran_at?: string
          raw_report?: Json | null
          reference_mismatch?: number
          safe_for_shadow_wiring?: boolean | null
          shadow_log_total?: number
          type_mismatch?: number
          unmatched_live?: number
          unmatched_shadow?: number
          user_mismatch?: number
          wallets_checksum?: string | null
          window_end?: string | null
          window_interval?: string
          window_start?: string | null
        }
        Relationships: []
      }
      wallet_ledger_v2_rows: {
        Row: {
          actor_user_id: string | null
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          description: string | null
          id: string
          idempotency_key: string
          jwt_role: string | null
          op: string
          reference_id: string | null
          source_path: string | null
          user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key: string
          jwt_role?: string | null
          op: string
          reference_id?: string | null
          source_path?: string | null
          user_id: string
        }
        Update: {
          actor_user_id?: string | null
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key?: string
          jwt_role?: string | null
          op?: string
          reference_id?: string | null
          source_path?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wallet_reconciliation_log: {
        Row: {
          amount: number | null
          created_at: string
          finding_type: string
          id: string
          metadata: Json
          notes: string | null
          reconciled_by: string | null
          reference_id: string | null
          reference_type: string | null
          transaction_id: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          finding_type: string
          id?: string
          metadata?: Json
          notes?: string | null
          reconciled_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          finding_type?: string
          id?: string
          metadata?: Json
          notes?: string | null
          reconciled_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          reference_id: string | null
          reference_type: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          reference_id?: string | null
          reference_type?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          reference_id?: string | null
          reference_type?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          currency: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      withdrawal_requests: {
        Row: {
          admin_note: string | null
          amount: number
          bank_details: Json | null
          created_at: string
          id: string
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          bank_details?: Json | null
          created_at?: string
          id?: string
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          bank_details?: Json | null
          created_at?: string
          id?: string
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      entry_final_votes: {
        Row: {
          adjustment_total: number | null
          entry_id: string | null
          final_votes: number | null
          photo_index: number | null
          real_votes: number | null
        }
        Relationships: []
      }
      entry_final_votes_legacy: {
        Row: {
          adjustment_total: number | null
          entry_id: string | null
          final_votes: number | null
          real_votes: number | null
        }
        Relationships: []
      }
      entry_public_status: {
        Row: {
          competition_id: string | null
          entry_id: string | null
          public_placement: string | null
          public_progression_note: string | null
          public_r4_tags: string[] | null
          public_round: string | null
          public_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_vote_counts: {
        Row: {
          adjustment_votes: number | null
          entry_id: string | null
          final_votes: number | null
          real_votes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_votes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_votes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "competition_votes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      judge_comments_owner_safe: {
        Row: {
          comment: string | null
          created_at: string | null
          entry_id: string | null
          id: string | null
          photo_index: number | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          entry_id?: string | null
          id?: string | null
          photo_index?: number | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          entry_id?: string | null
          id?: string | null
          photo_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      judge_decisions_owner_safe: {
        Row: {
          decision: string | null
          entry_id: string | null
          photo_index: number | null
          round_number: number | null
        }
        Insert: {
          decision?: string | null
          entry_id?: string | null
          photo_index?: number | null
          round_number?: number | null
        }
        Update: {
          decision?: string | null
          entry_id?: string | null
          photo_index?: number | null
          round_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_decisions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_decisions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_decisions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      judge_tag_assignments_owner_safe: {
        Row: {
          created_at: string | null
          entry_id: string | null
          id: string | null
          photo_index: number | null
          round_number: number | null
          tag_id: string | null
        }
        Insert: {
          created_at?: string | null
          entry_id?: string | null
          id?: string | null
          photo_index?: number | null
          round_number?: number | null
          tag_id?: string | null
        }
        Update: {
          created_at?: string | null
          entry_id?: string | null
          id?: string | null
          photo_index?: number | null
          round_number?: number | null
          tag_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "judging_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      judge_tag_assignments_public_r4: {
        Row: {
          created_at: string | null
          entry_id: string | null
          id: string | null
          photo_index: number | null
          round_number: number | null
          tag_id: string | null
        }
        Insert: {
          created_at?: string | null
          entry_id?: string | null
          id?: string | null
          photo_index?: number | null
          round_number?: number | null
          tag_id?: string | null
        }
        Update: {
          created_at?: string | null
          entry_id?: string | null
          id?: string | null
          photo_index?: number | null
          round_number?: number | null
          tag_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "competition_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entry_public_status"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "judging_progression_audit"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "judge_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "judging_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      judging_progression_audit: {
        Row: {
          competition_id: string | null
          entry_id: string | null
          expected_decision: string | null
          has_drift: boolean | null
          status: string | null
          stored_decision: string | null
          title: string | null
          total_decisions: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_public: {
        Row: {
          avatar_url: string | null
          bio: string | null
          cover_position: number | null
          cover_url: string | null
          cover_video_url: string | null
          created_at: string | null
          current_city: string | null
          custom_url: string | null
          education: string | null
          facebook_url: string | null
          full_name: string | null
          id: string | null
          instagram_url: string | null
          is_suspended: boolean | null
          photography_interests: string[] | null
          portfolio_url: string | null
          preferred_language: string | null
          pronouns: string | null
          twitter_url: string | null
          updated_at: string | null
          website_url: string | null
          workplace: string | null
          youtube_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          cover_position?: number | null
          cover_url?: string | null
          cover_video_url?: string | null
          created_at?: string | null
          current_city?: string | null
          custom_url?: string | null
          education?: string | null
          facebook_url?: string | null
          full_name?: string | null
          id?: string | null
          instagram_url?: string | null
          is_suspended?: boolean | null
          photography_interests?: string[] | null
          portfolio_url?: string | null
          preferred_language?: string | null
          pronouns?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          website_url?: string | null
          workplace?: string | null
          youtube_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          cover_position?: number | null
          cover_url?: string | null
          cover_video_url?: string | null
          created_at?: string | null
          current_city?: string | null
          custom_url?: string | null
          education?: string | null
          facebook_url?: string | null
          full_name?: string | null
          id?: string | null
          instagram_url?: string | null
          is_suspended?: boolean | null
          photography_interests?: string[] | null
          portfolio_url?: string | null
          preferred_language?: string | null
          pronouns?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          website_url?: string | null
          workplace?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      v_judging_drift: {
        Row: {
          actual_value: string | null
          detail_label: string | null
          entry_id: string | null
          expected_value: string | null
          finding_code: string | null
          judge_id: string | null
          occurred_at: string | null
          photo_index: number | null
          round_number: number | null
          source_row_id: string | null
          source_table: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _gen_competition_order_no: { Args: never; Returns: string }
      _notification_template_for_entry: {
        Args: { _placement: string; _status: string }
        Returns: {
          email_template: string
          in_app_message: string
          in_app_title: string
          in_app_type: string
          kind: string
        }[]
      }
      _resolve_stage_key_from_entry: {
        Args: {
          _current_round: string
          _progression_decision: string
          _status: string
        }
        Returns: string
      }
      acquire_judge_lock: {
        Args: {
          _entry_id: string
          _judge_id: string
          _photo_index: number
          _ttl_minutes?: number
        }
        Returns: Json
      }
      admin_flag_entry_for_review: {
        Args: { _entry_id: string }
        Returns: undefined
      }
      admin_reject_wallet_transaction: {
        Args: { _admin_id: string; _reason?: string; _txn_id: string }
        Returns: Json
      }
      admin_rewind_stage: {
        Args: { _entry_id: string; _reason: string; _to_stage_key: string }
        Returns: undefined
      }
      admin_search_users: {
        Args: { search_by?: string; search_query?: string }
        Returns: {
          avatar_url: string
          bio: string
          created_at: string
          email: string
          full_name: string
          id: string
          is_suspended: boolean
          suspended_until: string
          suspension_reason: string
        }[]
      }
      admin_set_photo_rejected: {
        Args: {
          _entry_id: string
          _photo_index: number
          _reason?: string
          _rejected: boolean
        }
        Returns: Json
      }
      admin_wallet_credit: {
        Args: {
          _admin_id: string
          _amount: number
          _description?: string
          _metadata?: Json
          _reference_id?: string
          _reference_type?: string
          _target_user_id: string
          _type: string
        }
        Returns: string
      }
      any_photo_pending:
        | { Args: { p_entry_id: string }; Returns: boolean }
        | {
            Args: { p_entry_id: string; p_round_number: number }
            Returns: boolean
          }
      apply_decision_to_remaining: {
        Args: {
          _competition_id: string
          _decision: string
          _round_number: number
        }
        Returns: {
          inserted_count: number
          skipped_existing: number
          total_targeted: number
        }[]
      }
      approve_deposit: {
        Args: { _admin_id: string; _txn_id: string }
        Returns: Json
      }
      are_friends: {
        Args: { _user_a: string; _user_b: string }
        Returns: boolean
      }
      audit_phase_parity: {
        Args: { sample_limit?: number }
        Returns: {
          db_phase: string
          ends_at: string
          id: string
          judging_completed: boolean
          legacy_phase: string
          starts_at: string
          status: string
          voting_ends_at: string
        }[]
      }
      backfill_judging_notifications: {
        Args: { _dry_run?: boolean; _window_days?: number }
        Returns: {
          emitted: number
          scanned: number
          would_emit: number
        }[]
      }
      backfill_tag_decision_drift_admin: {
        Args: never
        Returns: {
          inserted_count: number
          sample: Json
          scanned_count: number
        }[]
      }
      can_view_post: {
        Args: { _post_user_id: string; _privacy: string; _viewer_id: string }
        Returns: boolean
      }
      change_custom_url: { Args: { _new_url: string }; Returns: Json }
      check_custom_urls_taken: {
        Args: { _urls: string[] }
        Returns: {
          custom_url: string
        }[]
      }
      classify_judging_tag: {
        Args: { p_label: string; p_visible_in_round: number[] }
        Returns: {
          advances_to: number
          blocks_from: number
          family: string
          verification_round: number
        }[]
      }
      clear_custom_url: { Args: never; Returns: undefined }
      compute_entry_rank_score: { Args: { _entry_id: string }; Returns: number }
      create_pending_deposit: {
        Args: {
          _amount: number
          _gateway: string
          _idempotency_key?: string
          _metadata?: Json
          _reference: string
          _user_id: string
        }
        Returns: string
      }
      current_phase: { Args: { p_competition_id: string }; Returns: string }
      current_phase_for: {
        Args: {
          p_ends_at: string
          p_judging_completed: boolean
          p_legacy_phase: string
          p_starts_at: string
          p_status: string
          p_voting_ends_at: string
        }
        Returns: string
      }
      current_round_int: { Args: { _text: string }; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      derive_decision_from_score: {
        Args: { _avg: number; _round_number: number }
        Returns: string
      }
      derive_status_from_stage_key: {
        Args: { _stage_key: string }
        Returns: string
      }
      emit_notification: {
        Args: {
          _action_url?: string
          _email_data?: Json
          _email_template: string
          _entity_id: string
          _in_app_message: string
          _in_app_reference_id: string
          _in_app_title: string
          _in_app_type: string
          _kind: string
          _recipient_user_id: string
          _round_number: number
        }
        Returns: string
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enroll_in_course: {
        Args: { _course_id: string; _user_id: string }
        Returns: Json
      }
      extract_photo_hashes: {
        Args: { _meta: Json }
        Returns: {
          phash: string
          photo_index: number
          sha256: string
        }[]
      }
      fix_certificate_readiness_admin: {
        Args: { _entry_id: string }
        Returns: Json
      }
      fix_gift_drift_admin: {
        Args: { _announcement_id: string }
        Returns: Json
      }
      fix_referral_drift_admin: {
        Args: { _referral_id: string }
        Returns: Json
      }
      friend_count: { Args: { _user_id: string }; Returns: number }
      get_ad_analytics: { Args: { _since: string }; Returns: Json }
      get_ad_autoscale_stats: { Args: { _since: string }; Returns: Json }
      get_certificate_drift_admin: {
        Args: { p_competition_id?: string }
        Returns: {
          cert_title: string
          cert_type: string
          cert_user_id: string
          certificate_id: string
          competition_id: string
          drift_type: string
          entry_certificate_ready: boolean
          entry_id: string
          entry_placement: string
          entry_status: string
          entry_user_id: string
          issued_at: string
          reason: string
          reference_id: string
          severity: string
        }[]
      }
      get_certificate_readiness_drift_admin: {
        Args: { _competition_id?: string }
        Returns: {
          certificate_ready: boolean
          competition_id: string
          competition_phase: string
          competition_title: string
          entry_id: string
          reason: string
          status: string
        }[]
      }
      get_competition_duplicate_clusters: {
        Args: { _competition_id: string }
        Returns: {
          cluster_key: string
          created_at: string
          entry_id: string
          entry_title: string
          hamming_distance: number
          match_type: string
          matched_against_entry: string
          matched_against_photo: number
          photo_index: number
          photo_url: string
          thumbnail_url: string
          user_id: string
        }[]
      }
      get_competition_raw_commitments: {
        Args: { _competition_id: string }
        Returns: {
          admin_verified_at: string
          admin_verified_by: string
          committed_at: string
          entry_id: string
          entry_title: string
          exif_available: boolean
          photo_index: number
          photo_title: string
          photo_url: string
          raw_delivered_at: string
          raw_file_url: string
          raw_required: boolean
          source: string
          thumbnail_url: string
          user_id: string
        }[]
      }
      get_derived_status_drift_admin: {
        Args: never
        Returns: {
          cached_value: string
          canonical_value: string
          competition_id: string
          current_round: string
          entry_id: string
          placement: string
          stage_key: string
          status: string
        }[]
      }
      get_entries_private_meta: {
        Args: { _entry_ids: string[] }
        Returns: {
          ai_detection_result: Json
          entry_id: string
          exif_data: Json
        }[]
      }
      get_entry_status_drift_admin: {
        Args: never
        Returns: {
          competition_id: string
          current_round: string
          derived_placement: string
          derived_status: string
          drift_kind: string
          entry_id: string
          progression_decision: string
          stored_placement: string
          stored_status: string
        }[]
      }
      get_entry_status_drift_summary_admin: {
        Args: never
        Returns: {
          bucket: string
          count: number
        }[]
      }
      get_entry_vote_counts: {
        Args: { _entry_ids: string[] }
        Returns: {
          adjustment_votes: number
          entry_id: string
          final_votes: number
          real_votes: number
        }[]
      }
      get_feed_candidates: {
        Args: {
          _network_ids: string[]
          _network_limit?: number
          _popular_limit?: number
          _recent_limit?: number
        }
        Returns: {
          comments_count: number
          content: string
          created_at: string
          id: string
          image_url: string
          image_urls: string[]
          likes_count: number
          privacy: string
          shares_count: number
          source_type: string
          user_id: string
        }[]
      }
      get_flag: { Args: { flag_key: string }; Returns: boolean }
      get_gated_entry_status: {
        Args: { p_entry_ids: string[] }
        Returns: {
          competition_id: string
          entry_id: string
          has_pending_verification: boolean
          is_published_any_round: boolean
          public_placement: string
          public_progression_note: string
          public_r4_tags: string[]
          public_round: string
          public_status: string
          verification_overrides_status: boolean
        }[]
      }
      get_gated_status_runtime_drift_admin: {
        Args: { p_entry_ids?: string[] }
        Returns: {
          cache_value: string
          entry_id: string
          field: string
          view_value: string
        }[]
      }
      get_gift_drift_admin: {
        Args: never
        Returns: {
          actual_amount: number
          announcement_id: string
          created_at: string
          drift_type: string
          expected_amount: number
          gift_credit_id: string
          is_expired: boolean
          notes: string
          user_id: string
        }[]
      }
      get_judge_collusion_admin: {
        Args: {
          p_competition_id?: string
          p_min_correlation?: number
          p_min_overlap?: number
        }
        Returns: {
          competition_id: string
          judge_a: string
          judge_b: string
          mean_diff: number
          pearson_r: number
          severity: string
          shared_entries: number
        }[]
      }
      get_judge_entries_page: {
        Args: {
          _competition_id: string
          _cursor_created_at?: string
          _cursor_id?: string
          _limit?: number
          _round_number: number
        }
        Returns: {
          ai_detection_result: Json
          competition_id: string
          created_at: string
          current_round: string
          description: string
          exif_data: Json
          has_more: boolean
          id: string
          is_ai_generated: boolean
          next_cursor_created_at: string
          next_cursor_id: string
          photo_thumbnails: string[]
          photos: string[]
          placement: string
          status: string
          title: string
          user_id: string
          view_count: number
        }[]
      }
      get_judge_entries_page_filtered: {
        Args: {
          _bucket?: string
          _competition_id: string
          _cursor_created_at?: string
          _cursor_id?: string
          _limit?: number
          _round_number: number
        }
        Returns: {
          ai_detection_result: Json
          bucket: string
          competition_id: string
          created_at: string
          current_round: string
          description: string
          exif_data: Json
          has_more: boolean
          id: string
          is_ai_generated: boolean
          matching_photo_indexes: number[]
          next_cursor_created_at: string
          next_cursor_id: string
          photo_thumbnails: string[]
          photos: string[]
          placement: string
          status: string
          title: string
          user_id: string
          view_count: number
        }[]
      }
      get_judge_entries_page_v1: {
        Args: {
          _competition_id: string
          _cursor_created_at?: string
          _cursor_id?: string
          _limit?: number
          _round_number: number
        }
        Returns: {
          ai_detection_result: Json
          competition_id: string
          created_at: string
          current_round: string
          description: string
          exif_data: Json
          has_more: boolean
          id: string
          is_ai_generated: boolean
          next_cursor_created_at: string
          next_cursor_id: string
          photo_thumbnails: string[]
          photos: string[]
          placement: string
          status: string
          title: string
          user_id: string
          view_count: number
        }[]
      }
      get_judging_drift_admin: {
        Args: never
        Returns: {
          actual_value: string
          detail_label: string
          entry_id: string
          expected_value: string
          finding_code: string
          judge_id: string
          occurred_at: string
          photo_index: number
          round_number: number
          source_row_id: string
          source_table: string
        }[]
      }
      get_judging_live_tag_progression_invariant_admin: {
        Args: never
        Returns: {
          check_name: string
          proof: string
          status: string
        }[]
      }
      get_judging_tag_assignment_counts: {
        Args: never
        Returns: {
          assignment_count: number
          tag_id: string
        }[]
      }
      get_needs_review_recipients_for_round: {
        Args: { p_competition_id: string; p_round_number: number }
        Returns: {
          competition_title: string
          entry_id: string
          photo_indices: number[]
          user_id: string
        }[]
      }
      get_notification_drift_admin: {
        Args: { _window_days?: number }
        Returns: {
          expected_template: string
          missing_emit: number
          total_entries: number
        }[]
      }
      get_notification_email_enabled: {
        Args: { _notif_type: string; _user_id: string }
        Returns: boolean
      }
      get_notification_health_stats_admin: {
        Args: never
        Returns: {
          distinct_templates: number
          dlq_count: number
          emits_today: number
          emits_total: number
          failures_today: number
        }[]
      }
      get_per_photo_consensus: {
        Args: { p_entry_ids: string[] }
        Returns: {
          decision: string
          entry_id: string
          has_consensus: boolean
          judges_decided: number
          photo_index: number
          ratio: number
          round_number: number
          status: string
          threshold: number
          total_judges: number
        }[]
      }
      get_per_photo_placement: {
        Args: { p_entry_ids: string[] }
        Returns: {
          award_label: string
          declared: boolean
          entry_id: string
          photo_index: number
          round_number: number
          status: string
        }[]
      }
      get_photo_r4_awards: {
        Args: { p_entry_ids: string[] }
        Returns: {
          all_stage_keys: string[]
          entry_id: string
          photo_index: number
          stage_key: string
        }[]
      }
      get_placement_drift_admin: {
        Args: { _competition_id?: string }
        Returns: {
          actual_award_rank: number
          competition_id: string
          competition_title: string
          drift_reason: string
          entry_id: string
          expected_rank: number
          placement: string
          rank_score: number
          status: string
        }[]
      }
      get_primary_admin_user_id: { Args: never; Returns: string }
      get_profile_admin: {
        Args: { _id: string }
        Returns: {
          avatar_url: string
          bio: string
          email: string
          full_name: string
          id: string
        }[]
      }
      get_progression_drift_admin: {
        Args: never
        Returns: {
          competition_id: string
          entry_id: string
          expected_decision: string
          has_drift: boolean
          status: string
          stored_decision: string
          title: string
          total_decisions: number
          updated_at: string
        }[]
      }
      get_public_role_user_ids: { Args: { _role: string }; Returns: string[] }
      get_public_roles_for_users: {
        Args: { _user_ids: string[] }
        Returns: {
          role: string
          user_id: string
        }[]
      }
      get_public_round_scores: {
        Args: { p_competition_id: string; p_round_number: number }
        Returns: {
          anonymized_judge_label: string
          average_score: number
          balance_score: number
          color_palette_score: number
          depth_score: number
          entry_id: string
          form_score: number
          light_score: number
          line_score: number
          photo_index: number
          shape_score: number
          space_score: number
          texture_score: number
          tone_score: number
        }[]
      }
      get_referral_drift_admin: {
        Args: never
        Returns: {
          actual_amount: number
          drift_type: string
          expected_amount: number
          notes: string
          referral_id: string
          referred_id: string
          referrer_id: string
          rewarded_at: string
        }[]
      }
      get_result_visibility_invariant_admin: {
        Args: never
        Returns: {
          check_key: string
          evidence: Json
          status: string
        }[]
      }
      get_round_eligible_photos: {
        Args: { _competition_id: string; _round_number: number }
        Returns: {
          entry_id: string
          photo_index: number
        }[]
      }
      get_round_judging_gate_admin: {
        Args: { _competition_id: string; _round_number: number }
        Returns: {
          assigned_judges: number
          competition_id: string
          entry_id: string
          entry_status: string
          entry_title: string
          expected_decisions: number
          expected_scores: number
          missing_decision_sample: Json
          missing_decisions: number
          missing_score_sample: Json
          missing_scores: number
          present_decisions: number
          ready_to_lock: boolean
          round_number: number
          total_photos: number
          ui_eligible_photo_indices: number[]
          ui_eligible_photos: number
          verification_pending: boolean
        }[]
      }
      get_round_judging_gate_self: {
        Args: { _competition_id: string; _round_number: number }
        Returns: {
          competition_id: string
          entry_id: string
          entry_title: string
          my_decisions_missing: number
          my_decisions_present: number
          my_scores_missing: number
          ready_to_complete: boolean
          round_number: number
          total_photos: number
          ui_eligible_photo_indices: number[]
          ui_eligible_photos: number
        }[]
      }
      get_round_pending_entries: {
        Args: { p_competition_id: string; p_round: number }
        Returns: {
          entry_id: string
        }[]
      }
      get_round_summary: {
        Args: { p_competition_id: string; p_round_number: number }
        Returns: Json
      }
      get_status_stage_key_drift_admin: {
        Args: never
        Returns: {
          derived: string
          entry_id: string
          stage_key: string
          status: string
        }[]
      }
      get_system_tag_catalog_drift: {
        Args: never
        Returns: {
          label_or_canonical: string
          round_number: number
          side: string
          stage_key: string
          tag_id: string
        }[]
      }
      get_test_agent_health_admin: {
        Args: never
        Returns: {
          checked_at: string
          dual_emit_status: string
          nr_drift_24h: number
          nr_drift_5min: number
          rpc_parity_mismatch_count: number
          rpc_parity_pass: boolean
          rpc_parity_sample_size: number
          super_admin_email: string
        }[]
      }
      get_top_contributors_v1: {
        Args: never
        Returns: {
          comments_received: number
          likes_received: number
          posts_count: number
          score: number
          user_id: string
        }[]
      }
      get_unjudged_parity_admin: {
        Args: {
          p_competition_id: string
          p_judge_id: string
          p_round_number: number
        }
        Returns: {
          competition_id: string
          drift: number
          drift_photos: Json
          eligible_count: number
          grid_unjudged: number
          judge_id: string
          round_number: number
          sidebar_unjudged: number
          tagged_count: number
        }[]
      }
      has_role:
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
        | { Args: { _role: string; _user_id: string }; Returns: boolean }
      heartbeat_judge_lock: {
        Args: {
          _entry_id: string
          _judge_id: string
          _photo_index: number
          _ttl_minutes?: number
        }
        Returns: boolean
      }
      hex_hamming_distance: {
        Args: { _a: string; _b: string }
        Returns: number
      }
      is_banned: { Args: { _user_id: string }; Returns: boolean }
      is_engagement_phase_locked: {
        Args: { _image_id: string; _image_type: string }
        Returns: boolean
      }
      is_entry_owner: {
        Args: { _entry_id: string; _user_id: string }
        Returns: boolean
      }
      is_qualifying_decision: {
        Args: { _decision: string; _from_round: number }
        Returns: boolean
      }
      is_s3_storage_enabled: { Args: never; Returns: boolean }
      is_vote_phase_locked: { Args: { _entry_id: string }; Returns: boolean }
      judge_can_access_entry: {
        Args: { _entry_id: string; _judge_id: string }
        Returns: boolean
      }
      judge_round_open_by_id: { Args: { _round_id: string }; Returns: boolean }
      judge_round_open_by_number: {
        Args: { _entry_id: string; _round_number: number }
        Returns: boolean
      }
      judging_invariants_check: {
        Args: never
        Returns: {
          check_name: string
          fail_count: number
          sample: Json
          status: string
        }[]
      }
      judging_write_decision_atomic: {
        Args: {
          p_current_round: string
          p_entry_id: string
          p_stage_key: string
        }
        Returns: Json
      }
      list_tag_decision_drift_admin: {
        Args: never
        Returns: {
          competition_id: string
          competition_title: string
          decision: string
          entry_id: string
          entry_title: string
          judge_handle: string
          judge_id: string
          photo_index: number
          round_number: number
          tag_id: string
          tag_label: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      mutual_friend_ids: {
        Args: { _limit?: number; _user_a: string; _user_b: string }
        Returns: {
          friend_id: string
        }[]
      }
      mutual_friends_count: {
        Args: { _user_a: string; _user_b: string }
        Returns: number
      }
      owns_album: {
        Args: { _album_id: string; _user_id: string }
        Returns: boolean
      }
      process_referral_reward:
        | {
            Args: { _activity_type: string; _referred_user_id: string }
            Returns: undefined
          }
        | {
            Args: {
              _activity_type: string
              _referred_user_id: string
              _txn_amount?: number
            }
            Returns: undefined
          }
      progression_order: { Args: { _stage_key: string }; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recompute_entry_from_tag_assignments: {
        Args: { p_entry_id: string }
        Returns: undefined
      }
      recompute_entry_public_status: {
        Args: { p_entry_id: string }
        Returns: undefined
      }
      record_test_agent_run: {
        Args: {
          p_branch: string
          p_commit_sha: string
          p_dual_emit_status: string
          p_duration_ms: number
          p_eslint_pass: boolean
          p_failures: Json
          p_github_run_url: string
          p_nr_drift_5min: number
          p_rpc_parity_pass: boolean
          p_run_id: string
          p_status: string
          p_token: string
          p_trigger: string
          p_tsc_pass: boolean
          p_vitest_pass: boolean
        }
        Returns: string
      }
      release_judge_lock: {
        Args: { _entry_id: string; _judge_id: string; _photo_index: number }
        Returns: boolean
      }
      request_withdrawal: {
        Args: { _amount: number; _bank_details: Json }
        Returns: string
      }
      resolve_custom_url: {
        Args: { _url: string }
        Returns: {
          is_current: boolean
          released_at: string
          user_id: string
        }[]
      }
      search_certificates: {
        Args: { _course_title: string; _issued_date: string; _name: string }
        Returns: {
          certificate_id: string
          description: string
          id: string
          is_revoked: boolean
          issued_at: string
          recipient_name: string
          revoked_at: string
          revoked_reason: string
          title: string
          type: string
          verification_token: string
        }[]
      }
      search_profiles_admin: {
        Args: { q: string }
        Returns: {
          avatar_url: string
          email: string
          full_name: string
          id: string
        }[]
      }
      set_write_path: { Args: { p: string }; Returns: undefined }
      should_test_agent_run: { Args: { p_trigger?: string }; Returns: Json }
      soft_void_wallet_transactions: {
        Args: { p_batch_id?: string; p_reason: string; p_txn_ids: string[] }
        Returns: Json
      }
      submit_competition_entry: {
        Args: {
          _competition_id: string
          _description: string
          _exif_data: Json
          _is_ai_generated: boolean
          _photo_meta: Json
          _photo_thumbnails: string[]
          _photos: string[]
          _title: string
        }
        Returns: Json
      }
      verify_certificate: {
        Args: { _cert_id: string }
        Returns: {
          certificate_id: string
          description: string
          id: string
          is_revoked: boolean
          issued_at: string
          recipient_name: string
          revoked_at: string
          revoked_reason: string
          title: string
          type: string
          verification_token: string
        }[]
      }
      verify_certificate_by_token: {
        Args: { _token: string }
        Returns: {
          certificate_id: string
          description: string
          id: string
          is_revoked: boolean
          issued_at: string
          recipient_name: string
          revoked_at: string
          revoked_reason: string
          title: string
          type: string
          verification_token: string
        }[]
      }
      wallet_ledger_apply_v2: {
        Args: {
          p_amount: number
          p_description?: string
          p_dry_run?: boolean
          p_idempotency_key: string
          p_op: string
          p_reference_id?: string
          p_source_path?: string
          p_user_id: string
        }
        Returns: Json
      }
      wallet_ledger_v2_diff_report: {
        Args: { p_window?: string }
        Returns: Json
      }
      wallet_ledger_v2_diff_snapshot: {
        Args: { p_window?: string }
        Returns: string
      }
      wallet_ledger_v2_drift_report: {
        Args: { p_window?: string }
        Returns: Json
      }
      wallet_transaction: {
        Args: {
          _amount: number
          _description?: string
          _metadata?: Json
          _reference_id?: string
          _reference_type?: string
          _type: string
          _user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "user"
        | "judge"
        | "content_editor"
        | "admin"
        | "registered_photographer"
        | "student"
      post_tag_status: "pending" | "approved" | "declined" | "removed"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "user",
        "judge",
        "content_editor",
        "admin",
        "registered_photographer",
        "student",
      ],
      post_tag_status: ["pending", "approved", "declined", "removed"],
    },
  },
} as const
