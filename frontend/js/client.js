// client.js - Contrôleur principal refactorisé
import { NetworkManager } from './networkManager.js';
import { UIManager } from './uiManager.js';
import soundManager from './soundManager.js';

class GameClient {
    constructor() {
        // Managers
        this.network = new NetworkManager();
        this.ui = new UIManager();
        
        // État du jeu
        this.gameEngine = null;
        this.backgroundMusic = null;
        this.canControl = false;
        this.mapData = null;
        
        // Configuration des contrôles
        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false,
            space: false
        };
        
        this.inputInterval = null;
        
        this.initialize();
    }

    async initialize() {
        // Charger les assets
        try {
            await window.assetManager.loadAssets();
        } catch (error) {
            console.warn('Erreur lors du chargement des assets:', error);
        }
        
        // Configurer les événements
        this.setupUIEvents();
        this.setupNetworkEvents();
        this.setupKeyboardControls();
        
        // Charger les maps disponibles
        await this.loadAvailableMaps();
    }

    // Configuration des événements UI
    setupUIEvents() {
        // Menu principal
        window.addEventListener('ui:playButtonClicked', () => {
            this.onPlayButtonClick();
        });

        window.addEventListener('ui:joinGameClicked', () => {
            this.joinGame();
        });

        window.addEventListener('ui:createRoomClicked', () => {
            this.createRoom();
        });

        window.addEventListener('ui:joinWithCodeClicked', () => {
            this.joinWithCode();
        });

        // Lobby
        window.addEventListener('ui:leaveRoomClicked', () => {
            this.leaveRoom();
        });

        window.addEventListener('ui:hostStartGameClicked', () => {
            this.network.hostStartGame();
        });

        window.addEventListener('ui:playerReadyClicked', () => {
            this.network.playerReady();
        });

        window.addEventListener('ui:colorChanged', (e) => {
            if (this.network.roomId) {
                this.network.changeColor(e.detail);
            }
        });

        window.addEventListener('ui:mapSelected', (e) => {
            this.network.selectMap(e.detail);
        });

        // Résultats
        window.addEventListener('ui:playAgainClicked', () => {
            this.voteRematch();
        });

        window.addEventListener('ui:backToMenuClicked', () => {
            this.leaveResults();
        });
    }

    // Configuration des événements réseau
    setupNetworkEvents() {
        // Connexion
        this.network.on('connected', () => {
            console.log('Connecté au serveur');
        });

        this.network.on('disconnected', () => {
            this.ui.showScreen('menu');
        });

        // Lobby
        this.network.on('joinedRoom', (data) => {
            this.ui.playerId = data.playerId;
            this.ui.updateRoomInfo(data);
            this.ui.showScreen('lobby');
        });

        this.network.on('playersUpdate', (data) => {
            this.ui.updatePlayersList(data.players);
            this.ui.totalPlayers = data.players.length;
            this.ui.updateStartButton(data.canStart, this.ui.isHost);
            
            if (this.ui.isHost) {
                this.ui.showMapSelector(true);
            } else {
                this.ui.showMapSelector(false);
            }
        });

        this.network.on('mapSelected', (data) => {
            this.ui.selectedMap = data.mapId;
            const mapInfo = this.ui.availableMaps.find(m => m.id === data.mapId);
            if (mapInfo) {
                const selectedMapName = document.getElementById('selectedMapName');
                if (selectedMapName) {
                    selectedMapName.textContent = mapInfo.name;
                }
                
                if (!this.ui.isHost) {
                    this.ui.showNotification({
                        text: `Map sélectionnée : ${mapInfo.name}`,
                        type: 'info',
                        icon: '🗺️'
                    });
                }
            }
            this.ui.renderMapSelector();
        });

        this.network.on('hostChanged', (data) => {
            this.ui.isHost = (data.newHostId === this.network.playerId);
            if (this.ui.isHost) {
                this.ui.showNotification({
                    text: 'You are now the host !',
                    type: 'info',
                    icon: '👑'
                });
                this.ui.showMapSelector(true);
            } else {
                this.ui.showMapSelector(false);
            }
        });

        this.network.on('colorChanged', (data) => {
            const playerItems = document.querySelectorAll('.player-item');
            playerItems.forEach(item => {
                const player = this.ui.lastPlayersData?.find(p => p.id === data.playerId);
                if (player && item.textContent.includes(player.pseudo)) {
                    const colorDiv = item.querySelector('.player-color');
                    if (colorDiv) {
                        colorDiv.style.backgroundColor = data.color;
                        colorDiv.style.animation = 'colorFlash 0.5s ease-out';
                        setTimeout(() => {
                            colorDiv.style.animation = '';
                        }, 500);
                    }
                }
            });
        });

        // Jeu
        this.network.on('mapData', (mapData) => {
            this.mapData = mapData;
            if (this.gameEngine) {
                this.gameEngine.setMapData(mapData);
            }
        });

        this.network.on('gameStarted', () => {
            this.startGameCountdown();
        });

        this.network.on('gameUpdate', (gameData) => {
            if (this.gameEngine) {
                this.gameEngine.updateGameState(gameData);
            }
        });

        // Événements de course
        this.network.on('lapStarted', (data) => {
            this.ui.showLapNotification(data);
            soundManager.playLap();
        });

        this.network.on('lapCompleted', (data) => {
            soundManager.playLap();
            this.ui.showLapNotification(data);
        });

        this.network.on('boostActivated', () => {
            soundManager.playBoost();
        });

        this.network.on('wrongCheckpoint', (data) => {
            this.ui.showNotification({
                text: data.message,
                type: 'error',
                icon: '❌'
            });
            soundManager.playError();
        });

        this.network.on('invalidFinish', (data) => {
            this.ui.showNotification({
                text: data.message,
                type: 'warning',
                icon: '⚠️'
            });
        });

        this.network.on('timeWarning', (data) => {
            this.ui.showTimeWarning(data);
        });

        this.network.on('playerFinished', (data) => {
            this.ui.showFinishNotification(data);
            
            if (data.playerId === this.network.playerId) {
                this.ui.showPersonalFinish(data);
                
                setTimeout(() => {
                    this.ui.showNotification({
                        text: 'En attente que tous les joueurs terminent...',
                        type: 'info',
                        icon: '⏳'
                    });
                }, 3000);
            }
        });

        this.network.on('raceEnded', (data) => {
            this.ui.showNotification({
                text: 'Race ended !',
                type: 'success',
                icon: '🏆'
            });
            
            setTimeout(() => {
                this.stopGame();
                this.ui.showRaceResults(data.results);
                this.ui.startRematchTimer();
            }, 2000);
        });

        // Rematch
        this.network.on('rematchVote', (data) => {
            this.ui.updateRematchButton(data.votes, data.total);
        });

        this.network.on('rematchStarting', async () => {
            this.ui.rematchVotes = 0;
            
            if (this.gameEngine && this.gameEngine.music) {
                this.gameEngine.music.pause();
                this.gameEngine.music.currentTime = 0;
                this.gameEngine.music = null;
            }
            
            this.ui.cleanupGameNotifications();
            this.ui.showScreen('lobby');
            
            this.ui.showNotification({
                text: 'Nouvelle partie dans le même lobby !',
                type: 'success',
                icon: '🔄'
            });
        });

        this.network.on('returnToLobby', () => {
            this.ui.rematchVotes = 0;
            
            if (this.gameEngine && this.gameEngine.music) {
                this.gameEngine.music.pause();
                this.gameEngine.music.currentTime = 0;
                this.gameEngine.music = null;
            }
            
            this.ui.showScreen('lobby');
        });

        // Erreurs
        this.network.on('error', (error) => {
            alert(error.message);
        });

        this.network.on('kickedFromLobby', () => {
            this.ui.showScreen('menu');
            this.stopGame();
        });
    }

    // Méthodes principales
    onPlayButtonClick() {
        // Initialiser la musique de fond
        this.backgroundMusic = new Audio('assets/audio/kartrush_theme.mp3');
        this.backgroundMusic.loop = true;
        this.backgroundMusic.volume = soundManager.getVolumeFor('backgroundMusic');
        this.backgroundMusic.play().catch(e => {
            console.log('Musique de fond autorisée par le clic utilisateur');
        });
        
        soundManager.registerAudio('backgroundMusic', this.backgroundMusic);
        
        // Se connecter au serveur
        this.network.connect();
        
        // Passer au menu principal
        this.ui.showScreen('menu');
    }

    async loadAvailableMaps() {
        try {
            const response = await fetch('/api/maps');
            if (response.ok) {
                const data = await response.json();
                this.ui.setAvailableMaps(data.maps);
            } else {
                throw new Error('Impossible de charger les maps');
            }
        } catch (error) {
            // Maps par défaut
            this.ui.setAvailableMaps([
                { id: 'lava_track', name: 'City', thumbnail: 'assets/track_background.png' },
                { id: 'ice_circuit', name: 'Lava world', thumbnail: 'assets/track_background.png2' }
            ]);
        }
    }

    joinGame() {
        const { pseudo, color } = this.ui.getInputValues();
        if (!pseudo) {
            alert('Please enter a nickname');
            return;
        }
        this.network.joinGame(pseudo, color);
    }

    createRoom() {
        const { pseudo, color } = this.ui.getInputValues();
        if (!pseudo) {
            alert('Please enter a nickname');
            return;
        }
        this.network.createRoom(pseudo, color);
    }

    joinWithCode() {
        const { pseudo, color, roomCode } = this.ui.getInputValues();
        
        if (!pseudo) {
            alert('Please enter a nickname');
            return;
        }
        
        if (!roomCode) {
            alert('Please enter a room code');
            return;
        }
        
        if (roomCode.length !== 6) {
            alert('The room code must be 6 characters long');
            return;
        }
        
        this.network.joinRoomWithCode(pseudo, color, roomCode.toUpperCase());
    }

    leaveRoom() {
        this.network.disconnect();
        this.network.connect();
        this.ui.showScreen('menu');
    }

    voteRematch() {
        this.network.voteRematch();
        this.ui.disableRematchButton();
    }

    leaveResults() {
        this.network.leaveResults();
        this.backToMenu();
    }

    // Gestion du jeu
    async startGameCountdown() {
        await this.ui.showLoadingScreen();
        await new Promise(resolve => setTimeout(resolve, 800));
        
        this.ui.showScreen('game');
        
        if (this.backgroundMusic) {
            this.backgroundMusic.pause();
        }
        
        this.ui.cleanupGameNotifications();
        this.initializeGame();

        if (this.mapData && this.gameEngine) {
            this.gameEngine.setMapData(this.mapData);
            
            if (this.gameEngine && this.gameEngine.music) {
                this.gameEngine.music.volume = 0.05;
            }
            
            setTimeout(() => {
                if (this.gameEngine && this.gameEngine.music && soundManager) {
                    this.gameEngine.music.volume = soundManager.getVolumeFor('gameMusic');
                    soundManager.refreshAudioVolume('gameMusic');
                }
            }, 500);
        }

        this.canControl = false;
        this.gameEngine.start();
        
        const gameCanvas = document.getElementById('gameCanvas');
        if (gameCanvas) {
            gameCanvas.tabIndex = 0;
            gameCanvas.focus();
        }

        await this.ui.showCountdown();
        this.canControl = true;
    }

    initializeGame() {
        const canvas = document.getElementById('gameCanvas');
        this.gameEngine = new GameEngine(canvas, this.network.socket, this.network.playerId);
    }

    stopGame() {
        if (this.gameEngine) {
            this.gameEngine.stop();
            if (this.gameEngine.music) {
                soundManager.unregisterAudio('gameMusic');
                this.gameEngine.music.pause();
                this.gameEngine.music.currentTime = 0;
                this.gameEngine.music = null;
            }
            this.gameEngine = null;
        }
        
        this.mapData = null;
        
        if (this.backgroundMusic) {
            this.backgroundMusic.play().catch(e => console.log('Reprise de la musique de fond'));
        }
    }

    backToMenu() {
        this.stopGame();
        this.leaveRoom();
    }

    // Contrôles clavier
    setupKeyboardControls() {
        this.inputInterval = setInterval(() => {
            if (this.gameEngine && this.gameEngine.isRunning) {
                this.sendInput();
            }
        }, 1000 / 30);

        document.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
                return;
            }

            switch(e.code) {
                case 'ArrowUp':
                case 'KeyW':
                    if (!this.keys.up) {
                        if (this.ui.currentScreen === 'game') {
                            soundManager.playEngine();
                        }
                    }
                    this.keys.up = true;
                    e.preventDefault();
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.keys.down = true;
                    e.preventDefault();
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.keys.left = true;
                    e.preventDefault();
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.keys.right = true;
                    e.preventDefault();
                    break;
                case 'Space':
                    this.keys.space = true;
                    e.preventDefault();
                    break;
            }
        });

        document.addEventListener('keyup', (e) => {
            switch(e.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.keys.up = false;
                    soundManager.stopEngine();
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.keys.down = false;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.keys.left = false;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.keys.right = false;
                    break;
                case 'Space':
                    this.keys.space = false;
                    break;
            }
        });
    }

    sendInput() {
        if (!this.canControl) return;
        this.network.sendInput({
            up: this.keys.up,
            down: this.keys.down,
            left: this.keys.left,
            right: this.keys.right,
            space: this.keys.space
        });
    }
}

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    window.gameClient = new GameClient();
    console.log('🎮 KartRush.io initialized');
});