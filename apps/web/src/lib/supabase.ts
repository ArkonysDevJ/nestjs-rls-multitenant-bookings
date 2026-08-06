// src/lib/supabase.ts
// [F-ID: FE-LIB-SUPABASE-01]
// @version 1.0.0
// @changelog 1.0.0 — Browser Supabase client, auth only (sign in/up/
//   session). Data queries always go through the backend, never
//   directly from the frontend — the anon key has no data access here.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
