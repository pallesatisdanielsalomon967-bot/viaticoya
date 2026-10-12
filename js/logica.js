/*
 * logica.js — Reglas de ViaticoYa, sin HTML ni almacenamiento: roles y permisos, estados del gasto,
 * validaciones, duplicados, topes, totales, filas para el Excel y lectura de frases dictadas.
 * Se prueba con: node pruebas/logica.test.js
 */
"use strict";

// ============================================================
// 1. Utilidades de texto y números
// ============================================================

/**
 * Convierte "15.000", "15.000,00", "1,234.50" o "$ 15000" en número.
 * En Colombia el punto separa miles y la coma los decimales, pero los recibos mezclan formatos.
 * Devuelve null si no es un número.
 */
function interpretarNumero(texto) {
  let t = String(texto ?? "").replace(/[^\d.,]/g, "");
  if (!/\d/.test(t)) return null;
  const punto = t.lastIndexOf("."), coma = t.lastIndexOf(",");
  if (punto !== -1 && coma !== -1) {
    // Los dos símbolos: el que aparece de último es el decimal
    const decimal = punto > coma ? "." : ",";
    const miles = decimal === "." ? "," : ".";
    t = t.split(miles).join("").replace(decimal, ".");
  } else if (punto !== -1 || coma !== -1) {
    const sep = punto !== -1 ? "." : ",";
    const partes = t.split(sep);
    // "15.000" o "1.234.567" son miles; "15,5" o "15.50" son decimales
    const esMiles = partes.length > 2 || partes[1].length === 3;
    t = esMiles ? partes.join("") : `${partes[0]}.${partes[1]}`;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}


const NUMEROS_UNIDAD = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29
};
const NUMEROS_DECENA = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const NUMEROS_CENTENA = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900
};
const MULTIPLICADORES_MIL = ["mil", "luca", "lucas"];          // "veinte lucas" = 20.000 (jerga colombiana)
const MULTIPLICADORES_MILLON = ["millon", "millones", "palo", "palos"]; // "un palo" = 1.000.000

const MESES_NOMBRES = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6,
  julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sept: 9, sep: 9, octubre: 10, oct: 10,
  noviembre: 11, nov: 11, diciembre: 12, dic: 12
};

const PALABRAS_SUELTAS = new Set([
  "en", "por", "de", "del", "para", "a", "al", "el", "la", "los", "las", "un", "una", "mi", "mis", "con", "que", "y",
  "pesos", "peso", "cop", "plata", "dinero", "hoy", "ayer", "anteayer", "antier", "anoche", "esta", "este", "mas",
  "me", "se", "lo", "fue", "fueron", "es", "son", "como", "ya"
]);
const VERBOS_MOVIMIENTO = new Set([
  "gaste", "gasto", "pague", "pagar", "compre", "comprar", "recibi", "recibo", "cobre", "gane", "pagaron", "pago",
  "consignaron", "depositaron", "transfirieron", "dieron", "vendi", "ahorre", "ahorro", "inverti", "invierto",
  "separe", "meti", "puse", "gastos", "registra", "registrar", "anota", "anotar", "agrega", "agregar", "quiero", "necesito"
]);

