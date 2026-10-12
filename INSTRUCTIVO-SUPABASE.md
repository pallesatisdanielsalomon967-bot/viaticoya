# Instructivo: desplegar ViaticoYa con Supabase y GitHub Pages

Tiempo estimado: 30 a 45 minutos. Costo: $0 con los planes gratuitos. Todo se hace desde el navegador.

**Qué vas a tener al final:** una app instalable en el celular, con cuentas reales, base de datos compartida, fotos de recibos guardadas de forma privada, y un superusuario (tú) que aprueba cuentas, asigna roles, cambia contraseñas y ve la actividad de cada usuario.

> Nota: los nombres de los menús de Supabase cambian de vez en cuando. Si un botón no se llama exactamente igual, busca el más parecido; la lógica de cada paso no cambia.

---

## 0. Antes de empezar

Necesitas:

1. Una cuenta en **github.com** con el repositorio `viaticoya` ya publicado (carpeta de la app subida, Pages activo).
2. Una cuenta en **supabase.com** (se puede crear con tu cuenta de GitHub o con tu correo).
3. El archivo `supabase/schema.sql` que viene dentro de la carpeta de la app.
4. Un correo y una contraseña **que tú elijas** para el superusuario (mínimo 6 caracteres; recomendado: 10 o más con letras y números). No la compartas ni la escribas en ningún archivo del repositorio, porque es público.

**Importante sobre el orden:** la **primera cuenta** que se crea en la app queda como **superusuario**. Por eso la creas tú, en el paso 7, antes de darle el enlace a nadie.

---

## 1. Crear el proyecto en Supabase

1. Entra a **supabase.com → Dashboard → New project**.
2. Completa:
   - **Name:** `viaticoya`
   - **Database Password:** pulsa *Generate a password* y **guárdala** en un lugar seguro (no la vas a pegar en la app; solo sirve para acceso directo a la base).
   - **Region:** la más cercana a Colombia, por ejemplo **South America (São Paulo)**.
   - **Plan:** Free.
3. Pulsa **Create new project** y espera 1 a 2 minutos hasta que termine de prepararse.

---

## 2. Crear las tablas y las reglas de seguridad

1. En el menú izquierdo abre **SQL Editor** → **New query**.
2. Abre el archivo `supabase/schema.sql` (en GitHub o en tu computador), copia **todo** su contenido y pégalo en el editor.
3. Pulsa **Run**.
4. Debe aparecer **Success. No rows returned**. Se puede ejecutar más de una vez sin problema.

**Verifica:**

- **Table Editor** debe listar: `centros_costo`, `perfiles`, `gastos`, `notificaciones`, `auditoria`. Cada una debe decir *RLS enabled* (seguridad por filas activada). Si alguna dice *RLS disabled*, vuelve a ejecutar el SQL completo.
- **Storage** debe mostrar el bucket **recibos** como **Private** (privado). Si no aparece, vuelve a ejecutar el SQL.

---

## 3. Ajustar la autenticación

Menú izquierdo → **Authentication**.

1. **Sign In / Providers → Email:**
   - **Enable Email provider:** activado.
   - **Confirm email:** **desactivado** (OFF). Motivo: con la confirmación activa Supabase envía los correos desde su servidor compartido, que tiene un límite muy bajo (unos pocos correos por hora) y las cuentas nuevas no podrían ingresar. La seguridad no se pierde: de todos modos cada cuenta nueva queda **pendiente hasta que tú la apruebes**.
   - **Minimum password length:** 6 (o más, si quieres exigir contraseñas más largas; la app pide mínimo 6).
2. **URL Configuration:**
   - **Site URL:** `https://TU-USUARIO.github.io/viaticoya/` (la dirección de tu GitHub Pages, con la barra final).
   - **Redirect URLs:** agrega la misma dirección.

---

## 4. Copiar las dos claves del proyecto

Menú izquierdo → **Project Settings → API** (en versiones nuevas puede decir **API Keys**).

Copia:

| Dato | Dónde está | Cómo se ve |
|---|---|---|
| **Project URL** | arriba, sección *Project URL* | `https://abcdefghijkl.supabase.co` |
| **Clave pública** | *anon public* (o *Publishable key*) | una clave larga que empieza por `eyJ…` o `sb_publishable_…` |

