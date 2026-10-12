// Pruebas de la lógica de ViaticoYa:  node pruebas/logica.test.js
"use strict";
const assert = require("node:assert/strict");
const L = require("../js/logica.js");

let n = 0;
function prueba(nombre, fn) {
  try { fn(); n++; } catch (e) { console.error(`FALLA: ${nombre}\n`, e.message); process.exit(1); }
}

const HOY = "2026-10-11";
const centros = [{ id: "c1", codigo: "CC-101", nombre: "Ventas Antioquia" }, { id: "c2", codigo: "CC-102", nombre: "Ventas Costa" }];
const ana = { id: "u-ana", nombre: "Ana Gómez", rol: "vendedor", cedula: "1010" };
const luis = { id: "u-luis", nombre: "Luis Pérez", rol: "vendedor", cedula: "2020" };
const aux = { id: "u-aux", nombre: "Marta Auxiliar", rol: "auxiliar" };
const sup = { id: "u-sup", nombre: "Admin", rol: "super" };
const base = { centroId: "c1", categoria: "alimentacion", monto: 35000, iva: 0, descripcion: "Almuerzo", fecha: "2026-10-10", ciudad: "Medellín", proveedorNit: "", facturaNumero: "" };
const ctx = { centros, hoy: HOY, tieneFoto: false };
const nuevo = (extra = {}, u = ana) => L.crearGasto({ ...base, ...extra }, u, new Date("2026-10-11T15:00:00-05:00"));

prueba("permisos: vendedor, auxiliar y superusuario", () => {
  const g = nuevo();
  assert.equal(L.puedeVer(ana, g), true); assert.equal(L.puedeVer(luis, g), false);
  assert.equal(L.puedeVer(aux, g), true); assert.equal(L.puedeVer(sup, g), true);
  assert.equal(L.puedeEditar(ana, g), true, "el vendedor edita lo suyo antes del alta");
  assert.equal(L.puedeEditar(luis, g), false, "no edita lo ajeno");
  assert.equal(L.puedeEditar(aux, g), false, "el auxiliar NO edita");
  assert.equal(L.puedeEditar(sup, g), true);
  assert.equal(L.puedeDarAlta(aux, g), true); assert.equal(L.puedeDarAlta(ana, g), false); assert.equal(L.puedeDarAlta(sup, g), true);
  const alta = { ...g, estado: "alta" };
  assert.equal(L.puedeEditar(ana, alta), false, "tras el alta el vendedor no edita");
  assert.equal(L.puedeEditar(sup, alta), true, "el superusuario sí");
  assert.equal(L.puedeDarAlta(aux, alta), false, "no se da de alta dos veces");
  assert.equal(L.puedeRevertirAlta(sup, alta), true); assert.equal(L.puedeRevertirAlta(aux, alta), false);
  assert.equal(L.puedeExportar(aux), true); assert.equal(L.puedeExportar(ana), false);
  assert.equal(L.puedeAdministrar(sup), true); assert.equal(L.puedeAdministrar(aux), false);
  assert.equal(L.puedeRegistrar(aux), false, "el auxiliar no registra gastos");
  assert.equal(L.puedeVer(null, g), false);
});

prueba("validarGasto: orden de los mensajes", () => {
  assert.equal(L.validarGasto(base, ctx), "");
  assert.match(L.validarGasto({ ...base, centroId: "zz" }, ctx), /centro de costo/);
  assert.match(L.validarGasto({ ...base, categoria: "" }, ctx), /categoría/);
  assert.match(L.validarGasto({ ...base, monto: "" }, ctx), /valor/);
  assert.match(L.validarGasto({ ...base, monto: 0 }, ctx), /mayor que cero/);
  assert.match(L.validarGasto({ ...base, monto: 90000000 }, ctx), /demasiado grande/);
  assert.match(L.validarGasto({ ...base, iva: -1 }, ctx), /IVA/);
  assert.match(L.validarGasto({ ...base, iva: 40000 }, ctx), /IVA no puede/);
  assert.match(L.validarGasto({ ...base, descripcion: "  " }, ctx), /descripción/);
  assert.match(L.validarGasto({ ...base, descripcion: "x".repeat(81) }, ctx), /80/);
  assert.match(L.validarGasto({ ...base, fecha: "2026-02-31" }, ctx), /fecha válida/);
  assert.match(L.validarGasto({ ...base, fecha: "2026-10-12" }, ctx), /futura/);
  assert.match(L.validarGasto({ ...base, fecha: "2026-07-01" }, ctx), /60 días/);
  assert.match(L.validarGasto({ ...base, ciudad: " " }, ctx), /ciudad/);
  assert.match(L.validarGasto({ ...base, proveedorNit: "abc" }, ctx), /NIT/);
  assert.equal(L.validarGasto({ ...base, proveedorNit: "900.123.456-7" }, ctx), "");
});