function sinTildes(texto) {
  return String(texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function esFichaNumerica(n, siguiente) {
  if (/^\$?\d[\d.,]*k?$/.test(n)) return true;
  if (Object.hasOwn(NUMEROS_UNIDAD, n) || Object.hasOwn(NUMEROS_DECENA, n) || Object.hasOwn(NUMEROS_CENTENA, n)) return true;
  if (MULTIPLICADORES_MIL.includes(n) || MULTIPLICADORES_MILLON.includes(n)) return true;
  return n === "medio" && siguiente === "millon";
}

/** Valor de una tanda de palabras de número: "quince mil quinientos" -> 15500, "2 millones" -> 2000000. */
function valorDeNumeros(fichas) {
  let total = 0, actual = 0;
  for (const f of fichas) {
    if (f === "y") continue;
    if (/^\$?\d/.test(f)) {
      const limpia = f.replace(/^\$/, "");
      if (limpia.endsWith("k")) actual += (interpretarNumero(limpia.slice(0, -1)) ?? 0) * 1000;
      else actual += interpretarNumero(limpia) ?? 0;
    } else if (Object.hasOwn(NUMEROS_UNIDAD, f)) actual += NUMEROS_UNIDAD[f];
    else if (Object.hasOwn(NUMEROS_DECENA, f)) actual += NUMEROS_DECENA[f];
    else if (Object.hasOwn(NUMEROS_CENTENA, f)) actual += NUMEROS_CENTENA[f];
    else if (f === "medio") actual += 0.5;
    else if (MULTIPLICADORES_MIL.includes(f)) { total += (actual || 1) * 1000; actual = 0; }
    else if (MULTIPLICADORES_MILLON.includes(f)) { total += (actual || 1) * 1000000; actual = 0; }
  }
  return Math.round(total + actual);
}


// ============================================================
// 2. Roles, estados y permisos
// ============================================================
// Estos permisos se usan en la pantalla (para mostrar u ocultar botones) Y en el "servidor"
// (adaptador de datos): la pantalla nunca es la única barrera.

const ROLES = { vendedor: "Vendedor", auxiliar: "Auxiliar contable", super: "Superusuario" };
const ESTADOS = {
  pendiente: { texto: "Pendiente de envío", icono: "⏳" },   // solo existe en el celular, sin internet
  enviado:   { texto: "Enviado",             icono: "📤" },
  alta:      { texto: "Dado de alta",        icono: "🔒" },
  rechazado: { texto: "Rechazado",           icono: "↩️" }
};

const esContable = (u) => !!u && (u.rol === "auxiliar" || u.rol === "super");
const puedeVer = (u, g) => !!u && (esContable(u) || g.vendedorId === u.id);
/** El vendedor edita lo suyo mientras no esté dado de alta; el superusuario edita todo; el auxiliar nada. */
const puedeEditar = (u, g) => !!u && (u.rol === "super" || (u.rol === "vendedor" && g.vendedorId === u.id && g.estado !== "alta"));
const puedeDarAlta = (u, g) => esContable(u) && g.estado === "enviado";
const puedeRechazar = (u, g) => esContable(u) && g.estado === "enviado";
const puedeRevertirAlta = (u, g) => !!u && u.rol === "super" && g.estado === "alta";
const puedeExportar = (u) => esContable(u);
const puedeAdministrar = (u) => !!u && u.rol === "super";
const puedeRegistrar = (u) => !!u && (u.rol === "vendedor" || u.rol === "super");

// ============================================================
// 3. Catálogos
// ============================================================

const MONTO_MAXIMO = 50000000;
const FOTO_OBLIGATORIA_DESDE = 50000;   // desde este valor el soporte (foto) es obligatorio
const LARGO_MAXIMO_DESCRIPCION = 80;
const DIAS_MAXIMOS_ATRAS = 60;

const CATEGORIAS = [
  { id: "alimentacion", nombre: "Alimentación", emoji: "🍽️", tope: 60000, palabras: ["almuerzo", "desayuno", "cena", "comida", "restaurante", "cafe", "refrigerio", "corrientazo", "bebida"] },
  { id: "transporte", nombre: "Transporte urbano", emoji: "🚕", tope: 40000, palabras: ["taxi", "uber", "didi", "cabify", "metro", "transmilenio", "mio", "bus urbano", "moto"] },
  { id: "tiquetes", nombre: "Tiquetes intermunicipales", emoji: "🚌", tope: 0, palabras: ["tiquete", "pasaje", "bus", "flota", "avion", "vuelo", "viaje"] },
  { id: "hospedaje", nombre: "Hospedaje", emoji: "🏨", tope: 180000, palabras: ["hotel", "hospedaje", "alojamiento", "hostal", "noche"] },
  { id: "peajes", nombre: "Peajes", emoji: "🛣️", tope: 0, palabras: ["peaje", "peajes"] },
  { id: "combustible", nombre: "Combustible", emoji: "⛽", tope: 0, palabras: ["gasolina", "combustible", "tanqueo", "acpm", "terpel", "primax", "diesel"] },
  { id: "parqueadero", nombre: "Parqueadero", emoji: "🅿️", tope: 30000, palabras: ["parqueadero", "parqueo", "estacionamiento"] },
  { id: "clientes", nombre: "Atención a clientes", emoji: "🤝", tope: 100000, palabras: ["cliente", "clientes", "invitacion", "reunion", "atencion"] },
  { id: "otros", nombre: "Otros", emoji: "📦", tope: 0, palabras: [] }
];
const buscarCategoria = (id) => CATEGORIAS.find((c) => c.id === id) ?? null;

/** Cuenta contable por categoría. Se deja vacía a propósito: la completa el área contable según su plan de cuentas. */
const CUENTA_POR_CATEGORIA = {};

const CIUDADES = [
  "Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga", "Cúcuta", "Pereira", "Manizales", "Armenia",
  "Ibagué", "Santa Marta", "Villavicencio", "Pasto", "Montería", "Neiva", "Popayán", "Valledupar", "Tunja", "Sincelejo",
  "Riohacha", "Florencia", "Quibdó", "Yopal", "Soacha", "Bello", "Itagüí", "Envigado", "Palmira", "Buenaventura", "Rionegro"
];

/** Coordenadas aproximadas (centro urbano) para deducir la ciudad desde el GPS y detectar ubicaciones incoherentes. */
const COORDENADAS_CIUDADES = {
  "Bogotá": [4.711, -74.072], "Medellín": [6.244, -75.581], "Cali": [3.452, -76.532], "Barranquilla": [10.964, -74.796], "Cartagena": [10.391, -75.479],
  "Bucaramanga": [7.119, -73.123], "Cúcuta": [7.894, -72.507], "Pereira": [4.814, -75.696], "Manizales": [5.070, -75.514], "Armenia": [4.534, -75.681],
  "Ibagué": [4.438, -75.232], "Santa Marta": [11.241, -74.199], "Villavicencio": [4.142, -73.627], "Pasto": [1.214, -77.281], "Montería": [8.750, -75.881],
  "Neiva": [2.927, -75.282], "Popayán": [2.444, -76.614], "Valledupar": [10.477, -73.250], "Tunja": [5.535, -73.367], "Sincelejo": [9.304, -75.398],
  "Riohacha": [11.544, -72.907], "Florencia": [1.614, -75.606], "Quibdó": [5.692, -76.658], "Yopal": [5.337, -72.395], "Soacha": [4.579, -74.217],
  "Bello": [6.338, -75.558], "Itagüí": [6.172, -75.612], "Envigado": [6.171, -75.591], "Palmira": [3.539, -76.303], "Buenaventura": [3.883, -77.031],
  "Rionegro": [6.155, -75.374]
};

// ============================================================
// 4. Fechas y dinero
// ============================================================

function aFechaTexto(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}
function aFecha(fechaTexto) {
  const [anio, mes, dia] = fechaTexto.split("-").map(Number);
  return new Date(anio, mes - 1, dia, 12);
}
const fechaDeHoy = () => aFechaTexto(new Date());
function esFechaReal(fechaTexto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaTexto ?? "")) return false;
  const [anio, mes, dia] = fechaTexto.split("-").map(Number);
  if (anio < 2000) return false;
  const f = new Date(anio, mes - 1, dia, 12);
  return f.getFullYear() === anio && f.getMonth() === mes - 1 && f.getDate() === dia;
}
function sumarDias(fechaTexto, cantidad) {
  const f = aFecha(fechaTexto);
  f.setDate(f.getDate() + cantidad);
  return aFechaTexto(f);
}
function formatearFecha(fechaTexto) {
  return aFecha(fechaTexto).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }).replace(/ de /g, " ");
}
function fechaLarga(fecha = new Date()) {
  const t = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(fecha);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function saludoSegunHora(hora) {
  return hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
}
const formatoDinero = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const formatearDinero = (v) => formatoDinero.format(v);
/** "2026-10-11T15:04:00.000Z" -> "11 oct 2026, 10:04 a. m." en la hora del dispositivo. */
function formatearFechaHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/ de /g, " ");
}
/** Mes "AAAA-MM" de una fecha "AAAA-MM-DD". */
const mesDe = (fechaTexto) => fechaTexto.slice(0, 7);

