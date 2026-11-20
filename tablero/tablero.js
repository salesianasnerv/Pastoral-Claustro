/* Tablero del equipo de Pastoral
   · Inicio de sesión con Microsoft 365 (Supabase común «Acceso Microsoft 365»).
   · Solo entra el grupo «Pastoral» de Microsoft 365 o quien tenga el permiso «pastoral_tablero» del panel.
     Las reglas están en la base de datos (supabase/tablero.sql): la página solo enseña lo que la base deja leer.
   · Temáticas → listas → tarjetas (tareas, enlaces, adjuntos, responsable, fecha, etiquetas), organizado por cursos.
   · Con ?demo se ve con datos inventados y sin guardar nada (para enseñarlo o probarlo). */
'use strict';

const SUPABASE_URL = 'https://hblayjaknhfxieqbzrlq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibGF5amFrbmhmeGllcWJ6cmxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjg0ODEsImV4cCI6MjEwNjgwNDQ4MX0.K2iWyQAt9upNBXUhdZuV-Nle9fkCMYgQ6jTBBO0MluE';
const BUCKET = 'pas-tablero';
const MAX_MB = 10;
const DEMO = new URLSearchParams(location.search).has('demo');

const ETIQUETAS = {
  urgente: ['Urgente', '#d64545'], infantil: ['Infantil', '#939b00'], primaria: ['Primaria', '#d35a15'], eso: ['ESO', '#009abb'],
  bach: ['Bachillerato', '#7c5cc4'], ccff: ['CCFF', '#5b6b7b'], claustro: ['Claustro', '#b0457a'], todo: ['Todo el colegio', '#007791']
};
const COLORES = ['#009abb', '#007791', '#b4be00', '#939b00', '#ee712a', '#d64545', '#7c5cc4', '#b0457a', '#5b6b7b'];
const ICONOS = ['📌', '🎁', '⭐', '🥪', '🕯️', '🤝', '✝️', '🗒️', '🎉', '🙏', '📣', '🎶', '📚', '🌱', '❤️', '🏕️', '⛪', '🕊️'];

const I = {
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  enlace: '<svg class="i" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  clip: '<svg class="i" viewBox="0 0 24 24"><path d="M21 12l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6L15.5 7"/></svg>',
  cal: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  texto: '<svg class="i" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  mas: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  hist: '<svg class="i" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>'
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoyISO = () => new Date().toLocaleDateString('sv-SE');
const fmtFecha = s => new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const fmtCuando = s => new Date(s).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const iniciales = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
const urlSegura = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

/* ---------- Estado ---------- */
const E = {
  yo: null,              // {email, nombre, equipo, curso_editable, curso_hoy}
  equipo: [],            // [{email, nombre}]
  cursos: [],            // ['2026-2027', …] de más reciente a más antiguo
  curso: null,           // curso que se está viendo
  tematicas: [], listas: [], tarjetas: [], adjuntos: [],
  actual: null,          // id de la temática abierta
  verArchivadas: false,
  abierta: null          // id de la tarjeta abierta
};
const editable = () => !!E.yo && E.curso === E.yo.curso_editable;
const nombreDe = email => (E.equipo.find(p => p.email === email) || {}).nombre || email || '';

/* ---------- Acceso a datos: Supabase (o datos inventados con ?demo) ---------- */
let sb = null;
const API = DEMO ? crearDemo() : {
  async sesion() { return (await sb.auth.getSession()).data.session; },
  async rpc(f, args) { const { data, error } = await sb.rpc(f, args); if (error) throw error; return data; },
  async leer(tabla, filtro) {
    let q = sb.from(tabla).select('*');
    if (filtro) q = filtro(q);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async crear(tabla, fila) { const { data, error } = await sb.from(tabla).insert(fila).select().single(); if (error) throw error; return data; },
  async cambiar(tabla, id, cambios) { const { data, error } = await sb.from(tabla).update(cambios).eq('id', id).select().single(); if (error) throw error; return data; },
  async borrar(tabla, id) { const { error } = await sb.from(tabla).delete().eq('id', id); if (error) throw error; },
  async subir(ruta, archivo) { const { error } = await sb.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type, upsert: false }); if (error) throw error; },
  async enlaceTemporal(ruta, nombre) { const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(ruta, 60, { download: false }); if (error) throw error; return data.signedUrl; },
  async quitarArchivos(rutas) { if (rutas.length) { const { error } = await sb.storage.from(BUCKET).remove(rutas); if (error) throw error; } }
};

/* ---------- Avisos ---------- */
let tAviso;
function aviso(txt, error) {
  const a = $('aviso'); a.textContent = txt; a.className = 'aviso' + (error ? ' error' : ''); a.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, error ? 6000 : 2600);
}
function fallo(e) {
  console.error(e);
  const m = String(e?.message || e);
  aviso(/row-level security|permission denied/i.test(m) ? 'No tienes permiso para hacer este cambio (los cursos anteriores son solo para consultar).'
    : /mime|type/i.test(m) ? 'Ese tipo de archivo no se admite. Sube PDF, imágenes u Office.'
    : /size|exceed/i.test(m) ? `El archivo pasa de ${MAX_MB} MB.` : 'No se ha podido guardar: ' + m, true);
}

/* ---------- Pantallas ---------- */
function mostrar(id) {
  ['p-cargando', 'p-entrar', 'p-sin-permiso', 'p-tablero'].forEach(p => { $(p).hidden = p !== id; });
}

async function iniciar() {
  try {
    if (!DEMO) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
    }
    const s = await API.sesion();
    if (!s) { mostrar('p-entrar'); return; }
    $('salir').hidden = false;
    E.yo = await API.rpc('pas_tab_quien_soy');
    $('quien').textContent = E.yo.nombre || E.yo.email;
    if (!E.yo.equipo) { $('sp-email').textContent = E.yo.email; mostrar('p-sin-permiso'); return; }
    E.equipo = await API.rpc('pas_tab_equipo') || [];
    E.cursos = (await API.leer('pas_tab_cursos')).map(c => c.curso).sort().reverse();
    E.curso = E.yo.curso_editable || E.cursos[0];
    await cargarCurso();
    mostrar('p-tablero');
    escucharCambios();
    limpiarHuerfanos();
  } catch (e) {
    console.error(e);
    mostrar('p-entrar');
    aviso('No se ha podido cargar el tablero. Comprueba la conexión e inténtalo de nuevo.', true);
  }
}

async function cargarCurso() {
  const tems = await API.leer('pas_tab_tematicas', q => q.eq('curso', E.curso));
  const ids = tems.map(t => t.id);
  const listas = ids.length ? await API.leer('pas_tab_listas', q => q.in('tematica_id', ids)) : [];
  const lids = listas.map(l => l.id);
  const tarjetas = lids.length ? await API.leer('pas_tab_tarjetas', q => q.in('lista_id', lids)) : [];
  const cids = tarjetas.map(c => c.id);
  const adj = [];
  for (let i = 0; i < cids.length; i += 150) adj.push(...await API.leer('pas_tab_adjuntos', q => q.in('tarjeta_id', cids.slice(i, i + 150))));
  E.tematicas = tems.sort(porOrden); E.listas = listas.sort(porOrden); E.tarjetas = tarjetas.sort(porOrden); E.adjuntos = adj;
  if (!E.tematicas.some(t => t.id === E.actual && !t.archivada)) E.actual = (E.tematicas.find(t => !t.archivada) || {}).id || null;
  pintar();
}
const porOrden = (a, b) => (a.orden - b.orden) || String(a.creada || a.id).localeCompare(String(b.creada || b.id));

