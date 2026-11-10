/* =========================================================================
   CH Industrial Solutions · Panel de trabajo · motor de operaciones
   - Todo se guarda en la CARPETA DE TRABAJO elegida por el usuario.
   - Nada se sube a la nube ni se guarda en el navegador, salvo el "handle"
     de la carpeta (IndexedDB) para recordarla entre sesiones.
   ========================================================================= */

const ARCHIVO_EXCEL = "Accesos_Panel.xlsx";
const HOJA = "Accesos";
const ARCHIVO_NOTAS = "notas.json";
const CARPETA_IMG = "imagenes";
const CARPETA_MAIL = "Correos importantes";

const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);

const estado = {
  config: null,
  secciones: [],        // [{id,titulo,icono,max,items:[{id,nombre,url,imagen}]}]
  notas: [],            // [{id,texto,estado:'pendiente'|'ejecutado'}]
  filtroNotas: "todas",
  dir: null,            // FileSystemDirectoryHandle de la carpeta de trabajo
  urlsImg: new Map(),   // ruta relativa -> objectURL
  arrastrando: null,    // {seccion,id}
};

/* ---------- Utilidades ---------- */
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function nombreSeguro(n) {
  return String(n).replace(/[\\/:*?"<>|]+/g, "_").trim() || "archivo";
}

/* ---------- IndexedDB: recordar la carpeta ---------- */
function abrirIDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("ch-panel", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvSet(k, v) {
  const db = await abrirIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function kvGet(k) {
  const db = await abrirIDB();
  return new Promise((res) => {
    const r = db.transaction("kv").objectStore("kv").get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(undefined);
  });
}

/* ---------- Config (JSON) ----------
   Se lee config.json (funciona en GitHub Pages). Si el navegador bloquea
   la lectura porque se abrió el HTML directo desde el disco (file://),
   se usa la copia de respaldo de abajo, que es idéntica a config.json. */
const CONFIG_RESPALDO = {
  secciones: [
    { id: "sharepoint", titulo: "SharePoint", icono: "S", max: 12, items: [
      { nombre: "QORVEX Portal", imagen: "assets/logos/logo-1.png" }, { nombre: "Recursos TI" }, { nombre: "Logística Central" }, { nombre: "Documentos Generales" }] },
    { id: "carpetas", titulo: "Carpetas", icono: "▣", max: 12, items: [
      { nombre: "Proyectos QORVEX", imagen: "assets/logos/logo-2.png" }, { nombre: "REVOX", imagen: "assets/logos/logo-4.png" }, { nombre: "Reportes" }, { nombre: "Capturas" }] },
    { id: "sistemas", titulo: "Sistemas y herramientas", icono: "⚙", max: 12, items: [
      { nombre: "QORVEX V8", imagen: "assets/logos/logo-3.png" }, { nombre: "REVOX V1.0.0", imagen: "assets/logos/logo-5.png" }, { nombre: "Etiquetas (REVOX)" }, { nombre: "Calculadora" }] },
    { id: "aplicaciones", titulo: "Aplicaciones", icono: "▦", max: 20, items: [
      { nombre: "Excel" }, { nombre: "Google Chrome" }, { nombre: "Outlook" }, { nombre: "Teams" }] },
    { id: "proyectos", titulo: "Proyectos y Procesos", icono: "◈", max: 8, items: [
      { nombre: "Validación QORVEX" }, { nombre: "Secuencia QORVEX" }, { nombre: "Reportes Operativos" }, { nombre: "Plan de Trabajo" }] },
    { id: "proyectos_ch", titulo: "Proyectos CH", icono: "◆", max: 10, items: Array.from({ length: 10 }, (_, i) => {
      const n = String(i + 1).padStart(2, "0");
      return { nombre: `Proyecto CH ${n}`, imagen: `assets/circulares/CH_ICON_CIRCULAR_${n}.png` };
    }) },
    { id: "enlaces", titulo: "Enlaces Útiles", icono: "∞", max: 10, items: [
      { nombre: "Google", url: "https://www.google.com" }, { nombre: "YouTube", url: "https://www.youtube.com" },
      { nombre: "ChatGPT", url: "https://chatgpt.com" }, { nombre: "LinkedIn", url: "https://www.linkedin.com" }] },
  ],
};

async function cargarConfig() {
  try {
    const r = await fetch("config.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    return CONFIG_RESPALDO;
  }
}

function seccionesDesdeConfig(cfg) {
  return cfg.secciones.map(s => ({
    id: s.id,
    titulo: s.titulo,
    icono: s.icono || "•",
    max: s.max,
    items: (s.items || []).map(i => ({ id: uid(), nombre: i.nombre, url: i.url || "", imagen: i.imagen || "", tam: i.tam || "s", nombreVis: i.nombreVis !== false })),
  }));
}

/* ---------- Carpeta de trabajo ---------- */
async function elegirCarpeta() {
  try {
    const dir = await window.showDirectoryPicker({ mode: "readwrite" });
    await kvSet("carpeta", dir);
    estado.dir = dir;
    await conectarCarpeta();
  } catch (e) {
    if (e.name !== "AbortError") toast("No se pudo abrir la carpeta: " + e.message);
  }
}

async function reconectar() {
  const perm = await estado.dir.requestPermission({ mode: "readwrite" });
  if (perm === "granted") await conectarCarpeta();
  else toast("Permiso denegado para la carpeta.");
}

async function conectarCarpeta() {
  const perm = await estado.dir.queryPermission({ mode: "readwrite" });
  if (perm !== "granted") { pintarEstadoCarpeta(false, true); return; }
  if (typeof XLSX === "undefined") toast("No se cargó SheetJS (XLSX). Revisa tu conexión para el Excel.", 5000);
  await cargarDesdeCarpeta();
  pintarEstadoCarpeta(true);
  render();
  renderNotas();
  await listarCorreos();
}

function pintarEstadoCarpeta(ok, reconectarNecesario = false) {
  $("#wsDot").classList.toggle("ok", ok);
  $("#btnGuardar").disabled = !ok;
  $("#btnReconectar").classList.toggle("hidden", !reconectarNecesario);
  $("#btnPick").textContent = ok ? "Cambiar carpeta" : "Elegir carpeta";
  $("#wsStatus").textContent = ok
    ? `Carpeta: ${estado.dir.name} · Excel: ${ARCHIVO_EXCEL}`
    : reconectarNecesario
      ? `Carpeta recordada: ${estado.dir.name} (requiere permiso)`
      : "Sin carpeta de trabajo";
}



/* ---------- Excel de accesos ---------- */
async function leerExcel() {
  try {
    const fh = await estado.dir.getFileHandle(ARCHIVO_EXCEL);
    const file = await fh.getFile();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const hoja = wb.Sheets[HOJA] || wb.Sheets[wb.SheetNames[0]];
    return hoja ? XLSX.utils.sheet_to_json(hoja, { defval: "" }) : null;
  } catch (e) {
    if (e.name === "NotFoundError") return null;
    throw e;
  }
}

async function cargarDesdeCarpeta() {
  const filas = await leerExcel();
  if (filas) {
    // El Excel manda: reconstruye las secciones desde sus filas
    const base = seccionesDesdeConfig(estado.config);
    base.forEach(s => s.items = []);
    for (const f of filas) {
      const sec = base.find(s => s.titulo === f.Seccion || s.id === f.Seccion);
      if (!sec || !f.Nombre) continue;
      const tam = ["s", "w", "l"].includes(String(f.Tamano)) ? String(f.Tamano) : "s";
      const nombreVis = String(f.MostrarNombre || "si").toLowerCase() !== "no";
      sec.items.push({ id: uid(), nombre: String(f.Nombre), url: String(f.URL || ""), imagen: String(f.Imagen || ""), tam, nombreVis });
    }
    estado.secciones = base;
  } else {
    // Primera vez: se crea el libro con lo que hay en pantalla
    estado.secciones = seccionesDesdeConfig(estado.config);
    await guardarExcel();
    toast("Se creó el libro Accesos_Panel.xlsx en tu carpeta.");
  }
  await cargarNotas();
  await cargarCalendario();
}

async function guardarExcel() {
  if (!estado.dir || typeof XLSX === "undefined") return;
  const filas = [["Seccion", "Orden", "Nombre", "URL", "Imagen", "Tamano", "MostrarNombre"]];
  for (const s of estado.secciones) {
    s.items.forEach((it, i) => filas.push([s.titulo, i + 1, it.nombre, it.url, it.imagen, it.tam || "s", it.nombreVis === false ? "no" : "si"]));
  }
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws["!cols"] = [{ wch: 24 }, { wch: 8 }, { wch: 28 }, { wch: 50 }, { wch: 30 }, { wch: 10 }, { wch: 15 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, HOJA);
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await escribirArchivo(estado.dir, ARCHIVO_EXCEL, bytes);
}

async function escribirArchivo(dir, nombre, datos) {
  const fh = await dir.getFileHandle(nombre, { create: true });
  const w = await fh.createWritable();
  await w.write(datos);
  await w.close();
}

/* Guardado único: Excel + notas, siempre en la carpeta elegida */
async function persistir() {
  if (!estado.dir) return;
  try {
    await guardarExcel();
    await guardarNotas();
    await guardarCalendario();
    $("#wsStatus").textContent = `Carpeta: ${estado.dir.name} · guardado ${new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (e) {
    toast("Error al guardar: " + e.message, 5000);
  }
}

/* ---------- Imágenes de botones (dentro de la carpeta de trabajo) ---------- */
async function urlImagen(rel) {
  if (!rel) return "";
  if (rel.startsWith("assets/")) return rel; // imágenes que vienen con el panel (logos, iconos)
  if (!estado.dir) return "";
  if (estado.urlsImg.has(rel)) return estado.urlsImg.get(rel);
  try {
    const [carpeta, nombre] = rel.split("/");
    const dirImg = await estado.dir.getDirectoryHandle(carpeta);
    const file = await (await dirImg.getFileHandle(nombre)).getFile();
    const url = URL.createObjectURL(file);
    estado.urlsImg.set(rel, url);
    return url;
  } catch { return ""; }
}

async function guardarImagen(file, id) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const dirImg = await estado.dir.getDirectoryHandle(CARPETA_IMG, { create: true });
  const nombre = `${id}.${ext}`;
  await escribirArchivo(dirImg, nombre, file);
  const rel = `${CARPETA_IMG}/${nombre}`;
  estado.urlsImg.delete(rel);
  return rel;
}

/* ---------- Render de accesos ---------- */
function buscarSeccion(id) { return estado.secciones.find(s => s.id === id); }

function render() {
  const grid = $("#accesos");
  const q = $("#search").value.trim().toLowerCase();
  grid.innerHTML = "";

  for (const sec of estado.secciones) {
    if (sec.id === "sharepoint") { grid.appendChild(crearOrbita(sec)); continue; }
    const card = document.createElement("article");
    card.className = "glass card" + (sec.items.length >= sec.max ? " lleno" : "");
    card.dataset.seccion = sec.id;
    card.innerHTML = `
      <div class="card-head">
        <span class="ico">${esc(sec.icono)}</span>
        <h2>${esc(sec.titulo)}</h2>
        <span class="count">${sec.items.length}/${sec.max}</span>
      </div>
      <div class="tiles"></div>`;

    const cont = card.querySelector(".tiles");
    const visibles = sec.items.filter(it => !q || it.nombre.toLowerCase().includes(q));
    visibles.forEach(it => cont.appendChild(crearTile(sec, it)));

    const add = document.createElement("button");
    add.className = "tile add";
    add.textContent = "+";
    add.title = "Agregar acceso";
    add.onclick = () => abrirEditor(null, sec.id);
    cont.appendChild(add);

    // Soltar en el espacio vacío de la sección = mover al final
    cont.addEventListener("dragover", e => { if (estado.arrastrando) e.preventDefault(); });
    cont.addEventListener("drop", e => { e.preventDefault(); moverItem(sec.id, null); });

    grid.appendChild(card);
  }
  grid.appendChild(crearDuo());
  hidratarImagenes();
}

/* ---------- Calculadora integrada (básica) ---------- */
const calc = { actual: "0", previo: null, op: null, nuevo: true, expr: "" };
const TECLAS_CALC = [
  ["C", "fn"], ["⌫", "fn"], ["%", "fn"], ["÷", "op"],
  ["7"], ["8"], ["9"], ["×", "op"],
  ["4"], ["5"], ["6"], ["−", "op"],
  ["1"], ["2"], ["3"], ["+", "op"],
  ["0", "cero"], ["."], ["=", "op"],
];

function operar(a, b, o) {
  if (o === "+") return a + b;
  if (o === "−") return a - b;
  if (o === "×") return a * b;
  if (o === "÷") return b === 0 ? NaN : a / b;
  return b;
}

function formatoCalc(n) {
  if (!Number.isFinite(n)) return "Error";
  return String(Number(n.toPrecision(12)));
}

function pulsarCalc(k) {
  if (calc.actual === "Error") { calc.actual = "0"; calc.previo = null; calc.op = null; calc.nuevo = true; }
  if (/^[0-9]$/.test(k)) {
    calc.actual = (calc.nuevo || calc.actual === "0") ? k : calc.actual + k;
    calc.nuevo = false;
  } else if (k === ".") {
    if (calc.nuevo) { calc.actual = "0."; calc.nuevo = false; }
    else if (!calc.actual.includes(".")) calc.actual += ".";
  } else if (k === "C") {
    Object.assign(calc, { actual: "0", previo: null, op: null, nuevo: true, expr: "" });
  } else if (k === "⌫") {
    if (!calc.nuevo) calc.actual = calc.actual.length > 1 ? calc.actual.slice(0, -1) : "0";
  } else if (k === "%") {
    calc.actual = formatoCalc(parseFloat(calc.actual) / 100);
  } else if (["+", "−", "×", "÷"].includes(k)) {
    if (calc.op && !calc.nuevo) {
      calc.previo = operar(calc.previo, parseFloat(calc.actual), calc.op);
      calc.actual = formatoCalc(calc.previo);
    } else {
      calc.previo = parseFloat(calc.actual);
    }
    calc.op = k;
    calc.nuevo = true;
    calc.expr = `${formatoCalc(calc.previo)} ${k}`;
  } else if (k === "=") {
    if (calc.op) {
      const r = operar(calc.previo, parseFloat(calc.actual), calc.op);
      calc.expr = `${formatoCalc(calc.previo)} ${calc.op} ${calc.actual} =`;
      calc.actual = formatoCalc(r);
      calc.previo = null; calc.op = null; calc.nuevo = true;
    }
  }
}

function crearCalculadora() {
  const card = document.createElement("article");
  card.className = "glass card calc";
  card.innerHTML = `
    <div class="card-head">
      <span class="ico">∑</span>
      <h2>Calculadora</h2>
      <span class="count">⌨ teclado</span>
    </div>
    <div class="calc-pantalla">
      <small class="calc-op"></small>
      <div class="calc-num"></div>
    </div>
    <div class="calc-teclas"></div>`;

  const pantalla = card.querySelector(".calc-num");
  const expr = card.querySelector(".calc-op");
  const teclas = card.querySelector(".calc-teclas");

  const pintar = () => {
    pantalla.textContent = calc.actual;
    pantalla.style.fontSize = calc.actual.length > 12 ? "16px" : calc.actual.length > 8 ? "22px" : "30px";
    expr.textContent = calc.expr;
  };

  for (const [tecla, clase] of TECLAS_CALC) {
    const b = document.createElement("button");
    b.textContent = tecla;
    b.className = clase || "";
    b.addEventListener("click", () => {
      pulsarCalc(tecla);
      pintar();
      b.classList.add("pulsa");
      setTimeout(() => b.classList.remove("pulsa"), 120);
    });
    teclas.appendChild(b);
  }
  pintar();

  // Teclado: funciona cuando la calculadora tiene el foco (al tocarla)
  card.tabIndex = 0;
  card.addEventListener("keydown", e => {
    const k = mapaTecla(e.key);
    if (!k) return;
    e.preventDefault();
    pulsarCalc(k);
    pintar();
  });
  return card;
}

/* ---------- Teclado de la calculadora ---------- */
function mapaTecla(k) {
  if (/^[0-9]$/.test(k)) return k;
  const m = { ".": ".", ",": ".", "+": "+", "-": "−", "*": "×", "x": "×", "X": "×", "/": "÷", "=": "=", "Enter": "=", "%": "%", "Backspace": "⌫", "Escape": "C", "Delete": "C", "c": "C", "C": "C" };
  return m[k] || null;
}

/* ---------- Calendario con notas (se guardan en calendario.json de la carpeta) ---------- */
const ARCHIVO_CAL = "calendario.json";
const DIAS_CAL = ["L", "M", "X", "J", "V", "S", "D"];
const HOY = new Date();
const cal = { ano: HOY.getFullYear(), mes: HOY.getMonth(), sel: claveFecha(HOY.getFullYear(), HOY.getMonth(), HOY.getDate()), notas: {} };

function claveFecha(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fechaLarga(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

async function cargarCalendario() {
  try {
    const fh = await estado.dir.getFileHandle(ARCHIVO_CAL);
    cal.notas = JSON.parse(await (await fh.getFile()).text());
  } catch {
    cal.notas = {};
  }
}

async function guardarCalendario() {
  await escribirArchivo(estado.dir, ARCHIVO_CAL, new Blob([JSON.stringify(cal.notas, null, 2)], { type: "application/json" }));
}

async function guardarCal() {
  if (!estado.dir) return;
  try { await guardarCalendario(); } catch (e) { toast("Error al guardar el calendario: " + e.message, 4000); }
}

function renderCal() {
  const host = document.querySelector(".cal-host");
  if (host) host.replaceChildren(crearCalendario());
}

function crearCalendario() {
  const primero = new Date(cal.ano, cal.mes, 1);
  const offset = (primero.getDay() + 6) % 7; // semana empieza en lunes
  const diasMes = new Date(cal.ano, cal.mes + 1, 0).getDate();
  const ahora = new Date();
  let celdas = "";
  for (let i = 0; i < offset; i++) celdas += `<span class="dia vacio"></span>`;
  for (let d = 1; d <= diasMes; d++) {
    const k = claveFecha(cal.ano, cal.mes, d);
    const notas = cal.notas[k] || [];
    const clases = ["dia"];
    if (ahora.getFullYear() === cal.ano && ahora.getMonth() === cal.mes && ahora.getDate() === d) clases.push("hoy");
    if (cal.sel === k) clases.push("sel");
    if (notas.some(n => n.importante)) clases.push("imp");
    else if (notas.length) clases.push("con");
    celdas += `<button class="${clases.join(" ")}" data-k="${k}">${d}</button>`;
  }

  const notasDia = cal.notas[cal.sel] || [];
  const card = document.createElement("article");
  card.className = "glass card cal-card";
  card.innerHTML = `
    <div class="card-head">
      <span class="ico">▦</span>
      <h2>Calendario</h2>
      <span class="count">${notasDia.length} nota(s)</span>
    </div>
    <div class="cal-nav">
      <button data-nav="-1" aria-label="Mes anterior">‹</button>
      <strong>${esc(primero.toLocaleDateString("es-MX", { month: "long", year: "numeric" }))}</strong>
      <button data-nav="1" aria-label="Mes siguiente">›</button>
    </div>
    <div class="cal-semana">${DIAS_CAL.map(d => `<span>${d}</span>`).join("")}</div>
    <div class="cal-dias">${celdas}</div>
    <div class="cal-sel">${esc(fechaLarga(cal.sel))}</div>
    <ul class="cal-lista">
      ${notasDia.length
        ? notasDia.map(n => `
          <li class="${n.importante ? "imp" : ""}" data-id="${n.id}">
            <button class="star" data-a="star" title="Marcar como importante">${n.importante ? "★" : "☆"}</button>
            <span>${esc(n.texto)}</span>
            <button class="li-btn" data-a="edit" title="Editar">✎</button>
            <button class="li-btn" data-a="del" title="Eliminar">✕</button>
          </li>`).join("")
        : `<li class="muted">Sin notas para este día</li>`}
    </ul>
    <form class="cal-form">
      <input name="texto" placeholder="Nota para este día..." maxlength="200" autocomplete="off">
      <label title="Importante"><input type="checkbox" name="imp"> ★</label>
      <button type="submit">+</button>
    </form>`;

  card.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => {
    cal.mes += Number(b.dataset.nav);
    if (cal.mes < 0) { cal.mes = 11; cal.ano--; }
    if (cal.mes > 11) { cal.mes = 0; cal.ano++; }
    renderCal();
  }));

  card.querySelectorAll(".dia[data-k]").forEach(b => b.addEventListener("click", () => {
    cal.sel = b.dataset.k;
    renderCal();
  }));

  card.querySelector(".cal-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const texto = f.texto.value.trim();
    if (!texto) return;
    if (!estado.dir) return toast("Elige la carpeta de trabajo para guardar notas del calendario.", 4000);
    (cal.notas[cal.sel] ||= []).push({ id: uid(), texto, importante: f.imp.checked });
    renderCal();
    await guardarCal();
  });

  card.querySelector(".cal-lista").addEventListener("click", async e => {
    const li = e.target.closest("li[data-id]");
    const boton = e.target.closest("[data-a]");
    if (!li || !boton) return;
    const lista = cal.notas[cal.sel] || [];
    const n = lista.find(x => x.id === li.dataset.id);
    if (!n) return;
    if (boton.dataset.a === "star") n.importante = !n.importante;
    else if (boton.dataset.a === "del") cal.notas[cal.sel] = lista.filter(x => x.id !== n.id);
    else if (boton.dataset.a === "edit") {
      const t = prompt("Editar nota:", n.texto);
      if (!t || !t.trim()) return;
      n.texto = t.trim();
    }
    if (cal.notas[cal.sel] && !cal.notas[cal.sel].length) delete cal.notas[cal.sel];
    renderCal();
    await guardarCal();
  });

  return card;
}

/* Dúo: calculadora al lado del calendario */
function crearDuo() {
  const duo = document.createElement("section");
  duo.className = "duo";
  const host = document.createElement("div");
  host.className = "cal-host";
  host.appendChild(crearCalendario());
  duo.append(crearCalculadora(), host);
  return duo;
}

/* ---------- JARVIS: saludo al abrir el panel (voz + texto + frases) ---------- */
const FRASES = [
  { t: "Es preciso que el príncipe sepa usar bien de la bestia y del hombre.", a: "Maquiavelo, El Príncipe" },
  { t: "No hay nada más difícil de emprender, ni más incierto en su éxito, que iniciar un nuevo orden de cosas.", a: "Maquiavelo, El Príncipe" },
  { t: "Todos los modelos están equivocados, pero algunos son útiles.", a: "George E. P. Box, estadístico e ingeniero" },
  { t: "A veces tienes que correr antes de poder caminar.", a: "Tony Stark, Iron Man" },
  { t: "La simplicidad es la máxima sofisticación.", a: "atribuida a Leonardo da Vinci" },
  { t: "Lo que no se mide, no se puede mejorar.", a: "atribuida a Peter Drucker" },
  { t: "Sistemas en línea. A su servicio, señor.", a: "J.A.R.V.I.S." },
  { t: "Un buen ingeniero no se rinde: rediseña.", a: "Panel CH Industrial Solutions" },
];

function saludoJarvis() {
  const h = new Date().getHours();
  const momento = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  return `${momento}, Charlie. Todos los sistemas están en línea. Su espacio de trabajo está listo. ¿Por dónde empezamos?`;
}

function escribir(texto, el, alFinal) {
  el.textContent = "";
  el.classList.add("escribiendo");
  let i = 0;
  clearInterval(el._t); // evita que dos mensajes se escriban a la vez
  const t = el._t = setInterval(() => {
    el.textContent += texto[i++];
    if (i >= texto.length) {
      clearInterval(t);
      el.classList.remove("escribiendo");
      if (alFinal) alFinal();
    }
  }, 28);
}

function hablar(texto) {
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    const voces = speechSynthesis.getVoices();
    u.voice = voces.find(v => /es[-_]MX/i.test(v.lang)) || voces.find(v => v.lang.startsWith("es")) || null;
    u.lang = "es-MX";
    u.rate = 0.95;
    u.pitch = 0.8; // tono más grave, estilo JARVIS
    speechSynthesis.speak(u);
  } catch { /* sin voz disponible: solo se muestra el texto */ }
}

/* Inventores: aparecen cuando vuelves a usar el panel después de 2 min sin actividad */
const INVENTORES = [
  { t: "No fracasé. Solo encontré diez mil maneras que no funcionan.", a: "Thomas Edison (atribuida)" },
  { t: "El presente es de ellos; el futuro, por el que realmente trabajé, es mío.", a: "Nikola Tesla (atribuida)" },
  { t: "Nada en la vida es para temerse, solo para comprenderse. Ahora es tiempo de comprender más, para temer menos.", a: "Marie Curie (atribuida)" },
  { t: "Lo primero que no debes hacer es engañarte, y eres la persona más fácil de engañar.", a: "Richard Feynman" },
];

const JARVIS = { encendido: true, pausado: false, ultimaAct: Date.now() };
const INACTIVO_MS = 120000; // 2 minutos sin actividad = pausa

function elegirAl(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

function pintarJarvis() {
  const box = $("#jarvis");
  box.classList.toggle("apagado", !JARVIS.encendido);
  box.classList.toggle("pausado", JARVIS.pausado || !JARVIS.encendido);
  const b = $("#jarvisPower");
  b.textContent = JARVIS.encendido ? "● Activo" : "○ Inactivo";
  b.title = JARVIS.encendido ? "Desactivar JARVIS (queda en la cinta)" : "Activar JARVIS";
}

function mostrarMensaje(texto, cita) {
  $("#jarvisFrase").innerHTML = `“${esc(cita.t)}”<small>${esc(cita.a)}</small>`;
  escribir(texto, $("#jarvisMsg"), () => hablar(texto));
}

function nuevoInventor() {
  mostrarMensaje("De vuelta, Charlie. Una idea de quienes construyeron el futuro:", elegirAl(INVENTORES));
}

/* Sin actividad 2 min: se pausa (no hace nada, queda fijo) */
function vigilarJarvis() {
  if (!JARVIS.pausado && Date.now() - JARVIS.ultimaAct >= INACTIVO_MS) {
    JARVIS.pausado = true;
    try { speechSynthesis.cancel(); } catch {}
    pintarJarvis();
  }
}

/* Actividad tras una pausa: muestra un inventor nuevo (si está encendido) */
function registrarActividad() {
  JARVIS.ultimaAct = Date.now();
  if (!JARVIS.pausado) return;
  JARVIS.pausado = false;
  pintarJarvis();
  if (JARVIS.encendido) nuevoInventor();
}

/* Activar / desactivar sin quitarlo de la cinta */
function alternarJarvis() {
  JARVIS.encendido = !JARVIS.encendido;
  if (!JARVIS.encendido) { try { speechSynthesis.cancel(); } catch {} }
  else if (!JARVIS.pausado) nuevoInventor();
  pintarJarvis();
}

function iniciarJarvis() {
  const wave = $("#jarvisWave");
  for (let i = 0; i < 36; i++) {
    const s = document.createElement("span");
    s.style.setProperty("--alto", `${14 + Math.round(Math.random() * 46)}px`);
    s.style.animationDelay = `${(i * 0.045).toFixed(3)}s`;
    s.style.animationDuration = `${(0.8 + Math.random() * 0.7).toFixed(2)}s`;
    wave.appendChild(s);
  }
  $("#jarvisPower").onclick = alternarJarvis;
  ["mousemove", "keydown", "mousedown", "wheel", "touchstart", "scroll"]
    .forEach(ev => document.addEventListener(ev, registrarActividad, { passive: true }));

  JARVIS.ultimaAct = Date.now();
  pintarJarvis();
  mostrarMensaje(saludoJarvis(), elegirAl(FRASES));
  setInterval(vigilarJarvis, 5000);
}

/* SharePoint: logo al centro y 12 espacios en círculo alrededor */
function crearOrbita(sec) {
  const card = document.createElement("article");
  card.className = "glass card orbita";
  card.dataset.seccion = sec.id;
  card.innerHTML = `
    <div class="card-head">
      <span class="ico">${esc(sec.icono)}</span>
      <h2>${esc(sec.titulo)}</h2>
      <span class="count">${sec.items.length}/${sec.max}</span>
    </div>
    <div class="orbit">
      <div class="orbit-core"><img class="orbit-logo" src="assets/sharepoint.png" alt="SharePoint"></div>
    </div>`;

  const orbit = card.querySelector(".orbit");
  for (let i = 0; i < sec.max; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.style.setProperty("--i", i);
    const it = sec.items[i];
    if (it) {
      const a = crearTile(sec, it);
      a.title = it.nombre;
      slot.appendChild(a);
    } else {
      const add = document.createElement("button");
      add.className = "tile add";
      add.textContent = "+";
      add.title = "Agregar link de SharePoint";
      add.onclick = () => abrirEditor(null, sec.id);
      slot.appendChild(add);
      slot.addEventListener("dragover", e => { if (estado.arrastrando) e.preventDefault(); });
      slot.addEventListener("drop", e => { e.preventDefault(); moverItem(sec.id, null); });
    }
    orbit.appendChild(slot);
  }
  return card;
}

function crearTile(sec, it) {
  const a = document.createElement("a");
  a.className = `tile t-${it.tam || "s"}${it.nombreVis === false ? " solo" : ""}`;
  a.draggable = true;
  a.href = it.url || "#";
  a.target = "_blank";
  a.rel = "noopener";
  a.dataset.id = it.id;
  a.innerHTML = `
    ${it.imagen
      ? `<img class="img" data-img="${esc(it.imagen)}" alt="">`
      : `<span class="ini">${esc((it.nombre[0] || "?").toUpperCase())}</span>`}
    <span class="nombre">${esc(it.nombre)}</span>
    <button class="edit" title="Editar">✎</button>`;

  a.querySelector(".edit").addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); abrirEditor(it.id, sec.id); });
  a.addEventListener("click", e => { if (!it.url) { e.preventDefault(); abrirEditor(it.id, sec.id); } });

  a.addEventListener("dragstart", e => {
    estado.arrastrando = { seccion: sec.id, id: it.id };
    a.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", it.id); // requerido por Firefox
  });
  a.addEventListener("dragend", () => { a.classList.remove("dragging"); estado.arrastrando = null; });
  a.addEventListener("dragover", e => { if (!estado.arrastrando) return; e.preventDefault(); e.stopPropagation(); a.classList.add("over"); });
  a.addEventListener("dragleave", () => a.classList.remove("over"));
  a.addEventListener("drop", e => {
    if (!estado.arrastrando) return;
    e.preventDefault(); e.stopPropagation();
    a.classList.remove("over");
    moverItem(sec.id, it.id);
  });
  return a;
}

async function hidratarImagenes() {
  for (const img of document.querySelectorAll("img[data-img]")) {
    const url = await urlImagen(img.dataset.img);
    if (url) img.src = url; else img.replaceWith(Object.assign(document.createElement("span"), { className: "ini", textContent: "?" }));
  }
}

/* Mover un acceso entre o dentro de secciones (respeta el máximo) */
function moverItem(seccionDestino, antesDeId) {
  const src = estado.arrastrando;
  estado.arrastrando = null;
  if (!src) return;
  const origen = buscarSeccion(src.seccion);
  const destino = buscarSeccion(seccionDestino);
  const idx = origen.items.findIndex(i => i.id === src.id);
  if (idx < 0 || antesDeId === src.id) return;

  if (origen !== destino && destino.items.length >= destino.max) {
    toast(`«${destino.titulo}» ya tiene ${destino.max} accesos.`);
    return;
  }
  const [item] = origen.items.splice(idx, 1);
  let pos = antesDeId ? destino.items.findIndex(i => i.id === antesDeId) : -1;
  if (pos < 0) pos = destino.items.length;
  destino.items.splice(pos, 0, item);
  render();
  persistir();
}

/* ---------- Editor de accesos (agregar / editar / eliminar) ---------- */
let editandoId = null;
let editandoSeccion = null;

function abrirEditor(itemId, seccionId) {
  editandoId = itemId;
  editandoSeccion = seccionId;
  const dlg = $("#editDlg");
  const f = $("#editForm");
  const sec = buscarSeccion(seccionId);
  const it = itemId ? sec.items.find(i => i.id === itemId) : null;

  $("#editTitulo").textContent = it ? "Editar acceso" : `Nuevo acceso · ${sec.titulo}`;
  f.nombre.value = it?.nombre || "";
  f.url.value = it?.url || "";
  f.tam.value = it?.tam || "s";
  f.nombreVis.checked = it ? it.nombreVis !== false : true;
  f.imagen.value = "";
  f.seccion.innerHTML = estado.secciones.map(s => `<option value="${s.id}">${esc(s.titulo)}</option>`).join("");
  f.seccion.value = seccionId;
  $("#editEliminar").classList.toggle("hidden", !it);
  dlg.showModal();
}

$("#editCancelar").addEventListener("click", () => $("#editDlg").close());

$("#editEliminar").addEventListener("click", () => {
  if (!confirm("¿Eliminar este acceso del panel? (El archivo original no se borra)")) return;
  const sec = buscarSeccion(editandoSeccion);
  sec.items = sec.items.filter(i => i.id !== editandoId);
  $("#editDlg").close();
  render(); persistir();
  toast("Acceso eliminado");
});

$("#editForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = $("#editForm");
  const nombre = f.nombre.value.trim();
  const url = f.url.value.trim();
  const nuevaSec = buscarSeccion(f.seccion.value);
  const origenSec = buscarSeccion(editandoSeccion);
  if (!nombre) return toast("Pon un nombre");

  if (!estado.dir) toast("Sin carpeta: los cambios no se guardarán en disco.", 3000);

  let it = editandoId ? origenSec.items.find(i => i.id === editandoId) : null;
  if (!it) {
    if (nuevaSec.items.length >= nuevaSec.max) return toast(`«${nuevaSec.titulo}» está lleno (${nuevaSec.max}).`);
    it = { id: uid(), nombre, url, imagen: "", tam: f.tam.value, nombreVis: f.nombreVis.checked };
    nuevaSec.items.push(it);
  } else {
    it.nombre = nombre; it.url = url;
    it.tam = f.tam.value; it.nombreVis = f.nombreVis.checked;
    if (nuevaSec !== origenSec) {
      if (nuevaSec.items.length >= nuevaSec.max) return toast(`«${nuevaSec.titulo}» está lleno (${nuevaSec.max}).`);
      origenSec.items = origenSec.items.filter(i => i.id !== it.id);
      nuevaSec.items.push(it);
    }
  }

  const archivo = f.imagen.files[0];
  if (archivo && estado.dir) {
    it.imagen = await guardarImagen(archivo, it.id);
  }

  $("#editDlg").close();
  render(); persistir();
});

/* Atajo: cambio de carpeta/conexión */
$("#btnPick").addEventListener("click", elegirCarpeta);
$("#navCarpeta").addEventListener("click", elegirCarpeta);
$("#btnReconectar").addEventListener("click", reconectar);
$("#btnGuardar").addEventListener("click", async () => { await persistir(); toast("Guardado en la carpeta de trabajo"); });

$("#search").addEventListener("input", render);
$("#searchGo").addEventListener("click", () => $("#search").focus());

/* ---------- Notas: pendientes / ejecutadas ---------- */
async function cargarNotas() {
  try {
    const fh = await estado.dir.getFileHandle(ARCHIVO_NOTAS);
    estado.notas = JSON.parse(await (await fh.getFile()).text());
  } catch {
    estado.notas = [];
  }
}

async function guardarNotas() {
  const txt = JSON.stringify(estado.notas, null, 2);
  await escribirArchivo(estado.dir, ARCHIVO_NOTAS, new Blob([txt], { type: "application/json" }));
}

function renderNotas() {
  const ul = $("#notasList");
  const lista = estado.notas.filter(n => estado.filtroNotas === "todas" || n.estado === estado.filtroNotas);
  ul.innerHTML = "";
  if (!lista.length) {
    ul.innerHTML = `<li class="muted">Sin notas${estado.filtroNotas !== "todas" ? " en este filtro" : ""}.</li>`;
    return;
  }
  for (const n of lista) {
    const li = document.createElement("li");
    li.className = n.estado;
    li.innerHTML = `
      <input type="checkbox" ${n.estado === "ejecutado" ? "checked" : ""} title="Marcar como ejecutada">
      <span title="Doble clic para editar">${esc(n.texto)}</span>
      <button class="li-btn" data-a="del" title="Eliminar">✕</button>`;
    li.querySelector("input").addEventListener("change", e => {
      n.estado = e.target.checked ? "ejecutado" : "pendiente";
      renderNotas(); persistir();
    });
    li.querySelector("span").addEventListener("dblclick", () => {
      const nuevo = prompt("Editar nota:", n.texto);
      if (nuevo && nuevo.trim()) { n.texto = nuevo.trim(); renderNotas(); persistir(); }
    });
    li.querySelector('[data-a="del"]').addEventListener("click", () => {
      estado.notas = estado.notas.filter(x => x.id !== n.id);
      renderNotas(); persistir();
    });
    ul.appendChild(li);
  }
}

$("#notaForm").addEventListener("submit", e => {
  e.preventDefault();
  const inp = $("#notaInput");
  const texto = inp.value.trim();
  if (!texto) return;
  estado.notas.unshift({ id: uid(), texto, estado: "pendiente" });
  inp.value = "";
  renderNotas(); persistir();
});

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
  estado.filtroNotas = t.dataset.filtro;
  renderNotas();
}));

/* ---------- Correos importantes ---------- */
const dz = $("#dropzone");
dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", async e => {
  e.preventDefault();
  dz.classList.remove("over");
  if (!estado.dir) return toast("Primero elige la carpeta de trabajo.");

  const archivos = [...e.dataTransfer.files];
  if (archivos.length) {
    for (const f of archivos) await guardarCorreo(f, f.name);
  } else {
    // Texto arrastrado desde el cliente de correo: se guarda como .eml
    const html = e.dataTransfer.getData("text/html");
    const txt = e.dataTransfer.getData("text/plain");
    if (!txt && !html) return toast("No se reconoció el correo arrastrado.");
    const asunto = (txt.split("\n").find(l => l.trim()) || "Correo").slice(0, 80);
    const eml = [
      `Subject: ${asunto}`,
      `Date: ${new Date().toUTCString()}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      txt || html.replace(/<[^>]+>/g, ""),
    ].join("\r\n");
    await guardarCorreo(new Blob([eml]), `${nombreSeguro(asunto)}.eml`);
  }
  await listarCorreos();
});

async function guardarCorreo(blob, nombre) {
  const dirMail = await estado.dir.getDirectoryHandle(CARPETA_MAIL, { create: true });
  let final = nombreSeguro(nombre), n = 1;
  while (await existe(dirMail, final)) {
    const p = final.lastIndexOf(".");
    final = p > 0 ? `${final.slice(0, p)} (${n})${final.slice(p)}` : `${final} (${n})`;
    n++;
  }
  await escribirArchivo(dirMail, final, blob);
  toast(`Guardado: ${final}`);
}

async function existe(dir, nombre) {
  try { await dir.getFileHandle(nombre); return true; } catch { return false; }
}

async function listarCorreos() {
  const ul = $("#mailList");
  ul.innerHTML = "";
  if (!estado.dir) { $("#mailCount").textContent = ""; return; }
  try {
    const dirMail = await estado.dir.getDirectoryHandle(CARPETA_MAIL);
    const items = [];
    for await (const [nombre, h] of dirMail.entries()) if (h.kind === "file") items.push(nombre);
    items.sort().reverse();
    $("#mailCount").textContent = `${items.length} guardados`;
    for (const n of items.slice(0, 30)) {
      const li = document.createElement("li");
      li.innerHTML = `<span>✉ ${esc(n)}</span>`;
      ul.appendChild(li);
    }
  } catch {
    $("#mailCount").textContent = "0 guardados";
  }
}

/* ---------- Reloj analógico ---------- */
function iniciarReloj() {
  const svg = $("#clock");
  let marcas = "";
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 - 90) * Math.PI / 180;
    const r1 = i % 3 === 0 ? 74 : 80, r2 = 90;
    marcas += `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}" stroke="${i % 3 === 0 ? "#1ea7ff" : "#4d6a8a"}" stroke-width="${i % 3 === 0 ? 3 : 1.5}" stroke-linecap="round"/>`;
  }
  svg.innerHTML = `
    <defs>
      <radialGradient id="cg" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#14202f"/><stop offset="100%" stop-color="#02050a"/>
      </radialGradient>
    </defs>
    <circle cx="100" cy="100" r="96" fill="url(#cg)" stroke="#1ea7ff" stroke-width="2"/>
    <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1"/>
    ${marcas}
    <line id="hH" x1="100" y1="100" x2="100" y2="58" stroke="#e7f1ff" stroke-width="5" stroke-linecap="round"/>
    <line id="hM" x1="100" y1="100" x2="100" y2="38" stroke="#e7f1ff" stroke-width="3" stroke-linecap="round"/>
    <line id="hS" x1="100" y1="112" x2="100" y2="26" stroke="#1ea7ff" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="4" fill="#1ea7ff"/>`;

  const mover = () => {
    const d = new Date();
    const s = d.getSeconds() + d.getMilliseconds() / 1000;
    const m = d.getMinutes() + s / 60;
    const h = (d.getHours() % 12) + m / 60;
    const rot = (el, deg) => el.setAttribute("transform", `rotate(${deg} 100 100)`);
    rot($("#hH"), h * 30);
    rot($("#hM"), m * 6);
    rot($("#hS"), s * 6);
    $("#fecha").textContent = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  mover();
  setInterval(mover, 250);
}

/* ---------- Tema: oscuro (por defecto) / blanco. Se recuerda en IndexedDB ---------- */
function aplicarTema(t) {
  const tema = t === "blanco" ? "blanco" : "oscuro";
  document.documentElement.dataset.theme = tema;
  $("#btnTema").textContent = tema === "blanco" ? "◐ Tema oscuro" : "◑ Tema blanco";
}

$("#btnTema").addEventListener("click", async () => {
  const nuevo = document.documentElement.dataset.theme === "blanco" ? "oscuro" : "blanco";
  aplicarTema(nuevo);
  try { await kvSet("tema", nuevo); } catch { /* sin IndexedDB, el tema dura solo esta sesión */ }
});

/* ---------- Arranque ---------- */
async function iniciar() {
  iniciarReloj();
  aplicarTema((await kvGet("tema")) || "oscuro");
  iniciarJarvis();
  estado.config = await cargarConfig();
  estado.secciones = seccionesDesdeConfig(estado.config);
  render();
  renderNotas();

  const guardada = await kvGet("carpeta");
  if (guardada) {
    estado.dir = guardada;
    const perm = await guardada.queryPermission({ mode: "readwrite" });
    if (perm === "granted") await conectarCarpeta();
    else pintarEstadoCarpeta(false, true);
  } else {
    pintarEstadoCarpeta(false);
  }
}

iniciar();
