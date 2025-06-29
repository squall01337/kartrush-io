import soundManager from './soundManager.js';

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

        // Réception des données de la map depuis le serveur
        this.socket.on('mapData', (mapData) => {
            console.log('📦 Map reçue :', mapData);
            this.mapData = mapData;
            if (this.gameEngine) {
                this.gameEngine.setMapData(mapData);
            }
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

        // ÉVÉNEMENTS DE COURSE
        this.socket.on('lapStarted', (data) => {
            console.log('🏁 Tour 1 commencé !');
            
            // Notification spéciale pour le début du tour 1
            const notification = document.createElement('div');
            notification.className = 'lap-notification';
            notification.innerHTML = `
                <div class="lap-icon">🏁</div>
                <div class="lap-text">${data.message}</div>
            `;
            
            notification.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 200, 0, 0.9);
                padding: 20px 40px;
                border-radius: 20px;
                color: white;
                font-size: 2em;
                font-weight: bold;
                z-index: 200;
                animation: lapZoom 0.8s ease-out;
                box-shadow: 0 0 30px rgba(0, 255, 0, 0.5);
            `;
            
            document.getElementById('game').appendChild(notification);
            
            // Son de début de tour
            const lapSound = new Audio('assets/audio/lap.mp3');
            lapSound.volume = 0.8;
            lapSound.play().catch(e => {
                // Fallback Web Audio
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator1 = audioContext.createOscillator();
                const oscillator2 = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator1.connect(gainNode);
                oscillator2.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator1.frequency.value = 523; // Do
                oscillator2.frequency.value = 659; // Mi
                gainNode.gain.value = 0.3;
                
                oscillator1.start();
                oscillator2.start();
                oscillator1.stop(audioContext.currentTime + 0.3);
                oscillator2.stop(audioContext.currentTime + 0.3);
            });
            
            setTimeout(() => {
                notification.style.animation = 'fadeOut 0.5s ease-out';
                setTimeout(() => notification.remove(), 500);
            }, 2000);
        });

        this.socket.on('checkpointPassed', (data) => {
            console.log(`✅ Checkpoint ${data.checkpoint}/${data.total} passé !`);
            
            // Son de checkpoint
            const checkpointSound = new Audio('assets/audio/checkpoint.mp3');
            checkpointSound.volume = 0.7;
            checkpointSound.play().catch(e => {
                // Fallback : son simple si pas de fichier audio
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.value = 800; // Fréquence haute
                gainNode.gain.value = 0.3;
                
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.1); // Son court
            });
            
            // Notification visuelle
            this.showCheckpointNotification(data);
        });

        this.socket.on('wrongCheckpoint', (data) => {
            console.log(`❌ ${data.message}`);
            this.showNotification({
                text: data.message,
                type: 'error',
                icon: '❌'
            });
            
            // Son d'erreur
            const errorSound = new Audio('assets/audio/error.mp3');
            errorSound.volume = 0.5;
            errorSound.play().catch(e => {
                // Fallback
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.value = 200; // Fréquence basse pour erreur
                gainNode.gain.value = 0.3;
                
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.2);
            });
        });

        this.socket.on('invalidFinish', (data) => {
            console.log(`⚠️ ${data.message}`);
            this.showNotification({
                text: data.message,
                type: 'warning',
                icon: '⚠️'
            });
        });

        this.socket.on('lapCompleted', (data) => {
            console.log(`🏁 Tour ${data.lap}/${data.totalLaps} complété !`);
            
            // Son de passage de tour
            const lapSound = new Audio('assets/audio/lap.mp3');
            lapSound.volume = 0.8;
            lapSound.play().catch(e => {
                // Fallback : son plus élaboré pour le tour
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator1 = audioContext.createOscillator();
                const oscillator2 = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator1.connect(gainNode);
                oscillator2.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                // Double ton pour un effet plus marqué
                oscillator1.frequency.value = 600;
                oscillator2.frequency.value = 900;
                gainNode.gain.value = 0.3;
                
                oscillator1.start();
                oscillator2.start();
                oscillator1.stop(audioContext.currentTime + 0.2);
                oscillator2.stop(audioContext.currentTime + 0.2);
            });
            
            // Notification visuelle du tour
            this.showLapNotification(data);
        });

        this.socket.on('timeWarning', (data) => {
            console.log(`⏱️ ${data.message}`);
            this.showTimeWarning(data);
        });

        this.socket.on('playerFinished', (data) => {
            console.log(`🏁 ${data.pseudo} a terminé en position ${data.position}!`);
            
            // Afficher une notification
            this.showFinishNotification(data);
            
            // Si c'est nous qui avons fini
            if (data.playerId === this.playerId) {
                this.showPersonalFinish(data);
            }
        });

        this.socket.on('raceEnded', (data) => {
            console.log('🏁 Course terminée !');
            
            // Attendre un peu pour laisser voir la fin
            setTimeout(() => {
                this.showRaceResults(data.results);
            }, 2000);
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

    // Méthode générique pour les notifications
    showNotification(options) {
        const notification = document.createElement('div');
        notification.className = 'game-notification';
        notification.innerHTML = `
            <div class="notification-icon">${options.icon || '📢'}</div>
            <div class="notification-text">${options.text}</div>
        `;
        
        // Style selon le type
        const colors = {
            success: 'rgba(0, 255, 0, 0.8)',
            error: 'rgba(255, 0, 0, 0.8)',
            warning: 'rgba(255, 165, 0, 0.8)',
            info: 'rgba(0, 150, 255, 0.8)'
        };
        
        notification.style.cssText = `
            position: absolute;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: ${colors[options.type] || colors.info};
            padding: 15px 30px;
            border-radius: 25px;
            color: white;
            font-weight: bold;
            z-index: 150;
            animation: notificationSlide 0.5s ease-out;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        `;
        
        document.getElementById('game').appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.5s ease-out';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    showCheckpointNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'checkpoint-notification';
        notification.innerHTML = `
            <div class="checkpoint-icon">✅</div>
            <div class="checkpoint-text">Checkpoint ${data.checkpoint}/${data.total}</div>
        `;
        
        notification.style.cssText = `
            position: absolute;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 255, 0, 0.8);
            padding: 10px 20px;
            border-radius: 20px;
            color: white;
            font-weight: bold;
            z-index: 100;
            animation: checkpointPulse 0.5s ease-out;
        `;
        
        document.getElementById('game').appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.5s ease-out';
            setTimeout(() => notification.remove(), 500);
        }, 1500);
    }

    showLapNotification(data) {
        const notification = document.createElement('div');
        const isLastLap = data.lap === data.totalLaps;
        const isSecondToLastLap = data.lap === data.totalLaps - 1;
        
        let message = `Tour ${data.lap}/${data.totalLaps}`;
        if (isLastLap) message = 'DERNIER TOUR !';
        
        notification.className = 'lap-notification';
        notification.innerHTML = `
            <div class="lap-icon">🏁</div>
            <div class="lap-text">${message}</div>
        `;
        
        notification.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: ${isLastLap ? 'rgba(255, 165, 0, 0.9)' : 'rgba(0, 100, 255, 0.9)'};
            padding: 20px 40px;
            border-radius: 20px;
            color: white;
            font-size: 2em;
            font-weight: bold;
            z-index: 200;
            animation: lapZoom 0.8s ease-out;
        `;
        
        document.getElementById('game').appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.5s ease-out';
            setTimeout(() => notification.remove(), 500);
        }, 2000);
    }

    showTimeWarning(data) {
        // Créer l'avertissement
        const warning = document.createElement('div');
        warning.className = 'time-warning';
        warning.innerHTML = `
            <div class="warning-icon">⏱️</div>
            <div class="warning-text">${data.message}</div>
        `;
        
        warning.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 0, 0, 0.9);
            padding: 20px 40px;
            border-radius: 10px;
            border: 3px solid #ffffff;
            color: white;
            font-size: 1.5em;
            font-weight: bold;
            z-index: 300;
            animation: warningPulse 1s ease-in-out infinite;
        `;
        
        document.getElementById('game').appendChild(warning);
        
        // Retirer après 3 secondes
        setTimeout(() => {
            warning.style.animation = 'fadeOut 0.5s ease-out';
            setTimeout(() => warning.remove(), 500);
        }, 3000);
    }

    showFinishNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'finish-notification';
        notification.innerHTML = `
            <span class="finish-position">#${data.position}</span>
            <span class="finish-player">${data.pseudo}</span>
            <span class="finish-time">${this.formatTime(data.finishTime)}</span>
        `;
        
        notification.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            padding: 15px 20px;
            border-radius: 10px;
            border: 2px solid #ffd700;
            color: white;
            font-weight: bold;
            z-index: 150;
            animation: slideIn 0.5s ease-out;
        `;
        
        document.getElementById('game').appendChild(notification);
        
        // Retirer après 5 secondes
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.5s ease-out';
            setTimeout(() => notification.remove(), 500);
        }, 5000);
    }

    showPersonalFinish(data) {
        const message = document.createElement('div');
        message.className = 'personal-finish';
        
        let positionText = '';
        switch(data.position) {
            case 1: positionText = '🥇 1ST PLACE!'; break;
            case 2: positionText = '🥈 2ND PLACE!'; break;
            case 3: positionText = '🥉 3RD PLACE!'; break;
            default: positionText = `${data.position}TH PLACE!`;
        }
        
        message.innerHTML = `
            <div class="finish-position-big">${positionText}</div>
            <div class="finish-time-big">${this.formatTime(data.finishTime)}</div>
        `;
        
        message.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            z-index: 200;
            animation: finishZoom 1s ease-out;
        `;
        
        document.getElementById('game').appendChild(message);
        
        // Son de victoire si disponible
        if (data.position <= 3) {
            // Jouer un son de victoire
            const audio = new Audio('assets/audio/victory.mp3');
            audio.volume = 0.5;
            audio.play().catch(e => console.log('Son non disponible'));
        }
    }

    formatTime(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = Math.floor((ms % 1000) / 10);
        return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }

    showRaceResults(results) {
        // Arrêter le moteur de jeu
        if (this.gameEngine) {
            this.gameEngine.stop();
        }
        
        // Remplir le tableau des résultats
        const ranking = document.getElementById('finalRanking');
        ranking.innerHTML = '';
        
        results.forEach((player, index) => {
            const rankDiv = document.createElement('div');
            rankDiv.className = 'rank-item';
            
            // Médailles pour le podium
            let medal = '';
            if (index === 0) medal = '🥇';
            else if (index === 1) medal = '🥈';
            else if (index === 2) medal = '🥉';
            
            const position = document.createElement('span');
            position.className = 'rank-position';
            position.innerHTML = `${medal} #${index + 1}`;
            
            const playerInfo = document.createElement('div');
            playerInfo.className = 'rank-player';
            
            const colorDiv = document.createElement('div');
            colorDiv.className = 'player-color';
            colorDiv.style.backgroundColor = player.color;
            
            const name = document.createElement('span');
            name.textContent = player.pseudo;
            name.style.marginLeft = '10px';
            
            // Mettre en évidence notre résultat
            if (player.id === this.playerId) {
                rankDiv.style.backgroundColor = 'rgba(255, 215, 0, 0.2)';
                rankDiv.style.border = '2px solid #ffd700';
            }
            
            const time = document.createElement('span');
            time.className = 'rank-time';
            
            if (player.finished && player.finishTime) {
                time.textContent = this.formatTime(player.finishTime);
            } else if (player.dnf) {
                time.textContent = 'DNF - Temps écoulé';
                time.style.color = '#ff6666';
            } else {
                time.textContent = `Tour ${player.lap}/${this.gameEngine.gameState.totalLaps || 3}`;
                time.style.color = '#ff6666';
            }
            
            playerInfo.appendChild(colorDiv);
            playerInfo.appendChild(name);
            
            rankDiv.appendChild(position);
            rankDiv.appendChild(playerInfo);
            rankDiv.appendChild(time);
            
            ranking.appendChild(rankDiv);
        });
        
        // Afficher l'écran des résultats
        this.showScreen('results');
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

        // Appliquer les données de la map si elles ont déjà été reçues
        if (this.mapData && this.gameEngine) {
            this.gameEngine.setMapData(this.mapData);
        }

        this.canControl = false; // Bloquer les contrôles
        this.gameEngine.start(); // Lancer le rendu pour éviter l'écran noir

        const countdown = document.getElementById('countdown');
        countdown.classList.remove('hidden');

        let count = 3;
        countdown.textContent = count;

        soundManager.playCountdown(); // Un seul son de décompte

        const countdownInterval = setInterval(() => {
            count--;

            if (count > 0) {
                countdown.textContent = count;
            } else if (count === 0) {
                countdown.textContent = 'GO!';
                
                // Débloquer les contrôles dès l'affichage du GO!
                this.canControl = true;

                // Masquer le "GO!" après 800ms
                setTimeout(() => {
                    countdown.classList.add('hidden');
                }, 800);

                clearInterval(countdownInterval);
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
                    if (!this.keys.up) {
                        soundManager.playEngine(); // Démarrer la boucle moteur
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
                    soundManager.stopEngine(); // Arrêter la boucle moteur
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