/* ---------- Cambios al momento (otras personas del equipo) ---------- */
let tRecarga;
function escucharCambios() {
  if (DEMO) return;
  sb.channel('pas-tablero')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pas_tab_tematicas' }, recargarPronto)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pas_tab_listas' }, recargarPronto)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pas_tab_tarjetas' }, recargarPronto)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pas_tab_adjuntos' }, recargarPronto)
    .subscribe();
  // Al volver a la pestaña, se recarga por si acaso
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recargarPronto(); });
}
function recargarPronto() {
  clearTimeout(tRecarga);
  tRecarga = setTimeout(async () => {
    if (arrastrando || document.querySelector('.form-rapido textarea:focus, #ventana :focus')) return recargarPronto();
    try { await cargarCurso(); if (E.abierta) abrirTarjeta(E.abierta, true); } catch (e) { console.error(e); }
  }, 700);
}

// Archivos que se quedaron sin tarjeta (cursos o tarjetas borrados): Supabase no deja borrarlos desde SQL
async function limpiarHuerfanos() {
  try { const r = await API.rpc('pas_tab_archivos_huerfanos'); if (r && r.length) await API.quitarArchivos(r); } catch (e) { console.warn(e); }
}

/* ---------- Pintar ---------- */
function pintar() {
  // Cursos
  $('curso').innerHTML = E.cursos.map(c => `<option value="${c}" ${c === E.curso ? 'selected' : ''}>${c}${c === E.yo.curso_editable ? '' : ' (consulta)'}</option>`).join('');
  $('nuevo-curso').hidden = !(E.yo.curso_hoy > (E.yo.curso_editable || ''));
  const av = $('aviso-curso');
  if (!editable()) { av.hidden = false; av.textContent = `Estás viendo el curso ${E.curso}: es solo para consultar. Para cambiar algo, elige el curso ${E.yo.curso_editable}.`; }
  else if (!$('nuevo-curso').hidden) { av.hidden = false; av.textContent = `Ya ha empezado el curso ${E.yo.curso_hoy}. Pulsa «Empezar curso nuevo» para preparar el tablero (si nadie lo hace, se prepara solo el 30 de septiembre).`; }
  else av.hidden = true;
  $('p-tablero').classList.toggle('editable', editable());

  // Personas para el filtro
  const fp = $('filtro-persona'), v = fp.value;
  fp.innerHTML = '<option value="">Todas las personas</option><option value="__yo">Solo mis tarjetas</option><option value="__nadie">Sin responsable</option>' +
    E.equipo.map(p => `<option value="${esc(p.email)}">${esc(p.nombre)}</option>`).join('');
  fp.value = v;

  pintarTematicas();
  pintarTablero();
}

function pendientes(t) {
  const listas = E.listas.filter(l => l.tematica_id === t.id && !l.terminada).map(l => l.id);
  return E.tarjetas.filter(c => !c.archivada && listas.includes(c.lista_id)).length;
}

function pintarTematicas() {
  const vis = E.tematicas.filter(t => !t.archivada);
  $('tematicas').innerHTML = vis.map(t =>
    `<button type="button" class="tem ${t.id === E.actual ? 'activa' : ''}" style="--c:${t.color}" data-tem="${t.id}">${esc(t.icono)} ${esc(t.nombre)} <span class="pend" title="Tarjetas sin terminar">${pendientes(t)}</span></button>`).join('') +
    (editable() ? `<button type="button" class="tem nueva" id="nueva-tematica">${I.mas} Nueva temática</button>` : '') +
    (E.tematicas.some(t => t.archivada) ? `<button type="button" class="tem nueva" id="tem-archivadas">Temáticas archivadas</button>` : '');
  $('sin-tematicas').hidden = vis.length > 0;
  $('barra-tablero').hidden = !E.actual;
}

function pasaFiltro(c) {
  const q = $('buscar').value.trim().toLowerCase(), p = $('filtro-persona').value;
  if (q && !(c.titulo + ' ' + c.descripcion).toLowerCase().includes(q)) return false;
  if (p === '__yo') return c.responsable === E.yo.email;
  if (p === '__nadie') return !c.responsable;
  if (p) return c.responsable === p;
  return true;
}

function htmlTarjeta(c) {
  const tareas = c.tareas || [], hechas = tareas.filter(x => x.h).length;
  const nAdj = E.adjuntos.filter(a => a.tarjeta_id === c.id).length;
  let vence = '';
  if (c.vence) {
    const dias = Math.round((new Date(c.vence) - new Date(hoyISO())) / 864e5);
    const terminada = (E.listas.find(l => l.id === c.lista_id) || {}).terminada;
    const cls = terminada ? '' : dias < 0 ? 'pasada' : dias <= 4 ? 'pronto' : '';
    vence = `<span class="vence ${cls}" title="Fecha límite">${I.cal}${fmtFecha(c.vence)}</span>`;
  }
  return `<button type="button" class="tarjeta" draggable="${editable()}" data-id="${c.id}">
    ${c.etiquetas?.length ? `<span class="etqs">${c.etiquetas.filter(e => ETIQUETAS[e]).map(e => `<span class="etq" style="background:${ETIQUETAS[e][1]}">${ETIQUETAS[e][0]}</span>`).join('')}</span>` : ''}
    <h3>${esc(c.titulo)}</h3>
    <span class="meta">${vence}
      ${c.descripcion ? `<span title="Tiene descripción">${I.texto}</span>` : ''}
      ${tareas.length ? `<span class="${hechas === tareas.length ? 'ok' : ''}" title="Tareas hechas">${I.check}${hechas}/${tareas.length}</span>` : ''}
      ${c.enlaces?.length ? `<span title="Enlaces">${I.enlace}${c.enlaces.length}</span>` : ''}
      ${nAdj ? `<span title="Adjuntos">${I.clip}${nAdj}</span>` : ''}
      ${c.responsable ? `<span class="avatar" title="${esc(nombreDe(c.responsable))}">${esc(iniciales(nombreDe(c.responsable)))}</span>` : ''}
    </span></button>`;
}

function pintarTablero() {
  const t = E.tematicas.find(x => x.id === E.actual);
  const tab = $('tablero');
  if (!t) { tab.innerHTML = ''; return; }
  $('tit-tablero').textContent = `${t.icono} ${t.nombre}`;
  $('desc-tablero').textContent = t.descripcion || '';
  $('editar-tematica').hidden = !editable();
  $('ver-archivadas').textContent = E.verArchivadas ? 'Ocultar archivadas' : 'Ver archivadas';
  const listas = E.listas.filter(l => l.tematica_id === t.id);
  tab.innerHTML = listas.map(l => {
    const cs = E.tarjetas.filter(c => c.lista_id === l.id && c.archivada === E.verArchivadas);
    return `<section class="lista" style="--c:${l.color}">
      <div class="lista-cab"><span class="nom">${esc(l.nombre)}${l.terminada ? ' ✓' : ''}</span><span class="n">${cs.length}</span>
        ${editable() ? `<button type="button" class="btn-ico" data-editar-lista="${l.id}" title="Cambiar la lista" aria-label="Cambiar la lista ${esc(l.nombre)}">⋯</button>` : ''}</div>
      <div class="tarjetas" data-lista="${l.id}">${cs.filter(pasaFiltro).map(htmlTarjeta).join('')}</div>
      ${editable() && !E.verArchivadas ? `<div class="form-rapido" data-lista="${l.id}"></div>
      <button type="button" class="anadir" data-anadir="${l.id}">${I.mas} Añadir tarjeta</button>` : ''}
    </section>`;
  }).join('') + (editable() && !E.verArchivadas ? `<section class="lista nueva-lista"><button type="button" class="anadir" id="nueva-lista">${I.mas} Añadir otra lista</button></section>` : '');
  if (E.verArchivadas && !E.tarjetas.some(c => c.archivada && listas.some(l => l.id === c.lista_id)))
    tab.insertAdjacentHTML('afterbegin', '<p class="vacio" style="padding:10px 0;width:100%">No hay tarjetas archivadas en esta temática.</p>');
}