// ============================================================
// 5. Validación y creación de gastos
// ============================================================

/** Quita puntos y espacios de un NIT: "900.123.456-7" -> "900123456-7". */
function normalizarNit(texto) {
  return String(texto ?? "").replace(/[.\s]/g, "");
}

/**
 * Revisa un gasto antes de guardarlo. Devuelve "" si está bien o el mensaje del primer problema.
 * `contexto`: { centros: [{id}], hoy, tieneFoto }.
 */
function validarGasto(datos, contexto) {
  const hoy = contexto.hoy ?? fechaDeHoy();
  if (!contexto.centros.some((c) => c.id === datos.centroId)) return "Elige el centro de costo.";
  if (!buscarCategoria(datos.categoria)) return "Elige una categoría.";
  const monto = Number(datos.monto);
  if (String(datos.monto ?? "").trim() === "" || !Number.isFinite(monto) || monto <= 0) return "El valor debe ser un número mayor que cero.";
  if (monto > MONTO_MAXIMO) return "El valor es demasiado grande. Revisa si escribiste ceros de más.";
  const iva = datos.iva === "" || datos.iva === null || datos.iva === undefined ? 0 : Number(datos.iva);
  if (!Number.isFinite(iva) || iva < 0) return "El IVA debe ser un número igual o mayor que cero.";
  if (iva > monto) return "El IVA no puede ser mayor que el valor total.";
  const descripcion = String(datos.descripcion ?? "").trim();
  if (descripcion === "") return "Escribe una descripción.";
  if (descripcion.length > LARGO_MAXIMO_DESCRIPCION) return `La descripción no puede pasar de ${LARGO_MAXIMO_DESCRIPCION} caracteres.`;
  if (!esFechaReal(datos.fecha)) return "Elige una fecha válida.";
  if (datos.fecha > hoy) return "La fecha no puede ser futura.";
  if (datos.fecha < sumarDias(hoy, -DIAS_MAXIMOS_ATRAS)) return `La fecha no puede ser de hace más de ${DIAS_MAXIMOS_ATRAS} días. Habla con contabilidad.`;
  if (String(datos.ciudad ?? "").trim() === "") return "Escribe la ciudad.";
  const nit = normalizarNit(datos.proveedorNit);
  if (nit !== "" && !/^\d{6,10}(-\d)?$/.test(nit)) return "El NIT del proveedor no parece válido (ej: 900123456-7).";
  if (String(datos.facturaNumero ?? "").trim().length > 30) return "El número de factura es demasiado largo.";
  if (monto >= FOTO_OBLIGATORIA_DESDE && !contexto.tieneFoto) return `Desde ${formatearDinero(FOTO_OBLIGATORIA_DESDE)} la foto de la factura o recibo es obligatoria.`;
  return "";
}

/** UUID v4: lo crea el celular, así reenviar un gasto nunca lo duplica en el servidor. */
function generarId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

/** Arma el registro que se guarda (ya validado). */
function crearGasto(datos, usuario, ahora = new Date()) {
  const iva = datos.iva === "" || datos.iva == null ? 0 : Math.round(Number(datos.iva));
  return {
    id: datos.id ?? generarId(),
    vendedorId: usuario.id,
    vendedorNombre: usuario.nombre,
    centroId: datos.centroId,
    categoria: datos.categoria,
    monto: Math.round(Number(datos.monto)),
    iva,
    descripcion: String(datos.descripcion).trim(),
    fecha: datos.fecha,
    ciudad: String(datos.ciudad).trim(),
    proveedorNit: normalizarNit(datos.proveedorNit),
    facturaNumero: String(datos.facturaNumero ?? "").trim(),
    lat: datos.lat ?? null,
    lng: datos.lng ?? null,
    precisionM: datos.precisionM ?? null,
    ubicacionMotivo: datos.lat == null ? (datos.ubicacionMotivo || "no disponible") : "",
    fotoPath: datos.fotoPath ?? "",
    estado: "enviado",
    creadoDispositivo: datos.creadoDispositivo ?? ahora.toISOString(),
    recibidoServidor: null,
    altaPor: "",
    altaEn: null,
    motivoRechazo: ""
  };
}

