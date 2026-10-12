/*
 * datos.js — De dónde salen y a dónde van los datos. Dos "servidores" con la MISMA interfaz:
 *   · Demo : un servidor de ejemplo dentro del navegador (localStorage). Aplica las mismas reglas de permisos.
 *   · Real : Supabase (base de datos + usuarios + fotos), si config.js trae las claves.
 * Además: la cola de envío (outbox) que guarda los gastos sin internet y los manda al volver la conexión.
 *
 * Los errores llevan un `codigo`: sin_conexion, credenciales, sesion, permiso, bloqueado, duplicado, invalido, no_encontrado, servidor.
 */
"use strict";

if (typeof require !== "undefined" && typeof module !== "undefined") {
  Object.assign(globalThis, require("./logica.js"), require("./almacen.js"));
}

// La app solo trabaja con Supabase ("real"). Si falta la conexión muestra la pantalla de configuración ("sin_config").
// El servidor en memoria ("demo") existe únicamente para las pruebas automáticas y solo se activa con CONFIG.pruebas === true.
const MODO = (typeof CONFIG !== "undefined" && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) ? "real"
  : (typeof CONFIG !== "undefined" && CONFIG.pruebas === true) ? "demo" : "sin_config";
const CLAVE_SESION = "vy:sesion";

function falla(codigo, mensaje) {
  const e = new Error(mensaje);
  e.codigo = codigo;
  return e;
}
const hayRed = () => !(typeof navigator !== "undefined" && navigator.onLine === false);
const ahoraISO = () => new Date().toISOString();
const copiar = (x) => JSON.parse(JSON.stringify(x));
// ---------- Equipo: qué dispositivo hace cada acción (para la actividad que ve el superusuario) ----------
const Equipo = {
  _info: null,
  info() {
    if (this._info) return this._info;
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const ua = String(nav.userAgent ?? "");
    let id = null;
    try { id = localStorage.getItem("vy:equipo"); } catch { /* sin almacenamiento */ }
    if (!id) { id = generarId(); try { localStorage.setItem("vy:equipo", id); } catch { /* nada */ } }
    const so = /Android ([\d.]+)/.exec(ua) ? `Android ${/Android ([\d.]+)/.exec(ua)[1]}` : /iPhone|iPad|iPod/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Equipo";
    const navegador = /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Navegador";
    const movil = /Mobi|Android|iPhone|iPad/.test(ua);
    const instalada = typeof matchMedia === "function" && (matchMedia("(display-mode: standalone)").matches || nav.standalone === true);
    const pantalla = typeof screen !== "undefined" && screen.width ? `${screen.width}x${screen.height}` : "";
    let zona = ""; try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* nada */ }
    this._info = { id, nombre: `${so} · ${navegador}${movil ? " (móvil)" : ""}${instalada ? " · app instalada" : ""}`, pantalla, zona };
    return this._info;
  },
  /** Valor para la cabecera x-equipo (texto ASCII): el servidor lo guarda junto con la IP. */
  cabecera() {
    const e = this.info();
    const json = JSON.stringify({ i: e.id, n: e.nombre, p: e.pantalla, z: e.zona });
    try { return btoa(unescape(encodeURIComponent(json))); } catch { return ""; }
  }
};

const CAMPOS_EDITABLES = ["centroId", "categoria", "monto", "iva", "descripcion", "fecha", "ciudad", "proveedorNit", "facturaNumero"];

// ============================================================
// A. SERVIDOR DE DEMOSTRACIÓN (dentro del navegador)
// ============================================================

const CLAVE_SRV = "vy:srv";

