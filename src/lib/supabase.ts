import { createClient } from '@supabase/supabase-js';

const fallbackUrl = 'https://lpirjwifzosdzgdncsbt.supabase.co';
const fallbackPublishableKey = 'sb_publishable_ORe3lY3LRSZo0LMpz4EM9Q_Bf9aUejD';

const url = import.meta.env.VITE_SUPABASE_URL || fallbackUrl;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || fallbackPublishableKey;

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
