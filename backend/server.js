const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Chargement de la map globale (au démarrage du serveur)
let trackData = null;
let availableMaps = [];

// Fonction pour charger la liste des maps disponibles
function loadAvailableMaps() {
    const mapsDir = path.join(__dirname, '../maps');
    try {
        const files = fs.readdirSync(mapsDir);
        availableMaps = files
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''));
        
        console.log('📁 Maps disponibles:', availableMaps);
    } catch (error) {
        console.error('❌ Erreur lors du chargement des maps:', error);
        availableMaps = ['lava_track']; // Map par défaut
    }
}

function loadMapData(mapName = 'lava_track') {
    try {
        // Construire le chemin de la map
        let mapPath = path.join(__dirname, '../maps', `${mapName}.json`);
        
        // Si la map n'existe pas, charger la map par défaut
        if (!fs.existsSync(mapPath)) {
            console.log(`⚠️ Map ${mapName} non trouvée, chargement de lava_track`);
            mapPath = path.join(__dirname, '../maps/lava_track.json');
            
            // Si même la map par défaut n'existe pas, utiliser oval_track
            if (!fs.existsSync(mapPath)) {
                mapPath = path.join(__dirname, '../maps/oval_track.json');
            }
        }
        
        const data = fs.readFileSync(mapPath, 'utf-8');
        trackData = JSON.parse(data);
        
        // Convertir les anciens rectangles en lignes si nécessaire
        convertRectsToLines(trackData);
        
        console.log('✅ Map chargée :', trackData.name);
        console.log('📍 Checkpoints:', trackData.checkpoints ? trackData.checkpoints.length : 0);
        console.log('🏁 Ligne d\'arrivée:', trackData.finishLine ? 'Oui' : 'Non');
        
        return true;
        
    } catch (error) {
        console.error('❌ Erreur de chargement de la map :', error);
        
        // Map de secours minimale pour éviter les crashes
        trackData = {
            name: "default_track",
            width: 1280,
            height: 720,
            background: "#333333",
            spawnPoints: [{ x: 400, y: 500, angle: 0 }],
            walls: [],
            curves: [],
            continuousCurves: [],
            checkpoints: [],
            finishLine: null,
            boosters: [],
            items: [],
            raceSettings: {
                laps: 3,
                maxTime: 300000,
                maxTimeWarning: 240000
            }
        };
        
        console.log('⚠️ Map de secours chargée');
        return false;
    }
}

// Fonction de conversion des rectangles en lignes
function convertRectsToLines(data) {
    // Convertir les checkpoints rectangulaires en lignes
    if (data.checkpoints && data.checkpoints.length > 0 && data.checkpoints[0].width !== undefined) {
        console.log('🔄 Conversion des checkpoints rectangulaires en lignes...');
        data.checkpoints = data.checkpoints.map(cp => {
            const cx = cp.x + cp.width / 2;
            const cy = cp.y + cp.height / 2;
            const angle = (cp.angle || 0) * Math.PI / 180;
            const halfLength = cp.height / 2;
            
            // Ligne perpendiculaire au rectangle
            const perpAngle = angle + Math.PI / 2;
            const cos = Math.cos(perpAngle);
            const sin = Math.sin(perpAngle);
            
            return {
                x1: cx - cos * halfLength,
                y1: cy - sin * halfLength,
                x2: cx + cos * halfLength,
                y2: cy + sin * halfLength
            };
        });
    }
    
    // Convertir la ligne d'arrivée
    if (data.finishLine && data.finishLine.width !== undefined) {
        console.log('🔄 Conversion de la ligne d\'arrivée rectangulaire en ligne...');
        const fl = data.finishLine;
        const cx = fl.x + fl.width / 2;
        const cy = fl.y + fl.height / 2;
        const angle = (fl.angle || 0) * Math.PI / 180;
        const halfLength = fl.height / 2;
        
        const perpAngle = angle + Math.PI / 2;
        const cos = Math.cos(perpAngle);
        const sin = Math.sin(perpAngle);
        
        data.finishLine = {
            x1: cx - cos * halfLength,
            y1: cy - sin * halfLength,
            x2: cx + cos * halfLength,
            y2: cy + sin * halfLength
        };
    }
}

// Fonction helper pour générer des codes courts
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

loadMapData();
loadAvailableMaps();

// État du jeu
const gameState = {
    rooms: new Map(),
    players: new Map()
};

// Configuration du jeu
const GAME_CONFIG = {
    MAX_PLAYERS_PER_ROOM: 8,
    MIN_PLAYERS_TO_START: 1,
    TICK_RATE: 60,
    TRACK_WIDTH: 1280,
    TRACK_HEIGHT: 720,
    KART_SIZE: 20,
    MAX_SPEED: 4,        // Augmenté de 12 à 15 (+25%)
    ACCELERATION: 0.2,    // Augmenté pour compenser la friction
    FRICTION: 0.98,       // Moins de friction (était 0.94)
    TURN_SPEED: 0.075,
    COLLISION_GRID_SIZE: 100,
    ITEM_SPAWN_INTERVAL: 10000, // Spawn d'objets toutes les 10 secondes
    MAX_ITEMS_ON_TRACK: 5,     // Maximum d'objets sur la piste
    ITEM_BOX_SIZE: 30          // Taille des boîtes d'objets
};

// Classes des objets
class Item {
    constructor(type) {
        this.type = type;
    }
}

class ItemBox {
    constructor(x, y) {
        this.id = uuidv4();
        this.x = x;
        this.y = y;
        this.active = true;
        this.respawnTime = 0;
    }
    
    collect() {
        this.active = false;
        this.respawnTime = Date.now() + 5000; // Respawn après 5 secondes
    }
    
    update() {
        if (!this.active && Date.now() >= this.respawnTime) {
            this.active = true;
        }
    }
}

// Projectiles et effets
class Projectile {
    constructor(type, owner, target = null) {
        this.id = uuidv4();
        this.type = type;
        this.owner = owner;
        this.x = owner.x;
        this.y = owner.y;
        this.angle = owner.angle;
        this.speed = 0;
        this.lifetime = 0;
        this.target = target;
        this.active = true;
        
        switch(type) {
            case 'bomb':
                // Position derrière le kart
                this.x -= Math.cos(owner.angle) * 30;
                this.y -= Math.sin(owner.angle) * 30;
                this.lifetime = 2000; // 2 secondes
                this.radius = 50;
                this.damage = 50;
                break;
                
            case 'rocket':
                // Position devant le kart
                this.x += Math.cos(owner.angle) * 30;
                this.y += Math.sin(owner.angle) * 30;
                this.speed = 8; // Rapide
                this.lifetime = 5000; // 5 secondes max
                this.radius = 20;
                this.damage = 75;
                break;
        }
    }
    
    update(deltaTime, players, walls) {
        if (!this.active) return;
        
        this.lifetime -= deltaTime * 1000;
        
        if (this.lifetime <= 0) {
            this.explode();
            return;
        }
        
        switch(this.type) {
            case 'rocket':
                this.updateRocket(deltaTime, players, walls);
                break;
        }
    }
    
    updateRocket(deltaTime, players, walls) {
        if (this.target && players.has(this.target)) {
            const target = players.get(this.target);
            if (!target.isDead) {
                // Calculer l'angle vers la cible
                const dx = target.x - this.x;
                const dy = target.y - this.y;
                const targetAngle = Math.atan2(dy, dx);
                
                // Tourner progressivement vers la cible
                let angleDiff = targetAngle - this.angle;
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                
                this.angle += angleDiff * 0.1; // Vitesse de rotation
                
                // Vérifier la distance
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < this.radius) {
                    this.explode();
                    return;
                }
            }
        }
        
        // Déplacer la roquette
        const oldX = this.x;
        const oldY = this.y;
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        
        // Vérifier collision avec les murs
        if (this.checkWallCollision(oldX, oldY, this.x, this.y, walls)) {
            this.explode();
        }
    }
    
    checkWallCollision(x1, y1, x2, y2, walls) {
        // Vérifier si la trajectoire croise un mur
        for (const curve of walls) {
            const points = curve.points;
            const len = points.length;
            const segmentCount = curve.closed ? len : len - 1;
            
            for (let i = 0; i < segmentCount; i++) {
                const [wx1, wy1] = points[i];
                const nextIndex = curve.closed ? ((i + 1) % len) : (i + 1);
                const [wx2, wy2] = points[nextIndex];
                
                if (this.lineIntersectsLine(x1, y1, x2, y2, wx1, wy1, wx2, wy2)) {
                    return true;
                }
            }
        }
        return false;
    }
    
    lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 0.0001) return false;
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }
    
    explode() {
        this.active = false;
    }
}

