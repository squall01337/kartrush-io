// roomManager.js - Gestion des rooms et de l'état du jeu

const { GAME_CONFIG, checkWallCollisions, checkPlayerCollisions, checkBoosterCollisions, lineSegmentsIntersect } = require('./gameLogic');

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
        
        if (!this.host && this.players.size === 1) {
            this.host = player.id;
            player.isHost = true;
            player.ready = true;
        }
        
        return true;
    }

    removePlayer(playerId, io) {
        const wasHost = this.host === playerId;
        this.players.delete(playerId);
        
        this.rematchVotes.delete(playerId);
        
        if (this.players.size === 0) {
            this.stopGame();
            if (this.rematchTimer) {
                clearTimeout(this.rematchTimer);
                this.rematchTimer = null;
            }
        } else if (wasHost) {
            const newHost = this.players.keys().next().value;
            this.host = newHost;
            
            const newHostPlayer = this.players.get(newHost);
            if (newHostPlayer) {
                newHostPlayer.isHost = true;
                newHostPlayer.ready = true;
            }
            
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
            
            player.inputs = {
                up: false,
                down: false,
                left: false,
                right: false
            };
            
            player.isBoosting = false;
            player.boostEndTime = 0;
            player.lastBoosterIndex = -1;
            player.boostCooldown = 0;
            player.boostLevel = 0;
        }
    }

    voteRematch(playerId, io) {
        if (!this.players.has(playerId)) return;
        
        this.rematchVotes.add(playerId);
        
        io.to(this.id).emit('rematchVote', {
            playerId: playerId,
            votes: this.rematchVotes.size,
            total: this.players.size
        });
        
        if (this.rematchVotes.size === this.players.size) {
            if (this.rematchTimer) {
                clearTimeout(this.rematchTimer);
                this.rematchTimer = null;
            }
            this.startRematch(io);
        }
    }

    startRematch(io) {
        if (this.rematchTimer) {
            clearTimeout(this.rematchTimer);
            this.rematchTimer = null;
        }
        
        this.resetForNewRace();
        
        io.to(this.id).emit('rematchStarting', {
            mapName: this.selectedMap
        });
        
        broadcastPlayersList(this, io);
    }

    startGame(trackData) {
        if (!this.canStart()) return false;
        
        if (this.rematchTimer) {
            clearTimeout(this.rematchTimer);
            this.rematchTimer = null;
        }
        
        this.gameStarted = true;
        this.gameStartTime = null;
        
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
            
            player.inputs = {
                up: false,
                down: false,
                left: false,
                right: false
            };
            
            player.isBoosting = false;
            player.boostEndTime = 0;
            player.lastBoosterIndex = -1;
            player.boostCooldown = 0;
            
            index++;
        }
        
        this.gameLoop = setInterval(() => {
            this.update();
        }, 1000 / GAME_CONFIG.TICK_RATE);
        
        setTimeout(() => {
            this.gameStartTime = Date.now();
            console.log('⏱️ Timer de course démarré !');
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
        // Cette méthode sera définie dans server.js car elle nécessite trackData et io
    }

    checkRaceProgress(player, trackData, currentTime, io) {
        if (!trackData || !this.raceSettings) return;
        
        if (trackData.finishLine) {
            const crossed = lineSegmentsIntersect(
                player.lastX, player.lastY,
                player.x, player.y,
                trackData.finishLine.x1, trackData.finishLine.y1,
                trackData.finishLine.x2, trackData.finishLine.y2
            );
            
            if (crossed && currentTime - player.lastFinishLineTime > 1000) {
                player.lastFinishLineTime = currentTime;
                
                const lineVector = {
                    x: trackData.finishLine.x2 - trackData.finishLine.x1,
                    y: trackData.finishLine.y2 - trackData.finishLine.y1
                };
                const normal = { x: -lineVector.y, y: lineVector.x };
                
                const movement = {
                    x: player.x - player.lastX,
                    y: player.y - player.lastY
                };
                
                const dot = normal.x * movement.x + normal.y * movement.y;
                
                if (dot > 0) {
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
        
        if (player.hasPassedStartLine && trackData.checkpoints) {
            const checkpoint = trackData.checkpoints[player.nextCheckpoint];
            if (checkpoint) {
                const crossed = lineSegmentsIntersect(
                    player.lastX, player.lastY,
                    player.x, player.y,
                    checkpoint.x1, checkpoint.y1,
                    checkpoint.x2, checkpoint.y2
                );
                
                const lastTime = player.lastCheckpointTime[player.nextCheckpoint] || 0;
                if (crossed && currentTime - lastTime > 1000) {
                    player.lastCheckpointTime[player.nextCheckpoint] = currentTime;
                    
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

    getFinishPosition() {
        let finishedCount = 0;
        for (let p of this.players.values()) {
            if (p.finished) finishedCount++;
        }
        return finishedCount;
    }

    checkRaceEnd(io) {
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
        
        if (allFinished && hasActivePlayer) {
            this.endRace(io);
        }
    }

    endRace(io) {
        console.log('🏁 Course terminée !');
        
        this.stopGame();
        
        const results = this.getFinalResults();
        
        io.to(this.id).emit('raceEnded', {
            results: results,
            raceTime: Date.now() - this.gameStartTime
        });
        
        setTimeout(() => {
            this.rematchTimer = setTimeout(() => {
                const playersToRemove = [];
                
                for (let [playerId, player] of this.players) {
                    if (!this.rematchVotes.has(playerId)) {
                        playersToRemove.push(playerId);
                    }
                }
                
                for (let playerId of playersToRemove) {
                    const socket = io.sockets.sockets.get(playerId);
                    if (socket) {
                        socket.emit('kickedFromLobby', { reason: 'Pas de vote pour rejouer' });
                        socket.leave(this.id);
                    }
                    this.removePlayer(playerId, io);
                }
                
                if (this.players.size > 0) {
                    this.resetForNewRace();
                    io.to(this.id).emit('returnToLobby');
                    broadcastPlayersList(this, io);
                }
            }, 10000);
        }, 3000);
    }

    forceEndRace(io) {
        console.log('⏱️ Course terminée - Temps limite atteint !');
        
        for (let player of this.players.values()) {
            if (!player.finished) {
                player.finished = true;
                player.finishTime = null;
            }
        }
        
        this.endRace(io);
    }

    updatePositions() {
        const activePlayers = Array.from(this.players.values()).filter(p => !p.finished);
        
        const racingPlayers = activePlayers.filter(p => p.hasPassedStartLine);
        const waitingPlayers = activePlayers.filter(p => !p.hasPassedStartLine);
        
        racingPlayers.sort((a, b) => {
            if (a.lap !== b.lap) return b.lap - a.lap;
            
            if (a.nextCheckpoint !== b.nextCheckpoint) {
                return b.nextCheckpoint - a.nextCheckpoint;
            }
            
            return a.raceTime - b.raceTime;
        });

        let position = 1;
        
        racingPlayers.forEach(player => {
            player.position = position++;
        });
        
        waitingPlayers.forEach(player => {
            player.position = position++;
        });
        
        const finishedPlayers = Array.from(this.players.values()).filter(p => p.finished);
        finishedPlayers.sort((a, b) => a.finishTime - b.finishTime);
        finishedPlayers.forEach((player, index) => {
            player.position = index + 1;
        });
    }

    broadcastGameState(trackData, io) {
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
        
        results.sort((a, b) => {
            if (a.finished && !b.finished) return -1;
            if (!a.finished && b.finished) return 1;
            
            if (a.finished && b.finished && a.finishTime && b.finishTime) {
                return a.finishTime - b.finishTime;
            }
            
            if (a.dnf && !b.dnf) return 1;
            if (!a.dnf && b.dnf) return -1;
            
            if (a.lap !== b.lap) return b.lap - a.lap;
            return a.position - b.position;
        });
        
        results.forEach((result, index) => {
            result.finalPosition = index + 1;
        });
        
        return results;
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

// Fonction helper pour broadcast la liste des joueurs
function broadcastPlayersList(room, io) {
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

module.exports = {
    Room,
    generateRoomCode,
    broadcastPlayersList
};