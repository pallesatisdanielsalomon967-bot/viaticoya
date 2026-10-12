# ViaticoYa — control de viáticos de vendedores

Aplicación móvil (PWA) para que vendedores en distintas ciudades de Colombia registren sus gastos de viaje, y para que contabilidad los revise, los dé de alta y los exporte a Excel por vendedor y centro de costo.

**Publicada en:** https://pallesatisdanielsalomon967-bot.github.io/viaticoya/ (después de seguir la sección "Publicar").

## Qué hace

| Rol | Puede | No puede |
|---|---|---|
| **Vendedor** | Registrar gastos (con foto, voz y ubicación automática, también sin internet), ver los suyos, corregir mientras no estén dados de alta, recibir el aviso "Enviado correctamente a contabilidad" | Modificar un gasto ya dado de alta; ver gastos de otros |
| **Auxiliar contable** (lo otorga el superusuario) | Ver todo, **dar de alta** o rechazar (con motivo), exportar a Excel; ve alertas por gasto; recibe "Dado de alta correctamente" | Registrar o modificar gastos |
| **Superusuario** | Todo lo anterior + aprobar cuentas nuevas y asignar roles, **cambiar la contraseña de cualquier usuario**, ver la **actividad** de cada usuario (acción, equipo, IP, fecha y hora), corregir cualquier gasto (queda en la actividad), administrar centros de costo | — |

## Cuentas y acceso

- La pantalla de inicio solo tiene **Ingresar** y **Crear cuenta**. Quien crea una cuenta nace como **vendedor** y queda **por aprobar**; el superusuario la aprueba y, si corresponde, le asigna otro rol (auxiliar contable o superusuario). Nadie puede darse un rol superior a sí mismo.
- **Superusuario inicial (modo real):** la **primera cuenta que se crea** en un proyecto Supabase nuevo queda como superusuario automáticamente (lo hace el servidor, ver `supabase/schema.sql`). Por eso el dueño debe crear su cuenta primero. Sus datos **no están escritos en el código ni en el repositorio** (es público); cada quien define su contraseña al crear la cuenta (mínimo 6 caracteres; una de 4 dígitos no la acepta Supabase y sería insegura).
- Cambio de contraseña: cada persona cambia la suya en *Mi cuenta* (pide la actual); el superusuario cambia la de cualquiera en *Admin → Usuarios → Cambiar contraseña* (puede generar una segura). Ambos cambios quedan en la actividad, sin guardar la contraseña.
- **Actividad** (solo superusuario, *Admin → Actividad*): ingresos, cierres de sesión, gastos registrados/corregidos, altas, rechazos, cambios de usuarios y de contraseñas, con **nombre del equipo** (sistema y navegador, e identificador propio de ese celular), **IP** (la anota el servidor; solo modo real), fecha y hora; filtros por usuario, acción y fechas. No se puede borrar desde la app.

## Funciones

- **Instalable:** botón *Instalar la app en mi celular* en el inicio (Android/Chrome muestra la ventana de instalación; en iPhone se explica Safari → Compartir → *Agregar a pantalla de inicio*). Es una PWA: queda con ícono, a pantalla completa y funciona sin internet. No es un APK de tienda.
- **Reporte inmediato:** el tablero de contabilidad se actualiza solo (cada 15 s) y al volver la conexión.
- **Excel:** 4 hojas (Detalle, Por vendedor, Por centro de costo, Vendedor y centro) con totales y filtros. La columna "Cuenta contable" queda vacía para que contabilidad la complete.
- **Sin internet:** cada gasto se guarda primero en el celular (con su foto) y se envía solo al volver la conexión, sin duplicarse.
- **Foto:** se reduce a ~1280 px; obligatoria desde $ 50.000.
- **Ubicación automática:** la app la pide al ingresar, al abrir el formulario y al enviar, sin botones; la ciudad se propone sola según el GPS. *Límite:* el navegador exige que la persona acepte **una vez** el permiso de ubicación (ninguna página web puede saltarse ese aviso); aceptado, queda automática. La autorización de datos personales (Ley 1581 de 2012) se acepta al crear la cuenta.
- **Voz:** micrófono (es-CO) o frase escrita: "almuerzo con cliente 45 mil en Medellín".
- **Predictivo (calculado en el celular, sin enviar datos a servicios de IA):**
  - *Vendedor:* gastos frecuentes en un toque, sugerencia de categoría, valor y NIT según su historial, valor habitual y aviso si un valor es 2,5 veces mayor ("¿sobra un cero?"), ciudad por GPS.
  - *Contabilidad:* **alertas por gasto** (valor atípico, supera el tope diario, parecido a otro, ubicación a más de 80 km de la ciudad declarada, sin ubicación, sin foto, fecha antigua), lista ordenada por riesgo, **alta en lote** solo de los que no tienen ninguna alerta, y **proyección del gasto del mes** (desde el día 5). Las alertas orientan; la decisión es de la persona.
- **Rápida:** abre al instante con la última copia guardada mientras actualiza; listas de 40 en 40 con «Mostrar más».
- **Controles:** no se aceptan fechas futuras ni de más de 60 días, NIT + factura duplicados quedan bloqueados.

