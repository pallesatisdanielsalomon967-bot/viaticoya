// Pruebas del servidor de demostración y de la cola de envío:  node pruebas/datos.test.js
// (usa un IndexedDB falso: npm install --save-dev fake-indexeddb)
"use strict";
const assert = require("node:assert/strict");
try { require("fake-indexeddb/auto"); } catch { console.log("SALTADO: falta fake-indexeddb (npm install)"); process.exit(0); }

// localStorage y navigator mínimos para Node
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
let enLinea = true;
Object.defineProperty(globalThis, "navigator", { value: { get onLine() { return enLinea; } }, configurable: true });

globalThis.CONFIG = { supabaseUrl: "", supabaseAnonKey: "", pruebas: true };   // activa el servidor en memoria SOLO para estas pruebas
const L = require("../js/logica.js");
const { Demo, Cola, Datos, Equipo, MODO, Real } = require("../js/datos.js");

async function dispara(promesa, codigo, texto) {
  try { await promesa; } catch (e) { assert.equal(e.codigo, codigo, `${texto}: código ${e.codigo} (${e.message})`); return e; }
  assert.fail(`${texto}: debía fallar con ${codigo}`);
}

const ahora = () => new Date().toISOString();
function datosGasto(u, extra = {}) {
  return L.crearGasto({ centroId: "cc-101", categoria: "alimentacion", monto: 35000, iva: 0, descripcion: "Almuerzo", fecha: L.fechaDeHoy(), ciudad: "Medellín", lat: 6.2, lng: -75.5, ...extra }, u);
}

let n = 0;
async function prueba(nombre, fn) {
  try { await fn(); n++; } catch (e) { console.error(`FALLA: ${nombre}\n`, e); process.exit(1); }
}

