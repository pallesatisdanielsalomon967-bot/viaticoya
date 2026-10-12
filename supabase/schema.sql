-- =====================================================================
-- ViaticoYa — esquema de base de datos para Supabase (PostgreSQL)
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO este archivo → Run.
-- Es seguro ejecutarlo más de una vez.
--
-- Qué garantiza (aunque alguien manipule la app en su celular):
--   · El vendedor solo ve y registra lo suyo, y NO puede modificar un gasto dado de alta.
--   · El auxiliar contable ve todo, da de alta / rechaza y exporta, pero NO edita datos.
--   · El superusuario puede modificar todo; cada cambio queda en la auditoría.
--   · Nadie borra gastos. La factura (NIT + número) no se puede registrar dos veces.
--   · Cuentas: cualquiera puede crear una cuenta (siempre de vendedor y, por defecto, pendiente de aprobación).
--     El PRIMER usuario que se registra queda como superusuario; los demás roles los otorga el superusuario.
--   · Solo el superusuario ve la actividad (quién hizo qué, desde qué equipo, IP, fecha y hora) y cambia contraseñas.
-- =====================================================================

-- ---------- Tablas ----------

create table if not exists public.centros_costo (
  id      uuid primary key default gen_random_uuid(),
  codigo  text not null unique check (codigo ~ '^[A-Z0-9-]{2,12}$'),
  nombre  text not null check (char_length(btrim(nombre)) between 3 and 80),
  activo  boolean not null default true
);

create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  correo     text not null,
  rol        text not null default 'vendedor' check (rol in ('vendedor', 'auxiliar', 'super')),
  cedula     text,
  centro_id  uuid references public.centros_costo(id),
  ciudad     text,
  activo     boolean not null default true
);

create table if not exists public.gastos (
  id                  uuid primary key,                      -- lo crea el celular: reenviar no duplica
  vendedor_id         uuid not null references public.perfiles(id),
  vendedor_nombre     text not null default '',
  centro_id           uuid not null references public.centros_costo(id),
  categoria           text not null check (categoria in ('alimentacion','transporte','tiquetes','hospedaje','peajes','combustible','parqueadero','clientes','otros')),
  monto               bigint not null check (monto > 0 and monto <= 50000000),
  iva                 bigint not null default 0 check (iva >= 0 and iva <= monto),
  descripcion         text not null check (char_length(btrim(descripcion)) between 1 and 80),
  fecha               date not null check (fecha <= current_date + 1),
  ciudad              text not null check (char_length(btrim(ciudad)) > 0),
  proveedor_nit       text not null default '',
  factura_numero      text not null default '',
  lat                 double precision check (lat between -90 and 90),
  lng                 double precision check (lng between -180 and 180),
  precision_m         double precision,
  ubicacion_motivo    text not null default '',
  foto_path           text not null default '',
  estado              text not null default 'enviado' check (estado in ('enviado','alta','rechazado')),
  creado_dispositivo  timestamptz,                           -- hora del celular (puede estar mal puesta)
  recibido_servidor   timestamptz not null default now(),    -- hora del servidor (es la que vale)
  alta_por            text not null default '',
  alta_en             timestamptz,
  motivo_rechazo      text not null default ''
);

-- La misma factura de un proveedor no se registra dos veces (los rechazados no cuentan)
create unique index if not exists gastos_factura_unica
  on public.gastos (proveedor_nit, lower(factura_numero))
  where proveedor_nit <> '' and factura_numero <> '' and estado <> 'rechazado';
create index if not exists gastos_vendedor_idx on public.gastos (vendedor_id, fecha desc);
create index if not exists gastos_estado_idx on public.gastos (estado, fecha desc);

create table if not exists public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  tipo        text not null,
  gasto_id    uuid,
  texto       text not null,
  creada      timestamptz not null default now(),
  leida       boolean not null default false
);
create index if not exists notificaciones_usuario_idx on public.notificaciones (usuario_id, creada desc);