async function hashClave(clave, sal) {
  const datos = new TextEncoder().encode(`${sal}:${clave}`);
  const h = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CLAVE_DEMO = "demo1234";

async function crearSemilla() {
  const hoy = fechaDeHoy();
  const centros = [
    { id: "cc-101", codigo: "CC-101", nombre: "Ventas Antioquia", activo: true },
    { id: "cc-102", codigo: "CC-102", nombre: "Ventas Costa Caribe", activo: true },
    { id: "cc-103", codigo: "CC-103", nombre: "Ventas Eje Cafetero", activo: true },
    { id: "cc-104", codigo: "CC-104", nombre: "Ventas Bogotá y Cundinamarca", activo: true }
  ];
  const base = [
    { id: "u-admin", nombre: "Daniela Admin", correo: "admin@viaticoya.demo", rol: "super", cedula: "", centroId: "", ciudad: "Bogotá" },
    { id: "u-conta", nombre: "Marta Rojas", correo: "contabilidad@viaticoya.demo", rol: "auxiliar", cedula: "", centroId: "", ciudad: "Bogotá" },
    { id: "u-carlos", nombre: "Carlos Mejía", correo: "carlos@viaticoya.demo", rol: "vendedor", cedula: "71234567", centroId: "cc-101", ciudad: "Medellín" },
    { id: "u-laura", nombre: "Laura Pérez", correo: "laura@viaticoya.demo", rol: "vendedor", cedula: "32987654", centroId: "cc-102", ciudad: "Barranquilla" },
    { id: "u-andres", nombre: "Andrés Ruiz", correo: "andres@viaticoya.demo", rol: "vendedor", cedula: "10456789", centroId: "cc-103", ciudad: "Pereira" }
  ];
  const usuarios = [];
  for (const u of base) {
    const sal = `sal-${u.id}`;
    usuarios.push({ ...u, activo: true, sal, hash: await hashClave(CLAVE_DEMO, sal) });
  }
  const g = (id, vend, dias, cat, monto, iva, desc, ciudad, estado, extra = {}) => {
    const u = base.find((x) => x.id === vend);
    const fecha = sumarDias(hoy, -dias);
    return {
      id, vendedorId: vend, vendedorNombre: u.nombre, centroId: u.centroId, categoria: cat, monto, iva, descripcion: desc, fecha, ciudad,
      proveedorNit: "", facturaNumero: "", lat: null, lng: null, precisionM: null, ubicacionMotivo: "dato de ejemplo", fotoPath: "",
      estado, creadoDispositivo: `${fecha}T14:00:00.000Z`, recibidoServidor: `${fecha}T14:00:05.000Z`, altaPor: "", altaEn: null, motivoRechazo: "", ...extra
    };
  };
  const alta = { altaPor: "Marta Rojas", altaEn: `${sumarDias(hoy, -1)}T16:00:00.000Z` };
  const gastos = [
    g("d-01", "u-carlos", 1, "alimentacion", 38000, 0, "Almuerzo con cliente Hotel Dann", "Medellín", "enviado", { proveedorNit: "890900286", facturaNumero: "FE-2210" }),
    g("d-02", "u-carlos", 2, "hospedaje", 165000, 26350, "Hotel una noche visita Rionegro", "Rionegro", "alta", { ...alta, proveedorNit: "811002345", facturaNumero: "H-8841" }),
    g("d-03", "u-carlos", 3, "peajes", 24500, 0, "Peajes Medellín - Rionegro ida y vuelta", "Rionegro", "alta", alta),
    g("d-04", "u-laura", 1, "tiquetes", 85000, 0, "Bus Barranquilla - Santa Marta", "Barranquilla", "enviado"),
    g("d-05", "u-laura", 2, "alimentacion", 29000, 0, "Desayuno y almuerzo", "Santa Marta", "alta", alta),
    g("d-06", "u-laura", 4, "clientes", 120000, 19160, "Cena de cierre con distribuidor", "Santa Marta", "rechazado", { motivoRechazo: "Falta el NIT del proveedor y la factura está ilegible." }),
    g("d-07", "u-andres", 0, "combustible", 90000, 14370, "Tanqueo ruta Pereira - Armenia", "Pereira", "enviado", { proveedorNit: "800251440", facturaNumero: "T-5521" }),
    g("d-08", "u-andres", 2, "transporte", 18000, 0, "Taxis visitas a clientes", "Pereira", "alta", alta),
    g("d-09", "u-andres", 6, "parqueadero", 12000, 0, "Parqueadero centro comercial", "Armenia", "alta", alta)
  ];
  const notificaciones = [
    { id: "n-1", usuarioId: "u-conta", tipo: "nuevo", gastoId: "d-01", texto: "Carlos Mejía envió $ 38.000 (Alimentación): pendiente de alta.", creada: ahoraISO(), leida: false },
    { id: "n-2", usuarioId: "u-conta", tipo: "nuevo", gastoId: "d-07", texto: "Andrés Ruiz envió $ 90.000 (Combustible): pendiente de alta.", creada: ahoraISO(), leida: false },
    { id: "n-3", usuarioId: "u-laura", tipo: "rechazado", gastoId: "d-06", texto: "Tu gasto de $ 120.000 fue rechazado: Falta el NIT del proveedor y la factura está ilegible.", creada: ahoraISO(), leida: false }
  ];
  return { version: 1, usuarios, centros, gastos, notificaciones, auditoria: [] };
}

const Demo = (() => {
  let actorId = null;

  const leerSrv = () => leerJSON(CLAVE_SRV, null);
  const escribirSrv = (srv) => { if (!escribirJSON(CLAVE_SRV, srv)) throw falla("servidor", "No se pudo guardar: el navegador no deja escribir datos."); };
  const exigirRed = () => { if (!hayRed()) throw falla("sin_conexion", "Sin conexión a internet."); };

  function actor(srv) {
    const u = srv.usuarios.find((x) => x.id === actorId && x.activo);
    if (!u) throw falla("sesion", "Tu sesión venció. Ingresa de nuevo.");
    return u;
  }
  const publico = (u) => ({ id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, cedula: u.cedula, centroId: u.centroId, ciudad: u.ciudad, activo: u.activo });
  const notificar = (srv, usuarioId, tipo, gastoId, texto) => srv.notificaciones.push({ id: generarId(), usuarioId, tipo, gastoId, texto, creada: ahoraISO(), leida: false });
  const auditar = (srv, u, accion, gastoId, detalle) => {
    const e = Equipo.info();
    srv.auditoria.push({ id: generarId(), en: ahoraISO(), usuarioId: u.id, usuarioNombre: u.nombre, accion, gastoId: gastoId ?? "", detalle: detalle ?? "", equipoId: e.id, equipoNombre: e.nombre, ip: "" });
  };
  const nombreCat = (id) => buscarCategoria(id)?.nombre ?? id;
  const contables = (srv) => srv.usuarios.filter((x) => x.activo && esContable(x));
  const buscar = (srv, id) => {
    const g = srv.gastos.find((x) => x.id === id);
    if (!g) throw falla("no_encontrado", "No se encontró ese gasto.");
    return g;
  };

  return {
    modo: "demo",
    async iniciar() {
      if (!leerSrv()) escribirSrv(await crearSemilla());
    },
    restaurarSesion() {
      const id = leerJSON(CLAVE_SESION, null)?.id;
      const srv = leerSrv();
      const u = srv?.usuarios.find((x) => x.id === id && x.activo);
      if (!u) return null;
      actorId = u.id;
      return publico(u);
    },
    async iniciarSesion(correo, clave) {
      await this.iniciar();
      const srv = leerSrv();
      const u = srv.usuarios.find((x) => normalizarCorreo(x.correo) === normalizarCorreo(correo));
      const claveOk = u && (await hashClave(clave, u.sal)) === u.hash;
      if (!claveOk) {
        if (u) { auditar(srv, u, "login_fallido", "", "Contraseña incorrecta"); escribirSrv(srv); }
        throw falla("credenciales", "Correo o contraseña incorrectos.");
      }
      if (!u.activo) throw falla("pendiente", "Tu cuenta está pendiente de aprobación o desactivada. El administrador debe activarla.");
      actorId = u.id;
      auditar(srv, u, "login", "", "Inicio de sesión");
      escribirSrv(srv);
      escribirJSON(CLAVE_SESION, { id: u.id });
      return publico(u);
    },
    /** Crea una cuenta nueva: siempre de vendedor. Queda pendiente hasta que el superusuario la apruebe (CONFIG.aprobarNuevos). */
    async registrar(d) {
      await this.iniciar();
      const srv = leerSrv();
      const datos = { nombre: d.nombre, correo: d.correo, rol: "vendedor", cedula: d.cedula, clave: d.clave };
      const problema = validarUsuario(datos, srv.usuarios, null);
      if (problema) throw falla("invalido", problema);
      const sal = generarId();
      const aprobar = typeof CONFIG === "undefined" || CONFIG.aprobarNuevos !== false;
      const registro = {
        id: generarId(), nombre: String(d.nombre).trim(), correo: normalizarCorreo(d.correo), rol: "vendedor", cedula: String(d.cedula).replace(/[.\s]/g, ""),
        centroId: "", ciudad: String(d.ciudad ?? "").trim(), activo: !aprobar, sal, hash: await hashClave(d.clave, sal)
      };
      srv.usuarios.push(registro);
      auditar(srv, registro, "registro_usuario", "", `Cuenta creada${aprobar ? " (pendiente de aprobación)" : ""}`);
      if (aprobar) for (const s of srv.usuarios.filter((x) => x.activo && x.rol === "super")) notificar(srv, s.id, "usuario_nuevo", "", `${registro.nombre} creó una cuenta y espera tu aprobación.`);
      escribirSrv(srv);
      return { pendiente: aprobar };
    },
    /** Solo el superusuario: cambia la contraseña de cualquier usuario. */
    async cambiarClave(usuarioId, nueva) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      if (!puedeAdministrar(u)) throw falla("permiso", "Solo el superusuario cambia contraseñas.");
      if (String(nueva ?? "").length < 6) throw falla("invalido", "La contraseña debe tener mínimo 6 caracteres.");
      const x = srv.usuarios.find((y) => y.id === usuarioId);
      if (!x) throw falla("no_encontrado", "No se encontró el usuario.");
      x.hash = await hashClave(nueva, x.sal);
      auditar(srv, u, "clave_cambiada", "", `Contraseña de ${x.nombre} (${x.correo})`);
      escribirSrv(srv);
    },
    /** Cada persona cambia su propia contraseña (pide la actual). */
    async cambiarMiClave(actual, nueva) {
      const srv = leerSrv(), u = actor(srv);
      if (String(nueva ?? "").length < 6) throw falla("invalido", "La contraseña nueva debe tener mínimo 6 caracteres.");
      if ((await hashClave(actual, u.sal)) !== u.hash) throw falla("credenciales", "La contraseña actual no es correcta.");
      u.hash = await hashClave(nueva, u.sal);
      auditar(srv, u, "clave_propia", "", "Cambió su propia contraseña");
      escribirSrv(srv);
    },
    /** Anota un evento de la persona que tiene la sesión (por ejemplo, el cierre de sesión). */
    async registrarEvento(accion, detalle = "") {
      const srv = leerSrv(), u = actor(srv);
      auditar(srv, u, accion, "", detalle);
      escribirSrv(srv);
    },
    async cerrarSesion() {
      try { if (actorId) await this.registrarEvento("logout", "Cierre de sesión"); } catch { /* sin sesión válida */ }
      actorId = null; borrarClave(CLAVE_SESION);
    },
    async listarGastos() {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      return copiar(srv.gastos.filter((g) => puedeVer(u, g)));
    },

    /** Crea o actualiza (por id) un gasto del propio vendedor. Reenviar el mismo id nunca lo duplica. */
    async guardarGasto(g) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      if (!puedeRegistrar(u)) throw falla("permiso", "Tu rol no puede registrar gastos.");
      if (g.vendedorId !== u.id) throw falla("permiso", "Solo puedes registrar gastos a tu nombre.");
      const referencia = aFechaTexto(new Date(g.creadoDispositivo));
      const problema = validarGasto(g, { centros: srv.centros.filter((c) => c.activo), hoy: referencia, tieneFoto: !!g.fotoPath });
      if (problema) throw falla("invalido", problema);
      const dup = detectarDuplicado(srv.gastos, g);
      if (dup?.tipo === "factura") throw falla("duplicado", "Ya existe un gasto con ese NIT y número de factura.");

      const i = srv.gastos.findIndex((x) => x.id === g.id);
      let nuevo;
      if (i >= 0) {
        const previo = srv.gastos[i];
        if (previo.vendedorId !== u.id) throw falla("permiso", "Ese gasto no es tuyo.");
        if (previo.estado === "alta") throw falla("bloqueado", "Ese gasto ya fue dado de alta y no se puede modificar.");
        nuevo = { ...previo, ...pick(g, [...CAMPOS_EDITABLES, "lat", "lng", "precisionM", "ubicacionMotivo", "fotoPath"]), estado: "enviado", motivoRechazo: "", recibidoServidor: ahoraISO() };
        srv.gastos[i] = nuevo;
        auditar(srv, u, "reenvio", g.id, previo.estado === "rechazado" ? "Corregido tras rechazo" : "Editado por el vendedor");
        if (previo.estado === "rechazado") for (const c of contables(srv)) notificar(srv, c.id, "nuevo", g.id, `${u.nombre} corrigió y reenvió ${formatearDinero(nuevo.monto)} (${nombreCat(nuevo.categoria)}).`);
      } else {
        nuevo = { ...g, vendedorNombre: u.nombre, estado: "enviado", recibidoServidor: ahoraISO(), altaPor: "", altaEn: null, motivoRechazo: "" };
        srv.gastos.push(nuevo);
        auditar(srv, u, "registro", g.id, `${formatearDinero(nuevo.monto)} · ${nombreCat(nuevo.categoria)}`);
        for (const c of contables(srv)) notificar(srv, c.id, "nuevo", g.id, `${u.nombre} envió ${formatearDinero(nuevo.monto)} (${nombreCat(nuevo.categoria)}): pendiente de alta.`);
      }
      notificar(srv, u.id, "enviado", g.id, `Enviado correctamente a contabilidad: ${formatearDinero(nuevo.monto)} · ${nombreCat(nuevo.categoria)}.`);
      escribirSrv(srv);
      return copiar(nuevo);
    },

    async darAlta(id) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv), g = buscar(srv, id);
      if (!puedeDarAlta(u, g)) throw falla(g.estado === "alta" ? "bloqueado" : "permiso", g.estado === "alta" ? "Ese gasto ya está dado de alta." : "No tienes permiso para dar de alta este gasto.");
      Object.assign(g, { estado: "alta", altaPor: u.nombre, altaEn: ahoraISO(), motivoRechazo: "" });
      auditar(srv, u, "alta", id, `${formatearDinero(g.monto)} de ${g.vendedorNombre}`);
      notificar(srv, u.id, "alta_ok", id, `Dado de alta correctamente: ${formatearDinero(g.monto)} de ${g.vendedorNombre}.`);
      notificar(srv, g.vendedorId, "alta", id, `Contabilidad dio de alta tu gasto de ${formatearDinero(g.monto)} (${nombreCat(g.categoria)}).`);
      escribirSrv(srv);
      return copiar(g);
    },

    async rechazar(id, motivo) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv), g = buscar(srv, id);
      if (!puedeRechazar(u, g)) throw falla("permiso", "No tienes permiso para rechazar este gasto.");
      const m = String(motivo ?? "").trim();
      if (m.length < 5) throw falla("invalido", "Escribe el motivo del rechazo (mínimo 5 caracteres).");
      Object.assign(g, { estado: "rechazado", motivoRechazo: m.slice(0, 200) });
      auditar(srv, u, "rechazo", id, m);
      notificar(srv, g.vendedorId, "rechazado", id, `Tu gasto de ${formatearDinero(g.monto)} fue rechazado: ${m}`);
      escribirSrv(srv);
      return copiar(g);
    },

    async revertirAlta(id) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv), g = buscar(srv, id);
      if (!puedeRevertirAlta(u, g)) throw falla("permiso", "Solo el superusuario puede revertir un alta.");
      Object.assign(g, { estado: "enviado", altaPor: "", altaEn: null });
      auditar(srv, u, "reversion", id, "Alta revertida");
      escribirSrv(srv);
      return copiar(g);
    },

    async editarGasto(id, cambios) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv), g = buscar(srv, id);
      if (!puedeEditar(u, g) || u.rol !== "super") throw falla("permiso", "Solo el superusuario puede editar un gasto de otra persona.");
      const nuevo = { ...g, ...pick(cambios, CAMPOS_EDITABLES) };
      const problema = validarGasto(nuevo, { centros: srv.centros, hoy: nuevo.fecha > fechaDeHoy() ? nuevo.fecha : fechaDeHoy(), tieneFoto: !!g.fotoPath });
      if (problema && !/hace más de|foto/.test(problema)) throw falla("invalido", problema);
      const dif = CAMPOS_EDITABLES.filter((k) => String(g[k]) !== String(nuevo[k])).map((k) => `${k}: ${g[k]} → ${nuevo[k]}`);
      Object.assign(g, nuevo);
      auditar(srv, u, "edicion", id, dif.join("; ") || "Sin cambios");
      escribirSrv(srv);
      return copiar(g);
    },

    async listarCentros() {
      exigirRed();
      const srv = leerSrv(); actor(srv);
      return copiar(srv.centros);
    },
    async guardarCentro(c) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      if (!puedeAdministrar(u)) throw falla("permiso", "Solo el superusuario administra los centros de costo.");
      const problema = validarCentro(c, srv.centros, c.id ?? null);
      if (problema) throw falla("invalido", problema);
      const registro = { id: c.id ?? generarId(), codigo: c.codigo.trim().toUpperCase(), nombre: c.nombre.trim(), activo: c.activo !== false };
      const i = srv.centros.findIndex((x) => x.id === registro.id);
      if (i >= 0) srv.centros[i] = registro; else srv.centros.push(registro);
      auditar(srv, u, i >= 0 ? "centro_edicion" : "centro_nuevo", "", `${registro.codigo} ${registro.nombre}`);
      escribirSrv(srv);
      return copiar(registro);
    },
    async listarUsuarios() {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      return srv.usuarios.filter((x) => esContable(u) || x.id === u.id).map(publico);
    },
    async guardarUsuario(d) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      if (!puedeAdministrar(u)) throw falla("permiso", "Solo el superusuario administra usuarios.");
      const problema = validarUsuario(d, srv.usuarios, d.id ?? null);
      if (problema) throw falla("invalido", problema);
      const i = srv.usuarios.findIndex((x) => x.id === d.id);
      if (i >= 0 && srv.usuarios[i].id === u.id && (d.activo === false || d.rol !== "super")) throw falla("invalido", "No puedes quitarte tu propio acceso de superusuario.");
      const sal = i >= 0 ? srv.usuarios[i].sal : generarId();
      const registro = {
        id: d.id ?? generarId(), nombre: d.nombre.trim(), correo: normalizarCorreo(d.correo), rol: d.rol,
        cedula: d.rol === "vendedor" ? String(d.cedula).replace(/[.\s]/g, "") : "", centroId: d.centroId || "", ciudad: (d.ciudad || "").trim(),
        activo: d.activo !== false, sal, hash: d.clave ? await hashClave(d.clave, sal) : srv.usuarios[i].hash
      };
      if (i >= 0) srv.usuarios[i] = registro; else srv.usuarios.push(registro);
      auditar(srv, u, i >= 0 ? "usuario_edicion" : "usuario_nuevo", "", `${registro.nombre} (${ROLES[registro.rol]})`);
      escribirSrv(srv);
      return publico(registro);
    },

    async listarNotificaciones() {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      return copiar(srv.notificaciones.filter((n) => n.usuarioId === u.id).sort((a, b) => b.creada.localeCompare(a.creada)).slice(0, 60));
    },
    async marcarLeidas(ids) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      for (const n of srv.notificaciones) if (n.usuarioId === u.id && (!ids || ids.includes(n.id))) n.leida = true;
      escribirSrv(srv);
    },
    async listarAuditoria() {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      if (!puedeAdministrar(u)) throw falla("permiso", "Solo el superusuario ve la actividad de los usuarios.");
      return copiar([...srv.auditoria].reverse().slice(0, 500));
    },

    async subirFoto(path, blob) {
      exigirRed();
      const srv = leerSrv(), u = actor(srv);
      if (!path.startsWith(`${u.id}/`)) throw falla("permiso", "Solo puedes subir fotos a tu carpeta.");
      await idbGuardar("fotos", { path, blob });
    },
    async obtenerFoto(path) {
      return (await idbObtener("fotos", path))?.blob ?? null;
    }
  };
})();

