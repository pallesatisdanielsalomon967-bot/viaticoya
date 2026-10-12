/*
 * app.js — Pantallas de ViaticoYa y su comportamiento según el rol.
 * Las reglas (permisos, validación, totales, Excel) viven en logica.js; los datos en datos.js.
 */
"use strict";

const E = {
  usuario: null, gastos: [], centros: [], usuarios: [], notifs: [], pendientes: [],
  desconectado: false, ultimoRefresco: null, vistas: new Set(), primeraCarga: true,
  filtros: { todos: {}, exportar: { estado: "alta" }, mis: "", actividad: {} }, temporizador: null, objetoUrls: [],
  ubi: null,            // última ubicación conocida { lat, lng, precisionM, en }
  limite: {},           // cuántas filas se muestran por lista ("Mostrar más")
  riesgo: new Map(),    // alertas calculadas por gasto (se borra al recargar datos)
  instalar: null        // evento beforeinstallprompt, si el navegador permite instalar
};

const PAGINA = 40;
const hoyTexto = () => fechaDeHoy();
const nombreCat = (id) => buscarCategoria(id)?.nombre ?? id;
const emojiCat = (id) => buscarCategoria(id)?.emoji ?? "📦";
const centroDe = (id) => E.centros.find((c) => c.id === id);
const nombreCentro = (id) => { const c = centroDe(id); return c ? `${c.codigo} · ${c.nombre}` : "(sin centro)"; };
const hayConexion = () => navigator.onLine !== false;

const ES_ESTADO_CHIP = { pendiente: "chip-aviso", enviado: "chip-info", alta: "chip-ok", rechazado: "chip-error" };
const esPendiente = (x) => x.rol === "vendedor" && !x.activo;
const chipEstado = (estado) => h("span", { class: `chip ${ES_ESTADO_CHIP[estado] ?? ""}` }, `${ESTADOS[estado]?.icono ?? ""} ${ESTADOS[estado]?.texto ?? estado}`);

function mensajeDe(e) {
  if (e?.codigo === "sin_conexion") return "No hay internet. Inténtalo cuando vuelva la conexión.";
  return e?.message || "Ocurrió un error inesperado.";
}

// ============================================================
// Datos: cargar, guardar copia local y avisar de novedades
// ============================================================

async function cargar({ sinAvisos = false } = {}) {
  const u = E.usuario;
  if (!u) return;
  E.pendientes = u.rol === "auxiliar" ? [] : await Cola.pendientes(u.id);
  const claves = (n) => `${n}:${u.id}`;
  try {
    const [gastos, centros, notifs] = await Promise.all([Datos.listarGastos(), Datos.listarCentros(), Datos.listarNotificaciones()]);
    E.gastos = gastos; E.centros = centros; E.notifs = notifs; E.riesgo.clear();
    E.usuarios = esContable(u) ? await Datos.listarUsuarios() : [];
    E.desconectado = false;
    E.ultimoRefresco = new Date();
    copiaGuardar(claves("gastos"), gastos); copiaGuardar(claves("centros"), centros); copiaGuardar(claves("usuarios"), E.usuarios);
    copiaGuardar(claves("notifs"), notifs);
    avisarNovedades(sinAvisos);
  } catch (e) {
    if (e.codigo === "sesion") { await cerrarSesion(true); aviso("Tu sesión venció. Ingresa de nuevo.", "error"); return; }
    E.desconectado = true;
    const [g, c, us, n] = await Promise.all(["gastos", "centros", "usuarios", "notifs"].map((k) => copiaLeer(claves(k))));
    if (g) E.gastos = g; if (c) E.centros = c; if (us) E.usuarios = us; if (n) E.notifs = n;
    if (e.codigo !== "sin_conexion") aviso(mensajeDe(e), "error");
  }
  pintarBarra();
}

function avisarNovedades(sinAvisos) {
  for (const n of E.notifs) {
    if (E.vistas.has(n.id)) continue;
    E.vistas.add(n.id);
    if (!E.primeraCarga && !sinAvisos && !n.leida) aviso(n.texto, n.tipo === "rechazado" ? "error" : "ok", 9000);
  }
  E.primeraCarga = false;
}

/** Pinta primero lo último que se guardó en el celular (arranque inmediato) mientras llega lo nuevo del servidor. */
async function cargarDesdeCopia() {
  const u = E.usuario;
  const [g, c, us, n] = await Promise.all(["gastos", "centros", "usuarios", "notifs"].map((k) => copiaLeer(`${k}:${u.id}`)));
  if (!g && !c) return false;
  E.gastos = g ?? []; E.centros = c ?? []; E.usuarios = us ?? []; E.notifs = n ?? []; E.riesgo.clear();
  for (const x of E.notifs) E.vistas.add(x.id);
  E.pendientes = u.rol === "auxiliar" ? [] : await Cola.pendientes(u.id);
  return true;
}

async function sincronizar({ silencioso = false } = {}) {
  const u = E.usuario;
  if (!u || u.rol === "auxiliar") return null;
  if (!hayConexion()) { if (!silencioso) aviso("Sin internet: tus gastos siguen guardados en el celular.", "info"); return null; }
  const r = await Cola.sincronizar(u.id);
  if (r.sesion) { await cerrarSesion(true); aviso("Tu sesión venció. Ingresa de nuevo para enviar tus gastos.", "error"); return r; }
  if (r.enviados.length) aviso(r.enviados.length === 1 ? "Enviado correctamente a contabilidad." : `${r.enviados.length} gastos enviados correctamente a contabilidad.`, "ok");
  for (const f of r.fallidos) aviso(`No se pudo enviar un gasto: ${f.error}`, "error", 10000);
  if (r.enviados.length || r.fallidos.length || !silencioso) { await cargar({ sinAvisos: true }); render(); }
  return r;
}

// ============================================================
// Barra superior, navegación y rutas
// ============================================================

function pintarBarra() {
  const u = E.usuario;
  if (!u) return;
  const pend = E.pendientes.filter((p) => !p.error).length;
  const chip = $("#chip-red");
  if (!hayConexion() || E.desconectado) { chip.className = "chip chip-aviso"; chip.textContent = `Sin internet${pend ? ` · ${pend} por enviar` : ""}`; }
  else if (pend) { chip.className = "chip chip-aviso"; chip.textContent = `${pend} por enviar`; }
  else { chip.className = "chip chip-ok"; chip.textContent = "En línea"; }
  const sinLeer = E.notifs.filter((n) => !n.leida).length;
  const c = $("#campana-n");
  c.hidden = sinLeer === 0; c.textContent = String(sinLeer);
  $("#btn-campana").setAttribute("aria-label", sinLeer ? `Notificaciones, ${sinLeer} sin leer` : "Notificaciones");
  $("#btn-perfil").textContent = iniciales(u.nombre);
  pintarNav();
}

function seccionesDe(u) {
  if (u.rol === "vendedor") return [["registrar", "Registrar", "➕"], ["mis-gastos", "Mis gastos", "🧾"]];
  const base = [["tablero", "Tablero", "📊"], ["revisar", "Por dar de alta", "✅"], ["todos", "Todos", "🗂️"], ["exportar", "Exportar", "📥"]];
  return u.rol === "super" ? [...base, ["admin", "Admin", "⚙️"]] : base;
}

function pintarNav() {
  const u = E.usuario, ruta = rutaActual().vista;
  const nav = $("#nav");
  nav.replaceChildren(...seccionesDe(u).map(([id, texto, ico]) => {
    let n = 0;
    if (id === "revisar") n = E.gastos.filter((g) => g.estado === "enviado").length;
    if (id === "mis-gastos") n = E.pendientes.length;
    if (id === "admin") n = E.usuarios.filter(esPendiente).length;
    return h("a", { href: `#/${id}`, "aria-current": ruta === id ? "page" : null }, h("span", { class: "ico", "aria-hidden": "true" }, ico), texto, n ? h("span", { class: "insignia" }, String(n)) : null);
  }));
}

function rutaActual() {
  const partes = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { vista: partes[0] ?? "", arg: partes[1] ?? "" };
}

function vistaInicial(u) { return u.rol === "vendedor" ? "registrar" : "tablero"; }

function render() {
  const u = E.usuario;
  if (!u) return;
  let { vista, arg } = rutaActual();
  const permitidas = seccionesDe(u).map((s) => s[0]);
  if (u.rol === "super") permitidas.push("registrar");
  if (!permitidas.includes(vista)) { location.replace(`#/${vistaInicial(u)}`); return; }
  limpiarUrls();
  const main = $("#contenido");
  main.replaceChildren();
  if (E.cargando) { main.append(...[1, 2, 3, 4].map(() => h("div", { class: "esqueleto", "aria-hidden": "true" })), h("p", { class: "sr-solo", role: "status" }, "Cargando…")); pintarBarra(); return; }
  const f = { registrar: vistaRegistrar, "mis-gastos": vistaMisGastos, tablero: vistaTablero, revisar: vistaRevisar, todos: vistaTodos, exportar: vistaExportar, admin: vistaAdmin }[vista];
  f(main, arg);
  pintarBarra();
}

function limpiarUrls() { for (const u of E.objetoUrls) URL.revokeObjectURL(u); E.objetoUrls = []; }
function urlDeBlob(blob) { const u = URL.createObjectURL(blob); E.objetoUrls.push(u); return u; }

window.addEventListener("hashchange", () => { if (E.usuario) { render(); $("#contenido").focus({ preventScroll: true }); window.scrollTo(0, 0); } });

// ============================================================
// Inicio de sesión
// ============================================================

function mostrarLogin() {
  E.usuario = null;
  clearInterval(E.temporizador);
  $("#vista-app").hidden = true;
  $("#vista-login").hidden = false;
  $("#login-formularios").hidden = false; $("#login-espera").hidden = true;
  $("#login-error").hidden = true; $("#reg-msg").hidden = true;
  $("#form-login").reset(); $("#form-registro").reset();
  elegirPestana("entrar");
  pintarInstalar();
  if (location.hash) history.replaceState(null, "", location.pathname);
}

