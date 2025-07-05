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
    } catch (error) {
        availableMaps = [];
    }
}

function loadMapData(mapName = 'lava_track') {
    try {
        const mapPath = path.join(__dirname, '../maps', `${mapName}.json`);
        
        if (!fs.existsSync(mapPath)) {
            return false;
        }
        
        const data = fs.readFileSync(mapPath, 'utf-8');
        trackData = JSON.parse(data);
        
        // Convertir les anciens rectangles en lignes si nécessaire
        convertRectsToLines(trackData);
        
        return true;
        
    } catch (error) {
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
    MAX_SPEED: 4,
    ACCELERATION: 0.2,
    FRICTION: 0.98,
    TURN_SPEED: 0.075,
    COLLISION_GRID_SIZE: 100
};

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
        this.isHost = false;
        
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
        
        // Gestion du boost
        this.isBoosting = false;
        this.boostEndTime = 0;
        this.lastBoosterIndex = -1;
        this.boostCooldown = 0;
        this.boostLevel = 0;
    }

    update(deltaTime) {
        // Sauvegarder la position précédente
        this.lastX = this.x;
        this.lastY = this.y;
        
        // Vérifier si le boost est terminé
        if (this.isBoosting && Date.now() > this.boostEndTime) {
            this.isBoosting = false;
            this.boostLevel = 0;
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
                case 1: speedMultiplier = 1.25; break;
                case 2: speedMultiplier = 1.50; break;
                case 3: speedMultiplier = 1.75; break;
                default: speedMultiplier = 1.25; break;
            }
        }
        
        const maxSpeed = GAME_CONFIG.MAX_SPEED * speedMultiplier;
        const acceleration = this.isBoosting ? GAME_CONFIG.ACCELERATION * 1.5 : GAME_CONFIG.ACCELERATION;
        
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
        this.host = null;
        this.players = new Map();
        this.gameStarted = false;
        this.gameStartTime = null;
        this.lastUpdate = Date.now();
        this.gameLoop = null;
        this.warningShown = false;
        this.raceSettings = null;
        this.mapName = 'lava_track';
        this.rematchVotes = new Set();
        this.rematchTimer = null;
        this.selectedMap = 'lava_track';
    }

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
            player.ready = true;
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
                newHostPlayer.ready = true;
            }
            
            // Notifier le nouveau hôte
            io.to(this.id).emit('hostChanged', { newHostId: newHost });
        }
    }

    canStart() {
        return this.players.size >= GAME_CONFIG.MIN_PLAYERS_TO_START && 
               !this.gameStarted;
    }

    resetForNewRace() {
        this.gameStarted = false;
        this.gameStartTime = null;
        this.warningShown = false;
        this.rematchVotes.clear();
        
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
            
            // Réinitialiser les inputs pour éviter le glissement
            player.inputs = {
                up: false,
                down: false,
                left: false,
                right: false
            };
            
            // Réinitialiser les états de boost
            player.isBoosting = false;
            player.boostEndTime = 0;
            player.lastBoosterIndex = -1;
            player.boostCooldown = 0;
            player.boostLevel = 0;
        }
    }

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
            // Annuler le timer de kick avant de démarrer le rematch
            if (this.rematchTimer) {
                clearTimeout(this.rematchTimer);
                this.rematchTimer = null;
            }
            this.startRematch();
        }
    }

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
        
        // Annuler le timer de rematch si une nouvelle partie démarre
        if (this.rematchTimer) {
            clearTimeout(this.rematchTimer);
            this.rematchTimer = null;
        }
        
        this.gameStarted = true;
        this.gameStartTime = null;
        
        // Charger la map sélectionnée
        loadMapData(this.selectedMap);
        
        this.raceSettings = trackData.raceSettings || {
            laps: 3,
            maxTime: 300000,
            maxTimeWarning: 240000
        };
        
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
            
            // Réinitialiser les états de boost
            player.isBoosting = false;
            player.boostEndTime = 0;
            player.lastBoosterIndex = -1;
            player.boostCooldown = 0;
            
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
                if (!player.finished) {
                    player.update(deltaTime);
                    player.raceTime = 0;
                    
                    // Collision avec murs
                    this.checkWallCollisions(player);
                    
                    // Vérifier les boosters même avant le démarrage
                    this.checkBoosterCollisions(player);
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
                    message: `Attention ! Plus que ${remainingTime} secondes !`
                });
            }
            
            if (raceTime >= this.raceSettings.maxTime) {
                this.forceEndRace();
                return;
            }
        }

        // Mettre à jour tous les joueurs + vérifier collision murs ET BOOSTERS
        for (let player of this.players.values()) {
            if (!player.finished) {
                player.update(deltaTime);
                player.raceTime = now - this.gameStartTime;

                // Collision avec murs
                this.checkWallCollisions(player);
                
                // Vérifier les boosters
                this.checkBoosterCollisions(player);
                
                // Vérifier les checkpoints et la ligne d'arrivée
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
        
        player.boostEndTime = Date.now() + 1500;
        player.boostCooldown = 500;
        
        // Donner une impulsion immédiate selon le niveau
        const impulse = 1 + (player.boostLevel * 0.5);
        player.speed = Math.min(player.speed + impulse, GAME_CONFIG.MAX_SPEED * (1 + player.boostLevel * 0.25));
        
        // Émettre l'événement avec le niveau de boost
        io.to(player.id).emit('boostActivated', { level: player.boostLevel });
    }

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
                    // Premier passage = début de la course
                    if (!player.hasPassedStartLine) {
                        player.hasPassedStartLine = true;
                        player.lap = 1;
                        player.nextCheckpoint = 0;
                        
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
        }, 3000);
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
    }
    
    checkWallCollisions(player) {
        const kx = player.x;
        const ky = player.y;
        const radius = GAME_CONFIG.KART_SIZE;
        const minDist = radius + 4;
        const minDistSq = minDist * minDist;

        // Stocker la position précédente pour le rollback
        const prevX = player.x;
        const prevY = player.y;

        for (const curve of trackData.continuousCurves || []) {
            const points = curve.points;
            const len = points.length;
            
            // Pour une courbe fermée, on connecte le dernier au premier
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
                    player.x += nx * (penetration + 2);
                    player.y += ny * (penetration + 2);

                    // Vecteur de vitesse du joueur
                    const vx = Math.cos(player.angle) * player.speed;
                    const vy = Math.sin(player.angle) * player.speed;
                    
                    // Produit scalaire pour déterminer l'angle d'impact
                    const dot = vx * nx + vy * ny;
                    
                    // Normaliser le vecteur du mur
                    const wallLength = Math.sqrt(dx * dx + dy * dy);
                    const wallDirX = dx / wallLength;
                    const wallDirY = dy / wallLength;
                    
                    // Angle entre la direction du joueur et le mur
                    const playerDirX = Math.cos(player.angle);
                    const playerDirY = Math.sin(player.angle);
                    const wallDot = Math.abs(playerDirX * wallDirX + playerDirY * wallDirY);

                    if (dot < -0.5 && wallDot < 0.5) {
                        // Collision frontale (angle > 60° avec le mur)
                        player.speed *= -0.2;
                        
                        // Rebond plus prononcé
                        player.x += nx * 8;
                        player.y += ny * 8;
                        
                        // Petite variation aléatoire de l'angle pour le réalisme
                        player.angle += (Math.random() - 0.5) * 0.2;
                        
                    } else if (Math.abs(dot) < 0.7) {
                        // Frottement latéral (glissement le long du mur)
                        
                        // Projeter la vitesse sur la direction du mur
                        const velocityAlongWall = vx * wallDirX + vy * wallDirY;
                        
                        // Nouvelle vitesse alignée avec le mur
                        const newVx = wallDirX * velocityAlongWall * 0.85;
                        const newVy = wallDirY * velocityAlongWall * 0.85;
                        
                        // Mettre à jour la vitesse et l'angle
                        player.speed = Math.sqrt(newVx * newVx + newVy * newVy);
                        
                        // Ajuster légèrement l'angle pour suivre le mur
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
                        // Collision à angle rasant
                        player.speed *= 0.95;
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
                    
                    break;
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
                isBoosting: p.isBoosting
            })),
            gameTime: this.gameStartTime ? Date.now() - this.gameStartTime : 0,
            totalLaps: this.raceSettings ? this.raceSettings.laps : 3,
            maxTime: this.raceSettings ? this.raceSettings.maxTime : null,
            remainingTime: this.gameStartTime && this.raceSettings ? 
                Math.max(0, this.raceSettings.maxTime - (Date.now() - this.gameStartTime)) : 
                (this.raceSettings ? this.raceSettings.maxTime : null)
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
            dnf: player.finishTime === null && player.finished
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
            room.host = player.id;
            gameState.rooms.set(roomCode, room);
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
        const room = new Room(roomCode, true);
        room.host = player.id;
        gameState.rooms.set(roomCode, room);
        
        room.addPlayer(player);
        socket.join(roomCode);
        
        socket.emit('joinedRoom', {
            roomId: roomCode,
            playerId: player.id,
            isPrivate: true,
            roomCode: roomCode,
            isHost: true
        });
        
        // Envoyer la map sélectionnée (par défaut)
        socket.emit('mapSelected', {
            mapId: room.selectedMap
        });
        
        broadcastPlayersList(room);
    });

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
            }
        }
    });

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
            return;
        }
        
        // Mettre à jour la map sélectionnée
        room.selectedMap = data.mapId;
        
        // Notifier tous les joueurs de la room
        io.to(room.id).emit('mapSelected', {
            mapId: data.mapId
        });
    });

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

    socket.on('voteRematch', () => {
        const room = findPlayerRoom(socket.id);
        if (room) {
            room.voteRematch(socket.id);
        }
    });

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
            // Juste mettre à jour l'état des inputs
            player.inputs.up = input.up;
            player.inputs.down = input.down;
            player.inputs.left = input.left;
            player.inputs.right = input.right;
            
            // Traiter l'item séparément
            if (input.space && player.item) {
                useItem(player, room);
            }
        }
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
        canStart: room.canHostStart(),
        hostId: room.host
    });
}

function useItem(player, room) {
    switch (player.item) {
        case 'boost':
            player.speed = Math.min(player.speed + 3, GAME_CONFIG.MAX_SPEED * 1.5);
            break;
        case 'slow':
            // Ralentir les autres joueurs
            for (let otherPlayer of room.players.values()) {
                if (otherPlayer.id !== player.id) {
                    otherPlayer.speed *= 0.5;
                }
            }
            break;
    }
    player.item = null;
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
                thumbnail: data.background || 'assets/track_background.png'
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
server.listen(PORT, '0.0.0.0', () => {});