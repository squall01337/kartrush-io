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
function loadMapData() {
    try {
        const data = fs.readFileSync(path.join(__dirname, '../maps/oval_track.json'), 'utf-8');
        trackData = JSON.parse(data);
        console.log('✅ Map chargée :', trackData.name);
    } catch (error) {
        console.error('❌ Erreur de chargement de la map :', error);
        process.exit(1);
    }
}
loadMapData();

// État du jeu
const gameState = {
    rooms: new Map(),
    players: new Map()
};

// Configuration du jeu
const GAME_CONFIG = {
    MAX_PLAYERS_PER_ROOM: 8,
    MIN_PLAYERS_TO_START: 1,
    TICK_RATE: 30,
    TRACK_WIDTH: 1280,
    TRACK_HEIGHT: 720,
    KART_SIZE: 20,
    MAX_SPEED: 14,
    ACCELERATION: 0.8,
    FRICTION: 0.92,
    TURN_SPEED: 0.28,
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
        this.checkpointsPassed = new Set(); // Checkpoints passés dans le tour actuel
        this.lastCheckpoint = -1; // Dernier checkpoint passé
        this.finishLinePassed = false; // Pour éviter de compter plusieurs fois
        this.raceTime = 0;
        this.finishTime = null; // Temps de fin
        this.finished = false;
        this.ready = true; // Joueurs prêts par défaut
    }

    update(deltaTime) {
        // Appliquer la friction
        this.speed *= GAME_CONFIG.FRICTION;
        
        // Mettre à jour la position
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        
        // Limites de la piste (temporaire)
        this.x = Math.max(GAME_CONFIG.KART_SIZE, Math.min(GAME_CONFIG.TRACK_WIDTH - GAME_CONFIG.KART_SIZE, this.x));
        this.y = Math.max(GAME_CONFIG.KART_SIZE, Math.min(GAME_CONFIG.TRACK_HEIGHT - GAME_CONFIG.KART_SIZE, this.y));
    }

    accelerate() {
        this.speed = Math.min(this.speed + GAME_CONFIG.ACCELERATION, GAME_CONFIG.MAX_SPEED);
    }

    brake() {
        this.speed = Math.max(this.speed - GAME_CONFIG.ACCELERATION * 2, -GAME_CONFIG.MAX_SPEED * 0.5);
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
        this.players = new Map();
        this.gameStarted = false;
        this.gameStartTime = null;
        this.lastUpdate = Date.now();
        this.gameLoop = null;
        this.warningShown = false; // Pour n'afficher l'avertissement qu'une fois
        this.raceSettings = null; // Sera défini depuis la map
    }

    addPlayer(player) {
        if (this.players.size >= GAME_CONFIG.MAX_PLAYERS_PER_ROOM) {
            return false;
        }
        this.players.set(player.id, player);
        return true;
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        if (this.players.size === 0) {
            this.stopGame();
        }
    }

    canStart() {
        return this.players.size >= GAME_CONFIG.MIN_PLAYERS_TO_START && 
               !this.gameStarted;
    }

    startGame() {
        if (!this.canStart()) return false;
        
        this.gameStarted = true;
        this.gameStartTime = Date.now();
        
        // Charger les paramètres de course depuis la map
        this.raceSettings = trackData.raceSettings || {
            laps: 3,
            maxTime: 300000,
            maxTimeWarning: 240000
        };
        
        // Positionner les joueurs aux points de départ
        const spawnPoints = (trackData && trackData.spawnPoints) || [];

        let index = 0;
        for (let player of this.players.values()) {
            const pos = spawnPoints[index % spawnPoints.length] || { x: 400, y: 500, angle: 0 };
            player.x = pos.x;
            player.y = pos.y;
            player.angle = pos.angle || 0;
            player.speed = 0;
            player.lap = 0;
            player.finished = false;
            player.raceTime = 0;
            player.finishTime = null;
            player.checkpointsPassed.clear();
            player.lastCheckpoint = -1;
            index++;
        }
        
        // Démarrer la boucle de jeu
        this.gameLoop = setInterval(() => {
            this.update();
        }, 1000 / GAME_CONFIG.TICK_RATE);
        
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
        
        const raceTime = now - this.gameStartTime;

        // Vérifier le temps limite
        if (this.raceSettings) {
            // Avertissement de temps
            if (!this.warningShown && raceTime >= this.raceSettings.maxTimeWarning) {
                this.warningShown = true;
                const remainingTime = Math.ceil((this.raceSettings.maxTime - raceTime) / 1000);
                io.to(this.id).emit('timeWarning', { 
                    remainingTime: remainingTime,
                    message: `Attention ! Plus que ${remainingTime} secondes !`
                });
            }
            
            // Temps écoulé - fin de course forcée
            if (raceTime >= this.raceSettings.maxTime) {
                console.log('⏱️ Temps limite atteint !');
                this.forceEndRace();
                return;
            }
        }

        // Mettre à jour tous les joueurs + vérifier collision murs
        for (let player of this.players.values()) {
            if (!player.finished) {
                player.update(deltaTime);
                player.raceTime = now - this.gameStartTime;

                // Collision avec murs ou courbes Bézier
                this.checkWallCollisions(player);
                
                // Vérifier les checkpoints et la ligne d'arrivée
                this.checkRaceProgress(player);
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

    checkRaceProgress(player) {
        if (!trackData || !this.raceSettings) return;
        
        // Vérifier les checkpoints
        if (trackData.checkpoints) {
            trackData.checkpoints.forEach((checkpoint, index) => {
                if (this.isPlayerCrossingLine(player, checkpoint)) {
                    // Le joueur doit passer les checkpoints dans l'ordre
                    if (index === player.lastCheckpoint + 1 || 
                        (index === 0 && player.lastCheckpoint === trackData.checkpoints.length - 1)) {
                        player.checkpointsPassed.add(index);
                        player.lastCheckpoint = index;
                        console.log(`${player.pseudo} a passé le checkpoint ${index + 1}`);
                    }
                }
            });
        }
        
        // Vérifier la ligne d'arrivée
        if (trackData.finishLine && this.isPlayerCrossingLine(player, trackData.finishLine)) {
            // Vérifier si tous les checkpoints ont été passés
            const allCheckpointsPassed = !trackData.checkpoints || 
                trackData.checkpoints.length === 0 || 
                player.checkpointsPassed.size === trackData.checkpoints.length;
            
            if (allCheckpointsPassed && !player.finishLinePassed) {
                player.finishLinePassed = true;
                
                // Valider le tour
                player.lap++;
                player.checkpointsPassed.clear();
                player.lastCheckpoint = -1;
                
                console.log(`${player.pseudo} termine le tour ${player.lap}/${this.raceSettings.laps}`);
                
                // Vérifier si le joueur a terminé la course
                if (player.lap >= this.raceSettings.laps) {
                    player.finished = true;
                    player.finishTime = player.raceTime;
                    console.log(`🏁 ${player.pseudo} a terminé la course en ${this.formatTime(player.finishTime)}`);
                    
                    // Envoyer un événement spécial
                    io.to(this.id).emit('playerFinished', {
                        playerId: player.id,
                        pseudo: player.pseudo,
                        finishTime: player.finishTime,
                        position: this.getFinishPosition()
                    });
                }
            }
        } else if (player.finishLinePassed && trackData.finishLine && 
                   !this.isPlayerCrossingLine(player, trackData.finishLine)) {
            // Réinitialiser le flag quand le joueur n'est plus sur la ligne
            player.finishLinePassed = false;
        }
    }

    isPlayerCrossingLine(player, line) {
        if (!line) return false;
        
        // Utiliser la représentation rectangle de la ligne
        const lineRect = {
            x: line.x,
            y: line.y,
            width: line.width,
            height: line.height,
            angle: line.angle || 0
        };
        
        // Vérifier si le centre du joueur traverse la ligne
        return this.isPointInRotatedRect(player.x, player.y, lineRect);
    }

    isPointInRotatedRect(px, py, rect) {
        // Transformer le point dans le système de coordonnées du rectangle
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        
        const angle = -Math.radians(rect.angle || 0);
        
        // Translater le point par rapport au centre
        const tx = px - cx;
        const ty = py - cy;
        
        // Appliquer la rotation inverse
        const rx = tx * Math.cos(angle) - ty * Math.sin(angle);
        const ry = tx * Math.sin(angle) + ty * Math.cos(angle);
        
        // Vérifier si le point est dans le rectangle non tourné
        const halfW = rect.width / 2;
        const halfH = rect.height / 2;
        
        return -halfW <= rx <= halfW && -halfH <= ry <= halfH;
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
    }

    formatTime(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = Math.floor((ms % 1000) / 10);
        return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }

    updatePositions() {
        const activePlayers = Array.from(this.players.values()).filter(p => !p.finished);
        
        // Trier par tours d'abord, puis par distance parcourue
        activePlayers.sort((a, b) => {
            // D'abord par nombre de tours
            if (a.lap !== b.lap) return b.lap - a.lap;
            
            // Ensuite par checkpoints passés
            if (a.checkpointsPassed.size !== b.checkpointsPassed.size) {
                return b.checkpointsPassed.size - a.checkpointsPassed.size;
            }
            
            // Enfin par temps de course (plus ancien = devant)
            return a.raceTime - b.raceTime;
        });

        activePlayers.forEach((player, index) => {
            player.position = index + 1;
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
                        player.speed *= -0.2; // Inverser la vitesse (rebond)
                        
                        // Rebond plus prononcé
                        player.x += nx * 8; // Rebond de 8 pixels
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
                checkpointsPassed: Array.from(p.checkpointsPassed),
                lapsToWin: this.raceSettings ? this.raceSettings.laps : 3
            })),
            gameTime: this.gameStartTime ? Date.now() - this.gameStartTime : 0,
            totalLaps: this.raceSettings ? this.raceSettings.laps : 3,
            maxTime: this.raceSettings ? this.raceSettings.maxTime : null,
            remainingTime: this.raceSettings ? Math.max(0, this.raceSettings.maxTime - (Date.now() - this.gameStartTime)) : null
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
        
        // Trouver ou créer une room
        let room = findAvailableRoom();
        if (!room) {
            room = new Room(uuidv4());
            gameState.rooms.set(room.id, room);
        }
        
        // Ajouter le joueur à la room
        if (room.addPlayer(player)) {
            socket.join(room.id);

            // Envoyer les infos de la room
            socket.emit('joinedRoom', {
                roomId: room.id,
                playerId: player.id,
                isPrivate: room.isPrivate
            });

            // ✅ Envoyer la map au joueur
            socket.emit('mapData', trackData);

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
        
        // Créer une room privée
        const room = new Room(uuidv4(), true);
        gameState.rooms.set(room.id, room);
        
        room.addPlayer(player);
        socket.join(room.id);
        
        socket.emit('joinedRoom', {
            roomId: room.id,
            playerId: player.id,
            isPrivate: true,
            roomCode: room.id.substring(0, 6).toUpperCase()
        });
        
        broadcastPlayersList(room);
    });

    socket.on('playerReady', () => {
        const player = gameState.players.get(socket.id);
        if (player) {
            player.ready = true;
            const room = findPlayerRoom(socket.id);
            if (room) {
                broadcastPlayersList(room);
                
                // Vérifier si on peut démarrer
                if (room.canStart()) {
                    setTimeout(() => {
                        if (room.startGame()) {
                            io.to(room.id).emit('gameStarted');
                        }
                    }, 3000); // Délai de 3 secondes
                }
            }
        }
    });

    socket.on('playerInput', (input) => {
        const player = gameState.players.get(socket.id);
        const room = findPlayerRoom(socket.id);
        
        if (player && room && room.gameStarted && !player.finished) {
            // Traiter les inputs
            if (input.up) player.accelerate();
            if (input.down) player.brake();
            if (input.left) player.turnLeft();
            if (input.right) player.turnRight();
            if (input.space && player.item) {
                useItem(player, room);
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
        ready: p.ready
    }));
    
    io.to(room.id).emit('playersUpdate', {
        players: playersList,
        canStart: room.canStart()
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

// Route pour servir le frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Démarrage du serveur
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🏁 Serveur KartRush.io démarré sur le port ${PORT}`);
    console.log(`🌐 Accès: http://localhost:${PORT}`);
});