function pick(obj, claves) {
  const salida = {};
  for (const k of claves) if (k in obj) salida[k] = obj[k];
  return salida;
}

// ============================================================
// B. SERVIDOR REAL (Supabase por HTTP, sin librerías)
// ============================================================

const COLUMNAS = {
  id: "id", vendedorId: "vendedor_id", vendedorNombre: "vendedor_nombre", centroId: "centro_id", categoria: "categoria", monto: "monto", iva: "iva",
  descripcion: "descripcion", fecha: "fecha", ciudad: "ciudad", proveedorNit: "proveedor_nit", facturaNumero: "factura_numero", lat: "lat", lng: "lng",
  precisionM: "precision_m", ubicacionMotivo: "ubicacion_motivo", fotoPath: "foto_path", estado: "estado", creadoDispositivo: "creado_dispositivo",
  recibidoServidor: "recibido_servidor", altaPor: "alta_por", altaEn: "alta_en", motivoRechazo: "motivo_rechazo"
};
const aFila = (g) => Object.fromEntries(Object.entries(COLUMNAS).filter(([k]) => k in g).map(([k, c]) => [c, g[k]]));
const desdeFila = (f) => {
  const g = Object.fromEntries(Object.entries(COLUMNAS).map(([k, c]) => [k, f[c] ?? (["lat", "lng", "precisionM", "recibidoServidor", "altaEn"].includes(k) ? null : "")]));
  g.monto = Number(g.monto); g.iva = Number(g.iva) || 0;
  return g;
};