// Classes du jeu
class Player {
    constructor(id, pseudo, color) {
        this.id = id;
        this.pseudo = pseudo;
        this.color = color;
        this.x = 100;
        this.y = 300;
        this.angle = 0;
        this.speed = 0;
        this.lap = 0;
        this.position = 1;
        this.item = null;
        this.nextCheckpoint = 0;
        this.hasPassedStartLine = false;
        this.raceTime = 0;
        this.finishTime = null;
        this.finished = false;
        this.ready = false;
        this.isHost = false; // Nouveau : marquer si c'est l'hôte
        
        // Position précédente pour la détection de franchissement
        this.lastX = this.x;
        this.lastY = this.y;
        
        // Cooldown pour éviter les détections multiples
        this.lastCheckpointTime = {};
        this.lastFinishLineTime = 0;
        
        // État des inputs pour éviter le traitement multiple
        this.inputs = {
            up: false,
            down: false,
            left: false,
            right: false
        };
        
        // NOUVEAU : gestion du boost
        this.isBoosting = false;
        this.boostEndTime = 0;
        this.lastBoosterIndex = -1; // Pour éviter de déclencher plusieurs fois le même booster
        this.boostCooldown = 0; // Cooldown entre les boosts
        this.boostLevel = 0; // Nouveau : niveau de boost (0, 1, 2, 3)
        
        // NOUVEAU : Système d'HP
        this.hp = 100;
        this.maxHp = 100;
        this.isDead = false;
        this.respawnTime = 0;
        this.invulnerableTime = 0; // Invulnérabilité après respawn
        this.lastDamageTime = 0;
        
        // Pour le respawn au checkpoint
        this.lastValidatedCheckpoint = 0;
        this.checkpointPositions = []; // Stocker les positions des checkpoints validés
        
        // NOUVEAU : Système d'objets
        this.itemSlotAnimation = null; // Pour l'animation du casino
        this.isStunned = false;
        this.stunnedUntil = 0;
        
        // Super booster
        this.isSuperBoosting = false;
        this.superBoostEndTime = 0;
    }

    // Nouvelle méthode pour infliger des dégâts
    takeDamage(amount, damageType = 'collision') {
        if (this.invulnerableTime > Date.now() || this.isDead || this.isSuperBoosting) return false;
        
        const now = Date.now();
        // Cooldown de dégâts pour éviter le spam (200ms)
        if (now - this.lastDamageTime < 200) return false;
        
        this.hp = Math.max(0, this.hp - amount);
        this.lastDamageTime = now;
        
        if (this.hp <= 0 && !this.isDead) {
            this.die();
            return 'death';
        }
        
        return 'damage';
    }
    
    // Méthode pour mourir
    die() {
        this.isDead = true;
        this.speed = 0;
        this.respawnTime = Date.now() + 3000; // Respawn dans 3 secondes
        this.item = null; // Perdre l'objet en mourant
        this.isStunned = false;
        this.isSuperBoosting = false;
    }
    
    // Méthode pour respawn
    respawn(spawnPoint) {
        this.hp = this.maxHp;
        this.isDead = false;
        this.x = spawnPoint.x;
        this.y = spawnPoint.y;
        this.lastX = spawnPoint.x;
        this.lastY = spawnPoint.y;
        this.angle = spawnPoint.angle || 0;
        this.speed = 0;
        this.invulnerableTime = Date.now() + 2000; // 2 secondes d'invulnérabilité
        
        // Réinitialiser les boosts
        this.isBoosting = false;
        this.boostEndTime = 0;
        this.boostLevel = 0;
        this.isSuperBoosting = false;
        this.superBoostEndTime = 0;
        this.isStunned = false;
    }
    
    stun(duration) {
        if (this.isSuperBoosting || this.invulnerableTime > Date.now()) return;
        
        this.isStunned = true;
        this.stunnedUntil = Date.now() + duration;
        this.speed = 0;
    }

    update(deltaTime) {
        // Si mort, ne pas update
        if (this.isDead) return;
        
        // Gérer le stun
        if (this.isStunned) {
            if (Date.now() > this.stunnedUntil) {
                this.isStunned = false;
            } else {
                this.speed *= 0.9; // Ralentir progressivement
                return; // Ne pas traiter les inputs
            }
        }
        
        // Sauvegarder la position précédente
        this.lastX = this.x;
        this.lastY = this.y;
        
        // Vérifier si le boost est terminé
        if (this.isBoosting && Date.now() > this.boostEndTime) {
            this.isBoosting = false;
            this.boostLevel = 0; // Réinitialiser le niveau de boost
        }
        
        // Vérifier si le super boost est terminé
        if (this.isSuperBoosting && Date.now() > this.superBoostEndTime) {
            this.isSuperBoosting = false;
        }
        
        // Réduire le cooldown
        if (this.boostCooldown > 0) {
            this.boostCooldown -= deltaTime * 1000;
        }
        
        // Traiter les inputs
        if (this.inputs.up) this.accelerate();
        if (this.inputs.down) this.brake();
        if (this.inputs.left) this.turnLeft();
        if (this.inputs.right) this.turnRight();
        
        // Appliquer la friction différemment selon l'état
        if (this.inputs.up && this.speed > 0) {
            // Moins de friction en accélération
            this.speed *= GAME_CONFIG.FRICTION + 0.01;
        } else if (this.inputs.down && this.speed < 0) {
            // Moins de friction en marche arrière
            this.speed *= GAME_CONFIG.FRICTION + 0.01;
        } else {
            // Friction normale quand on lâche tout
            this.speed *= GAME_CONFIG.FRICTION - 0.02;
        }
        
        // Garantir les limites de vitesse
        let maxSpeedLimit = GAME_CONFIG.MAX_SPEED;
        if (this.isBoosting) {
            switch(this.boostLevel) {
                case 1: maxSpeedLimit *= 1.25; break;
                case 2: maxSpeedLimit *= 1.50; break;
                case 3: maxSpeedLimit *= 1.75; break;
            }
        }
        
        if (this.isSuperBoosting) {
            maxSpeedLimit *= 1.5; // 150% de vitesse avec super booster
        }
        
        if (this.speed > maxSpeedLimit) {
            this.speed = maxSpeedLimit;
        } else if (this.speed < -GAME_CONFIG.MAX_SPEED * 0.5) {
            this.speed = -GAME_CONFIG.MAX_SPEED * 0.5;
        }
        
        // Arrêt complet si vitesse très faible
        if (Math.abs(this.speed) < 0.1) {
            this.speed = 0;
        }
        
        // Mettre à jour la position
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        
        // Limites de la piste
        this.x = Math.max(GAME_CONFIG.KART_SIZE, Math.min(GAME_CONFIG.TRACK_WIDTH - GAME_CONFIG.KART_SIZE, this.x));
        this.y = Math.max(GAME_CONFIG.KART_SIZE, Math.min(GAME_CONFIG.TRACK_HEIGHT - GAME_CONFIG.KART_SIZE, this.y));
    }

    accelerate() {
        // Modifier pour prendre en compte le boost avec niveaux
        let speedMultiplier = 1.0;
        if (this.isBoosting) {
            switch(this.boostLevel) {
                case 1: speedMultiplier = 1.25; break;  // 125%
                case 2: speedMultiplier = 1.50; break;  // 150%
                case 3: speedMultiplier = 1.75; break;  // 175%
                default: speedMultiplier = 1.25; break;
            }
        }
        
        if (this.isSuperBoosting) {
            speedMultiplier = 1.5;
        }
        
        const maxSpeed = GAME_CONFIG.MAX_SPEED * speedMultiplier;
        const acceleration = (this.isBoosting || this.isSuperBoosting) ? GAME_CONFIG.ACCELERATION * 1.5 : GAME_CONFIG.ACCELERATION;
        
        this.speed = Math.min(this.speed + acceleration, maxSpeed);
        
        // Forcer à la vitesse max si on est très proche
        if (this.speed > maxSpeed * 0.98) {
            this.speed = maxSpeed;
        }
    }
    
    brake() {
        // Si on va en avant, freiner normalement
        if (this.speed > 0) {
            this.speed = Math.max(0, this.speed - GAME_CONFIG.ACCELERATION * 2);
        } else {
            // Marche arrière : 50% de la vitesse max
            this.speed = Math.max(this.speed - GAME_CONFIG.ACCELERATION, -GAME_CONFIG.MAX_SPEED * 0.5);
        }
    }

    turnLeft() {
        if (Math.abs(this.speed) > 0.1) {
            this.angle -= GAME_CONFIG.TURN_SPEED * (this.speed / GAME_CONFIG.MAX_SPEED);
        }
    }

    turnRight() {
        if (Math.abs(this.speed) > 0.1) {
            this.angle += GAME_CONFIG.TURN_SPEED * (this.speed / GAME_CONFIG.MAX_SPEED);
        }
    }
}

class Room {
    constructor(id, isPrivate = false) {
        this.id = id;
        this.isPrivate = isPrivate;
        this.host = null; // ID de l'hôte
        this.players = new Map();
        this.gameStarted = false;
        this.gameStartTime = null;
        this.lastUpdate = Date.now();
        this.gameLoop = null;
        this.warningShown = false;
        this.raceSettings = null;
        this.mapName = 'lava_track'; // Map par défaut
        this.rematchVotes = new Set(); // Nouveaux votes pour rejouer
        this.rematchTimer = null; // Timer pour le rematch
        this.selectedMap = 'lava_track'; // Map sélectionnée par l'hôte
        
        // NOUVEAU : Système d'objets
        this.itemBoxes = [];
        this.projectiles = new Map();
        this.lastItemSpawn = 0;
    }

    // Nouvelle méthode pour vérifier si l'hôte peut démarrer
    canHostStart() {
        if (this.host && this.players.size >= GAME_CONFIG.MIN_PLAYERS_TO_START && !this.gameStarted) {
            // L'hôte est toujours considéré comme prêt
            for (let player of this.players.values()) {
                if (player.id !== this.host && !player.ready) return false;
            }
            return true;
        }
        return false;
    }