create table if not exists public.auditoria (
  id              uuid primary key default gen_random_uuid(),
  en              timestamptz not null default now(),
  usuario_id      uuid,
  usuario_nombre  text,
  accion          text not null,
  gasto_id        uuid,
  detalle         text
);
alter table public.auditoria add column if not exists equipo_id     text;
alter table public.auditoria add column if not exists equipo_nombre text;
alter table public.auditoria add column if not exists ip            text;
create index if not exists auditoria_en_idx on public.auditoria (en desc);
create index if not exists auditoria_usuario_idx on public.auditoria (usuario_id, en desc);

-- ---------- Funciones de apoyo ----------

-- Rol de quien hace la consulta (security definer: evita recursión con las reglas de perfiles)
create or replace function public.rol_actual() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;

create or replace function public.fmt_cop(v bigint) returns text
language sql immutable as $$
  select '$ ' || replace(to_char(v, 'FM999,999,999,999,999'), ',', '.')
$$;

create or replace function public.nombre_categoria(c text) returns text
language sql immutable as $$
  select case c
    when 'alimentacion' then 'Alimentación' when 'transporte' then 'Transporte urbano' when 'tiquetes' then 'Tiquetes intermunicipales'
    when 'hospedaje' then 'Hospedaje' when 'peajes' then 'Peajes' when 'combustible' then 'Combustible'
    when 'parqueadero' then 'Parqueadero' when 'clientes' then 'Atención a clientes' else 'Otros' end
$$;

-- Equipo e IP de quien hace la petición. La app manda la cabecera "x-equipo" (id y nombre del dispositivo);
-- la IP la agrega el servidor (x-forwarded-for). Si algo falta, queda vacío: nunca falla.
create or replace function public.contexto_equipo() returns jsonb
language plpgsql stable set search_path = public as $$
declare
  h jsonb := null;
  e jsonb := '{}'::jsonb;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  if h is null then return jsonb_build_object('ip', '', 'equipo_id', '', 'equipo_nombre', ''); end if;
  begin e := convert_from(decode(h ->> 'x-equipo', 'base64'), 'UTF8')::jsonb; exception when others then e := '{}'::jsonb; end;
  return jsonb_build_object(
    'ip', left(btrim(split_part(coalesce(h ->> 'x-forwarded-for', h ->> 'x-real-ip', ''), ',', 1)), 64),
    'equipo_id', left(coalesce(e ->> 'i', ''), 64),
    'equipo_nombre', left(coalesce(nullif(e ->> 'n', ''), h ->> 'user-agent', ''), 120));
end $$;

-- Única vía para escribir en la auditoría (solo la usan las otras funciones; ningún usuario la llama directamente)
create or replace function public.auditar(p_usuario uuid, p_nombre text, p_accion text, p_gasto uuid, p_detalle text) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb := public.contexto_equipo();
begin
  insert into public.auditoria (usuario_id, usuario_nombre, accion, gasto_id, detalle, equipo_id, equipo_nombre, ip)
  values (p_usuario, p_nombre, p_accion, p_gasto, left(coalesce(p_detalle, ''), 400), c ->> 'equipo_id', c ->> 'equipo_nombre', c ->> 'ip');
end $$;
revoke execute on function public.auditar(uuid, text, text, uuid, text) from public, anon, authenticated;

-- Al crear una cuenta (desde la app o desde Authentication → Add user) se crea su perfil:
--   · el PRIMER usuario del sistema queda como superusuario y activo;
--   · los demás quedan como vendedor, y PENDIENTES de aprobación si aprobar_nuevos = true.
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  aprobar_nuevos constant boolean := true;   -- pon false para que las cuentas nuevas entren sin aprobación
  primero boolean;
  nom text;
begin
  perform pg_advisory_xact_lock(7001);       -- evita que dos primeros registros simultáneos sean superusuario
  select not exists (select 1 from public.perfiles) into primero;
  nom := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1));
  insert into public.perfiles (id, nombre, correo, rol, cedula, ciudad, activo)
  values (
    new.id, nom, new.email,
    case when primero then 'super' else 'vendedor' end,
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'cedula', ''), '[^0-9]', '', 'g'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'ciudad'), ''),
    primero or not aprobar_nuevos)
  on conflict (id) do nothing;
  perform public.auditar(new.id, nom, 'registro_usuario', null,
    case when primero then 'Primera cuenta: superusuario' when aprobar_nuevos then 'Cuenta creada (pendiente de aprobación)' else 'Cuenta creada' end);
  if not primero and aprobar_nuevos then
    insert into public.notificaciones (usuario_id, tipo, texto)
      select p.id, 'usuario_nuevo', nom || ' creó una cuenta y espera tu aprobación.' from public.perfiles p where p.activo and p.rol = 'super';
  end if;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.nuevo_usuario();

