\set ON_ERROR_STOP off
\pset pager off
\echo '== 1. cuentas nuevas'
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
 ('aaaaaaaa-0000-0000-0000-000000000001','admin@x.co','{"nombre":"Admin Prueba"}','x'),
 ('bbbbbbbb-0000-0000-0000-000000000002','marta@x.co','{"nombre":"Marta Aux","cedula":"11.22.33"}','x'),
 ('cccccccc-0000-0000-0000-000000000003','carlos@x.co','{"nombre":"Carlos V","cedula":"71234567","ciudad":"Medellín"}','x');
select nombre, rol, activo, cedula, ciudad from public.perfiles order by correo;
select texto from public.notificaciones;

\echo '== 2. el superusuario aprueba y asigna roles'
set role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select set_config('request.headers', json_build_object('x-forwarded-for','190.1.2.3, 10.0.0.1','user-agent','Mozilla/5.0 test','x-equipo', encode(convert_to('{"i":"dev-admin","n":"Android 14 · Chrome (móvil)","p":"390x800","z":"America/Bogota"}','UTF8'),'base64'))::text,false);
update public.perfiles set activo=true, rol='auxiliar' where correo='marta@x.co';
update public.perfiles set activo=true, centro_id=(select id from public.centros_costo where codigo='CC-101') where correo='carlos@x.co';
select correo, rol, activo from public.perfiles order by correo;
reset role;

\echo '== 3. un vendedor pendiente NO puede registrar gastos (probamos con cuenta nueva)'
insert into auth.users (id,email,raw_user_meta_data,encrypted_password) values ('dddddddd-0000-0000-0000-000000000004','pend@x.co','{"nombre":"Pendiente"}','x');
set role authenticated; select set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-000000000004',false);
insert into public.gastos (id,vendedor_id,centro_id,categoria,monto,descripcion,fecha,ciudad) select '11111111-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000004',id,'otros',1000,'x',current_date,'Cali' from public.centros_costo limit 1;
reset role;

\echo '== 4. el vendedor registra; no puede a nombre de otro'
set role authenticated; select set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-000000000003',false);
select set_config('request.headers', json_build_object('x-forwarded-for','181.9.9.9','x-equipo', encode(convert_to('{"i":"dev-carlos","n":"iPhone/iPad · Safari (móvil)"}','UTF8'),'base64'))::text,false);
insert into public.gastos (id,vendedor_id,centro_id,categoria,monto,descripcion,fecha,ciudad) select '22222222-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003',id,'alimentacion',38000,'Almuerzo',current_date,'Medellín' from public.centros_costo where codigo='CC-101';
insert into public.gastos (id,vendedor_id,centro_id,categoria,monto,descripcion,fecha,ciudad) select '33333333-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000002',id,'otros',1000,'suplantado',current_date,'Cali' from public.centros_costo limit 1;
insert into public.gastos (id,vendedor_id,centro_id,categoria,monto,descripcion,fecha,ciudad,foto_path) select '44444444-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000003',id,'hospedaje',90000,'Hotel sin foto',current_date,'Medellín','' from public.centros_costo where codigo='CC-101';
select estado, vendedor_nombre from public.gastos;
select texto from public.notificaciones where usuario_id='cccccccc-0000-0000-0000-000000000003';
reset role;

\echo '== 5. el auxiliar: no edita directo, sí da de alta'
set role authenticated; select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
select set_config('request.headers', json_build_object('x-forwarded-for','200.5.5.5','x-equipo', encode(convert_to('{"i":"dev-marta","n":"Windows · Edge"}','UTF8'),'base64'))::text,false);
update public.gastos set monto=1 where id='22222222-0000-0000-0000-000000000002';
select monto from public.gastos where id='22222222-0000-0000-0000-000000000002';
select public.dar_alta('22222222-0000-0000-0000-000000000002');
select estado, alta_por from public.gastos where id='22222222-0000-0000-0000-000000000002';
select count(*) as "auxiliar_ve_auditoria(debe ser 0)" from public.auditoria;
select public.admin_cambiar_clave('cccccccc-0000-0000-0000-000000000003','hackeada1');
update public.perfiles set rol='super' where correo='marta@x.co';
select rol as "rol_de_marta_tras_intentar_subirse" from public.perfiles where correo='marta@x.co';
reset role;

\echo '== 6. el vendedor ya no modifica tras el alta'
set role authenticated; select set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-000000000003',false);
update public.gastos set monto=5 where id='22222222-0000-0000-0000-000000000002';
select monto from public.gastos where id='22222222-0000-0000-0000-000000000002';
select count(*) as "vendedor_ve_auditoria(0)" from public.auditoria;
select public.registrar_evento('login','Inicio de sesión');
select public.registrar_evento('borrar_todo','x');
reset role;

\echo '== 7. el superusuario: cambia claves y ve la actividad con equipo, IP y hora'
set role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select set_config('request.headers', json_build_object('x-forwarded-for','190.1.2.3','x-equipo', encode(convert_to('{"i":"dev-admin","n":"Android 14 · Chrome (móvil)"}','UTF8'),'base64'))::text,false);
select public.admin_cambiar_clave('cccccccc-0000-0000-0000-000000000003','nueva-clave-9');
select public.admin_cambiar_clave('cccccccc-0000-0000-0000-000000000003','123');
reset role;
select (encrypted_password = extensions.crypt('nueva-clave-9', encrypted_password)) as clave_nueva_valida from auth.users where id='cccccccc-0000-0000-0000-000000000003';
set role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select to_char(en,'HH24:MI:SS') hora, usuario_nombre, accion, equipo_nombre, ip, left(detalle,50) detalle from public.auditoria order by en, accion;
select count(*) from public.auditoria where detalle ilike '%nueva-clave%' or detalle ilike '%hackeada%';
reset role;