    addPlayer(player) {
        if (this.players.size >= GAME_CONFIG.MAX_PLAYERS_PER_ROOM) {
            return false;
        }
        this.players.set(player.id, player);
        
        // Si c'est le premier joueur, il devient l'hôte
        if (!this.host && this.players.size === 1) {
            this.host = player.id;
            player.isHost = true;
            player.ready = true; // L'hôte est toujours prêt
        }
        
        return true;
    }

    removePlayer(playerId) {
        const wasHost = this.host === playerId;
        this.players.delete(playerId);
        
        // Nettoyer les votes de rematch
        this.rematchVotes.delete(playerId);
        
        if (this.players.size === 0) {
            this.stopGame();
            if (this.rematchTimer) {
                clearTimeout(this.rematchTimer);
                this.rematchTimer = null;
            }
        } else if (wasHost) {
            // Transférer l'hôte au premier joueur disponible
            const newHost = this.players.keys().next().value;
            this.host = newHost;
            
            // Marquer le nouveau hôte
            const newHostPlayer = this.players.get(newHost);
            if (newHostPlayer) {
                newHostPlayer.isHost = true;
                newHostPlayer.ready = true; // Le nouvel hôte est automatiquement prêt
            }
            
            // Notifier le nouveau hôte
            io.to(this.id).emit('hostChanged', { newHostId: newHost });
        }
    }

    canStart() {
        return this.players.size >= GAME_CONFIG.MIN_PLAYERS_TO_START && 
               !this.gameStarted;
    }

    // Nouvelle méthode pour réinitialiser la room après une course
    resetForNewRace() {
        this.gameStarted = false;
        this.gameStartTime = null;
        this.warningShown = false;
        this.rematchVotes.clear();
        
        // Réinitialiser les objets
        this.itemBoxes = [];
        this.projectiles.clear();
        this.lastItemSpawn = 0;
        
        // NE PAS réinitialiser la selectedMap ici, elle doit persister
        
        // Réinitialiser l'état ready de tous les joueurs (sauf l'hôte)
        for (let player of this.players.values()) {
            player.ready = player.isHost ? true : false;
            player.finished = false;
            player.finishTime = null;
            player.lap = 0;
            player.nextCheckpoint = 0;
            player.hasPassedStartLine = false;
            player.lastCheckpointTime = {};
            player.lastFinishLineTime = 0;
            player.raceTime = 0;
            player.item = null; // Réinitialiser les objets
            player.isStunned = false;
            player.isSuperBoosting = false;
            
            // Réinitialiser les inputs pour éviter le glissement
            player.inputs = {
                up: false,
                down: false,
                left: false,
                right: false
            };
            
            // NOUVEAU : Réinitialiser les états de boost
            player.isBoosting = false;
            player.boostEndTime = 0;
            player.lastBoosterIndex = -1;
            player.boostCooldown = 0;
            player.boostLevel = 0;
            
            // NOUVEAU : Réinitialiser les HP
            player.hp = player.maxHp;
            player.isDead = false;
            player.respawnTime = 0;
            player.invulnerableTime = 0;
            player.lastDamageTime = 0;
            player.lastValidatedCheckpoint = 0;
            player.checkpointPositions = [];
        }
    }

    // Nouvelle méthode pour gérer les votes de rematch
    voteRematch(playerId) {
        if (!this.players.has(playerId)) return;
        
        this.rematchVotes.add(playerId);
        
        // Informer tous les joueurs du vote
        io.to(this.id).emit('rematchVote', {
            playerId: playerId,
            votes: this.rematchVotes.size,
            total: this.players.size
        });
        
        // Si tous ont voté pour rejouer
        if (this.rematchVotes.size === this.players.size) {
            // IMPORTANT: Annuler le timer de kick avant de démarrer le rematch
            if (this.rematchTimer) {
                clearTimeout(this.rematchTimer);
                this.rematchTimer = null;
            }
            this.startRematch();
        }
    }

    // Nouvelle méthode pour démarrer le rematch
    startRematch() {
        // S'assurer que le timer est bien annulé
        if (this.rematchTimer) {
            clearTimeout(this.rematchTimer);
            this.rematchTimer = null;
        }
        
        this.resetForNewRace();
        
        // Recharger la map et informer les clients
        io.to(this.id).emit('rematchStarting', {
            mapName: this.selectedMap
        });
        
        // Renvoyer au lobby
        broadcastPlayersList(this);
    }

    startGame() {
        if (!this.canStart()) return false;
        
        // IMPORTANT: Annuler le timer de rematch si une nouvelle partie démarre
        if (this.rematchTimer) {
            clearTimeout(this.rematchTimer);
            this.rematchTimer = null;
        }
        
        this.gameStarted = true;
        // NE PAS définir gameStartTime ici, attendre 3 secondes
        this.gameStartTime = null;
        
        // Charger la map sélectionnée
        loadMapData(this.selectedMap);
        
        this.raceSettings = trackData.raceSettings || {
            laps: 3,
            maxTime: 300000,
            maxTimeWarning: 240000
        };
        
        // Initialiser les boîtes d'objets
        this.initializeItemBoxes();
        
        const spawnPoints = (trackData && trackData.spawnPoints) || [];

        let index = 0;
        for (let player of this.players.values()) {
            const pos = spawnPoints[index % spawnPoints.length] || { x: 400, y: 500, angle: 0 };
            player.x = pos.x;
            player.y = pos.y;
            player.lastX = pos.x;
            player.lastY = pos.y;
            player.angle = (pos.angle || 0) * Math.PI / 180;
            player.speed = 0;
            player.lap = 0;
            player.finished = false;
            player.raceTime = 0;
            player.finishTime = null;
            player.item = null;
            
            player.nextCheckpoint = 0;
            player.hasPassedStartLine = false;
            player.lastCheckpointTime = {};
            player.lastFinishLineTime = 0;
            
            // S'assurer que les inputs sont réinitialisés au démarrage
            player.inputs = {
                up: false,
                down: false,
                left: false,
                right: false
            };
            
            // NOUVEAU : Réinitialiser les états de boost
            player.isBoosting = false;
            player.boostEndTime = 0;
            player.lastBoosterIndex = -1;
            player.boostCooldown = 0;
            player.isSuperBoosting = false;
            player.superBoostEndTime = 0;
            
            // NOUVEAU : Réinitialiser les HP
            player.hp = player.maxHp;
            player.isDead = false;
            player.respawnTime = 0;
            player.invulnerableTime = 0;
            player.lastDamageTime = 0;
            player.lastValidatedCheckpoint = 0;
            player.checkpointPositions = [];
            
            index++;
        }
        
        // Démarrer la boucle de jeu immédiatement
        this.gameLoop = setInterval(() => {
            this.update();
        }, 1000 / GAME_CONFIG.TICK_RATE);
        
        // Démarrer le timer après 3 secondes (temps du countdown)
        setTimeout(() => {
            this.gameStartTime = Date.now();
            console.log('⏱️ Timer de course démarré !');
        }, 8800);
        
        return true;
    }
    
    // Nouvelle méthode pour initialiser les boîtes d'objets
    initializeItemBoxes() {
    this.itemBoxes = [];
    
    // Vérifier si la map a des positions d'objets définies
    if (trackData && trackData.items && trackData.items.length > 0) {
        // Utiliser les positions définies dans le fichier JSON de la map
        trackData.items.forEach(item => {
            // Les items dans le JSON ont des coordonnées x1,y1,x2,y2 (ligne)
            // On prend le centre de la ligne comme position de la boîte
            const centerX = (item.x1 + item.x2) / 2;
            const centerY = (item.y1 + item.y2) / 2;
            
            this.itemBoxes.push(new ItemBox(centerX, centerY));
            
            console.log(`📦 Boîte d'objet placée à (${centerX.toFixed(0)}, ${centerY.toFixed(0)})`);
        });
        
        console.log(`✅ ${this.itemBoxes.length} boîtes d'objets chargées depuis la map ${this.selectedMap}`);
    }
}

