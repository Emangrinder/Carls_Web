import { createClient } from '@supabase/supabase-js'

// Safe to expose in a public bundle: this is the publishable key, which
// only ever grants what the database's RLS policies allow (public read-only
// here) -- writes require the separate secret key, used only by the ETL
// pipeline and never shipped to the browser.
const SUPABASE_URL = 'https://ctktxbzorhzbkreguxec.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yCzwuvxkFCFBF0AQrl3TOw_8HzRKlmX'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
