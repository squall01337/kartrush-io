# KartRush.io

Un jeu de course multijoueur en temps réel inspiré de Mario Kart, dans un style minimaliste .io.

## 🎮 Fonctionnalités

- **Multijoueur temps réel**: 2 à 8 joueurs par partie
- **Course en boucle**: Vue top-down avec système de tours
- **Items et power-ups**: Boost, ralentisseur, missiles
- **Physique simple**: Collisions, accélération, friction
- **Interface moderne**: Design responsive et coloré

## 🛠️ Technologies

### Backend
- Node.js + Express
- Socket.io pour WebSocket
- UUID pour les identifiants

### Frontend
- HTML5 Canvas
- JavaScript ES6+
- CSS3 avec animations

## 📁 Structure du projet

```
kartrush-io/
├── backend/          # Serveur Node.js
│   ├── server.js     # Point d'entrée
│   └── package.json  # Dépendances
├── frontend/         # Client web
│   ├── index.html    # Interface principale
│   ├── style.css     # Styles
│   └── js/           # Scripts JavaScript
├── assets/           # Images et sprites
├── maps/             # Configuration des pistes
└── README.md         # Documentation
```

## 🚀 Installation et lancement

### Prérequis
- Node.js 16+ 
- npm

### Backend
```bash
cd backend
npm install
npm start
```

Le serveur démarre sur http://localhost:3000

### Frontend
Ouvrir `frontend/index.html` dans un navigateur ou servir via un serveur web local.

## 🎯 Contrôles

- **Flèches directionnelles**: Accélérer, freiner, tourner
- **Espace**: Utiliser un item
- **ZQSD**: Alternative aux flèches

## 🏁 Gameplay

1. **Menu**: Entrer un pseudo et choisir une couleur
2. **Lobby**: Attendre d'autres joueurs (2 minimum)
3. **Course**: Terminer 3 tours avant les autres
4. **Items**: Ramasser des power-ups sur la piste
5. **Classement**: Voir les résultats finaux

## 🔧 Développement

### Lancer en mode développement
```bash
# Backend
cd backend && npm run dev

# Frontend (serveur local)
cd frontend && python3 -m http.server 8080
```

### Architecture réseau
- **Fréquence**: 30 FPS pour la synchronisation
- **Interpolation**: Lissage côté client
- **Validation**: Toutes les actions vérifiées côté serveur

## 📦 Déploiement

### Frontend
- Vercel, Netlify ou tout hébergeur statique

### Backend  
- Render, Railway ou tout service Node.js
- Variables d'environnement: `PORT`, `NODE_ENV`

## 🎨 Personnalisation

### Ajouter une piste
1. Créer un fichier JSON dans `maps/`
2. Définir les murs, checkpoints et spawn points
3. Référencer dans le serveur

### Ajouter des items
1. Définir l'effet côté serveur
2. Ajouter le sprite côté client
3. Implémenter la logique de ramassage

## 📝 TODO

- [ ] Système de matchmaking
- [ ] Plusieurs pistes
- [ ] Plus d'items et effets
- [ ] Système de skins
- [ ] Mode tournoi
- [ ] Chat en jeu

## 🐛 Problèmes connus

- Latence élevée peut causer des désynchronisations
- Pas de reconnexion automatique
- Limité à 8 joueurs maximum

## 📄 Licence

MIT - Voir le fichier LICENSE pour plus de détails.

## 🤝 Contribution

Les contributions sont les bienvenues ! Merci de :
1. Fork le projet
2. Créer une branche feature
3. Commit les changements
4. Ouvrir une Pull Request

# kartrush-io
