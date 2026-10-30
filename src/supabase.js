import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let client = null;
if (url && key) {
  try {
    client = createClient(url, key);
  } catch (error) {
    console.error('Supabase initialization failed:', error);
  }
}

export const supabase = client;