(async () => {
  assert.equal(MODO, "demo", "el servidor en memoria solo se activa con CONFIG.pruebas"); assert.equal(Datos, Demo);
  await Demo.iniciar();

  await prueba("login: credenciales y roles", async () => {
    await dispara(Demo.iniciarSesion("carlos@viaticoya.demo", "mala"), "credenciales", "clave mala");
    await dispara(Demo.iniciarSesion("nadie@x.com", "demo1234"), "credenciales", "usuario inexistente");
    const u = await Demo.iniciarSesion(" CARLOS@viaticoya.demo ", "demo1234");
    assert.equal(u.rol, "vendedor"); assert.equal(u.hash, undefined, "el hash nunca sale del servidor");
    assert.equal(Demo.restaurarSesion().id, "u-carlos");
    await Demo.cerrarSesion(); assert.equal(Demo.restaurarSesion(), null);
    await dispara(Demo.listarGastos(), "sesion", "sin sesión no hay datos");
  });

  await prueba("el vendedor solo ve lo suyo", async () => {
    const carlos = await Demo.iniciarSesion("carlos@viaticoya.demo", "demo1234");
    const mios = await Demo.listarGastos();
    assert.ok(mios.length >= 3 && mios.every((g) => g.vendedorId === carlos.id));
    await Demo.cerrarSesion();
    await Demo.iniciarSesion("contabilidad@viaticoya.demo", "demo1234");
    assert.ok((await Demo.listarGastos()).length >= 9, "el auxiliar ve todos");
    await Demo.cerrarSesion();
  });

  await prueba("registrar: notificaciones, idempotencia y bloqueo tras el alta", async () => {
    const carlos = await Demo.iniciarSesion("carlos@viaticoya.demo", "demo1234");
    const g = datosGasto(carlos);
    const guardado = await Demo.guardarGasto(g);
    assert.equal(guardado.estado, "enviado"); assert.ok(guardado.recibidoServidor);
    const otraVez = await Demo.guardarGasto({ ...g, descripcion: "Almuerzo corregido" });
    assert.equal(otraVez.descripcion, "Almuerzo corregido");
    assert.equal((await Demo.listarGastos()).filter((x) => x.id === g.id).length, 1, "reenviar no duplica");
    const notis = await Demo.listarNotificaciones();
    assert.ok(notis.some((x) => x.tipo === "enviado" && /Enviado correctamente a contabilidad/.test(x.texto)), "el vendedor ve 'enviado correctamente'");
    await Demo.cerrarSesion();

    const aux = await Demo.iniciarSesion("contabilidad@viaticoya.demo", "demo1234");
    assert.ok((await Demo.listarNotificaciones()).some((x) => x.tipo === "nuevo" && x.gastoId === g.id), "el auxiliar recibe aviso de gasto nuevo");
    await dispara(Demo.guardarGasto(datosGasto(aux)), "permiso", "el auxiliar no registra gastos");
    await dispara(Demo.editarGasto(g.id, { monto: 1 }), "permiso", "el auxiliar no edita");
    const alta = await Demo.darAlta(g.id);
    assert.equal(alta.estado, "alta"); assert.equal(alta.altaPor, "Marta Rojas");
    assert.ok((await Demo.listarNotificaciones()).some((x) => x.tipo === "alta_ok" && /Dado de alta correctamente/.test(x.texto)), "el auxiliar ve 'dado de alta correctamente'");
    await dispara(Demo.darAlta(g.id), "bloqueado", "no se da de alta dos veces");
    await dispara(Demo.rechazar(g.id, "motivo largo"), "permiso", "no se rechaza un gasto con alta");
    await Demo.cerrarSesion();

    await Demo.iniciarSesion("carlos@viaticoya.demo", "demo1234");
    assert.ok((await Demo.listarNotificaciones()).some((x) => x.tipo === "alta"), "el vendedor se entera del alta");
    await dispara(Demo.guardarGasto({ ...g, descripcion: "Intento de cambio" }), "bloqueado", "el vendedor NO modifica tras el alta");
    await Demo.cerrarSesion();
  });

  await prueba("rechazo y corrección", async () => {
    const laura = await Demo.iniciarSesion("laura@viaticoya.demo", "demo1234");
    const g = datosGasto(laura, { centroId: "cc-102", categoria: "peajes", monto: 9000, descripcion: "Peaje" });
    await Demo.guardarGasto(g);
    await Demo.cerrarSesion();
    await Demo.iniciarSesion("contabilidad@viaticoya.demo", "demo1234");
    await dispara(Demo.rechazar(g.id, "no"), "invalido", "motivo corto");
    const r = await Demo.rechazar(g.id, "La foto no se ve");
    assert.equal(r.estado, "rechazado"); assert.equal(r.motivoRechazo, "La foto no se ve");
    await Demo.cerrarSesion();
    await Demo.iniciarSesion("laura@viaticoya.demo", "demo1234");
    assert.ok((await Demo.listarNotificaciones()).some((x) => x.tipo === "rechazado" && /La foto no se ve/.test(x.texto)));
    const corregido = await Demo.guardarGasto({ ...g, descripcion: "Peaje Vía al Mar" });
    assert.equal(corregido.estado, "enviado"); assert.equal(corregido.motivoRechazo, "");
    await Demo.cerrarSesion();
  });

  await prueba("seguridad: no se suplanta ni se sube fuera de la carpeta propia", async () => {
    const andres = await Demo.iniciarSesion("andres@viaticoya.demo", "demo1234");
    const ajeno = datosGasto({ id: "u-carlos", nombre: "Carlos Mejía", rol: "vendedor" });
    await dispara(Demo.guardarGasto(ajeno), "permiso", "no registra a nombre de otro");
    const mio = datosGasto(andres, { centroId: "cc-103" });
    const g = await Demo.guardarGasto(mio);
    await Demo.cerrarSesion();
    await Demo.iniciarSesion("laura@viaticoya.demo", "demo1234");
    await dispara(Demo.guardarGasto({ ...mio, vendedorId: "u-laura", vendedorNombre: "Laura Pérez" }), "permiso", "no pisa el gasto de otro vendedor");
    await dispara(Demo.subirFoto(`u-andres/${g.id}.jpg`, new Blob(["x"])), "permiso", "foto en carpeta ajena");
    await dispara(Demo.darAlta(g.id), "permiso", "un vendedor no da de alta");
    await dispara(Demo.listarAuditoria(), "permiso", "un vendedor no ve auditoría");
    await dispara(Demo.guardarCentro({ codigo: "CC-900", nombre: "Nuevo" }), "permiso", "un vendedor no crea centros");
    await dispara(Demo.guardarUsuario({ nombre: "Intruso", correo: "i@x.com", rol: "super", clave: "123456" }), "permiso", "un vendedor no crea usuarios");
    await Demo.cerrarSesion();
  });

  await prueba("factura duplicada entre vendedores y validación en el servidor", async () => {
    await Demo.iniciarSesion("andres@viaticoya.demo", "demo1234");
    const a = L.crearGasto({ centroId: "cc-103", categoria: "combustible", monto: 70000, iva: 0, descripcion: "Tanqueo", fecha: L.fechaDeHoy(), ciudad: "Pereira", proveedorNit: "800251440", facturaNumero: "ZZ-1", fotoPath: "u-andres/x.jpg" }, { id: "u-andres", nombre: "Andrés Ruiz" });
    await Demo.guardarGasto(a);
    await Demo.cerrarSesion();
    const laura = await Demo.iniciarSesion("laura@viaticoya.demo", "demo1234");
    const b = L.crearGasto({ centroId: "cc-102", categoria: "combustible", monto: 70000, iva: 0, descripcion: "Tanqueo", fecha: L.fechaDeHoy(), ciudad: "Pereira", proveedorNit: "800251440", facturaNumero: "zz-1", fotoPath: "u-laura/y.jpg" }, laura);
    await dispara(Demo.guardarGasto(b), "duplicado", "misma factura en otro vendedor");
    await dispara(Demo.guardarGasto(datosGasto(laura, { centroId: "no-existe" })), "invalido", "centro inexistente");
    await dispara(Demo.guardarGasto(datosGasto(laura, { monto: 80000 })), "invalido", "sin foto sobre 50.000");
    await Demo.cerrarSesion();
  });

  await prueba("superusuario: edita con auditoría, revierte, administra", async () => {
    await Demo.iniciarSesion("admin@viaticoya.demo", "demo1234");
    const gs = await Demo.listarGastos();
    const alta = gs.find((g) => g.estado === "alta");
    const e = await Demo.editarGasto(alta.id, { descripcion: "Corregido por admin", monto: 200000 });
    assert.equal(e.descripcion, "Corregido por admin"); assert.equal(e.estado, "alta", "editar no cambia el estado");
    assert.ok((await Demo.listarAuditoria())[0].detalle.includes("monto"), "la edición queda en la auditoría");
    assert.equal((await Demo.revertirAlta(alta.id)).estado, "enviado");
    const c = await Demo.guardarCentro({ codigo: "cc-200", nombre: "Ventas Santanderes" });
    assert.equal(c.codigo, "CC-200");
    await dispara(Demo.guardarCentro({ codigo: "CC-200", nombre: "Repetido" }), "invalido", "código repetido");
    const nuevo = await Demo.guardarUsuario({ nombre: "Pedro Nuevo", correo: "pedro@x.com", rol: "vendedor", cedula: "1.234.567", clave: "secreto1", centroId: c.id, ciudad: "Bucaramanga" });
    assert.equal(nuevo.cedula, "1234567");
    await dispara(Demo.guardarUsuario({ id: "u-admin", nombre: "Daniela Admin", correo: "admin@viaticoya.demo", rol: "vendedor", cedula: "12345" }), "invalido", "no se quita su propio acceso");
    await Demo.cerrarSesion();
    const pedro = await Demo.iniciarSesion("pedro@x.com", "secreto1");
    assert.equal(pedro.rol, "vendedor");
    await Demo.cerrarSesion();
    await Demo.iniciarSesion("admin@viaticoya.demo", "demo1234");
    await Demo.guardarUsuario({ ...nuevo, activo: false });
    await Demo.cerrarSesion();
    await dispara(Demo.iniciarSesion("pedro@x.com", "secreto1"), "pendiente", "un usuario desactivado no entra");
  });

  await prueba("cola de envío: offline, reintento, idempotencia y errores definitivos", async () => {
    const carlos = await Demo.iniciarSesion("carlos@viaticoya.demo", "demo1234");
    enLinea = false;
    const foto = new Blob(["jpeg-falso"], { type: "image/jpeg" });
    const g1 = datosGasto(carlos, { monto: 60000, descripcion: "Hotel sin internet" });
    await Cola.encolar(g1, foto);
    await Cola.encolar(datosGasto(carlos, { monto: 12000, descripcion: "Taxi sin internet" }), null);
    assert.equal((await Cola.pendientes("u-carlos")).length, 2);
    assert.equal((await Cola.pendientes("u-laura")).length, 0, "cada vendedor ve solo su cola");
    await dispara(Demo.listarGastos(), "sin_conexion", "sin red el servidor no responde");
    let r = await Cola.sincronizar("u-carlos");
    assert.equal(r.enviados.length, 0); assert.equal(r.sinConexion, true); assert.equal(r.restantes, 2, "nada se pierde sin internet");

    enLinea = true;
    r = await Cola.sincronizar("u-carlos");
    assert.equal(r.enviados.length, 2); assert.equal(r.restantes, 0);
    const lista = await Demo.listarGastos();
    assert.equal(lista.filter((g) => g.id === g1.id).length, 1);
    assert.equal(lista.find((g) => g.id === g1.id).fotoPath, `u-carlos/${g1.id}.jpg`);
    assert.ok(await Demo.obtenerFoto(`u-carlos/${g1.id}.jpg`), "la foto llegó");
    r = await Cola.sincronizar("u-carlos"); assert.equal(r.enviados.length, 0, "ya no queda nada");

    // un gasto con la factura repetida se rechaza para siempre y se anota, sin trabar al resto
    const dup = datosGasto(carlos, { monto: 70000, descripcion: "Repetido", proveedorNit: "800251440", facturaNumero: "ZZ-1", fotoPath: "u-carlos/z.jpg" });
    const bueno = datosGasto(carlos, { monto: 8000, descripcion: "Bueno" });
    await Cola.encolar(dup, null); await Cola.encolar(bueno, null);
    r = await Cola.sincronizar("u-carlos");
    assert.equal(r.fallidos.length, 1); assert.equal(r.fallidos[0].codigo, "duplicado"); assert.equal(r.enviados.length, 1);
    const queda = await Cola.pendientes("u-carlos");
    assert.equal(queda.length, 1); assert.match(queda[0].error, /NIT y número/);
    r = await Cola.sincronizar("u-carlos"); assert.equal(r.fallidos.length, 0, "no reintenta lo rechazado");
    await Cola.descartar(dup.id); assert.equal((await Cola.pendientes("u-carlos")).length, 0);
    await Demo.cerrarSesion();
  });

  await prueba("cuentas nuevas: registro, aprobación, claves y actividad por equipo", async () => {
    await dispara(Demo.registrar({ nombre: "Pe", correo: "x", clave: "123456", cedula: "123456" }), "invalido", "datos inválidos");
    await dispara(Demo.registrar({ nombre: "Pedro Nuevo", correo: "pedro@x.co", clave: "1234", cedula: "1234567" }), "invalido", "clave de 4 dígitos no se acepta");
    await dispara(Demo.registrar({ nombre: "Otro Carlos", correo: "CARLOS@viaticoya.demo", clave: "secreto1", cedula: "1234567" }), "invalido", "correo repetido");
    const r = await Demo.registrar({ nombre: "Pedro Nuevo", correo: "Pedro@X.co", clave: "secreto1", cedula: "12.345.678", ciudad: "Cali" });
    assert.equal(r.pendiente, true);
    await dispara(Demo.iniciarSesion("pedro@x.co", "secreto1"), "pendiente", "pendiente de aprobación no entra");
    await dispara(Demo.iniciarSesion("pedro@x.co", "mala"), "credenciales", "clave incorrecta");

    // el rol nunca viene del formulario: siempre vendedor
    let admin = await Demo.iniciarSesion("admin@viaticoya.demo", "demo1234");
    assert.ok((await Demo.listarNotificaciones()).some((x) => x.tipo === "usuario_nuevo"), "el superusuario recibe aviso de la cuenta nueva");
    const us = await Demo.listarUsuarios();
    const pedro = us.find((x) => x.correo === "pedro@x.co");
    assert.equal(pedro.rol, "vendedor"); assert.equal(pedro.activo, false); assert.equal(pedro.cedula, "12345678");
    await Demo.guardarUsuario({ ...pedro, activo: true, centroId: "cc-104" });
    await Demo.guardarUsuario({ ...pedro, rol: "auxiliar", activo: true, cedula: "" });
    assert.equal((await Demo.listarUsuarios()).find((x) => x.id === pedro.id).rol, "auxiliar", "el superusuario otorga el rol de auxiliar");
    await Demo.cambiarClave(pedro.id, "nueva-clave-9");
    await dispara(Demo.cambiarClave(pedro.id, "123"), "invalido", "clave muy corta");
    await dispara(Demo.cambiarClave("no-existe", "nueva-clave-9"), "no_encontrado", "usuario inexistente");
    await Demo.cerrarSesion();

    await dispara(Demo.iniciarSesion("pedro@x.co", "secreto1"), "credenciales", "la clave vieja ya no sirve");
    const aux = await Demo.iniciarSesion("pedro@x.co", "nueva-clave-9");
    assert.equal(aux.rol, "auxiliar");
    await dispara(Demo.cambiarClave(pedro.id, "otra-clave-1"), "permiso", "el auxiliar no cambia claves");
    await dispara(Demo.listarAuditoria(), "permiso", "el auxiliar no ve la actividad");
    await dispara(Demo.guardarUsuario({ ...aux, rol: "super" }), "permiso", "no se auto-asigna superusuario");
    await Demo.cerrarSesion();

    admin = await Demo.iniciarSesion("admin@viaticoya.demo", "demo1234");
    const act = await Demo.listarAuditoria();
    const accion = (a) => act.filter((x) => x.accion === a);
    for (const a of ["registro_usuario", "login", "logout", "clave_cambiada", "login_fallido"]) assert.ok(accion(a).length > 0, `la actividad incluye ${a}`);
    const l = accion("login").find((x) => x.usuarioNombre === "Pedro Nuevo");
    assert.ok(l.en && l.equipoId && l.equipoNombre, "cada evento lleva fecha, hora y equipo");
    assert.ok(!JSON.stringify(act).includes("nueva-clave-9") && !JSON.stringify(act).includes("secreto1"), "las claves nunca quedan en la actividad");
    assert.ok(accion("clave_cambiada")[0].detalle.includes("Pedro Nuevo"));
    assert.equal(Equipo.info().id, Equipo.info().id, "el equipo conserva su identificador");
    assert.match(Buffer.from(Equipo.cabecera(), "base64").toString(), /"i":/);
    // cada persona cambia su propia contraseña
    await Demo.iniciarSesion("carlos@viaticoya.demo", "demo1234");
    await dispara(Demo.cambiarMiClave("mala", "otra-clave-5"), "credenciales", "pide la clave actual");
    await dispara(Demo.cambiarMiClave("demo1234", "123"), "invalido", "clave nueva muy corta");
    await Demo.cambiarMiClave("demo1234", "otra-clave-5");
    await Demo.cerrarSesion();
    await dispara(Demo.iniciarSesion("carlos@viaticoya.demo", "demo1234"), "credenciales", "la clave anterior ya no sirve");
    await Demo.iniciarSesion("carlos@viaticoya.demo", "otra-clave-5");
    await Demo.cambiarMiClave("otra-clave-5", "demo1234");
    await Demo.cerrarSesion();
  });

  console.log(`OK: ${n} grupos de pruebas de datos pasaron`);
})();