-- ---------- Reglas de los gastos (se aplican SIEMPRE, vengan de donde vengan) ----------

create or replace function public.gastos_reglas() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rol text := public.rol_actual();
begin
  if tg_op = 'INSERT' then
    if rol is null or rol not in ('vendedor', 'super') then
      raise exception 'Tu rol no puede registrar gastos' using errcode = '42501';
    end if;
    if new.vendedor_id <> auth.uid() then
      raise exception 'Solo puedes registrar gastos a tu nombre' using errcode = '42501';
    end if;
    select nombre into new.vendedor_nombre from public.perfiles where id = auth.uid();
    new.estado := 'enviado';
    new.recibido_servidor := now();
    new.alta_por := '';
    new.alta_en := null;
    new.motivo_rechazo := '';
    if new.monto >= 50000 and new.foto_path = '' then
      raise exception 'Desde $ 50.000 la foto de la factura o recibo es obligatoria';
    end if;
    return new;
  end if;

  -- UPDATE
  if rol = 'super' then
    return new;
  end if;
  if old.estado = 'alta' then
    raise exception 'El gasto ya fue dado de alta y no se puede modificar';
  end if;
  if rol = 'vendedor' and old.vendedor_id = auth.uid() then
    new.vendedor_id := old.vendedor_id;
    new.vendedor_nombre := old.vendedor_nombre;
    new.estado := 'enviado';
    new.motivo_rechazo := '';
    new.alta_por := '';
    new.alta_en := null;
    new.recibido_servidor := now();
    return new;
  end if;
  -- El resto (auxiliar) solo cambia gastos a través de dar_alta() y rechazar()
  if coalesce(current_setting('viaticoya.rpc', true), '') = 'on' then
    return new;
  end if;
  raise exception 'No tienes permiso para modificar este gasto' using errcode = '42501';
end $$;

drop trigger if exists gastos_reglas_trg on public.gastos;
create trigger gastos_reglas_trg before insert or update on public.gastos
  for each row execute function public.gastos_reglas();

-- Avisos y auditoría después de registrar o cambiar un gasto
create or replace function public.gastos_despues() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  yo public.perfiles;
  resumen text;
  cambios text;
begin
  select * into yo from public.perfiles where id = auth.uid();
  resumen := public.fmt_cop(new.monto) || ' (' || public.nombre_categoria(new.categoria) || ')';

  if tg_op = 'INSERT' then
    perform public.auditar(yo.id, yo.nombre, 'registro', new.id, resumen);
    insert into public.notificaciones (usuario_id, tipo, gasto_id, texto)
      select p.id, 'nuevo', new.id, new.vendedor_nombre || ' envió ' || resumen || ': pendiente de alta.'
      from public.perfiles p where p.activo and p.rol in ('auxiliar', 'super');
    insert into public.notificaciones (usuario_id, tipo, gasto_id, texto)
      values (new.vendedor_id, 'enviado', new.id, 'Enviado correctamente a contabilidad: ' || resumen || '.');
    return new;
  end if;

  -- Los cambios hechos por dar_alta / rechazar / revertir_alta ya los registran esas funciones
  if coalesce(current_setting('viaticoya.rpc', true), '') = 'on' then
    return new;
  end if;

  select string_agg(k || ': ' || coalesce(to_jsonb(old) ->> k, '') || ' → ' || coalesce(to_jsonb(new) ->> k, ''), '; ')
    into cambios
    from jsonb_object_keys(to_jsonb(new)) as k
    where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k)
      and k not in ('recibido_servidor', 'alta_en', 'motivo_rechazo', 'alta_por', 'estado');

  perform public.auditar(yo.id, yo.nombre, case when yo.rol = 'super' then 'edicion' else 'reenvio' end, new.id, coalesce(cambios, 'Sin cambios'));

  if yo.rol = 'vendedor' then
    insert into public.notificaciones (usuario_id, tipo, gasto_id, texto)
      select p.id, 'nuevo', new.id, new.vendedor_nombre || ' corrigió y reenvió ' || resumen || '.'
      from public.perfiles p where p.activo and p.rol in ('auxiliar', 'super') and old.estado = 'rechazado';
    insert into public.notificaciones (usuario_id, tipo, gasto_id, texto)
      values (new.vendedor_id, 'enviado', new.id, 'Enviado correctamente a contabilidad: ' || resumen || '.');
  end if;
  return new;
