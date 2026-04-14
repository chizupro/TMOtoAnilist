/**
 * TMO → AniList Importer
 * Importa listas del backup de TMO a AniList usando la API de GraphQL.
 *
 * Flujo:
 *  1. Auth OAuth implicit con redirect automático (sin copiar tokens)
 *  2. Parseo de HTMLs del backup de TMO
 *  3. Búsqueda de cada manga en AniList (título original + título ES)
 *  4. Guardado en la lista del usuario con el estado correcto
 */

'use strict';

// ─── TU CLIENT ID DE ANILIST ───────────────────────────────────────────────
const ANILIST_CLIENT_ID = '39191';

// ─── CONSTANTES ────────────────────────────────────────────────────────────

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const REDIRECT_URI     = 'https://chizupro.github.io/TMOtoAnilist/';

const AL_STATUS_LABEL = {
  CURRENT:   'Leyendo',
  PLANNING:  'Plan a leer',
  COMPLETED: 'Completado',
  DROPPED:   'Abandonado',
  PAUSED:    'Pausado',
  REPEATING: 'Releyendo',
};

const KEYWORD_MAP = [
  [['siguiendo', 'following', 'leyendo', 'reading', 'current', 'en curso', 'en lectura'], 'CURRENT'],
  [['complet', 'terminado', 'finished', 'leido', 'leído'],                                 'COMPLETED'],
  [['abandon', 'drop', 'dejado'],                                                           'DROPPED'],
  [['paus', 'hold', 'en espera'],                                                           'PAUSED'],
  [['releyendo', 'reread', 'repeat'],                                                       'REPEATING'],
  [['plan', 'quiero', 'pendiente', 'want', 'lista de espera', 'wishlist', 'planning'],      'PLANNING'],
];

const REQUEST_DELAY_MS = 750;

// ─── ESTADO GLOBAL ──────────────────────────────────────────────────────────

const S = {
  token:      '',
  username:   '',
  userId:     null,
  allEntries: [],
  results:    [],
  ok: 0, skip: 0, err: 0,
};

let customStatusMap = {};
let loadedFiles = [];

// ─── UTILIDADES ────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm  = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function detectStatus(name) {
  const n = name.toLowerCase();
  for (const [keys, status] of KEYWORD_MAP) {
    if (keys.some(k => n.includes(k))) return status;
  }
  return 'PLANNING';
}

// ─── UI HELPERS ─────────────────────────────────────────────────────────────

function goStep(n) {
  document.querySelectorAll('.panel').forEach((p, i) => {
    p.classList.toggle('active', i === n);
  });
  document.querySelectorAll('.step-item').forEach((d, i) => {
    d.classList.remove('active', 'done');
    if (i < n)        d.classList.add('done');
    else if (i === n) d.classList.add('active');
  });
}

function addLog(msg, cls) {
  const el  = document.getElementById('importLog');
  const div = document.createElement('div');
  div.className   = cls || '';
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function setBadge(status) {
  return `<span class="badge badge-${status}">${AL_STATUS_LABEL[status] || status}</span>`;
}

// ─── PASO 1: AUTENTICACIÓN ─────────────────────────────────────────────────

function startAuth() {
  const authUrl =
    `https://anilist.co/api/v2/oauth/authorize` +
    `?client_id=${ANILIST_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=token`;

  window.location.href = authUrl;
}

/**
 * Se ejecuta al cargar la página.
 * Si la URL tiene #access_token=..., AniList ya autorizó → login automático.
 */
async function checkAuthCallback() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;

  const params = new URLSearchParams(hash);
  const token  = params.get('access_token');
  if (!token) return;

  // Limpiar el token de la URL por seguridad
  history.replaceState(null, '', window.location.pathname);

  S.token = token;

  const authStatus = document.getElementById('authStatus');
  authStatus.classList.remove('hidden');
  authStatus.textContent = 'Conectando con AniList...';
  authStatus.className   = 'auth-msg';

  try {
    const res = await alGql('{ Viewer { id name } }', {}, true);
    if (res?.data?.Viewer) {
      S.username = res.data.Viewer.name;
      S.userId   = res.data.Viewer.id;
      authStatus.textContent = `✓ Conectado como ${S.username}`;
      authStatus.className   = 'auth-msg ok';
      document.getElementById('btnViewList').onclick =
        () => window.open(`https://anilist.co/user/${S.username}/mangalist`, '_blank');
      setTimeout(() => goStep(1), 900);
    } else {
      authStatus.textContent = 'No se pudo verificar la cuenta. Intenta de nuevo.';
      authStatus.className   = 'auth-msg err';
    }
  } catch (e) {
    authStatus.textContent = `Error de red: ${e.message}`;
    authStatus.className   = 'auth-msg err';
  }
}

