/*
 * ui.js — Herramientas de pantalla: crear elementos, avisos, diálogos, foto, ubicación, voz y descargas.
 * No sabe nada de gastos ni de roles: eso está en app.js.
 */
"use strict";

const $ = (selector, raiz = document) => raiz.querySelector(selector);
const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

/** Crea un elemento. props: class, text, dataset, on* (eventos) y cualquier atributo. Los hijos pueden ser texto o nodos. */
function h(etiqueta, props = {}, ...hijos) {
  const e = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    e.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return e;
}

// ---------- avisos (toasts) ----------
function aviso(texto, tipo = "info", ms = 6000) {
  const iconos = { ok: "✔", error: "⚠", info: "ℹ" };
  const nodo = h("div", { class: `aviso ${tipo}`, role: tipo === "error" ? "alert" : "status" }, h("span", { class: "ico", "aria-hidden": "true" }, iconos[tipo] ?? "ℹ"), h("span", { text: texto }));
  const caja = $("#avisos");
  caja.append(nodo);
  while (caja.children.length > 3) caja.firstElementChild.remove();
  setTimeout(() => nodo.remove(), ms);
  return nodo;
}

// ---------- diálogos ----------
function abrir(dlg) { if (!dlg.open) dlg.showModal(); }
function cerrar(dlg) { if (dlg.open) dlg.close(); }
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-cerrar]");
  if (b) cerrar(b.closest("dialog"));
});

function confirmar(texto, { si = "Continuar", titulo = "Confirmar" } = {}) {
  const dlg = $("#dlg-confirmar");
  $("#confirmar-titulo").textContent = titulo;
  $("#confirmar-texto").textContent = texto;
  $("#confirmar-si").textContent = si;
  return new Promise((resolver) => {
    const fin = (v) => { dlg.removeEventListener("close", alCerrar); $("#confirmar-si").onclick = null; $("#confirmar-no").onclick = null; cerrar(dlg); resolver(v); };
    const alCerrar = () => fin(false);
    dlg.addEventListener("close", alCerrar, { once: true });
    $("#confirmar-si").onclick = () => fin(true);
    $("#confirmar-no").onclick = () => fin(false);
    abrir(dlg);
  });
}

// ---------- foto: se reduce antes de guardarla (ahorra datos y espacio) ----------
async function comprimirImagen(archivo, lado = 1280, calidad = 0.72) {
  if (!archivo || !/^image\//.test(archivo.type)) throw new Error("El archivo no es una imagen.");
  let fuente, ancho, alto, liberar = () => {};
  if (typeof createImageBitmap === "function") {
    try {
      fuente = await createImageBitmap(archivo, { imageOrientation: "from-image" });
      ancho = fuente.width; alto = fuente.height; liberar = () => fuente.close?.();
    } catch { fuente = null; }
  }
  if (!fuente) {
    const url = URL.createObjectURL(archivo);
    fuente = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("No se pudo leer la imagen.")); i.src = url; });
    ancho = fuente.naturalWidth; alto = fuente.naturalHeight; liberar = () => URL.revokeObjectURL(url);
  }
  const escala = Math.min(1, lado / Math.max(ancho, alto));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(ancho * escala));
  lienzo.height = Math.max(1, Math.round(alto * escala));
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  liberar();
  const blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", calidad));
  if (!blob) throw new Error("No se pudo preparar la foto.");
  return blob;
}

// ---------- ubicación ----------
/** Devuelve { lat, lng, precisionM } o { motivo }. Nunca lanza. */
function obtenerUbicacion(esperaMs = 12000) {
  return new Promise((resolver) => {
    if (!("geolocation" in navigator)) return resolver({ motivo: "el dispositivo no tiene ubicación" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)), precisionM: Math.round(p.coords.accuracy) }),
      (e) => resolver({ motivo: e.code === 1 ? "permiso de ubicación denegado" : e.code === 3 ? "tiempo agotado buscando la ubicación" : "ubicación no disponible" }),
      { enableHighAccuracy: true, timeout: esperaMs, maximumAge: 60000 }
    );
  });
}

// ---------- voz ----------
const Voz = {
  disponible: () => !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  /** Escucha una frase. Devuelve una función para detener. */
  escuchar({ alTexto, alTerminar, alError }) {
    const Clase = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Clase();
    r.lang = "es-CO"; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
    let texto = "";
    r.onresult = (ev) => { texto = [...ev.results].map((x) => x[0].transcript).join(" ").trim(); };
    r.onerror = (ev) => alError?.(ev.error);
    r.onend = () => { if (texto) alTexto?.(texto); alTerminar?.(!!texto); };
    r.start();
    return () => { try { r.stop(); } catch { /* ya terminó */ } };
  }
};

// ---------- descargas ----------
const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function descargarArchivo(bytes, nombre, tipo = TIPO_XLSX) {
  const blob = new Blob([bytes], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function compartirArchivo(bytes, nombre, tipo = TIPO_XLSX) {
  const archivo = new File([bytes], nombre, { type: tipo });
  if (navigator.canShare?.({ files: [archivo] })) {
    await navigator.share({ files: [archivo], title: nombre });
    return true;
  }
  return false;
}

const puedeCompartirArchivos = () => {
  try { return !!navigator.canShare?.({ files: [new File(["x"], "x.xlsx", { type: TIPO_XLSX })] }); } catch { return false; }
};