    stopGame() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
        this.gameStarted = false;
        this.gameStartTime = null;
    }

    update() {
        const now = Date.now();
        const deltaTime = (now - this.lastUpdate) / 1000;
        this.lastUpdate = now;
        
        // Si le timer n'a pas encore démarré, ne pas vérifier le temps limite
        if (!this.gameStartTime) {
            // Mettre à jour seulement les positions des joueurs
            for (let player of this.players.values()) {
                if (!player.finished && !player.isDead) {
                    player.update(deltaTime);
                    player.raceTime = 0; // Garder à 0 tant que le timer n'a pas démarré
                    
                    // Collision avec murs
                    this.checkWallCollisions(player);
                    
                    // NOUVEAU : Vérifier les boosters même avant le démarrage
                    this.checkBoosterCollisions(player);
                    
                    // NOUVEAU : Vérifier les objets
                    this.checkItemBoxCollisions(player);
                }
            }
            
            // Collision entre joueurs
            this.checkPlayerCollisions();
            this.updatePositions();
            this.broadcastGameState();
            return;
        }
        
        const raceTime = now - this.gameStartTime;

        // Vérifier le temps limite
        if (this.raceSettings) {
            if (!this.warningShown && raceTime >= this.raceSettings.maxTimeWarning) {
                this.warningShown = true;
                const remainingTime = Math.ceil((this.raceSettings.maxTime - raceTime) / 1000);
                io.to(this.id).emit('timeWarning', { 
                    remainingTime: remainingTime,
                    message: `! Only ${remainingTime} seconds remaining !`
                });
            }
            
            if (raceTime >= this.raceSettings.maxTime) {
                console.log('⏱️ Temps limite atteint !');
                this.forceEndRace();
                return;
            }
        }

        // Mettre à jour les boîtes d'objets
        this.itemBoxes.forEach(box => box.update());
        
        // Mettre à jour les projectiles
        for (const [id, projectile] of this.projectiles) {
            projectile.update(deltaTime, this.players, trackData.continuousCurves || []);
            
            if (!projectile.active) {
                // Explosion !
                this.handleProjectileExplosion(projectile);
                this.projectiles.delete(id);
            }
        }

        // NOUVEAU : Gérer les respawns
        for (let player of this.players.values()) {
            if (player.isDead && now >= player.respawnTime) {
                // Déterminer le point de respawn
                let spawnPoint;
                
                // Si on a validé au moins 2 checkpoints, respawn à l'avant-dernier
                if (player.lastValidatedCheckpoint > 1 && player.checkpointPositions[player.lastValidatedCheckpoint - 2]) {
                    spawnPoint = player.checkpointPositions[player.lastValidatedCheckpoint - 2];
                } else if (player.lastValidatedCheckpoint > 0 && player.checkpointPositions[player.lastValidatedCheckpoint - 1]) {
                    // Si on n'a validé qu'un seul checkpoint, respawn au point de départ
                    const spawnPoints = trackData.spawnPoints || [];
                    const index = Array.from(this.players.values()).indexOf(player);
                    spawnPoint = spawnPoints[index % spawnPoints.length] || { x: 400, y: 500, angle: 0 };
                } else {
                    // Sinon, respawn au point de départ
                    const spawnPoints = trackData.spawnPoints || [];
                    const index = Array.from(this.players.values()).indexOf(player);
                    spawnPoint = spawnPoints[index % spawnPoints.length] || { x: 400, y: 500, angle: 0 };
                }
                
                player.respawn(spawnPoint);
                
                // Émettre l'événement de respawn
                io.to(this.id).emit('playerRespawned', {
                    playerId: player.id,
                    position: spawnPoint,
                    hp: player.hp
                });
            }
            
            // Mettre à jour seulement si pas mort
            if (!player.finished && !player.isDead) {
                player.update(deltaTime);
                player.raceTime = now - this.gameStartTime;
                
                this.checkWallCollisions(player);
                this.checkBoosterCollisions(player);
                this.checkItemBoxCollisions(player);
                this.checkRaceProgress(player, now);
            }
        }

        // Collision entre joueurs
        this.checkPlayerCollisions();

        // Positions et update client
        this.updatePositions();
        
        // Vérifier si la course est terminée
        this.checkRaceEnd();
        
        this.broadcastGameState();
    }
    
    // Nouvelle méthode pour gérer les collisions avec les boîtes d'objets
    checkItemBoxCollisions(player) {
        if (player.item !== null || player.isDead) return; // Déjà un objet ou mort
        
        const playerRadius = GAME_CONFIG.KART_SIZE;
        const boxRadius = GAME_CONFIG.ITEM_BOX_SIZE / 2;
        
        for (const box of this.itemBoxes) {
            if (!box.active) continue;
            
            const dx = player.x - box.x;
            const dy = player.y - box.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < playerRadius + boxRadius) {
                box.collect();
                
                // Déterminer l'objet aléatoire
                const rand = Math.random();
                let itemType;
                
                if (rand < 0.6) {
                    itemType = 'bomb'; // 60%
                } else if (rand < 0.9) {
                    itemType = 'rocket'; // 30%
                } else {
                    itemType = 'superboost'; // 10%
                }
                
                // Donner l'objet au joueur
                player.item = itemType;
                
                // Envoyer l'événement de ramassage avec animation de casino
                io.to(player.id).emit('itemCollected', {
                    itemType: itemType,
                    animation: true
                });
                
                console.log(`📦 ${player.pseudo} a ramassé ${itemType}`);
                break;
            }
        }
    }
    
    // Nouvelle méthode pour utiliser un objet
    useItem(player) {
        if (!player.item || player.isDead || player.isStunned) return;
        
        const itemType = player.item;
        player.item = null; // Consommer l'objet
        
        switch (itemType) {
            case 'bomb':
                this.useBomb(player);
                break;
                
            case 'rocket':
                this.useRocket(player);
                break;
                
            case 'superboost':
                this.useSuperBoost(player);
                break;
        }
        
        // Informer le joueur que l'objet a été utilisé
        io.to(player.id).emit('itemUsed', { itemType: itemType });
    }
    
    useBomb(player) {
        const bomb = new Projectile('bomb', player);
        this.projectiles.set(bomb.id, bomb);
        
        // Envoyer l'événement de création de bombe
        io.to(this.id).emit('bombDropped', {
            id: bomb.id,
            x: bomb.x,
            y: bomb.y,
            ownerId: player.id
        });
        
        console.log(`💣 ${player.pseudo} a posé une bombe !`);
    }
    
    useRocket(player) {
        // Trouver la cible (joueur devant)
        let target = null;
        let minDistance = Infinity;
        
        for (const [id, otherPlayer] of this.players) {
            if (id === player.id || otherPlayer.isDead || otherPlayer.finished) continue;
            
            // Vérifier si le joueur est devant
            const dx = otherPlayer.x - player.x;
            const dy = otherPlayer.y - player.y;
            const angle = Math.atan2(dy, dx);
            
            let angleDiff = angle - player.angle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // Si le joueur est dans un cône de 90° devant
            if (Math.abs(angleDiff) < Math.PI / 2) {
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < minDistance) {
                    minDistance = distance;
                    target = id;
                }
            }
        }
        
        const rocket = new Projectile('rocket', player, target);
        this.projectiles.set(rocket.id, rocket);
        
        // Envoyer l'événement de création de roquette
        io.to(this.id).emit('rocketLaunched', {
            id: rocket.id,
            x: rocket.x,
            y: rocket.y,
            angle: rocket.angle,
            ownerId: player.id,
            targetId: target
        });
        
        console.log(`🚀 ${player.pseudo} a lancé une roquette${target ? ' sur ' + this.players.get(target).pseudo : ''} !`);
    }
    
    useSuperBoost(player) {
        player.isSuperBoosting = true;
        player.superBoostEndTime = Date.now() + 10000; // 10 secondes
        player.invulnerableTime = Date.now() + 10000; // Invulnérable pendant le boost
        player.speed = Math.min(player.speed + 2, GAME_CONFIG.MAX_SPEED * 1.5);
        
        // Envoyer l'événement d'activation
        io.to(this.id).emit('superBoostActivated', {
            playerId: player.id,
            duration: 10000
        });
        
        console.log(`⚡ ${player.pseudo} a activé le super booster !`);
    }
    
    // Gérer l'explosion d'un projectile
    handleProjectileExplosion(projectile) {
        // Vérifier les joueurs dans le rayon
        for (const [id, player] of this.players) {
            if (player.isDead) continue;
            
            const dx = player.x - projectile.x;
            const dy = player.y - projectile.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < projectile.radius) {
                // Infliger les dégâts
                const result = player.takeDamage(projectile.damage, projectile.type);
                
                // Stun si pas mort
                if (result !== 'death') {
                    const stunDuration = projectile.type === 'bomb' ? 2000 : 3000;
                    player.stun(stunDuration);
                }
                
                // Envoyer l'événement de dégâts
                io.to(this.id).emit('projectileHit', {
                    projectileId: projectile.id,
                    projectileType: projectile.type,
                    playerId: player.id,
                    damage: projectile.damage,
                    position: { x: projectile.x, y: projectile.y }
                });
                
                if (result === 'death') {
                    io.to(this.id).emit('playerDeath', {
                        playerId: player.id,
                        position: { x: player.x, y: player.y }
                    });
                }
            }
        }
        
        // Envoyer l'événement d'explosion
        io.to(this.id).emit('projectileExploded', {
            id: projectile.id,
            type: projectile.type,
            x: projectile.x,
            y: projectile.y,
            radius: projectile.radius
        });
    }

    // Nouvelle méthode pour gérer les collisions avec les boosters
    checkBoosterCollisions(player) {
        if (!trackData || !trackData.boosters || player.boostCooldown > 0) return;
        
        const playerRadius = GAME_CONFIG.KART_SIZE;
        
        trackData.boosters.forEach((booster, index) => {
            // Ignorer si c'est le même booster que la dernière fois
            if (index === player.lastBoosterIndex) return;
            
            // Calculer la distance du joueur à la ligne du booster
            const distToLine = this.pointToLineDistance(
                player.x, player.y,
                booster.x1, booster.y1,
                booster.x2, booster.y2
            );
            
            // Zone de détection du booster (5 pixels de chaque côté de la ligne)
            const boosterWidth = 5;
            
            if (distToLine < boosterWidth + playerRadius) {
                // Vérifier si le joueur est dans les limites du segment
                const projection = this.projectPointOnLine(
                    player.x, player.y,
                    booster.x1, booster.y1,
                    booster.x2, booster.y2
                );
                
                if (projection.t >= 0 && projection.t <= 1) {
                    // Activer le boost !
                    this.activateBoost(player);
                    player.lastBoosterIndex = index;
                }
            } else if (index === player.lastBoosterIndex && distToLine > boosterWidth * 2) {
                // Réinitialiser quand le joueur s'éloigne suffisamment
                player.lastBoosterIndex = -1;
            }
        });
    }

    // Méthode pour activer le boost
    activateBoost(player) {
        if (player.boostCooldown > 0) return;
        
        // Si déjà en boost, augmenter le niveau (max 3)
        if (player.isBoosting) {
            player.boostLevel = Math.min(3, player.boostLevel + 1);
        } else {
            // Premier boost
            player.isBoosting = true;
            player.boostLevel = 1;
        }
        
        player.boostEndTime = Date.now() + 1500; // Réinitialiser la durée à chaque nouveau boost
        player.boostCooldown = 500; // Cooldown réduit à 0.5 secondes pour permettre l'accumulation
        
        // Donner une impulsion immédiate selon le niveau
        const impulse = 1 + (player.boostLevel * 0.5); // 1.5, 2, 2.5
        player.speed = Math.min(player.speed + impulse, GAME_CONFIG.MAX_SPEED * (1 + player.boostLevel * 0.25));
        
        // Émettre l'événement avec le niveau de boost
        io.to(player.id).emit('boostActivated', { level: player.boostLevel });
        
        console.log(`🚀 ${player.pseudo} - Boost niveau ${player.boostLevel} !`);
    }

    // Méthode utilitaire pour calculer la distance d'un point à une ligne
    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        
        if (lenSq === 0) {
            // La ligne est un point
            return Math.sqrt(A * A + B * B);
        }
        
        const param = dot / lenSq;
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = px - xx;
        const dy = py - yy;
        
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Méthode pour projeter un point sur une ligne
    projectPointOnLine(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        
        if (lenSq === 0) {
            return { x: x1, y: y1, t: 0 };
        }
        
        const t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        
        return {
            x: x1 + t * dx,
            y: y1 + t * dy,
            t: t
        };
    }

    forceEndRace() {
        console.log('⏱️ Course terminée - Temps limite atteint !');
        
        // Marquer tous les joueurs non finis comme DNF (Did Not Finish)
        for (let player of this.players.values()) {
            if (!player.finished) {
                player.finished = true;
                player.finishTime = null; // null = DNF
            }
        }
        
        this.endRace();
    }

    checkRaceProgress(player, currentTime) {
        if (!trackData || !this.raceSettings) return;
        
        // === LOGIQUE DE LA LIGNE D'ARRIVÉE ===
        if (trackData.finishLine) {
            const crossed = this.lineSegmentsIntersect(
                player.lastX, player.lastY,
                player.x, player.y,
                trackData.finishLine.x1, trackData.finishLine.y1,
                trackData.finishLine.x2, trackData.finishLine.y2
            );
            
            // Cooldown de 1 seconde pour éviter les détections multiples
            if (crossed && currentTime - player.lastFinishLineTime > 1000) {
                player.lastFinishLineTime = currentTime;
                
                // Vérifier le sens de passage
                const lineVector = {
                    x: trackData.finishLine.x2 - trackData.finishLine.x1,
                    y: trackData.finishLine.y2 - trackData.finishLine.y1
                };
                // Vecteur normal à la ligne (pointe vers l'avant de la course)
                const normal = { x: -lineVector.y, y: lineVector.x };
                
                // Vecteur de mouvement du joueur
                const movement = {
                    x: player.x - player.lastX,
                    y: player.y - player.lastY
                };
                
                // Produit scalaire pour vérifier le sens
                const dot = normal.x * movement.x + normal.y * movement.y;
                
                if (dot > 0) { // Passage dans le bon sens
                    // Premier passage = début de la course
                    if (!player.hasPassedStartLine) {
                        player.hasPassedStartLine = true;
                        player.lap = 1;
                        player.nextCheckpoint = 0;
                        
                        console.log(`🚦 ${player.pseudo} - Tour 1 commencé !`);
                        
                        io.to(player.id).emit('lapStarted', {
                            message: '1st Lap',
                            lap: 1,
                            totalLaps: this.raceSettings.laps
                        });
                    }
                    // Validation d'un tour
                    else if (player.nextCheckpoint === (trackData.checkpoints ? trackData.checkpoints.length : 0)) {
                        player.lap++;
                        player.nextCheckpoint = 0;
                        
                        console.log(`🏁 ${player.pseudo} - Lap ${player.lap}/${this.raceSettings.laps} !`);
                        
                        if (player.lap > this.raceSettings.laps) {
                            player.finished = true;
                            player.finishTime = player.raceTime;
                            player.lap = this.raceSettings.laps;
                            
                            io.to(this.id).emit('playerFinished', {
                                playerId: player.id,
                                pseudo: player.pseudo,
                                finishTime: player.finishTime,
                                position: this.getFinishPosition()
                            });
                        } else {
                            io.to(player.id).emit('lapCompleted', {
                                lap: player.lap,
                                totalLaps: this.raceSettings.laps
                            });
                        }
                    } else {
                        const remaining = (trackData.checkpoints.length - player.nextCheckpoint);
                        io.to(player.id).emit('invalidFinish', {
                            message: `Il vous reste ${remaining} checkpoint(s) à passer !`,
                            nextCheckpoint: player.nextCheckpoint + 1
                        });
                    }
                }
            }
        }
        
        // === LOGIQUE DES CHECKPOINTS ===
        if (player.hasPassedStartLine && trackData.checkpoints) {
            const checkpoint = trackData.checkpoints[player.nextCheckpoint];
            if (checkpoint) {
                const crossed = this.lineSegmentsIntersect(
                    player.lastX, player.lastY,
                    player.x, player.y,
                    checkpoint.x1, checkpoint.y1,
                    checkpoint.x2, checkpoint.y2
                );
                
                // Cooldown de 1 seconde par checkpoint
                const lastTime = player.lastCheckpointTime[player.nextCheckpoint] || 0;
                if (crossed && currentTime - lastTime > 1000) {
                    player.lastCheckpointTime[player.nextCheckpoint] = currentTime;
                    
                    // Vérifier le sens
                    const lineVector = {
                        x: checkpoint.x2 - checkpoint.x1,
                        y: checkpoint.y2 - checkpoint.y1
                    };
                    const normal = { x: -lineVector.y, y: lineVector.x };
                    const movement = {
                        x: player.x - player.lastX,
                        y: player.y - player.lastY
                    };
                    const dot = normal.x * movement.x + normal.y * movement.y;
                    
                    if (dot > 0) {
                        // NOUVEAU : Sauvegarder la position pour le respawn
                        player.checkpointPositions[player.nextCheckpoint] = {
                            x: player.x,
                            y: player.y,
                            angle: player.angle
                        };
                        player.lastValidatedCheckpoint = player.nextCheckpoint;
                        
                        player.nextCheckpoint++;
                        
                        console.log(`✅ ${player.pseudo} - Checkpoint ${player.nextCheckpoint}/${trackData.checkpoints.length}`);
                        
                        io.to(player.id).emit('checkpointPassed', {
                            checkpoint: player.nextCheckpoint,
                            total: trackData.checkpoints.length,
                            remaining: trackData.checkpoints.length - player.nextCheckpoint,
                            lap: player.lap
                        });
                    }
                }
            }
        }
    }

    // Algorithme d'intersection de segments optimisé
    lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        
        // Lignes parallèles
        if (Math.abs(denom) < 0.0001) return false;
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
        // Intersection si t et u sont entre 0 et 1
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }

    normalizeAngle(angle) {
        // Normaliser l'angle entre -PI et PI
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }

    getFinishPosition() {
        // Compter combien de joueurs ont déjà fini
        let finishedCount = 0;
        for (let p of this.players.values()) {
            if (p.finished) finishedCount++;
        }
        return finishedCount;
    }

    checkRaceEnd() {
        // Vérifier si tous les joueurs ont terminé
        let allFinished = true;
        let hasActivePlayer = false;
        
        for (let player of this.players.values()) {
            if (!player.finished) {
                allFinished = false;
            }
            if (player.finished || player.lap > 0) {
                hasActivePlayer = true;
            }
        }
        
        // Si tous ont terminé et qu'au moins un a commencé
        if (allFinished && hasActivePlayer) {
            // Ne PAS attendre ici, endRace directement
            this.endRace();
        }
    }

    endRace() {
        console.log('🏁 Course terminée !');
        
        // Arrêter la boucle de jeu
        this.stopGame();
        
        // Calculer le classement final
        const results = this.getFinalResults();
        
        // Envoyer les résultats à tous les joueurs
        io.to(this.id).emit('raceEnded', {
            results: results,
            raceTime: Date.now() - this.gameStartTime
        });
        
        // Démarrer le timer de 10 secondes pour le rematch APRÈS le délai de 3 secondes
        setTimeout(() => {
            this.rematchTimer = setTimeout(() => {
                // Ceux qui ont voté rematch restent, les autres sont kickés
                const playersToRemove = [];
                
                for (let [playerId, player] of this.players) {
                    if (!this.rematchVotes.has(playerId)) {
                        playersToRemove.push(playerId);
                    }
                }
                
                // Kicker les joueurs qui n'ont pas voté
                for (let playerId of playersToRemove) {
                    const socket = io.sockets.sockets.get(playerId);
                    if (socket) {
                        socket.emit('kickedFromLobby', { reason: 'Pas de vote pour rejouer' });
                        socket.leave(this.id);
                    }
                    this.removePlayer(playerId);
                }
                
                // Si il reste des joueurs, retourner au lobby
                if (this.players.size > 0) {
                    this.resetForNewRace();
                    io.to(this.id).emit('returnToLobby');
                    broadcastPlayersList(this);
                }
            }, 10000);
        }, 3000); // Attendre 3 secondes pour parfaite synchronisation
    }

    formatTime(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = Math.floor((ms % 1000) / 10);
        return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }

    updatePositions() {
        const activePlayers = Array.from(this.players.values()).filter(p => !p.finished);
        
        // Séparer ceux qui ont passé la ligne de ceux qui ne l'ont pas encore fait
        const racingPlayers = activePlayers.filter(p => p.hasPassedStartLine);
        const waitingPlayers = activePlayers.filter(p => !p.hasPassedStartLine);
        
        // Trier les joueurs en course
        racingPlayers.sort((a, b) => {
            // D'abord par nombre de tours
            if (a.lap !== b.lap) return b.lap - a.lap;
            
            // Ensuite par checkpoints passés
            if (a.nextCheckpoint !== b.nextCheckpoint) {
                return b.nextCheckpoint - a.nextCheckpoint;
            }
            
            // Enfin par temps de course
            return a.raceTime - b.raceTime;
        });

        // Assigner les positions
        let position = 1;
        
        // D'abord ceux qui ont commencé la course
        racingPlayers.forEach(player => {
            player.position = position++;
        });
        
        // Puis ceux qui n'ont pas encore passé la ligne (dernières positions)
        waitingPlayers.forEach(player => {
            player.position = position++;
        });
        
        // Les joueurs finis gardent leur position finale
        const finishedPlayers = Array.from(this.players.values()).filter(p => p.finished);
        finishedPlayers.sort((a, b) => a.finishTime - b.finishTime);
        finishedPlayers.forEach((player, index) => {
            player.position = index + 1;
        });
    }

    checkPlayerCollisions() {
        const activePlayers = Array.from(this.players.values()).filter(p => !p.finished);
        
        // Vérifier chaque paire de joueurs
        for (let i = 0; i < activePlayers.length; i++) {
            for (let j = i + 1; j < activePlayers.length; j++) {
                const player1 = activePlayers[i];
                const player2 = activePlayers[j];
                
                // Calculer la distance entre les deux joueurs
                const dx = player2.x - player1.x;
                const dy = player2.y - player1.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // Rayon de collision ajusté pour contact visuel très précis
                const collisionRadius = GAME_CONFIG.KART_SIZE;
                
                // Si collision détectée (contact visuel très précis)
                if (distance < collisionRadius * 1.4) {
                    this.resolvePlayerCollision(player1, player2, dx, dy, distance);
                }
            }
        }
    }

    resolvePlayerCollision(player1, player2, dx, dy, distance) {
        if (player1.isDead || player2.isDead) return;
        
        // Gérer le super booster qui repousse
        if (player1.isSuperBoosting && !player2.isSuperBoosting) {
            // Player1 repousse player2
            const pushForce = 10;
            player2.x += (dx / distance) * pushForce;
            player2.y += (dy / distance) * pushForce;
            player2.speed = -player2.speed * 0.5; // Inverser et réduire la vitesse
            return;
        } else if (player2.isSuperBoosting && !player1.isSuperBoosting) {
            // Player2 repousse player1
            const pushForce = 10;
            player1.x -= (dx / distance) * pushForce;
            player1.y -= (dy / distance) * pushForce;
            player1.speed = -player1.speed * 0.5;
            return;
        }
        
        // Éviter la division par zéro
        if (distance === 0) {
            dx = 1;
            dy = 0;
            distance = 1;
        }
        
        // Normaliser le vecteur de collision
        const nx = dx / distance;
        const ny = dy / distance;
        
        // Séparer les joueurs pour éviter qu'ils se chevauchent
        const overlap = (GAME_CONFIG.KART_SIZE * 1.4) - distance;
        const separationX = nx * overlap * 0.5;
        const separationY = ny * overlap * 0.5;
        
        player1.x -= separationX;
        player1.y -= separationY;
        player2.x += separationX;
        player2.y += separationY;
        
        // Calculer les vitesses relatives
        const relativeVelocityX = Math.cos(player2.angle) * player2.speed - Math.cos(player1.angle) * player1.speed;
        const relativeVelocityY = Math.sin(player2.angle) * player2.speed - Math.sin(player1.angle) * player1.speed;
        
        // Vitesse relative dans la direction de collision
        const relativeSpeed = relativeVelocityX * nx + relativeVelocityY * ny;
        
        // Ne pas résoudre si les objets s'éloignent déjà
        if (relativeSpeed > 0) return;
        
        // Coefficient de restitution (élasticité)
        const restitution = 0.6;
        
        // Calculer l'impulsion
        const impulse = -(1 + restitution) * relativeSpeed / 2;
        
        // Appliquer l'impulsion aux vitesses
        const impulseX = impulse * nx;
        const impulseY = impulse * ny;
        
        // Modifier les vitesses des joueurs
        const speed1X = Math.cos(player1.angle) * player1.speed - impulseX;
        const speed1Y = Math.sin(player1.angle) * player1.speed - impulseY;
        const speed2X = Math.cos(player2.angle) * player2.speed + impulseX;
        const speed2Y = Math.sin(player2.angle) * player2.speed + impulseY;
        
        // Recalculer les vitesses et angles
        player1.speed = Math.sqrt(speed1X * speed1X + speed1Y * speed1Y) * Math.sign(player1.speed);
        player2.speed = Math.sqrt(speed2X * speed2X + speed2Y * speed2Y) * Math.sign(player2.speed);
        
        // Limiter les vitesses
        player1.speed = Math.max(-GAME_CONFIG.MAX_SPEED, Math.min(GAME_CONFIG.MAX_SPEED, player1.speed));
        player2.speed = Math.max(-GAME_CONFIG.MAX_SPEED, Math.min(GAME_CONFIG.MAX_SPEED, player2.speed));
        
        // Ajouter un petit effet de rotation aléatoire pour plus de réalisme
        const rotationEffect = 0.1;
        player1.angle += (Math.random() - 0.5) * rotationEffect;
        player2.angle += (Math.random() - 0.5) * rotationEffect;
        
        // NOUVEAU : Calculer les dégâts selon la vitesse relative
        const impactSpeed = (Math.abs(player1.speed) + Math.abs(player2.speed)) / 2;
        
        if (impactSpeed > GAME_CONFIG.MAX_SPEED * 0.15) {
            const damage = Math.floor(5 + (impactSpeed / GAME_CONFIG.MAX_SPEED) * 15);
            
            const result1 = player1.takeDamage(damage, 'player_collision');
            const result2 = player2.takeDamage(damage, 'player_collision');
            
            // Émettre les événements de collision
            io.to(this.id).emit('playersCollided', {
                player1Id: player1.id,
                player2Id: player2.id,
                damage: damage,
                position: {
                    x: (player1.x + player2.x) / 2,
                    y: (player1.y + player2.y) / 2
                }
            });
            
            // Gérer les morts éventuelles
            if (result1 === 'death') {
                io.to(this.id).emit('playerDeath', {
                    playerId: player1.id,
                    position: { x: player1.x, y: player1.y }
                });
            }
            if (result2 === 'death') {
                io.to(this.id).emit('playerDeath', {
                    playerId: player2.id,
                    position: { x: player2.x, y: player2.y }
                });
            }
        }
    }
    
    checkWallCollisions(player) {
        if (player.isDead) return;
        
        const kx = player.x;
        const ky = player.y;
        const radius = GAME_CONFIG.KART_SIZE;
        const minDist = radius + 4;
        const minDistSq = minDist * minDist;

        const prevX = player.x;
        const prevY = player.y;
        const prevSpeed = player.speed;

        for (const curve of trackData.continuousCurves || []) {
            const points = curve.points;
            const len = points.length;
            
            // IMPORTANT: Pour une courbe fermée, on connecte le dernier au premier
            const segmentCount = curve.closed ? len : len - 1;

            for (let i = 0; i < segmentCount; i++) {
                const [x1, y1] = points[i];
                // Pour une courbe fermée, le dernier segment connecte au premier point
                const nextIndex = curve.closed ? ((i + 1) % len) : (i + 1);
                const [x2, y2] = points[nextIndex];

                const dx = x2 - x1;
                const dy = y2 - y1;
                const segLenSq = dx * dx + dy * dy;
                if (segLenSq === 0) continue;

                // Projection du kart sur le segment
                let t = ((kx - x1) * dx + (ky - y1) * dy) / segLenSq;
                t = Math.max(0, Math.min(1, t));

                const closestX = x1 + t * dx;
                const closestY = y1 + t * dy;

                const distX = kx - closestX;
                const distY = ky - closestY;
                const distSq = distX * distX + distY * distY;

                if (distSq < minDistSq) {
                    const dist = Math.sqrt(distSq) || 0.001;
                    const nx = distX / dist;
                    const ny = distY / dist;

                    // Repousser le joueur hors du mur (PLUS FORT)
                    const penetration = minDist - dist;
                    player.x += nx * (penetration + 2); // +2 pixels supplémentaires
                    player.y += ny * (penetration + 2);

                    // Vecteur de vitesse du joueur
                    const vx = Math.cos(player.angle) * player.speed;
                    const vy = Math.sin(player.angle) * player.speed;
                    
                    // Produit scalaire pour déterminer l'angle d'impact
                    // dot < 0 signifie qu'on se dirige vers le mur
                    const dot = vx * nx + vy * ny;
                    
                    // Calculer l'angle d'approche par rapport à la normale du mur
                    // Un angle proche de 180° (ou -1 en dot product) = collision frontale
                    // Un angle proche de 90° (ou 0 en dot product) = frottement latéral
                    const angleRatio = Math.abs(dot) / (Math.sqrt(vx * vx + vy * vy) + 0.001); // Éviter division par 0
                    
                    // NOUVEAU : Calculer les dégâts selon l'impact
                    const impactSpeed = Math.abs(player.speed);
                    let damage = 0;
                    let damageType = 'scrape';

                    // Déterminer le type de collision basé sur l'angle d'approche
                    if (dot < -0.1 && angleRatio > 0.7) {
                        // Collision frontale : on fonce vers le mur avec un angle > 45°
                        damage = Math.floor(5 + (impactSpeed / GAME_CONFIG.MAX_SPEED) * 10);
                        damageType = 'crash';
                        player.speed *= -0.2; // Inverser la vitesse (rebond)
                        
                        // Rebond plus prononcé
                        player.x += nx * 8; // Rebond de 8 pixels
                        player.y += ny * 8;
                        
                        // Petite variation aléatoire de l'angle pour le réalisme
                        player.angle += (Math.random() - 0.5) * 0.2;
                        
                    } else if (impactSpeed > GAME_CONFIG.MAX_SPEED * 0.2) {
                        // Frottement latéral : on glisse le long du mur
                        // Plus la vitesse est élevée, plus on prend de dégâts
                        damage = Math.floor(1 + (impactSpeed / GAME_CONFIG.MAX_SPEED) * 4);
                        damageType = 'scrape';
                        
                        // Calculer la direction du mur
                        const wallLength = Math.sqrt(dx * dx + dy * dy);
                        const wallDirX = dx / wallLength;
                        const wallDirY = dy / wallLength;
                        
                        // Projeter la vitesse sur la direction du mur
                        const velocityAlongWall = vx * wallDirX + vy * wallDirY;
                        
                        // Nouvelle vitesse alignée avec le mur (avec friction)
                        const frictionFactor = 0.70; // Réduire la vitesse de 15%
                        const newVx = wallDirX * velocityAlongWall * frictionFactor;
                        const newVy = wallDirY * velocityAlongWall * frictionFactor;
                        
                        // Mettre à jour la vitesse et l'angle
                        player.speed = Math.sqrt(newVx * newVx + newVy * newVy);
                        
                        // Ajuster l'angle pour suivre le mur
                        if (player.speed > 0.1) {
                            const targetAngle = Math.atan2(newVy, newVx);
                            const angleDiff = targetAngle - player.angle;
                            
                            // Normaliser la différence d'angle entre -PI et PI
                            let normalizedDiff = angleDiff;
                            while (normalizedDiff > Math.PI) normalizedDiff -= 2 * Math.PI;
                            while (normalizedDiff < -Math.PI) normalizedDiff += 2 * Math.PI;
                            
                            // Appliquer progressivement le changement d'angle
                            player.angle += normalizedDiff * 0.3;
                        }
                        
                    } else {
                        // Collision à très basse vitesse, pas de dégâts
                        player.speed *= 0.95;
                    }
                    
                    // Appliquer les dégâts
                    if (damage > 0 && !player.isSuperBoosting) {
                        const result = player.takeDamage(damage, damageType);
                        
                        // Émettre l'événement de dégâts
                        io.to(this.id).emit('playerDamaged', {
                            playerId: player.id,
                            damage: damage,
                            hp: player.hp,
                            damageType: damageType,
                            position: { x: player.x, y: player.y },
                            isDead: result === 'death'
                        });
                        
                        if (result === 'death') {
                            io.to(this.id).emit('playerDeath', {
                                playerId: player.id,
                                position: { x: player.x, y: player.y }
                            });
                        }
                    }
                    
                    // SÉCURITÉ SUPPLÉMENTAIRE: Vérifier qu'on est vraiment sorti du mur
                    const finalDistX = player.x - closestX;
                    const finalDistY = player.y - closestY;
                    const finalDistSq = finalDistX * finalDistX + finalDistY * finalDistY;
                    
                    if (finalDistSq < minDistSq) {
                        // Forcer la sortie du mur
                        const pushDist = Math.sqrt(minDistSq) + 2;
                        player.x = closestX + (finalDistX / Math.sqrt(finalDistSq)) * pushDist;
                        player.y = closestY + (finalDistY / Math.sqrt(finalDistSq)) * pushDist;
                    }
                    
                    // Limiter la vitesse minimale
                    if (Math.abs(player.speed) < 0.5 && Math.abs(player.speed) > 0) {
                        player.speed = 0;
                    }
                    
                    break; // Collision traitée
                }
            }
        }
    }

    broadcastGameState() {
        const gameData = {
            players: Array.from(this.players.values()).map(p => ({
                id: p.id,
                pseudo: p.pseudo,
                color: p.color,
                x: p.x,
                y: p.y,
                angle: p.angle,
                speed: p.speed,
                lap: p.lap,
                position: p.position,
                item: p.item,
                finished: p.finished,
                finishTime: p.finishTime,
                raceTime: p.raceTime,
                nextCheckpoint: p.nextCheckpoint,
                hasPassedStartLine: p.hasPassedStartLine,
                totalCheckpoints: trackData.checkpoints ? trackData.checkpoints.length : 0,
                lapsToWin: this.raceSettings ? this.raceSettings.laps : 3,
                isBoosting: p.isBoosting,
                // NOUVEAU : Données d'HP
                hp: p.hp,
                maxHp: p.maxHp,
                isDead: p.isDead,
                isInvulnerable: p.invulnerableTime > Date.now(),
                // NOUVEAU : États des objets
                isStunned: p.isStunned,
                isSuperBoosting: p.isSuperBoosting
            })),
            gameTime: this.gameStartTime ? Date.now() - this.gameStartTime : 0,
            totalLaps: this.raceSettings ? this.raceSettings.laps : 3,
            maxTime: this.raceSettings ? this.raceSettings.maxTime : null,
            remainingTime: this.gameStartTime && this.raceSettings ? 
                Math.max(0, this.raceSettings.maxTime - (Date.now() - this.gameStartTime)) : 
                (this.raceSettings ? this.raceSettings.maxTime : null),
            // NOUVEAU : Objets sur la piste
            itemBoxes: this.itemBoxes.filter(box => box.active).map(box => ({
                id: box.id,
                x: box.x,
                y: box.y
            })),
            projectiles: Array.from(this.projectiles.values()).filter(p => p.active).map(p => ({
                id: p.id,
                type: p.type,
                x: p.x,
                y: p.y,
                angle: p.angle,
                ownerId: p.owner.id
            }))
        };

        io.to(this.id).emit('gameUpdate', gameData);
    }

    getFinalResults() {
        const results = Array.from(this.players.values()).map(player => ({
            id: player.id,
            pseudo: player.pseudo,
            color: player.color,
            finished: player.finished,
            finishTime: player.finishTime,
            lap: player.lap,
            position: player.position,
            dnf: player.finishTime === null && player.finished // Did Not Finish
        }));
        
        // Trier par position finale
        results.sort((a, b) => {
            // D'abord ceux qui ont fini
            if (a.finished && !b.finished) return -1;
            if (!a.finished && b.finished) return 1;
            
            // Entre ceux qui ont fini avec un temps
            if (a.finished && b.finished && a.finishTime && b.finishTime) {
                return a.finishTime - b.finishTime;
            }
            
            // DNF après ceux qui ont fini
            if (a.dnf && !b.dnf) return 1;
            if (!a.dnf && b.dnf) return -1;
            
            // Entre les DNF, par nombre de tours puis position
            if (a.lap !== b.lap) return b.lap - a.lap;
            return a.position - b.position;
        });
        
        // Assigner les positions finales
        results.forEach((result, index) => {
            result.finalPosition = index + 1;
        });
        
        return results;
    }
}

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
    console.log(`Joueur connecté: ${socket.id}`);

    socket.on('joinGame', (data) => {
        const { pseudo, color } = data;
        
        // Créer le joueur
        const player = new Player(socket.id, pseudo, color);
        gameState.players.set(socket.id, player);
        
        // Trouver ou créer une room publique
        let room = findAvailableRoom();
        if (!room) {
            // Créer une nouvelle room publique avec un code court
            const roomCode = generateRoomCode();
            room = new Room(roomCode, false);
            room.host = player.id; // Le créateur devient l'hôte
            gameState.rooms.set(roomCode, room);
            console.log('🌍 Room publique créée - Code:', roomCode);
        }
        
        // Ajouter le joueur à la room
        if (room.addPlayer(player)) {
            socket.join(room.id);

            // Envoyer les infos de la room avec le statut d'hôte
            socket.emit('joinedRoom', {
                roomId: room.id,
                playerId: player.id,
                isPrivate: false,
                roomCode: room.id,
                isHost: room.host === player.id
            });

            // Envoyer la map sélectionnée
            socket.emit('mapSelected', {
                mapId: room.selectedMap
            });

            // Notifier les autres joueurs
            socket.to(room.id).emit('playerJoined', {
                id: player.id,
                pseudo: player.pseudo,
                color: player.color
            });
            
            // Envoyer la liste des joueurs
            broadcastPlayersList(room);
        } else {
            socket.emit('error', { message: 'Room pleine' });
        }
    });

    socket.on('createRoom', (data) => {
        const { pseudo, color } = data;
        
        // Créer le joueur
        const player = new Player(socket.id, pseudo, color);
        gameState.players.set(socket.id, player);
        
        // Créer une room privée avec un code court
        const roomCode = generateRoomCode();
        const room = new Room(roomCode, true); // L'ID de la room EST le code
        room.host = player.id; // Marquer l'hôte
        gameState.rooms.set(roomCode, room); // Utiliser le code comme clé
        
        room.addPlayer(player);
        socket.join(roomCode); // Joindre avec le code
        
        console.log('🔑 Room privée créée - Code:', roomCode);
        
        socket.emit('joinedRoom', {
            roomId: roomCode,     // L'ID est le code
            playerId: player.id,
            isPrivate: true,
            roomCode: roomCode,   // Le code explicite pour l'affichage
            isHost: true
        });
        
        // Envoyer la map sélectionnée (par défaut)
        socket.emit('mapSelected', {
            mapId: room.selectedMap
        });
        
        broadcastPlayersList(room);
    });

    // Nouveau handler pour rejoindre avec un code
    socket.on('joinRoomWithCode', (data) => {
        const { pseudo, color, roomCode } = data;
        
        // Chercher la room par son code (publique ou privée)
        const room = gameState.rooms.get(roomCode.toUpperCase());
        
        if (!room) {
            socket.emit('error', { message: 'Code de room invalide' });
            return;
        }
        
        if (room.gameStarted) {
            socket.emit('error', { message: 'La partie a déjà commencé' });
            return;
        }
        
        if (room.players.size >= GAME_CONFIG.MAX_PLAYERS_PER_ROOM) {
            socket.emit('error', { message: 'Room pleine' });
            return;
        }
        
        // Créer le joueur
        const player = new Player(socket.id, pseudo, color);
        gameState.players.set(socket.id, player);
        
        // Ajouter le joueur à la room
        if (room.addPlayer(player)) {
            socket.join(room.id);
            
            socket.emit('joinedRoom', {
                roomId: room.id,
                playerId: player.id,
                isPrivate: room.isPrivate,
                roomCode: room.id,
                isHost: false
            });
            
            // Envoyer la map sélectionnée
            socket.emit('mapSelected', {
                mapId: room.selectedMap
            });
            
            // Notifier les autres joueurs
            socket.to(room.id).emit('playerJoined', {
                id: player.id,
                pseudo: player.pseudo,
                color: player.color
            });
            
            broadcastPlayersList(room);
        } else {
            socket.emit('error', { message: 'Room pleine' });
        }
    });

    socket.on('playerReady', () => {
        const player = gameState.players.get(socket.id);
        if (player) {
            player.ready = true;
            const room = findPlayerRoom(socket.id);
            if (room) {
                broadcastPlayersList(room);
                
                // Ne plus démarrer automatiquement
                // L'hôte doit cliquer sur le bouton démarrer
            }
        }
    });

    // Nouveau handler pour l'hôte qui démarre la partie
    socket.on('hostStartGame', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        // Vérifier que c'est bien l'hôte
        if (room.host !== socket.id) {
            socket.emit('error', { message: 'Seul l\'hôte peut démarrer la partie' });
            return;
        }
        
        // Vérifier que tout le monde est prêt (sauf l'hôte qui est toujours prêt)
        let allReady = true;
        for (let player of room.players.values()) {
            if (player.id !== room.host && !player.ready) {
                allReady = false;
                break;
            }
        }
        
        if (!allReady) {
            socket.emit('error', { message: 'Tous les joueurs doivent être prêts' });
            return;
        }
        
        // Charger la map sélectionnée et envoyer à tous les joueurs
        if (loadMapData(room.selectedMap)) {
            io.to(room.id).emit('mapData', trackData);
        }
        
        // Démarrer la partie
        if (room.startGame()) {
            io.to(room.id).emit('gameStarted');
        }
    });

    // Nouveau handler pour la sélection de map
    socket.on('selectMap', (data) => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        // Vérifier que c'est bien l'hôte
        if (room.host !== socket.id) {
            socket.emit('error', { message: 'Seul l\'hôte peut choisir la map' });
            return;
        }
        
        // Vérifier que la map existe
        if (!availableMaps.includes(data.mapId) && data.mapId !== 'lava_track') {
            console.log(`⚠️ Map ${data.mapId} non trouvée dans la liste`);
            return;
        }
        
        // Mettre à jour la map sélectionnée
        room.selectedMap = data.mapId;
        console.log(`🗺️ Room ${room.id} - Map changée : ${data.mapId}`);
        
        // Notifier tous les joueurs de la room
        io.to(room.id).emit('mapSelected', {
            mapId: data.mapId
        });
    });

    // Nouveau handler pour le changement de couleur
    socket.on('changeColor', (data) => {
        const player = gameState.players.get(socket.id);
        const room = findPlayerRoom(socket.id);
        
        if (player && room && !room.gameStarted) {
            // Mettre à jour la couleur du joueur
            player.color = data.color;
            
            // Notifier tous les joueurs de la room
            io.to(room.id).emit('colorChanged', {
                playerId: player.id,
                color: data.color
            });
            
            // Mettre à jour la liste des joueurs
            broadcastPlayersList(room);
            
            console.log(`🎨 ${player.pseudo} a changé de couleur : ${data.color}`);
        }
    });

    // Nouveau handler pour voter rematch
    socket.on('voteRematch', () => {
        const room = findPlayerRoom(socket.id);
        if (room) {
            room.voteRematch(socket.id);
        }
    });

    // Nouveau handler pour quitter les résultats
    socket.on('leaveResults', () => {
        const room = findPlayerRoom(socket.id);
        if (room) {
            room.removePlayer(socket.id);
            socket.leave(room.id);
            
            // Si la room est vide, la supprimer
            if (room.players.size === 0) {
                gameState.rooms.delete(room.id);
            }
        }
    });

    socket.on('playerInput', (input) => {
        const player = gameState.players.get(socket.id);
        const room = findPlayerRoom(socket.id);
        
        if (player && room && room.gameStarted && !player.finished) {
            // NOUVEAU: Juste mettre à jour l'état des inputs
            player.inputs.up = input.up;
            player.inputs.down = input.down;
            player.inputs.left = input.left;
            player.inputs.right = input.right;
            
            // Traiter l'item séparément
            if (input.space && player.item) {
                room.useItem(player);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Joueur déconnecté: ${socket.id}`);
        
        const room = findPlayerRoom(socket.id);
        if (room) {
            room.removePlayer(socket.id);
            socket.to(room.id).emit('playerLeft', { id: socket.id });
            broadcastPlayersList(room);
            
            // Supprimer la room si vide
            if (room.players.size === 0) {
                gameState.rooms.delete(room.id);
            }
        }
        
        gameState.players.delete(socket.id);
    });
});

// Fonctions utilitaires
function findAvailableRoom() {
    for (let room of gameState.rooms.values()) {
        if (!room.isPrivate && !room.gameStarted && room.players.size < GAME_CONFIG.MAX_PLAYERS_PER_ROOM) {
            return room;
        }
    }
    return null;
}

function findPlayerRoom(playerId) {
    for (let room of gameState.rooms.values()) {
        if (room.players.has(playerId)) {
            return room;
        }
    }
    return null;
}

function broadcastPlayersList(room) {
    const playersList = Array.from(room.players.values()).map(p => ({
        id: p.id,
        pseudo: p.pseudo,
        color: p.color,
        ready: p.ready,
        isHost: p.id === room.host
    }));
    
    io.to(room.id).emit('playersUpdate', {
        players: playersList,
        canStart: room.canHostStart(), // Utiliser la nouvelle méthode
        hostId: room.host
    });
}

// Route pour obtenir la liste des maps disponibles
app.get('/api/maps', (req, res) => {
    const maps = availableMaps.map(mapId => {
        // Pour chaque map, essayer de charger ses infos
        try {
            const mapPath = path.join(__dirname, '../maps', `${mapId}.json`);
            const data = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
            return {
                id: mapId,
                name: data.name || mapId,
                thumbnail: data.background || 'assets/track_background.png' // Utiliser directement background
            };
        } catch (e) {
            return {
                id: mapId,
                name: mapId,
                thumbnail: 'assets/track_background.png'
            };
        }
    });
    
    res.json({ maps });
});

// Route pour servir le frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Démarrage du serveur
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🏁 Serveur KartRush.io démarré sur le port ${PORT}`);
    console.log(`🌐 Accès: http://localhost:${PORT}`);
});