const Real = (() => {
  const base = typeof CONFIG !== "undefined" ? CONFIG.supabaseUrl.replace(/\/+$/, "") : "";
  const llave = typeof CONFIG !== "undefined" ? CONFIG.supabaseAnonKey : "";
  let sesion = leerJSON(CLAVE_SESION, null);   // { access, refresh, expira, usuario }

  async function refrescar() {
    if (!sesion?.refresh) throw falla("sesion", "Tu sesión venció. Ingresa de nuevo.");
    let r;
    try {
      r = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: llave, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: sesion.refresh }) });
    } catch { throw falla("sin_conexion", "Sin conexión a internet."); }
    if (!r.ok) { sesion = null; borrarClave(CLAVE_SESION); throw falla("sesion", "Tu sesión venció. Ingresa de nuevo."); }
    const t = await r.json();
    sesion = { ...sesion, access: t.access_token, refresh: t.refresh_token, expira: Date.now() + t.expires_in * 1000 };
    escribirJSON(CLAVE_SESION, sesion);
  }

  async function asegurarToken() {
    if (!sesion) throw falla("sesion", "Ingresa para continuar.");
    if (sesion.expira - 60000 < Date.now() && hayRed()) await refrescar();
  }

  async function errorDe(r) {
    let cuerpo = {};
    try { cuerpo = await r.json(); } catch { /* sin cuerpo */ }
    const msg = cuerpo.message || cuerpo.msg || cuerpo.error_description || `Error ${r.status}`;
    if (r.status === 401) return falla("sesion", "Tu sesión venció. Ingresa de nuevo.");
    if (cuerpo.code === "23505" || r.status === 409) return falla("duplicado", "Ya existe un gasto con ese NIT y número de factura.");
    if (cuerpo.code === "42501" || r.status === 403) return falla("permiso", "No tienes permiso para esta acción.");
    if (cuerpo.code === "P0001") return falla(/alta/i.test(msg) ? "bloqueado" : "invalido", msg);
    return falla("servidor", msg);
  }

  async function pedir(ruta, { metodo = "GET", cuerpo, cabeceras = {}, auth = true, blob = false } = {}) {
    if (auth) await asegurarToken();
    const esBlob = typeof Blob !== "undefined" && cuerpo instanceof Blob;
    let r;
    try {
      r = await fetch(base + ruta, {
        method: metodo,
        headers: { apikey: llave, ...(auth && sesion ? { Authorization: `Bearer ${sesion.access}` } : {}), ...(cuerpo !== undefined && !esBlob ? { "Content-Type": "application/json" } : {}), ...(auth ? { "x-equipo": Equipo.cabecera() } : {}), ...cabeceras },
        body: cuerpo === undefined ? undefined : esBlob ? cuerpo : JSON.stringify(cuerpo)
      });
    } catch { throw falla("sin_conexion", "Sin conexión a internet."); }
    if (!r.ok) throw await errorDe(r);
    if (blob) return r.blob();
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }

  const perfilAUsuario = (p) => ({ id: p.id, nombre: p.nombre, correo: p.correo, rol: p.rol, cedula: p.cedula ?? "", centroId: p.centro_id ?? "", ciudad: p.ciudad ?? "", activo: p.activo !== false });
  const usuario = () => { if (!sesion?.usuario) throw falla("sesion", "Ingresa para continuar."); return sesion.usuario; };

  return {
    modo: "real",
    async iniciar() { /* nada que preparar */ },
    restaurarSesion() { return sesion?.usuario ?? null; },
    async iniciarSesion(correo, clave) {
      let r;
      try {
        r = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: llave, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizarCorreo(correo), password: clave }) });
      } catch { throw falla("sin_conexion", "Necesitas internet para ingresar la primera vez."); }
      if (!r.ok) throw falla("credenciales", "Correo o contraseña incorrectos.");
      const t = await r.json();
      sesion = { access: t.access_token, refresh: t.refresh_token, expira: Date.now() + t.expires_in * 1000, usuario: null };
      try {
        const filas = await pedir(`/rest/v1/perfiles?id=eq.${t.user.id}&select=*`);
        if (!filas?.[0]) throw falla("credenciales", "Tu usuario existe pero no tiene perfil. Pide al administrador que lo complete.");
        if (filas[0].activo === false) throw falla("pendiente", "Tu cuenta está pendiente de aprobación o desactivada. El administrador debe activarla.");
        if (!ROLES[filas[0].rol]) throw falla("credenciales", "Tu usuario no tiene un rol válido.");
        sesion.usuario = perfilAUsuario(filas[0]);
      } catch (e) { sesion = null; borrarClave(CLAVE_SESION); throw e; }
      escribirJSON(CLAVE_SESION, sesion);
      this.registrarEvento("login", "Inicio de sesión").catch(() => {});
      return sesion.usuario;
    },
    /** Crea la cuenta en Supabase Authentication. El servidor decide el rol (el primer usuario es el superusuario) y si queda pendiente. */
    async registrar(d) {
      const problema = validarUsuario({ nombre: d.nombre, correo: d.correo, rol: "vendedor", cedula: d.cedula, clave: d.clave }, [], null);
      if (problema) throw falla("invalido", problema);
      let r;
      try {
        r = await fetch(`${base}/auth/v1/signup`, {
          method: "POST", headers: { apikey: llave, "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizarCorreo(d.correo), password: d.clave, data: { nombre: String(d.nombre).trim(), cedula: String(d.cedula).replace(/[.\s]/g, ""), ciudad: String(d.ciudad ?? "").trim() } })
        });
      } catch { throw falla("sin_conexion", "Necesitas internet para crear tu cuenta."); }
      if (!r.ok) {
        let c = {}; try { c = await r.json(); } catch { /* sin cuerpo */ }
        const msg = String(c.msg || c.message || c.error_description || "");
        if (/already|registered|exists/i.test(msg)) throw falla("invalido", "Ese correo ya tiene una cuenta. Ingresa o pide al administrador que cambie tu contraseña.");
        if (/password/i.test(msg)) throw falla("invalido", "La contraseña es muy débil. Usa mínimo 6 caracteres, mejor con letras y números.");
        throw falla("servidor", msg || `No se pudo crear la cuenta (error ${r.status}).`);
      }
      const t = await r.json();
      return { pendiente: true, confirmarCorreo: !t.access_token };
    },
    /** Solo el superusuario: cambia la contraseña de cualquier usuario (función SQL admin_cambiar_clave). */
    async cambiarClave(usuarioId, nueva) {
      if (String(nueva ?? "").length < 6) throw falla("invalido", "La contraseña debe tener mínimo 6 caracteres.");
      await pedir("/rest/v1/rpc/admin_cambiar_clave", { metodo: "POST", cuerpo: { p_usuario: usuarioId, p_clave: nueva } });
    },
    async cambiarMiClave(actual, nueva) {
      if (String(nueva ?? "").length < 6) throw falla("invalido", "La contraseña nueva debe tener mínimo 6 caracteres.");
      let r;
      try { r = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: llave, "Content-Type": "application/json" }, body: JSON.stringify({ email: usuario().correo, password: actual }) }); }
      catch { throw falla("sin_conexion", "Sin conexión a internet."); }
      if (!r.ok) throw falla("credenciales", "La contraseña actual no es correcta.");
      await pedir("/auth/v1/user", { metodo: "PUT", cuerpo: { password: nueva } });
      this.registrarEvento("clave_propia", "Cambió su propia contraseña").catch(() => {});
    },
    async registrarEvento(accion, detalle = "") {
      await pedir("/rest/v1/rpc/registrar_evento", { metodo: "POST", cuerpo: { p_accion: accion, p_detalle: detalle } });
    },
    async cerrarSesion() {
      try { await Promise.race([this.registrarEvento("logout", "Cierre de sesión"), new Promise((ok) => setTimeout(ok, 1500))]); } catch { /* sin conexión o sesión vencida */ }
      sesion = null; borrarClave(CLAVE_SESION);
    },

    async listarGastos() {
      const filas = await pedir("/rest/v1/gastos?select=*&order=fecha.desc&limit=3000");
      return filas.map(desdeFila);
    },
    async guardarGasto(g) {
      usuario();
      const filas = await pedir("/rest/v1/gastos?on_conflict=id", {
        // Solo viajan los campos del vendedor: estado, hora de recibido y alta los fija el servidor (trigger)
        metodo: "POST", cuerpo: aFila({ ...pick(g, ["id", "vendedorId", ...CAMPOS_EDITABLES, "lat", "lng", "precisionM", "ubicacionMotivo", "fotoPath", "creadoDispositivo"]), estado: "enviado", motivoRechazo: "" }),
        cabeceras: { Prefer: "resolution=merge-duplicates,return=representation" }
      });
      return desdeFila(filas[0]);
    },
    async darAlta(id) { await pedir("/rest/v1/rpc/dar_alta", { metodo: "POST", cuerpo: { p_id: id } }); },
    async rechazar(id, motivo) {
      if (String(motivo ?? "").trim().length < 5) throw falla("invalido", "Escribe el motivo del rechazo (mínimo 5 caracteres).");
      await pedir("/rest/v1/rpc/rechazar", { metodo: "POST", cuerpo: { p_id: id, p_motivo: String(motivo).trim().slice(0, 200) } });
    },
    async revertirAlta(id) { await pedir("/rest/v1/rpc/revertir_alta", { metodo: "POST", cuerpo: { p_id: id } }); },
    async editarGasto(id, cambios) {
      const filas = await pedir(`/rest/v1/gastos?id=eq.${encodeURIComponent(id)}`, { metodo: "PATCH", cuerpo: aFila(pick(cambios, CAMPOS_EDITABLES)), cabeceras: { Prefer: "return=representation" } });
      if (!filas?.[0]) throw falla("permiso", "No se pudo editar el gasto.");
      return desdeFila(filas[0]);
    },

    async listarCentros() { return pedir("/rest/v1/centros_costo?select=*&order=codigo.asc").then((f) => f.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre, activo: c.activo !== false }))); },
    async guardarCentro(c) {
      const filas = await pedir("/rest/v1/centros_costo?on_conflict=id", {
        metodo: "POST", cuerpo: { id: c.id ?? generarId(), codigo: c.codigo.trim().toUpperCase(), nombre: c.nombre.trim(), activo: c.activo !== false },
        cabeceras: { Prefer: "resolution=merge-duplicates,return=representation" }
      });
      return { id: filas[0].id, codigo: filas[0].codigo, nombre: filas[0].nombre, activo: filas[0].activo };
    },
    async listarUsuarios() { return pedir("/rest/v1/perfiles?select=*&order=nombre.asc").then((f) => f.map(perfilAUsuario)); },
    async guardarUsuario(d) {
      // En modo real los usuarios se crean en Supabase (Authentication → Add user). Aquí solo se ajusta el perfil.
      const cuerpo = { nombre: d.nombre.trim(), rol: d.rol, cedula: d.rol === "vendedor" ? String(d.cedula).replace(/[.\s]/g, "") : null, centro_id: d.centroId || null, ciudad: (d.ciudad || "").trim() || null, activo: d.activo !== false };
      const filas = await pedir(`/rest/v1/perfiles?id=eq.${encodeURIComponent(d.id)}`, { metodo: "PATCH", cuerpo, cabeceras: { Prefer: "return=representation" } });
      if (!filas?.[0]) throw falla("permiso", "No se pudo actualizar el perfil.");
      return perfilAUsuario(filas[0]);
    },

    async listarNotificaciones() {
      const filas = await pedir("/rest/v1/notificaciones?select=*&order=creada.desc&limit=60");
      return filas.map((n) => ({ id: n.id, usuarioId: n.usuario_id, tipo: n.tipo, gastoId: n.gasto_id, texto: n.texto, creada: n.creada, leida: n.leida }));
    },
    async marcarLeidas(ids) {
      const filtro = ids?.length ? `id=in.(${ids.map(encodeURIComponent).join(",")})` : `usuario_id=eq.${usuario().id}`;
      await pedir(`/rest/v1/notificaciones?${filtro}`, { metodo: "PATCH", cuerpo: { leida: true } });
    },
    async listarAuditoria() {
      const filas = await pedir("/rest/v1/auditoria?select=*&order=en.desc&limit=500");
      return filas.map((a) => ({ id: a.id, en: a.en, usuarioId: a.usuario_id, usuarioNombre: a.usuario_nombre, accion: a.accion, gastoId: a.gasto_id ?? "", detalle: a.detalle ?? "", equipoId: a.equipo_id ?? "", equipoNombre: a.equipo_nombre ?? "", ip: a.ip ?? "" }));
    },

    async subirFoto(path, blob) {
      await pedir(`/storage/v1/object/recibos/${path.split("/").map(encodeURIComponent).join("/")}`, { metodo: "POST", cuerpo: blob, cabeceras: { "Content-Type": blob.type || "image/jpeg", "x-upsert": "true" } });
    },
    async obtenerFoto(path) {
      const local = (await idbObtener("fotos", path).catch(() => null))?.blob;
      if (local) return local;
      const b = await pedir(`/storage/v1/object/authenticated/recibos/${path.split("/").map(encodeURIComponent).join("/")}`, { blob: true });
      idbGuardar("fotos", { path, blob: b }).catch(() => {});
      return b;
    }
  };
})();