async function entrar(usuario, { bienvenida = true } = {}) {
  E.usuario = usuario;
  E.primeraCarga = true; E.vistas = new Set();
  $("#vista-login").hidden = true;
  $("#vista-app").hidden = false;
  if (!seccionesDe(usuario).some((s) => s[0] === rutaActual().vista)) location.hash = `#/${vistaInicial(usuario)}`;
  const conCopia = await cargarDesdeCopia();
  E.cargando = !conCopia;
  render();
  if (puedeRegistrar(usuario)) actualizarUbicacion();       // el navegador pregunta una sola vez; luego queda lista para cada gasto
  await cargar({ sinAvisos: true });
  E.cargando = false;
  render();
  if (usuario.rol !== "auxiliar") sincronizar({ silencioso: true });
  clearInterval(E.temporizador);
  E.temporizador = setInterval(refrescoPeriodico, CONFIG.refrescoMs || 15000);
  if (bienvenida) aviso(`Hola, ${usuario.nombre.split(" ")[0]}. Ingresaste como ${ROLES[usuario.rol].toLowerCase()}.`, "info", 3500);
}

async function refrescoPeriodico() {
  if (!E.usuario || document.hidden || !hayConexion()) return;
  if (document.querySelector("dialog[open]")) { await cargar(); pintarBarra(); return; }
  const antes = JSON.stringify([E.gastos.length, E.gastos.map((g) => g.estado)]);
  await sincronizar({ silencioso: true });
  await cargar();
  const despues = JSON.stringify([E.gastos.length, E.gastos.map((g) => g.estado)]);
  if (antes !== despues && !esFormularioAbierto()) render();
}
const esFormularioAbierto = () => rutaActual().vista === "registrar";

async function cerrarSesion(forzado = false) {
  clearInterval(E.temporizador);
  try { await Datos.cerrarSesion(); } catch { /* sin conexión: se cierra igual */ }
  for (const d of $$("dialog[open]")) d.close();
  $("#avisos").replaceChildren();
  mostrarLogin();
  E.gastos = []; E.centros = []; E.usuarios = []; E.notifs = []; E.pendientes = []; E.ubi = null; E.riesgo.clear(); E.limite = {};
  return forzado;
}

$("#form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("#login-error"), boton = $("#login-enviar");
  err.hidden = true;
  const correo = $("#login-correo").value.trim(), clave = $("#login-clave").value;
  if (!correo || !clave) { err.textContent = "Escribe tu correo y tu contraseña."; err.hidden = false; return; }
  boton.disabled = true; boton.textContent = "Ingresando…";
  try {
    const u = await Datos.iniciarSesion(correo, clave);
    await entrar(u);
  } catch (e) {
    err.textContent = e.codigo === "sin_conexion" ? "Para ingresar por primera vez necesitas internet." : mensajeDe(e);
    err.hidden = false;
  } finally { boton.disabled = false; boton.textContent = "Ingresar"; }
});

function elegirPestana(cual) {
  const entrar_ = cual === "entrar";
  $("#tab-entrar").setAttribute("aria-selected", String(entrar_)); $("#tab-crear").setAttribute("aria-selected", String(!entrar_));
  $("#form-login").hidden = !entrar_; $("#form-registro").hidden = entrar_;
}
function mostrarEspera(texto) {
  $("#espera-texto").textContent = texto;
  $("#login-formularios").hidden = true; $("#login-espera").hidden = false;
  $("#login-espera").scrollIntoView({ block: "center" });
}
$("#espera-volver").addEventListener("click", () => { $("#login-formularios").hidden = false; $("#login-espera").hidden = true; elegirPestana("entrar"); $("#login-clave").focus(); });

/** Agrega el botón «Mostrar/Ocultar» a un campo de contraseña. */
function conOjo(input) {
  const caja = h("div", { class: "clave-caja" });
  input.replaceWith(caja);
  const boton = h("button", { class: "ojo", type: "button", "aria-label": "Mostrar contraseña", "aria-pressed": "false" }, "Mostrar");
  boton.addEventListener("click", () => {
    const ver = input.type === "password";
    input.type = ver ? "text" : "password";
    boton.textContent = ver ? "Ocultar" : "Mostrar"; boton.setAttribute("aria-pressed", String(ver)); boton.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
  });
  caja.append(input, boton);
}
["login-clave", "reg-clave", "reg-clave2"].forEach((id) => conOjo($(`#${id}`)));

$("#tab-entrar").addEventListener("click", () => elegirPestana("entrar"));
$("#tab-crear").addEventListener("click", () => { elegirPestana("crear"); $("#reg-nombre").focus(); });
$("#lista-ciudades-reg").replaceChildren(...CIUDADES.map((c) => h("option", { value: c })));

$("#form-registro").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("#reg-msg"), boton = $("#reg-enviar");
  const mostrar = (t) => { msg.textContent = t; msg.hidden = false; };
  msg.hidden = true;
  const d = { nombre: $("#reg-nombre").value, correo: $("#reg-correo").value, cedula: $("#reg-cedula").value, ciudad: $("#reg-ciudad").value, clave: $("#reg-clave").value };
  if (d.clave !== $("#reg-clave2").value) return mostrar("Las dos contraseñas no coinciden.");
  if (!$("#reg-acepto").checked) return mostrar("Debes autorizar el tratamiento de tus datos para crear la cuenta.");
  boton.disabled = true; boton.textContent = "Creando…";
  try {
    const r = await Datos.registrar(d);
    if (r.confirmarCorreo) {
      $("#login-correo").value = d.correo.trim();
      mostrarEspera("Te enviamos un correo para confirmar tu cuenta. Después de confirmarlo, el administrador debe aprobarla y podrás ingresar con tu correo y tu contraseña.");
      return;
    }
    try {
      const u = await Datos.iniciarSesion(d.correo, d.clave);
      await entrar(u);
    } catch (e) {
      if (e.codigo !== "pendiente") throw e;
      $("#login-correo").value = d.correo.trim();
      mostrarEspera("El administrador debe aprobarla antes de que puedas ingresar. Cuando lo haga, entra con tu correo y tu contraseña.");
    }
  } catch (e) { mostrar(e.codigo === "sin_conexion" ? "Para crear tu cuenta necesitas internet." : mensajeDe(e)); }
  finally { boton.disabled = false; boton.textContent = "Crear cuenta"; }
});

// ---------- instalar como app ----------
const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const yaInstalada = () => (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); E.instalar = e; pintarInstalar(); });
window.addEventListener("appinstalled", () => { E.instalar = null; pintarInstalar(); aviso("ViaticoYa quedó instalada en tu celular.", "ok"); });

function pintarInstalar() {
  const visible = !yaInstalada() && (!!E.instalar || esIOS() || /Android/.test(navigator.userAgent));
  $("#login-instalar").hidden = !visible;
}
async function instalarApp() {
  if (E.instalar) {
    E.instalar.prompt();
    const r = await E.instalar.userChoice.catch(() => null);
    if (r?.outcome === "accepted") E.instalar = null;
    pintarInstalar();
    return;
  }
  const ios = esIOS();
  $("#instalar-cuerpo").replaceChildren(
    h("p", {}, ios ? "En iPhone y iPad se instala desde Safari:" : "Si el navegador no muestra la ventana de instalación, hazlo desde su menú:"),
    h("ol", { class: "pasos" }, (ios
      ? ["Abre esta página en **Safari** (no en Chrome ni dentro de otra app).", "Toca el botón **Compartir** (el cuadrado con la flecha hacia arriba).", "Elige **Agregar a pantalla de inicio**.", "Toca **Agregar**. Ya la abres como cualquier app."]
      : ["Abre esta página en **Chrome**.", "Toca el menú **⋮** (arriba a la derecha).", "Elige **Instalar aplicación** o **Agregar a pantalla de inicio**.", "Confirma. Aparece el ícono de ViaticoYa en tu celular."]).map((t) => h("li", {}, ...t.split("**").map((x, i) => (i % 2 ? h("b", { text: x }) : x))))),
    h("p", { class: "ayuda" }, "Instalada, abre más rápido, funciona sin internet y envía los gastos pendientes cuando vuelve la conexión."));
  abrir($("#dlg-instalar"));
}
$("#btn-instalar").addEventListener("click", instalarApp);

// ============================================================
// Notificaciones y cuenta
// ============================================================

$("#btn-refrescar").addEventListener("click", async (ev) => {
  const b = ev.currentTarget;
  if (b.classList.contains("girando")) return;
  if (!hayConexion()) { aviso("Sin internet: se muestra la última copia guardada.", "info", 3000); return; }
  b.classList.add("girando");
  try { await sincronizar({ silencioso: true }); await cargar(); if (!esFormularioAbierto()) render(); aviso("Información actualizada.", "info", 1800); }
  finally { b.classList.remove("girando"); }
});

$("#btn-campana").addEventListener("click", async () => {
  const lista = $("#notif-lista");
  const pintar = () => lista.replaceChildren(...(E.notifs.length ? E.notifs.map((n) => h("div", { class: `notif ${n.leida ? "" : "nueva"}` },
    h("span", { "aria-hidden": "true" }, { alta_ok: "✅", alta: "🔒", enviado: "📤", rechazado: "↩️", nuevo: "🔔", usuario_nuevo: "🆕" }[n.tipo] ?? "🔔"),
    h("div", {}, n.texto, h("time", { datetime: n.creada }, formatearFechaHora(n.creada))))) : [h("p", { class: "vacio" }, "Aún no tienes notificaciones.")]));
  pintar();
  abrir($("#dlg-notif"));
  const ids = E.notifs.filter((n) => !n.leida).map((n) => n.id);
  if (ids.length && hayConexion()) {
    try { await Datos.marcarLeidas(ids); for (const n of E.notifs) n.leida = true; pintarBarra(); } catch { /* se marcará la próxima vez */ }
  }
});

$("#btn-perfil").addEventListener("click", () => {
  const u = E.usuario;
  const filas = [["Nombre", u.nombre], ["Correo", u.correo], ["Rol", ROLES[u.rol]]];
  if (u.rol === "vendedor") filas.push(["Cédula", u.cedula], ["Centro de costo", nombreCentro(u.centroId)]);
  filas.push(["Este equipo", Equipo.info().nombre]);
  filas.push(["Conexión", hayConexion() && !E.desconectado ? "En línea" : "Sin internet (se usa la última copia guardada)"]);
  filas.push(["Última actualización", E.ultimoRefresco ? formatearFechaHora(E.ultimoRefresco.toISOString()) : "—"]);
  const cuerpo = $("#perfil-cuerpo");
  cuerpo.replaceChildren(...[h("dl", {}, filas.map(([k, v]) => h("div", { class: "dato" }, h("dt", { text: k }), h("dd", { text: v })))),
    u.rol !== "auxiliar" ? h("p", { class: "ayuda" }, `Gastos guardados sin enviar: ${E.pendientes.length}.`) : null,
    h("div", { class: "fila envolver" },
      h("button", { class: "boton chico", type: "button", id: "btn-actualizar" }, "Actualizar ahora"),
      h("button", { class: "boton chico", type: "button", id: "btn-mi-clave" }, "Cambiar mi contraseña"),
      !yaInstalada() ? h("button", { class: "boton chico", type: "button", id: "btn-instalar-perfil" }, "📲 Instalar la app") : null)].filter(Boolean));
  $("#btn-actualizar").addEventListener("click", async () => { await sincronizar({ silencioso: true }); await cargar(); render(); aviso("Información actualizada.", "info", 2500); cerrar($("#dlg-perfil")); });
  $("#btn-mi-clave").addEventListener("click", () => { cerrar($("#dlg-perfil")); abrirMiClave(); });
  $("#btn-instalar-perfil")?.addEventListener("click", () => { cerrar($("#dlg-perfil")); instalarApp(); });
  abrir($("#dlg-perfil"));
});

