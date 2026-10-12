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
    supabaseUrl: "https://qmplotcpmpkhypxhimjg.supabase.co",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtcGxvdGNwbXBraHlweGhpbWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NTk3NDcsImV4cCI6MjEwNzMzNTc0N30.AyOv5HRuH4vumMsGnfHq-ZIdoVDTuqV-t2AXgZISgN4",
    refrescoMs: 15000
};
