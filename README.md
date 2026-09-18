# Chantier — diagramme de Gantt collaboratif

Application autonome (Node.js + HTML/CSS/JS vanilla) pour créer un planning
en diagramme de Gantt et le modifier à plusieurs, en temps réel, via
WebSocket. Aucune base de données externe n'est requise : l'état est gardé
en mémoire côté serveur et sauvegardé dans un fichier JSON.

## Fonctionnalités

- Création, édition et suppression de tâches (nom, dates, avancement,
  responsable, couleur, notes, dépendances).
- Glisser-déposer d'une barre pour décaler une tâche, redimensionnement par
  les bords pour changer les dates.
- Dépendances entre tâches affichées sous forme de connecteurs.
- Réorganisation des tâches par glisser-déposer dans la liste latérale.
- Trois échelles de temps : jour / semaine / mois.
- Collaboration en temps réel : tous les changements sont diffusés
  instantanément à tous les navigateurs connectés, avec indicateur de qui
  manipule quoi et liste des personnes connectées.
- Reconnexion automatique du WebSocket en cas de coupure réseau.
- Persistance sur disque (`data/state.json`), rechargée au redémarrage.

## Démarrage en local

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm start
```

L'application est alors disponible sur <http://localhost:3000>. Ouvrez
cette adresse dans plusieurs onglets ou plusieurs machines du même réseau
pour tester la collaboration en direct.

Le port peut être changé via la variable d'environnement `PORT` :

```bash
PORT=8080 npm start
```

## Déploiement

L'application est un simple serveur Node.js qui sert les fichiers statiques
et gère les WebSocket sur le même port : elle se déploie comme n'importe
quelle app Node.

### Sur un VPS (Debian/Ubuntu, avec Nginx en reverse proxy)

```bash
# Sur le serveur
git clone <votre-dépôt> chantier && cd chantier
npm install --omit=dev
# Garder le process actif :
npm install -g pm2
pm2 start server.js --name chantier
pm2 save
```

Puis configurez Nginx pour rediriger vers `http://127.0.0.1:3000` en pensant
à transmettre les en-têtes nécessaires aux WebSocket :

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### Avec Docker

Un `Dockerfile` est fourni :

```bash
docker build -t chantier .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --name chantier chantier
```

Le volume sur `./data` permet de conserver le planning entre deux
redémarrages du conteneur.

### Sur une plateforme PaaS (Render, Railway, Fly.io…)

Ces plateformes détectent automatiquement un projet Node.js : il suffit de
pointer vers ce dépôt, avec la commande de démarrage `npm start` et le port
lu depuis `process.env.PORT` (déjà géré par `server.js`). Pensez à monter un
disque persistant sur `data/` si la plateforme le permet, sinon le planning
repart de zéro à chaque redéploiement.

## Structure du projet

```
chantier/
├── server.js              Serveur Express + WebSocket, état et logique métier
├── package.json
├── Dockerfile
├── data/
│   └── state.json          Créé automatiquement : sauvegarde du planning
└── public/
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── websocket.js     Client WebSocket avec reconnexion automatique
        ├── gantt.js         Moteur de rendu du diagramme (règle, grille, barres, dépendances, glisser-déposer)
        └── app.js           Logique d'interface : identité, liste des tâches, modale, synchronisation
```

## Limites connues et pistes d'évolution

- Pas d'authentification : toute personne ayant le lien peut rejoindre et
  modifier le planning. Ajoutez une protection (mot de passe, proxy avec
  auth basique, VPN) si le planning est sensible.
- Pas de détection de dépendances circulaires entre tâches.
- Un seul planning par instance du serveur ; pour plusieurs projets, il
  faudrait introduire un identifiant de planning (dans l'URL par exemple)
  et une structure de données par planning.
- La sauvegarde se fait dans un simple fichier JSON, suffisant pour une
  petite équipe ; au-delà, une vraie base de données serait plus robuste.