end $$;

drop trigger if exists gastos_despues_trg on public.gastos;
create trigger gastos_despues_trg after insert or update on public.gastos
  for each row execute function public.gastos_despues();

-- ---------- Acciones de contabilidad (el auxiliar NO edita datos: solo usa estas funciones) ----------

create or replace function public.dar_alta(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  yo public.perfiles;
  g public.gastos;
begin
  select * into yo from public.perfiles where id = auth.uid() and activo;
  if yo.id is null or yo.rol not in ('auxiliar', 'super') then
    raise exception 'No tienes permiso para dar de alta gastos' using errcode = '42501';
  end if;
  select * into g from public.gastos where id = p_id for update;
  if not found then raise exception 'No se encontró el gasto'; end if;
  if g.estado = 'alta' then raise exception 'Ese gasto ya está dado de alta'; end if;
  if g.estado <> 'enviado' then raise exception 'Solo se dan de alta los gastos enviados'; end if;

  perform set_config('viaticoya.rpc', 'on', true);
  update public.gastos set estado = 'alta', alta_por = yo.nombre, alta_en = now(), motivo_rechazo = '' where id = p_id;

  perform public.auditar(yo.id, yo.nombre, 'alta', p_id, public.fmt_cop(g.monto) || ' de ' || g.vendedor_nombre);
  insert into public.notificaciones (usuario_id, tipo, gasto_id, texto)
    values (yo.id, 'alta_ok', p_id, 'Dado de alta correctamente: ' || public.fmt_cop(g.monto) || ' de ' || g.vendedor_nombre || '.');
  insert into public.notificaciones (usuario_id, tipo, gasto_id, texto)
    values (g.vendedor_id, 'alta', p_id, 'Contabilidad dio de alta tu gasto de ' || public.fmt_cop(g.monto) || ' (' || public.nombre_categoria(g.categoria) || ').');
end $$;

create or replace function public.rechazar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  yo public.perfiles;
  g public.gastos;
  m text := btrim(coalesce(p_motivo, ''));
begin
  select * into yo from public.perfiles where id = auth.uid() and activo;
  if yo.id is null or yo.rol not in ('auxiliar', 'super') then
    raise exception 'No tienes permiso para rechazar gastos' using errcode = '42501';
  end if;
  if char_length(m) < 5 then raise exception 'Escribe el motivo del rechazo (mínimo 5 caracteres)'; end if;
  select * into g from public.gastos where id = p_id for update;
  if not found then raise exception 'No se encontró el gasto'; end if;
  if g.estado <> 'enviado' then raise exception 'Solo se rechazan los gastos enviados (si ya tiene alta no se puede)'; end if;

  perform set_config('viaticoya.rpc', 'on', true);
  update public.gastos set estado = 'rechazado', motivo_rechazo = left(m, 200) where id = p_id;

  perform public.auditar(yo.id, yo.nombre, 'rechazo', p_id, m);
  insert into public.notificaciones (usuario_id, tipo, gasto_id, texto)
    values (g.vendedor_id, 'rechazado', p_id, 'Tu gasto de ' || public.fmt_cop(g.monto) || ' fue rechazado: ' || left(m, 200));
end $$;

create or replace function public.revertir_alta(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  yo public.perfiles;
begin
  select * into yo from public.perfiles where id = auth.uid() and activo;
  if yo.id is null or yo.rol <> 'super' then
    raise exception 'Solo el superusuario puede revertir un alta' using errcode = '42501';
  end if;
  perform set_config('viaticoya.rpc', 'on', true);
  update public.gastos set estado = 'enviado', alta_por = '', alta_en = null where id = p_id and estado = 'alta';
  if not found then raise exception 'Ese gasto no tiene alta'; end if;
  perform public.auditar(yo.id, yo.nombre, 'reversion', p_id, 'Alta revertida');
end $$;

revoke execute on function public.dar_alta(uuid), public.rechazar(uuid, text), public.revertir_alta(uuid) from public, anon;
grant execute on function public.dar_alta(uuid), public.rechazar(uuid, text), public.revertir_alta(uuid) to authenticated;

-- ---------- Cuentas: eventos de sesión y cambio de contraseña (solo superusuario) ----------

-- La app avisa cuando alguien entra, sale o cambia su propia contraseña; el servidor agrega equipo, IP y hora. No acepta otros eventos.
create or replace function public.registrar_evento(p_accion text, p_detalle text default '') returns void
language plpgsql security definer set search_path = public as $$
declare yo public.perfiles;
begin
  if p_accion not in ('login', 'logout', 'clave_propia') then raise exception 'Evento no permitido'; end if;
  select * into yo from public.perfiles where id = auth.uid();
  if yo.id is null then return; end if;
  perform public.auditar(yo.id, yo.nombre, p_accion, null, left(coalesce(p_detalle, ''), 200));
end $$;

-- Cambia la contraseña de cualquier usuario y cierra sus sesiones abiertas. Nunca guarda la contraseña en la auditoría.
create or replace function public.admin_cambiar_clave(p_usuario uuid, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  yo public.perfiles;
  x public.perfiles;
begin
  select * into yo from public.perfiles where id = auth.uid() and activo;
  if yo.id is null or yo.rol <> 'super' then
    raise exception 'Solo el superusuario cambia contraseñas' using errcode = '42501';
  end if;
  if char_length(coalesce(p_clave, '')) < 6 then raise exception 'La contraseña debe tener mínimo 6 caracteres'; end if;
  select * into x from public.perfiles where id = p_usuario;
  if x.id is null then raise exception 'No se encontró el usuario'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf')), updated_at = now() where id = p_usuario;
  begin delete from auth.sessions where user_id = p_usuario; exception when others then null; end;
  perform public.auditar(yo.id, yo.nombre, 'clave_cambiada', null, 'Contraseña de ' || x.nombre || ' (' || x.correo || ')');
end $$;

revoke execute on function public.registrar_evento(text, text), public.admin_cambiar_clave(uuid, text) from public, anon;
grant execute on function public.registrar_evento(text, text), public.admin_cambiar_clave(uuid, text) to authenticated;

-- ---------- Reglas de acceso por fila (RLS) ----------

alter table public.centros_costo enable row level security;
alter table public.perfiles enable row level security;
alter table public.gastos enable row level security;
alter table public.notificaciones enable row level security;
alter table public.auditoria enable row level security;

-- Centros de costo: todos los usuarios los leen; solo el superusuario los crea o cambia
drop policy if exists centros_ver on public.centros_costo;
create policy centros_ver on public.centros_costo for select to authenticated using (true);
drop policy if exists centros_crear on public.centros_costo;
create policy centros_crear on public.centros_costo for insert to authenticated with check (public.rol_actual() = 'super');
drop policy if exists centros_cambiar on public.centros_costo;
create policy centros_cambiar on public.centros_costo for update to authenticated using (public.rol_actual() = 'super') with check (public.rol_actual() = 'super');

-- Perfiles: cada quien ve el suyo; contabilidad ve todos; solo el superusuario los cambia
drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles for select to authenticated
  using (id = auth.uid() or public.rol_actual() in ('auxiliar', 'super'));
drop policy if exists perfiles_cambiar on public.perfiles;
create policy perfiles_cambiar on public.perfiles for update to authenticated
  using (public.rol_actual() = 'super') with check (public.rol_actual() = 'super');

-- Gastos
drop policy if exists gastos_ver on public.gastos;
create policy gastos_ver on public.gastos for select to authenticated
  using (vendedor_id = auth.uid() or public.rol_actual() in ('auxiliar', 'super'));
drop policy if exists gastos_crear on public.gastos;
create policy gastos_crear on public.gastos for insert to authenticated
  with check (public.rol_actual() in ('vendedor', 'super') and vendedor_id = auth.uid());
drop policy if exists gastos_editar_vendedor on public.gastos;
create policy gastos_editar_vendedor on public.gastos for update to authenticated
  using (vendedor_id = auth.uid() and public.rol_actual() = 'vendedor' and estado <> 'alta')
  with check (vendedor_id = auth.uid());
drop policy if exists gastos_editar_super on public.gastos;
create policy gastos_editar_super on public.gastos for update to authenticated
  using (public.rol_actual() = 'super') with check (public.rol_actual() = 'super');
-- No hay política de borrado: nadie elimina gastos.

-- Notificaciones: cada quien ve y marca como leídas las suyas
drop policy if exists notif_ver on public.notificaciones;
create policy notif_ver on public.notificaciones for select to authenticated using (usuario_id = auth.uid());
drop policy if exists notif_leer on public.notificaciones;
create policy notif_leer on public.notificaciones for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
revoke update on public.notificaciones from authenticated;
grant update (leida) on public.notificaciones to authenticated;

-- Actividad (auditoría): la lee SOLO el superusuario; nadie la escribe directamente (solo las funciones de arriba)
drop policy if exists audit_ver on public.auditoria;
create policy audit_ver on public.auditoria for select to authenticated using (public.rol_actual() = 'super');

-- El superusuario cambia perfiles solo en estas columnas (no el id ni el correo)
revoke update on public.perfiles from authenticated;
grant update (nombre, rol, cedula, centro_id, ciudad, activo) on public.perfiles to authenticated;

-- ---------- Fotos de facturas y recibos (almacenamiento privado) ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recibos', 'recibos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists recibos_subir on storage.objects;
create policy recibos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'recibos' and (storage.foldername(name))[1] = auth.uid()::text and public.rol_actual() in ('vendedor', 'super'));

-- Reemplazar una foto solo mientras su gasto no esté dado de alta
drop policy if exists recibos_reemplazar on storage.objects;
create policy recibos_reemplazar on storage.objects for update to authenticated
  using (bucket_id = 'recibos' and (storage.foldername(name))[1] = auth.uid()::text
         and not exists (select 1 from public.gastos g where g.foto_path = name and g.estado = 'alta'))
  with check (bucket_id = 'recibos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists recibos_ver on storage.objects;
create policy recibos_ver on storage.objects for select to authenticated
  using (bucket_id = 'recibos' and ((storage.foldername(name))[1] = auth.uid()::text or public.rol_actual() in ('auxiliar', 'super')));

-- ---------- Datos iniciales (opcional) ----------
insert into public.centros_costo (codigo, nombre) values
  ('CC-101', 'Ventas Antioquia'), ('CC-102', 'Ventas Costa Caribe'), ('CC-103', 'Ventas Eje Cafetero'), ('CC-104', 'Ventas Bogotá y Cundinamarca')
on conflict (codigo) do nothing;

-- ---------- Después de ejecutar este archivo ----------
-- 1) Authentication → Sign In / Providers → Email: deja activado "Allow new users to sign up".
--    · "Confirm email": APAGADO = la cuenta se crea al instante (más simple; el superusuario aprueba igual).
--                       ENCENDIDO = cada persona confirma su correo antes de ingresar.
--    · "Minimum password length": 6 (Supabase no permite menos).
-- 2) Pega la URL y la clave anon en js/config.js y publica la app.
-- 3) ABRE LA APP Y CREA TU CUENTA PRIMERO: la primera cuenta registrada queda como superusuario.
-- 4) Las demás personas crean su cuenta desde la app (quedan pendientes). Tú, como superusuario, entras a
--    Admin → Usuarios, apruebas, asignas rol (vendedor / auxiliar contable), cédula y centro de costo.
-- Para cuentas sin aprobación: cambia aprobar_nuevos a false en la función nuevo_usuario() (y en js/config.js).
