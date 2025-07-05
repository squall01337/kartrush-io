const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Modules internes
const { GAME_CONFIG, Player, checkWallCollisions, checkPlayerCollisions, checkBoosterCollisions, useItem } = require('./gameLogic');
const { Room, generateRoomCode, broadcastPlayersList } = require('./roomManager');

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

// État du jeu
const gameState = {
    rooms: new Map(),
    players: new Map()
};

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
        availableMaps = ['lava_track'];
    }
}

function loadMapData(mapName = 'lava_track') {
    try {
        let mapPath = path.join(__dirname, '../maps', `${mapName}.json`);
        
        if (!fs.existsSync(mapPath)) {
            console.log(`⚠️ Map ${mapName} non trouvée, chargement de lava_track`);
            mapPath = path.join(__dirname, '../maps/lava_track.json');
            
            if (!fs.existsSync(mapPath)) {
                mapPath = path.join(__dirname, '../maps/oval_track.json');
            }
        }
        
        const data = fs.readFileSync(mapPath, 'utf-8');
        trackData = JSON.parse(data);
        
        convertRectsToLines(trackData);
        
        console.log('✅ Map chargée :', trackData.name);
        console.log('📍 Checkpoints:', trackData.checkpoints ? trackData.checkpoints.length : 0);
        console.log('🏁 Ligne d\'arrivée:', trackData.finishLine ? 'Oui' : 'Non');
        
        return true;
        
    } catch (error) {
        console.error('❌ Erreur de chargement de la map :', error);
        
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
    if (data.checkpoints && data.checkpoints.length > 0 && data.checkpoints[0].width !== undefined) {
        console.log('🔄 Conversion des checkpoints rectangulaires en lignes...');
        data.checkpoints = data.checkpoints.map(cp => {
            const cx = cp.x + cp.width / 2;
            const cy = cp.y + cp.height / 2;
            const angle = (cp.angle || 0) * Math.PI / 180;
            const halfLength = cp.height / 2;
            
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

// Initialisation
loadMapData();
loadAvailableMaps();

// Méthode update pour Room (définie ici car elle a besoin de trackData et io)
Room.prototype.update = function() {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;
    
    if (!this.gameStartTime) {
        for (let player of this.players.values()) {
            if (!player.finished) {
                player.update(deltaTime);
                player.raceTime = 0;
                
                checkWallCollisions(player, trackData);
                checkBoosterCollisions(player, trackData, io);
            }
        }
        
        checkPlayerCollisions(Array.from(this.players.values()));
        this.updatePositions();
        this.broadcastGameState(trackData, io);
        return;
    }
    
    const raceTime = now - this.gameStartTime;

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
            console.log('⏱️ Temps limite atteint !');
            this.forceEndRace(io);
            return;
        }
    }

    for (let player of this.players.values()) {
        if (!player.finished) {
            player.update(deltaTime);
            player.raceTime = now - this.gameStartTime;

            checkWallCollisions(player, trackData);
            checkBoosterCollisions(player, trackData, io);
            
            this.checkRaceProgress(player, trackData, now, io);
        }
    }

    checkPlayerCollisions(Array.from(this.players.values()));
    this.updatePositions();
    this.checkRaceEnd(io);
    this.broadcastGameState(trackData, io);
};

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
    console.log(`Joueur connecté: ${socket.id}`);

    socket.on('joinGame', (data) => {
        const { pseudo, color } = data;
        
        const player = new Player(socket.id, pseudo, color);
        gameState.players.set(socket.id, player);
        
        let room = findAvailableRoom();
        if (!room) {
            const roomCode = generateRoomCode();
            room = new Room(roomCode, false);
            room.host = player.id;
            gameState.rooms.set(roomCode, room);
            console.log('🌍 Room publique créée - Code:', roomCode);
        }
        
        if (room.addPlayer(player)) {
            socket.join(room.id);

            socket.emit('joinedRoom', {
                roomId: room.id,
                playerId: player.id,
                isPrivate: false,
                roomCode: room.id,
                isHost: room.host === player.id
            });

            socket.emit('mapSelected', {
                mapId: room.selectedMap
            });

            socket.to(room.id).emit('playerJoined', {
                id: player.id,
                pseudo: player.pseudo,
                color: player.color
            });
            
            broadcastPlayersList(room, io);
        } else {
            socket.emit('error', { message: 'Room pleine' });
        }
    });

    socket.on('createRoom', (data) => {
        const { pseudo, color } = data;
        
        const player = new Player(socket.id, pseudo, color);
        gameState.players.set(socket.id, player);
        
        const roomCode = generateRoomCode();
        const room = new Room(roomCode, true);
        room.host = player.id;
        gameState.rooms.set(roomCode, room);
        
        room.addPlayer(player);
        socket.join(roomCode);
        
        console.log('🔑 Room privée créée - Code:', roomCode);
        
        socket.emit('joinedRoom', {
            roomId: roomCode,
            playerId: player.id,
            isPrivate: true,
            roomCode: roomCode,
            isHost: true
        });
        
        socket.emit('mapSelected', {
            mapId: room.selectedMap
        });
        
        broadcastPlayersList(room, io);
    });

    socket.on('joinRoomWithCode', (data) => {
        const { pseudo, color, roomCode } = data;
        
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
        
        const player = new Player(socket.id, pseudo, color);
        gameState.players.set(socket.id, player);
        
        if (room.addPlayer(player)) {
            socket.join(room.id);
            
            socket.emit('joinedRoom', {
                roomId: room.id,
                playerId: player.id,
                isPrivate: room.isPrivate,
                roomCode: room.id,
                isHost: false
            });
            
            socket.emit('mapSelected', {
                mapId: room.selectedMap
            });
            
            socket.to(room.id).emit('playerJoined', {
                id: player.id,
                pseudo: player.pseudo,
                color: player.color
            });
            
            broadcastPlayersList(room, io);
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
                broadcastPlayersList(room, io);
            }
        }
    });

    socket.on('hostStartGame', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        if (room.host !== socket.id) {
            socket.emit('error', { message: 'Seul l\'hôte peut démarrer la partie' });
            return;
        }
        
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
        
        if (loadMapData(room.selectedMap)) {
            io.to(room.id).emit('mapData', trackData);
        }
        
        if (room.startGame(trackData)) {
            io.to(room.id).emit('gameStarted');
        }
    });

    socket.on('selectMap', (data) => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;
        
        if (room.host !== socket.id) {
            socket.emit('error', { message: 'Seul l\'hôte peut choisir la map' });
            return;
        }
        
        if (!availableMaps.includes(data.mapId) && data.mapId !== 'lava_track') {
            console.log(`⚠️ Map ${data.mapId} non trouvée dans la liste`);
            return;
        }
        
        room.selectedMap = data.mapId;
        console.log(`🗺️ Room ${room.id} - Map changée : ${data.mapId}`);
        
        io.to(room.id).emit('mapSelected', {
            mapId: data.mapId
        });
    });

    socket.on('changeColor', (data) => {
        const player = gameState.players.get(socket.id);
        const room = findPlayerRoom(socket.id);
        
        if (player && room && !room.gameStarted) {
            player.color = data.color;
            
            io.to(room.id).emit('colorChanged', {
                playerId: player.id,
                color: data.color
            });
            
            broadcastPlayersList(room, io);
            
            console.log(`🎨 ${player.pseudo} a changé de couleur : ${data.color}`);
        }
    });

    socket.on('voteRematch', () => {
        const room = findPlayerRoom(socket.id);
        if (room) {
            room.voteRematch(socket.id, io);
        }
    });

    socket.on('leaveResults', () => {
        const room = findPlayerRoom(socket.id);
        if (room) {
            room.removePlayer(socket.id, io);
            socket.leave(room.id);
            
            if (room.players.size === 0) {
                gameState.rooms.delete(room.id);
            }
        }
    });

    socket.on('playerInput', (input) => {
        const player = gameState.players.get(socket.id);
        const room = findPlayerRoom(socket.id);
        
        if (player && room && room.gameStarted && !player.finished) {
            player.inputs.up = input.up;
            player.inputs.down = input.down;
            player.inputs.left = input.left;
            player.inputs.right = input.right;
            
            if (input.space && player.item) {
                useItem(player, room);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Joueur déconnecté: ${socket.id}`);
        
        const room = findPlayerRoom(socket.id);
        if (room) {
            room.removePlayer(socket.id, io);
            socket.to(room.id).emit('playerLeft', { id: socket.id });
            broadcastPlayersList(room, io);
            
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

// Route pour obtenir la liste des maps disponibles
app.get('/api/maps', (req, res) => {
    const maps = availableMaps.map(mapId => {
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
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🏁 Serveur KartRush.io démarré sur le port ${PORT}`);
    console.log(`🌐 Accès: http://localhost:${PORT}`);
});