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
        this.isHost = false;
        this.hostId = null; // Nouveau : ID de l'hôte actuel
        this.rematchVotes = 0; // Nouveau : compteur de votes
        this.totalPlayers = 0; // Nouveau : nombre total de joueurs
        
        // Gestion des maps
        this.availableMaps = [];
        this.selectedMap = null;
        this.currentMapPage = 0;
        this.mapsPerPage = 6;
        
        this.initializeUI();
        this.connectToServer();
        this.loadAvailableMaps();
    }

    // Nouvelle méthode pour charger la liste des maps disponibles
    async loadAvailableMaps() {
        try {
            // Essayer de charger depuis le serveur
            const response = await fetch('/api/maps');
            if (response.ok) {
                const data = await response.json();
                this.availableMaps = data.maps.map(map => ({
                    id: map.id,
                    name: map.name,
                    thumbnail: map.thumbnail // Utiliser directement le chemin du JSON
                }));
                console.log('✅ Maps chargées depuis le serveur:', this.availableMaps);
            } else {
                throw new Error('Impossible de charger les maps');
            }
        } catch (error) {
            console.warn('⚠️ Chargement des maps échoué, utilisation de la liste statique');
            // Fallback sur la liste statique
            this.availableMaps = [
                { id: 'lava_track', name: 'City', thumbnail: 'assets/track_background.png' },
                { id: 'ice_circuit', name: 'Lava world', thumbnail: 'assets/track_background.png2' },
                { id: 'desert_rally', name: 'Rallye du Désert', thumbnail: 'assets/track_background.png3' },
                { id: 'forest_trail', name: 'Sentier Forestier', thumbnail: 'assets/track_background.png4' },
                { id: 'space_station', name: 'Station Spatiale', thumbnail: 'assets/space_background.png' },
                { id: 'underwater_tunnel', name: 'Tunnel Sous-Marin', thumbnail: 'assets/underwater_background.png' },
                { id: 'volcano_escape', name: 'Évasion du Volcan', thumbnail: 'assets/volcano_background.png' },
                { id: 'crystal_caves', name: 'Grottes de Cristal', thumbnail: 'assets/crystal_background.png' },
                { id: 'rainbow_road', name: 'Route Arc-en-ciel', thumbnail: 'assets/rainbow_background.png' },
                { id: 'cyber_city', name: 'Cyber Cité', thumbnail: 'assets/cyber_background.png' }
            ];
        }
        
        // Sélectionner la première map par défaut
        if (this.availableMaps.length > 0) {
            this.selectedMap = this.availableMaps[0].id;
        }
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
        
        // Bouton rejoindre avec code
        document.getElementById('joinWithCode').addEventListener('click', () => {
            this.joinWithCode();
        });
        
        // Formater automatiquement le code en majuscules
        document.getElementById('roomCodeInput').addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        document.getElementById('leaveRoom').addEventListener('click', () => {
            this.leaveRoom();
        });

        // Modifier le handler du bouton startGame
        document.getElementById('startGame').addEventListener('click', () => {
            if (this.isHost) {
                this.hostStartGame();
            } else {
                this.playerReady();
            }
        });

        // Nouveaux handlers pour l'écran de résultats
        document.getElementById('playAgain').addEventListener('click', () => {
            this.voteRematch();
        });

        document.getElementById('backToMenu').addEventListener('click', () => {
            this.leaveResults();
        });

        // Gestion des touches
        this.setupKeyboardControls();
        
        // Initialiser le sélecteur de maps
        this.initializeMapSelector();
    }

    // Nouvelle méthode pour initialiser le sélecteur de maps
    initializeMapSelector() {
        const prevBtn = document.getElementById('mapPrevBtn');
        const nextBtn = document.getElementById('mapNextBtn');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.navigateMaps(-1));
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.navigateMaps(1));
        }
        
        // Écouter les clics sur les maps
        document.getElementById('mapGrid').addEventListener('click', (e) => {
            const mapItem = e.target.closest('.map-item');
            if (mapItem && this.isHost) {
                this.selectMap(mapItem.dataset.mapId);
            }
        });
    }

    // Méthode pour naviguer entre les pages de maps
    navigateMaps(direction) {
        const totalPages = Math.ceil(this.availableMaps.length / this.mapsPerPage);
        this.currentMapPage = Math.max(0, Math.min(totalPages - 1, this.currentMapPage + direction));
        this.renderMapSelector();
    }

    // Méthode pour sélectionner une map
    selectMap(mapId) {
        if (!this.isHost) return;
        
        this.selectedMap = mapId;
        this.renderMapSelector();
        
        // Mettre à jour l'affichage du nom
        const mapInfo = this.availableMaps.find(m => m.id === mapId);
        if (mapInfo) {
            const selectedMapName = document.getElementById('selectedMapName');
            if (selectedMapName) {
                selectedMapName.textContent = mapInfo.name;
            }
        }
        
        // Envoyer la sélection au serveur
        this.socket.emit('selectMap', { mapId: mapId });
        
        // Feedback visuel
        const selectedItem = document.querySelector(`.map-item[data-map-id="${mapId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('pulse');
            setTimeout(() => selectedItem.classList.remove('pulse'), 500);
        }
    }

    // Méthode pour afficher le sélecteur de maps
    renderMapSelector() {
        const mapGrid = document.getElementById('mapGrid');
        const prevBtn = document.getElementById('mapPrevBtn');
        const nextBtn = document.getElementById('mapNextBtn');
        
        if (!mapGrid) return;
        
        // Calculer les maps à afficher
        const startIdx = this.currentMapPage * this.mapsPerPage;
        const endIdx = Math.min(startIdx + this.mapsPerPage, this.availableMaps.length);
        const mapsToShow = this.availableMaps.slice(startIdx, endIdx);
        
        // Vider la grille
        mapGrid.innerHTML = '';
        
        // Afficher les maps
        mapsToShow.forEach((map, index) => {
            const mapItem = document.createElement('div');
            mapItem.className = 'map-item';
            mapItem.dataset.mapId = map.id;
            
            if (map.id === this.selectedMap) {
                mapItem.classList.add('selected');
            }
            
            // Créer la miniature
            const thumbnail = document.createElement('div');
            thumbnail.className = 'map-thumbnail';
            
            // Vérifier si l'image existe, sinon afficher un placeholder
            const img = new Image();
            img.onload = () => {
                thumbnail.style.backgroundImage = `url(${map.thumbnail})`;
                thumbnail.style.backgroundSize = 'cover';
                thumbnail.style.backgroundPosition = 'center';
            };
            img.onerror = () => {
                // Placeholder avec l'icône de la map
                thumbnail.classList.add('placeholder');
                thumbnail.innerHTML = '🏁';
            };
            img.src = map.thumbnail;
            
            // Nom de la map
            const nameDiv = document.createElement('div');
            nameDiv.className = 'map-name';
            nameDiv.textContent = map.name;
            
            mapItem.appendChild(thumbnail);
            mapItem.appendChild(nameDiv);
            
            // Animation d'apparition décalée
            mapItem.style.animationDelay = `${index * 0.05}s`;
            
            mapGrid.appendChild(mapItem);
        });
        
        // Gérer l'état des boutons de navigation
        const totalPages = Math.ceil(this.availableMaps.length / this.mapsPerPage);
        prevBtn.disabled = this.currentMapPage === 0;
        nextBtn.disabled = this.currentMapPage >= totalPages - 1;
    }

    connectToServer() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connecté au serveur');
        });

        this.socket.on('joinedRoom', (data) => {
            console.log('📍 Joined room:', data);
            
            this.playerId = data.playerId;
            this.roomId = data.roomId;
            this.isHost = data.isHost || false;
            
            const roomTypeEl = document.getElementById('roomType');
            const roomCodeEl = document.getElementById('roomCode');
            
            if (!roomTypeEl || !roomCodeEl) {
                console.error('❌ Elements roomType ou roomCode introuvables !');
                return;
            }
            
            // Afficher le code pour toutes les rooms
            const code = data.roomCode || data.roomId;
            roomCodeEl.textContent = code;
            roomCodeEl.style.display = 'block';
            
            if (data.isPrivate) {
                roomTypeEl.innerHTML = '🔒 Room Privée' + (this.isHost ? ' (Hôte)' : '');
                roomCodeEl.className = 'room-code private';
            } else {
                roomTypeEl.innerHTML = '🌍 Room Publique';
                roomCodeEl.className = 'room-code public';
            }
            
            console.log('🔑 Code de room:', code);
            
            // Ajouter une info pour partager le code
            this.showRoomShareInfo(code, data.isPrivate);
            
            this.showScreen('lobby');
        });

        // Réception des données de la map depuis le serveur
        this.socket.on('mapData', (mapData) => {
            console.log('📦 Map reçue :', mapData);
            this.mapData = mapData;
            
            // Précharger l'image de background si elle existe
            if (mapData.background && mapData.background.endsWith('.png')) {
                console.log('🖼️ Préchargement du background:', mapData.background);
                const img = new Image();
                img.onload = () => {
                    console.log('✅ Background préchargé avec succès');
                    // Maintenant que l'image est chargée, on peut la passer au gameEngine
                    if (this.gameEngine) {
                        this.gameEngine.setMapData(mapData);
                    }
                };
                img.onerror = () => {
                    console.error('❌ Erreur de préchargement du background');
                    // Même en cas d'erreur, on passe les données
                    if (this.gameEngine) {
                        this.gameEngine.setMapData(mapData);
                    }
                };
                img.src = mapData.background;
            } else {
                // Pas d'image à précharger
                if (this.gameEngine) {
                    this.gameEngine.setMapData(mapData);
                }
            }
        });

        // Modifier le handler playersUpdate
        this.socket.on('playersUpdate', (data) => {
            this.updatePlayersList(data.players);
            this.hostId = data.hostId;
            this.totalPlayers = data.players.length;
            
            const startButton = document.getElementById('startGame');
            const mapSelector = document.getElementById('mapSelector');
            
            // Afficher/masquer le sélecteur de maps selon le statut d'hôte
            if (mapSelector) {
                if (this.isHost) {
                    mapSelector.classList.remove('hidden');
                    this.renderMapSelector();
                } else {
                    mapSelector.classList.add('hidden');
                }
            }
            
            if (this.isHost) {
                // Si on est l'hôte
                if (data.canStart) {
                    startButton.classList.remove('hidden');
                    startButton.textContent = 'Démarrer la course';
                    startButton.disabled = false;
                    startButton.className = 'host-button';
                } else {
                    startButton.classList.remove('hidden');
                    startButton.textContent = 'En attente des joueurs...';
                    startButton.disabled = true;
                    startButton.className = 'host-button waiting';
                }
            } else {
                // Si on n'est pas l'hôte
                const myPlayer = data.players.find(p => p.id === this.playerId);
                if (myPlayer && !myPlayer.ready) {
                    startButton.classList.remove('hidden');
                    startButton.textContent = 'Prêt';
                    startButton.disabled = false;
                    startButton.className = 'ready';
                } else if (myPlayer && myPlayer.ready) {
                    startButton.classList.remove('hidden');
                    startButton.textContent = 'En attente de l\'hôte...';
                    startButton.disabled = true;
                    startButton.className = 'waiting';
                } else {
                    // Cas où le joueur n'est pas trouvé
                    startButton.classList.add('hidden');
                }
            }
        });

        // Nouveau : Réception de la map sélectionnée
        this.socket.on('mapSelected', (data) => {
            this.selectedMap = data.mapId;
            
            // Mettre à jour l'affichage du nom pour tous
            const mapInfo = this.availableMaps.find(m => m.id === data.mapId);
            if (mapInfo) {
                const selectedMapName = document.getElementById('selectedMapName');
                if (selectedMapName) {
                    selectedMapName.textContent = mapInfo.name;
                }
                
                if (!this.isHost) {
                    // Notification seulement pour les non-hôtes
                    this.showNotification({
                        text: `Map sélectionnée : ${mapInfo.name}`,
                        type: 'info',
                        icon: '🗺️'
                    });
                }
            }
            
            this.renderMapSelector();
        });

        this.socket.on('gameStarted', () => {
            this.startGameCountdown();
        });

        this.socket.on('gameUpdate', (gameData) => {
            if (this.gameEngine) {
                this.gameEngine.updateGameState(gameData);
            }
        });

        // Nouveau : Changement d'hôte
        this.socket.on('hostChanged', (data) => {
            this.hostId = data.newHostId;
            this.isHost = (data.newHostId === this.playerId);
            
            if (this.isHost) {
                this.showNotification({
                    text: 'Vous êtes maintenant l\'hôte !',
                    type: 'info',
                    icon: '👑'
                });
                
                // Afficher le sélecteur de maps si on devient hôte
                const mapSelector = document.getElementById('mapSelector');
                if (mapSelector) {
                    mapSelector.classList.remove('hidden');
                    this.renderMapSelector();
                }
            } else {
                // Masquer le sélecteur si on n'est plus hôte
                const mapSelector = document.getElementById('mapSelector');
                if (mapSelector) {
                    mapSelector.classList.add('hidden');
                }
            }
        });
        
        // Nouveau : Vote de rematch
        this.socket.on('rematchVote', (data) => {
            this.rematchVotes = data.votes;
            this.updateRematchButton();
        });
        
        // Nouveau : Rematch qui démarre
        this.socket.on('rematchStarting', (data) => {
            this.rematchVotes = 0;
            
            // Nettoyer les notifications avant de retourner au lobby
            this.cleanupGameNotifications();
            
            this.showScreen('lobby');
            
            // Arrêter la musique si elle joue encore
            if (this.gameEngine && this.gameEngine.music) {
                this.gameEngine.music.pause();
                this.gameEngine.music = null;
            }
            
            this.showNotification({
                text: 'Nouvelle partie dans le même lobby !',
                type: 'success',
                icon: '🔄'
            });
        });
        
        // Nouveau : Retour au lobby forcé
        this.socket.on('returnToLobby', () => {
            this.rematchVotes = 0;
            this.showScreen('lobby');
            
            // Arrêter la musique
            if (this.gameEngine && this.gameEngine.music) {
                this.gameEngine.music.pause();
                this.gameEngine.music = null;
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
                
                // Afficher un message d'attente
                setTimeout(() => {
                    this.showNotification({
                        text: 'En attente que tous les joueurs terminent...',
                        type: 'info',
                        icon: '⏳'
                    });
                }, 3000);
            }
        });

        // Modifier raceEnded pour afficher les résultats après un délai
        this.socket.on('raceEnded', (data) => {
            console.log('🏁 Course terminée ! Tous les joueurs ont fini.');
            
            // Notification que la course est terminée
            this.showNotification({
                text: 'Course terminée ! Tous les joueurs ont fini.',
                type: 'success',
                icon: '🏆'
            });
            
            // Attendre 2 secondes avant d'afficher les résultats
            setTimeout(() => {
                // Arrêter le moteur de jeu et la musique
                if (this.gameEngine) {
                    this.gameEngine.stop();
                    if (this.gameEngine.music) {
                        this.gameEngine.music.pause();
                        this.gameEngine.music = null;
                    }
                }
                
                // Afficher les résultats
                this.showRaceResults(data.results);
                this.startRematchTimer();
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

        this.socket.on('kickedFromLobby', (data) => {
            console.log('❌ Kicked du lobby:', data.reason);
            this.showScreen('menu');
            
            // Arrêter la musique
            if (this.gameEngine && this.gameEngine.music) {
                this.gameEngine.music.pause();
                this.gameEngine.music = null;
            }
            
            // Notification
            alert('Vous avez été exclu du lobby car vous n\'avez pas voté pour rejouer.');
        });

        this.socket.on('disconnect', () => {
            console.log('Déconnecté du serveur');
            this.showScreen('menu');
        });
    }

    // Nouvelle méthode pour afficher comment partager le code
    showRoomShareInfo(code, isPrivate) {
        // Créer une notification temporaire
        const notification = document.createElement('div');
        notification.className = 'room-share-info';
        notification.innerHTML = `
            <div class="share-icon">📋</div>
            <div class="share-text">
                ${isPrivate ? 'Partagez ce code privé' : 'Code de la partie publique'} : <strong>${code}</strong>
                <br><small>Les amis peuvent rejoindre avec ce code</small>
            </div>
        `;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            border: 2px solid ${isPrivate ? '#ff6b6b' : '#4ecdc4'};
            z-index: 1000;
            animation: slideIn 0.5s ease-out;
            cursor: pointer;
        `;
        
        // Copier le code au clic
        notification.addEventListener('click', () => {
            navigator.clipboard.writeText(code).then(() => {
                notification.innerHTML = `
                    <div class="share-icon">✅</div>
                    <div class="share-text">Code copié !</div>
                `;
                setTimeout(() => notification.remove(), 1000);
            }).catch(() => {
                // Fallback si clipboard non disponible
                alert(`Code de la room : ${code}`);
            });
        });
        
        document.body.appendChild(notification);
        
        // Retirer après 5 secondes
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.5s ease-out';
            setTimeout(() => notification.remove(), 500);
        }, 5000);
    }

    // Méthode pour rejoindre avec code
    joinWithCode() {
        const pseudo = document.getElementById('pseudo').value.trim();
        const roomCode = document.getElementById('roomCodeInput').value.trim();
        
        if (!pseudo) {
            alert('Veuillez entrer un pseudo');
            return;
        }
        
        if (!roomCode) {
            alert('Veuillez entrer un code de room');
            return;
        }
        
        if (roomCode.length !== 6) {
            alert('Le code de room doit contenir 6 caractères');
            return;
        }
        
        this.socket.emit('joinRoomWithCode', {
            pseudo: pseudo,
            color: this.selectedColor,
            roomCode: roomCode.toUpperCase()
        });
    }

    // Nouvelles méthodes
    hostStartGame() {
        this.socket.emit('hostStartGame');
    }

    playerReady() {
        this.socket.emit('playerReady');
        document.getElementById('startGame').disabled = true;
        document.getElementById('startGame').textContent = 'En attente...';
    }

    voteRematch() {
        this.socket.emit('voteRematch');
        const btn = document.getElementById('playAgain');
        btn.disabled = true;
        btn.textContent = `Vote enregistré (${this.rematchVotes + 1}/${this.totalPlayers})`;
        btn.className = 'voted';
    }

    leaveResults() {
        this.socket.emit('leaveResults');
        this.backToMenu();
    }

    updateRematchButton() {
        const btn = document.getElementById('playAgain');
        if (!btn.disabled) {
            btn.textContent = `Rejouer (${this.rematchVotes}/${this.totalPlayers})`;
        } else {
            btn.textContent = `Vote enregistré (${this.rematchVotes}/${this.totalPlayers})`;
        }
    }

    startRematchTimer() {
        this.rematchVotes = 0;
        let timeLeft = 10;
        
        // Supprimer l'ancien timer s'il existe
        const oldTimer = document.querySelector('.rematch-timer');
        if (oldTimer) oldTimer.remove();
        
        const timerDiv = document.createElement('div');
        timerDiv.className = 'rematch-timer';
        timerDiv.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            padding: 15px 25px;
            border-radius: 10px;
            font-size: 1.2em;
            z-index: 100;
        `;
        
        document.getElementById('results').appendChild(timerDiv);
        
        const intervalId = setInterval(() => {
            timerDiv.textContent = `Retour au lobby dans : ${timeLeft}s`;
            if (timeLeft <= 0) {
                clearInterval(intervalId);
                timerDiv.remove();
            } else {
                timeLeft--;
            }
        }, 1000);
        
        // Commencer avec l'affichage immédiat
        timerDiv.textContent = `Retour au lobby dans : ${timeLeft}s`;
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
        // NE PAS arrêter le moteur ici, il a déjà été arrêté
        
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
                time.textContent = `Tour ${player.lap}/${3}`;
                time.style.color = '#ff6666';
            }
            
            playerInfo.appendChild(colorDiv);
            playerInfo.appendChild(name);
            
            rankDiv.appendChild(position);
            rankDiv.appendChild(playerInfo);
            rankDiv.appendChild(time);
            
            ranking.appendChild(rankDiv);
        });
        
        // Réinitialiser le bouton rejouer
        const playAgainBtn = document.getElementById('playAgain');
        playAgainBtn.disabled = false;
        playAgainBtn.textContent = 'Rejouer';
        playAgainBtn.className = '';
        
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
        
        // Nettoyer toutes les notifications restantes de la partie précédente
        this.cleanupGameNotifications();
        
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

    // Nouvelle méthode pour nettoyer toutes les notifications du jeu
    cleanupGameNotifications() {
        const gameElement = document.getElementById('game');
        if (!gameElement) return;
        
        // Sélectionner et supprimer toutes les notifications
        const notifications = gameElement.querySelectorAll(
            '.personal-finish, .finish-notification, .game-notification, ' +
            '.checkpoint-notification, .lap-notification, .time-warning, .final-lap-message'
        );
        
        notifications.forEach(notification => {
            notification.remove();
        });
        
        console.log('🧹 Nettoyage des notifications:', notifications.length, 'éléments supprimés');
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

    // Modifier updatePlayersList pour afficher l'hôte
    updatePlayersList(players) {
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = '<h3>Joueurs connectés:</h3>';
        
        players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-item';
            
            // Ajouter la classe is-host si c'est l'hôte
            if (player.isHost) {
                playerDiv.className += ' is-host';
            }
            
            const colorDiv = document.createElement('div');
            colorDiv.className = 'player-color';
            colorDiv.style.backgroundColor = player.color;
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = player.pseudo;
            
            // Indicateur d'hôte amélioré
            if (player.isHost) {
                const hostBadge = document.createElement('span');
                hostBadge.className = 'host-badge';
                hostBadge.textContent = ' 👑';
                hostBadge.title = 'Hôte de la partie';
                hostBadge.style.marginLeft = '5px';
                nameSpan.appendChild(hostBadge);
            }
            
            const statusDiv = document.createElement('div');
            statusDiv.className = 'player-status';
            statusDiv.style.marginLeft = 'auto';
            
            if (player.isHost) {
                const statusText = document.createElement('span');
                statusText.className = 'status-text';
                statusText.textContent = 'Hôte';
                statusText.style.color = '#ffd700';
                statusDiv.appendChild(statusText);
            } else {
                const statusIcon = document.createElement('span');
                statusIcon.className = 'status-icon';
                statusIcon.textContent = player.ready ? '✓' : '⏳';
                statusDiv.appendChild(statusIcon);
            }
            
            playerDiv.appendChild(colorDiv);
            playerDiv.appendChild(nameSpan);
            playerDiv.appendChild(statusDiv);
            
            // Mettre en évidence notre propre entrée
            if (player.id === this.playerId) {
                playerDiv.style.border = '2px solid #4ecdc4';
                playerDiv.style.backgroundColor = 'rgba(78, 205, 196, 0.1)';
            }
            
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

// Classe GameEngine dans le fichier client.js (pour la référence)
// Cette classe est utilisée dans client.js
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