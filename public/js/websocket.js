// Petit wrapper autour de WebSocket : reconnexion automatique avec backoff,
// et un bus d'événements simple (on/emit) pour découpler du reste de l'app.
class RealtimeClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.retryDelay = 1000;
    this.maxRetryDelay = 10000;
    this.shouldReconnect = true;
    this.queue = [];
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  emit(event, payload) {
    (this.listeners.get(event) || []).forEach((fn) => fn(payload));
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;
    this.emit('status', 'connecting');
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.retryDelay = 1000;
      this.emit('status', 'online');
      // Vider la file des messages écrits pendant la déconnexion.
      while (this.queue.length) this.ws.send(this.queue.shift());
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.emit('message', msg);
    });

    this.ws.addEventListener('close', () => {
      this.emit('status', 'offline');
      if (this.shouldReconnect) this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      this.ws.close();
    });
  }

  _scheduleReconnect() {
    setTimeout(() => this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 1.6, this.maxRetryDelay);
  }

  send(type, data = {}) {
    const payload = JSON.stringify({ type, ...data });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.queue.push(payload);
    }
  }
}

window.realtime = new RealtimeClient();