/** Cambia la contraseña propia (pide la actual). */
function abrirMiClave() {
  abrirClave({
    titulo: "Cambiar mi contraseña", pideActual: true,
    guardar: async (actual, nueva) => { await Datos.cambiarMiClave(actual, nueva); aviso("Contraseña actualizada.", "ok"); }
  });
}

function generarClave() {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => letras[b % letras.length]).join("");
}

/** Diálogo común para contraseñas: la propia (con la actual) o la de otro usuario (solo superusuario, con «Generar»). */
function abrirClave({ titulo: t, pideActual = false, ayuda = "", guardar }) {
  $("#clave-titulo").textContent = t;
  const nueva = h("input", { id: "clave-nueva", type: pideActual ? "password" : "text", autocomplete: "new-password", autocapitalize: "none", spellcheck: "false" });
  const campos = [
    ayuda ? h("p", { class: "suave", text: ayuda }) : null,
    pideActual ? h("div", {}, h("label", { for: "clave-actual", text: "Contraseña actual" }), h("input", { id: "clave-actual", type: "password", autocomplete: "current-password" })) : null,
    h("div", {}, h("label", { for: "clave-nueva", text: "Contraseña nueva (mínimo 6)" }), nueva),
    pideActual ? h("div", {}, h("label", { for: "clave-nueva2", text: "Repite la contraseña nueva" }), h("input", { id: "clave-nueva2", type: "password", autocomplete: "new-password" })) : h("button", { class: "boton chico", type: "button", id: "btn-generar-clave", onclick: () => { nueva.value = generarClave(); nueva.focus(); } }, "Generar una segura"),
    h("p", { class: "error", id: "clave-error", role: "alert", hidden: true })
  ].filter(Boolean);
  $("#clave-campos").replaceChildren(...campos);
  $("#form-clave").onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $("#clave-error"); err.hidden = true;
    try {
      if (String(nueva.value).length < 6) throw new Error("La contraseña debe tener mínimo 6 caracteres.");
      if (pideActual && nueva.value !== $("#clave-nueva2").value) throw new Error("Las dos contraseñas nuevas no coinciden.");
      await guardar(pideActual ? $("#clave-actual").value : null, nueva.value);
      cerrar($("#dlg-clave"));
      await cargar({ sinAvisos: true }); render();
    } catch (e) { err.textContent = mensajeDe(e); err.hidden = false; }
  };
  abrir($("#dlg-clave"));
  (pideActual ? $("#clave-actual") : nueva).focus();
}

$("#btn-salir").addEventListener("click", async () => {
  const pend = E.pendientes.length;
  if (pend && !(await confirmar(`Tienes ${pend} gasto(s) guardado(s) sin enviar. Quedan en este celular y se envían cuando vuelvas a ingresar con esta cuenta. ¿Cerrar sesión?`, { si: "Cerrar sesión" }))) return;
  await cerrarSesion();
});

window.addEventListener("online", () => { pintarBarra(); if (E.usuario) { aviso("Volvió la conexión.", "info", 2500); sincronizar({ silencioso: true }).then(() => cargar()).then(() => { if (!esFormularioAbierto()) render(); }); } });
window.addEventListener("offline", () => { pintarBarra(); if (E.usuario) aviso("Sin internet. Puedes seguir registrando: se envía cuando vuelva.", "info", 5000); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && E.usuario) refrescoPeriodico(); });

// ============================================================
// Piezas comunes de las vistas
// ============================================================

function titulo(texto, derecha) { return h("div", { class: "titulo-seccion" }, h("h2", { text: texto }), derecha ?? null); }
function vacio(texto) { return h("p", { class: "vacio" }, texto); }

/** Alertas de un gasto (solo para contabilidad). Se calculan una vez por carga de datos. */
function riesgoDe(g) {
  if (!esContable(E.usuario) || g.estado === "pendiente") return { alertas: [], nivel: "ninguno" };
  let r = E.riesgo.get(g.id);
  if (!r) { r = riesgoGasto(g, E.gastos, hoyTexto()); E.riesgo.set(g.id, r); }
  return r;
}
const chipRiesgo = (nivel) => nivel === "alto" ? h("span", { class: "chip chip-error" }, "⚠ Revisar a fondo") : nivel === "medio" ? h("span", { class: "chip chip-aviso" }, "Atención") : null;

/** Lista con «Mostrar más» para que siga ágil con cientos de gastos. */
function etiquetaDia(f) {
  const hoy = hoyTexto();
  return f === hoy ? "Hoy" : f === sumarDias(hoy, -1) ? "Ayer" : formatearFecha(f);
}
function listaPaginada(clave, lista, fila, { porDia = false } = {}) {
  const n = E.limite[clave] ?? PAGINA;
  const items = [];
  const visibles = lista.slice(0, n);
  let dia = null;
  for (const g of visibles) {
    if (porDia && g.fecha !== dia) {
      dia = g.fecha;
      items.push(h("li", { class: "dia-cab", "aria-hidden": "true" }, h("span", { text: etiquetaDia(dia) }), h("span", { class: "dia-total", text: formatearDinero(sumar(lista.filter((x) => x.fecha === dia))) })));
    }
    items.push(fila(g));
  }
  const caja = h("div", {}, h("ul", { class: "lista" }, items));
  if (lista.length > n) caja.append(h("button", { class: "boton ancho", type: "button", onclick: () => { E.limite[clave] = n + PAGINA; render(); } }, `Mostrar más (${lista.length - n} restantes)`));
  return caja;
}

function filaGasto(g, { acciones = false } = {}) {
  const riesgo = riesgoDe(g);
  const boton = h("button", { class: `gasto e-${g.estado}`, type: "button", "aria-label": `${g.descripcion}, ${formatearDinero(g.monto)}, ${ESTADOS[g.estado]?.texto}`, onclick: () => abrirDetalle(g) },
    h("span", { class: "emoji", "aria-hidden": "true" }, emojiCat(g.categoria)),
    h("span", { class: "desc", text: g.descripcion }),
    h("span", { class: "monto", text: formatearDinero(g.monto) }),
    h("span", { class: "meta", text: [esContable(E.usuario) ? g.vendedorNombre : null, g.ciudad, formatearFecha(g.fecha)].filter(Boolean).join(" · ") }),
    h("span", { class: "estado" }, chipEstado(g.estado), chipRiesgo(riesgo.nivel)));
  const li = h("li", {}, boton);
  if (g.estado === "pendiente" && g.errorEnvio) li.append(h("p", { class: "error" }, `No se pudo enviar: ${g.errorEnvio}`));
  if (acciones && puedeDarAlta(E.usuario, g)) {
    li.append(h("div", { class: "fila envolver" }, h("button", { class: "boton verde chico", type: "button", onclick: () => accionAlta(g) }, "Dar de alta"), h("button", { class: "boton peligro chico", type: "button", onclick: () => accionRechazar(g) }, "Rechazar")));
  }
  return li;
}

/** Pide la ubicación al celular y la recuerda. La primera vez el navegador pregunta; si se permite, queda automática. */
async function actualizarUbicacion(esperaMs = 12000) {
  const r = await obtenerUbicacion(esperaMs);
  if (r.lat != null) E.ubi = { lat: r.lat, lng: r.lng, precisionM: r.precisionM, en: Date.now() };
  return r;
}

function gastosPropios(u) { return [...E.gastos.filter((g) => g.vendedorId === u.id), ...E.pendientes.map((p) => p.gasto)]; }

function gastosPendientesComoLista() {
  return E.pendientes.map((p) => ({ ...p.gasto, estado: "pendiente", errorEnvio: p.error || "" }));
}

function selectDe(id, etiqueta, opciones, valor = "") {
  const s = h("select", { id }, opciones.map(([v, t]) => h("option", { value: v, ...(v === valor ? { selected: true } : {}) }, t)));
  return h("div", {}, h("label", { for: id, text: etiqueta }), s);
}
function entradaDe(id, etiqueta, props = {}) { return h("div", {}, h("label", { for: id, text: etiqueta }), h("input", { id, ...props })); }

// ============================================================
// Vista: Registrar / editar un gasto
// ============================================================

