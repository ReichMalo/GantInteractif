# GantInteractif — diagramme de Gantt collaboratif

Application autonome (Node.js + HTML/CSS/JS vanilla) pour créer un planning
en diagramme de Gantt et le modifier à plusieurs, en temps réel, via
WebSocket. Aucune base de données externe requise : l'état est gardé
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

### Sur un Serveur (Debian/Ubuntu, avec Nginx en reverse proxy)

```bash
# Sur le serveur
git clone <votre-dépôt> GantInteractif && cd GantInteractif
npm install --omit=dev
# Garder le process actif :
npm install -g pm2
pm2 start server.js --name GantInteractif
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

*pensez à rajouter le state.json vide dans data/