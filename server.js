import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'state.json');
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// État en mémoire, chargé depuis le disque au démarrage et sauvegardé
// (avec un léger débounce) à chaque modification.
// ---------------------------------------------------------------------------
let state = loadState();
let saveTimer = null;

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const entries of Object.values(interfaces)) {
    for (const info of entries || []) {
      if (info.family === 'IPv4' && !info.internal) {
        ips.push(info.address);
      }
    }
  }

  return ips;
}


function loadState() {
  try {
    const raw = fsSync.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.tasks)) return parsed;
  } catch {
    // Pas de fichier existant ou fichier invalide : on part sur le jeu de démo.
  }
  return { tasks: seedTasks() };
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Échec de la sauvegarde de l\'état :', err);
    }
  }, 250);
}

function seedTasks() {
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, n) => {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  };
  const today = new Date();
  const t1 = {
    id: randomUUID(), name: 'Cadrage du projet', start: iso(addDays(today, -2)),
    end: iso(addDays(today, 1)), progress: 100, assignee: 'Alex',
    color: '#1B4C8C', notes: '', dependsOn: [], order: 0,
  };
  const t2 = {
    id: randomUUID(), name: 'Maquettes', start: iso(addDays(today, 1)),
    end: iso(addDays(today, 6)), progress: 55, assignee: 'Sami',
    color: '#6B4E9E', notes: '', dependsOn: [t1.id], order: 1,
  };
  const t3 = {
    id: randomUUID(), name: 'Développement', start: iso(addDays(today, 6)),
    end: iso(addDays(today, 18)), progress: 10, assignee: 'Léa',
    color: '#0E7C86', notes: '', dependsOn: [t2.id], order: 2,
  };
  const t4 = {
    id: randomUUID(), name: 'Recette & livraison', start: iso(addDays(today, 18)),
    end: iso(addDays(today, 23)), progress: 0, assignee: 'Alex',
    color: '#C1553D', notes: '', dependsOn: [t3.id], order: 3,
  };
  return [t1, t2, t3, t4];
}

function sanitizeTask(input = {}, partial = false) {
  const t = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (!partial || has('id')) t.id = input.id;
  if (!partial || has('name')) t.name = String(input.name ?? 'Nouvelle tâche').slice(0, 120) || 'Nouvelle tâche';
  if (!partial || has('start')) t.start = isValidDate(input.start) ? input.start : todayISO();
  if (!partial || has('end')) t.end = isValidDate(input.end) ? input.end : t.start || todayISO();
  if (!partial || has('progress')) t.progress = clamp(Number(input.progress) || 0, 0, 100);
  if (!partial || has('assignee')) t.assignee = String(input.assignee ?? '').slice(0, 40);
  if (!partial || has('color')) t.color = /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? input.color : '#1B4C8C';
  if (!partial || has('notes')) t.notes = String(input.notes ?? '').slice(0, 800);
  if (!partial || has('dependsOn')) {
    t.dependsOn = Array.isArray(input.dependsOn) ? input.dependsOn.filter((x) => typeof x === 'string').slice(0, 15) : [];
  }
  if (!partial || has('order')) t.order = Number.isFinite(input.order) ? input.order : 0;
  // Garde-fou : la fin ne peut pas précéder le début.
  if (t.start && t.end && t.end < t.start) t.end = t.start;
  return t;
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------------
// Serveur HTTP + fichiers statiques
// ---------------------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true, tasks: state.tasks.length }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------------------------------------------------------------------------
// Présence des collaborateurs connectés
// ---------------------------------------------------------------------------
const clients = new Map(); // ws -> { id, name, color }
const PALETTE = ['#1B4C8C', '#C1553D', '#4F7942', '#E2A33D', '#6B4E9E', '#0E7C86', '#B8455F', '#3B7A57'];
let colorCursor = 0;

function nextColor() {
  return PALETTE[colorCursor++ % PALETTE.length];
}

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function presenceList() {
  return [...clients.values()].map(({ id, name, color }) => ({ id, name, color }));
}

wss.on('connection', (ws) => {
  const me = { id: randomUUID(), name: 'Invité', color: nextColor() };
  clients.set(ws, me);

  ws.send(JSON.stringify({
    type: 'welcome',
    you: me,
    tasks: state.tasks,
    users: presenceList(),
  }));
  broadcast({ type: 'presence', users: presenceList() });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'identify': {
        me.name = String(msg.name || 'Invité').slice(0, 24) || 'Invité';
        broadcast({ type: 'presence', users: presenceList() });
        break;
      }

      case 'task:create': {
        const task = sanitizeTask(msg.task);
        task.id = randomUUID();
        task.order = state.tasks.length;
        state.tasks.push(task);
        persist();
        broadcast({ type: 'task:created', task, tempId: msg.tempId, by: me });
        break;
      }

      case 'task:update': {
        const idx = state.tasks.findIndex((t) => t.id === msg.task?.id);
        if (idx === -1) return;
        state.tasks[idx] = { ...state.tasks[idx], ...sanitizeTask(msg.task, true) };
        persist();
        broadcast({ type: 'task:updated', task: state.tasks[idx], by: me });
        break;
      }

      case 'task:delete': {
        const existed = state.tasks.some((t) => t.id === msg.id);
        if (!existed) return;
        state.tasks = state.tasks.filter((t) => t.id !== msg.id);
        state.tasks.forEach((t) => {
          t.dependsOn = (t.dependsOn || []).filter((d) => d !== msg.id);
        });
        persist();
        broadcast({ type: 'task:deleted', id: msg.id, by: me });
        break;
      }

      case 'task:dragging': {
        // Ephémère, non persisté : sert juste à montrer aux autres qui manipule quoi.
        broadcast({ type: 'task:dragging', id: msg.id, patch: msg.patch, by: me });
        break;
      }

      case 'task:dragend': {
        broadcast({ type: 'task:dragend', id: msg.id, by: me });
        break;
      }

      case 'tasks:reorder': {
        const order = Array.isArray(msg.order) ? msg.order : [];
        order.forEach((id, i) => {
          const t = state.tasks.find((x) => x.id === id);
          if (t) t.order = i;
        });
        persist();
        broadcast({ type: 'tasks:reordered', order, by: me });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ type: 'presence', users: presenceList() });
  });
});

const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`Chantier — Gantt collaboratif`);
  console.log(`Local : http://localhost:${PORT}`);

  for (const ip of getLocalIPs()) {
    console.log(`Réseau : http://${ip}:${PORT}`);
  }

  console.log('');
});