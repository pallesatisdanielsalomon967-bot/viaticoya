/*
 * almacen.js — Almacenamiento dentro del celular.
 *  - IndexedDB: cola de envío (gastos con su foto que aún no llegan al servidor), fotos y copia de lo último leído.
 *  - localStorage: sesión y, en modo demostración, el "servidor" de ejemplo.
 * Todo va dentro de try/catch: el navegador puede bloquearlo (modo privado, cuota llena).
 */
"use strict";

const NOMBRE_BD = "viaticoya";
const TIENDAS = ["outbox", "fotos", "cache"];
const LLAVES = { outbox: "id", fotos: "path", cache: "clave" };
let promesaBD = null;

function abrirBD() {
  if (promesaBD) return promesaBD;
  promesaBD = new Promise((resolver, rechazar) => {
    if (typeof indexedDB === "undefined") { rechazar(new Error("IndexedDB no disponible")); return; }
    const pedido = indexedDB.open(NOMBRE_BD, 1);
    pedido.onupgradeneeded = () => {
      for (const t of TIENDAS) if (!pedido.result.objectStoreNames.contains(t)) pedido.result.createObjectStore(t, { keyPath: LLAVES[t] });
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => { promesaBD = null; rechazar(pedido.error); };
  });
  return promesaBD;
}

async function transaccion(tienda, modo, operacion) {
  const bd = await abrirBD();
  return new Promise((resolver, rechazar) => {
    const tx = bd.transaction(tienda, modo);
    const pedido = operacion(tx.objectStore(tienda));
    tx.oncomplete = () => resolver(pedido?.result);
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error ?? new Error("Transacción cancelada"));
  });
}

const idbObtener = (tienda, clave) => transaccion(tienda, "readonly", (s) => s.get(clave));
const idbGuardar = (tienda, valor) => transaccion(tienda, "readwrite", (s) => s.put(valor));
const idbBorrar = (tienda, clave) => transaccion(tienda, "readwrite", (s) => s.delete(clave));
const idbTodos = (tienda) => transaccion(tienda, "readonly", (s) => s.getAll());

// ---------- Copia de lo último leído (para ver datos sin internet) ----------
async function copiaGuardar(clave, valor) {
  try { await idbGuardar("cache", { clave, valor, guardado: new Date().toISOString() }); } catch (e) { console.warn("No se pudo guardar la copia:", e); }
}
async function copiaLeer(clave) {
  try { return (await idbObtener("cache", clave))?.valor ?? null; } catch { return null; }
}

// ---------- localStorage seguro ----------
function leerJSON(clave, porDefecto) {
  try {
    const t = localStorage.getItem(clave);
    return t === null ? porDefecto : JSON.parse(t);
  } catch (e) {
    console.warn(`No se pudo leer "${clave}":`, e);
    return porDefecto;
  }
}
function escribirJSON(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); return true; }
  catch (e) { console.error(`No se pudo guardar "${clave}":`, e); return false; }
}
function borrarClave(clave) { try { localStorage.removeItem(clave); } catch { /* nada */ } }

if (typeof module !== "undefined" && module.exports) {
  module.exports = { abrirBD, idbObtener, idbGuardar, idbBorrar, idbTodos, copiaGuardar, copiaLeer, leerJSON, escribirJSON, borrarClave };
}