## Datos: solo Supabase (sin modo prueba)

La app guarda cuentas, gastos, fotos y actividad en **Supabase** (PostgreSQL + Auth + Storage privado), con la seguridad aplicada en el servidor. Si `js/config.js` no tiene las claves, la app muestra una pantalla «Falta conectar la base de datos» en vez de funcionar con datos falsos.

**Paso a paso completo: [`INSTRUCTIVO-SUPABASE.md`](INSTRUCTIVO-SUPABASE.md)** (crear proyecto, ejecutar `supabase/schema.sql`, ajustes de Auth, claves, primera cuenta = superusuario, centros de costo, aprobación de cuentas, pruebas, mantenimiento y solución de problemas).

Resumen: crear proyecto → ejecutar `schema.sql` → Auth: *Confirm email* en OFF y mínimo 6 caracteres → pegar *Project URL* y clave *anon/publishable* en `js/config.js` (**nunca** la `service_role`) → subir a GitHub → **crear primero la cuenta del administrador**.

## Publicar en GitHub Pages

1. En github.com: **New repository** → nombre `viaticoya` → **Public** → **Create repository**.
2. **Add file → Upload files.** Abre la carpeta `viaticoya`, selecciona **todo su contenido** (Ctrl + A: `index.html`, `sw.js`, `manifest.webmanifest`, `css`, `js`, `fonts`, `iconos`, `supabase`, `pruebas`, `README.md`) y arrástralo. No subas `node_modules`. Presiona **Commit changes** y comprueba que las carpetas aparezcan con su nombre.
3. **Settings → Pages → Source: Deploy from a branch → Branch: `main`, carpeta `/ (root)` → Save.**
4. Espera 1–2 minutos y abre `https://pallesatisdanielsalomon967-bot.github.io/viaticoya/`.
5. **Instalar en el celular:** Android (Chrome) → menú ⋮ → *Instalar aplicación*. iPhone (Safari) → Compartir → *Agregar a pantalla de inicio*.

## Estructura

```
index.html            pantallas y diálogos
css/estilos.css       estilo (modo claro y oscuro)
js/logica.js          reglas: roles, validación, totales, dictado, hojas del Excel
js/xlsx.js            creador de archivos .xlsx (sin librerías)
js/almacen.js         IndexedDB (cola de envío, fotos, copia para uso sin internet)
js/datos.js           adaptador Supabase + cola de envío (y un servidor en memoria solo para pruebas)
js/ui.js              utilidades de pantalla (foto, ubicación, voz, descargas)
js/app.js             vistas por rol
js/config.js          único archivo a editar para conectar a Supabase
sw.js, manifest       instalación y funcionamiento sin internet
supabase/schema.sql   base de datos con seguridad por filas (RLS)
pruebas/              pruebas automáticas
```

Sin librerías externas ni enlaces a otros sitios: la tipografía (Barlow, licencia OFL) está incluida en `fonts/`.

## Pruebas

```bash
npm install        # solo para las pruebas (fake-indexeddb)
npm test           # lógica, Excel y capa de datos
```

Las pruebas automáticas usan un servidor en memoria que solo se activa con `CONFIG.pruebas === true` (las pruebas lo inyectan; nunca está en el `config.js` publicado). Pruebas de navegador (Playwright, Python), con la app servida en `http://localhost:8766`: `pruebas/e2e_v2.py` (crear cuenta, aprobación, roles, contraseñas, actividad, ubicación automática, Excel), `pruebas/e2e_sin_internet.py` (service worker) y `pruebas/e2e_servidor_simulado.py` (adaptador Supabase contra un servidor simulado). `pruebas/supabase/` trae el kit para probar `schema.sql` en un PostgreSQL local.

## Límites que conviene conocer

- **Seguridad:** los permisos los hace cumplir el servidor (reglas RLS y funciones SQL), no la pantalla. La clave `anon` es pública; la `service_role` no debe usarse jamás en la app.
- **Notificaciones:** son dentro de la app (campana y aviso), actualizadas cada 15 s. No son notificaciones push con la app cerrada; eso requiere un servidor de Web Push.
- **iPhone:** no hay envío en segundo plano; los gastos pendientes se envían al abrir la app con internet. El dictado de voz es poco fiable en la app instalada de iOS: se puede usar el micrófono del teclado.
- **Voz:** el reconocimiento lo hace el servicio del navegador (requiere internet).
- **Ubicación:** puede ser imprecisa en interiores o alterada con aplicaciones de ubicación falsa; es un indicio, no una prueba.
- **Verificación:** el esquema se verificó en un PostgreSQL 16 local con un sustituto de Supabase, no en un proyecto Supabase real.
- **Acciones de contabilidad** (dar de alta, rechazar, exportar datos nuevos) requieren conexión.
- **Contabilidad:** la cuenta contable (PUC) y la retención en la fuente no se calculan; el Excel deja la columna de cuenta vacía.
- **Datos personales:** ubicación y cédula son datos personales (Ley 1581 de 2012); la empresa que lo use debe informar la finalidad y pedir autorización.