/** Choque con un gasto existente. "factura" bloquea; "parecido" solo pide confirmar. */
function detectarDuplicado(gastos, nuevo) {
  const otros = gastos.filter((g) => g.id !== nuevo.id && g.estado !== "rechazado");
  const nit = normalizarNit(nuevo.proveedorNit), fac = String(nuevo.facturaNumero ?? "").trim().toLowerCase();
  if (nit !== "" && fac !== "") {
    const igual = otros.find((g) => normalizarNit(g.proveedorNit) === nit && String(g.facturaNumero ?? "").trim().toLowerCase() === fac);
    if (igual) return { tipo: "factura", gasto: igual };
  }
  const parecido = otros.find((g) => g.vendedorId === nuevo.vendedorId && g.fecha === nuevo.fecha && g.monto === Math.round(Number(nuevo.monto)) && g.categoria === nuevo.categoria);
  return parecido ? { tipo: "parecido", gasto: parecido } : null;
}

/** Aviso si con este gasto se supera el tope diario de la categoría. Devuelve "" si no hay problema. */
function alertaTope(gastos, nuevo) {
  const cat = buscarCategoria(nuevo.categoria);
  if (!cat || !cat.tope) return "";
  const previo = gastos
    .filter((g) => g.id !== nuevo.id && g.estado !== "rechazado" && g.vendedorId === nuevo.vendedorId && g.fecha === nuevo.fecha && g.categoria === nuevo.categoria)
    .reduce((s, g) => s + g.monto, 0);
  const total = previo + Math.round(Number(nuevo.monto));
  return total > cat.tope ? `Con este gasto llevas ${formatearDinero(total)} en ${cat.nombre} ese día; el tope diario es ${formatearDinero(cat.tope)}.` : "";
}

// ============================================================
// 6. Filtros, totales y reportes
// ============================================================

function filtrarGastos(gastos, f = {}) {
  const texto = String(f.texto ?? "").trim().toLowerCase();
  return gastos.filter((g) =>
    (!f.vendedorId || g.vendedorId === f.vendedorId) &&
    (!f.centroId || g.centroId === f.centroId) &&
    (!f.estado || g.estado === f.estado) &&
    (!f.ciudad || g.ciudad.toLowerCase() === String(f.ciudad).toLowerCase()) &&
    (!f.desde || g.fecha >= f.desde) &&
    (!f.hasta || g.fecha <= f.hasta) &&
    (texto === "" || `${g.descripcion} ${g.vendedorNombre} ${g.facturaNumero} ${g.proveedorNit}`.toLowerCase().includes(texto))
  );
}

const ordenarPorFecha = (gastos) => [...gastos].sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.creadoDispositivo).localeCompare(String(a.creadoDispositivo)));
const sumar = (gastos, campo = "monto") => gastos.reduce((s, g) => s + (Number(g[campo]) || 0), 0);