prueba("la foto es obligatoria desde 50.000", () => {
  assert.equal(L.validarGasto({ ...base, monto: 49999 }, ctx), "");
  assert.match(L.validarGasto({ ...base, monto: 50000 }, ctx), /foto/);
  assert.equal(L.validarGasto({ ...base, monto: 50000 }, { ...ctx, tieneFoto: true }), "");
});

prueba("crearGasto: forma, redondeo, id estable y ubicación", () => {
  const g = nuevo({ monto: "35000.4", iva: "5588.6", lat: 6.25, lng: -75.56, precisionM: 18 });
  assert.equal(g.monto, 35000); assert.equal(g.iva, 5589); assert.equal(g.estado, "enviado");
  assert.match(g.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(g.ubicacionMotivo, ""); assert.equal(g.vendedorId, "u-ana");
  const otro = nuevo({ id: g.id }); assert.equal(otro.id, g.id, "mismo id al reenviar");
  assert.equal(nuevo().ubicacionMotivo, "no disponible", "sin GPS queda anotado");
  assert.equal(nuevo({ ubicacionMotivo: "permiso denegado" }).ubicacionMotivo, "permiso denegado");
  assert.equal(nuevo({ proveedorNit: "900.123.456-7" }).proveedorNit, "900123456-7");
});

prueba("duplicados: factura bloquea, parecido avisa", () => {
  const a = nuevo({ proveedorNit: "900123456-7", facturaNumero: "F-100" });
  assert.equal(L.detectarDuplicado([a], nuevo({ proveedorNit: "900.123.456-7", facturaNumero: "f-100", monto: 99 }, luis))?.tipo, "factura", "otro vendedor, misma factura");
  assert.equal(L.detectarDuplicado([a], nuevo({ proveedorNit: "900123456-7", facturaNumero: "F-101" }))?.tipo, "parecido");
  assert.equal(L.detectarDuplicado([a], nuevo({ monto: 11111 })), null);
  assert.equal(L.detectarDuplicado([a], { ...a }), null, "no se compara consigo mismo");
  assert.equal(L.detectarDuplicado([{ ...a, estado: "rechazado" }], nuevo({ proveedorNit: "900123456-7", facturaNumero: "F-100", monto: 7 })), null, "un rechazado no cuenta");
});

prueba("tope diario por categoría", () => {
  const previos = [nuevo({ monto: 40000 })];
  assert.equal(L.alertaTope(previos, nuevo({ monto: 15000 })), "");
  assert.match(L.alertaTope(previos, nuevo({ monto: 25000 })), /tope diario/);
  assert.equal(L.alertaTope(previos, nuevo({ monto: 25000, fecha: "2026-10-09" })), "", "otro día");
  assert.equal(L.alertaTope(previos, nuevo({ categoria: "peajes", monto: 99999 })), "", "peajes no tienen tope");
  assert.equal(L.alertaTope(previos, nuevo({ monto: 25000 }, luis)), "", "otro vendedor");
});

prueba("filtros, totales y resumen", () => {
  const gs = [
    { ...nuevo({ monto: 30000, centroId: "c1" }), estado: "alta" },
    { ...nuevo({ monto: 20000, centroId: "c2", fecha: "2026-10-05" }, luis), estado: "enviado" },
    { ...nuevo({ monto: 10000, centroId: "c1", ciudad: "Cali" }, luis), estado: "rechazado" },
    { ...nuevo({ monto: 5000, centroId: "c1", fecha: "2026-09-30" }), estado: "alta" }
  ];
  assert.equal(L.filtrarGastos(gs, { vendedorId: "u-luis" }).length, 2);
  assert.equal(L.filtrarGastos(gs, { centroId: "c1", estado: "alta" }).length, 2);
  assert.equal(L.filtrarGastos(gs, { desde: "2026-10-01", hasta: "2026-10-10" }).length, 3);
  assert.equal(L.filtrarGastos(gs, { ciudad: "cali" }).length, 1);
  assert.equal(L.filtrarGastos(gs, { texto: "ANA" }).length, 2);
  const t = L.totalesPor(gs.filter((g) => g.estado !== "rechazado"), "vendedorId", (k, g) => g.vendedorNombre);
  assert.deepEqual(t.map((f) => [f.nombre, f.total, f.cantidad]), [["Ana Gómez", 35000, 2], ["Luis Pérez", 20000, 1]]);
  const r = L.resumenGeneral(gs, HOY);
  assert.deepEqual([r.porAltaCantidad, r.porAltaTotal, r.altaMesCantidad, r.altaMesTotal, r.rechazados, r.vigentesTotal], [1, 20000, 1, 30000, 1, 55000]);
  assert.equal(L.ordenarPorFecha(gs)[0].fecha, "2026-10-10");
});

prueba("hojas del Excel: filas, totales y cruces", () => {
  const gs = [
    { ...nuevo({ monto: 30000, iva: 4790, proveedorNit: "900123456-7", facturaNumero: "A1", lat: 6.2, lng: -75.5 }), estado: "alta", altaPor: "Marta Auxiliar", altaEn: "2026-10-11T20:00:00Z" },
    { ...nuevo({ monto: 20000, centroId: "c2" }, luis), estado: "alta" }
  ];
  const ctxX = { centrosPorId: { c1: centros[0], c2: centros[1] }, usuariosPorId: { "u-ana": ana, "u-luis": luis } };
  const hojas = L.hojasExcel(gs, ctxX);
  assert.deepEqual(hojas.map((h) => h.nombre), ["Detalle", "Por vendedor", "Por centro de costo", "Vendedor y centro"]);
  const d = hojas[0];
  for (const f of d.filas) assert.equal(f.length, d.columnas.length, "cada fila tiene tantas celdas como columnas");
  assert.equal(d.filas[0][3], "CC-101"); assert.equal(d.filas[0][11], 30000); assert.equal(d.filas[0][13], 25210);
  assert.match(d.filas[0][19], /^https:\/\/www\.google\.com\/maps\?q=6\.2,-75\.5$/);
  assert.equal(d.filas[1][19], "", "sin ubicación no hay enlace");
  assert.deepEqual(hojas[1].filas.map((f) => [f[0], f[1], f[2], f[3]]), [["Ana Gómez", "1010", 1, 30000], ["Luis Pérez", "2020", 1, 20000]]);
  assert.deepEqual(hojas[2].filas.map((f) => [f[0], f[3]]), [["CC-101", 30000], ["CC-102", 20000]]);
  assert.equal(hojas[3].filas.length, 2);
  for (const h of hojas) for (const f of h.filas) assert.equal(f.length, h.columnas.length);
  assert.equal(L.nombreArchivoExcel(HOY, "Solo dados de alta"), "ViaticoYa_2026-10-11_solo-dados-de-alta.xlsx");
  assert.equal(L.nombreArchivoExcel(HOY), "ViaticoYa_2026-10-11.xlsx");
});

prueba("administración: validar usuarios y centros", () => {
  const us = [{ id: "1", correo: "a@x.com" }];
  assert.match(L.validarUsuario({ nombre: "Al", correo: "a@x.com", rol: "vendedor" }, us), /nombre/);
  assert.match(L.validarUsuario({ nombre: "Ana Gómez", correo: "mal", rol: "vendedor" }, us), /correo/);
  assert.match(L.validarUsuario({ nombre: "Ana Gómez", correo: "A@x.com", rol: "vendedor" }, us), /Ya existe/);
  assert.match(L.validarUsuario({ nombre: "Ana Gómez", correo: "b@x.com", rol: "x" }, us), /rol/);
  assert.match(L.validarUsuario({ nombre: "Ana Gómez", correo: "b@x.com", rol: "vendedor", cedula: "12" }, us), /cédula/);
  assert.match(L.validarUsuario({ nombre: "Ana Gómez", correo: "b@x.com", rol: "vendedor", cedula: "1.010.101", clave: "123" }, us), /6 caracteres/);
  assert.equal(L.validarUsuario({ nombre: "Ana Gómez", correo: "b@x.com", rol: "vendedor", cedula: "1.010.101", clave: "123456" }, us), "");
  assert.equal(L.validarUsuario({ nombre: "Marta Aux", correo: "m@x.com", rol: "auxiliar", clave: "123456" }, us), "", "el auxiliar no necesita cédula");
  assert.equal(L.validarUsuario({ nombre: "Ana Gómez", correo: "a@x.com", rol: "vendedor", cedula: "1010101" }, us, "1"), "", "editar sin cambiar la clave");
  const cs = [{ id: "c1", codigo: "CC-101" }];
  assert.match(L.validarCentro({ codigo: "x", nombre: "Ventas" }, cs), /código/);
  assert.match(L.validarCentro({ codigo: "cc-101", nombre: "Ventas" }, cs), /Ya existe/);
  assert.match(L.validarCentro({ codigo: "CC-5", nombre: "V" }, cs), /nombre/);
  assert.equal(L.validarCentro({ codigo: "CC-101", nombre: "Ventas Norte" }, cs, "c1"), "");
});

prueba("dictado: monto, fecha, ciudad, categoría y descripción", () => {
  const d = (t) => L.parsearDictado(t, HOY);
  let r = d("almuerzo 35 mil en Medellín ayer");
  assert.deepEqual([r.monto, r.fecha, r.ciudad, r.categoria, r.descripcion], [35000, "2026-10-10", "Medellín", "alimentacion", "Almuerzo"]);
  r = d("pagué quince mil de taxi hoy"); assert.deepEqual([r.monto, r.fecha, r.categoria], [15000, HOY, "transporte"]);
  r = d("hotel en Cali ciento ochenta mil el 5 de octubre"); assert.deepEqual([r.monto, r.fecha, r.ciudad, r.categoria], [180000, "2026-10-05", "Cali", "hospedaje"]);
  r = d("peaje cuatro mil quinientos"); assert.deepEqual([r.monto, r.categoria, r.fecha], [4500, "peajes", null]);
  r = d("gasolina 120 lucas anteayer"); assert.deepEqual([r.monto, r.categoria, r.fecha], [120000, "combustible", "2026-10-09"]);
  r = d("tiquete a Bogotá 85.000 hace 3 días"); assert.deepEqual([r.monto, r.categoria, r.ciudad, r.fecha], [85000, "tiquetes", "Bogotá", "2026-10-08"]);
  r = d("cena con cliente 150000 el 03/10/2026"); assert.deepEqual([r.monto, r.fecha], [150000, "2026-10-03"]);
  r = d("hola buenas"); assert.deepEqual([r.monto, r.categoria, r.ciudad, r.fecha], [null, null, null, null]);
  assert.equal(d("").monto, null); assert.equal(d(null).descripcion, "");
  assert.equal(d("gasté 50 pesos").monto, null, "montos menores a 100 no se inventan");
  assert.equal(d("almuerzo 35 mil el 31 de febrero").fecha, null);
});

prueba("formatos", () => {
  assert.equal(L.formatearDinero(15000).replace(/\s/g, " "), "$ 15.000");
  assert.equal(L.formatearFecha("2026-10-10"), "10 oct 2026");
  assert.equal(L.iniciales("Ana Gómez Ruiz"), "AG");
  assert.equal(L.saludoSegunHora(8), "Buenos días"); assert.equal(L.saludoSegunHora(15), "Buenas tardes"); assert.equal(L.saludoSegunHora(21), "Buenas noches");
  assert.equal(L.formatearFechaHora(null), "");
  assert.equal(L.sumarDias("2026-03-01", -1), "2026-02-28");
});

prueba("predicción: ciudad por GPS y distancia", () => {
  assert.equal(L.ciudadMasCercana(6.2442, -75.5812), "Medellín");
  assert.equal(L.ciudadMasCercana(6.20, -75.57), "Medellín", "El Poblado");
  assert.equal(L.ciudadMasCercana(4.65, -74.1), "Bogotá");
  assert.equal(L.ciudadMasCercana(6.171, -75.591), "Envigado", "el centro de Envigado sí es Envigado");
  assert.equal(L.ciudadMasCercana(6.338, -75.558), "Bello");
  assert.equal(L.ciudadMasCercana(0, 0), "", "en el mar no se inventa una ciudad");
  assert.equal(L.ciudadMasCercana(5.9, -74.0), "", "en el campo, lejos de todo, no adivina");
  assert.equal(L.ciudadMasCercana(NaN, 1), "");
  assert.ok(Math.abs(L.distanciaKm(6.244, -75.581, 4.711, -74.072) - 238) < 10, "Medellín–Bogotá ≈ 238 km en línea recta");
  for (const c of L.CIUDADES) assert.ok(L.COORDENADAS_CIUDADES[c], `falta coordenada de ${c}`);
});

prueba("predicción: historial, plantillas y valor habitual", () => {
  const h = (id, desc, monto, cat = "alimentacion", extra = {}) => ({ ...nuevo({ descripcion: desc, monto, categoria: cat, fecha: L.sumarDias(HOY, -id), ...extra }), id: `h${id}-${desc}` });
  const hist = [h(1, "Almuerzo con cliente", 40000, "alimentacion", { proveedorNit: "900123456-7" }), h(2, "Almuerzo con cliente", 44000, "alimentacion", { proveedorNit: "900123456-7" }), h(3, "Almuerzo con cliente", 42000), h(4, "Taxi al cliente", 15000, "transporte"), { ...h(5, "Cena", 999999), estado: "rechazado" }];
  assert.equal(L.montoTipico(hist, ana.id, "alimentacion"), 42000);
  assert.equal(L.montoTipico(hist, ana.id, "transporte"), null, "con 1 gasto no hay tendencia");
  assert.equal(L.montoTipico(hist, luis.id, "alimentacion"), null, "no mezcla personas");
  const pl = L.plantillasFrecuentes(hist, ana.id, 3);
  assert.equal(pl[0].descripcion, "Almuerzo con cliente"); assert.equal(pl[0].veces, 3); assert.equal(pl[0].monto, 42000);
  assert.ok(!pl.some((p) => p.descripcion === "Cena"), "los rechazados no cuentan");
  const s = L.sugerirDesdeHistorial(hist, ana.id, "almuerzo cliente");
  assert.equal(s.categoria, "alimentacion");
  assert.equal(L.sugerirDesdeHistorial(hist, ana.id, "xyz qwerty"), null);
  assert.equal(L.sugerirDesdeHistorial(hist, ana.id, "Almuerzo con cliente").nit, "900123456-7");
  assert.equal(L.sugerirDesdeHistorial(hist, luis.id, "almuerzo con cliente"), null);
  assert.equal(L.sugerirDesdeHistorial([], ana.id, "almuerzo"), null);
});

prueba("alertas de riesgo para contabilidad", () => {
  const h = (i, monto) => ({ ...nuevo({ monto, fecha: L.sumarDias(HOY, -i), descripcion: `Comida ${i}` }), id: `p${i}` });
  const hist = [h(2, 30000), h(3, 32000), h(4, 35000), h(5, 31000)];
  const normal = { ...nuevo({ monto: 33000, lat: 6.24, lng: -75.58, fotoPath: "x/y.jpg", descripcion: "Comida hoy" }), id: "n1" };
  assert.equal(L.riesgoGasto(normal, [...hist, normal], HOY).nivel, "ninguno");
  const raro = { ...nuevo({ monto: 150000, lat: 6.24, lng: -75.58, fotoPath: "x/y.jpg", descripcion: "Comida hoy 2" }), id: "n2" };
  const r = L.riesgoGasto(raro, [...hist, raro], HOY);
  assert.ok(r.alertas.some((a) => a.codigo === "monto_atipico"), "valor muy superior al habitual"); assert.equal(r.nivel, "medio");
  const lejos = { ...nuevo({ monto: 20000, lat: 4.71, lng: -74.07, fotoPath: "x/y.jpg" }), id: "n3" };   // declara Medellín, está en Bogotá
  const rl = L.riesgoGasto(lejos, [lejos], HOY);
  assert.equal(rl.nivel, "alto"); assert.ok(rl.alertas.some((a) => a.codigo === "ubicacion_lejos"));
  const sin = { ...nuevo({ monto: 25000 }), id: "n4" };
  const rs = L.riesgoGasto(sin, [sin], HOY);
  assert.deepEqual(rs.alertas.map((a) => a.codigo).sort(), ["sin_soporte", "sin_ubicacion"]); assert.equal(rs.nivel, "bajo");
  const vieja = { ...nuevo({ fecha: L.sumarDias(HOY, -40), lat: 6.24, lng: -75.58 }), id: "n5" };
  assert.ok(L.riesgoGasto(vieja, [vieja], HOY).alertas.some((a) => a.codigo === "fecha_antigua"));
  assert.equal(L.riesgoGasto(normal, [normal], HOY).alertas.some((a) => a.codigo === "monto_atipico"), false, "sin historial no hay alerta de valor");
});

prueba("proyección del mes", () => {
  const g = (f, m, e = "alta") => ({ ...nuevo({ fecha: f, monto: m }), estado: e });
  const gs = [g("2026-10-01", 100000), g("2026-10-05", 200000), g("2026-10-09", 50000, "rechazado"), g("2026-09-30", 999999)];
  const p = L.proyeccionMes(gs, "2026-10-10");
  assert.equal(p.acumulado, 300000); assert.equal(p.dia, 10); assert.equal(p.diasMes, 31); assert.equal(p.proyectado, 930000);
  assert.equal(L.proyeccionMes(gs, "2026-10-03").proyectado, null, "muy pronto para proyectar");
  assert.equal(L.proyeccionMes(gs, "2026-02-28").diasMes, 28);
});

console.log(`OK: ${n} grupos de pruebas pasaron`);
