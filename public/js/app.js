(() => {
  const PALETTE = ['#1B4C8C', '#C1553D', '#4F7942', '#E2A33D', '#6B4E9E', '#0E7C86', '#B8455F', '#3B7A57'];
  const { toISO } = window.ganttDateUtils;

  // -- Références DOM ------------------------------------------------------
  const nameGate = document.getElementById('name-gate');
  const nameForm = document.getElementById('name-form');
  const nameInput = document.getElementById('name-input');
  const appEl = document.getElementById('app');
  const presenceEl = document.getElementById('presence');
  const connDot = document.getElementById('conn-dot');
  const taskListEl = document.getElementById('task-list');
  const taskCountEl = document.getElementById('task-count');
  const btnNewTask = document.getElementById('btn-new-task');
  const toastEl = document.getElementById('toast');
  const zoomBtns = [...document.querySelectorAll('.zoom-btn')];

  const modalBackdrop = document.getElementById('modal-backdrop');
  const taskForm = document.getElementById('task-form');
  const modalTitle = document.getElementById('modal-title');
  const fName = document.getElementById('f-name');
  const fStart = document.getElementById('f-start');
  const fEnd = document.getElementById('f-end');
  const fProgress = document.getElementById('f-progress');
  const fProgressOut = document.getElementById('f-progress-out');
  const fAssignee = document.getElementById('f-assignee');
  const fNotes = document.getElementById('f-notes');
  const fColors = document.getElementById('f-colors');
  const fDeps = document.getElementById('f-deps');
  const btnDelete = document.getElementById('btn-delete-task');
  const btnCancel = document.getElementById('btn-cancel');
  const btnModalClose = document.getElementById('modal-close');

  // -- État local -----------------------------------------------------------
  let tasks = [];
  let users = [];
  let myId = null;
  let editingId = null;
  let selectedColor = PALETTE[0];
  let pendingName = localStorage.getItem('chantier:name') || '';

  const gantt = new Gantt({
    rulerEl: document.getElementById('ruler'),
    bodyEl: document.getElementById('chart-body'),
    depLayerEl: document.getElementById('dep-layer'),
    scrollEl: document.getElementById('timeline-scroll'),
  });
  gantt.onTaskChange = (id, patch) => {
    window.realtime.send('task:update', { task: { id, ...patch } });
  };
  gantt.onDragging = (id, patch) => {
    window.realtime.send('task:dragging', { id, patch });
  };
  gantt.onDragEnd = (id) => {
    window.realtime.send('task:dragend', { id });
  };
  gantt.onBarClick = (id) => openTaskModal(id);

  // -- Écran d'accueil : nom du collaborateur --------------------------------
  if (pendingName) {
    enterApp();
  } else {
    nameGate.hidden = false;
  }

  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    pendingName = name;
    localStorage.setItem('chantier:name', name);
    enterApp();
  });

  function enterApp() {
    nameGate.hidden = true;
    appEl.hidden = false;
    window.realtime.connect();
  }

  // -- Connexion temps réel ---------------------------------------------------
  window.realtime.on('status', (state) => {
    connDot.dataset.state = state;
    connDot.title = state === 'online' ? 'Connecté' : state === 'connecting' ? 'Connexion en cours…' : 'Hors ligne — nouvelle tentative…';
  });

  window.realtime.on('message', (msg) => {
    switch (msg.type) {
      case 'welcome': {
        myId = msg.you.id;
        tasks = msg.tasks;
        users = msg.users;
        window.realtime.send('identify', { name: pendingName });
        renderPresence();
        renderSidebar();
        gantt.setTasks(tasks);
        break;
      }
      case 'presence': {
        users = msg.users;
        renderPresence();
        break;
      }
      case 'task:created': {
        const placeholderIdx = msg.tempId ? tasks.findIndex((t) => t.id === msg.tempId) : -1;
        if (placeholderIdx !== -1) {
          tasks[placeholderIdx] = msg.task;
        } else if (!tasks.some((t) => t.id === msg.task.id)) {
          tasks.push(msg.task);
        }
        renderSidebar();
        gantt.setTasks(tasks);
        break;
      }
      case 'task:updated': {
        if (gantt.drag && gantt.drag.taskId === msg.task.id) break; // je suis en train de la manipuler
        const idx = tasks.findIndex((t) => t.id === msg.task.id);
        if (idx !== -1) tasks[idx] = { ...tasks[idx], ...msg.task };
        renderSidebar();
        gantt.setTasks(tasks);
        break;
      }
      case 'task:deleted': {
        tasks = tasks.filter((t) => t.id !== msg.id);
        tasks.forEach((t) => { t.dependsOn = (t.dependsOn || []).filter((d) => d !== msg.id); });
        if (editingId === msg.id) {
          closeModal();
          showToast('Cette tâche a été supprimée par un·e collaborateur·rice.');
        }
        renderSidebar();
        gantt.setTasks(tasks);
        break;
      }
      case 'task:dragging': {
        if (msg.by?.id === myId) break;
        const task = tasks.find((t) => t.id === msg.id);
        if (task && msg.patch) {
          Object.assign(task, msg.patch);
          gantt.renderBars();
          gantt.renderDependencies();
        }
        gantt.markRemoteActive(msg.id, msg.by.color, msg.by.name);
        break;
      }
      case 'task:dragend': {
        gantt.clearRemoteActive(msg.id);
        break;
      }
      case 'tasks:reordered': {
        msg.order.forEach((id, i) => {
          const t = tasks.find((x) => x.id === id);
          if (t) t.order = i;
        });
        renderSidebar();
        gantt.setTasks(tasks);
        break;
      }
      default:
        break;
    }
  });

  // -- Présence ---------------------------------------------------------------
  function renderPresence() {
    presenceEl.innerHTML = '';
    users.forEach((u) => {
      const chip = document.createElement('span');
      chip.className = 'presence__chip';
      chip.style.background = u.color;
      chip.textContent = (u.name || '?').trim().charAt(0).toUpperCase();
      chip.title = u.id === myId ? `${u.name} (vous)` : u.name;
      presenceEl.appendChild(chip);
    });
  }

  // -- Barre latérale (liste + réorganisation) --------------------------------
  function renderSidebar() {
    const sorted = [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    taskCountEl.textContent = String(sorted.length);
    taskListEl.innerHTML = '';

    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'sidebar__empty';
      empty.textContent = 'Aucune tâche pour l\'instant. Ajoutez la première à planifier.';
      taskListEl.appendChild(empty);
      return;
    }

    sorted.forEach((task) => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.draggable = true;
      row.dataset.id = task.id;

      const dot = document.createElement('span');
      dot.className = 'task-row__dot';
      dot.style.background = task.color || '#1B4C8C';

      const name = document.createElement('span');
      name.className = 'task-row__name';
      name.textContent = task.name;

      const assignee = document.createElement('span');
      assignee.className = 'task-row__assignee';
      assignee.textContent = task.assignee || '';

      const edit = document.createElement('span');
      edit.className = 'task-row__edit';
      edit.textContent = '✎';
      edit.style.pointerEvents = 'none';

      row.append(dot, name, assignee, edit);
      row.addEventListener('click', () => openTaskModal(task.id));

      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('is-dragover');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-dragover'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('is-dragover');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === task.id) return;
        reorderTasks(draggedId, task.id);
      });

      taskListEl.appendChild(row);
    });
  }

  function reorderTasks(draggedId, targetId) {
    const ids = [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((t) => t.id);
    const from = ids.indexOf(draggedId);
    if (from === -1) return;
    ids.splice(from, 1);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, draggedId);
    ids.forEach((id, i) => {
      const t = tasks.find((x) => x.id === id);
      if (t) t.order = i;
    });
    renderSidebar();
    gantt.setTasks(tasks);
    window.realtime.send('tasks:reorder', { order: ids });
  }

  // -- Zoom ---------------------------------------------------------------
  zoomBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      zoomBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      gantt.setZoom(btn.dataset.zoom);
    });
  });
  zoomBtns.find((b) => b.dataset.zoom === 'day')?.classList.add('is-active');

  // -- Modale d'édition ---------------------------------------------------
  function buildColorSwatches() {
    fColors.innerHTML = '';
    PALETTE.forEach((color) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.style.background = color;
      btn.addEventListener('click', () => {
        selectedColor = color;
        [...fColors.children].forEach((c) => c.classList.toggle('is-selected', c === btn));
      });
      fColors.appendChild(btn);
    });
  }
  buildColorSwatches();

  function buildDepsList(currentId) {
    fDeps.innerHTML = '';
    const candidates = tasks.filter((t) => t.id !== currentId);
    if (!candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'deps-list__empty';
      empty.textContent = 'Aucune autre tâche à lier pour le moment.';
      fDeps.appendChild(empty);
      return;
    }
    const current = tasks.find((t) => t.id === currentId);
    const currentDeps = current?.dependsOn || [];
    candidates.forEach((t) => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = t.id;
      cb.checked = currentDeps.includes(t.id);
      label.append(cb, document.createTextNode(t.name));
      fDeps.appendChild(label);
    });
  }

  function openTaskModal(taskId) {
    editingId = taskId;
    const task = taskId ? tasks.find((t) => t.id === taskId) : null;

    modalTitle.textContent = task ? 'Modifier la tâche' : 'Nouvelle tâche';
    btnDelete.hidden = !task;

    fName.value = task?.name || '';
    fStart.value = task?.start || toISO(new Date());
    fEnd.value = task?.end || toISO(new Date());
    fProgress.value = String(task?.progress ?? 0);
    fProgressOut.textContent = fProgress.value;
    fAssignee.value = task?.assignee || '';
    fNotes.value = task?.notes || '';
    selectedColor = task?.color || PALETTE[0];

    buildColorSwatches();
    [...fColors.children].forEach((c) => c.classList.toggle('is-selected', c.style.background === hexToRgbForCompare(selectedColor)));
    buildDepsList(taskId);

    modalBackdrop.hidden = false;
    setTimeout(() => fName.focus(), 30);
  }

  // Les navigateurs renvoient style.background en rgb(...) ; on compare via un élément témoin.
  function hexToRgbForCompare(hex) {
    const probe = document.createElement('div');
    probe.style.background = hex;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return rgb;
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    editingId = null;
    taskForm.reset();
  }

  fProgress.addEventListener('input', () => { fProgressOut.textContent = fProgress.value; });
  btnCancel.addEventListener('click', closeModal);
  btnModalClose.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modalBackdrop.hidden) closeModal(); });

  btnNewTask.addEventListener('click', () => openTaskModal(null));

  btnDelete.addEventListener('click', () => {
    if (!editingId) return;
    if (!confirm('Supprimer définitivement cette tâche ?')) return;
    tasks = tasks.filter((t) => t.id !== editingId);
    window.realtime.send('task:delete', { id: editingId });
    renderSidebar();
    gantt.setTasks(tasks);
    closeModal();
  });

  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let start = fStart.value;
    let end = fEnd.value;
    if (end < start) end = start;

    const deps = [...fDeps.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value);

    const patch = {
      name: fName.value.trim() || 'Tâche sans nom',
      start,
      end,
      progress: Number(fProgress.value),
      assignee: fAssignee.value.trim(),
      color: selectedColor,
      notes: fNotes.value.trim(),
      dependsOn: deps,
    };

    if (editingId) {
      const task = tasks.find((t) => t.id === editingId);
      if (task) Object.assign(task, patch);
      window.realtime.send('task:update', { task: { id: editingId, ...patch } });
    } else {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newTask = { id: tempId, order: tasks.length, ...patch };
      tasks.push(newTask);
      window.realtime.send('task:create', { task: patch, tempId });
    }

    renderSidebar();
    gantt.setTasks(tasks);
    closeModal();
  });

  // -- Divers ---------------------------------------------------------------
  let toastTimer = null;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3200);
  }
})();
