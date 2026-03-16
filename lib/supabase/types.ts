export type PlanType = "basic" | "premium" | "professional"
export type SubscriptionStatus = "active" | "canceled" | "past_due" | "trialing"

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          full_name?: string | null
          avatar_url?: string | null
          updated_at?: string | null
        }
        Update: {
          full_name?: string | null
          avatar_url?: string | null
          updated_at?: string | null
        }
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          plan_type: PlanType
          status: SubscriptionStatus
          current_period_start: string | null
          current_period_end: string | null
          cancel_at_period_end: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan_type: PlanType
          status: SubscriptionStatus
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan_type?: PlanType
          status?: SubscriptionStatus
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          updated_at?: string
        }
      }
      usage: {
        Row: {
          id: string
          user_id: string
          month: string
          minutes_used: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          month: string
          minutes_used?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          minutes_used?: number
          updated_at?: string
        }
      }
      payments: {
        Row: {
          id: string
          user_id: string
          stripe_payment_id: string | null
          amount: number
          currency: string
          status: string
          invoice_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          stripe_payment_id?: string | null
          amount: number
          currency?: string
          status: string
          invoice_url?: string | null
          created_at?: string
        }
        Update: {
          status?: string
          invoice_url?: string | null
        }
      }
      bonus_minutes: {
        Row: {
          id: string
          user_id: string
          balance: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          balance?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          balance?: number
          updated_at?: string
        }
      }
      bonus_minutes_ledger: {
        Row: {
          id: string
          user_id: string
          amount: number
          source: string
          stripe_payment_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          source: string
          stripe_payment_id?: string | null
          created_at?: string
        }
        Update: Record<string, never>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      plan_type: PlanType
      subscription_status: SubscriptionStatus
    }
  }
}
