// Genera un .xlsx de prueba con datos reales de la lógica:  node pruebas/xlsx.test.js <salida.xlsx>
"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const X = require("../js/xlsx.js");
const L = require("../js/logica.js");

assert.equal(X.letraDeColumna(0), "A"); assert.equal(X.letraDeColumna(25), "Z"); assert.equal(X.letraDeColumna(26), "AA"); assert.equal(X.letraDeColumna(701), "ZZ"); assert.equal(X.letraDeColumna(702), "AAA");
assert.equal(X.serieDeFecha("1900-03-01"), 61); assert.equal(X.serieDeFecha("2026-10-11"), 46306); assert.equal(X.serieDeFecha("mal"), null);
assert.equal(X.crc32(new TextEncoder().encode("123456789")), 0xcbf43926, "CRC32 estándar");

const ana = { id: "u1", nombre: "Ana Gómez & Cía <test>", rol: "vendedor", cedula: "1010" };
const centros = { c1: { codigo: "CC-101", nombre: "Ventas Antioquia" } };
const g = (extra) => L.crearGasto({ centroId: "c1", categoria: "alimentacion", monto: 35000, iva: 0, descripcion: "Almuerzo \"con\" cliente", fecha: "2026-10-10", ciudad: "Medellín", ...extra }, ana);
const gastos = [g({ lat: 6.25, lng: -75.56 }), g({ monto: 120000, iva: 19160, categoria: "hospedaje", fecha: "2026-10-09", descripcion: "Hotel ñandú — noche 1" })].map((x) => ({ ...x, estado: "alta" }));
const hojas = L.hojasExcel(gastos, { centrosPorId: centros, usuariosPorId: { u1: ana } });
const bytes = X.crearXlsx(hojas, new Date("2026-10-11T15:00:00"));
assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
const sal = process.argv[2];
if (sal) fs.writeFileSync(sal, bytes);
const vacio = X.crearXlsx([{ nombre: "Vacía: [x]/y", columnas: [{ titulo: "A" }], filas: [] }]);
assert.ok(vacio.length > 100);
if (sal) fs.writeFileSync(sal.replace(/\.xlsx$/, "-vacio.xlsx"), vacio);
console.log("OK: xlsx generado,", bytes.length, "bytes");
