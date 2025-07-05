// networkManager.js - Gestion de la connexion Socket.io et des événements réseau

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.playerId = null;
        this.roomId = null;
        this.callbacks = {};
    }

    // Mini EventEmitter intégré
    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => callback(data));
        }
    }

    connect() {
        if (this.socket) return;
        
        this.socket = io();
        this.setupSocketEvents();
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.connected = false;
        }
    }

    setupSocketEvents() {
        this.socket.on('connect', () => {
            this.connected = true;
            console.log('Connecté au serveur');
            this.emit('connected');
        });

        this.socket.on('disconnect', () => {
            this.connected = false;
            this.emit('disconnected');
        });

        // Événements de lobby
        this.socket.on('joinedRoom', (data) => {
            this.playerId = data.playerId;
            this.roomId = data.roomId;
            this.emit('joinedRoom', data);
        });

        this.socket.on('playersUpdate', (data) => {
            this.emit('playersUpdate', data);
        });

        this.socket.on('mapSelected', (data) => {
            this.emit('mapSelected', data);
        });

        this.socket.on('hostChanged', (data) => {
            this.emit('hostChanged', data);
        });

        this.socket.on('colorChanged', (data) => {
            this.emit('colorChanged', data);
        });

        // Événements de jeu
        this.socket.on('mapData', (data) => {
            this.emit('mapData', data);
        });

        this.socket.on('gameStarted', () => {
            this.emit('gameStarted');
        });

        this.socket.on('gameUpdate', (data) => {
            this.emit('gameUpdate', data);
        });

        // Événements de course
        this.socket.on('lapStarted', (data) => {
            this.emit('lapStarted', data);
        });

        this.socket.on('checkpointPassed', (data) => {
            this.emit('checkpointPassed', data);
        });

        this.socket.on('wrongCheckpoint', (data) => {
            this.emit('wrongCheckpoint', data);
        });

        this.socket.on('invalidFinish', (data) => {
            this.emit('invalidFinish', data);
        });

        this.socket.on('lapCompleted', (data) => {
            this.emit('lapCompleted', data);
        });

        this.socket.on('boostActivated', (data) => {
            this.emit('boostActivated', data);
        });

        this.socket.on('timeWarning', (data) => {
            this.emit('timeWarning', data);
        });

        this.socket.on('playerFinished', (data) => {
            this.emit('playerFinished', data);
        });

        this.socket.on('raceEnded', (data) => {
            this.emit('raceEnded', data);
        });

        // Événements de rematch
        this.socket.on('rematchVote', (data) => {
            this.emit('rematchVote', data);
        });

        this.socket.on('rematchStarting', (data) => {
            this.emit('rematchStarting', data);
        });

        this.socket.on('returnToLobby', () => {
            this.emit('returnToLobby');
        });

        // Événements divers
        this.socket.on('playerJoined', (data) => {
            this.emit('playerJoined', data);
        });

        this.socket.on('playerLeft', (data) => {
            this.emit('playerLeft', data);
        });

        this.socket.on('error', (error) => {
            this.emit('error', error);
        });

        this.socket.on('kickedFromLobby', (data) => {
            this.emit('kickedFromLobby', data);
        });
    }

    // Méthodes d'envoi
    send(event, data) {
        if (this.socket && this.connected) {
            this.socket.emit(event, data);
        }
    }

    // Actions de jeu
    joinGame(pseudo, color) {
        this.send('joinGame', { pseudo, color });
    }

    createRoom(pseudo, color) {
        this.send('createRoom', { pseudo, color });
    }

    joinRoomWithCode(pseudo, color, roomCode) {
        this.send('joinRoomWithCode', { pseudo, color, roomCode });
    }

    playerReady() {
        this.send('playerReady');
    }

    hostStartGame() {
        this.send('hostStartGame');
    }

    selectMap(mapId) {
        this.send('selectMap', { mapId });
    }

    changeColor(color) {
        this.send('changeColor', { color });
    }

    voteRematch() {
        this.send('voteRematch');
    }

    leaveResults() {
        this.send('leaveResults');
    }

    sendInput(input) {
        this.send('playerInput', input);
    }

    reconnect() {
        if (!this.connected && this.socket) {
            this.socket.connect();
        }
    }
}