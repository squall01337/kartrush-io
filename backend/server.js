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

// État du jeu
const gameState = {
    rooms: new Map(),
    players: new Map()
};

// Configuration du jeu
const GAME_CONFIG = {
    MAX_PLAYERS_PER_ROOM: 8,
    MIN_PLAYERS_TO_START: 1,
    LAPS_TO_WIN: 3,
    TICK_RATE: 30, // Réduire à 20 FPS au lieu de 30
    TRACK_WIDTH: 1280,
    TRACK_HEIGHT: 720,
    KART_SIZE: 20,
    MAX_SPEED: 14,
    ACCELERATION: 0.8,
    FRICTION: 0.92,
    TURN_SPEED: 0.28,
    // OPTIMISATION: Zone de collision pour la grille spatiale
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
        this.lastCheckpoint = 0;
        this.raceTime = 0;
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
        
        // Positionner les joueurs aux points de départ
        const startPositions = [
            { x: 80, y: 280 },
            { x: 80, y: 320 },
            { x: 120, y: 280 },
            { x: 120, y: 320 },
            { x: 160, y: 280 },
            { x: 160, y: 320 },
            { x: 200, y: 280 },
            { x: 200, y: 320 }
        ];
        
        let index = 0;
        for (let player of this.players.values()) {
            const pos = startPositions[index % startPositions.length];
            player.x = pos.x;
            player.y = pos.y;
            player.angle = 0;
            player.speed = 0;
            player.lap = 0;
            player.finished = false;
            player.raceTime = 0;
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

        // Mettre à jour tous les joueurs
        for (let player of this.players.values()) {
            if (!player.finished) {
                player.update(deltaTime);
                player.raceTime = now - this.gameStartTime;
            }
        }

        // Vérifier les collisions entre joueurs
        this.checkPlayerCollisions();

        // Calculer les positions
        this.updatePositions();

        // Envoyer l'état du jeu à tous les clients
        this.broadcastGameState();
    }

    updatePositions() {
        const activePlayers = Array.from(this.players.values()).filter(p => !p.finished);
        activePlayers.sort((a, b) => {
            if (a.lap !== b.lap) return b.lap - a.lap;
            return a.raceTime - b.raceTime;
        });

        activePlayers.forEach((player, index) => {
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
                raceTime: p.raceTime
            })),
            gameTime: this.gameStartTime ? Date.now() - this.gameStartTime : 0
        };

        io.to(this.id).emit('gameUpdate', gameData);
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
            socket.emit('joinedRoom', {
                roomId: room.id,
                playerId: player.id,
                isPrivate: room.isPrivate
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

