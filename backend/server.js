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

// API endpoint to get list of public rooms
app.get('/api/rooms', (_, res) => {
    const publicRooms = [];
    
    gameState.rooms.forEach((room, roomCode) => {
        if (!room.isPrivate && !room.gameStarted) {
            // Get host information
            const hostPlayer = room.players.get(room.host);
            
            publicRooms.push({
                code: roomCode,
                hostName: hostPlayer ? hostPlayer.pseudo : 'Unknown',
                map: room.selectedMap,
                players: room.players.size,
                maxPlayers: 6  // You mentioned 6 players maximum
            });
        }
    });
    
    res.json(publicRooms);
});

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
        
    } catch (error) {
        console.error('❌ Erreur lors du chargement des maps:', error);
        availableMaps = ['beach']; // Map par défaut
    }
}

function loadMapData(mapName = 'beach') {
    try {
        // Construire le chemin de la map
        let mapPath = path.join(__dirname, '../maps', `${mapName}.json`);
        
        // Si la map n'existe pas, charger la map par défaut
        if (!fs.existsSync(mapPath)) {
            mapPath = path.join(__dirname, '../maps/beach.json');
            
            // Si même la map par défaut n'existe pas, utiliser night_city
            if (!fs.existsSync(mapPath)) {
                mapPath = path.join(__dirname, '../maps/night_city.json');
            }
        }
        
        const data = fs.readFileSync(mapPath, 'utf-8');
        trackData = JSON.parse(data);
        
        // Convertir les anciens rectangles en lignes si nécessaire
        convertRectsToLines(trackData);
        
        // Preprocess racing line if it exists
        if (trackData.racingLine) {
            // Create temporary room to use preprocessing method
            const tempRoom = new Room('temp', 'public', null, io);
            tempRoom.preprocessRacingLine(trackData.racingLine);
            console.log(`✅ Racing line preprocessed: ${trackData.racingLine.points.length} points, total length: ${trackData.racingLine.totalLength?.toFixed(2) || 0}`);
        }
        
        console.log(`✅ Map "${mapName}" chargée avec succès`);
        return true;
        
    } catch (error) {
        console.error('❌ Erreur de chargement de la map :', error);
        
        // Map de secours minimale pour éviter les crashes
        trackData = {
            name: "default_track",
            width: 1536,
            height: 1024,
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
        
        return false;
    }
}

// Fonction de conversion des rectangles en lignes
function convertRectsToLines(data) {
    // Convertir les checkpoints rectangulaires en lignes
    if (data.checkpoints && data.checkpoints.length > 0 && data.checkpoints[0].width !== undefined) {
        data.checkpoints = data.checkpoints.map(cp => {
            const cx = cp.x + cp.width / 2;
            const cy = cp.y + cp.height / 2;
            const angle = cp.angle * Math.PI / 180;
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
        const fl = data.finishLine;
        const cx = fl.x + fl.width / 2;
        const cy = fl.y + fl.height / 2;
        const angle = fl.angle * Math.PI / 180;
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
    TRACK_WIDTH: 1536,
    TRACK_HEIGHT: 1024,
    KART_SIZE: 20,
    MAX_SPEED: 4,        // Augmenté de 12 à 15 (+25%)
    ACCELERATION: 0.2,    // Augmenté pour compenser la friction
    FRICTION: 0.98,       // Moins de friction (était 0.94)
    TURN_SPEED: 0.075,
    COLLISION_GRID_SIZE: 100,
    ITEM_SPAWN_INTERVAL: 10000, // Spawn d'objets toutes les 10 secondes
    MAX_ITEMS_ON_TRACK: 5,     // Maximum d'objets sur la piste
    ITEM_BOX_SIZE: 32          // Taille des boîtes d'objets
};

// Classes des objets

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
    
    updateRocket(_, players, walls) {
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

// Poison Slick class
class PoisonSlick {
    constructor(owner) {
        this.id = uuidv4();
        this.x = owner.x - Math.cos(owner.angle) * 50; // Position further behind the kart (was 30)
        this.y = owner.y - Math.sin(owner.angle) * 50;
        this.radius = 35; // Reduced from 40 to 35
        this.lifetime = 10000; // 10 seconds
        this.createdAt = Date.now();
        this.ownerId = owner.id;
        this.active = true;
        this.affectedPlayers = new Map(); // Track poison effect on players
        this.ownerGracePeriod = Date.now() + 1500; // Owner is immune for 1.5 seconds
    }
    
    update(deltaTime) {
        const elapsed = Date.now() - this.createdAt;
        if (elapsed >= this.lifetime) {
            this.active = false;
        }
    }
    
    checkCollision(player) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < this.radius + 15; // 15 is player radius
    }
}

// Helper functions for racing line calculations
function getClosestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    
    if (lengthSquared === 0) {
        // The segment is actually a point
        return { x: x1, y: y1, t: 0 };
    }
    
    // Calculate the parameter t that represents the position along the segment
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    
    // Clamp t to [0, 1] to handle points outside the segment
    t = Math.max(0, Math.min(1, t));
    
    // Calculate the closest point
    return {
        x: x1 + t * dx,
        y: y1 + t * dy,
        t: t
    };
}

function distance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function distanceXY(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
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
        
        // Poison effect
        this.isPoisoned = false;
        this.poisonEndTime = 0;
        this.lastPoisonDamage = 0;
        
        // Lightning speed reduction
        this.speedReductionFactor = 1.0;
        this.speedReductionEndTime = 0;
        
        // Super booster
        this.isSuperBoosting = false;
        this.superBoostEndTime = 0;
        
        // Drift system
        this.isDrifting = false;
        this.driftStartTime = 0;
        this.driftDirection = 0; // -1 = left, 1 = right
        this.driftRotation = 0; // Current rotation amount during drift
        this.originalAngle = 0; // Angle when drift started
        this.lastDriftBoostTime = 0; // Cooldown between drift boosts
        this.driftChargeLevel = 0; // 0 = none, 1 = blue, 2 = orange, 3 = purple
        this.wasCounterSteering = false; // Track counter-steer state
        this.counterSteerJump = 0; // Jump force when starting counter-steer
        
        // Racing line tracking (new)
        this.trackProgress = 0;       // Total distance traveled along racing line
        this.currentSegment = 0;      // Which segment of racing line (index)
        this.segmentProgress = 0;     // Progress within current segment (0-1)
        this.raceStartTime = 0;       // Timestamp when player started racing
        this.isGoingBackwards = false; // Track if player is going backwards
        this.wrongWayCrossing = false; // Track if player needs to fix a wrong way crossing
        this.wrongDirectionStartTime = 0; // Track when player started going backwards
        this.wrongDirectionAlertActive = false; // Track if wrong direction alert is active
    }

    // Nouvelle méthode pour infliger des dégâts
    takeDamage(amount) {
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
        this.angle = spawnPoint.angle;
        this.speed = 0;
        
        // Don't reset racing line position - it will be recalculated based on new position
        // Just clear the backwards flags
        this.isGoingBackwards = false;
        this.wrongWayCrossing = false;
        this.wrongDirectionStartTime = 0;
        this.wrongDirectionAlertActive = false;
        this.invulnerableTime = Date.now() + 2000; // 2 secondes d'invulnérabilité
        
        // Réinitialiser les boosts
        this.isBoosting = false;
        this.boostEndTime = 0;
        this.boostLevel = 0;
        this.isSuperBoosting = false;
        this.superBoostEndTime = 0;
        this.isStunned = false;
        this.isPoisoned = false;
        this.poisonEndTime = 0;
        this.speedReductionFactor = 1.0;
        this.speedReductionEndTime = 0;
        
        // Reset drift state
        this.isDrifting = false;
        this.driftChargeLevel = 0;
        this.driftAngle = 0;
    }
    
    stun(duration) {
        if (this.isSuperBoosting || this.invulnerableTime > Date.now()) return;
        
        this.isStunned = true;
        this.stunnedUntil = Date.now() + duration;
        this.speed = 0;
    }
    
    startDrift(direction) {
        // Can only drift when moving forward at decent speed
        if (this.speed < GAME_CONFIG.MAX_SPEED * 0.3 || this.isDead || this.isStunned) return;
        
        this.isDrifting = true;
        this.driftStartTime = Date.now();
        this.driftDirection = direction; // -1 for left, 1 for right
        this.originalAngle = this.angle; // Store the angle when drift started
        this.driftRotation = 0;
        this.driftChargeLevel = 0; // Reset charge level
        this.wasCounterSteering = false;
        this.counterSteerJump = 0;
        
        // Reduce speed for drift - more reduction if boosting
        if (this.isBoosting || this.isSuperBoosting) {
            this.speed *= 0.5; // 50% if boosting (bigger reduction)
            // Also end the boost when starting drift
            this.isBoosting = false;
            this.boostEndTime = 0;
            this.boostLevel = 0;
        } else {
            this.speed *= 0.7; // 70% normal drift speed (increased from 65%)
        }
    }
    
    updateDrift(deltaTime) {
        if (!this.isDrifting) return;
        
        const driftDuration = (Date.now() - this.driftStartTime) / 1000;
        
        // Update drift charge level based on duration (3 levels)
        if (driftDuration >= 2.0 && this.driftChargeLevel < 3) {
            this.driftChargeLevel = 3; // Purple (ultra) - now requires 2 seconds
        } else if (driftDuration >= 0.8 && this.driftChargeLevel < 2) {
            this.driftChargeLevel = 2; // Orange (super)
        } else if (driftDuration >= 0.3 && this.driftChargeLevel < 1) {
            this.driftChargeLevel = 1; // Blue (mini)
        }
        
        // Drift control with counter-steer blocking
        const rotationSpeed = 2.0; // radians per second (reduced from 2.5)
        const maxRotation = Math.PI * 0.5; // 90 degrees max
        
        // Check if we're counter-steering (opposite to drift direction)
        const isCounterSteering = (this.driftDirection === -1 && this.inputs.right) || 
                                 (this.driftDirection === 1 && this.inputs.left);
        
        // Detect start of counter-steer for jump effect
        if (isCounterSteering && !this.wasCounterSteering) {
            this.counterSteerJump = 1.035; // Middle value between 1.0 and 1.5
        }
        this.wasCounterSteering = isCounterSteering;
        
        // Decay jump force more slowly
        if (this.counterSteerJump > 0) {
            this.counterSteerJump = Math.max(0, this.counterSteerJump - deltaTime * 3.0);
        }
        
        // Apply rotation based on input
        if (!isCounterSteering) {
            // Not counter-steering, allow normal rotation
            if (this.inputs.left) {
                this.driftRotation -= rotationSpeed * deltaTime;
            }
            if (this.inputs.right) {
                this.driftRotation += rotationSpeed * deltaTime;
            }
        }
        // If counter-steering, rotation is blocked (maintains current angle)
        
        // No clamping - let rotation continue indefinitely
        
        // Update angle
        this.angle = this.originalAngle + this.driftRotation;
    }
    
    endDrift() {
        if (!this.isDrifting) return;
        
        this.isDrifting = false;
        
        // Apply boost based on charge level
        if (this.driftChargeLevel > 0 && Date.now() - this.lastDriftBoostTime > 500) {
            this.isBoosting = true;
            
            // Different boost levels and durations (very low power)
            switch(this.driftChargeLevel) {
                case 1: // Blue mini-turbo
                    this.boostLevel = 1;
                    this.boostEndTime = Date.now() + 700; // 0.7 second
                    this.speed = Math.min(this.speed + 0.8, GAME_CONFIG.MAX_SPEED * 1.15); // 115% speed
                    break;
                case 2: // Orange super mini-turbo
                    this.boostLevel = 2;
                    this.boostEndTime = Date.now() + 1000; // 1.0 second
                    this.speed = Math.min(this.speed + 1.2, GAME_CONFIG.MAX_SPEED * 1.25); // 125% speed
                    break;
                case 3: // Purple ultra mini-turbo
                    this.boostLevel = 3;
                    this.boostEndTime = Date.now() + 1500; // 1.5 seconds (longer boost)
                    this.speed = Math.min(this.speed + 2.0, GAME_CONFIG.MAX_SPEED * 1.45); // 145% speed (faster)
                    break;
            }
            
            this.lastDriftBoostTime = Date.now();
            this.boostCooldown = 0;
        }
        
        // Reset drift properties
        this.driftRotation = 0;
        this.driftDirection = 0;
        this.driftChargeLevel = 0;
        this.wasCounterSteering = false;
        this.counterSteerJump = 0;
    }

    update(deltaTime) {
        // Si mort, ne pas update
        if (this.isDead) return;
        
        // Variable to track if poison damage occurred
        let poisonDamageResult = null;
        
        // Gérer le stun
        if (this.isStunned) {
            if (Date.now() > this.stunnedUntil) {
                this.isStunned = false;
            } else {
                this.speed *= 0.9; // Ralentir progressivement
                return; // Ne pas traiter les inputs
            }
        }
        
        // Gérer l'effet de poison
        const now = Date.now();
        if (this.isPoisoned) {
            if (now > this.poisonEndTime) {
                this.isPoisoned = false;
            } else {
                // Appliquer des dégâts toutes les 500ms
                if (now - this.lastPoisonDamage > 500) {
                    const result = this.takeDamage(5); // 5 damage every 500ms
                    this.lastPoisonDamage = now;
                    poisonDamageResult = { damage: 5, result: result };
                }
            }
        }
        
        // Handle Lightning speed reduction
        if (this.speedReductionEndTime > now) {
            // Speed reduction is still active
            // We'll apply this factor when calculating movement
        } else if (this.speedReductionFactor !== 1.0) {
            // Reset speed reduction when expired
            this.speedReductionFactor = 1.0;
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
        
        // Update drift state
        this.updateDrift(deltaTime);
        
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
                case 1: maxSpeedLimit *= 1.15; break;  // 115%
                case 2: maxSpeedLimit *= 1.25; break;  // 125%
                case 3: maxSpeedLimit *= 1.35; break;  // 135%
            }
        }
        
        if (this.isSuperBoosting) {
            maxSpeedLimit *= 1.5; // 150% de vitesse avec super booster
        }
        
        // During drift, maintain constant reduced speed
        if (this.isDrifting && !this.isBoosting && !this.isSuperBoosting) {
            maxSpeedLimit = GAME_CONFIG.MAX_SPEED * 0.7; // Drift speed is 70% of max
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
        
        // Update position - during drift, create a noticeable curve towards facing direction
        let moveAngle = this.angle;
        
        // Apply speed reduction factor from Lightning
        const effectiveSpeed = this.speed * this.speedReductionFactor;
        
        if (this.isDrifting) {
            // Movement follows current angle
            moveAngle = this.angle;
            
            // Lateral drift force based on rotation amount (increased for tighter curves)
            const driftStrength = Math.min(1.0, Math.abs(this.driftRotation) / (Math.PI * 0.5)); // 0 to 1, capped
            const lateralForce = effectiveSpeed * 0.18 * driftStrength; // Increased from 0.12
            const lateralAngle = this.angle + (this.driftDirection * Math.PI / 2);
            
            // Apply forward movement
            this.x += Math.cos(moveAngle) * effectiveSpeed;
            this.y += Math.sin(moveAngle) * effectiveSpeed;
            
            // Apply lateral drift movement (increased)
            this.x += Math.cos(lateralAngle) * lateralForce * this.driftDirection;
            this.y += Math.sin(lateralAngle) * lateralForce * this.driftDirection;
            
            // Outward inertia - more when counter-steering
            const isCounterSteering = (this.driftDirection === -1 && this.inputs.right) || 
                                     (this.driftDirection === 1 && this.inputs.left);
            const baseInertia = isCounterSteering ? 0.15 : 0.05; // Triple inertia when counter-steering
            const inertiaForce = baseInertia * effectiveSpeed;
            const inertiaAngle = this.originalAngle - (this.driftDirection * Math.PI / 2);
            this.x += Math.cos(inertiaAngle) * inertiaForce;
            this.y += Math.sin(inertiaAngle) * inertiaForce;
            
            // Apply counter-steer jump effect
            if (this.counterSteerJump > 0) {
                const jumpAngle = this.angle - (this.driftDirection * Math.PI / 2); // Outward from drift
                const jumpForce = this.counterSteerJump * effectiveSpeed * 0.8; // Middle value between 0.8 and 1.0
                this.x += Math.cos(jumpAngle) * jumpForce;
                this.y += Math.sin(jumpAngle) * jumpForce;
            }
        } else {
            // Normal movement when not drifting
            this.x += Math.cos(moveAngle) * effectiveSpeed;
            this.y += Math.sin(moveAngle) * effectiveSpeed;
        }
        
        // Limites de la piste
        this.x = Math.max(GAME_CONFIG.KART_SIZE, Math.min(GAME_CONFIG.TRACK_WIDTH - GAME_CONFIG.KART_SIZE, this.x));
        this.y = Math.max(GAME_CONFIG.KART_SIZE, Math.min(GAME_CONFIG.TRACK_HEIGHT - GAME_CONFIG.KART_SIZE, this.y));
        
        // Return poison damage result if any
        return poisonDamageResult;
    }

    accelerate() {
        // Modifier pour prendre en compte le boost avec niveaux
        let speedMultiplier = 1.0;
        if (this.isBoosting) {
            switch(this.boostLevel) {
                case 1: speedMultiplier = 1.15; break;  // 115%
                case 2: speedMultiplier = 1.25; break;  // 125%
                case 3: speedMultiplier = 1.35; break;  // 135%
                default: speedMultiplier = 1.15; break;
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
            // Don't actually turn the kart during drift - it's handled by drift mechanics
            if (this.isDrifting) {
                return; // Drift handles rotation
            }
            
            // Réduire le turn rate pour tous les boosts
            let turnRateMultiplier = 1.0;
            if (this.isBoosting || this.isSuperBoosting) {
                turnRateMultiplier *= 0.6;
            }
            this.angle -= GAME_CONFIG.TURN_SPEED * (this.speed / GAME_CONFIG.MAX_SPEED) * turnRateMultiplier;
        }
    }

    turnRight() {
        if (Math.abs(this.speed) > 0.1) {
            // Don't actually turn the kart during drift - it's handled by drift mechanics
            if (this.isDrifting) {
                return; // Drift handles rotation
            }
            
            // Réduire le turn rate pour tous les boosts
            let turnRateMultiplier = 1.0;
            if (this.isBoosting || this.isSuperBoosting) {
                turnRateMultiplier *= 0.6;
            }
            this.angle += GAME_CONFIG.TURN_SPEED * (this.speed / GAME_CONFIG.MAX_SPEED) * turnRateMultiplier;
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
        this.mapName = 'beach'; // Map par défaut
        this.rematchVotes = new Set(); // Nouveaux votes pour rejouer
        this.rematchTimer = null; // Timer pour le rematch
        this.selectedMap = 'random'; // Map sélectionnée par l'hôte - random par défaut
        this.actualMapId = null; // Map réellement chargée quand random est sélectionné
        
        // NOUVEAU : Système d'objets
        this.itemBoxes = [];
        this.projectiles = new Map();
        this.poisonSlicks = new Map();
        this.lastItemSpawn = 0;
        
        // Available colors for players
        this.availableColors = [
            '#ff4444', // Red
            '#44ff44', // Green
            '#4444ff', // Blue
            '#ffff44', // Yellow
            '#ff44ff', // Magenta
            '#44ffff'  // Cyan
        ];
        
        // Kick tracking system
        this.kickedPlayers = new Map(); // playerId -> kick count
        this.bannedPlayers = new Set(); // playerIds banned from this room
    }
    
    // Get next available color for new player
    getAvailableColor() {
        const usedColors = new Set();
        this.players.forEach(player => {
            usedColors.add(player.color);
        });
        
        // Find first available color
        for (const color of this.availableColors) {
            if (!usedColors.has(color)) {
                return color;
            }
        }
        
        // If all colors are taken, return the first one
        return this.availableColors[0];
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
        this.poisonSlicks.clear();
        this.lastItemSpawn = 0;
        
        // NE PAS réinitialiser la selectedMap ici, elle doit persister
        // Mais réinitialiser actualMapId pour permettre un nouveau tirage aléatoire
        this.actualMapId = null;
        
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
            
            // Reset drift state
            player.isDrifting = false;
            player.driftStartTime = 0;
            player.driftChargeLevel = 0;
            player.driftDirection = 0;
            player.driftAngle = 0;
            
            // Reset racing line tracking
            player.trackProgress = 0;
            player.currentSegment = 0;
            player.segmentProgress = 0;
            player.raceStartTime = 0;
            player.isGoingBackwards = false;
            player.wrongWayCrossing = false;
            player.wrongDirectionStartTime = 0;
            player.wrongDirectionAlertActive = false;
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
    
    // Kick player method
    kickPlayer(kickerId, targetId) {
        // Check if kicker is the host
        if (this.host !== kickerId) {
            return { success: false, message: 'Only the host can kick players' };
        }
        
        // Can't kick yourself
        if (kickerId === targetId) {
            return { success: false, message: 'You cannot kick yourself' };
        }
        
        // Check if player is in room
        if (!this.players.has(targetId)) {
            return { success: false, message: 'Player not found in room' };
        }
        
        // Update kick count
        const currentKicks = this.kickedPlayers.get(targetId) || 0;
        const newKickCount = currentKicks + 1;
        this.kickedPlayers.set(targetId, newKickCount);
        
        // Ban if kicked 3 times
        if (newKickCount >= 3) {
            this.bannedPlayers.add(targetId);
        }
        
        // Remove player from room
        const player = this.players.get(targetId);
        this.removePlayer(targetId);
        
        return { 
            success: true, 
            playerName: player.pseudo,
            kickCount: newKickCount,
            isBanned: newKickCount >= 3
        };
    }
    
    // Check if player is banned
    isPlayerBanned(playerId) {
        return this.bannedPlayers.has(playerId);
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
        
        // Ne charger la map que si ce n'est pas 'random'
        // (si c'est random, elle sera chargée par hostStartGame)
        if (this.selectedMap !== 'random') {
            loadMapData(this.selectedMap);
        }
        
        this.raceSettings = trackData.raceSettings;
        
        // Initialiser les boîtes d'objets
        this.initializeItemBoxes();
        
        const spawnPoints = trackData.spawnPoints;

        let index = 0;
        for (let player of this.players.values()) {
            const pos = spawnPoints[index % spawnPoints.length];
            player.x = pos.x;
            player.y = pos.y;
            player.lastX = pos.x;
            player.lastY = pos.y;
            player.angle = pos.angle * Math.PI / 180;
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
            
        });
        
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
                    const poisonDamageResult = player.update(deltaTime);
                    player.raceTime = 0; // Garder à 0 tant que le timer n'a pas démarré
                    
                    // Check if poison damage occurred (even before race start)
                    if (poisonDamageResult) {
                        io.to(this.id).emit('playerDamaged', {
                            playerId: player.id,
                            damage: poisonDamageResult.damage,
                            hp: player.hp,
                            damageType: 'poison',
                            position: { x: player.x, y: player.y },
                            isDead: poisonDamageResult.result === 'death'
                        });
                    }
                    
                    // Collision avec murs
                    this.checkWallCollisions(player);
                    
                    // NOUVEAU : Vérifier les boosters même avant le démarrage
                    this.checkBoosterCollisions(player);
                    
                    // NOUVEAU : Vérifier les objets
                    this.checkItemBoxCollisions(player);
                    
                    // Check wrong direction alert even before race starts
                    if (player.isGoingBackwards && player.wrongDirectionStartTime > 0) {
                        const wrongDurationMs = now - player.wrongDirectionStartTime;
                        
                        // Show alert after 2 seconds of going backwards
                        if (wrongDurationMs >= 2000 && !player.wrongDirectionAlertActive) {
                            player.wrongDirectionAlertActive = true;
                            io.to(player.id).emit('wrongDirectionAlert', { show: true });
                        }
                    }
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
                this.forceEndRace();
                return;
            }
        }

        // Mettre à jour les boîtes d'objets
        this.itemBoxes.forEach(box => box.update());
        
        // Mettre à jour les projectiles
        for (const [id, projectile] of this.projectiles) {
            projectile.update(deltaTime, this.players, trackData.continuousCurves);
            
            if (!projectile.active) {
                // Explosion !
                this.handleProjectileExplosion(projectile);
                this.projectiles.delete(id);
            }
        }
        
        // Mettre à jour les poison slicks
        for (const [id, slick] of this.poisonSlicks) {
            slick.update(deltaTime);
            
            if (!slick.active) {
                this.poisonSlicks.delete(id);
                io.to(this.id).emit('poisonSlickRemoved', { id: id });
            } else {
                // Vérifier les collisions avec les joueurs
                for (const [playerId, player] of this.players) {
                    // Skip if player is the owner and still in grace period
                    if (playerId === slick.ownerId && Date.now() < slick.ownerGracePeriod) {
                        continue;
                    }
                    
                    if (!player.isDead && slick.checkCollision(player)) {
                        // Appliquer l'effet de poison si le joueur n'est pas déjà empoisonné par cette flaque
                        const lastAffected = slick.affectedPlayers.get(playerId) || 0;
                        const now = Date.now();
                        
                        // Continuously slow the player while in the slick - more aggressive slow
                        const maxSlowSpeed = GAME_CONFIG.MAX_SPEED * 0.3; // 30% speed instead of 50%
                        if (player.speed > maxSlowSpeed) {
                            player.speed = maxSlowSpeed;
                        }
                        
                        // Also apply friction to make it harder to accelerate
                        player.speed *= 0.95;
                        
                        if (now - lastAffected > 1000) { // Réappliquer après 1 seconde
                            slick.affectedPlayers.set(playerId, now);
                            
                            // Appliquer l'effet de poison
                            player.isPoisoned = true;
                            player.poisonEndTime = now + 1000; // 1 second of poison after leaving
                            
                            io.to(this.id).emit('playerPoisoned', {
                                playerId: playerId,
                                slickId: id
                            });
                        }
                    }
                }
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
                } else if (player.lastValidatedCheckpoint === 1 && player.checkpointPositions[0]) {
                    // Si on n'a validé qu'un seul checkpoint, respawn à ce checkpoint
                    // Cela évite de respawn derrière la ligne de départ et d'être compté comme 1er
                    spawnPoint = player.checkpointPositions[0];
                } else {
                    // Sinon, respawn au point de départ
                    const spawnPoints = trackData.spawnPoints;
                    const index = Array.from(this.players.values()).indexOf(player);
                    spawnPoint = spawnPoints[index % spawnPoints.length];
                }
                
                player.respawn(spawnPoint);
                
                // If player is respawning but has already started racing (validated checkpoints),
                // ensure they maintain their racing status
                if (player.lastValidatedCheckpoint > 0 && !player.hasPassedStartLine) {
                    // Player has made progress but respawned behind start line
                    // Keep them in the race with lap 0 to avoid being excluded from positions
                    player.hasPassedStartLine = true;
                    player.lap = 0;
                }
                
                // Recalculate racing line position after respawn
                if (trackData.racingLine && trackData.racingLine.points) {
                    // Reset backwards flags on respawn
                    player.isGoingBackwards = false;
                    player.wrongWayCrossing = false;
                    this.calculateTrackProgress(player, trackData.racingLine, true); // true = initial position
                }
                
                // Émettre l'événement de respawn
                io.to(this.id).emit('playerRespawned', {
                    playerId: player.id,
                    position: spawnPoint,
                    hp: player.hp
                });
            }
            
            // Mettre à jour seulement si pas mort
            if (!player.finished && !player.isDead) {
                const poisonDamageResult = player.update(deltaTime);
                player.raceTime = now - this.gameStartTime;
                
                // Check if poison damage occurred
                if (poisonDamageResult) {
                    io.to(this.id).emit('playerDamaged', {
                        playerId: player.id,
                        damage: poisonDamageResult.damage,
                        hp: player.hp,
                        damageType: 'poison',
                        position: { x: player.x, y: player.y },
                        isDead: poisonDamageResult.result === 'death'
                    });
                    
                    if (poisonDamageResult.result === 'death') {
                        io.to(this.id).emit('playerDeath', {
                            playerId: player.id,
                            killerType: 'poison'
                        });
                    }
                }
                
                this.checkWallCollisions(player);
                this.checkBoosterCollisions(player);
                this.checkItemBoxCollisions(player);
                this.checkRaceProgress(player, now);
                
                // Check wrong direction alert
                if (player.isGoingBackwards && player.wrongDirectionStartTime > 0) {
                    const wrongDurationMs = now - player.wrongDirectionStartTime;
                    
                    // Show alert after 2 seconds of going backwards
                    if (wrongDurationMs >= 2000 && !player.wrongDirectionAlertActive) {
                        player.wrongDirectionAlertActive = true;
                        io.to(player.id).emit('wrongDirectionAlert', { show: true });
                    }
                }
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
        const boxRadius = 16;
        
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
                
                if (rand < 0.90) {
                    itemType = 'lightning'; // 90% TEMPORARY FOR TESTING
                } else if (rand < 0.92) {
                    itemType = 'healthpack'; // 2%
                } else if (rand < 0.95) {
                    itemType = 'bomb'; // 3%
                } else if (rand < 0.97) {
                    itemType = 'rocket'; // 2%
                } else if (rand < 0.99) {
                    itemType = 'superboost'; // 2%
                } else {
                    itemType = 'poisonslick'; // 1%
                }
                
                // Donner l'objet au joueur
                player.item = itemType;
                
                // Envoyer l'événement de ramassage avec animation de casino
                io.to(player.id).emit('itemCollected', {
                    playerId: player.id,  // Ajouter cette ligne
                    itemType: itemType,
                    animation: true
                });
                
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
                
            case 'healthpack':
                this.useHealthpack(player);
                break;
                
            case 'poisonslick':
                this.usePoisonSlick(player);
                break;
                
            case 'lightning':
                this.useLightning(player);
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
        
    }
    
    useHealthpack(player) {
        const healAmount = 50;
        const oldHp = player.hp;
        player.hp = Math.min(player.hp + healAmount, player.maxHp);
        const actualHeal = player.hp - oldHp;
        
        // Envoyer l'événement de soin
        io.to(this.id).emit('healthpackUsed', {
            playerId: player.id,
            healAmount: actualHeal,
            newHp: player.hp,
            position: { x: player.x, y: player.y }
        });
        
    }
    
    usePoisonSlick(player) {
        const slick = new PoisonSlick(player);
        this.poisonSlicks.set(slick.id, slick);
        
        // Envoyer l'événement de création du poison slick
        io.to(this.id).emit('poisonSlickDropped', {
            id: slick.id,
            x: slick.x,
            y: slick.y,
            radius: slick.radius,
            ownerId: player.id
        });
    }
    
    useLightning(player) {
        const affectedPlayers = [];
        
        // Find all players ahead of the caster based on position (not coordinates)
        for (const [playerId, targetPlayer] of this.players) {
            if (playerId === player.id) continue; // Skip the caster
            if (targetPlayer.isDead) continue; // Skip dead players
            
            // Only affect players with better position (lower number = ahead)
            if (targetPlayer.position < player.position) {
                // Apply stun effect (1 second)
                targetPlayer.isStunned = true;
                targetPlayer.stunnedUntil = Date.now() + 1000;
                
                // Apply speed reduction (50% for 7 seconds)
                targetPlayer.speedReductionFactor = 0.5;
                targetPlayer.speedReductionEndTime = Date.now() + 7000;
                
                affectedPlayers.push({
                    playerId: targetPlayer.id,
                    x: targetPlayer.x,
                    y: targetPlayer.y
                });
            }
        }
        
        // Emit lightning event with all affected players
        io.to(this.id).emit('lightningUsed', {
            casterId: player.id,
            affectedPlayers: affectedPlayers
        });
    }
    
    // Gérer l'explosion d'un projectile
    handleProjectileExplosion(projectile) {
        // Vérifier les joueurs dans le rayon
        for (const [_, player] of this.players) {
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
        
        // Regular boost pad - always keep boostLevel at 0 for green color
        player.isBoosting = true;
        player.boostEndTime = Date.now() + 1500;
        player.boostCooldown = 500;
        
        // Don't change boostLevel for regular boosts - keep it at 0
        // boostLevel 0 = green (regular boost)
        // boostLevel 1-3 = blue/orange/purple (drift boosts)
        
        // Give speed impulse
        player.speed = Math.min(player.speed + 1.5, GAME_CONFIG.MAX_SPEED * 1.25);
        
        // Émettre l'événement
        io.to(player.id).emit('boostActivated', { level: 0 });
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
                    // Clear backwards flag when crossing in correct direction
                    if (player.isGoingBackwards) {
                        player.isGoingBackwards = false;
                        player.wrongDirectionStartTime = 0;
                        
                        // Stop the alert if it was active
                        if (player.wrongDirectionAlertActive) {
                            player.wrongDirectionAlertActive = false;
                            io.to(player.id).emit('wrongDirectionAlert', { show: false });
                        }
                    }
                    
                    // If they were fixing a wrong way crossing, just clear it
                    if (player.wrongWayCrossing) {
                        player.wrongWayCrossing = false;
                        // Continue normal flow - don't return early
                    }
                    
                    // Premier passage = début de la course
                    if (!player.hasPassedStartLine) {
                        player.hasPassedStartLine = true;
                        player.lap = 1;
                        player.nextCheckpoint = 0;
                        player.raceStartTime = Date.now(); // Track when player started racing
                        
                        // IMPORTANT: Don't recalculate racing line position when crossing start
                        // The player's position should remain continuous to avoid jumps
                        // Their lap count changing from 0 to 1 is already handled in calculateTrackProgress
                        
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
                } else if (dot < 0) { // Passage dans le mauvais sens
                    // Mark as going backwards
                    if (!player.isGoingBackwards) {
                        player.isGoingBackwards = true;
                        player.wrongDirectionStartTime = Date.now();
                    }
                    
                    // If player has started racing and crosses finish line backwards
                    if (player.hasPassedStartLine && player.lap > 0) {
                        // Mark that they need to fix this by crossing forward
                        player.wrongWayCrossing = true;
                        
                        // Don't change lap count - let position calculation handle it
                        // The wrongWayCrossing flag will affect their calculated position
                    }
                    
                    io.to(player.id).emit('wrongWay', {
                        message: 'Wrong way!'
                    });
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
                
                for (let [playerId] of this.players) {
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

    preprocessRacingLine(racingLine) {
        if (!racingLine || !racingLine.points || racingLine.points.length < 2) return;
        
        // Check if first and last points are very close (indicating a closed loop)
        const firstPoint = racingLine.points[0];
        const lastPoint = racingLine.points[racingLine.points.length - 1];
        const closingDistance = distanceXY(firstPoint[0], firstPoint[1], lastPoint[0], lastPoint[1]);
        
        // If points are extremely close (< 5 units), remove the last point to avoid tiny segment
        if (closingDistance < 5 && racingLine.points.length > 2) {
            racingLine.points.pop();
            console.log('Removed duplicate closing point from racing line');
        }
        
        // Determine if racing line is closed
        const isClosedLine = racingLine.closed || (
            racingLine.points.length >= 3 &&
            closingDistance < 30
        );
        
        racingLine.segmentDistances = [0];
        let totalDistance = 0;
        
        // Calculate segments
        const numSegments = isClosedLine ? racingLine.points.length : racingLine.points.length - 1;
        
        for (let i = 0; i < numSegments; i++) {
            const p1 = racingLine.points[i];
            const p2 = racingLine.points[(i + 1) % racingLine.points.length];
            const dist = distanceXY(p1[0], p1[1], p2[0], p2[1]);
            totalDistance += dist;
            racingLine.segmentDistances.push(totalDistance);
        }
        
        racingLine.totalLength = totalDistance;
        racingLine.closed = isClosedLine;
    }

    calculateTrackProgress(player, racingLine, isInitialPosition = false) {
        if (!racingLine || !racingLine.points || racingLine.points.length < 2) return;
        
        // Find the closest segment of the racing line
        let closestSegment = -1;
        let closestDistance = Infinity;
        let closestPoint = null;
        let closestT = 0;
        
        // Use the preprocessed closed flag if available
        const isClosedLine = racingLine.closed !== undefined ? racingLine.closed : false;
        
        // Check each segment of the racing line
        const numSegments = isClosedLine ? racingLine.points.length : racingLine.points.length - 1;
        
        for (let i = 0; i < numSegments; i++) {
            const p1 = racingLine.points[i];
            const p2 = racingLine.points[(i + 1) % racingLine.points.length];
            
            // Find closest point on this segment
            const closest = getClosestPointOnSegment(
                player.x, player.y, p1[0], p1[1], p2[0], p2[1]
            );
            
            const dist = distanceXY(player.x, player.y, closest.x, closest.y);
            if (dist < closestDistance) {
                closestDistance = dist;
                closestSegment = i;
                closestPoint = closest;
                closestT = closest.t;
            }
        }
        
        if (closestSegment === -1) return;
        
        // Calculate total progress
        const segmentStartDistance = racingLine.segmentDistances[closestSegment];
        const segmentLength = racingLine.segmentDistances[closestSegment + 1] - segmentStartDistance;
        const currentLapProgress = segmentStartDistance + (segmentLength * closestT);
        
        // Calculate new track progress
        // Important: Only count COMPLETED laps in the progress calculation
        // A player on lap 1 has completed 0 laps, on lap 2 has completed 1 lap, etc.
        let completedLaps = player.lap - 1;
        if (player.lap === 0) {
            // Player hasn't crossed finish line yet, so their progress is negative
            // This ensures they're always behind players on lap 1+
            completedLaps = -1;
        }
        
        // If player has a wrong way crossing to fix, penalize their progress
        // This puts them effectively one lap behind without changing their actual lap count
        if (player.wrongWayCrossing) {
            completedLaps = Math.max(-1, completedLaps - 1);
        }
        
        const newTrackProgress = completedLaps * racingLine.totalLength + currentLapProgress;
        
        // Prevent going backwards on the racing line (unless it's initial position)
        // Allow some tolerance for normal movement (50 units)
        if (!isInitialPosition && player.trackProgress > 0) {
            const progressDiff = newTrackProgress - player.trackProgress;
            
            // If trying to go backwards more than tolerance
            if (progressDiff < -50) {
                // Check if it's a legitimate lap completion (crossing from end to start)
                const isLapCrossing = player.currentSegment > numSegments - 3 && closestSegment < 3;
                
                if (!isLapCrossing) {
                    // Player is going backwards
                    if (!player.isGoingBackwards) {
                        player.isGoingBackwards = true;
                        player.wrongDirectionStartTime = Date.now();
                    }
                    // IMPORTANT: Still update trackProgress for position calculation
                    // The wrongWayCrossing flag already handles position penalty
                }
            } else if (progressDiff > 10) {
                // Player is going forward again
                if (player.isGoingBackwards) {
                    player.isGoingBackwards = false;
                    player.wrongDirectionStartTime = 0;
                    
                    // Stop the alert if it was active
                    if (player.wrongDirectionAlertActive) {
                        player.wrongDirectionAlertActive = false;
                        io.to(player.id).emit('wrongDirectionAlert', { show: false });
                    }
                }
            }
        } else {
            // For initial position or first calculation
            player.isGoingBackwards = false;
        }
        
        // Update progress
        player.trackProgress = newTrackProgress;
        player.currentSegment = closestSegment;
        player.segmentProgress = closestT;
    }

    updatePositions() {
        const activePlayers = Array.from(this.players.values()).filter(p => !p.finished);
        
        // If we have a racing line, use it for precise position calculation
        if (trackData && trackData.racingLine && trackData.racingLine.points) {
            // Calculate track progress for each player
            activePlayers.forEach(player => {
                if (player.hasPassedStartLine) {
                    // Always update position calculation to ensure accuracy
                    this.calculateTrackProgress(player, trackData.racingLine);
                }
            });
            
            // Separate racing and waiting players
            const racingPlayers = activePlayers.filter(p => p.hasPassedStartLine);
            const waitingPlayers = activePlayers.filter(p => !p.hasPassedStartLine);
            
            // Sort by track progress (higher = further ahead)
            racingPlayers.sort((a, b) => {
                // Compare by actual race progress
                // Track progress already includes lap information (completedLaps * totalLength + currentProgress)
                // Players who crossed backwards will have lower progress due to lap reduction
                const progressDiff = b.trackProgress - a.trackProgress;
                
                // If there's a significant difference in progress, use it
                if (Math.abs(progressDiff) > 0.1) {
                    return progressDiff;
                }
                
                // If track progress is essentially the same, use race start time
                // Players who started racing earlier should be ranked higher
                return (a.raceStartTime || 0) - (b.raceStartTime || 0);
            });
            
            // Assign positions
            let position = 1;
            
            // First those who have started racing
            racingPlayers.forEach(player => {
                player.position = position++;
            });
            
            // Then those who haven't passed the start line yet
            waitingPlayers.forEach(player => {
                player.position = position++;
            });
        } else {
            // Fallback to checkpoint-based system if no racing line
            const racingPlayers = activePlayers.filter(p => p.hasPassedStartLine);
            const waitingPlayers = activePlayers.filter(p => !p.hasPassedStartLine);
            
            // Sort players in race
            racingPlayers.sort((a, b) => {
                // First by lap count
                if (a.lap !== b.lap) return b.lap - a.lap;
                
                // Then by checkpoints passed
                if (a.nextCheckpoint !== b.nextCheckpoint) {
                    return b.nextCheckpoint - a.nextCheckpoint;
                }
                
                // Finally by race time
                return a.raceTime - b.raceTime;
            });

            // Assign positions
            let position = 1;
            
            // First those who have started racing
            racingPlayers.forEach(player => {
                player.position = position++;
            });
            
            // Then those who haven't passed the start line yet
            waitingPlayers.forEach(player => {
                player.position = position++;
            });
        }
        
        // Finished players keep their final position
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


        for (const curve of trackData.continuousCurves) {
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
                isSuperBoosting: p.isSuperBoosting,
                isPoisoned: p.isPoisoned,
                speedReductionFactor: p.speedReductionFactor,
                speedReductionEndTime: p.speedReductionEndTime,
                // Drift state
                isDrifting: p.isDrifting,
                driftStartTime: p.driftStartTime,
                driftDirection: p.driftDirection,
                driftRotation: p.driftRotation,
                driftChargeLevel: p.driftChargeLevel,
                boostLevel: p.boostLevel,
                counterSteerJump: p.counterSteerJump,
                // Racing line tracking
                trackProgress: p.trackProgress,
                currentSegment: p.currentSegment,
                segmentProgress: p.segmentProgress
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
            })),
            poisonSlicks: Array.from(this.poisonSlicks.values()).filter(s => s.active).map(s => ({
                id: s.id,
                x: s.x,
                y: s.y,
                radius: s.radius,
                ownerId: s.ownerId
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

    socket.on('createRoom', (data) => {
        const { pseudo } = data;
        
        // Créer une room privée avec un code court
        const roomCode = generateRoomCode();
        const room = new Room(roomCode, true); // L'ID de la room EST le code
        
        // Get available color for the player
        const availableColor = room.getAvailableColor();
        
        // Créer le joueur avec la couleur disponible
        const player = new Player(socket.id, pseudo, availableColor);
        gameState.players.set(socket.id, player);
        
        room.host = player.id; // Marquer l'hôte
        gameState.rooms.set(roomCode, room); // Utiliser le code comme clé
        
        room.addPlayer(player);
        socket.join(roomCode); // Joindre avec le code
        
        
        socket.emit('joinedRoom', {
            roomId: roomCode,     // L'ID est le code
            playerId: player.id,
            isPrivate: true,
            roomCode: roomCode,   // Le code explicite pour l'affichage
            isHost: true,
            assignedColor: player.color,  // Send the assigned color
            selectedMap: room.selectedMap  // Add selected map to joined room data
        });
        
        // Envoyer la map sélectionnée (par défaut)
        socket.emit('mapSelected', {
            mapId: room.selectedMap
        });
        
        broadcastPlayersList(room);
    });
    
    socket.on('changeColor', (data) => {
        const { color } = data;
        const player = gameState.players.get(socket.id);
        const room = findPlayerRoom(socket.id);
        
        if (!player || !room) return;
        
        // Check if color is available
        const usedColors = new Set();
        room.players.forEach(p => {
            if (p.id !== player.id) {
                usedColors.add(p.color);
            }
        });
        
        if (!usedColors.has(color) && room.availableColors.includes(color)) {
            // Update player color
            player.color = color;
            
            // Broadcast the update to all players in the room
            broadcastPlayersList(room);
        } else {
            // Color is not available, send back the current color
            socket.emit('colorNotAvailable', {
                currentColor: player.color
            });
        }
    });

    socket.on('createPublicRoom', (data) => {
        const { pseudo } = data;
        
        // Always create a new public room
        const roomCode = generateRoomCode();
        const room = new Room(roomCode, false); // false = public room
        
        // Get available color for the player
        const availableColor = room.getAvailableColor();
        
        // Créer le joueur avec la couleur disponible
        const player = new Player(socket.id, pseudo, availableColor);
        gameState.players.set(socket.id, player);
        
        room.host = player.id;
        gameState.rooms.set(roomCode, room);
        
        
        // Add player to room
        if (room.addPlayer(player)) {
            socket.join(room.id);

            socket.emit('joinedRoom', {
                roomId: room.id,
                playerId: player.id,
                isPrivate: false,
                roomCode: room.id,
                isHost: true,
                assignedColor: player.color,  // Send the assigned color
                selectedMap: room.selectedMap  // Add selected map to joined room data
            });

            // Send selected map
            socket.emit('mapSelected', {
                mapId: room.selectedMap
            });

            broadcastPlayersList(room);
        }
    });

    // Nouveau handler pour rejoindre avec un code
    socket.on('joinRoomWithCode', (data) => {
        const { pseudo, roomCode } = data;
        
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
        
        // Check if player is banned from this room
        if (room.isPlayerBanned(socket.id)) {
            socket.emit('error', { message: 'You have been banned from this room (kicked 3 times)' });
            return;
        }
        
        // Get available color for the player
        const availableColor = room.getAvailableColor();
        
        // Créer le joueur avec la couleur disponible
        const player = new Player(socket.id, pseudo, availableColor);
        gameState.players.set(socket.id, player);
        
        // Ajouter le joueur à la room
        if (room.addPlayer(player)) {
            socket.join(room.id);
            
            socket.emit('joinedRoom', {
                roomId: room.id,
                playerId: player.id,
                isPrivate: room.isPrivate,
                roomCode: room.id,
                isHost: false,
                assignedColor: player.color,  // Send the assigned color
                selectedMap: room.selectedMap  // Add selected map to joined room data
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
        
        // Si random est sélectionné, choisir une map maintenant
        let mapToLoad = room.selectedMap;
        if (room.selectedMap === 'random') {
            if (availableMaps.length > 0) {
                const randomIndex = Math.floor(Math.random() * availableMaps.length);
                mapToLoad = availableMaps[randomIndex];
                room.actualMapId = mapToLoad; // Stocker la map réellement chargée
            } else {
                mapToLoad = 'beach'; // Fallback
                room.actualMapId = 'beach';
            }
        } else {
            room.actualMapId = room.selectedMap;
        }
        
        // Charger la map et envoyer à tous les joueurs
        if (loadMapData(mapToLoad)) {
            // Inclure l'ID de la map réellement chargée dans les données
            const mapDataWithId = {
                ...trackData,
                mapId: mapToLoad
            };
            io.to(room.id).emit('mapData', mapDataWithId);
        }
        
        // Démarrer la partie
        if (room.startGame()) {
            // Envoyer l'ID de la map avec l'événement gameStarted
            io.to(room.id).emit('gameStarted', { mapId: mapToLoad });
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
        
        // Si c'est random, on garde "random" sélectionné
        if (data.mapId === 'random') {
            room.selectedMap = 'random';
        } else {
            // Vérifier que la map existe
            if (!availableMaps.includes(data.mapId) && data.mapId !== 'lava_track') {
                return;
            }
            room.selectedMap = data.mapId;
        }
        
        // Notifier tous les joueurs de la room
        io.to(room.id).emit('mapSelected', {
            mapId: room.selectedMap
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
            
            // Handle drift input
            if (input.shift && !player.isDrifting && player.speed > GAME_CONFIG.MAX_SPEED * 0.3) {
                // Start drift based on current turn direction
                if (player.inputs.left && !player.inputs.right) {
                    player.startDrift(-1);
                } else if (player.inputs.right && !player.inputs.left) {
                    player.startDrift(1);
                }
            } else if (!input.shift && player.isDrifting) {
                // End drift when shift is released
                player.endDrift();
            }
            
            // Traiter l'item séparément
            if (input.space && player.item) {
                room.useItem(player);
            }
        }
    });

    socket.on('kickPlayer', (data) => {
        const { playerId } = data;
        const room = findPlayerRoom(socket.id);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        const result = room.kickPlayer(socket.id, playerId);
        
        if (result.success) {
            // Notify the kicked player
            io.to(playerId).emit('kickedFromRoom', {
                message: `You have been kicked by the host`,
                kickCount: result.kickCount,
                isBanned: result.isBanned
            });
            
            // Force disconnect the kicked player's socket from the room
            const kickedSocket = io.sockets.sockets.get(playerId);
            if (kickedSocket) {
                kickedSocket.leave(room.id);
            }
            
            // Notify all other players
            socket.to(room.id).emit('playerKicked', {
                playerId: playerId,
                playerName: result.playerName,
                message: `${result.playerName} has been kicked from the room`
            });
            
            // Update player list for everyone
            broadcastPlayersList(room);
            
            // Show success message to host
            socket.emit('kickSuccess', {
                playerName: result.playerName,
                message: result.isBanned ? 
                    `${result.playerName} has been kicked and banned (3 kicks)` : 
                    `${result.playerName} has been kicked (${result.kickCount}/3 kicks)`
            });
        } else {
            socket.emit('error', { message: result.message });
        }
    });

    socket.on('chatMessage', (data) => {
        const { message } = data;
        const player = gameState.players.get(socket.id);
        const room = findPlayerRoom(socket.id);
        
        if (!player || !room || !message) return;
        
        // Sanitize message (basic protection)
        const sanitizedMessage = message.trim().substring(0, 100);
        
        if (sanitizedMessage.length === 0) return;
        
        // Broadcast message to all players in the room
        io.to(room.id).emit('chatMessage', {
            playerId: player.id,
            playerName: player.pseudo,
            playerColor: player.color,
            message: sanitizedMessage,
            timestamp: Date.now()
        });
        
    });

    socket.on('disconnect', () => {
        
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
    
    // Get list of used colors
    const usedColors = new Set();
    room.players.forEach(player => {
        usedColors.add(player.color);
    });
    
    io.to(room.id).emit('playersUpdate', {
        players: playersList,
        canStart: room.canHostStart(), // Utiliser la nouvelle méthode
        hostId: room.host,
        usedColors: Array.from(usedColors)
    });
}

// Route pour obtenir la liste des maps disponibles
app.get('/api/maps', (_, res) => {
    const maps = availableMaps.map(mapId => {
        // Pour chaque map, essayer de charger ses infos
        try {
            const mapPath = path.join(__dirname, '../maps', `${mapId}.json`);
            const data = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
            return {
                id: mapId,
                name: data.name || mapId,
                thumbnail: data.background
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
app.get('/', (_, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Démarrage du serveur
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🏁 Serveur KartRush.io démarré sur le port ${PORT}`);
    console.log(`🌐 Accès: http://localhost:${PORT}`);
});