function vistaRegistrar(main, idEdicion) {
  const u = E.usuario;
  if (!puedeRegistrar(u)) { main.append(vacio("Tu rol no registra gastos.")); return; }
  let previo = null, previoLocal = false;
  if (idEdicion) {
    const local = E.pendientes.find((p) => p.id === idEdicion);
    if (local) { previo = { ...local.gasto, estado: "pendiente" }; previoLocal = true; }
    else previo = E.gastos.find((g) => g.id === idEdicion) ?? null;
    if (!previo || (!previoLocal && !puedeEditar(u, previo)) || (previoLocal && previo.vendedorId !== u.id)) {
      main.append(titulo("No se puede editar"), vacio("Ese gasto no existe o ya no se puede modificar (por ejemplo, porque contabilidad ya lo dio de alta)."));
      return;
    }
  }
  const esEdicionAjena = !!previo && !previoLocal && previo.vendedorId !== u.id;   // solo el superusuario
  const reciente = E.ubi && Date.now() - E.ubi.en < 120000 ? { lat: E.ubi.lat, lng: E.ubi.lng, precisionM: E.ubi.precisionM } : null;
  const s = { foto: null, fotoPath: previo?.fotoPath ?? "", ubi: previo ? { lat: previo.lat, lng: previo.lng, precisionM: previo.precisionM, motivo: previo.ubicacionMotivo } : reciente, detener: null };
  const hist = gastosPropios(u);
  let ciudadTocada = !!previo, categoriaAuto = false, montoAuto = false;

  const centrosActivos = E.centros.filter((c) => c.activo || c.id === previo?.centroId);
  const ultimoCentro = ordenarPorFecha(hist)[0]?.centroId;
  const centroInicial = previo?.centroId ?? [ultimoCentro, u.centroId].find((id) => id && centrosActivos.some((c) => c.id === id)) ?? "";

  const frase = h("input", { id: "f-frase", type: "text", placeholder: "Ej: almuerzo con cliente 38 mil en Medellín", autocomplete: "off", "aria-describedby": "ayuda-frase" });
  const mic = h("button", { class: "boton principal mic", type: "button", id: "btn-mic", "aria-label": "Dictar con la voz" }, "🎤");
  const resumenFrase = h("p", { class: "ayuda", id: "ayuda-frase", "aria-live": "polite" }, Voz.disponible()
    ? "Toca el micrófono y di el gasto, o escríbelo. Revisa los campos antes de enviar."
    : "Este navegador no trae dictado. Escribe la frase, o usa el micrófono del teclado de tu celular.");

  const dictado = h("div", { class: "dictado" },
    h("label", { for: "f-frase", text: "Dicta o escribe el gasto" }),
    h("div", { class: "fila" }, frase, mic, h("button", { class: "boton chico", type: "button", id: "btn-aplicar" }, "Llenar")), resumenFrase);

  const fotoPrevia = h("img", { class: "foto-previa", alt: "Vista previa de la foto del recibo", hidden: true });
  const fotoTexto = h("p", { class: "ayuda", id: "foto-texto" }, "Desde $ 50.000 la foto es obligatoria.");
  const inputFoto = h("input", { id: "f-foto", type: "file", accept: "image/*", capture: "environment" });

  const chipUbi = h("span", { class: "chip", id: "chip-ubi", role: "status" });
  const btnUbi = h("button", { class: "boton chico", type: "button", id: "btn-ubi" }, "Obtener ubicación");
  const pintarUbi = () => {
    const ub = s.ubi;
    if (ub?.lat != null) { chipUbi.className = "chip chip-ok"; chipUbi.textContent = `📍 Ubicación automática${ub.precisionM ? ` (±${ub.precisionM} m)` : ""}`; btnUbi.textContent = "Actualizar ubicación"; }
    else { chipUbi.className = "chip chip-aviso"; chipUbi.textContent = `Sin ubicación${ub?.motivo ? `: ${ub.motivo}` : ""}`; btnUbi.textContent = "Obtener ubicación"; }
  };
  const ayudaUbi = h("p", { class: "ayuda", id: "ubi-ayuda", hidden: true }, "Para activarla: ajustes del navegador → Permisos del sitio → Ubicación → Permitir. Luego toca «Obtener ubicación».");
  const proponerCiudad = () => {
    if (ciudadTocada || s.ubi?.lat == null) return;
    const c = ciudadMasCercana(s.ubi.lat, s.ubi.lng);
    const campo = $("#f-ciudad");
    if (c && campo && campo.value !== c) { campo.value = c; sugCiudad.textContent = `Ciudad detectada por GPS: ${c}.`; }
  };
  const pedirUbi = async (esperaMs) => {
    chipUbi.className = "chip"; chipUbi.textContent = "Buscando ubicación…";
    const r = await actualizarUbicacion(esperaMs);
    s.ubi = r.lat != null ? { lat: r.lat, lng: r.lng, precisionM: r.precisionM } : { lat: null, lng: null, precisionM: null, motivo: r.motivo };
    pintarUbi();
    ayudaUbi.hidden = !/denegado/.test(s.ubi.motivo ?? "");
    proponerCiudad();
  };
  btnUbi.addEventListener("click", () => pedirUbi());
  pintarUbi();

  const error = h("p", { class: "error", id: "form-error", role: "alert", hidden: true });
  const enviar = h("button", { class: "boton principal ancho", type: "submit", id: "btn-enviar" }, esEdicionAjena ? "Guardar cambios" : previo?.estado === "rechazado" ? "Corregir y reenviar" : previo ? "Guardar y reenviar" : "Enviar a contabilidad");

  const frecuentes = previo ? [] : plantillasFrecuentes(hist, u.id, 4);
  const barraFrecuentes = frecuentes.length ? h("div", {}, h("p", { class: "ayuda", text: "Tus gastos frecuentes (toca uno para llenarlo):" }),
    h("div", { class: "plantillas" }, frecuentes.map((p) => h("button", { class: "plantilla", type: "button", "data-plantilla": p.descripcion, onclick: () => usarPlantilla(p) },
      `${emojiCat(p.categoria)} ${p.descripcion}`, h("small", { text: `${formatearDinero(p.monto)}${p.veces > 1 ? ` · ${p.veces} veces` : ""}` }))))) : null;
  const sugDesc = h("p", { class: "sugerencia", id: "sug-desc", "aria-live": "polite" });
  const sugMonto = h("p", { class: "sugerencia", id: "sug-monto", "aria-live": "polite" });
  const sugCiudad = h("p", { class: "sugerencia", id: "sug-ciudad", "aria-live": "polite" });

  const form = h("form", { id: "form-gasto", novalidate: true, autocomplete: "off" },
    barraFrecuentes,
    dictado,
    h("h3", { class: "seccion-form" }, "1 · Qué gastaste"),
    h("div", { class: "rejilla angosto" },
      selectDe("f-centro", "Centro de costo", [["", "Elige…"], ...centrosActivos.map((c) => [c.id, `${c.codigo} · ${c.nombre}`])], centroInicial),
      selectDe("f-categoria", "Categoría", [["", "Elige…"], ...CATEGORIAS.map((c) => [c.id, `${c.emoji} ${c.nombre}`])], previo?.categoria ?? "")),
    h("div", { class: "rejilla" },
      entradaDe("f-monto", "Valor total (COP)", { type: "text", inputmode: "numeric", value: previo ? String(previo.monto) : "", placeholder: "38000" }),
      entradaDe("f-iva", "IVA incluido (opcional)", { type: "text", inputmode: "numeric", value: previo?.iva ? String(previo.iva) : "", placeholder: "0" })),
    entradaDe("f-desc", "Descripción", { type: "text", maxlength: "80", value: previo?.descripcion ?? "", placeholder: "Almuerzo con cliente" }),
    h("div", { class: "rejilla" },
      entradaDe("f-fecha", "Fecha del gasto", { type: "date", max: hoyTexto(), value: previo?.fecha ?? hoyTexto() }),
      entradaDe("f-ciudad", "Ciudad", { type: "text", list: "lista-ciudades", value: previo?.ciudad ?? u.ciudad ?? "", placeholder: "Medellín" })),
    h("datalist", { id: "lista-ciudades" }, CIUDADES.map((c) => h("option", { value: c }))),
    h("h3", { class: "seccion-form" }, "2 · Factura (si la tienes)"),
    h("div", { class: "rejilla angosto" },
      entradaDe("f-nit", "NIT del proveedor", { type: "text", inputmode: "numeric", value: previo?.proveedorNit ?? "", placeholder: "900123456-7" }),
      entradaDe("f-factura", "N° de factura", { type: "text", maxlength: "30", value: previo?.facturaNumero ?? "", placeholder: "FE-2210" })),
    h("h3", { class: "seccion-form" }, "3 · Soporte y ubicación"),
    h("label", { for: "f-foto", text: "Foto de la factura o recibo" }), inputFoto, fotoTexto, fotoPrevia,
    h("div", { class: "ubi" }, chipUbi, btnUbi),
    ayudaUbi,
    h("p", { class: "ayuda" }, "La ubicación se toma automáticamente al registrar el gasto y la ve contabilidad."),
    h("div", { class: "barra-acciones" }, error, enviar));

  main.append(titulo(esEdicionAjena ? "Corregir gasto" : previo ? "Editar gasto" : "Registrar gasto",
    previo ? h("a", { class: "enlace", href: u.rol === "vendedor" ? "#/mis-gastos" : "#/todos" }, "Cancelar") : null));
  if (previo?.estado === "rechazado") main.append(h("p", { class: "motivo" }, `Contabilidad lo rechazó: ${previo.motivoRechazo}`));
  if (esEdicionAjena) main.append(h("p", { class: "ayuda" }, "Como superusuario puedes corregir este gasto. El cambio queda en la auditoría."));
  main.append(form);
  $("#f-desc").parentElement.append(sugDesc);
  $("#f-monto").parentElement.append(sugMonto);
  $("#f-ciudad").parentElement.append(sugCiudad);
  $("#f-ciudad").addEventListener("input", () => { ciudadTocada = true; sugCiudad.textContent = ""; });

  // ---- Predicción: aprende de tus gastos anteriores ----
  const monto0 = () => Number($("#f-monto").value) || 0;
  const pistaMonto = () => {
    if (!$("#f-monto")) return;
    const cat = $("#f-categoria").value, partes = [];
    const tipico = cat ? montoTipico(hist, u.id, cat) : null, tope = buscarCategoria(cat)?.tope;
    if (tipico) partes.push(`Lo habitual en ${nombreCat(cat)}: ${formatearDinero(tipico)}.`);
    if (tope) partes.push(`Tope diario: ${formatearDinero(tope)}.`);
    const m = monto0();
    if (tipico && m > tipico * 2.5 && m - tipico > 30000) partes.push(`⚠ Es ${(m / tipico).toFixed(1)} veces lo habitual: ¿sobra algún cero?`);
    sugMonto.textContent = partes.join(" ");
  };
  let esperaSug = null;
  const sugerirPorTexto = () => {
    if (!$("#f-desc")) return;                  // el formulario ya se cerró (se envió o se cambió de pantalla)
    const texto = $("#f-desc").value.trim();
    if (texto.length < 3) { sugDesc.textContent = ""; return; }
    const sg = sugerirDesdeHistorial(hist, u.id, texto);
    const cat = sg?.categoria ?? sugerirCategoria(texto);
    const campoCat = $("#f-categoria"), campoMonto = $("#f-monto"), campoNit = $("#f-nit");
    const notas = [];
    if (cat && (campoCat.value === "" || categoriaAuto)) { campoCat.value = cat; categoriaAuto = true; notas.push(nombreCat(cat)); }
    if (sg?.monto && (campoMonto.value === "" || montoAuto)) { campoMonto.value = String(sg.monto); montoAuto = true; notas.push(formatearDinero(sg.monto)); }
    if (sg?.nit && campoNit.value === "") { campoNit.value = sg.nit; notas.push(`NIT ${sg.nit}`); }
    sugDesc.textContent = notas.length ? `Sugerido ${sg ? "por tu historial" : "por la descripción"}: ${notas.join(" · ")}. Corrígelo si no es así.` : "";
    pistaMonto();
  };
  $("#f-desc").addEventListener("input", () => { clearTimeout(esperaSug); esperaSug = setTimeout(sugerirPorTexto, 250); });
  $("#f-categoria").addEventListener("change", () => { categoriaAuto = false; pistaMonto(); });
  $("#f-monto").addEventListener("input", () => { montoAuto = false; pistaMonto(); });
  const usarPlantilla = (p) => {
    $("#f-categoria").value = p.categoria; $("#f-desc").value = p.descripcion; $("#f-monto").value = String(p.monto ?? "");
    if (p.nit) $("#f-nit").value = p.nit;
    if (p.centroId && centrosActivos.some((c) => c.id === p.centroId)) $("#f-centro").value = p.centroId;
    if (!ciudadTocada && s.ubi?.lat != null && ciudadMasCercana(s.ubi.lat, s.ubi.lng)) { /* manda el GPS */ } else { $("#f-ciudad").value = p.ciudad || $("#f-ciudad").value; }
    categoriaAuto = false; montoAuto = false;
    sugDesc.textContent = "Llenado con tu gasto frecuente. Ajusta el valor si cambió.";
    pistaMonto();
    $("#f-foto").focus();
  };
  pistaMonto();

  // Foto previa del gasto que se edita
  if (s.fotoPath) {
    fotoTexto.textContent = "Ya hay una foto guardada. Elige otra solo si quieres reemplazarla.";
    Datos.obtenerFoto(s.fotoPath).then((b) => { if (b) { fotoPrevia.src = urlDeBlob(b); fotoPrevia.hidden = false; } }).catch(() => {});
  }

  inputFoto.addEventListener("change", async () => {
    const archivo = inputFoto.files?.[0];
    if (!archivo) return;
    fotoTexto.textContent = "Preparando la foto…";
    try {
      s.foto = await comprimirImagen(archivo);
      fotoPrevia.src = urlDeBlob(s.foto); fotoPrevia.hidden = false;
      fotoTexto.textContent = `Foto lista (${Math.max(1, Math.round(s.foto.size / 1024))} KB).`;
    } catch (e) { s.foto = null; fotoTexto.textContent = e.message; }
  });

  // Importes: se dejan solo dígitos
  for (const id of ["f-monto", "f-iva"]) {
    const campo = $(`#${id}`);
    campo.addEventListener("input", () => { const limpio = campo.value.replace(/[^\d]/g, ""); if (limpio !== campo.value) campo.value = limpio; });
  }

  // Dictado
  const aplicarFrase = (texto) => {
    const r = parsearDictado(texto, hoyTexto());
    const hechos = [];
    if (r.monto) { $("#f-monto").value = String(r.monto); hechos.push(formatearDinero(r.monto)); }
    if (r.categoria) { $("#f-categoria").value = r.categoria; hechos.push(nombreCat(r.categoria)); }
    if (r.ciudad) { $("#f-ciudad").value = r.ciudad; hechos.push(r.ciudad); }
    if (r.fecha) { $("#f-fecha").value = r.fecha; hechos.push(formatearFecha(r.fecha)); }
    if (r.descripcion) $("#f-desc").value = r.descripcion.slice(0, 80);
    resumenFrase.textContent = hechos.length ? `Entendí: ${hechos.join(" · ")}. Revisa y completa lo que falte.` : "No pude sacar datos de esa frase. Intenta con: «almuerzo 38 mil en Medellín».";
  };
  $("#btn-aplicar").addEventListener("click", () => { if (frase.value.trim()) aplicarFrase(frase.value); else frase.focus(); });
  frase.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#btn-aplicar").click(); } });
  mic.addEventListener("click", () => {
    if (s.detener) { s.detener(); return; }
    if (!Voz.disponible()) { resumenFrase.textContent = "Este navegador no trae dictado. Escribe la frase o usa el micrófono del teclado."; frase.focus(); return; }
    if (!hayConexion()) { resumenFrase.textContent = "El dictado necesita internet. Escribe los datos a mano."; return; }
    mic.classList.add("escuchando"); mic.setAttribute("aria-label", "Detener dictado"); resumenFrase.textContent = "Escuchando… habla ahora.";
    s.detener = Voz.escuchar({
      alTexto: (t) => { frase.value = t; aplicarFrase(t); },
      alError: (c) => { resumenFrase.textContent = c === "not-allowed" ? "No diste permiso al micrófono." : c === "no-speech" ? "No te escuché. Intenta de nuevo." : "El dictado falló. Escribe los datos a mano."; },
      alTerminar: () => { s.detener = null; mic.classList.remove("escuchando"); mic.setAttribute("aria-label", "Dictar con la voz"); }
    });
  });

  // Ubicación automática al abrir el formulario (sin pasos extra); si ya hay una reciente se usa al instante
  if (!previo) { if (s.ubi) proponerCiudad(); else pedirUbi(); }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const mostrar = (msg) => { error.textContent = msg; error.hidden = false; error.scrollIntoView({ block: "center" }); };
    error.hidden = true;
    if (!previo && s.ubi?.lat == null) await pedirUbi(4000);
    const datos = {
      id: previo?.id, centroId: $("#f-centro").value, categoria: $("#f-categoria").value, monto: $("#f-monto").value.trim(), iva: $("#f-iva").value.trim(),
      descripcion: $("#f-desc").value, fecha: $("#f-fecha").value, ciudad: $("#f-ciudad").value, proveedorNit: $("#f-nit").value, facturaNumero: $("#f-factura").value,
      lat: s.ubi?.lat ?? null, lng: s.ubi?.lng ?? null, precisionM: s.ubi?.precisionM ?? null, ubicacionMotivo: s.ubi?.motivo ?? "", fotoPath: s.fotoPath, creadoDispositivo: previo?.creadoDispositivo
    };
    const problema = validarGasto(datos, { centros: E.centros.filter((c) => c.activo || c.id === previo?.centroId), hoy: hoyTexto(), tieneFoto: esEdicionAjena || !!(s.foto || s.fotoPath) });
    if (problema && !(esEdicionAjena && /hace más de/.test(problema))) return mostrar(problema);

    enviar.disabled = true;
    try {
      if (esEdicionAjena) {
        await Datos.editarGasto(previo.id, { centroId: datos.centroId, categoria: datos.categoria, monto: Math.round(Number(datos.monto)), iva: datos.iva === "" ? 0 : Math.round(Number(datos.iva)), descripcion: datos.descripcion.trim(), fecha: datos.fecha, ciudad: datos.ciudad.trim(), proveedorNit: normalizarNit(datos.proveedorNit), facturaNumero: datos.facturaNumero.trim() });
        aviso("Cambios guardados. Quedaron en la auditoría.", "ok");
        await cargar({ sinAvisos: true }); location.hash = "#/todos"; return;
      }
      const gasto = crearGasto(datos, u);
      if (previo) gasto.estado = "enviado";
      const conocidos = [...E.gastos, ...E.pendientes.map((p) => p.gasto)];
      const dup = detectarDuplicado(conocidos, gasto);
      if (dup?.tipo === "factura") { enviar.disabled = false; return mostrar("Ya existe un gasto con ese NIT y número de factura. No se puede registrar dos veces."); }
      if (dup?.tipo === "parecido" && !(await confirmar(`Ya registraste un gasto del mismo valor, categoría y fecha («${dup.gasto.descripcion}»). ¿Es otro gasto distinto?`, { si: "Sí, es otro" }))) { enviar.disabled = false; return; }
      const tope = alertaTope(conocidos, gasto);
      if (tope && !(await confirmar(`${tope} Contabilidad lo verá resaltado. ¿Enviar de todos modos?`, { si: "Enviar" }))) { enviar.disabled = false; return; }

      await Cola.encolar(gasto, s.foto);
      E.pendientes = await Cola.pendientes(u.id);
      let mensajeFinal = null;
      if (hayConexion()) {
        const r = await Cola.sincronizar(u.id);
        if (r.enviados.some((x) => x.id === gasto.id)) mensajeFinal = ["Enviado correctamente a contabilidad.", "ok"];
        else if (r.fallidos.some((x) => x.id === gasto.id)) mensajeFinal = [`No se pudo enviar: ${r.fallidos.find((x) => x.id === gasto.id).error}`, "error"];
      }
      if (!mensajeFinal) mensajeFinal = ["Guardado en tu celular. Se enviará a contabilidad cuando haya internet.", "info"];
      aviso(mensajeFinal[0], mensajeFinal[1], 8000);
      await cargar({ sinAvisos: true });
      location.hash = "#/mis-gastos";
      render();
    } catch (e) {
      mostrar(mensajeDe(e));
      enviar.disabled = false;
    }
  });
}