/* ---------- Arrastrar tarjetas ---------- */
let arrastrando = null;
document.addEventListener('dragstart', e => {
  const el = e.target.closest?.('.tarjeta'); if (!el || !editable()) return;
  arrastrando = el.dataset.id; el.classList.add('arrastrando');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', arrastrando);
});
document.addEventListener('dragend', e => { e.target.closest?.('.tarjeta')?.classList.remove('arrastrando'); arrastrando = null; document.querySelectorAll('.sobre').forEach(z => z.classList.remove('sobre')); });
document.addEventListener('dragover', e => { const z = e.target.closest?.('.tarjetas'); if (z && arrastrando) { e.preventDefault(); z.classList.add('sobre'); } });
document.addEventListener('dragleave', e => { const z = e.target.closest?.('.tarjetas'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('sobre'); });
document.addEventListener('drop', async e => {
  const z = e.target.closest?.('.tarjetas'); if (!z || !arrastrando) return;
  e.preventDefault(); z.classList.remove('sobre');
  const id = arrastrando, destino = z.dataset.lista;
  const otras = [...z.querySelectorAll('.tarjeta')].filter(x => x.dataset.id !== id);
  const i = otras.findIndex(x => e.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
  const ord = id2 => (E.tarjetas.find(c => c.id === id2) || {}).orden;
  let orden;
  if (!otras.length) orden = 1;
  else if (i === -1) orden = ord(otras[otras.length - 1].dataset.id) + 1;
  else if (i === 0) orden = ord(otras[0].dataset.id) - 1;
  else orden = (ord(otras[i - 1].dataset.id) + ord(otras[i].dataset.id)) / 2;
  await moverTarjeta(id, destino, orden);
});

async function moverTarjeta(id, lista_id, orden) {
  const c = E.tarjetas.find(x => x.id === id); if (!c) return;
  const antes = { lista_id: c.lista_id, orden: c.orden };
  Object.assign(c, { lista_id, orden }); E.tarjetas.sort(porOrden); pintarTematicas(); pintarTablero();
  try { Object.assign(c, await API.cambiar('pas_tab_tarjetas', id, { lista_id, orden })); }
  catch (e) { Object.assign(c, antes); E.tarjetas.sort(porOrden); pintar(); fallo(e); }
}

/* ---------- Clics ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('button, a'); if (!b) return;
  if (b.dataset.tem) { E.actual = b.dataset.tem; E.verArchivadas = false; pintarTematicas(); pintarTablero(); return; }
  if (b.classList.contains('tarjeta')) { abrirTarjeta(b.dataset.id); return; }
  if (b.dataset.anadir) { formRapido(b.dataset.anadir); return; }
  if (b.dataset.editarLista) { editarLista(b.dataset.editarLista); return; }
  if (b.hasAttribute('data-salir')) { await salir(); return; }
  switch (b.id) {
    case 'entrar': return entrar();
    case 'salir': return salir();
    case 'nueva-tematica': return editarTematica(null);
    case 'editar-tematica': return editarTematica(E.actual);
    case 'tem-archivadas': return temasArchivados();
    case 'nueva-lista': return editarLista(null);
    case 'ver-archivadas': E.verArchivadas = !E.verArchivadas; return pintarTablero();
    case 'nuevo-curso': return nuevoCurso();
  }
});
$('curso').addEventListener('change', async e => { E.curso = e.target.value; E.actual = null; E.verArchivadas = false; try { await cargarCurso(); } catch (x) { fallo(x); } });
$('buscar').addEventListener('input', () => pintarTablero());
$('filtro-persona').addEventListener('change', () => pintarTablero());
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('velo2').hidden) cerrar2(); else if (!$('velo').hidden) cerrarTarjeta();
});
$('velo').addEventListener('mousedown', e => { if (e.target.id === 'velo') cerrarTarjeta(); });
$('velo2').addEventListener('mousedown', e => { if (e.target.id === 'velo2') cerrar2(); });

async function entrar() {
  if (DEMO) return;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email profile', redirectTo: location.origin + location.pathname } });
  if (error) aviso(error.message, true);
}
async function salir() { if (DEMO) return location.reload(); await sb.auth.signOut(); location.reload(); }

/* ---------- Tarjeta nueva (rápida) ---------- */
function formRapido(lista_id) {
  const caja = document.querySelector(`.form-rapido[data-lista="${lista_id}"]`);
  caja.innerHTML = `<textarea placeholder="Título de la tarjeta" maxlength="200"></textarea>
    <div class="acc"><button type="button" class="btn pri sec">Añadir</button><button type="button" class="btn sec">Cancelar</button></div>`;
  const ta = caja.querySelector('textarea'); ta.focus();
  const [ok, no] = caja.querySelectorAll('button');
  const guardar = async () => {
    const titulo = ta.value.trim(); if (!titulo) return;
    ok.disabled = true;
    const ultimas = E.tarjetas.filter(c => c.lista_id === lista_id);
    try {
      const c = await API.crear('pas_tab_tarjetas', { lista_id, titulo, orden: ultimas.length ? Math.max(...ultimas.map(c => c.orden)) + 1 : 1 });
      E.tarjetas.push(c); pintarTematicas(); pintarTablero(); formRapido(lista_id);
    } catch (e) { fallo(e); ok.disabled = false; }
  };
  ok.onclick = guardar; no.onclick = () => { caja.innerHTML = ''; };
  ta.onkeydown = ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); guardar(); } if (ev.key === 'Escape') { ev.stopPropagation(); caja.innerHTML = ''; } };
}

