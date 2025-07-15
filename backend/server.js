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
                this.radius = 57.5;  // Increased by 15% (was 50)
                this.damage = 50;
                break;
                
            case 'rocket':
                // Position devant le kart
                this.x += Math.cos(owner.angle) * 30;
                this.y += Math.sin(owner.angle) * 30;
                this.speed = 8; // Rapide
                this.lifetime = 3500; // 3.5 secondes max
                this.radius = 20;
                this.damage = 75;
                // Racing line following properties
                this.followingRacingLine = true;
                this.racingLineSegment = -1;
                this.racingLineProgress = 0;
                this.targetAcquired = false;
                this.minDistanceToTarget = 300; // Distance to start targeting
                this.initialLineOfSightCheck = false; // Will be checked in first update
                break;
        }
    }
    
    update(deltaTime, players, walls, racingLine = null) {
        if (!this.active) return;
        
        this.lifetime -= deltaTime * 1000;
        
        if (this.lifetime <= 0) {
            this.explode();
            return;
        }
        
        switch(this.type) {
            case 'rocket':
                this.updateRocket(deltaTime, players, walls, racingLine);
                break;
        }
    }
    
    updateRocket(_, players, walls, racingLine) {
        // Initial line of sight check - if we can see target immediately, don't use racing line
        if (!this.initialLineOfSightCheck && this.target && players.has(this.target)) {
            this.initialLineOfSightCheck = true;
            const target = players.get(this.target);
            if (!target.isDead) {
                const hasLineOfSight = !this.checkWallCollision(this.x, this.y, target.x, target.y, walls);
                if (hasLineOfSight) {
                    // Direct line of sight from start, no need for racing line
                    this.targetAcquired = true;
                    this.followingRacingLine = false;
                }
            }
        }
        
        // Check if we should acquire target during racing line following
        if (this.target && players.has(this.target) && !this.targetAcquired && this.followingRacingLine) {
            const target = players.get(this.target);
            if (!target.isDead) {
                const dx = target.x - this.x;
                const dy = target.y - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // Start targeting when close enough AND have line of sight
                if (distance < this.minDistanceToTarget) {
                    // Check line of sight to target
                    const hasLineOfSight = !this.checkWallCollision(this.x, this.y, target.x, target.y, walls);
                    
                    if (hasLineOfSight) {
                        this.targetAcquired = true;
                        this.followingRacingLine = false;
                    }
                }
            }
        }
        
        // Follow racing line or target
        if (this.followingRacingLine && racingLine && racingLine.points && racingLine.points.length > 2) {
            // Initialize racing line segment if needed
            if (this.racingLineSegment === -1) {
                // Find closest segment on racing line
                let closestSegment = 0;
                let closestDistance = Infinity;
                
                const numSegments = racingLine.closed ? racingLine.points.length : racingLine.points.length - 1;
                
                for (let i = 0; i < numSegments; i++) {
                    const p1 = racingLine.points[i];
                    const p2 = racingLine.points[(i + 1) % racingLine.points.length];
                    
                    const closest = getClosestPointOnSegment(
                        this.x, this.y, p1[0], p1[1], p2[0], p2[1]
                    );
                    
                    const dist = distanceXY(this.x, this.y, closest.x, closest.y);
                    if (dist < closestDistance) {
                        closestDistance = dist;
                        closestSegment = i;
                        this.racingLineProgress = closest.t;
                    }
                }
                
                this.racingLineSegment = closestSegment;
            }
            
            // Calculate target point ahead on racing line
            const lookAheadDistance = 100; // pixels ahead
            let remainingDistance = lookAheadDistance;
            let currentSegment = this.racingLineSegment;
            let segmentProgress = this.racingLineProgress;
            
            // Move along racing line to find target point
            while (remainingDistance > 0 && racingLine.points.length > 0) {
                const p1 = racingLine.points[currentSegment];
                const p2 = racingLine.points[(currentSegment + 1) % racingLine.points.length];
                
                const segmentLength = distanceXY(p1[0], p1[1], p2[0], p2[1]);
                const remainingSegmentLength = segmentLength * (1 - segmentProgress);
                
                if (remainingDistance <= remainingSegmentLength) {
                    // Target point is on current segment
                    const t = segmentProgress + (remainingDistance / segmentLength);
                    const targetX = p1[0] + t * (p2[0] - p1[0]);
                    const targetY = p1[1] + t * (p2[1] - p1[1]);
                    
                    // Turn towards target point
                    const targetAngle = Math.atan2(targetY - this.y, targetX - this.x);
                    let angleDiff = targetAngle - this.angle;
                    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                    
                    this.angle += angleDiff * 0.15; // Smooth turning
                    break;
                } else {
                    // Move to next segment
                    remainingDistance -= remainingSegmentLength;
                    currentSegment = (currentSegment + 1) % racingLine.points.length;
                    segmentProgress = 0;
                }
            }
            
            // Update rocket's position on racing line
            const moveDistance = this.speed;
            let distanceMoved = 0;
            
            while (distanceMoved < moveDistance) {
                const p1 = racingLine.points[this.racingLineSegment];
                const p2 = racingLine.points[(this.racingLineSegment + 1) % racingLine.points.length];
                
                const segmentLength = distanceXY(p1[0], p1[1], p2[0], p2[1]);
                const remainingSegmentLength = segmentLength * (1 - this.racingLineProgress);
                const moveInSegment = Math.min(moveDistance - distanceMoved, remainingSegmentLength);
                
                this.racingLineProgress += moveInSegment / segmentLength;
                distanceMoved += moveInSegment;
                
                if (this.racingLineProgress >= 1) {
                    this.racingLineSegment = (this.racingLineSegment + 1) % racingLine.points.length;
                    this.racingLineProgress = 0;
                }
            }
            
            // No distance limit - rocket follows racing line until timeout or target acquisition
            
        } else if (this.targetAcquired && this.target && players.has(this.target)) {
            // Original targeting logic with continuous line of sight check
            const target = players.get(this.target);
            if (!target.isDead) {
                // Check if we still have line of sight
                const hasLineOfSight = !this.checkWallCollision(this.x, this.y, target.x, target.y, walls);
                
                if (!hasLineOfSight) {
                    // Lost line of sight, go back to racing line following if possible
                    if (racingLine && racingLine.points && racingLine.points.length > 2) {
                        this.targetAcquired = false;
                        this.followingRacingLine = true;
                        this.racingLineSegment = -1; // Reinitialize to find closest segment
                    }
                } else {
                    // We have line of sight, continue targeting
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

class IceBeam {
    constructor(owner) {
        this.id = uuidv4();
        this.owner = owner;
        // Start the beam in front of the kart
        this.startX = owner.x + Math.cos(owner.angle) * 5;
        this.startY = owner.y + Math.sin(owner.angle) * 5;
        this.angle = owner.angle;
        this.length = 0;
        this.maxLength = 5000; // Maximum beam length (effectively infinite)
        this.growthSpeed = 25; // Pixels per frame (faster growth)
        this.active = true;
        this.lifetime = 800; // 0.8 seconds
        this.createdAt = Date.now();
        this.hitPlayers = new Set(); // Track who we've already hit
        this.endX = this.startX;
        this.endY = this.startY;
        this.hitWall = false; // Track if we've hit a wall
    }
    
    update(deltaTime, players, walls, gracePeriodEndTime = null) {
        const elapsed = Date.now() - this.createdAt;
        
        // Check if beam has expired
        if (elapsed >= this.lifetime) {
            this.active = false;
            return;
        }
        
        // Grow the beam only if we haven't hit a wall
        if (this.length < this.maxLength && !this.hitWall) {
            const growthAmount = this.growthSpeed * deltaTime * 60;
            const newLength = Math.min(this.length + growthAmount, this.maxLength);
            
            // Calculate new beam end point
            const newEndX = this.startX + Math.cos(this.angle) * newLength;
            const newEndY = this.startY + Math.sin(this.angle) * newLength;
            
            // Check for wall collision along the beam path
            const wallHit = this.checkWallCollision(this.startX, this.startY, newEndX, newEndY, walls);
            if (wallHit) {
                // Stop at wall and mark as hit
                this.length = wallHit.distance;
                this.endX = wallHit.x;
                this.endY = wallHit.y;
                this.hitWall = true;
            } else {
                // No wall hit, continue growing
                this.length = newLength;
                this.endX = newEndX;
                this.endY = newEndY;
            }
        }
        
        // Check for player collisions along the beam
        for (const [playerId, player] of players) {
            if (playerId === this.owner.id) continue; // Skip owner
            if (player.isDead) continue; // Skip dead players
            if (this.hitPlayers.has(playerId)) continue; // Already hit
            
            // Check if player intersects with beam line
            if (this.checkPlayerCollision(player)) {
                this.hitPlayers.add(playerId);
                
                // Check if shield blocks freeze
                if (player.hasShield) {
                    player.hasShield = false;
                    // Need to store that we blocked this for the game loop to emit the event
                    this.shieldBlockedPlayers = this.shieldBlockedPlayers || new Set();
                    this.shieldBlockedPlayers.add(playerId);
                } else {
                    // Check grace period before applying freeze
                    if (!gracePeriodEndTime || Date.now() >= gracePeriodEndTime) {
                        // Apply frozen effect
                        player.isFrozen = true;
                        player.frozenUntil = Date.now() + 3000; // 3 seconds
                        player.frozenVelocity = {
                            x: Math.cos(player.angle) * player.speed,
                            y: Math.sin(player.angle) * player.speed
                        };
                    }
                }
            }
        }
    }
    
    checkWallCollision(x1, y1, x2, y2, walls) {
        if (!walls || walls.length === 0) return null;
        
        let closestHit = null;
        let minDistance = Infinity;
        
        for (const wall of walls) {
            const hit = this.lineSegmentIntersection(x1, y1, x2, y2, wall.x1, wall.y1, wall.x2, wall.y2);
            if (hit) {
                const distance = Math.sqrt((hit.x - x1) ** 2 + (hit.y - y1) ** 2);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestHit = { x: hit.x, y: hit.y, distance: distance };
                }
            }
        }
        
        return closestHit;
    }
    
    checkPlayerCollision(player) {
        // Calculate distance from player center to beam line
        const dist = this.pointToLineDistance(player.x, player.y, this.startX, this.startY, this.endX, this.endY);
        return dist < 40; // Increased hit radius from 30 to 40
    }
    
    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) {
            param = dot / lenSq;
        }
        
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
    
    lineSegmentIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 0.0001) return null;
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return {
                x: x1 + t * (x2 - x1),
                y: y1 + t * (y2 - y1)
            };
        }
        
        return null;
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
        this.vx = 0; // Velocity components for physics
        this.vy = 0;
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
        
        // Falling state for void zones
        this.isFalling = false;
        this.fallStartTime = 0;
        this.fallVelocityX = 0;
        this.fallVelocityY = 0;
        this.canControl = true;
        
        // Side force effect
        this.sideForcePushed = false;
        this.sideForcePushTime = 0;
        
        // Lightning speed reduction
        this.speedReductionFactor = 1.0;
        this.speedReductionEndTime = 0;
        
        // Rotor shield
        this.hasShield = false;
        this.shieldActivatedTime = 0;
        
        // Ice beam frozen state
        this.isFrozen = false;
        this.frozenUntil = 0;
        this.frozenVelocity = { x: 0, y: 0 };
        this.frozenEventSent = false;
        
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
        this.lastCounterSteerTime = 0; // Cooldown for counter-steer
        
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
    takeDamage(amount, damageType = 'unknown', gracePeriodEndTime = null) {
        // Check grace period at start of race
        if (gracePeriodEndTime && Date.now() < gracePeriodEndTime) {
            return false; // No damage during grace period
        }
        
        if (this.invulnerableTime > Date.now() || this.isDead || this.isSuperBoosting) return false;
        
        // Check if shield should block this damage
        if (this.hasShield && damageType !== 'player_collision' && damageType !== 'crash' && damageType !== 'scrape') {
            // Shield blocks the damage
            this.hasShield = false;
            return 'shield_blocked';
        }
        
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
    
    // Point-in-polygon algorithm for void zone detection
    isPointInPolygon(x, y, points) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i][0], yi = points[i][1];
            const xj = points[j][0], yj = points[j][1];
            
            const intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
    
    // Check collision with void zones
    checkVoidZoneCollision(voidZones) {
        if (!voidZones || this.isDead) return false;
        
        const kartRadius = 14; // Approximate kart radius
        const checkPoints = [
            {x: this.x, y: this.y}, // Center
            {x: this.x + kartRadius * 0.7, y: this.y}, // Right
            {x: this.x - kartRadius * 0.7, y: this.y}, // Left
            {x: this.x, y: this.y + kartRadius * 0.7}, // Bottom
            {x: this.x, y: this.y - kartRadius * 0.7}, // Top
            {x: this.x + kartRadius * 0.5, y: this.y + kartRadius * 0.5}, // Bottom-right
            {x: this.x - kartRadius * 0.5, y: this.y + kartRadius * 0.5}, // Bottom-left
            {x: this.x + kartRadius * 0.5, y: this.y - kartRadius * 0.5}, // Top-right
            {x: this.x - kartRadius * 0.5, y: this.y - kartRadius * 0.5}  // Top-left
        ];
        
        for (const zone of voidZones) {
            if (zone.closed) {
                let pointsInside = 0;
                for (const point of checkPoints) {
                    if (this.isPointInPolygon(point.x, point.y, zone.points)) {
                        pointsInside++;
                    }
                }
                // Require at least 75% of check points (7 out of 9) to be inside
                if (pointsInside >= 7) {
                    return zone;
                }
            }
        }
        return null;
    }
    
    // Méthode pour mourir
    die(respawnDelay = 3000) {
        this.isDead = true;
        this.speed = 0;
        this.respawnTime = Date.now() + respawnDelay; // Respawn après le délai spécifié
        this.item = null; // Perdre l'objet en mourant
        this.isStunned = false;
        this.isSuperBoosting = false;
        this.hasShield = false; // Clear shield on death
        this.isBoosting = false; // Clear regular boost
        this.boostEndTime = 0;
        this.boostLevel = 0;
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
        this.isFrozen = false;
        this.frozenUntil = 0;
        this.frozenVelocity = { x: 0, y: 0 };
        this.frozenEventSent = false;
        
        // Reset drift state
        this.isDrifting = false;
        this.driftChargeLevel = 0;
        this.driftAngle = 0;
    }
    
    stun(duration, fromItemEffect = true, gracePeriodEndTime = null) {
        // Check grace period at start of race
        if (gracePeriodEndTime && Date.now() < gracePeriodEndTime) {
            return false; // No stun during grace period
        }
        
        if (this.isSuperBoosting || this.invulnerableTime > Date.now()) return;
        
        // Check if shield blocks stun from item effects
        if (this.hasShield && fromItemEffect) {
            this.hasShield = false;
            return 'shield_blocked';
        }
        
        this.isStunned = true;
        this.stunnedUntil = Date.now() + duration;
        this.speed = 0;
        return 'stunned';
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
        
        // Detect start of counter-steer for jump effect with cooldown
        const now = Date.now();
        const counterSteerCooldown = 500; // 500ms cooldown to prevent spamming
        
        if (isCounterSteering && !this.wasCounterSteering) {
            // Only allow counter-steer jump if cooldown has passed
            if (now - this.lastCounterSteerTime >= counterSteerCooldown) {
                this.counterSteerJump = 1.035; // Middle value between 1.0 and 1.5
                this.lastCounterSteerTime = now;
            }
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
            } else if (this.inputs.right) {
                this.driftRotation += rotationSpeed * deltaTime;
            } else {
                // No input - continue drifting in the initial direction (Mario Kart style)
                // Use a slower rotation speed for the automatic drift
                const autoDriftSpeed = rotationSpeed * 0.35; // 35% of normal rotation speed - gentle curve
                this.driftRotation += this.driftDirection * autoDriftSpeed * deltaTime;
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

    update(deltaTime, gracePeriodEndTime = null) {
        // Si mort, ne pas update
        if (this.isDead) return;
        
        // Variable to track if poison damage occurred
        let poisonDamageResult = null;
        
        // Global constant for fall duration
        const FALL_DURATION = 1500; // 1.5 seconds - same for all void zones
        
        // Handle falling state
        if (this.isFalling) {
            const now = Date.now();
            const elapsed = now - this.fallStartTime;
            
            // Continue drifting based on initial velocity
            // Scale drift with speed - faster karts fly much farther
            const velocity = Math.sqrt(this.fallVelocityX * this.fallVelocityX + this.fallVelocityY * this.fallVelocityY);
            const driftMultiplier = 3 + (velocity / GAME_CONFIG.MAX_SPEED) * 7; // 3-10x based on speed
            this.x += this.fallVelocityX * deltaTime * driftMultiplier;
            this.y += this.fallVelocityY * deltaTime * driftMultiplier;
            
            if (elapsed >= FALL_DURATION) {
                // Instant death - no damage calculation
                this.hp = 0;
                this.isFalling = false;
                this.canControl = true;
                // Shorter respawn time for falling deaths to compensate for falling animation
                this.die(2000);
            }
            
            return poisonDamageResult; // Skip normal update while falling
        }
        
        // Gérer le stun
        if (this.isStunned) {
            if (Date.now() > this.stunnedUntil) {
                this.isStunned = false;
            } else {
                this.speed *= 0.9; // Ralentir progressivement
                return; // Ne pas traiter les inputs
            }
        }
        
        // Gérer l'état frozen (ice beam)
        if (this.isFrozen) {
            if (Date.now() > this.frozenUntil) {
                this.isFrozen = false;
                this.frozenEventSent = false;
                this.frozenVelocity = { x: 0, y: 0 };
            } else {
                // Continue sliding in the frozen direction
                this.x += this.frozenVelocity.x * deltaTime;
                this.y += this.frozenVelocity.y * deltaTime;
                return poisonDamageResult; // Ne pas traiter les inputs, mais retourner les dégâts poison si présents
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
                    const result = this.takeDamage(5, 'poison', gracePeriodEndTime); // 5 damage every 500ms
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
        
        // Traiter les inputs (only if player can control)
        if (this.canControl) {
            if (this.inputs.up) this.accelerate();
            if (this.inputs.down) this.brake();
            if (this.inputs.left) this.turnLeft();
            if (this.inputs.right) this.turnRight();
        }
        
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
        
        // Apply any external velocity (from side force, etc)
        if (this.vx !== 0 || this.vy !== 0) {
            this.x += this.vx * deltaTime;
            this.y += this.vy * deltaTime;
            
            // Apply friction to external velocity
            const friction = 0.98; // Much less friction for stronger push
            this.vx *= friction;
            this.vy *= friction;
            
            // Reset very small velocities
            if (Math.abs(this.vx) < 1) this.vx = 0;
            if (Math.abs(this.vy) < 1) this.vy = 0;
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
        this.gracePeriodEndTime = null; // No damage until this time
        
        // NOUVEAU : Système d'objets
        this.itemBoxes = [];
        this.projectiles = new Map();
        this.poisonSlicks = new Map();
        this.iceBeams = new Map();
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
        this.iceBeams.clear();
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
            // Grace period ends 2 seconds after "GO!"
            this.gracePeriodEndTime = Date.now() + 2000;
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
                    const poisonDamageResult = player.update(deltaTime, this.gracePeriodEndTime);
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
                    
                    // Check void zone collisions
                    this.checkVoidZoneCollisions(player);
                    
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
            projectile.update(deltaTime, this.players, trackData.continuousCurves, trackData.racingLine);
            
            if (!projectile.active) {
                // Explosion !
                this.handleProjectileExplosion(projectile);
                this.projectiles.delete(id);
            }
        }
        
        // Mettre à jour les ice beams
        for (const [id, beam] of this.iceBeams) {
            beam.update(deltaTime, this.players, trackData.continuousCurves, this.gracePeriodEndTime);
            
            if (!beam.active) {
                this.iceBeams.delete(id);
                io.to(this.id).emit('iceBeamRemoved', { id: id });
            } else {
                // Emit updates for beam growth
                io.to(this.id).emit('iceBeamUpdate', {
                    id: beam.id,
                    length: beam.length,
                    endX: beam.endX,
                    endY: beam.endY
                });
                
                // Check for shield blocks
                if (beam.shieldBlockedPlayers) {
                    for (const playerId of beam.shieldBlockedPlayers) {
                        io.to(this.id).emit('shieldBlocked', {
                            playerId: playerId,
                            blockedType: 'icebeam',
                            position: { x: this.players.get(playerId).x, y: this.players.get(playerId).y }
                        });
                    }
                    beam.shieldBlockedPlayers.clear();
                }
                
                // Emit frozen events for newly frozen players
                for (const playerId of beam.hitPlayers) {
                    const player = this.players.get(playerId);
                    if (player && player.isFrozen && !player.frozenEventSent) {
                        player.frozenEventSent = true;
                        io.to(this.id).emit('playerFrozen', {
                            playerId: playerId,
                            x: player.x,
                            y: player.y
                        });
                    }
                }
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
                            
                            // Check if shield blocks poison
                            if (player.hasShield) {
                                player.hasShield = false;
                                io.to(this.id).emit('shieldBlocked', {
                                    playerId: playerId,
                                    blockedType: 'poison',
                                    position: { x: player.x, y: player.y }
                                });
                            } else {
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
                    this.calculateTrackProgress(player, trackData.racingLine);
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
                const poisonDamageResult = player.update(deltaTime, this.gracePeriodEndTime);
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
                this.checkVoidZoneCollisions(player);
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
                
                // Déterminer l'objet aléatoire basé sur la position
                const rand = Math.random();
                let itemType;
                
                // Get player's position and total number of active players
                const playerPosition = player.position;
                const activePlayers = Array.from(this.players.values()).filter(p => !p.isDead && !p.finished).length;
                
                // Position-based item distribution
                if (playerPosition === activePlayers && activePlayers >= 3) {
                    // Last place (6/6) - can get superboost
                    if (rand < 0.30) {
                        itemType = 'bomb';  // 30%
                    } else if (rand < 0.50) {
                        itemType = 'poisonslick';  // 20%
                    } else if (rand < 0.65) {
                        itemType = 'rocket';  // 15%
                    } else if (rand < 0.75) {
                        itemType = 'healthpack';  // 10%
                    } else if (rand < 0.82) {
                        itemType = 'sideforce';  // 7%
                    } else if (rand < 0.88) {
                        itemType = 'icebeam';  // 6%
                    } else if (rand < 0.93) {
                        itemType = 'rotorshield';  // 5%
                    } else if (rand < 0.97) {
                        itemType = 'lightning';  // 4%
                    } else {
                        itemType = 'superboost';  // 3% - VERY RARE
                    }
                } else if ((playerPosition === activePlayers || playerPosition === activePlayers - 1) && activePlayers >= 4) {
                    // 5th or 6th place (5-6/6) - can get lightning
                    if (rand < 0.30) {
                        itemType = 'bomb';  // 30%
                    } else if (rand < 0.50) {
                        itemType = 'poisonslick';  // 20%
                    } else if (rand < 0.65) {
                        itemType = 'rocket';  // 15%
                    } else if (rand < 0.75) {
                        itemType = 'healthpack';  // 10%
                    } else if (rand < 0.83) {
                        itemType = 'sideforce';  // 8%
                    } else if (rand < 0.90) {
                        itemType = 'icebeam';  // 7%
                    } else if (rand < 0.95) {
                        itemType = 'rotorshield';  // 5%
                    } else {
                        itemType = 'lightning';  // 5%
                    }
                } else {
                    // Everyone else (1st-4th place or when not enough players)
                    if (rand < 0.35) {
                        itemType = 'bomb';  // 35% - MOST COMMON
                    } else if (rand < 0.65) {
                        itemType = 'poisonslick';  // 30% - MOST COMMON
                    } else if (rand < 0.80) {
                        itemType = 'rocket';  // 15% - 2ND MOST COMMON
                    } else if (rand < 0.90) {
                        itemType = 'healthpack';  // 10% - 2ND MOST COMMON
                    } else if (rand < 0.94) {
                        itemType = 'sideforce';  // 4% - LESS COMMON
                    } else if (rand < 0.97) {
                        itemType = 'icebeam';  // 3% - LESS COMMON
                    } else {
                        itemType = 'rotorshield';  // 3% - LESS COMMON
                    }
                    // NO LIGHTNING OR SUPERBOOST for top positions
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
    
    // Check void zone collisions and handle falling
    checkVoidZoneCollisions(player) {
        if (!trackData || !trackData.voidZones || player.isFalling) return;
        
        const voidZone = player.checkVoidZoneCollision(trackData.voidZones);
        if (voidZone && !player.isDead) {
            const now = Date.now();
            player.isFalling = true;
            player.fallStartTime = now;
            
            // Store velocity at moment of falling (for drift effect)
            player.fallVelocityX = Math.cos(player.angle) * player.speed;
            player.fallVelocityY = Math.sin(player.angle) * player.speed;
            
            // Stop player movement immediately
            player.speed = 0;
            player.canControl = false;
            
            // Emit falling event with velocity data
            io.to(this.id).emit('playerFalling', {
                playerId: player.id,
                position: { x: player.x, y: player.y },
                velocityX: player.fallVelocityX,
                velocityY: player.fallVelocityY
            });
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
                
            case 'icebeam':
                this.useIceBeam(player);
                break;
                
            case 'sideforce':
                this.useSideForce(player);
                break;
                
            case 'rotorshield':
                this.useRotorShield(player);
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
                // Check if shield blocks lightning
                if (targetPlayer.hasShield) {
                    targetPlayer.hasShield = false;
                    io.to(this.id).emit('shieldBlocked', {
                        playerId: targetPlayer.id,
                        blockedType: 'lightning',
                        position: { x: targetPlayer.x, y: targetPlayer.y }
                    });
                } else {
                    // Check grace period before applying effects
                    if (!this.gracePeriodEndTime || Date.now() >= this.gracePeriodEndTime) {
                        // Apply stun effect (1 second)
                        targetPlayer.isStunned = true;
                        targetPlayer.stunnedUntil = Date.now() + 1000;
                        
                        // Apply speed reduction (50% for 7 seconds)
                        targetPlayer.speedReductionFactor = 0.5;
                        targetPlayer.speedReductionEndTime = Date.now() + 7000;
                    }
                }
                
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
    
    useIceBeam(player) {
        const beam = new IceBeam(player);
        this.iceBeams = this.iceBeams || new Map();
        this.iceBeams.set(beam.id, beam);
        
        // Emit ice beam creation event
        io.to(this.id).emit('iceBeamFired', {
            id: beam.id,
            ownerId: player.id,
            startX: beam.startX,
            startY: beam.startY,
            angle: beam.angle
        });
    }
    
    useSideForce(player) {
        const affectedPlayers = [];
        const SIDE_DETECTION_ANGLE = Math.PI / 6; // 30 degrees cone on each side
        const SIDE_DETECTION_RANGE = 250; // Detection range increased
        const PUSH_FORCE = 500; // MUCH stronger lateral force
        
        for (const [id, otherPlayer] of this.players) {
            if (id === player.id || otherPlayer.isDead || otherPlayer.finished) continue;
            
            // Calculate relative position
            const dx = otherPlayer.x - player.x;
            const dy = otherPlayer.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > SIDE_DETECTION_RANGE) continue;
            
            // Calculate angle relative to player's facing direction
            const angleToOther = Math.atan2(dy, dx);
            let angleDiff = angleToOther - player.angle;
            
            // Normalize angle difference to [-PI, PI]
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // Check if player is on the left side (around -90 degrees)
            const isLeftSide = Math.abs(angleDiff + Math.PI/2) < SIDE_DETECTION_ANGLE;
            // Check if player is on the right side (around +90 degrees)
            const isRightSide = Math.abs(angleDiff - Math.PI/2) < SIDE_DETECTION_ANGLE;
            
            if (isLeftSide || isRightSide) {
                // Check if shield blocks push
                if (otherPlayer.hasShield) {
                    otherPlayer.hasShield = false;
                    io.to(this.id).emit('shieldBlocked', {
                        playerId: otherPlayer.id,
                        blockedType: 'sideforce',
                        position: { x: otherPlayer.x, y: otherPlayer.y }
                    });
                } else {
                    // Check grace period before applying push
                    if (!this.gracePeriodEndTime || Date.now() >= this.gracePeriodEndTime) {
                        // Calculate push direction (perpendicular to player's facing direction)
                        const pushAngle = isLeftSide ? player.angle - Math.PI/2 : player.angle + Math.PI/2;
                        
                        // Apply the push force
                        otherPlayer.vx = Math.cos(pushAngle) * PUSH_FORCE; // Set velocity directly instead of adding
                        otherPlayer.vy = Math.sin(pushAngle) * PUSH_FORCE;
                        
                        // Also apply immediate position change for instant effect
                        const instantPush = 20; // Immediate push distance
                        otherPlayer.x += Math.cos(pushAngle) * instantPush;
                        otherPlayer.y += Math.sin(pushAngle) * instantPush;
                        
                        // Mark player as being pushed for wall collision detection
                        otherPlayer.sideForcePushed = true;
                        otherPlayer.sideForcePushTime = Date.now();
                        
                        // NO STUN during push - only stun if they hit a wall
                        
                        affectedPlayers.push({
                            playerId: id,
                            pushDirection: isLeftSide ? 'left' : 'right',
                            pushAngle: pushAngle
                        });
                    }
                }
            }
        }
        
        // Emit side force event
        io.to(this.id).emit('sideForceUsed', {
            casterId: player.id,
            casterX: player.x,
            casterY: player.y,
            casterAngle: player.angle,
            affectedPlayers: affectedPlayers
        });
    }
    
    useRotorShield(player) {
        // Activate the shield
        player.hasShield = true;
        player.shieldActivatedTime = Date.now();
        
        // Emit shield activation event
        io.to(this.id).emit('shieldActivated', {
            playerId: player.id
        });
    }
    
    // Gérer l'explosion d'un projectile
    handleProjectileExplosion(projectile) {
        // Track if the explosion should be shown (at least one player was affected)
        let showExplosion = true;
        let playersInRadius = 0;
        let shieldsBlocked = 0;
        
        // Vérifier les joueurs dans le rayon
        for (const [_, player] of this.players) {
            if (player.isDead) continue;
            
            const dx = player.x - projectile.x;
            const dy = player.y - projectile.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < projectile.radius) {
                playersInRadius++;
                
                // Infliger les dégâts
                const result = player.takeDamage(projectile.damage, projectile.type, this.gracePeriodEndTime);
                
                if (result === 'shield_blocked') {
                    shieldsBlocked++;
                    // Shield blocked the damage
                    io.to(this.id).emit('shieldBlocked', {
                        playerId: player.id,
                        blockedType: projectile.type,
                        position: { x: player.x, y: player.y }
                    });
                } else {
                    // Stun si pas mort et pas bloqué par le shield
                    if (result !== 'death') {
                        const stunDuration = projectile.type === 'bomb' ? 2000 : 3000;
                        const stunResult = player.stun(stunDuration, true, this.gracePeriodEndTime);
                        if (stunResult === 'shield_blocked') {
                            // Shield blocked the stun effect
                            io.to(this.id).emit('shieldBlocked', {
                                playerId: player.id,
                                blockedType: 'stun',
                                position: { x: player.x, y: player.y }
                            });
                        }
                    }
                    
                    // Envoyer l'événement de dégâts
                    io.to(this.id).emit('projectileHit', {
                        projectileId: projectile.id,
                        projectileType: projectile.type,
                        playerId: player.id,
                        damage: result === 'shield_blocked' ? 0 : projectile.damage,
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
        }
        
        // Only show explosion if no players were in radius OR at least one player was actually hit
        if (playersInRadius > 0 && playersInRadius === shieldsBlocked) {
            showExplosion = false;
        }
        
        // Envoyer l'événement d'explosion only if it should be shown
        if (showExplosion) {
            io.to(this.id).emit('projectileExploded', {
                id: projectile.id,
                type: projectile.type,
                x: projectile.x,
                y: projectile.y,
                radius: projectile.radius
            });
        }
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
                    // The racing line direction detection now handles wrong way flags
                    
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
                    // The racing line direction detection now handles isGoingBackwards flag
                    // We only need to handle the special wrongWayCrossing case for finish line
                    
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

    calculateTrackProgress(player, racingLine) {
        if (!racingLine || !racingLine.points || racingLine.points.length < 2) return;
        
        // Find the closest segment of the racing line
        let closestSegment = -1;
        let closestDistance = Infinity;
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
                closestT = closest.t;
            }
        }
        
        if (closestSegment === -1) return;
        
        // NEW: Direction-based wrong way detection
        // This system detects wrong way driving by comparing the player's facing direction
        // with the racing line direction at their current position.
        // Much more responsive than the old progress-based system!
        
        // Calculate the direction of the current racing line segment
        const p1 = racingLine.points[closestSegment];
        const p2 = racingLine.points[(closestSegment + 1) % racingLine.points.length];
        const segmentDir = {
            x: p2[0] - p1[0],
            y: p2[1] - p1[1]
        };
        
        // Normalize segment direction
        const segmentDirLength = Math.sqrt(segmentDir.x ** 2 + segmentDir.y ** 2);
        if (segmentDirLength > 0) {
            segmentDir.x /= segmentDirLength;
            segmentDir.y /= segmentDirLength;
        }
        
        // Calculate player's facing direction
        const playerDir = {
            x: Math.cos(player.angle),
            y: Math.sin(player.angle)
        };
        
        // Dot product: >0 = correct way, <0 = wrong way
        const dotProduct = segmentDir.x * playerDir.x + segmentDir.y * playerDir.y;
        
        // Track previous state
        const wasGoingBackwards = player.isGoingBackwards;
        
        // Consider wrong way if:
        // 1. Facing opposite direction (dot product < -0.1 to avoid flickering)
        // 2. Moving with some speed (to avoid false positives when stationary)
        // 3. Has started the race (optional: only after crossing start line)
        player.isGoingBackwards = dotProduct < -0.1 && player.speed > 0.5;
        
        // Handle wrong way state changes
        if (player.isGoingBackwards && !wasGoingBackwards) {
            // Just started going wrong way
            player.wrongDirectionStartTime = Date.now();
        } else if (!player.isGoingBackwards && wasGoingBackwards) {
            // Stopped going wrong way
            player.wrongDirectionStartTime = 0;
            
            // Clear the alert if it was active
            if (player.wrongDirectionAlertActive) {
                player.wrongDirectionAlertActive = false;
                io.to(player.id).emit('wrongDirectionAlert', { show: false });
            }
        }
        
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
        
        // The direction-based detection above handles wrong way detection now
        // We just need to update the track progress regardless of direction
        
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
                // Always calculate track progress to detect wrong way, even before crossing start line
                this.calculateTrackProgress(player, trackData.racingLine);
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
            
            const result1 = player1.takeDamage(damage, 'player_collision', this.gracePeriodEndTime);
            const result2 = player2.takeDamage(damage, 'player_collision', this.gracePeriodEndTime);
            
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

                    // Check if player was pushed by Side Force
                    if (player.sideForcePushed && Date.now() - player.sideForcePushTime < 1000) {
                        // Player was pushed by Side Force - instant 50 damage and stun
                        damage = 50;
                        damageType = 'sideforce_wall';
                        player.speed = 0; // Stop completely
                        player.vx = 0; // Clear any remaining push velocity
                        player.vy = 0;
                        player.sideForcePushed = false; // Reset the flag
                        
                        // Apply stun
                        player.stun(1500, false, this.gracePeriodEndTime); // 1.5 seconds stun
                        
                    } else if (dot < -0.1 && angleRatio > 0.7) {
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
                        const result = player.takeDamage(damage, damageType, this.gracePeriodEndTime);
                        
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
                isFrozen: p.isFrozen,
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
                // Falling state
                isFalling: p.isFalling,
                fallStartTime: p.fallStartTime,
                fallVelocityX: p.fallVelocityX,
                fallVelocityY: p.fallVelocityY,
                // Racing line tracking
                trackProgress: p.trackProgress,
                currentSegment: p.currentSegment,
                segmentProgress: p.segmentProgress,
                // Shield state
                hasShield: p.hasShield
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
                ownerId: p.owner.id,
                followingRacingLine: p.followingRacingLine || false,
                targetAcquired: p.targetAcquired || false
            })),
            poisonSlicks: Array.from(this.poisonSlicks.values()).filter(s => s.active).map(s => ({
                id: s.id,
                x: s.x,
                y: s.y,
                radius: s.radius,
                ownerId: s.ownerId
            })),
            iceBeams: Array.from(this.iceBeams.values()).filter(b => b.active).map(b => ({
                id: b.id,
                startX: b.startX,
                startY: b.startY,
                endX: b.endX,
                endY: b.endY,
                angle: b.angle,
                length: b.length,
                ownerId: b.owner.id
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