// ============================================================
// Vista: Mis gastos (vendedor)
// ============================================================

function vistaMisGastos(main) {
  const u = E.usuario;
  const todos = ordenarPorFecha([...gastosPendientesComoLista(), ...E.gastos.filter((g) => g.vendedorId === u.id)]);
  const mes = mesDe(hoyTexto());
  const delMes = todos.filter((g) => g.estado !== "rechazado" && mesDe(g.fecha) === mes);
  const pend = E.pendientes.filter((p) => !p.error).length;
  const filtro = E.filtros.mis;
  const visibles = filtro ? todos.filter((g) => g.estado === filtro) : todos;

  main.append(titulo("Mis gastos"));
  main.append(h("div", { class: "cifras" },
    h("div", { class: "cifra" }, h("span", { class: "n", text: formatearDinero(sumar(delMes)) }), h("span", { class: "t", text: `Este mes · ${delMes.length} gastos` })),
    h("div", { class: "cifra verde" }, h("span", { class: "n", text: String(todos.filter((g) => g.estado === "alta").length) }), h("span", { class: "t", text: "Dados de alta" })),
    h("div", { class: "cifra" }, h("span", { class: "n", text: String(pend) }), h("span", { class: "t", text: "Por enviar" })),
    h("div", { class: "cifra rojo" }, h("span", { class: "n", text: String(todos.filter((g) => g.estado === "rechazado").length) }), h("span", { class: "t", text: "Rechazados" }))));

  const sel = h("select", { id: "mis-filtro", "aria-label": "Filtrar por estado" }, [["", "Todos los estados"], ["pendiente", "Por enviar"], ["enviado", "Enviados"], ["alta", "Dados de alta"], ["rechazado", "Rechazados"]].map(([v, t]) => h("option", { value: v, ...(v === filtro ? { selected: true } : {}) }, t)));
  sel.addEventListener("change", () => { E.filtros.mis = sel.value; render(); });
  main.append(h("div", { class: "fila entre envolver" }, sel, pend ? h("button", { class: "boton chico", type: "button", id: "btn-sync", onclick: async () => { await sincronizar(); } }, "Enviar ahora") : null));
  main.append(visibles.length ? listaPaginada(`mis${filtro}`, visibles, (g) => filaGasto(g), { porDia: true }) : vacio(todos.length ? "No hay gastos con ese estado." : "Aún no tienes gastos. Toca «Registrar» para crear el primero."));
}