/** Totales agrupados por una clave ("vendedorId", "centroId", "categoria"…). Ordenados de mayor a menor. */
function totalesPor(gastos, clave, nombreDe = (k) => k) {
  const mapa = new Map();
  for (const g of gastos) {
    const fila = mapa.get(g[clave]) ?? { clave: g[clave], nombre: nombreDe(g[clave], g), total: 0, iva: 0, cantidad: 0 };
    fila.total += g.monto;
    fila.iva += g.iva || 0;
    fila.cantidad += 1;
    mapa.set(g[clave], fila);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
}

/** Cifras del tablero de contabilidad. Los rechazados no cuentan como gasto. */
function resumenGeneral(gastos, hoy = fechaDeHoy()) {
  const mes = mesDe(hoy);
  const vigentes = gastos.filter((g) => g.estado !== "rechazado");
  const porAlta = gastos.filter((g) => g.estado === "enviado");
  const altaMes = gastos.filter((g) => g.estado === "alta" && mesDe(g.fecha) === mes);
  return {
    porAltaCantidad: porAlta.length, porAltaTotal: sumar(porAlta),
    altaMesCantidad: altaMes.length, altaMesTotal: sumar(altaMes),
    rechazados: gastos.filter((g) => g.estado === "rechazado").length,
    vigentesTotal: sumar(vigentes)
  };
}

const enlaceMapa = (g) => (g.lat == null || g.lng == null ? "" : `https://www.google.com/maps?q=${g.lat},${g.lng}`);

/**
 * Hojas para el Excel. `ctx`: { centrosPorId: {id: {codigo, nombre}}, usuariosPorId: {id: {nombre, cedula}} }.
 * Cada hoja: { nombre, columnas: [{ titulo, ancho, tipo }], filas: [[...]], totales?: [indices de columnas a sumar] }.
 */
function hojasExcel(gastos, ctx) {
  const centro = (g) => ctx.centrosPorId[g.centroId] ?? { codigo: "?", nombre: "(centro eliminado)" };
  const cedula = (g) => ctx.usuariosPorId[g.vendedorId]?.cedula ?? "";
  const ordenados = [...gastos].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.vendedorNombre.localeCompare(b.vendedorNombre));
  const detalle = {
    nombre: "Detalle",
    columnas: [
      { titulo: "Fecha", ancho: 12, tipo: "fecha" }, { titulo: "Vendedor", ancho: 26 }, { titulo: "Cédula", ancho: 14 },
      { titulo: "Código centro de costo", ancho: 16 }, { titulo: "Centro de costo", ancho: 24 }, { titulo: "Ciudad", ancho: 16 },
      { titulo: "Categoría", ancho: 24 }, { titulo: "Cuenta contable", ancho: 16 }, { titulo: "Descripción", ancho: 40 },
      { titulo: "NIT proveedor", ancho: 15 }, { titulo: "N° factura", ancho: 14 },
      { titulo: "Valor total (COP)", ancho: 17, tipo: "dinero" }, { titulo: "IVA (COP)", ancho: 13, tipo: "dinero" }, { titulo: "Base sin IVA (COP)", ancho: 17, tipo: "dinero" },
      { titulo: "Estado", ancho: 14 }, { titulo: "Dado de alta por", ancho: 22 }, { titulo: "Fecha de alta", ancho: 20 },
      { titulo: "Latitud", ancho: 11, tipo: "decimal" }, { titulo: "Longitud", ancho: 11, tipo: "decimal" }, { titulo: "Mapa", ancho: 30 },
      { titulo: "Foto del soporte", ancho: 14 }, { titulo: "ID del gasto", ancho: 38 }
    ],
    filas: ordenados.map((g) => [
      g.fecha, g.vendedorNombre, cedula(g), centro(g).codigo, centro(g).nombre, g.ciudad,
      buscarCategoria(g.categoria)?.nombre ?? g.categoria, CUENTA_POR_CATEGORIA[g.categoria] ?? "", g.descripcion,
      g.proveedorNit, g.facturaNumero, g.monto, g.iva || 0, g.monto - (g.iva || 0),
      ESTADOS[g.estado]?.texto ?? g.estado, g.altaPor || "", g.altaEn ? formatearFechaHora(g.altaEn) : "",
      g.lat ?? "", g.lng ?? "", enlaceMapa(g), g.fotoPath ? "Sí" : "No", g.id
    ]),
    totales: [11, 12, 13]
  };
  const porVendedor = {
    nombre: "Por vendedor",
    columnas: [{ titulo: "Vendedor", ancho: 28 }, { titulo: "Cédula", ancho: 14 }, { titulo: "N° gastos", ancho: 11, tipo: "entero" }, { titulo: "Valor total (COP)", ancho: 18, tipo: "dinero" }, { titulo: "IVA (COP)", ancho: 14, tipo: "dinero" }],
    filas: totalesPor(ordenados, "vendedorId", (k, g) => g.vendedorNombre).map((f) => [f.nombre, ctx.usuariosPorId[f.clave]?.cedula ?? "", f.cantidad, f.total, f.iva]),
    totales: [2, 3, 4]
  };
  const porCentro = {
    nombre: "Por centro de costo",
    columnas: [{ titulo: "Código", ancho: 12 }, { titulo: "Centro de costo", ancho: 28 }, { titulo: "N° gastos", ancho: 11, tipo: "entero" }, { titulo: "Valor total (COP)", ancho: 18, tipo: "dinero" }, { titulo: "IVA (COP)", ancho: 14, tipo: "dinero" }],
    filas: totalesPor(ordenados, "centroId", (k) => (ctx.centrosPorId[k]?.nombre ?? "(centro eliminado)")).map((f) => [ctx.centrosPorId[f.clave]?.codigo ?? "?", f.nombre, f.cantidad, f.total, f.iva]),
    totales: [2, 3, 4]
  };
  const cruce = new Map();
  for (const g of ordenados) {
    const k = `${g.vendedorId}|${g.centroId}`;
    const f = cruce.get(k) ?? { v: g.vendedorNombre, c: centro(g), n: 0, t: 0 };
    f.n += 1; f.t += g.monto; cruce.set(k, f);
  }
  const vendedorYCentro = {
    nombre: "Vendedor y centro",
    columnas: [{ titulo: "Vendedor", ancho: 28 }, { titulo: "Código centro", ancho: 14 }, { titulo: "Centro de costo", ancho: 28 }, { titulo: "N° gastos", ancho: 11, tipo: "entero" }, { titulo: "Valor total (COP)", ancho: 18, tipo: "dinero" }],
    filas: [...cruce.values()].sort((a, b) => a.v.localeCompare(b.v) || a.c.codigo.localeCompare(b.c.codigo)).map((f) => [f.v, f.c.codigo, f.c.nombre, f.n, f.t]),
    totales: [3, 4]
  };
  return [detalle, porVendedor, porCentro, vendedorYCentro];
}

/** "ViaticoYa_2026-10-11_alta.xlsx": sin tildes ni espacios. */
function nombreArchivoExcel(hoy, etiqueta = "") {
  const limpio = sinTildes(etiqueta).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `ViaticoYa_${hoy}${limpio ? `_${limpio}` : ""}.xlsx`;
}

// ============================================================
// 7. Validación de usuarios y centros (administración)
// ============================================================

const REGLA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizarCorreo = (c) => String(c ?? "").trim().toLowerCase();