// ─── PASO 2: CARGA DE ARCHIVOS ─────────────────────────────────────────────

function initDropZone() {
  const zone  = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');

  input.addEventListener('change', () => handleFiles(input.files));

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
}

function handleFiles(files) {
  loadedFiles = Array.from(files);
  if (!loadedFiles.length) return;

  loadedFiles.forEach(f => {
    const nameNoExt = f.name.replace(/\.[^.]+$/, '');
    if (!customStatusMap[f.name]) {
      customStatusMap[f.name] = detectStatus(nameNoExt);
    }
  });

  renderFileList();
  buildStatusMapUI();
  document.getElementById('btnParse').disabled = false;
}

function renderFileList() {
  const el = document.getElementById('fileList');
  el.classList.remove('hidden');
  el.innerHTML = loadedFiles.map(f => {
    const status = customStatusMap[f.name] || 'PLANNING';
    return `<div class="file-row">
      <span class="file-name">${f.name}</span>
      ${setBadge(status)}
    </div>`;
  }).join('');
}

function buildStatusMapUI() {
  const el = document.getElementById('statusMapUI');
  if (!loadedFiles.length) {
    el.innerHTML = '<p class="empty-hint">Carga archivos primero.</p>';
    return;
  }

  el.innerHTML = loadedFiles.map(f => {
    const cur  = customStatusMap[f.name] || 'PLANNING';
    const opts = Object.entries(AL_STATUS_LABEL)
      .map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`)
      .join('');
    return `<div class="status-map-row">
      <span>${f.name}</span>
      <select onchange="customStatusMap['${f.name}']=this.value; renderFileList()">
        ${opts}
      </select>
    </div>`;
  }).join('');
}

// ─── PARSEO DEL HTML DE TMO ────────────────────────────────────────────────

function parseHTML(html, defaultStatus) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');

  const topnav = doc.querySelector('.topnav')?.textContent?.trim()
              || doc.querySelector('title')?.textContent?.trim()
              || '';
  const status = defaultStatus || detectStatus(topnav);

  const entries = [];

  doc.querySelectorAll('tbody tr').forEach(row => {
    const img = row.querySelector('img');
    const a   = row.querySelector('a');
    if (!a) return;

    const titleAlt = img?.getAttribute('alt')?.trim() || '';
    const titleEs  = a.textContent?.trim()             || '';
    const url      = a.getAttribute('href')            || '';

    const primary   = titleAlt || titleEs;
    const secondary = (titleAlt && titleEs && norm(titleAlt) !== norm(titleEs)) ? titleEs : '';

    if (!primary) return;

    entries.push({ primary, secondary, status, url, listName: topnav || 'Lista' });
  });

  return entries;
}

async function parseAllFiles() {
  S.allEntries = [];

  for (const f of loadedFiles) {
    const html    = await f.text();
    const status  = customStatusMap[f.name] || detectStatus(f.name.replace(/\.[^.]+$/, ''));
    const entries = parseHTML(html, status);
    S.allEntries.push(...entries);
  }

  if (!S.allEntries.length) {
    alert('No se encontraron mangas en los archivos. Verifica que son HTMLs del backup de TMO.');
    return;
  }

  buildPreview();
  goStep(2);
}

function buildPreview() {
  const counts = {};
  S.allEntries.forEach(e => { counts[e.status] = (counts[e.status] || 0) + 1; });

  document.getElementById('prevStats').innerHTML = Object.entries(counts).map(([s, c]) =>
    `<div class="stat-card">
       <div class="stat-num">${c}</div>
       <div class="stat-lbl">${AL_STATUS_LABEL[s] || s}</div>
     </div>`
  ).join('');

  const shown = S.allEntries.slice(0, 200);
  const rest  = S.allEntries.length - shown.length;

  document.getElementById('prevList').innerHTML =
    shown.map(e =>
      `<div class="manga-row">
         <span class="manga-title" title="${e.primary}">${e.primary}</span>
         ${e.secondary ? `<span class="manga-alt" title="${e.secondary}">${e.secondary}</span>` : ''}
         ${setBadge(e.status)}
       </div>`
    ).join('') +
    (rest > 0 ? `<div class="more-hint">...y ${rest} más</div>` : '');
}

// ─── PASO 4: IMPORTACIÓN ───────────────────────────────────────────────────

async function runImport() {
  S.results = []; S.ok = 0; S.skip = 0; S.err = 0;
  const total = S.allEntries.length;
  document.getElementById('stTotal').textContent = total;

  for (let i = 0; i < total; i++) {
    const entry = S.allEntries[i];

    const pct = Math.round((i / total) * 100);
    document.getElementById('progFill').style.width  = pct + '%';
    document.getElementById('progLabel').textContent = `${i + 1} / ${total}`;

    addLog(`🔍 ${entry.primary}`, 'info');

    let mediaId = null;
    let result  = 'error';

    try {
      mediaId = await searchManga(entry.primary);

      if (!mediaId && entry.secondary) {
        addLog(`   → probando con: ${entry.secondary}`, 'info');
        mediaId = await searchManga(entry.secondary);
      }

      if (!mediaId) {
        addLog(`   ✗ No encontrado`, 'warn');
        result = 'not_found';
        S.skip++;
      } else {
        await saveMangaEntry(mediaId, entry.status);
        addLog(`   ✓ Guardado → ${AL_STATUS_LABEL[entry.status]}`, 'ok');
        result = 'ok';
        S.ok++;
      }
    } catch (e) {
      addLog(`   ✗ Error: ${e.message}`, 'err');
      result = 'error';
      S.err++;
    }

    S.results.push({ ...entry, result, mediaId });
    document.getElementById('stOk').textContent   = S.ok;
    document.getElementById('stSkip').textContent = S.skip;
    document.getElementById('stErr').textContent  = S.err;

    await sleep(REQUEST_DELAY_MS);
  }

  document.getElementById('progFill').style.width  = '100%';
  document.getElementById('progLabel').textContent = `${total} / ${total} — Completado`;
  document.getElementById('doneSection').classList.remove('hidden');
}

// ─── API DE ANILIST ────────────────────────────────────────────────────────

async function searchManga(title) {
  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 10) {
        media(search: $search, type: MANGA) {
          id
          title { romaji english native userPreferred }
          synonyms
        }
      }
    }
  `;

  const data    = await alGql(query, { search: title }, false);
  const results = data?.data?.Page?.media || [];
  if (!results.length) return null;

  const target = norm(title);

  for (const m of results) {
    const candidates = [
      m.title.romaji,
      m.title.english,
      m.title.native,
      m.title.userPreferred,
      ...(m.synonyms || []),
    ].filter(Boolean).map(norm);

    if (candidates.some(c => c === target)) return m.id;
    if (candidates.some(c => c.length > 4 && (c.includes(target) || target.includes(c)))) return m.id;
  }

  if (title.length > 20) return results[0]?.id || null;

  return null;
}

async function saveMangaEntry(mediaId, status) {
  const mutation = `
    mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status) {
        id
        status
      }
    }
  `;
  return alGql(mutation, { mediaId, status }, true);
}

async function alGql(query, variables, withAuth) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };
  if (withAuth) headers['Authorization'] = `Bearer ${S.token}`;

  const res = await fetch(ANILIST_ENDPOINT, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ query, variables }),
  });

  if (res.status === 429) {
    addLog('   ⏳ Rate limit de AniList — esperando 65 segundos...', 'warn');
    await sleep(65_000);
    return alGql(query, variables, withAuth);
  }

  return res.json();
}

// ─── REPORTE CSV ───────────────────────────────────────────────────────────

function dlReport() {
  const RESULT_LABEL = {
    ok:        '✓ Guardado',
    not_found: '✗ No encontrado',
    error:     '✗ Error',
  };

  const header = 'Título original,Título ES,Lista TMO,Estado AniList,Resultado,ID AniList';
  const rows   = S.results.map(r =>
    [
      `"${r.primary}"`,
      `"${r.secondary || ''}"`,
      `"${r.listName || ''}"`,
      `"${AL_STATUS_LABEL[r.status] || r.status}"`,
      `"${RESULT_LABEL[r.result] || r.result}"`,
      `"${r.mediaId || ''}"`,
    ].join(',')
  );

  const blob = new Blob(['\uFEFF' + [header, ...rows].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });

  const a  = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = 'tmo_anilist_reporte.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── INIT ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initDropZone();
  checkAuthCallback(); // Captura el token si AniList redirigió aquí
});