// ============================================================
// Vistas de contabilidad: tablero, por dar de alta, todos
// ============================================================

function barrasDe(filas, max) {
  return h("ul", { class: "barras" }, filas.map((f) => {
    const li = h("li", {}, h("span", { text: `${f.nombre} · ${f.cantidad}` }), h("span", { class: "valor", text: formatearDinero(f.total) }), h("span", { class: "pista" }, h("span", { class: "relleno" })));
    li.querySelector(".relleno").style.setProperty("--p", String(max ? Math.max(2, Math.round((f.total / max) * 100)) : 0));
    return li;
  }));
}

function vistaTablero(main) {
  const r = resumenGeneral(E.gastos, hoyTexto());
  const vigentes = E.gastos.filter((g) => g.estado !== "rechazado");
  const porVend = totalesPor(vigentes, "vendedorId", (_, g) => g.vendedorNombre);
  const porCentro = totalesPor(vigentes, "centroId", (id) => nombreCentro(id));
  main.append(titulo("Tablero", h("span", { class: "suave pequeño", text: fechaLarga() })));
  main.append(h("div", { class: "cifras" },
    h("div", { class: "cifra" }, h("span", { class: "n", text: String(r.porAltaCantidad) }), h("span", { class: "t", text: `Por dar de alta · ${formatearDinero(r.porAltaTotal)}` })),
    h("div", { class: "cifra verde" }, h("span", { class: "n", text: formatearDinero(r.altaMesTotal) }), h("span", { class: "t", text: `Dados de alta este mes · ${r.altaMesCantidad}` })),
    h("div", { class: "cifra rojo" }, h("span", { class: "n", text: String(r.rechazados) }), h("span", { class: "t", text: "Rechazados" })),
    h("div", { class: "cifra" }, h("span", { class: "n", text: formatearDinero(r.vigentesTotal) }), h("span", { class: "t", text: "Total vigente" }))));
  const conAlerta = E.gastos.filter((g) => g.estado === "enviado" && ["medio", "alto"].includes(riesgoDe(g).nivel)).length;
  if (r.porAltaCantidad) main.append(h("a", { class: "boton principal", href: "#/revisar" }, `Revisar ${r.porAltaCantidad} gasto(s) pendiente(s)${conAlerta ? ` · ${conAlerta} con alertas` : ""}`));
  const pr = proyeccionMes(E.gastos, hoyTexto());
  main.append(h("div", { class: "proyeccion" }, h("p", { class: "suave pequeño", text: "Proyección del mes" }),
    h("p", { id: "proyeccion" }, h("b", { text: pr.proyectado != null ? formatearDinero(pr.proyectado) : formatearDinero(pr.acumulado) }),
      pr.proyectado != null ? ` al ritmo actual (llevas ${formatearDinero(pr.acumulado)} en ${pr.dia} de ${pr.diasMes} días).` : " acumulado; la proyección aparece desde el día 5.")));
  main.append(titulo("Por vendedor"), porVend.length ? h("div", { class: "tarjeta" }, barrasDe(porVend, porVend[0].total)) : vacio("Todavía no hay gastos."));
  main.append(titulo("Por centro de costo"), porCentro.length ? h("div", { class: "tarjeta" }, barrasDe(porCentro, porCentro[0].total)) : vacio("Todavía no hay gastos."));
}

function vistaRevisar(main) {
  const orden = { alto: 0, medio: 1, bajo: 2, ninguno: 3 };
  const lista = ordenarPorFecha(E.gastos.filter((g) => g.estado === "enviado")).sort((a, b) => orden[riesgoDe(a).nivel] - orden[riesgoDe(b).nivel]);
  const limpios = lista.filter((g) => riesgoDe(g).nivel === "ninguno" && puedeDarAlta(E.usuario, g));
  main.append(titulo("Por dar de alta", h("span", { class: "chip chip-info", text: `${lista.length} pendientes` })));
  if (lista.length) main.append(h("p", { class: "ayuda" }, "Primero van los que tienen alertas (valor atípico, ubicación lejana, sin soporte…). Las alertas orientan; la decisión es tuya."));
  if (limpios.length > 1) main.append(h("button", { class: "boton verde ancho", type: "button", id: "btn-alta-lote", onclick: () => altaEnLote(limpios) }, `Dar de alta los ${limpios.length} sin alertas`));
  main.append(lista.length ? listaPaginada("revisar", lista, (g) => filaGasto(g, { acciones: true })) : vacio("No hay gastos esperando. Todo está al día."));
}

async function altaEnLote(lista) {
  if (!(await confirmar(`Se darán de alta ${lista.length} gastos que no tienen ninguna alerta. Cada alta queda en la actividad con tu nombre.`, { si: `Dar de alta ${lista.length}`, titulo: "Alta en lote" }))) return;
  let ok = 0, fallo = null;
  for (const g of lista) { try { await Datos.darAlta(g.id); ok++; } catch (e) { fallo = e; break; } }
  aviso(fallo ? `Se dieron de alta ${ok}. Se detuvo: ${mensajeDe(fallo)}` : `${ok} gastos dados de alta correctamente.`, fallo ? "error" : "ok", 8000);
  await cargar({ sinAvisos: true }); render();
}

function filtrosDe(clave, { conEstado = true, valorEstadoInicial = "" } = {}) {
  const f = E.filtros[clave];
  const vend = E.usuarios.filter((x) => x.rol === "vendedor");
  const campo = (id, etiqueta, nodo) => h("div", {}, h("label", { for: id, text: etiqueta }), nodo);
  const sel = (id, opciones, valor) => h("select", { id }, opciones.map(([v, t]) => h("option", { value: v, ...(v === (valor ?? "") ? { selected: true } : {}) }, t)));
  const nodos = [
    campo(`${clave}-vend`, "Vendedor", sel(`${clave}-vend`, [["", "Todos"], ...vend.map((x) => [x.id, x.nombre])], f.vendedorId)),
    campo(`${clave}-centro`, "Centro de costo", sel(`${clave}-centro`, [["", "Todos"], ...E.centros.map((c) => [c.id, `${c.codigo} · ${c.nombre}`])], f.centroId)),
    conEstado ? campo(`${clave}-estado`, "Estado", sel(`${clave}-estado`, clave === "exportar"
      ? [["alta", "Solo dados de alta"], ["activos", "Enviados y dados de alta"], ["", "Todos (incluye rechazados)"]]
      : [["", "Todos"], ["enviado", "Enviados"], ["alta", "Dados de alta"], ["rechazado", "Rechazados"]], f.estado ?? valorEstadoInicial)) : null,
    campo(`${clave}-desde`, "Desde", h("input", { id: `${clave}-desde`, type: "date", value: f.desde ?? "" })),
    campo(`${clave}-hasta`, "Hasta", h("input", { id: `${clave}-hasta`, type: "date", value: f.hasta ?? "" })),
    clave === "todos" ? h("div", { class: "completo" }, h("label", { for: "todos-texto", text: "Buscar" }), h("input", { id: "todos-texto", type: "search", placeholder: "Descripción, vendedor, factura, NIT", value: f.texto ?? "" })) : null
  ];
  const caja = h("div", { class: "filtros" }, nodos);
  caja.addEventListener("change", () => leer());
  caja.addEventListener("input", (e) => { if (e.target.id === "todos-texto") leer(); });
  let t;
  const leer = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      f.vendedorId = $(`#${clave}-vend`).value; f.centroId = $(`#${clave}-centro`).value;
      if (conEstado) f.estado = $(`#${clave}-estado`).value;
      f.desde = $(`#${clave}-desde`).value; f.hasta = $(`#${clave}-hasta`).value;
      if (clave === "todos") f.texto = $("#todos-texto").value;
      const foco = document.activeElement?.id;
      E.limite = {};
      render();
      if (foco) { const x = document.getElementById(foco); x?.focus(); if (x?.setSelectionRange && x.type === "search") x.setSelectionRange(x.value.length, x.value.length); }
    }, 150);
  };
  return caja;
}

function aplicarFiltros(f) {
  const base = { ...f };
  if (base.estado === "activos") delete base.estado;
  let r = filtrarGastos(E.gastos, base);
  if (f.estado === "activos") r = r.filter((g) => g.estado !== "rechazado");
  return r;
}

function vistaTodos(main) {
  const lista = ordenarPorFecha(aplicarFiltros(E.filtros.todos));
  main.append(titulo("Todos los gastos", E.usuario.rol === "super" ? h("a", { class: "boton chico principal", href: "#/registrar" }, "Registrar gasto") : null));
  main.append(filtrosDe("todos"));
  main.append(h("p", { class: "suave", id: "todos-resumen", role: "status" }, `${lista.length} gasto(s) · ${formatearDinero(sumar(lista))}`));
  main.append(lista.length ? listaPaginada("todos", lista, (g) => filaGasto(g), { porDia: true }) : vacio("No hay gastos con esos filtros."));
}

// ============================================================
// Vista: Exportar a Excel
// ============================================================

function vistaExportar(main) {
  const u = E.usuario;
  if (!puedeExportar(u)) { main.append(vacio("Tu rol no exporta.")); return; }
  const lista = aplicarFiltros(E.filtros.exportar);
  main.append(titulo("Exportar a Excel"));
  main.append(h("p", { class: "suave" }, "El archivo trae 4 hojas: detalle, totales por vendedor, por centro de costo y el cruce vendedor–centro. Úsalo para ingresar a la contabilidad."));
  main.append(filtrosDe("exportar", { valorEstadoInicial: "alta" }));
  main.append(h("div", { class: "tarjeta" },
    h("p", { id: "export-resumen", role: "status" }, h("b", { text: `${lista.length} gasto(s)` }), ` · ${formatearDinero(sumar(lista))} · IVA ${formatearDinero(sumar(lista, "iva"))}`),
    h("div", { class: "fila envolver" },
      h("button", { class: "boton principal", type: "button", id: "btn-excel", disabled: lista.length === 0, onclick: () => exportar(lista) }, "Descargar Excel"),
      puedeCompartirArchivos() ? h("button", { class: "boton", type: "button", id: "btn-compartir", disabled: lista.length === 0, onclick: () => exportar(lista, true) }, "Compartir") : null),
    lista.length === 0 ? h("p", { class: "ayuda" }, "No hay gastos con esos filtros.") : null,
    !hayConexion() ? h("p", { class: "ayuda" }, "Sin internet: se exporta lo último que se descargó en este celular.") : null));
}