function validarUsuario(d, existentes, idActual = null) {
  if (String(d.nombre ?? "").trim().length < 3) return "Escribe el nombre completo.";
  if (!REGLA_CORREO.test(normalizarCorreo(d.correo))) return "Escribe un correo válido.";
  if (existentes.some((u) => u.id !== idActual && normalizarCorreo(u.correo) === normalizarCorreo(d.correo))) return "Ya existe un usuario con ese correo.";
  if (!ROLES[d.rol]) return "Elige el rol.";
  if (d.rol === "vendedor" && !/^\d{5,12}$/.test(String(d.cedula ?? "").replace(/[.\s]/g, ""))) return "Escribe la cédula del vendedor (solo números).";
  if (idActual === null && String(d.clave ?? "").length < 6) return "La contraseña debe tener mínimo 6 caracteres.";
  return "";
}

function validarCentro(d, existentes, idActual = null) {
  const codigo = String(d.codigo ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,12}$/.test(codigo)) return "El código usa 2 a 12 letras, números o guion (ej: CC-101).";
  if (String(d.nombre ?? "").trim().length < 3) return "Escribe el nombre del centro de costo.";
  if (existentes.some((c) => c.id !== idActual && c.codigo.toUpperCase() === codigo)) return "Ya existe un centro con ese código.";
  return "";
}

const iniciales = (nombre) => String(nombre ?? "").trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "?";

// ============================================================
// 8. Dictado: de una frase ("almuerzo 35 mil en Medellín ayer") a los datos del gasto
// ============================================================

/** Categoría que mejor encaja con el texto, o null. */
function sugerirCategoria(texto) {
  const t = ` ${sinTildes(texto)} `;
  let mejor = null, largo = 0;
  for (const c of CATEGORIAS) {
    for (const p of c.palabras) {
      if (t.includes(` ${p}`) && p.length > largo) { mejor = c.id; largo = p.length; }
    }
  }
  return mejor;
}

function ciudadEnTexto(texto) {
  const t = ` ${sinTildes(texto)} `;
  return CIUDADES.find((c) => t.includes(` ${sinTildes(c)} `) || t.includes(` ${sinTildes(c)},`)) ?? null;
}