/* ---------- Ventana de la tarjeta ---------- */
async function abrirTarjeta(id, refresco) {
  const c = E.tarjetas.find(x => x.id === id);
  if (!c) { if (refresco) cerrarTarjeta(); return; }
  E.abierta = id;
  const l = E.listas.find(x => x.id === c.lista_id), t = E.tematicas.find(x => x.id === l.tematica_id);
  const ed = editable(), tareas = c.tareas || [], hechas = tareas.filter(x => x.h).length;
  const adj = E.adjuntos.filter(a => a.tarjeta_id === c.id).sort((a, b) => a.subido.localeCompare(b.subido));
  const listasTem = E.listas.filter(x => x.tematica_id === t.id);
  const opcResp = [['', '— Sin responsable —'], ...E.equipo.map(p => [p.email, p.nombre])];
  if (c.responsable && !E.equipo.some(p => p.email === c.responsable)) opcResp.push([c.responsable, c.responsable + ' (ya no está en el equipo)']);
  const v = $('ventana');
  v.style.setProperty('--c', l.color);
  v.innerHTML = `
    <div class="v-cab"><div class="tit">
        ${ed ? `<input class="titulo" id="t-titulo" maxlength="200" value="${esc(c.titulo)}" aria-label="Título">` : `<h2>${esc(c.titulo)}</h2>`}
        <div class="en">En la lista <b>${esc(l.nombre)}</b> · ${esc(t.icono)} ${esc(t.nombre)}${c.archivada ? ' · <b>Archivada</b>' : ''}</div></div>
      <button type="button" class="cerrar" id="t-cerrar" aria-label="Cerrar">${I.x}</button></div>
    <div class="v-cuerpo">
      <div>
        <div class="v-sec"><h4>${I.texto} Descripción</h4>
          ${ed ? `<textarea id="t-desc" maxlength="5000" placeholder="Escribe aquí los detalles…">${esc(c.descripcion)}</textarea>`
               : `<p style="white-space:pre-wrap;margin:0">${esc(c.descripcion) || '<span class="nada">Sin descripción.</span>'}</p>`}</div>
        <div class="v-sec"><h4>${I.check} Tareas${tareas.length ? ` · ${hechas} de ${tareas.length}` : ''}</h4>
          ${tareas.length ? `<div class="progreso"><div style="width:${Math.round(hechas * 100 / tareas.length)}%"></div></div>` : ''}
          ${tareas.map((k, i) => `<div class="check ${k.h ? 'hecho' : ''}"><input type="checkbox" id="k${i}" data-tarea="${i}" ${k.h ? 'checked' : ''} ${ed ? '' : 'disabled'}><label for="k${i}">${esc(k.t)}</label>
            ${ed ? `<button type="button" class="btn-ico" data-quitar-tarea="${i}" title="Quitar tarea" aria-label="Quitar tarea">✕</button>` : ''}</div>`).join('') || (ed ? '' : '<p class="nada">Sin tareas.</p>')}
          ${ed ? `<div class="fila-add"><input id="t-nueva-tarea" maxlength="300" placeholder="Nueva tarea…"><button type="button" class="btn sec" id="t-add-tarea">${I.mas} Añadir</button></div>` : ''}</div>
        <div class="v-sec"><h4>${I.enlace} Enlaces</h4>
          ${(c.enlaces || []).map((x, i) => { const u = urlSegura(x.u); return `<div class="item"><span class="ic">${I.enlace}</span><span class="t"><b>${esc(x.n || x.u)}</b><small>${esc(x.u)}</small></span>
            ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : ''}${ed ? `<button type="button" class="btn-ico" data-quitar-enlace="${i}" title="Quitar enlace" aria-label="Quitar enlace">✕</button>` : ''}</div>`; }).join('') || '<p class="nada">Sin enlaces.</p>'}
          ${ed ? `<div class="fila-add"><input id="t-enlace-u" type="url" placeholder="Pega la dirección (https://…)"><input id="t-enlace-n" maxlength="120" placeholder="Nombre (opcional)"><button type="button" class="btn sec" id="t-add-enlace">${I.mas} Añadir</button></div>` : ''}</div>
        <div class="v-sec"><h4>${I.clip} Adjuntos</h4>
          ${adj.map(a => `<div class="item"><span class="ic">${esc(extension(a.nombre))}</span><span class="t"><b>${esc(a.nombre)}</b><small>${tamano(a.tamano)} · ${esc(nombreDe(a.subido_por))} · ${fmtCuando(a.subido)}</small></span>
            <button type="button" class="lnk" data-ver-adjunto="${a.id}">Ver</button>${ed ? `<button type="button" class="btn-ico" data-quitar-adjunto="${a.id}" title="Quitar archivo" aria-label="Quitar archivo">✕</button>` : ''}</div>`).join('') || '<p class="nada">Sin adjuntos.</p>'}
          ${ed ? `<label class="btn sec" style="cursor:pointer">${I.clip} Subir archivo (máx. ${MAX_MB} MB)<input type="file" id="t-archivo" hidden multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"></label>
          <div class="rgpd">⚠️ <b>Protección de datos:</b> no subas listas de alumnado, fotos de menores, datos de salud ni datos de familias. Para eso, pon el enlace a la carpeta de Teams o SharePoint donde ya están.</div>` : ''}</div>
      </div>
      <aside class="lado">
        <div class="campo"><label class="tit" for="t-resp">Responsable</label>
          <select id="t-resp" ${ed ? '' : 'disabled'}>${opcResp.map(([k, n]) => `<option value="${esc(k)}" ${k === (c.responsable || '') ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="campo"><label class="tit" for="t-vence">Fecha límite</label><input type="date" id="t-vence" value="${c.vence || ''}" ${ed ? '' : 'disabled'}></div>
        <div class="campo"><label class="tit">Etiquetas</label><div class="etqs">${Object.entries(ETIQUETAS).map(([k, x]) =>
          `<button type="button" class="etq ${c.etiquetas?.includes(k) ? 'on' : ''}" style="background:${x[1]};color:${x[1]}" data-etq="${k}" ${ed ? '' : 'disabled'} aria-pressed="${!!c.etiquetas?.includes(k)}"><span style="color:#fff">${x[0]}</span></button>`).join('')}</div></div>
        ${ed ? `<div class="campo"><label class="tit" for="t-mover">Mover a</label><select id="t-mover">${listasTem.map(x => `<option value="${x.id}" ${x.id === l.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div>
        <div class="campo" style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn sec" id="t-archivar">${c.archivada ? 'Recuperar' : 'Archivar'}</button>
          ${c.archivada ? '<button type="button" class="btn sec peligro" id="t-borrar">Borrar para siempre</button>' : ''}</div>` : ''}
        <div class="historial" id="t-historial"><h4 style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;display:flex;gap:5px">${I.hist} Historial</h4><div class="nada">Cargando…</div></div>
      </aside>
    </div>`;
  $('velo').hidden = false;
  if (!refresco) $('t-cerrar').focus();
  conectarTarjeta(c);
  try {
    const h = await API.leer('pas_tab_historial', q => q.eq('tarjeta_id', c.id).order('cuando', { ascending: false }).limit(40));
    const caja = $('t-historial'); if (!caja || E.abierta !== c.id) return;
    caja.lastElementChild.remove();
    caja.insertAdjacentHTML('beforeend', h.map(x => `<div><b>${esc(nombreDe(x.quien))}</b> ${esc(x.que)} · ${fmtCuando(x.cuando)}</div>`).join('') || '<div>Sin cambios todavía.</div>');
  } catch (e) { console.warn(e); }
}
const extension = n => (n.split('.').pop() || '').slice(0, 4).toUpperCase();
const tamano = b => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

function cerrarTarjeta() { $('velo').hidden = true; E.abierta = null; pintarTematicas(); pintarTablero(); }

async function guardarTarjeta(c, cambios) {
  const antes = {}; Object.keys(cambios).forEach(k => { antes[k] = c[k]; });
  Object.assign(c, cambios);
  try { Object.assign(c, await API.cambiar('pas_tab_tarjetas', c.id, cambios)); return true; }
  catch (e) { Object.assign(c, antes); fallo(e); return false; }
}

function conectarTarjeta(c) {
  const v = $('ventana'), re = () => abrirTarjeta(c.id, true);
  $('t-cerrar').onclick = cerrarTarjeta;
  if (!editable()) { v.querySelectorAll('[data-ver-adjunto]').forEach(b => b.onclick = () => verAdjunto(b.dataset.verAdjunto)); return; }
  const tit = $('t-titulo');
  tit.onchange = async () => { const x = tit.value.trim(); if (!x) { tit.value = c.titulo; return; } if (x !== c.titulo) await guardarTarjeta(c, { titulo: x }); };
  tit.onkeydown = e => { if (e.key === 'Enter') tit.blur(); };
  const desc = $('t-desc');
  desc.onchange = async () => { if (desc.value !== c.descripcion) await guardarTarjeta(c, { descripcion: desc.value }); };
  v.querySelectorAll('[data-tarea]').forEach(k => k.onchange = async () => {
    const tareas = (c.tareas || []).map((x, i) => i === +k.dataset.tarea ? { ...x, h: k.checked } : x);
    if (await guardarTarjeta(c, { tareas })) re();
  });
  v.querySelectorAll('[data-quitar-tarea]').forEach(b => b.onclick = async () => {
    const tareas = (c.tareas || []).filter((_, i) => i !== +b.dataset.quitarTarea);
    if (await guardarTarjeta(c, { tareas })) re();
  });
  const addTarea = async () => {
    const inp = $('t-nueva-tarea'), x = inp.value.trim(); if (!x) return;
    if (await guardarTarjeta(c, { tareas: [...(c.tareas || []), { t: x, h: false }] })) { await abrirTarjeta(c.id, true); $('t-nueva-tarea')?.focus(); }
  };
  $('t-add-tarea').onclick = addTarea;
  $('t-nueva-tarea').onkeydown = e => { if (e.key === 'Enter') addTarea(); };
  const addEnlace = async () => {
    let u = $('t-enlace-u').value.trim(); const n = $('t-enlace-n').value.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    if (!urlSegura(u)) { aviso('Esa dirección no parece válida.', true); return; }
    if (await guardarTarjeta(c, { enlaces: [...(c.enlaces || []), { n: n || u.replace(/^https?:\/\//, '').slice(0, 80), u }] })) re();
  };
  $('t-add-enlace').onclick = addEnlace;
  $('t-enlace-u').onkeydown = $('t-enlace-n').onkeydown = e => { if (e.key === 'Enter') addEnlace(); };
  v.querySelectorAll('[data-quitar-enlace]').forEach(b => b.onclick = async () => {
    if (await guardarTarjeta(c, { enlaces: (c.enlaces || []).filter((_, i) => i !== +b.dataset.quitarEnlace) })) re();
  });
  v.querySelectorAll('[data-ver-adjunto]').forEach(b => b.onclick = () => verAdjunto(b.dataset.verAdjunto));
  v.querySelectorAll('[data-quitar-adjunto]').forEach(b => b.onclick = () => quitarAdjunto(b.dataset.quitarAdjunto, re));
  $('t-archivo').onchange = e => subirArchivos(c, [...e.target.files], re);
  $('t-resp').onchange = async e => { await guardarTarjeta(c, { responsable: e.target.value || null }); };
  $('t-vence').onchange = async e => { await guardarTarjeta(c, { vence: e.target.value || null }); };
  v.querySelectorAll('[data-etq]').forEach(b => b.onclick = async () => {
    const k = b.dataset.etq, act = c.etiquetas || [];
    if (await guardarTarjeta(c, { etiquetas: act.includes(k) ? act.filter(x => x !== k) : [...act, k] })) re();
  });
  $('t-mover').onchange = async e => {
    const otras = E.tarjetas.filter(x => x.lista_id === e.target.value);
    await moverTarjeta(c.id, e.target.value, otras.length ? Math.max(...otras.map(x => x.orden)) + 1 : 1); re();
  };
  $('t-archivar').onclick = async () => {
    if (await guardarTarjeta(c, { archivada: !c.archivada })) { aviso(c.archivada ? 'Tarjeta archivada. La encuentras en «Ver archivadas».' : 'Tarjeta recuperada.'); cerrarTarjeta(); }
  };
  if ($('t-borrar')) $('t-borrar').onclick = async () => {
    if (!await confirmar('¿Borrar esta tarjeta para siempre?', `Se borrarán también sus ${E.adjuntos.filter(a => a.tarjeta_id === c.id).length} archivos adjuntos. No se puede deshacer.`, 'Borrar para siempre')) return;
    try {
      const rutas = E.adjuntos.filter(a => a.tarjeta_id === c.id).map(a => a.ruta);
      await API.borrar('pas_tab_tarjetas', c.id);
      E.tarjetas = E.tarjetas.filter(x => x.id !== c.id); E.adjuntos = E.adjuntos.filter(a => a.tarjeta_id !== c.id);
      try { await API.quitarArchivos(rutas); } catch (x) { console.warn(x); }
      aviso('Tarjeta borrada.'); cerrarTarjeta();
    } catch (x) { fallo(x); }
  };
}

/* ---------- Adjuntos ---------- */
const TIPOS = /\.(pdf|jpe?g|png|gif|webp|heic|docx?|xlsx?|pptx?|txt)$/i;
async function subirArchivos(c, archivos, re) {
  for (const f of archivos) {
    if (!TIPOS.test(f.name)) { aviso(`«${f.name}»: ese tipo de archivo no se admite (PDF, imágenes u Office).`, true); continue; }
    if (f.size > MAX_MB * 1048576) { aviso(`«${f.name}» pasa de ${MAX_MB} MB.`, true); continue; }
    const ext = (f.name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const ruta = `${c.id}/${crypto.randomUUID()}${ext}`;
    aviso(`Subiendo «${f.name}»…`);
    try {
      await API.subir(ruta, f);
      try {
        const a = await API.crear('pas_tab_adjuntos', { tarjeta_id: c.id, nombre: f.name.slice(0, 200), ruta, tipo: f.type || '', tamano: f.size, subido_por: E.yo.email });
        E.adjuntos.push(a); aviso(`«${f.name}» subido.`);
      } catch (e) { await API.quitarArchivos([ruta]).catch(() => {}); throw e; }
    } catch (e) { fallo(e); }
  }
  re();
}
async function verAdjunto(id) {
  const a = E.adjuntos.find(x => x.id === id); if (!a) return;
  const w = window.open('', '_blank');   // se abre ya para que el navegador no la bloquee
  try { const u = await API.enlaceTemporal(a.ruta, a.nombre); if (w) w.location = u; else location.href = u; }
  catch (e) { if (w) w.close(); fallo(e); }
}
async function quitarAdjunto(id, re) {
  const a = E.adjuntos.find(x => x.id === id); if (!a) return;
  if (!await confirmar('¿Quitar este archivo?', `«${a.nombre}» se borrará y no se podrá recuperar.`, 'Quitar')) return;
  try {
    await API.borrar('pas_tab_adjuntos', id);
    E.adjuntos = E.adjuntos.filter(x => x.id !== id);
    try { await API.quitarArchivos([a.ruta]); } catch (e) { console.warn(e); }
    re();
  } catch (e) { fallo(e); }
}

/* ---------- Ventanas pequeñas: confirmar y formularios ---------- */
let resolver2 = null;
function cerrar2(valor) { $('velo2').hidden = true; const r = resolver2; resolver2 = null; if (r) r(valor); }
function ventana2(html, alAbrir) {
  return new Promise(res => {
    resolver2 = res; $('ventana2').innerHTML = html; $('velo2').hidden = false;
    alAbrir?.($('ventana2'));
    ($('ventana2').querySelector('input, textarea, select') || $('ventana2').querySelector('.btn.pri'))?.focus();
  });
}
function confirmar(titulo, texto, boton) {
  return ventana2(`<div class="v-cab" style="--c:#d64545"><div class="tit"><h2>${esc(titulo)}</h2></div></div>
    <p class="v-texto">${esc(texto)}</p>
    <div class="v-pie"><button type="button" class="btn" data-no>Cancelar</button><button type="button" class="btn peligro" data-si>${esc(boton)}</button></div>`,
    v => { v.querySelector('[data-no]').onclick = () => cerrar2(false); v.querySelector('[data-si]').onclick = () => cerrar2(true); });
}

function selectorColor(actual) {
  return `<div class="colores" data-colores>${COLORES.map(c => `<button type="button" style="background:${c}" data-color="${c}" class="${c === actual ? 'on' : ''}" aria-label="Color ${c}"></button>`).join('')}</div>`;
}
function conectarColores(v, onColor) {
  v.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { v.querySelectorAll('[data-color]').forEach(x => x.classList.remove('on')); b.classList.add('on'); onColor(b.dataset.color); });
}

async function editarTematica(id) {
  const t = id ? E.tematicas.find(x => x.id === id) : { nombre: '', icono: '📌', color: '#009abb', descripcion: '' };
  let color = t.color, icono = t.icono;
  const vis = E.tematicas.filter(x => !x.archivada), pos = vis.findIndex(x => x.id === id);
  const r = await ventana2(`<div class="v-cab" style="--c:${t.color}"><div class="tit"><h2>${id ? 'Cambiar temática' : 'Nueva temática'}</h2>
      ${id ? '' : '<div class="en">Empieza con las listas «Por hacer», «En marcha» y «Hecho». Luego se pueden cambiar.</div>'}</div>
      <button type="button" class="cerrar" data-no aria-label="Cerrar">${I.x}</button></div>
    <div class="campo-f"><label for="f-nombre">Nombre</label><input id="f-nombre" maxlength="80" value="${esc(t.nombre)}" placeholder="Por ejemplo, Cuaresma y Pascua"></div>
    <div class="campo-f"><label for="f-desc">Descripción corta (opcional)</label><input id="f-desc" maxlength="200" value="${esc(t.descripcion)}"></div>
    <div class="campo-f"><label>Icono</label><div class="colores" data-iconos>${ICONOS.map(x => `<button type="button" data-icono="${x}" class="${x === icono ? 'on' : ''}" style="background:var(--lista);font-size:15px;line-height:1">${x}</button>`).join('')}</div></div>
    <div class="campo-f"><label>Color</label>${selectorColor(color)}</div>
    ${id ? `<div class="campo-f"><label>Orden</label><div style="display:flex;gap:6px">
      <button type="button" class="btn sec" data-mover="-1" ${pos <= 0 ? 'disabled' : ''}>← Más a la izquierda</button>
      <button type="button" class="btn sec" data-mover="1" ${pos >= vis.length - 1 ? 'disabled' : ''}>Más a la derecha →</button></div></div>` : ''}
    <div class="v-pie">${id ? '<button type="button" class="btn peligro" data-archivar style="margin-right:auto">Archivar temática</button>' : ''}
      <button type="button" class="btn" data-no>Cancelar</button><button type="button" class="btn pri" data-si>Guardar</button></div>`,
    v => {
      conectarColores(v, c => { color = c; });
      v.querySelectorAll('[data-icono]').forEach(b => b.onclick = () => { v.querySelectorAll('[data-icono]').forEach(x => x.classList.remove('on')); b.classList.add('on'); icono = b.dataset.icono; });
      v.querySelectorAll('[data-no]').forEach(b => b.onclick = () => cerrar2(null));
      v.querySelector('[data-si]').onclick = () => { const n = $('f-nombre').value.trim(); if (!n) { $('f-nombre').focus(); return; } cerrar2({ nombre: n, descripcion: $('f-desc').value.trim(), color, icono }); };
      v.querySelectorAll('[data-mover]').forEach(b => b.onclick = () => cerrar2({ mover: +b.dataset.mover }));
      v.querySelector('[data-archivar]')?.addEventListener('click', () => cerrar2({ archivar: true }));
    });
  if (!r) return;
  try {
    if (r.mover) {
      const otra = vis[pos + r.mover];
      const [a, b] = [t.orden, otra.orden === t.orden ? t.orden + r.mover : otra.orden];
      Object.assign(t, await API.cambiar('pas_tab_tematicas', t.id, { orden: b }));
      Object.assign(otra, await API.cambiar('pas_tab_tematicas', otra.id, { orden: a }));
      E.tematicas.sort(porOrden); pintar(); return editarTematica(id);
    }
    if (r.archivar) {
      if (!await confirmar('¿Archivar esta temática?', 'Deja de verse en el tablero, pero no se borra nada. Se puede recuperar en «Temáticas archivadas».', 'Archivar')) return;
      Object.assign(t, await API.cambiar('pas_tab_tematicas', t.id, { archivada: true }));
      E.actual = null; await cargarCurso(); return;
    }
    if (id) { Object.assign(t, await API.cambiar('pas_tab_tematicas', id, r)); pintar(); return; }
    const nueva = await API.crear('pas_tab_tematicas', { ...r, curso: E.curso, orden: E.tematicas.length ? Math.max(...E.tematicas.map(x => x.orden)) + 1 : 1 });
    for (const [i, [nombre, c, terminada]] of [['Por hacer', '#ee712a', false], ['En marcha', '#009abb', false], ['Hecho', '#b4be00', true]].entries())
      await API.crear('pas_tab_listas', { tematica_id: nueva.id, nombre, color: c, orden: i + 1, terminada });
    E.actual = nueva.id; await cargarCurso();
  } catch (e) { fallo(e); }
}

async function temasArchivados() {
  const arch = E.tematicas.filter(t => t.archivada);
  const r = await ventana2(`<div class="v-cab"><div class="tit"><h2>Temáticas archivadas</h2></div><button type="button" class="cerrar" data-no aria-label="Cerrar">${I.x}</button></div>
    <div class="campo-f">${arch.map(t => `<div class="item"><span class="ic" style="font-size:16px">${esc(t.icono)}</span><span class="t"><b>${esc(t.nombre)}</b></span>
      ${editable() ? `<button type="button" class="lnk" data-recuperar="${t.id}">Recuperar</button>` : ''}</div>`).join('')}</div>
    <div class="v-pie"><button type="button" class="btn" data-no>Cerrar</button></div>`,
    v => { v.querySelectorAll('[data-no]').forEach(b => b.onclick = () => cerrar2(null)); v.querySelectorAll('[data-recuperar]').forEach(b => b.onclick = () => cerrar2(b.dataset.recuperar)); });
  if (!r) return;
  try { await API.cambiar('pas_tab_tematicas', r, { archivada: false }); E.actual = r; await cargarCurso(); } catch (e) { fallo(e); }
}

async function editarLista(id) {
  const l = id ? E.listas.find(x => x.id === id) : { nombre: '', color: '#5b6b7b', terminada: false };
  let color = l.color;
  const hermanas = E.listas.filter(x => x.tematica_id === (id ? l.tematica_id : E.actual)), pos = hermanas.findIndex(x => x.id === id);
  const n = id ? E.tarjetas.filter(c => c.lista_id === id).length : 0;
  const r = await ventana2(`<div class="v-cab" style="--c:${l.color}"><div class="tit"><h2>${id ? 'Cambiar lista' : 'Nueva lista'}</h2></div>
      <button type="button" class="cerrar" data-no aria-label="Cerrar">${I.x}</button></div>
    <div class="campo-f"><label for="f-nombre">Nombre</label><input id="f-nombre" maxlength="60" value="${esc(l.nombre)}" placeholder="Por ejemplo, Pendiente de Dirección"></div>
    <div class="campo-f"><label>Color</label>${selectorColor(color)}</div>
    <div class="campo-f check-f"><label><input type="checkbox" id="f-terminada" ${l.terminada ? 'checked' : ''}> Es una lista de cosas terminadas (no cuentan como pendientes ni se marcan las fechas)</label></div>
    ${id ? `<div class="campo-f"><label>Orden</label><div style="display:flex;gap:6px">
      <button type="button" class="btn sec" data-mover="-1" ${pos <= 0 ? 'disabled' : ''}>← Izquierda</button>
      <button type="button" class="btn sec" data-mover="1" ${pos >= hermanas.length - 1 ? 'disabled' : ''}>Derecha →</button></div></div>` : ''}
    <div class="v-pie">${id ? '<button type="button" class="btn peligro" data-borrar style="margin-right:auto">Borrar lista</button>' : ''}
      <button type="button" class="btn" data-no>Cancelar</button><button type="button" class="btn pri" data-si>Guardar</button></div>`,
    v => {
      conectarColores(v, c => { color = c; });
      v.querySelectorAll('[data-no]').forEach(b => b.onclick = () => cerrar2(null));
      v.querySelector('[data-si]').onclick = () => { const x = $('f-nombre').value.trim(); if (!x) { $('f-nombre').focus(); return; } cerrar2({ nombre: x, color, terminada: $('f-terminada').checked }); };
      v.querySelectorAll('[data-mover]').forEach(b => b.onclick = () => cerrar2({ mover: +b.dataset.mover }));
      v.querySelector('[data-borrar]')?.addEventListener('click', () => cerrar2({ borrar: true }));
    });
  if (!r) return;
  try {
    if (r.mover) {
      const otra = hermanas[pos + r.mover];
      const [a, b] = [l.orden, otra.orden === l.orden ? l.orden + r.mover : otra.orden];
      Object.assign(l, await API.cambiar('pas_tab_listas', l.id, { orden: b }));
      Object.assign(otra, await API.cambiar('pas_tab_listas', otra.id, { orden: a }));
      E.listas.sort(porOrden); pintarTablero(); return editarLista(id);
    }
    if (r.borrar) {
      if (!await confirmar('¿Borrar esta lista?', n ? `Tiene ${n} tarjetas (contando las archivadas), que se borrarán con sus adjuntos. No se puede deshacer. Si quieres conservarlas, muévelas antes a otra lista.` : 'La lista está vacía.', 'Borrar lista')) return;
      const rutas = E.adjuntos.filter(a => E.tarjetas.some(c => c.lista_id === id && c.id === a.tarjeta_id)).map(a => a.ruta);
      await API.borrar('pas_tab_listas', id);
      try { await API.quitarArchivos(rutas); } catch (x) { console.warn(x); }
      await cargarCurso(); return;
    }
    if (id) { Object.assign(l, await API.cambiar('pas_tab_listas', id, r)); pintar(); return; }
    E.listas.push(await API.crear('pas_tab_listas', { ...r, tematica_id: E.actual, orden: hermanas.length ? Math.max(...hermanas.map(x => x.orden)) + 1 : 1 }));
    pintar();
  } catch (e) { fallo(e); }
}

/* ---------- Empezar curso nuevo ---------- */
async function nuevoCurso() {
  const nuevo = E.yo.curso_hoy, antiguo = [...E.cursos, nuevo].sort().reverse().slice(3);
  // Se copian las temáticas del curso más reciente; las tarjetas se pueden copiar como plantilla
  if (E.curso !== E.yo.curso_editable) { E.curso = E.yo.curso_editable; await cargarCurso(); }
  const grupos = E.tematicas.filter(t => !t.archivada).map(t => {
    const ls = E.listas.filter(l => l.tematica_id === t.id).map(l => l.id);
    const cs = E.tarjetas.filter(c => !c.archivada && ls.includes(c.lista_id));
    return cs.length ? `<h5>${esc(t.icono)} ${esc(t.nombre)}</h5>` + cs.map(c => `<label><input type="checkbox" value="${c.id}"> ${esc(c.titulo)}</label>`).join('') : '';
  }).join('');
  const r = await ventana2(`<div class="v-cab"><div class="tit"><h2>Empezar el curso ${nuevo}</h2></div><button type="button" class="cerrar" data-no aria-label="Cerrar">${I.x}</button></div>
    <p class="v-texto">Se copian las temáticas y las listas del curso ${esc(E.yo.curso_editable)}. Las tarjetas se quedan en su curso, que pasa a ser solo para consultar.</p>
    ${grupos ? `<div class="campo-f"><label>Copiar como plantilla (opcional)</label><div class="plantillas">${grupos}</div>
      <div class="ayuda">Las tarjetas marcadas se copian con sus tareas sin marcar, sin fecha, sin responsable y sin adjuntos.</div></div>` : ''}
    ${antiguo.length ? `<div class="campo-f"><div class="rgpd">Se guardan el curso nuevo y los dos anteriores. Se <b>borrará el curso ${antiguo.join(', ')}</b> con todas sus tarjetas y adjuntos.</div></div>` : ''}
    <div class="v-pie"><button type="button" class="btn" data-no>Cancelar</button><button type="button" class="btn pri" data-si>Empezar el curso ${nuevo}</button></div>`,
    v => { v.querySelectorAll('[data-no]').forEach(b => b.onclick = () => cerrar2(null)); v.querySelector('[data-si]').onclick = () => cerrar2([...v.querySelectorAll('.plantillas input:checked')].map(x => x.value)); });
  if (!r) return;
  try {
    const curso = await API.rpc('pas_tab_nuevo_curso', { p_plantillas: r });
    E.yo = await API.rpc('pas_tab_quien_soy');
    E.cursos = (await API.leer('pas_tab_cursos')).map(c => c.curso).sort().reverse();
    E.curso = curso; E.actual = null; await cargarCurso();
    aviso(`Curso ${curso} preparado.`);
    limpiarHuerfanos();
  } catch (e) { fallo(e); }
}

/* ---------- Datos inventados (?demo) ---------- */
function crearDemo() {
  const id = () => crypto.randomUUID();
  const ahora = () => new Date().toISOString();
  const yo = 'lucia.martin@salesianas.org';
  const hoy = new Date(); const curso = (hoy.getMonth() >= 8 ? hoy.getFullYear() : hoy.getFullYear() - 1);
  const C = `${curso}-${curso + 1}`, A = `${curso - 1}-${curso}`;
  const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const db = { pas_tab_cursos: [{ curso: C }, { curso: A }], pas_tab_tematicas: [], pas_tab_listas: [], pas_tab_tarjetas: [], pas_tab_adjuntos: [], pas_tab_historial: [] };
  const tem = (curso, nombre, icono, color, descripcion, orden) => { const t = { id: id(), curso, nombre, icono, color, descripcion, orden, archivada: false, creada: ahora() }; db.pas_tab_tematicas.push(t);
    const ls = [['Por hacer', '#ee712a', false], ['En marcha', '#009abb', false], ['Hecho', '#b4be00', true]].map(([n, c, te], i) => { const l = { id: id(), tematica_id: t.id, nombre: n, color: c, orden: i + 1, terminada: te }; db.pas_tab_listas.push(l); return l; });
    return ls; };
  const tar = (l, titulo, extra = {}) => { const c = { id: id(), lista_id: l.id, titulo, descripcion: '', responsable: null, vence: null, etiquetas: [], tareas: [], enlaces: [], orden: db.pas_tab_tarjetas.length, archivada: false, creada: ahora(), creada_por: yo, actualizada: ahora(), actualizada_por: yo, ...extra };
    db.pas_tab_tarjetas.push(c); db.pas_tab_historial.push({ id: id(), tarjeta_id: c.id, quien: yo, que: 'creó la tarjeta', cuando: ahora() }); return c; };
  const [ph, em, he] = tem(C, 'Adviento', '🎁', '#009abb', 'Campaña de Adviento y Navidad', 1);
  tar(ph, 'Cartel de la campaña para los pasillos', { responsable: 'ana.gil@salesianas.org', vence: dia(3), etiquetas: ['todo'], descripcion: 'Imprimir en A3 a color, 2 por planta.', tareas: [{ t: 'Revisar textos con Dirección', h: true }, { t: 'Pedir presupuesto a la imprenta', h: false }, { t: 'Colgar en las 4 plantas', h: false }], enlaces: [{ n: 'Carpeta de Comunicación', u: 'https://salesianas.org' }] });
  tar(ph, 'Buenos días de la 2.ª semana', { responsable: 'javier.romero@salesianas.org', vence: dia(9), etiquetas: ['primaria', 'eso'], tareas: [{ t: 'Primaria', h: true }, { t: 'ESO', h: false }] });
  tar(ph, 'Comprar cajas de regalo para el símbolo', { responsable: yo, vence: dia(-1), etiquetas: ['infantil', 'primaria'] });
  const cel = tar(em, 'Celebración de inicio de Adviento', { responsable: yo, vence: dia(7), etiquetas: ['todo', 'urgente'], descripcion: 'A primera hora en el patio. Si llueve, en el salón de actos.', tareas: [{ t: 'Guion de la celebración', h: true }, { t: 'Canciones y megafonía', h: true }, { t: 'Encargar la corona', h: false }, { t: 'Avisar al claustro por Teams', h: false }], enlaces: [{ n: 'Web de Buenos días', u: 'https://pastoral-bbdd.vercel.app/' }] });
  db.pas_tab_adjuntos.push({ id: id(), tarjeta_id: cel.id, nombre: 'Guion celebración.docx', ruta: cel.id + '/x.docx', tipo: '', tamano: 84000, subido: ahora(), subido_por: yo });
  tar(he, 'Angelito Burlón publicado', { etiquetas: ['infantil'], enlaces: [{ n: 'angelito-burlon.vercel.app', u: 'https://angelito-burlon.vercel.app/' }] });
  const [bph] = tem(C, 'Bocadillo solidario', '🥪', '#ee712a', 'Organización de cada bocadillo', 2);
  tar(bph, 'Compra del bocadillo de diciembre', { responsable: 'pedro.sanz@salesianas.org', enlaces: [{ n: 'Web del Bocadillo', u: 'https://pastoral-bocadillo.vercel.app/' }] });
  tem(C, 'Celebraciones salesianas', '🕯️', '#7c5cc4', 'Don Bosco, Mazzarello, María Auxiliadora…', 3);
  tem(C, 'Reuniones del equipo', '🗒️', '#5b6b7b', 'Órdenes del día y acuerdos', 4);
  const [aph] = tem(A, 'Adviento', '🎁', '#009abb', 'Curso pasado', 1);
  tar(aph, 'Campaña del curso pasado', { tareas: [{ t: 'Hecho', h: true }] });
  const tabla = t => db[t];
  // Mini «consulta» con los filtros que usa la página
  const consulta = (filas) => { const q = { f: filas, eq(k, v) { q.f = q.f.filter(x => x[k] === v); return q; }, in(k, vs) { q.f = q.f.filter(x => vs.includes(x[k])); return q; },
    order(k, o) { q.f = [...q.f].sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (o?.ascending === false ? -1 : 1)); return q; }, limit(n) { q.f = q.f.slice(0, n); return q; } }; return q; };
  const copia = x => JSON.parse(JSON.stringify(x));
  return {
    async sesion() { return { user: { email: yo } }; },
    async rpc(f, args) {
      if (f === 'pas_tab_quien_soy') { const cs = db.pas_tab_cursos.map(c => c.curso).sort(); return { email: yo, nombre: 'Lucía Martín (demostración)', equipo: true, curso_editable: cs[cs.length - 1], curso_hoy: C }; }
      if (f === 'pas_tab_equipo') return [{ email: 'ana.gil@salesianas.org', nombre: 'Ana Gil' }, { email: 'javier.romero@salesianas.org', nombre: 'Javier Romero' }, { email: yo, nombre: 'Lucía Martín' }, { email: 'pedro.sanz@salesianas.org', nombre: 'Pedro Sanz' }];
      if (f === 'pas_tab_archivos_huerfanos') return [];
      if (f === 'pas_tab_nuevo_curso') throw new Error('En la demostración no se puede empezar un curso nuevo.');
      return null;
    },
    async leer(t, filtro) { const q = consulta(tabla(t)); if (filtro) filtro(q); return copia(q.f); },
    async crear(t, fila) { const x = { id: id(), creada: ahora(), subido: ahora(), archivada: false, descripcion: '', etiquetas: [], tareas: [], enlaces: [], responsable: null, vence: null, ...fila };
      tabla(t).push(x); if (t === 'pas_tab_tarjetas') db.pas_tab_historial.push({ id: id(), tarjeta_id: x.id, quien: yo, que: 'creó la tarjeta', cuando: ahora() }); return copia(x); },
    async cambiar(t, i, cambios) { const x = tabla(t).find(r => r.id === i); Object.assign(x, cambios);
      if (t === 'pas_tab_tarjetas' && !('orden' in cambios && Object.keys(cambios).length <= 2 && !cambios.lista_id)) db.pas_tab_historial.push({ id: id(), tarjeta_id: i, quien: yo, que: cambios.lista_id ? 'la movió' : 'editó la tarjeta', cuando: ahora() });
      return copia(x); },
    async borrar(t, i) { db[t] = db[t].filter(r => r.id !== i); },
    async subir() {},
    async enlaceTemporal() { return 'data:text/plain;charset=utf-8,' + encodeURIComponent('Archivo de demostración'); },
    async quitarArchivos() {}
  };
}

iniciar();