async function exportar(lista, compartir = false) {
  const centrosPorId = Object.fromEntries(E.centros.map((c) => [c.id, c]));
  const usuariosPorId = Object.fromEntries(E.usuarios.map((x) => [x.id, x]));
  const f = E.filtros.exportar;
  const etiqueta = [f.estado === "alta" ? "alta" : f.estado === "activos" ? "activos" : "", f.vendedorId ? E.usuarios.find((x) => x.id === f.vendedorId)?.nombre : "", f.centroId ? centroDe(f.centroId)?.codigo : ""].filter(Boolean).join(" ");
  const nombre = nombreArchivoExcel(hoyTexto(), etiqueta);
  try {
    const bytes = crearXlsx(hojasExcel(lista, { centrosPorId, usuariosPorId }));
    if (compartir) { if (!(await compartirArchivo(bytes, nombre))) descargarArchivo(bytes, nombre); }
    else descargarArchivo(bytes, nombre);
    aviso(`Excel listo: ${nombre} (${lista.length} gastos).`, "ok");
  } catch (e) { if (e.name !== "AbortError") aviso(`No se pudo crear el Excel: ${e.message}`, "error"); }
}

// ============================================================
// Detalle y acciones sobre un gasto
// ============================================================

async function abrirDetalle(g) {
  const u = E.usuario;
  const dlg = $("#dlg-detalle");
  $("#detalle-titulo").textContent = `${emojiCat(g.categoria)} ${nombreCat(g.categoria)}`;
  const filas = [
    ["Valor", formatearDinero(g.monto)], ["IVA incluido", g.iva ? formatearDinero(g.iva) : "—"], ["Descripción", g.descripcion],
    ["Fecha", formatearFecha(g.fecha)], ["Ciudad", g.ciudad], ["Vendedor", g.vendedorNombre], ["Centro de costo", nombreCentro(g.centroId)],
    ["NIT proveedor", g.proveedorNit || "—"], ["N° factura", g.facturaNumero || "—"]
  ];
  if (g.altaPor) filas.push(["Dado de alta por", `${g.altaPor} · ${formatearFechaHora(g.altaEn)}`]);
  filas.push(["Registrado", formatearFechaHora(g.creadoDispositivo)]);
  const mapa = enlaceMapa(g);
  const cuerpo = $("#detalle-cuerpo");
  const imagen = h("img", { class: "recibo", alt: "Foto del recibo o factura", hidden: true });
  cuerpo.replaceChildren(...[
    h("p", {}, chipEstado(g.estado)),
    g.estado === "rechazado" && g.motivoRechazo ? h("p", { class: "motivo" }, `Motivo: ${g.motivoRechazo}`) : null,
    g.estado === "pendiente" ? h("p", { class: "ayuda" }, g.errorEnvio ? `No se pudo enviar: ${g.errorEnvio}` : "Guardado en este celular. Se enviará cuando haya internet.") : null,
    g.estado === "alta" && u.rol === "vendedor" ? h("p", { class: "ayuda" }, "Ya está registrado en contabilidad y no se puede modificar.") : null,
    riesgoDe(g).alertas.length ? h("div", { class: "alertas", role: "note" }, h("b", { text: "Alertas para revisar" }), h("ul", { class: "alertas-lista" }, riesgoDe(g).alertas.map((a) => h("li", { class: a.nivel, text: a.texto })))) : null,
    h("dl", {}, filas.map(([k, v]) => h("div", { class: "dato" }, h("dt", { text: k }), h("dd", { text: v })))),
    h("div", { class: "dato" }, h("dt", { text: "Ubicación" }), h("dd", {}, mapa ? h("a", { href: mapa, target: "_blank", rel: "noopener noreferrer" }, `Ver en el mapa${g.precisionM ? ` (±${g.precisionM} m)` : ""}`) : (g.ubicacionMotivo ? `No disponible (${g.ubicacionMotivo})` : "No disponible"))),
    g.fotoPath ? imagen : h("p", { class: "ayuda" }, "Sin foto adjunta.")].filter(Boolean));
  if (g.fotoPath) Datos.obtenerFoto(g.fotoPath).then((b) => { if (b) { imagen.src = urlDeBlob(b); imagen.hidden = false; } else { imagen.replaceWith(h("p", { class: "ayuda" }, "La foto se verá cuando haya internet.")); } }).catch(() => { imagen.replaceWith(h("p", { class: "ayuda" }, "La foto se verá cuando haya internet.")); });

  const pie = $("#detalle-acciones");
  const acciones = [];
  if (g.estado === "pendiente") {
    acciones.push(h("button", { class: "boton peligro", type: "button", onclick: async () => { if (await confirmar("Se borra este gasto del celular y no se enviará.", { si: "Descartar" })) { await Cola.descartar(g.id); cerrar(dlg); await cargar({ sinAvisos: true }); render(); aviso("Gasto descartado.", "info"); } } }, "Descartar"));
    acciones.push(h("a", { class: "boton principal", href: `#/registrar/${g.id}`, onclick: () => cerrar(dlg) }, "Editar"));
  } else {
    if (puedeRechazar(u, g)) acciones.push(h("button", { class: "boton peligro", type: "button", onclick: () => { cerrar(dlg); accionRechazar(g); } }, "Rechazar"));
    if (puedeDarAlta(u, g)) acciones.push(h("button", { class: "boton verde", type: "button", onclick: () => { cerrar(dlg); accionAlta(g); } }, "Dar de alta"));
    if (puedeRevertirAlta(u, g)) acciones.push(h("button", { class: "boton", type: "button", onclick: () => accionRevertir(g) }, "Revertir alta"));
    if (puedeEditar(u, g)) acciones.push(h("a", { class: "boton principal", href: `#/registrar/${g.id}`, onclick: () => cerrar(dlg) }, g.estado === "rechazado" ? "Corregir y reenviar" : "Editar"));
  }
  pie.replaceChildren(...acciones, h("button", { class: "boton", type: "button", "data-cerrar": true }, "Cerrar"));
  abrir(dlg);
}

async function accionAlta(g) {
  try {
    await Datos.darAlta(g.id);
    aviso("Dado de alta correctamente.", "ok", 7000);
    await cargar({ sinAvisos: true }); render();
  } catch (e) { aviso(e.codigo === "sin_conexion" ? "Para dar de alta necesitas internet." : mensajeDe(e), "error"); await cargar({ sinAvisos: true }); render(); }
}

function accionRechazar(g) {
  const dlg = $("#dlg-rechazo"), motivo = $("#rechazo-motivo"), err = $("#rechazo-error");
  motivo.value = ""; err.hidden = true;
  const form = $("#form-rechazo");
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (motivo.value.trim().length < 5) { err.textContent = "Escribe el motivo (mínimo 5 caracteres)."; err.hidden = false; return; }
    try {
      await Datos.rechazar(g.id, motivo.value);
      cerrar(dlg);
      aviso("Gasto rechazado. El vendedor verá el motivo.", "info");
      await cargar({ sinAvisos: true }); render();
    } catch (e) { err.textContent = e.codigo === "sin_conexion" ? "Para rechazar necesitas internet." : mensajeDe(e); err.hidden = false; }
  };
  abrir(dlg);
  motivo.focus();
}

async function accionRevertir(g) {
  if (!(await confirmar("El gasto vuelve a «Enviado» y el vendedor podrá editarlo. Queda en la auditoría.", { si: "Revertir alta", titulo: "Revertir alta" }))) return;
  try { await Datos.revertirAlta(g.id); cerrar($("#dlg-detalle")); aviso("Alta revertida.", "info"); await cargar({ sinAvisos: true }); render(); }
  catch (e) { aviso(mensajeDe(e), "error"); }
}

// ============================================================
// Vista: Administración (superusuario)
// ============================================================

function vistaAdmin(main, sub) {
  const u = E.usuario;
  if (!puedeAdministrar(u)) { main.append(vacio("Solo el superusuario administra.")); return; }
  if (sub === "auditoria") sub = "actividad";
  sub = sub || "usuarios";
  const pend = E.usuarios.filter(esPendiente).length;
  main.append(titulo("Administración"));
  main.append(h("div", { class: "tabs" }, [["usuarios", `Usuarios${pend ? ` (${pend})` : ""}`], ["centros", "Centros de costo"], ["actividad", "Actividad"]].map(([id, t]) => h("a", { href: `#/admin/${id}`, "aria-current": sub === id ? "page" : null }, t))));
  const zona = h("div", {});
  main.append(zona);
  ({ usuarios: adminUsuarios, centros: adminCentros, actividad: adminActividad }[sub] ?? adminUsuarios)(zona);
}

function filaUsuario(x) {
  const yo = x.id === E.usuario.id;
  const pendiente = esPendiente(x);
  const li = h("li", {}, h("button", { class: "gasto", type: "button", onclick: () => formUsuario(x) },
    h("span", { class: "emoji", "aria-hidden": "true" }, { vendedor: "🧳", auxiliar: "📒", super: "🛡️" }[x.rol]),
    h("span", { class: "desc", text: x.nombre }),
    h("span", { class: "estado" }, h("span", { class: `chip ${pendiente ? "chip-aviso" : x.activo ? "chip-ok" : "chip-error"}`, text: pendiente ? "Por aprobar" : x.activo ? "Activo" : "Inactivo" })),
    h("span", { class: "meta", text: `${ROLES[x.rol]} · ${x.correo}${x.rol === "vendedor" ? ` · ${centroDe(x.centroId)?.codigo ?? "sin centro"}` : ""}` })));
  li.append(h("div", { class: "fila envolver" },
    pendiente ? h("button", { class: "boton verde chico", type: "button", "data-aprobar": x.id, onclick: () => aprobarUsuario(x) }, "Aprobar") : null,
    h("button", { class: "boton chico", type: "button", "data-clave": x.id, onclick: () => abrirClave({ titulo: `Contraseña de ${x.nombre}`, ayuda: yo ? "Es tu propia cuenta: para cambiarla usa «Mi cuenta» (pide la actual)." : "Define una nueva y entrégasela a la persona por un canal seguro. El cambio queda en la actividad.", guardar: async (_, nueva) => { await Datos.cambiarClave(x.id, nueva); aviso(`Contraseña de ${x.nombre} cambiada.`, "ok"); } }) }, "Cambiar contraseña"),
    h("a", { class: "boton chico", href: "#/admin/actividad", "data-actividad": x.id, onclick: () => { E.filtros.actividad = { usuarioId: x.id }; E.limite = {}; } }, "Ver actividad")));
  return li;
}

