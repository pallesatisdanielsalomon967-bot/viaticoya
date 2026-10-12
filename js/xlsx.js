/*
 * xlsx.js — Crea archivos de Excel (.xlsx) sin librerías externas.
 * Un .xlsx es un ZIP con varios archivos XML. Aquí se arma ese ZIP "sin comprimir" (método store),
 * que Excel, LibreOffice y Google Sheets abren sin problema.
 *
 * Uso: const bytes = crearXlsx([{ nombre, columnas: [{titulo, ancho, tipo}], filas: [[...]], totales: [índices] }]);
 * Tipos de columna: "texto" (por defecto), "fecha" (AAAA-MM-DD), "dinero", "entero", "decimal".
 */
"use strict";

// ---------- ZIP (sin compresión) ----------
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function crearZip(archivos, fecha = new Date()) {
  const codificador = new TextEncoder();
  const hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1);
  const dia = ((Math.max(1980, fecha.getFullYear()) - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
  const partes = [], central = [];
  let posicion = 0;
  for (const { ruta, contenido } of archivos) {
    const nombre = codificador.encode(ruta);
    const datos = typeof contenido === "string" ? codificador.encode(contenido) : contenido;
    const crc = crc32(datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // 0x0800 = nombres en UTF-8
    local.setUint16(8, 0, true); local.setUint16(10, hora, true); local.setUint16(12, dia, true);
    local.setUint32(14, crc, true); local.setUint32(18, datos.length, true); local.setUint32(22, datos.length, true);
    local.setUint16(26, nombre.length, true); local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nombre, datos);

    const entrada = new DataView(new ArrayBuffer(46));
    entrada.setUint32(0, 0x02014b50, true); entrada.setUint16(4, 20, true); entrada.setUint16(6, 20, true); entrada.setUint16(8, 0x0800, true);
    entrada.setUint16(10, 0, true); entrada.setUint16(12, hora, true); entrada.setUint16(14, dia, true);
    entrada.setUint32(16, crc, true); entrada.setUint32(20, datos.length, true); entrada.setUint32(24, datos.length, true);
    entrada.setUint16(28, nombre.length, true); entrada.setUint32(42, posicion, true);
    central.push(new Uint8Array(entrada.buffer), nombre);
    posicion += 30 + nombre.length + datos.length;
  }
  const tamanoCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamanoCentral, true); fin.setUint32(16, posicion, true);
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const salida = new Uint8Array(todo.reduce((s, p) => s + p.length, 0));
  let desplazamiento = 0;
  for (const p of todo) { salida.set(p, desplazamiento); desplazamiento += p.length; }
  return salida;
}

// ---------- XML de la hoja de cálculo ----------
const escaparXml = (t) => String(t)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")   // caracteres que Excel no acepta
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Número de columna (0 = A) -> letra de columna ("A", "B", … "AA"). */
function letraDeColumna(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "2026-10-11" -> número de serie de Excel (días desde 1899-12-30). */
function serieDeFecha(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Estilos (posición dentro de cellXfs en styles.xml)
const ESTILO = { texto: 0, encabezado: 1, fecha: 2, dinero: 3, decimal: 4, entero: 5, totalTexto: 6, totalDinero: 7, totalEntero: 8 };
const ESTILO_TOTAL = { dinero: ESTILO.totalDinero, entero: ESTILO.totalEntero };

const XML_ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="166" formatCode="0.000000"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3D2E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2B3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="1" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function celda(columna, filaNumero, valor, tipo) {
  const ref = `${letraDeColumna(columna)}${filaNumero}`;
  if (valor === "" || valor === null || valor === undefined) return "";
  if (tipo === "fecha") {
    const serie = serieDeFecha(String(valor));
    if (serie !== null) return `<c r="${ref}" s="${ESTILO.fecha}"><v>${serie}</v></c>`;
  }
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `<c r="${ref}" s="${ESTILO[tipo] ?? ESTILO.texto}"><v>${valor}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
}

function xmlHoja(hoja) {
  const cols = hoja.columnas;
  const ultimaFila = hoja.filas.length + 1;
  const filas = [];
  filas.push(`<row r="1" ht="32" customHeight="1">${cols.map((c, i) => `<c r="${letraDeColumna(i)}1" s="${ESTILO.encabezado}" t="inlineStr"><is><t>${escaparXml(c.titulo)}</t></is></c>`).join("")}</row>`);
  hoja.filas.forEach((fila, r) => {
    filas.push(`<row r="${r + 2}">${fila.map((v, i) => celda(i, r + 2, v, cols[i].tipo)).join("")}</row>`);
  });
  if (hoja.totales?.length && hoja.filas.length > 0) {
    const n = ultimaFila + 1;
    const celdas = [`<c r="A${n}" s="${ESTILO.totalTexto}" t="inlineStr"><is><t>TOTAL</t></is></c>`];
    cols.forEach((c, i) => {
      if (i === 0) return;
      if (hoja.totales.includes(i)) {
        const L = letraDeColumna(i);
        const suma = hoja.filas.reduce((s, f) => s + (typeof f[i] === "number" ? f[i] : 0), 0);
        // SUBTOTAL(109) suma solo las filas visibles: si el contador filtra la hoja, el total se ajusta
        celdas.push(`<c r="${L}${n}" s="${ESTILO_TOTAL[c.tipo] ?? ESTILO.totalDinero}"><f>SUBTOTAL(109,${L}2:${L}${ultimaFila})</f><v>${suma}</v></c>`);
      } else {
        celdas.push(`<c r="${letraDeColumna(i)}${n}" s="${ESTILO.totalTexto}"/>`);
      }
    });
    filas.push(`<row r="${n}">${celdas.join("")}</row>`);
  }
  const rango = `A1:${letraDeColumna(cols.length - 1)}${Math.max(ultimaFila, 2)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho ?? 14}" customWidth="1"/>`).join("")}</cols>
<sheetData>${filas.join("")}</sheetData>
${hoja.filas.length > 0 ? `<autoFilter ref="${rango}"/>` : ""}
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToHeight="0"/>
</worksheet>`;
}

const nombreDeHoja = (n, i) => (String(n).replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || `Hoja ${i + 1}`);

/** Devuelve el .xlsx como Uint8Array. */
function crearXlsx(hojas, fecha = new Date()) {
  if (!Array.isArray(hojas) || hojas.length === 0) throw new Error("Falta al menos una hoja");
  const nombres = hojas.map((h, i) => nombreDeHoja(h.nombre, i));
  const archivos = [
    { ruta: "[Content_Types].xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { ruta: "_rels/.rels", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { ruta: "xl/workbook.xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${escaparXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { ruta: "xl/_rels/workbook.xml.rels", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { ruta: "xl/styles.xml", contenido: XML_ESTILOS },
    ...hojas.map((h, i) => ({ ruta: `xl/worksheets/sheet${i + 1}.xml`, contenido: xmlHoja(h) }))
  ];
  return crearZip(archivos, fecha);
}

if (typeof module !== "undefined" && module.exports) module.exports = { crearXlsx, crearZip, crc32, letraDeColumna, serieDeFecha };