/** Fecha "dd/mm/aaaa" -> "AAAA-MM-DD" si es real y no futura. */
function fechaNumerica(texto, hoy) {
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})$/.exec(texto);
  if (!m) return null;
  const f = `${m[3].length === 2 ? 2000 + +m[3] : +m[3]}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  return esFechaReal(f) && f <= hoy ? f : null;
}

/** Devuelve { monto, fecha, descripcion, categoria, ciudad }. Lo que no se entiende queda en null o "": nunca se inventa. */
function parsearDictado(texto, hoy = fechaDeHoy()) {
  const original = String(texto ?? "").trim();
  const fichas = original.split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  const norm = fichas.map((t) => sinTildes(t).replace(/^\$(?=\D)/, ""));
  const usada = new Array(fichas.length).fill(false);

  let fecha = null;
  for (let i = 0; i < norm.length && fecha === null; i++) {
    const n = norm[i];
    if (n === "hoy") { fecha = hoy; usada[i] = true; }
    else if (n === "ayer" || n === "anoche") { fecha = sumarDias(hoy, -1); usada[i] = true; }
    else if (n === "anteayer" || n === "antier") { fecha = sumarDias(hoy, -2); usada[i] = true; }
    else if (n === "hace" && /^(dia|dias|semana|semanas)$/.test(norm[i + 2] ?? "")) {
      const cuantos = /^\d+$/.test(norm[i + 1]) ? Number(norm[i + 1]) : NUMEROS_UNIDAD[norm[i + 1]];
      if (cuantos !== undefined) {
        fecha = sumarDias(hoy, -cuantos * (norm[i + 2].startsWith("semana") ? 7 : 1));
        usada[i] = usada[i + 1] = usada[i + 2] = true;
      }
    } else if (/^\d{1,2}$/.test(n)) {
      let k = i + 1;
      if (norm[k] === "de") k++;
      const mes = MESES_NOMBRES[norm[k]];
      if (mes) {
        let anio = Number(hoy.slice(0, 4)), fin = k;
        if (norm[k + 1] === "de" && /^\d{4}$/.test(norm[k + 2] ?? "")) { anio = Number(norm[k + 2]); fin = k + 2; }
        else if (/^\d{4}$/.test(norm[k + 1] ?? "")) { anio = Number(norm[k + 1]); fin = k + 1; }
        let candidata = `${anio}-${String(mes).padStart(2, "0")}-${String(Number(n)).padStart(2, "0")}`;
        if (fin === k && candidata > hoy) candidata = `${anio - 1}${candidata.slice(4)}`;
        if (esFechaReal(candidata) && candidata <= hoy) { fecha = candidata; for (let u = i; u <= fin; u++) usada[u] = true; }
      }
    } else {
      const f = fechaNumerica(n, hoy);
      if (f) { fecha = f; usada[i] = true; }
    }
  }

  // Ciudad: se marca para que no se cuente como descripción ni como monto
  const ciudad = ciudadEnTexto(original);
  if (ciudad) {
    const partes = sinTildes(ciudad).split(" ");
    for (let i = 0; i + partes.length <= norm.length; i++) {
      if (partes.every((p, j) => norm[i + j] === p)) { for (let j = 0; j < partes.length; j++) usada[i + j] = true; break; }
    }
  }

  let mejor = null;
  for (let i = 0; i < norm.length; i++) {
    if (usada[i] || !esFichaNumerica(norm[i], norm[i + 1])) continue;
    let fin = i;
    while (fin + 1 < norm.length && !usada[fin + 1] &&
      (esFichaNumerica(norm[fin + 1], norm[fin + 2]) ||
        (norm[fin + 1] === "y" && fin + 2 < norm.length && esFichaNumerica(norm[fin + 2], norm[fin + 3])))) fin++;
    const valor = valorDeNumeros(norm.slice(i, fin + 1));
    if (valor >= 100 && valor <= MONTO_MAXIMO && (mejor === null || valor > mejor.valor)) mejor = { valor, inicio: i, fin };
    i = fin;
  }

  const limpiar = (lista) => {
    const palabras = lista.filter(([i]) => !usada[i]).map(([, t, n]) => [t, n]);
    while (palabras.length > 0 && (PALABRAS_SUELTAS.has(palabras[0][1]) || VERBOS_MOVIMIENTO.has(palabras[0][1]))) palabras.shift();
    return palabras.filter(([, n]) => !PALABRAS_SUELTAS.has(n) || n === "y").map(([t]) => t);
  };
  let descripcion = "";
  if (mejor) {
    const todas = fichas.map((t, i) => [i, t, norm[i]]);
    const despues = limpiar(todas.slice(mejor.fin + 1));
    const antes = limpiar(todas.slice(0, mejor.inicio).filter(([, , n]) => !VERBOS_MOVIMIENTO.has(n)));
    descripcion = (despues.length > 0 ? despues : antes).slice(0, 8).join(" ");
  } else {
    descripcion = limpiar(fichas.map((t, i) => [i, t, norm[i]]).filter(([, , n]) => !VERBOS_MOVIMIENTO.has(n))).slice(0, 8).join(" ");
  }
  descripcion = descripcion.charAt(0).toUpperCase() + descripcion.slice(1);
  return {
    monto: mejor ? mejor.valor : null,
    fecha,
    descripcion: descripcion.slice(0, LARGO_MAXIMO_DESCRIPCION),
    categoria: sugerirCategoria(original),
    ciudad
  };
}

// ============================================================
// 9. Predicción y alertas (aprende del historial; sin servidores ni IA externa)
// ============================================================

const mediana = (nums) => {
  const v = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
const clave = (texto) => sinTildes(String(texto ?? "")).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Distancia en km entre dos puntos (fórmula de haversine). */
function distanciaKm(lat1, lng1, lat2, lng2) {
  const rad = (g) => (g * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Radio aproximado (km) de cada ciudad: sirve para no confundir una capital con los municipios pegados a ella. */
const RADIO_CIUDAD = { "Bogotá": 25, "Medellín": 12, "Cali": 15, "Barranquilla": 12, "Cartagena": 10, "Soacha": 5, "Bello": 5, "Itagüí": 4, "Envigado": 4, "Palmira": 6, "Rionegro": 6 };

/** Ciudad de la lista donde parece estar el punto (relativo al tamaño de cada ciudad), o "" si no cae en ninguna. Es una sugerencia. */
function ciudadMasCercana(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  let mejor = "", razon = Infinity;
  for (const [nombre, [la, lo]] of Object.entries(COORDENADAS_CIUDADES)) {
    const radio = RADIO_CIUDAD[nombre] ?? 8;
    const r = distanciaKm(lat, lng, la, lo) / radio;
    if (r <= 1.6 && r < razon) { razon = r; mejor = nombre; }
  }
  return mejor;
}

const delVendedor = (gastos, vendedorId) => gastos.filter((g) => g.vendedorId === vendedorId && g.estado !== "rechazado");

/** Valor habitual (mediana) de la persona en una categoría. Necesita al menos 2 gastos previos. */
function montoTipico(gastos, vendedorId, categoria) {
  const m = delVendedor(gastos, vendedorId).filter((g) => g.categoria === categoria).map((g) => g.monto);
  return m.length >= 2 ? mediana(m) : null;
}

/** Gastos que la persona repite: { categoria, descripcion, monto, ciudad, nit, centroId, veces }, los más usados primero. */
function plantillasFrecuentes(gastos, vendedorId, max = 4) {
  const grupos = new Map();
  for (const g of ordenarPorFecha(delVendedor(gastos, vendedorId))) {
    const k = `${g.categoria}|${clave(g.descripcion)}`;
    const x = grupos.get(k) ?? { categoria: g.categoria, descripcion: g.descripcion, montos: [], ciudad: g.ciudad, nit: g.proveedorNit, centroId: g.centroId, veces: 0, reciente: g.fecha };
    x.montos.push(g.monto); x.veces++;
    grupos.set(k, x);
  }
  return [...grupos.values()]
    .sort((a, b) => b.veces - a.veces || b.reciente.localeCompare(a.reciente))
    .slice(0, max)
    .map(({ montos, reciente, ...r }) => ({ ...r, monto: mediana(montos) }));
}

/** Con lo que la persona escribe, propone categoría, valor y NIT según su historial. Devuelve null si no hay parecido. */
function sugerirDesdeHistorial(gastos, vendedorId, texto) {
  const palabras = new Set(clave(texto).split(" ").filter((p) => p.length >= 3));
  if (!palabras.size) return null;
  let mejor = null;
  const historial = delVendedor(gastos, vendedorId);
  for (const g of historial) {
    const otras = new Set(clave(g.descripcion).split(" ").filter((p) => p.length >= 3));
    if (!otras.size) continue;
    const comunes = [...palabras].filter((p) => otras.has(p)).length;
    const puntaje = comunes / Math.max(palabras.size, otras.size);
    if (comunes > 0 && puntaje >= 0.5 && (!mejor || puntaje > mejor.puntaje)) mejor = { puntaje, categoria: g.categoria };
  }
  if (!mejor) return null;
  const iguales = historial.filter((g) => g.categoria === mejor.categoria && clave(g.descripcion) === clave(texto));
  const base = iguales.length ? iguales : historial.filter((g) => g.categoria === mejor.categoria && [...palabras].some((p) => clave(g.descripcion).split(" ").includes(p)));
  const nits = [...new Set(base.map((g) => g.proveedorNit).filter(Boolean))];
  return { categoria: mejor.categoria, monto: iguales.length ? mediana(iguales.map((g) => g.monto)) : null, nit: nits.length === 1 ? nits[0] : "", coincidencias: base.length };
}

const NIVELES = ["ninguno", "bajo", "medio", "alto"];

/**
 * Alertas de un gasto para quien lo revisa. `gastos` = historial completo; `hoy` = fecha de hoy.
 * Devuelve { alertas: [{ codigo, nivel, texto }], nivel: "ninguno" | "bajo" | "medio" | "alto" }.
 */
function riesgoGasto(g, gastos, hoy = fechaDeHoy()) {
  const alertas = [];
  const previos = delVendedor(gastos, g.vendedorId).filter((x) => x.id !== g.id && x.categoria === g.categoria);
  if (previos.length >= 3) {
    const m = mediana(previos.map((x) => x.monto));
    if (g.monto > m * 2.5 && g.monto - m > 30000) alertas.push({ codigo: "monto_atipico", nivel: "medio", texto: `Valor ${(g.monto / m).toFixed(1)} veces lo habitual de ${g.vendedorNombre} en ${buscarCategoria(g.categoria)?.nombre ?? g.categoria} (${formatearDinero(m)}).` });
  }
  const tope = alertaTope(gastos, g);
  if (tope) alertas.push({ codigo: "tope", nivel: "medio", texto: tope });
  const dup = detectarDuplicado(gastos, g);
  if (dup?.tipo === "parecido") alertas.push({ codigo: "parecido", nivel: "medio", texto: `Se parece a otro gasto del mismo día, valor y categoría («${dup.gasto.descripcion}»).` });
  if (g.lat != null && g.lng != null) {
    const c = COORDENADAS_CIUDADES[g.ciudad];
    if (c) {
      const d = distanciaKm(g.lat, g.lng, c[0], c[1]);
      if (d > 80) alertas.push({ codigo: "ubicacion_lejos", nivel: "alto", texto: `La ubicación del celular está a ${Math.round(d)} km de ${g.ciudad}, la ciudad declarada.` });
    }
  } else {
    alertas.push({ codigo: "sin_ubicacion", nivel: "bajo", texto: `Sin ubicación${g.ubicacionMotivo ? ` (${g.ubicacionMotivo})` : ""}.` });
  }
  if (!g.fotoPath && g.monto >= 20000) alertas.push({ codigo: "sin_soporte", nivel: "bajo", texto: "Sin foto del soporte." });
  if (g.fecha < sumarDias(hoy, -30)) alertas.push({ codigo: "fecha_antigua", nivel: "bajo", texto: "El gasto es de hace más de 30 días." });
  const nivel = alertas.reduce((m, a) => (NIVELES.indexOf(a.nivel) > NIVELES.indexOf(m) ? a.nivel : m), "ninguno");
  return { alertas, nivel };
}

/** Proyección del gasto del mes: lo acumulado, al ritmo de los días transcurridos. Null si es muy pronto (menos de 5 días). */
function proyeccionMes(gastos, hoy = fechaDeHoy()) {
  const mes = mesDe(hoy);
  const acumulado = sumar(gastos.filter((g) => g.estado !== "rechazado" && mesDe(g.fecha) === mes));
  const dia = Number(hoy.slice(8, 10));
  const diasMes = new Date(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 0).getDate();
  return { acumulado, dia, diasMes, proyectado: dia >= 5 ? Math.round((acumulado / dia) * diasMes / 1000) * 1000 : null };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ROLES, ESTADOS, esContable, puedeVer, puedeEditar, puedeDarAlta, puedeRechazar, puedeRevertirAlta, puedeExportar, puedeAdministrar, puedeRegistrar,
    MONTO_MAXIMO, FOTO_OBLIGATORIA_DESDE, CATEGORIAS, buscarCategoria, CIUDADES, aFechaTexto, aFecha, fechaDeHoy, esFechaReal, sumarDias,
    formatearFecha, fechaLarga, saludoSegunHora, formatearDinero, formatearFechaHora, mesDe, normalizarNit, validarGasto, generarId, crearGasto,
    detectarDuplicado, alertaTope, filtrarGastos, ordenarPorFecha, sumar, totalesPor, resumenGeneral, enlaceMapa, hojasExcel, nombreArchivoExcel,
    validarUsuario, validarCentro, normalizarCorreo, iniciales, sugerirCategoria, ciudadEnTexto, parsearDictado, interpretarNumero, valorDeNumeros,
    COORDENADAS_CIUDADES, mediana, distanciaKm, ciudadMasCercana, montoTipico, plantillasFrecuentes, sugerirDesdeHistorial, riesgoGasto, proyeccionMes
  };
}