> **Nunca uses ni pegues** la clave **service_role** (o *secret*): da acceso total a la base y saltaría todas las reglas. La clave pública está hecha para ir en la app; la protección real son las reglas del paso 2.

---

## 5. Pegar las claves en la app y subirla a GitHub

1. En tu repositorio `viaticoya` en GitHub abre la carpeta **js** y el archivo **config.js**.
2. Pulsa el ícono del **lápiz** (Edit this file).
3. Cambia estas dos líneas con tus valores (entre comillas):

   ```js
   supabaseUrl: "https://abcdefghijkl.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...tu clave pública...",
   ```

4. Pulsa **Commit changes** → **Commit changes**.
5. Si además actualizaste otros archivos de la app (por ejemplo, subiste esta versión nueva), sube **todo el contenido de la carpeta** (Add file → Upload files) y haz commit.
6. Espera 1 a 2 minutos a que GitHub Pages termine (pestaña **Actions** → ciclo verde ✔).

---

## 6. Abrir la app y comprobar la conexión

1. Abre `https://TU-USUARIO.github.io/viaticoya/` (si ves la versión anterior, recarga con **Ctrl + F5**, o en el celular cierra la pestaña y ábrela de nuevo).
2. Debes ver la pantalla de **Ingresar / Crear cuenta**. Si ves **«Falta conectar la base de datos»**, la URL o la clave no quedaron guardadas: revisa el paso 5 (comillas, sin espacios, archivo `js/config.js`).

---

## 7. Crear la cuenta del superusuario (hazlo primero)

1. En la app pulsa **Crear cuenta**.
2. Completa nombre, correo, cédula, ciudad y la contraseña que elegiste. Marca la autorización de datos y pulsa **Crear cuenta**.
3. Como es la primera cuenta, entra directo como **Superusuario** (verás la pestaña **Admin** abajo).

**Verifica en Supabase:** *Table Editor → perfiles*: tu fila debe tener `rol = super` y `activo = true`. En *Authentication → Users* debe aparecer tu correo.

**Si otra persona alcanzó a registrarse antes que tú** y quedó como superusuario, corrige desde *SQL Editor*:

```sql
-- 1) Quitarle el rol a la cuenta equivocada
update public.perfiles set rol = 'vendedor', activo = false where correo = 'correo-equivocado@ejemplo.com';
-- 2) Dártelo a ti (después de crear tu cuenta)
update public.perfiles set rol = 'super', activo = true where correo = 'tu-correo@ejemplo.com';
```

---

## 8. Configurar la operación (como superusuario)

1. **Admin → Centros de costo → Nuevo centro:** crea los centros reales (por ejemplo `CC-101 Ventas Antioquia`). Sin centros, los vendedores no pueden registrar gastos.
2. Pide a cada vendedor y al auxiliar contable que **creen su cuenta** desde el enlace de la app (**Crear cuenta**). Les queda el aviso «cuenta creada, el administrador debe aprobarla».
3. En **Admin → Usuarios** verás **«N cuentas esperan tu aprobación»** (y un número rojo en la pestaña Admin):
   - Pulsa **Aprobar**.
   - Toca el nombre para asignar **centro de costo** (vendedores) o cambiar el **rol** (auxiliar contable o superusuario).
4. Contraseña olvidada de alguien: **Admin → Usuarios → Cambiar contraseña** (puedes generar una segura y entregársela por un canal privado).
5. **Admin → Actividad:** muestra quién hizo qué, desde qué equipo (sistema y navegador), IP, fecha y hora, con filtros por usuario, acción y fechas.

---

## 9. Prueba completa antes de usarla (10 minutos)

1. Con otro navegador (o una ventana de incógnito) crea una cuenta de vendedor de prueba. Apruébala, asígnale centro y cédula.
2. Como vendedor: registra un gasto con foto y verifica que diga **«Enviado correctamente a contabilidad»**.
3. Como superusuario, abre **Todos**: debes ver el gasto, con foto y ubicación. En **Actividad** debe aparecer el registro con el equipo y la IP.
4. Crea otra cuenta, apruébala y conviértela en **Auxiliar contable** (Admin → Usuarios → nombre → Rol). Como auxiliar: **dar de alta** el gasto y **exportar a Excel**. El vendedor debe ver el gasto como *Dado de alta* y no poder editarlo.
5. Prueba **sin internet**: pon el celular en modo avión, registra un gasto y comprueba que queda como «Por enviar»; al volver la conexión se envía solo.