const Datos = MODO === "demo" ? Demo : Real;

// ============================================================
// C. COLA DE ENVÍO (funciona sin internet)
// ============================================================
// Cada gasto se guarda primero en el celular. Cuando hay internet se manda: primero la foto, luego el gasto.
// Como el id lo crea el celular, si el envío se corta a la mitad y se repite, el servidor no lo duplica.

const Cola = {
  sincronizando: false,

  async encolar(gasto, foto) {
    const fotoPath = foto ? `${gasto.vendedorId}/${gasto.id}.jpg` : gasto.fotoPath;
    const item = { id: gasto.id, vendedorId: gasto.vendedorId, gasto: { ...gasto, fotoPath }, foto: foto ?? null, creada: ahoraISO(), intentos: 0, error: "" };
    await idbGuardar("outbox", item);
    if (foto) await idbGuardar("fotos", { path: fotoPath, blob: foto });
    return item;
  },

  async pendientes(vendedorId) {
    try { return (await idbTodos("outbox")).filter((x) => x.vendedorId === vendedorId); } catch { return []; }
  },

  async descartar(id) { await idbBorrar("outbox", id); },

  /** Manda todo lo pendiente. Devuelve { enviados: [gasto], fallidos: [{id, error}], restantes }. */
  async sincronizar(vendedorId) {
    const salida = { enviados: [], fallidos: [], restantes: 0, sinConexion: false };
    if (this.sincronizando) return salida;
    this.sincronizando = true;
    try {
      const lista = (await this.pendientes(vendedorId)).filter((x) => !x.error).sort((a, b) => a.creada.localeCompare(b.creada));
      for (const item of lista) {
        if (!hayRed()) { salida.sinConexion = true; break; }
        try {
          if (item.foto) await Datos.subirFoto(item.gasto.fotoPath, item.foto);
          const guardado = await Datos.guardarGasto(item.gasto);
          await idbBorrar("outbox", item.id);
          salida.enviados.push(guardado);
        } catch (e) {
          if (e.codigo === "sin_conexion" || e.codigo === "sesion" || e.codigo === "servidor") {
            salida.sinConexion = e.codigo === "sin_conexion";
            salida.sesion = e.codigo === "sesion";
            item.intentos += 1;
            await idbGuardar("outbox", item).catch(() => {});
            break; // se reintenta más tarde
          }
          // Rechazo definitivo del servidor (duplicado, bloqueado, inválido, permiso): se anota para que la persona lo vea
          item.error = e.message; item.codigoError = e.codigo;
          await idbGuardar("outbox", item);
          salida.fallidos.push({ id: item.id, error: e.message, codigo: e.codigo });
        }
      }
      salida.restantes = (await this.pendientes(vendedorId)).filter((x) => !x.error).length;
    } finally {
      this.sincronizando = false;
    }
    return salida;
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Datos, Demo, Real, Cola, Equipo, MODO, falla, desdeFila, aFila, CLAVE_DEMO, CLAVE_SRV, CLAVE_SESION };
}