async function aprobarUsuario(x) {
  try {
    await Datos.guardarUsuario({ ...x, activo: true, clave: "" });
    aviso(`${x.nombre} ya puede ingresar como vendedor. Asígnale centro de costo (o cambia su rol) tocando su nombre.`, "ok", 9000);
    await cargar({ sinAvisos: true }); render();
  } catch (e) { aviso(mensajeDe(e), "error"); }
}

function adminUsuarios(zona) {
  const pend = E.usuarios.filter(esPendiente), resto = E.usuarios.filter((x) => !esPendiente(x));
  zona.append(h("p", { class: "ayuda" }, "Las personas crean su propia cuenta desde «Crear cuenta»; aquí las apruebas y defines su rol. El rol de auxiliar contable solo lo otorgas tú."));
  if (pend.length) zona.append(h("div", { class: "lote" }, h("b", { text: `${pend.length} cuenta(s) esperan tu aprobación` }), h("ul", { class: "lista" }, pend.map(filaUsuario))));
  zona.append(h("p", { class: "suave", text: `${resto.length} usuarios` }), h("ul", { class: "lista" }, resto.map(filaUsuario)));
}

function abrirFormAdmin(titulo_, campos, alGuardar) {
  $("#admin-titulo").textContent = titulo_;
  const zona = $("#admin-campos");
  zona.replaceChildren(...campos, h("p", { class: "error", id: "admin-error", role: "alert", hidden: true }));
  $("#form-admin").onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $("#admin-error"); err.hidden = true;
    try { await alGuardar(); cerrar($("#dlg-form-admin")); await cargar({ sinAvisos: true }); render(); }
    catch (e) { err.textContent = mensajeDe(e); err.hidden = false; }
  };
  abrir($("#dlg-form-admin"));
}

function formUsuario(x) {
  const cedula = entradaDe("a-cedula", "Cédula (solo vendedores)", { type: "text", inputmode: "numeric", value: x.cedula ?? "" });
  const rol = selectDe("a-rol", "Rol", Object.entries(ROLES), x.rol);
  const marcarRol = () => { cedula.hidden = $("#a-rol").value !== "vendedor"; };
  const activo = h("label", { class: "fila" }, h("input", { id: "a-activo", type: "checkbox", ...(x.activo !== false ? { checked: true } : {}) }), "Usuario activo (puede ingresar)");
  const campos = [
    entradaDe("a-nombre", "Nombre completo", { type: "text", value: x.nombre }),
    entradaDe("a-correo", "Correo", { type: "email", value: x.correo, ...(MODO === "real" ? { disabled: true } : {}) }), rol, cedula,
    selectDe("a-centro", "Centro de costo (vendedores)", [["", "Sin centro"], ...E.centros.map((c) => [c.id, `${c.codigo} · ${c.nombre}`])], x.centroId ?? ""),
    entradaDe("a-ciudad", "Ciudad base", { type: "text", list: "lista-ciudades-a", value: x.ciudad ?? "" }),
    h("datalist", { id: "lista-ciudades-a" }, CIUDADES.map((c) => h("option", { value: c }))),
    activo,
    h("p", { class: "ayuda" }, "Auxiliar contable: ve todos los gastos, da de alta y exporta, pero no modifica gastos. Superusuario: administra todo.")
  ];
  abrirFormAdmin("Editar usuario", campos, async () => {
    await Datos.guardarUsuario({ id: x.id, nombre: $("#a-nombre").value, correo: $("#a-correo").value || x.correo, rol: $("#a-rol").value, cedula: $("#a-cedula").value, centroId: $("#a-centro").value, ciudad: $("#a-ciudad").value, activo: $("#a-activo").checked, clave: "" });
    aviso("Usuario guardado.", "ok");
  });
  $("#a-rol").addEventListener("change", marcarRol); marcarRol();
}

function adminCentros(zona) {
  zona.append(h("div", { class: "fila entre envolver" }, h("p", { class: "suave", text: `${E.centros.length} centros de costo` }), h("button", { class: "boton chico principal", type: "button", id: "btn-nuevo-centro", onclick: () => formCentro(null) }, "Nuevo centro")));
  zona.append(h("ul", { class: "lista" }, E.centros.map((c) => h("li", {}, h("button", { class: "gasto", type: "button", onclick: () => formCentro(c) },
    h("span", { class: "emoji", "aria-hidden": "true" }, "🏷️"), h("span", { class: "desc", text: `${c.codigo} · ${c.nombre}` }), h("span", { class: "estado" }, h("span", { class: `chip ${c.activo ? "chip-ok" : "chip-error"}`, text: c.activo ? "Activo" : "Inactivo" })))))));
}

function formCentro(c) {
  abrirFormAdmin(c ? "Editar centro de costo" : "Nuevo centro de costo", [
    entradaDe("a-codigo", "Código", { type: "text", value: c?.codigo ?? "", placeholder: "CC-105" }),
    entradaDe("a-nombre-c", "Nombre", { type: "text", value: c?.nombre ?? "" }),
    h("label", { class: "fila" }, h("input", { id: "a-activo-c", type: "checkbox", ...(c?.activo !== false ? { checked: true } : {}) }), "Centro activo")
  ], async () => { await Datos.guardarCentro({ id: c?.id, codigo: $("#a-codigo").value, nombre: $("#a-nombre-c").value, activo: $("#a-activo-c").checked }); aviso("Centro guardado.", "ok"); });
}

const ACCIONES = {
  login: "Ingresó", logout: "Cerró sesión", login_fallido: "Intento de ingreso fallido", registro_usuario: "Creó su cuenta", clave_cambiada: "Cambio de contraseña (por el admin)", clave_propia: "Cambió su contraseña",
  usuario_edicion: "Editó un usuario", usuario_nuevo: "Nuevo usuario", registro: "Registró un gasto", reenvio: "Corrigió y reenvió un gasto", edicion: "Editó un gasto (admin)", alta: "Dio de alta", rechazo: "Rechazó un gasto", reversion: "Revirtió un alta",
  centro_nuevo: "Nuevo centro de costo", centro_edicion: "Editó un centro de costo"
};
const nombreAccion = (a) => ACCIONES[a] ?? a;

function adminActividad(zona) {
  const f = E.filtros.actividad;
  zona.append(h("p", { class: "suave" }, "Quién hizo qué, desde qué equipo y a qué hora. Solo lo ve el superusuario y nadie puede borrarlo."));
  const campo = (id, et, nodo) => h("div", {}, h("label", { for: id, text: et }), nodo);
  const opciones = (id, ops, valor) => h("select", { id }, ops.map(([v, t]) => h("option", { value: v, ...(v === (valor ?? "") ? { selected: true } : {}) }, t)));
  const cuerpo = h("tbody", {});
  const filtros = h("div", { class: "filtros" },
    campo("act-usuario", "Usuario", opciones("act-usuario", [["", "Todos"], ...E.usuarios.map((x) => [x.id, x.nombre])], f.usuarioId)),
    campo("act-accion", "Acción", opciones("act-accion", [["", "Todas"], ...Object.entries(ACCIONES)], f.accion)),
    campo("act-desde", "Desde", h("input", { id: "act-desde", type: "date", value: f.desde ?? "" })),
    campo("act-hasta", "Hasta", h("input", { id: "act-hasta", type: "date", value: f.hasta ?? "" })));
  const resumen = h("p", { class: "suave", id: "act-resumen", role: "status" });
  zona.append(filtros, resumen, h("div", { class: "scroll-x" }, h("table", { class: "tabla", id: "tabla-actividad" }, h("thead", {}, h("tr", {}, ["Fecha y hora", "Usuario", "Acción", "Detalle", "Equipo", "IP"].map((t) => h("th", { text: t })))), cuerpo)));
  let filas = [];
  const pintar = () => {
    const visibles = filas.filter((a) => (!f.usuarioId || a.usuarioId === f.usuarioId) && (!f.accion || a.accion === f.accion) && (!f.desde || new Date(a.en) >= new Date(`${f.desde}T00:00:00`)) && (!f.hasta || new Date(a.en) <= new Date(`${f.hasta}T23:59:59`)));
    const n = E.limite.actividad ?? PAGINA;
    resumen.textContent = `${visibles.length} movimiento(s)`;
    const trs = visibles.slice(0, n).map((a) => h("tr", {}, h("td", { text: formatearFechaHora(a.en) }), h("td", { text: a.usuarioNombre }), h("td", { text: nombreAccion(a.accion) }), h("td", { text: a.detalle }), h("td", { text: a.equipoNombre || "—" }), h("td", { text: a.ip || "—" })));
    cuerpo.replaceChildren(...(trs.length ? trs : [h("tr", {}, h("td", { colspan: "6", text: "No hay movimientos con esos filtros." }))]));
    $("#act-mas")?.remove();
    if (visibles.length > n) zona.append(h("button", { class: "boton ancho", type: "button", id: "act-mas", onclick: () => { E.limite.actividad = n + PAGINA; pintar(); } }, `Mostrar más (${visibles.length - n} restantes)`));
  };
  filtros.addEventListener("change", () => { f.usuarioId = $("#act-usuario").value; f.accion = $("#act-accion").value; f.desde = $("#act-desde").value; f.hasta = $("#act-hasta").value; E.limite.actividad = PAGINA; pintar(); });
  cuerpo.replaceChildren(h("tr", {}, h("td", { colspan: "6", text: "Cargando…" })));
  Datos.listarAuditoria().then((r) => { filas = r; pintar(); }).catch((e) => cuerpo.replaceChildren(h("tr", {}, h("td", { colspan: "6", text: mensajeDe(e) }))));
}

// ============================================================
// Arranque
// ============================================================

async function arrancar() {
  if (MODO === "sin_config") { $("#vista-config").hidden = false; return; }
  try {
    await Datos.iniciar();
    const u = Datos.restaurarSesion();
    if (u) await entrar(u, { bienvenida: false }); else mostrarLogin();
  } catch (e) {
    mostrarLogin();
    aviso(mensajeDe(e), "error");
  }
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Sin trabajo sin conexión:", e.message));
  }
}
arrancar();
