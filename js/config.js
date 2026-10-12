/*
 * config.js — ÚNICO archivo que se edita para conectar ViaticoYa a su base de datos (Supabase).
 *
 * 1. Crea el proyecto en supabase.com y ejecuta supabase/schema.sql (ver INSTRUCTIVO-SUPABASE).
 * 2. En Project Settings → API copia "Project URL" y la clave "anon public" y pégalas abajo.
 *    La clave "anon" es pública por diseño: la seguridad la dan las reglas del servidor (RLS) de schema.sql.
 *    NUNCA pegues aquí la clave "service_role".
 * 3. Sube este archivo a GitHub.
 */
const CONFIG = {
  supabaseUrl: "",        // ej: "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "",    // ej: "eyJhbGciOi..."  (la larga que dice "anon public")
  refrescoMs: 15000       // cada cuántos ms se actualizan los datos mientras la app está abierta
};