Cuando todo funcione, borra las cuentas y gastos de prueba (cambia su estado a inactivo en Admin → Usuarios; los gastos no se borran por diseño, para no perder la trazabilidad).

---

## 10. Instalar en el celular

- **Android (Chrome):** abre el enlace → botón **«Instalar la app en mi celular»** (o menú ⋮ → *Instalar aplicación*).
- **iPhone (Safari):** abre el enlace en **Safari** → **Compartir** → **Agregar a pantalla de inicio**.

La primera vez la app pide permiso de **ubicación** (y de cámara al tomar la foto). Hay que **aceptarlo una sola vez**: ningún navegador permite saltarse ese aviso; después queda automático.

---

## 11. Mantenimiento

| Tema | Qué hacer |
|---|---|
| **Pausa por inactividad (plan gratis)** | Si nadie usa el proyecto por 7 días, Supabase lo pausa. Entra al Dashboard y pulsa **Restore project**. Para uso real continuo conviene el plan Pro. |
| **Respaldos** | El plan gratis no incluye respaldos automáticos. Exporta periódicamente desde la app (Excel) y, en *Table Editor*, descarga las tablas como CSV. |
| **Actualizar la app** | Sube los archivos nuevos a GitHub. Los celulares la actualizan al abrirla (puede requerir cerrarla y abrirla dos veces). |
| **Cambiar a «cuentas sin aprobación»** | En `schema.sql` cambia `aprobar_nuevos constant boolean := true;` a `false` y ejecuta el SQL de nuevo. No es recomendable. |
| **Olvidaste tu contraseña de superusuario** | *Authentication → Users →* tu usuario → **Send password recovery**, o define una nueva con SQL: `update auth.users set encrypted_password = crypt('NuevaClave123', gen_salt('bf')) where email = 'tu-correo@ejemplo.com';` |
| **Seguridad** | No pegues la clave `service_role` en ningún lado. Revisa en *Table Editor* que todas las tablas tengan *RLS enabled*. Usa contraseñas largas para el superusuario. |

---

## 12. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| «Falta conectar la base de datos» | `config.js` sin claves o mal pegadas | Repite el paso 5; recarga con Ctrl + F5. |
| «Correo o contraseña incorrectos» al crear la cuenta e ingresar | Se dejó activada la confirmación de correo | Paso 3: *Confirm email* en OFF; borra el usuario en *Authentication → Users* y créalo de nuevo. |
| «La contraseña es muy débil» | Menos de 6 caracteres o regla más estricta en Supabase | Usa 8 o más con letras y números. |
| «Tu cuenta está pendiente de aprobación» | Falta que el superusuario la apruebe | Admin → Usuarios → Aprobar. |
| Un vendedor no puede enviar gastos | No tiene centro de costo o no hay centros creados | Admin → Centros (crear) y Admin → Usuarios (asignar). |
| «No tienes permiso para esta acción» | Rol incorrecto o SQL incompleto | Revisa el rol del usuario; vuelve a ejecutar `schema.sql` completo. |
| La app no abre sin internet la primera vez | Aún no se había visitado con conexión | Ábrela una vez con internet; luego funciona sin conexión. |
| No aparece la ubicación | Permiso denegado en el navegador | Ajustes del navegador → Permisos del sitio → Ubicación → Permitir. |
| La actividad no muestra la IP | Solo la registra el servidor; llegaron eventos antiguos | Las acciones nuevas sí la traen. |
| Cambié `config.js` y no cambia nada | Caché del navegador | Ctrl + F5 o cierra y abre la app. |

---

## Qué sigue siendo una limitación

- Las notificaciones son **dentro de la app** (se revisan cada 15 segundos), no notificaciones push con la app cerrada.
- El **dictado por voz** depende del navegador y requiere internet; en iPhone es poco fiable.
- El «equipo» que ve el superusuario es el sistema + navegador + un identificador que genera cada celular: sirve para rastrear, pero un usuario experto podría falsearlo. La **IP** la registra el servidor.
- Es una **PWA instalable**, no un archivo APK de tienda.
