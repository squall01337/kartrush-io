// Client WebSocket et gestion de l'interface
class GameClient {
    constructor() {
        this.socket = null;
        this.playerId = null;
        this.roomId = null;
        this.gameEngine = null;
        this.currentScreen = 'menu';
        this.selectedColor = '#ff4444';
        
        this.initializeUI();
        this.connectToServer();
    }

    initializeUI() {
        // Sélection de couleur
        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', (e) => {
                document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
                e.target.classList.add('selected');
                this.selectedColor = e.target.dataset.color;
            });
        });

        // Sélectionner la première couleur par défaut
        document.querySelector('.color-option').classList.add('selected');

        // Boutons du menu
        document.getElementById('joinGame').addEventListener('click', () => {
            this.joinGame();
        });

        document.getElementById('createRoom').addEventListener('click', () => {
            this.createRoom();
        });

        document.getElementById('leaveRoom').addEventListener('click', () => {
            this.leaveRoom();
        });

        document.getElementById('startGame').addEventListener('click', () => {
            this.startGame();
        });

        document.getElementById('playAgain').addEventListener('click', () => {
            this.showScreen('lobby');
        });

        document.getElementById('backToMenu').addEventListener('click', () => {
            this.backToMenu();
        });

        // Gestion des touches
        this.setupKeyboardControls();
    }

    connectToServer() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connecté au serveur');
        });

        this.socket.on('joinedRoom', (data) => {
            this.playerId = data.playerId;
            this.roomId = data.roomId;
            
            if (data.isPrivate) {
                document.getElementById('roomCode').textContent = `Code de la room: ${data.roomCode}`;
            } else {
                document.getElementById('roomCode').textContent = 'Room publique';
            }
            
            this.showScreen('lobby');
        });

        this.socket.on('playersUpdate', (data) => {
            this.updatePlayersList(data.players);
            
            const startButton = document.getElementById('startGame');
            if (data.canStart) {
                startButton.classList.remove('hidden');
            } else {
                startButton.classList.add('hidden');
            }
        });

        this.socket.on('gameStarted', () => {
            this.startGameCountdown();
        });

        this.socket.on('gameUpdate', (gameData) => {
            if (this.gameEngine) {
                this.gameEngine.updateGameState(gameData);
            }
        });

        this.socket.on('playerJoined', (player) => {
            console.log(`${player.pseudo} a rejoint la partie`);
        });

        this.socket.on('playerLeft', (data) => {
            console.log(`Joueur ${data.id} a quitté la partie`);
        });

        this.socket.on('error', (error) => {
            alert(error.message);
        });

        this.socket.on('disconnect', () => {
            console.log('Déconnecté du serveur');
            this.showScreen('menu');
        });
    }

    joinGame() {
        const pseudo = document.getElementById('pseudo').value.trim();
        if (!pseudo) {
            alert('Veuillez entrer un pseudo');
            return;
        }

        this.socket.emit('joinGame', {
            pseudo: pseudo,
            color: this.selectedColor
        });
    }

    createRoom() {
        const pseudo = document.getElementById('pseudo').value.trim();
        if (!pseudo) {
            alert('Veuillez entrer un pseudo');
            return;
        }

        this.socket.emit('createRoom', {
            pseudo: pseudo,
            color: this.selectedColor
        });
    }

    leaveRoom() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket.connect();
        }
        this.showScreen('menu');
    }

    startGame() {
        this.socket.emit('playerReady');
        document.getElementById('startGame').disabled = true;
        document.getElementById('startGame').textContent = 'En attente...';
    }

    startGameCountdown() {
        this.showScreen('game');
        this.initializeGame();
        
        const countdown = document.getElementById('countdown');
        countdown.classList.remove('hidden');
        
        let count = 3;
        countdown.textContent = count;
        
        const countdownInterval = setInterval(() => {
            count--;
            if (count > 0) {
                countdown.textContent = count;
            } else if (count === 0) {
                countdown.textContent = 'GO!';
            } else {
                countdown.classList.add('hidden');
                clearInterval(countdownInterval);
                this.gameEngine.start();
            }
        }, 1000);
    }

    initializeGame() {
        const canvas = document.getElementById('gameCanvas');
        this.gameEngine = new GameEngine(canvas, this.socket, this.playerId);
    }

    backToMenu() {
        if (this.gameEngine) {
            this.gameEngine.stop();
            this.gameEngine = null;
        }
        this.leaveRoom();
    }

    updatePlayersList(players) {
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = '<h3>Joueurs connectés:</h3>';
        
        players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-item';
            
            const colorDiv = document.createElement('div');
            colorDiv.className = 'player-color';
            colorDiv.style.backgroundColor = player.color;
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = player.pseudo;
            
            const statusSpan = document.createElement('span');
            statusSpan.textContent = player.ready ? ' ✓' : ' ⏳';
            statusSpan.style.marginLeft = 'auto';
            
            playerDiv.appendChild(colorDiv);
            playerDiv.appendChild(nameSpan);
            playerDiv.appendChild(statusSpan);
            
            playersList.appendChild(playerDiv);
        });
    }

    setupKeyboardControls() {
        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false,
            space: false
        };

        // Boucle d'envoi continu des inputs
        this.inputInterval = setInterval(() => {
            if (this.gameEngine && this.gameEngine.isRunning) {
                this.sendInput();
            }
        }, 1000 / 30); // 30 FPS pour les inputs

        document.addEventListener('keydown', (e) => {
            // Ne pas intercepter les touches si on est dans un champ de saisie
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
                return;
            }
            
            switch(e.code) {
                case 'ArrowUp':
                case 'KeyW':
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
        this.socket.emit('playerInput', {
            up: this.keys.up,
            down: this.keys.down,
            left: this.keys.left,
            right: this.keys.right,
            space: this.keys.space
        });
    }

    showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });
        
        document.getElementById(screenName).classList.remove('hidden');
        this.currentScreen = screenName;
    }
}

// Initialiser le client quand la page est chargée
document.addEventListener('DOMContentLoaded', async () => {
    // Charger les assets avant d'initialiser le client
    try {
        await window.assetManager.loadAssets();
        console.log('Assets chargés, initialisation du client...');
    } catch (error) {
        console.error('Erreur lors du chargement des assets:', error);
        console.log('Initialisation du client sans assets...');
    }
    
    // Toujours initialiser le client, avec ou sans assets
    window.gameClient = new GameClient();
    console.log('Client initialisé avec succès !');
});

