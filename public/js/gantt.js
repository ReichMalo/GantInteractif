// ---------------------------------------------------------------------------
// Utilitaires de dates (toujours en heure locale, sans fuseau ni horaire).
// ---------------------------------------------------------------------------
const MONTHS_FULL = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']; // lundi -> dimanche

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function diffDays(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}
function startOfWeek(d) {
  const c = new Date(d);
  const dow = (c.getDay() + 6) % 7; // 0 = lundi
  c.setDate(c.getDate() - dow);
  return c;
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const ZOOMS = {
  day: { dayWidth: 44, pad: 6, minSpanDays: 24 },
  week: { dayWidth: 13, pad: 14, minSpanDays: 70 },
  month: { dayWidth: 4.2, pad: 30, minSpanDays: 200 },
};

const ROW_H = 42;
const DRAG_THRESHOLD = 4;

class Gantt {
  constructor({ rulerEl, bodyEl, depLayerEl, scrollEl }) {
    this.rulerEl = rulerEl;
    this.bodyEl = bodyEl;
    this.depLayerEl = depLayerEl;
    this.scrollEl = scrollEl;
    this.tasks = [];
    this.zoom = 'day';
    this.range = { start: new Date(), end: addDays(new Date(), 30) };
    this.drag = null;

    this.onTaskChange = () => {};
    this.onDragging = () => {};
    this.onDragEnd = () => {};
    this.onBarClick = () => {};

    window.addEventListener('resize', () => this.renderStructure());
  }

  setZoom(zoom) {
    this.zoom = zoom;
    this._recomputeRange();
    this.renderStructure();
  }

  setTasks(tasks) {
    this.tasks = [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this._recomputeRange();
    this.renderStructure();
  }

  _recomputeRange() {
    const cfg = ZOOMS[this.zoom];
    let minStart, maxEnd;
    if (this.tasks.length) {
      minStart = this.tasks.reduce((m, t) => (parseISO(t.start) < m ? parseISO(t.start) : m), parseISO(this.tasks[0].start));
      maxEnd = this.tasks.reduce((m, t) => (parseISO(t.end) > m ? parseISO(t.end) : m), parseISO(this.tasks[0].end));
    } else {
      minStart = new Date();
      maxEnd = addDays(new Date(), 14);
    }
    let start = addDays(minStart, -cfg.pad);
    let end = addDays(maxEnd, cfg.pad);
    if (diffDays(end, start) < cfg.minSpanDays) {
      end = addDays(start, cfg.minSpanDays);
    }
    this.range = { start, end };
  }

  dateToX(date) {
    return diffDays(date, this.range.start) * ZOOMS[this.zoom].dayWidth;
  }

  totalWidth() {
    return diffDays(this.range.end, this.range.start) * ZOOMS[this.zoom].dayWidth;
  }

  // -------------------------------------------------------------------
  // Construction des unités de la règle (jour / semaine / mois)
  // -------------------------------------------------------------------
  _buildUnits() {
    const { start, end } = this.range;
    const units = [];
    if (this.zoom === 'day') {
      let cur = new Date(start);
      while (cur < end) {
        units.push({ start: new Date(cur), label: String(cur.getDate()), sub: WEEKDAY_LETTERS[(cur.getDay() + 6) % 7], weekend: cur.getDay() === 0 || cur.getDay() === 6 });
        cur = addDays(cur, 1);
      }
    } else if (this.zoom === 'week') {
      let cur = startOfWeek(start);
      while (cur < end) {
        units.push({ start: new Date(cur), label: `${cur.getDate()} ${MONTHS_SHORT[cur.getMonth()]}`, sub: '', weekend: false });
        cur = addDays(cur, 7);
      }
    } else {
      let cur = startOfMonth(start);
      while (cur < end) {
        units.push({ start: new Date(cur), label: MONTHS_SHORT[cur.getMonth()], sub: String(cur.getFullYear()), weekend: false });
        cur = addMonths(cur, 1);
      }
    }
    // largeur de chaque unité = distance jusqu'à l'unité suivante (ou la fin de plage)
    for (let i = 0; i < units.length; i++) {
      const next = units[i + 1] ? units[i + 1].start : end;
      units[i].x = this.dateToX(units[i].start);
      units[i].width = this.dateToX(next) - units[i].x;
    }
    return units;
  }

  _buildGroups(units) {
    const groups = [];
    for (const u of units) {
      const key = this.zoom === 'month' ? String(u.start.getFullYear()) : `${u.start.getFullYear()}-${u.start.getMonth()}`;
      const label = this.zoom === 'month' ? String(u.start.getFullYear()) : `${MONTHS_FULL[u.start.getMonth()]} ${u.start.getFullYear()}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.width += u.width;
      } else {
        groups.push({ key, label, x: u.x, width: u.width });
      }
    }
    return groups;
  }

  // -------------------------------------------------------------------
  // Rendu complet (règle + grille + barres + dépendances)
  // -------------------------------------------------------------------
  renderStructure() {
    const units = this._buildUnits();
    const groups = this._buildGroups(units);
    const totalW = this.totalWidth();
    const totalH = Math.max(this.tasks.length * ROW_H, 120);

    // --- Règle ---
    this.rulerEl.innerHTML = '';
    this.rulerEl.style.width = `${totalW}px`;

    const groupRow = document.createElement('div');
    groupRow.className = 'ruler__row ruler__row--groups';
    for (const g of groups) {
      const cell = document.createElement('div');
      cell.className = 'ruler__cell';
      cell.style.left = `${g.x}px`;
      cell.style.width = `${g.width}px`;
      cell.textContent = g.label;
      groupRow.appendChild(cell);
    }
    this.rulerEl.appendChild(groupRow);

    const unitRow = document.createElement('div');
    unitRow.className = 'ruler__row ruler__row--units';
    for (const u of units) {
      const cell = document.createElement('div');
      cell.className = 'ruler__cell' + (u.weekend ? ' is-weekend' : '');
      cell.style.left = `${u.x}px`;
      cell.style.width = `${u.width}px`;
      cell.innerHTML = u.sub ? `${u.label}<small>${u.sub}</small>` : u.label;
      unitRow.appendChild(cell);
    }
    this.rulerEl.appendChild(unitRow);

    // --- Corps (grille + barres) ---
    this.bodyEl.style.width = `${totalW}px`;
    this.bodyEl.style.height = `${totalH}px`;
    // On repart de zéro sauf le calque SVG des dépendances, qu'on conserve.
    [...this.bodyEl.children].forEach((child) => {
      if (child !== this.depLayerEl) child.remove();
    });

    // Fonds de ligne alternés
    this.tasks.forEach((_, i) => {
      const row = document.createElement('div');
      row.className = 'grid-row-bg';
      row.style.top = `${i * ROW_H}px`;
      this.bodyEl.appendChild(row);
    });

    // Lignes verticales de la grille, aux mêmes bornes que les unités de la règle
    units.forEach((u, i) => {
      const line = document.createElement('div');
      const isGroupStart = groups.some((g) => g.x === u.x);
      line.className = 'grid-line' + (isGroupStart ? ' is-strong' : '');
      line.style.left = `${u.x}px`;
      this.bodyEl.appendChild(line);
    });
    const closingLine = document.createElement('div');
    closingLine.className = 'grid-line';
    closingLine.style.left = `${totalW}px`;
    this.bodyEl.appendChild(closingLine);

    // Ligne "aujourd'hui"
    const today = new Date();
    if (today >= this.range.start && today <= this.range.end) {
      const line = document.createElement('div');
      line.className = 'today-line';
      line.style.left = `${this.dateToX(today)}px`;
      this.bodyEl.appendChild(line);
    }

    this.depLayerEl.setAttribute('width', totalW);
    this.depLayerEl.setAttribute('height', totalH);
    this._ensureArrowMarker();

    this.renderBars();
    this.renderDependencies();
  }

  _ensureArrowMarker() {
    if (this.depLayerEl.querySelector('defs')) return;
    const NS = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(NS, 'defs');
    const marker = document.createElementNS(NS, 'marker');
    marker.setAttribute('id', 'dep-arrow');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M0,0 L6,3 L0,6 Z');
    path.setAttribute('fill', '#88919B');
    marker.appendChild(path);
    defs.appendChild(marker);
    this.depLayerEl.appendChild(defs);
  }

  // -------------------------------------------------------------------
  // Barres
  // -------------------------------------------------------------------
  renderBars() {
    this.bodyEl.querySelectorAll('.bar').forEach((el) => el.remove());
    this.tasks.forEach((task, i) => {
      const bar = this._buildBar(task, i);
      this.bodyEl.appendChild(bar);
    });
  }

  _buildBar(task, index) {
    const start = parseISO(task.start);
    const end = parseISO(task.end);
    const durationDays = Math.max(1, diffDays(end, start) + 1);
    const x = this.dateToX(start);
    const width = Math.max(durationDays * ZOOMS[this.zoom].dayWidth, 6);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.dataset.taskId = task.id;
    bar.style.left = `${x}px`;
    bar.style.top = `${index * ROW_H + 8}px`;
    bar.style.width = `${width}px`;
    bar.style.setProperty('--bar-color', task.color || '#1B4C8C');

    const fill = document.createElement('div');
    fill.className = 'bar__fill';
    fill.style.width = `${Math.max(0, Math.min(100, task.progress || 0))}%`;
    fill.style.opacity = '0.5';
    bar.appendChild(fill);

    const label = document.createElement('span');
    label.className = 'bar__label';
    label.textContent = task.name;
    bar.appendChild(label);

    const startHandle = document.createElement('div');
    startHandle.className = 'bar__handle bar__handle--start';
    bar.appendChild(startHandle);
    const endHandle = document.createElement('div');
    endHandle.className = 'bar__handle bar__handle--end';
    bar.appendChild(endHandle);

    startHandle.addEventListener('pointerdown', (e) => this._startDrag(e, task, 'resize-start'));
    endHandle.addEventListener('pointerdown', (e) => this._startDrag(e, task, 'resize-end'));
    bar.addEventListener('pointerdown', (e) => {
      if (e.target === startHandle || e.target === endHandle) return;
      this._startDrag(e, task, 'move');
    });

    return bar;
  }

  markRemoteActive(taskId, color, name) {
    const bar = this.bodyEl.querySelector(`.bar[data-task-id="${taskId}"]`);
    if (!bar) return;
    bar.classList.add('is-remote-active');
    bar.style.setProperty('--bar-remote-color', color);
    if (!bar.querySelector('.remote-tag')) {
      const tag = document.createElement('span');
      tag.className = 'remote-tag';
      tag.textContent = name;
      tag.style.background = color;
      bar.appendChild(tag);
    }
  }
  clearRemoteActive(taskId) {
    const bar = this.bodyEl.querySelector(`.bar[data-task-id="${taskId}"]`);
    if (!bar) return;
    bar.classList.remove('is-remote-active');
    bar.querySelector('.remote-tag')?.remove();
  }

  // -------------------------------------------------------------------
  // Dépendances (connecteurs SVG)
  // -------------------------------------------------------------------
  renderDependencies() {
    const NS = 'http://www.w3.org/2000/svg';
    this.depLayerEl.querySelectorAll('path.dep-path').forEach((p) => p.remove());
    const byId = new Map(this.tasks.map((t, i) => [t.id, { task: t, index: i }]));

    this.tasks.forEach((task, index) => {
      (task.dependsOn || []).forEach((depId) => {
        const pred = byId.get(depId);
        if (!pred) return;
        const predStart = parseISO(pred.task.start);
        const predEnd = parseISO(pred.task.end);
        const predDuration = Math.max(1, diffDays(predEnd, predStart) + 1);
        const x1 = this.dateToX(predStart) + predDuration * ZOOMS[this.zoom].dayWidth;
        const y1 = pred.index * ROW_H + 8 + 13;
        const x2 = this.dateToX(parseISO(task.start));
        const y2 = index * ROW_H + 8 + 13;
        const midX = x1 + Math.max(10, (x2 - x1) / 2);

        const d = x2 >= x1 + 8
          ? `M ${x1} ${y1} H ${midX} V ${y2} H ${x2 - 6}`
          : `M ${x1} ${y1} H ${x1 + 10} V ${(y1 + y2) / 2} H ${x2 - 16} V ${y2} H ${x2 - 6}`;

        const path = document.createElementNS(NS, 'path');
        path.setAttribute('class', 'dep-path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#B9C1C9');
        path.setAttribute('stroke-width', '1.6');
        path.setAttribute('marker-end', 'url(#dep-arrow)');
        this.depLayerEl.appendChild(path);
      });
    });
  }

  // -------------------------------------------------------------------
  // Glisser-déposer des barres
  // -------------------------------------------------------------------
  _startDrag(e, task, mode) {
    e.preventDefault();
    e.stopPropagation();
    this.drag = {
      taskId: task.id,
      mode,
      startX: e.clientX,
      origStart: parseISO(task.start),
      origEnd: parseISO(task.end),
      moved: 0,
      lastSent: 0,
    };
    document.body.style.userSelect = 'none';
    const onMove = (ev) => this._onDragMove(ev);
    const onUp = (ev) => {
      this._onDragEnd(ev);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _onDragMove(e) {
    if (!this.drag) return;
    const d = this.drag;
    const dayWidth = ZOOMS[this.zoom].dayWidth;
    const deltaX = e.clientX - d.startX;
    d.moved = Math.max(d.moved, Math.abs(deltaX));
    const deltaDays = Math.round(deltaX / dayWidth);

    const task = this.tasks.find((t) => t.id === d.taskId);
    if (!task) return;

    let newStart = d.origStart, newEnd = d.origEnd;
    if (d.mode === 'move') {
      newStart = addDays(d.origStart, deltaDays);
      newEnd = addDays(d.origEnd, deltaDays);
    } else if (d.mode === 'resize-start') {
      newStart = addDays(d.origStart, deltaDays);
      if (newStart > d.origEnd) newStart = new Date(d.origEnd);
    } else if (d.mode === 'resize-end') {
      newEnd = addDays(d.origEnd, deltaDays);
      if (newEnd < d.origStart) newEnd = new Date(d.origStart);
    }

    task.start = toISO(newStart);
    task.end = toISO(newEnd);

    this.renderBars();
    this.renderDependencies();

    const now = performance.now();
    if (now - d.lastSent > 70) {
      d.lastSent = now;
      this.onDragging(task.id, { start: task.start, end: task.end });
    }
  }

  _onDragEnd() {
    if (!this.drag) return;
    const d = this.drag;
    document.body.style.userSelect = '';
    const task = this.tasks.find((t) => t.id === d.taskId);
    this.drag = null;
    if (!task) return;

    if (d.moved < DRAG_THRESHOLD) {
      this.onBarClick(task.id);
      return;
    }
    this.onTaskChange(task.id, { start: task.start, end: task.end });
    this.onDragEnd(task.id);
  }
}

window.Gantt = Gantt;
window.ganttDateUtils = { parseISO, toISO, addDays, diffDays };
