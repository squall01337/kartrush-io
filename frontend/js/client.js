import soundManager from './soundManager.js';

// Client WebSocket et gestion de l'interface
class GameClient {
    constructor() {
        this.socket = null;
        this.playerId = null;
        this.roomId = null;
        this.gameEngine = null;
        this.currentScreen = 'splash'; // Commencer sur l'écran d'accueil
        this.selectedColor = '#ff4444'; // Couleur par défaut
        this.isHost = false;
        this.hostId = null; // Nouveau : ID de l'hôte actuel
        this.rematchVotes = 0; // Nouveau : compteur de votes
        this.totalPlayers = 0; // Nouveau : nombre total de joueurs
        this.hasUsedSpace = false; // Pour éviter le spam de la touche espace
        
        // Gestion des maps
        this.availableMaps = [];
        this.selectedMap = null;
        this.currentMapPage = 0;
        this.mapsPerPage = 6;
        
        // Musique de fond
        this.backgroundMusic = null;
        
        this.initializeUI();
        // Ne pas se connecter tout de suite, attendre le clic sur PLAY
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
                    thumbnail: map.thumbnail
                }));
            } else {
                throw new Error('Impossible de charger les maps');
            }
        } catch (error) {
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

    // Méthode appelée quand on clique sur PLAY
    onPlayButtonClick() {
        // Initialiser et lancer la musique de fond
        this.backgroundMusic = new Audio('assets/audio/kartrush_theme.mp3');
        this.backgroundMusic.loop = true;
        this.backgroundMusic.volume = soundManager.getVolumeFor('backgroundMusic');
        this.backgroundMusic.play().catch(e => {
            console.log('Musique de fond autorisée par le clic utilisateur');
        });
        
        // Enregistrer la musique dans le gestionnaire
        soundManager.registerAudio('backgroundMusic', this.backgroundMusic);
        
        // Se connecter au serveur et charger les maps
        this.connectToServer();
        this.loadAvailableMaps();
        
        // Passer au menu principal
        this.showScreen('menu');
    }

    initializeUI() {
        // Bouton PLAY de l'écran d'accueil
        const playButton = document.getElementById('playButton');
        if (playButton) {
            playButton.addEventListener('click', () => {
                this.onPlayButtonClick();
            });
        }
        
        // Sélection de couleur dans le lobby
        this.initializeLobbyColorSelector();

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

    // Nouvelle méthode pour gérer le sélecteur de couleur dans le lobby
    initializeLobbyColorSelector() {
        // Gérer le sélecteur de couleur dans le lobby
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('lobby-color-option')) {
                // Retirer la sélection précédente
                document.querySelectorAll('.lobby-color-option').forEach(opt => 
                    opt.classList.remove('selected')
                );
                
                // Sélectionner la nouvelle couleur
                e.target.classList.add('selected');
                const newColor = e.target.dataset.color;
                
                // Si la couleur a changé et qu'on est dans une room
                if (this.selectedColor !== newColor && this.roomId) {
                    this.selectedColor = newColor;
                    
                    // Envoyer la mise à jour au serveur
                    this.socket.emit('changeColor', {
                        color: newColor
                    });
                    
                    // Animation visuelle
                    e.target.style.animation = 'colorPulse 0.5s ease-out';
                    setTimeout(() => {
                        e.target.style.animation = '';
                    }, 500);
                } else {
                    // Si pas encore dans une room, juste mettre à jour la couleur
                    this.selectedColor = newColor;
                }
            }
        });
    }

    // Nouvelle méthode pour mettre à jour l'affichage du sélecteur
    updateLobbyColorSelector() {
        // Mettre à jour la sélection visuelle
        document.querySelectorAll('.lobby-color-option').forEach(opt => {
            opt.classList.remove('selected');
            if (opt.dataset.color === this.selectedColor) {
                opt.classList.add('selected');
            }
        });
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

    // NOUVELLE MÉTHODE : Écran de chargement
    showLoadingScreen() {
        // Afficher l'écran de chargement
        this.showScreen('loading');
        
        // Récupérer les éléments
        const video = document.getElementById('loadingVideo');
        const fillBar = document.querySelector('.loading-bar-fill');
        const percentage = document.querySelector('.loading-percentage');
        const mapNameEl = document.querySelector('.loading-map-name');
        const mapThumbnailEl = document.querySelector('.loading-map-thumbnail');
        
        // Réinitialiser la barre
        fillBar.style.width = '0%';
        percentage.textContent = '0%';
        
        // Afficher les infos de la map sélectionnée
        const mapInfo = this.availableMaps.find(m => m.id === this.selectedMap);
        if (mapInfo) {
            // Nom de la map
            mapNameEl.textContent = mapInfo.name;
            
            // Thumbnail de la map
            mapThumbnailEl.classList.remove('placeholder');
            
            // Essayer de charger l'image
            const img = new Image();
            img.onload = () => {
                mapThumbnailEl.style.backgroundImage = `url(${mapInfo.thumbnail})`;
            };
            img.onerror = () => {
                // Si l'image n'existe pas, afficher un placeholder
                mapThumbnailEl.classList.add('placeholder');
                mapThumbnailEl.innerHTML = '🏁';
            };
            img.src = mapInfo.thumbnail;
        } else {
            // Fallback si pas d'info de map
            mapNameEl.textContent = 'Loading Track...';
            mapThumbnailEl.classList.add('placeholder');
            mapThumbnailEl.innerHTML = '🏁';
        }
        
        // Démarrer la vidéo depuis le début
        video.currentTime = 0;
        
        // Durée totale du chargement (5 secondes)
        const loadingDuration = 5000;
        const startTime = Date.now();
        
        // Promesse pour attendre la fin du chargement
        return new Promise((resolve) => {
            // Démarrer la vidéo
            video.play().catch(e => console.log('Erreur lecture vidéo:', e));
            
            // Animation de la barre de progression
            const updateProgress = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min((elapsed / loadingDuration) * 100, 100);
                
                // Mettre à jour la barre et le pourcentage
                fillBar.style.width = `${progress}%`;
                percentage.textContent = `${Math.floor(progress)}%`;
                
                if (progress < 100) {
                    requestAnimationFrame(updateProgress);
                } else {
                    // Petit délai pour voir 100%
                    setTimeout(() => {
                        // Créer l'effet de transition
                        this.transitionToGame(video);
                        resolve();
                    }, 200);
                }
            };
            
            // Démarrer l'animation
            requestAnimationFrame(updateProgress);
            
            // Forcer la résolution après 5.2 secondes au cas où
            setTimeout(() => {
                this.transitionToGame(video);
                resolve();
            }, loadingDuration + 200);
        });
    }

    // Nouvelle méthode pour la transition fluide
    transitionToGame(video) {
        // Créer l'effet de flash
        const flash = document.createElement('div');
        flash.className = 'loading-flash';
        document.body.appendChild(flash);
        
        // Déclencher l'animation de flash
        setTimeout(() => {
            flash.classList.add('active');
        }, 10);
        
        // Ajouter la classe fade-out à l'écran de chargement
        const loadingScreen = document.getElementById('loading');
        loadingScreen.classList.add('fade-out');
        
        // Préparer l'écran de jeu avec la classe fade-in
        const gameScreen = document.getElementById('game');
        gameScreen.classList.add('fade-in');
        
        // Attendre la fin de l'animation avant de changer d'écran
        setTimeout(() => {
            video.pause();
            loadingScreen.classList.remove('fade-out');
            
            // Enlever le flash après l'animation
            setTimeout(() => {
                flash.remove();
                gameScreen.classList.remove('fade-in');
            }, 600);
        }, 800);
    }

    connectToServer() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connecté au serveur');
        });

        this.socket.on('joinedRoom', (data) => {
            this.playerId = data.playerId;
            this.roomId = data.roomId;
            this.isHost = data.isHost || false;
            
            const roomTypeEl = document.getElementById('roomType');
            const roomCodeEl = document.getElementById('roomCode');
            
            if (!roomTypeEl || !roomCodeEl) {
                console.error('❌ Elements roomType ou roomCode introuvables !');
                return;
            }
            
            const code = data.roomCode || data.roomId;
            roomCodeEl.textContent = code;
            roomCodeEl.style.display = 'block';
            
            if (data.isPrivate) {
                roomTypeEl.innerHTML = '🔒 Private Room' + (this.isHost ? ' (Host)' : '');
                roomCodeEl.className = 'room-code private';
            } else {
                roomTypeEl.innerHTML = '🌍 Public Room';
                roomCodeEl.className = 'room-code public';
            }
            
            this.showRoomShareInfo(code, data.isPrivate);
            
            this.showScreen('lobby');
        });

        this.socket.on('mapData', (mapData) => {
            this.mapData = mapData;
            
            if (mapData.background && mapData.background.endsWith('.png')) {
                const img = new Image();
                img.onload = () => {
                    if (this.gameEngine) {
                        this.gameEngine.setMapData(mapData);
                    }
                };
                img.onerror = () => {
                    if (this.gameEngine) {
                        this.gameEngine.setMapData(mapData);
                    }
                };
                img.src = mapData.background;
            } else {
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
                    startButton.textContent = 'Start race';
                    startButton.disabled = false;
                    startButton.className = 'host-button';
                } else {
                    startButton.classList.remove('hidden');
                    startButton.textContent = 'Waiting for players...';
                    startButton.disabled = true;
                    startButton.className = 'host-button waiting';
                }
            } else {
                // Si on n'est pas l'hôte
                const myPlayer = data.players.find(p => p.id === this.playerId);
                if (myPlayer && !myPlayer.ready) {
                    startButton.classList.remove('hidden');
                    startButton.textContent = 'Ready';
                    startButton.disabled = false;
                    startButton.className = 'ready';
                } else if (myPlayer && myPlayer.ready) {
                    startButton.classList.remove('hidden');
                    startButton.textContent = 'Waiting for host...';
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

        // Nouveau : Gérer le changement de couleur
        this.socket.on('colorChanged', (data) => {
            // Mettre à jour la couleur du joueur dans la liste
            const playerItems = document.querySelectorAll('.player-item');
            playerItems.forEach(item => {
                const playerName = item.querySelector('span').textContent;
                // Trouver le joueur par son pseudo (méthode plus fiable)
                const player = this.lastPlayersData?.find(p => p.id === data.playerId);
                if (player && item.textContent.includes(player.pseudo)) {
                    const colorDiv = item.querySelector('.player-color');
                    if (colorDiv) {
                        colorDiv.style.backgroundColor = data.color;
                        
                        // Animation de changement
                        colorDiv.style.animation = 'colorFlash 0.5s ease-out';
                        setTimeout(() => {
                            colorDiv.style.animation = '';
                        }, 500);
                    }
                }
            });
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
                    text: 'You ar\'e now the host !',
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
        
        // Nouveau : Rematch qui démarre (MODIFIÉ)
        this.socket.on('rematchStarting', async (data) => {
            this.rematchVotes = 0;
            
            // Arrêter la musique AVANT de nettoyer les notifications
            if (this.gameEngine && this.gameEngine.music) {
                this.gameEngine.music.pause();
                this.gameEngine.music.currentTime = 0;
                this.gameEngine.music = null;
            }
            
            // Nettoyer les notifications avant de retourner au lobby
            this.cleanupGameNotifications();
            
            // Retourner au lobby SANS écran de chargement pour le rematch
            this.showScreen('lobby');
            
            this.showNotification({
                text: 'Nouvelle partie dans le même lobby !',
                type: 'success',
                icon: '🔄'
            });
        });
        
        // Nouveau : Retour au lobby forcé
        this.socket.on('returnToLobby', () => {
            this.rematchVotes = 0;
            
            // Arrêter la musique
            if (this.gameEngine && this.gameEngine.music) {
                this.gameEngine.music.pause();
                this.gameEngine.music.currentTime = 0;
                this.gameEngine.music = null;
            }
            
            this.showScreen('lobby');
        });

        // ÉVÉNEMENTS DE COURSE
        this.socket.on('lapStarted', (data) => {
            // CORRECTION BUG 2: Supprimer toute notification de tour existante
            const existingNotifications = document.querySelectorAll('.lap-notification');
            existingNotifications.forEach(notif => notif.remove());
            
            const notification = document.createElement('div');
            notification.className = 'lap-notification';
            notification.innerHTML = `
                <span class="lap-icon">🏁</span>
                <span class="lap-text">${data.message}</span>
            `;
            
            notification.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: linear-gradient(135deg, rgba(147, 51, 234, 0.9), rgba(236, 72, 153, 0.9));
                padding: 20px 40px;
                border-radius: 20px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                color: white;
                font-size: 2em;
                font-weight: bold;
                z-index: 200;
                animation: lapZoom 0.8s ease-out;
                box-shadow: 0 0 40px rgba(236, 72, 153, 0.8), inset 0 0 20px rgba(255, 255, 255, 0.2);
                pointer-events: none;
                text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
                display: flex;
                align-items: center;
                gap: 10px;
            `;
            
            document.getElementById('game').appendChild(notification);
            
            // Son de début de tour
            try {
                soundManager.playLap();
            } catch (e) {
                // Fallback Web Audio
                soundManager.playTone(523, 0.3);
                setTimeout(() => soundManager.playTone(659, 0.3), 100);
            }
            
            setTimeout(() => {
                notification.style.animation = 'lapDissolve 0.8s ease-out forwards';
                notification.style.pointerEvents = 'none';
                setTimeout(() => {
                    notification.style.display = 'none';
                    notification.remove();
                }, 790);
            }, 2000);
        });

        this.socket.on('checkpointPassed', (data) => {
            // Checkpoint passé silencieusement
        });

        this.socket.on('wrongCheckpoint', (data) => {
            this.showNotification({
                text: data.message,
                type: 'error',
                icon: '❌'
            });
            
            try {
                soundManager.playError();
            } catch (e) {
                soundManager.playTone(200, 0.2);
            }
        });

        this.socket.on('invalidFinish', (data) => {
            this.showNotification({
                text: data.message,
                type: 'warning',
                icon: '⚠️'
            });
        });

        this.socket.on('lapCompleted', (data) => {
            try {
                soundManager.playLap();
            } catch (e) {
                // Fallback : double ton
                soundManager.playTone(600, 0.2);
                setTimeout(() => soundManager.playTone(900, 0.2), 100);
            }
            
            // Notification visuelle du tour
            this.showLapNotification(data);
        });

        this.socket.on('boostActivated', () => {
            // Jouer le son du boost
            soundManager.playBoost();
        });

        this.socket.on('timeWarning', (data) => {
            this.showTimeWarning(data);
        });

        this.socket.on('playerFinished', (data) => {
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
            this.showNotification({
                text: 'Race ended !',
                type: 'success',
                icon: '🏆'
            });
            
            // Attendre 2 secondes avant d'afficher les résultats
            setTimeout(() => {
                // Arrêter le moteur de jeu et la musique
                if (this.gameEngine) {
                    this.gameEngine.stop();
                    if (this.gameEngine.music) {
                        soundManager.unregisterAudio('gameMusic');
                        this.gameEngine.music.pause();
                        this.gameEngine.music.currentTime = 0;
                        this.gameEngine.music = null;
                    }
                    // Nettoyer complètement le gameEngine
                    this.gameEngine = null;
                }
                
                // Réinitialiser les données de map
                this.mapData = null;
                
                // Afficher les résultats
                this.showRaceResults(data.results);
                this.startRematchTimer();
            }, 2000);
        });

        // NOUVEAU : Événements de dégâts
        this.socket.on('playerDamaged', (data) => {
            // Afficher une notification de dégâts si c'est nous
            if (data.playerId === this.playerId) {
                this.showDamageNotification(data);
            }
        });

        this.socket.on('playerDeath', (data) => {
            // Notification de mort
            if (data.playerId === this.playerId) {
                this.showDeathNotification();
            }
        });

        this.socket.on('playerRespawned', (data) => {
            // Notification de respawn
            if (data.playerId === this.playerId) {
                this.showRespawnNotification();
            }
        });

        this.socket.on('playersCollided', (data) => {
            // Rien de spécial à faire ici, le GameEngine gère déjà l'effet
        });

        this.socket.on('playerJoined', (player) => {
            // Joueur rejoint la partie
        });

        this.socket.on('playerLeft', (data) => {
            // Joueur a quitté la partie  
        });

        this.socket.on('error', (error) => {
            alert(error.message);
        });

        this.socket.on('kickedFromLobby', (data) => {
            this.showScreen('menu');
            
            // Arrêter la musique
            if (this.gameEngine && this.gameEngine.music) {
                soundManager.unregisterAudio('gameMusic');
                this.gameEngine.music.pause();
                this.gameEngine.music.currentTime = 0;
                this.gameEngine.music = null;
            }
        });

        this.socket.on('disconnect', () => {
            this.showScreen('menu');
        });
    }

    // Nouvelles méthodes pour les notifications de dégâts
    showDamageNotification(data) {
        // Créer un indicateur de dégâts flottant
        const notification = document.createElement('div');
        notification.className = 'damage-indicator';
        notification.textContent = `-${Math.floor(data.damage)} HP`;
        
        // Style selon le type de dégâts
        const colors = {
            'scrape': '#ffaa44',
            'crash': '#ff4444',
            'player_collision': '#ff6666'
        };
        
        notification.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -150%);
            color: ${colors[data.damageType] || '#ff4444'};
            font-size: 2em;
            font-weight: bold;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
            z-index: 200;
            animation: damageFloat 1s ease-out forwards;
            pointer-events: none;
        `;
        
        document.getElementById('game').appendChild(notification);
        
        // Retirer après l'animation
        setTimeout(() => notification.remove(), 1000);
    }

    showDeathNotification() {
        const notification = document.createElement('div');
        notification.className = 'death-notification';
        notification.innerHTML = `
            <div class="death-title">DESTROYED!</div>
            <div class="death-subtitle">Respawning in 3...</div>
        `;
        
        notification.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            z-index: 300;
            animation: deathZoom 0.5s ease-out;
            pointer-events: none;
        `;
        
        const titleStyle = `
            font-size: 4em;
            font-weight: bold;
            color: #ff4444;
            text-shadow: 0 0 20px rgba(255, 68, 68, 0.8);
            margin-bottom: 10px;
        `;
        
        const subtitleStyle = `
            font-size: 1.5em;
            color: #ffffff;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
        `;
        
        notification.querySelector('.death-title').style.cssText = titleStyle;
        notification.querySelector('.death-subtitle').style.cssText = subtitleStyle;
        
        document.getElementById('game').appendChild(notification);
        
        // Compte à rebours
        let countdown = 3;
        const interval = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                notification.querySelector('.death-subtitle').textContent = `Respawning in ${countdown}...`;
            } else {
                clearInterval(interval);
                notification.style.animation = 'fadeOut 0.5s ease-out forwards';
                setTimeout(() => notification.remove(), 500);
            }
        }, 1000);
    }

    showRespawnNotification() {
        const notification = document.createElement('div');
        notification.className = 'respawn-notification';
        notification.textContent = 'RESPAWNED!';
        
        notification.style.cssText = `
            position: absolute;
            top: 40%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 2.5em;
            font-weight: bold;
            color: #4ecdc4;
            text-shadow: 0 0 20px rgba(78, 205, 196, 0.8);
            z-index: 200;
            animation: respawnPulse 1.5s ease-out forwards;
            pointer-events: none;
        `;
        
        document.getElementById('game').appendChild(notification);
        
        setTimeout(() => notification.remove(), 1500);
    }

    // Nouvelle méthode pour afficher comment partager le code
    showRoomShareInfo(code, isPrivate) {
        // Créer une notification temporaire
        const notification = document.createElement('div');
        notification.className = 'room-share-info';
        notification.innerHTML = `
            <div class="share-icon">📋</div>
            <div class="share-text">
                ${isPrivate ? 'Share this private code' : 'Public Room code'} : <strong>${code}</strong>
                <br><small>Friends can join with this code</small>
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
                    <div class="share-text">Code copied !</div>
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
            alert('Please enter a nickname');
            return;
        }
        
        if (!roomCode) {
            alert('Please enter a room code');
            return;
        }
        
        if (roomCode.length !== 6) {
            alert('The room code must be 6 carac long');
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
        document.getElementById('startGame').textContent = 'Waiting...';
    }

    voteRematch() {
        this.socket.emit('voteRematch');
        const btn = document.getElementById('playAgain');
        btn.disabled = true;
        btn.textContent = `Vote registered (${this.rematchVotes + 1}/${this.totalPlayers})`;
        btn.className = 'voted';
    }

    leaveResults() {
        this.socket.emit('leaveResults');
        this.backToMenu();
    }

    updateRematchButton() {
        const btn = document.getElementById('playAgain');
        if (!btn.disabled) {
            btn.textContent = `Replay (${this.rematchVotes}/${this.totalPlayers})`;
        } else {
            btn.textContent = `Vote registered (${this.rematchVotes}/${this.totalPlayers})`;
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
        
        // Afficher immédiatement 10s
        timerDiv.textContent = `Return to menu in : ${timeLeft}s`;
        
        const intervalId = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                clearInterval(intervalId);
                timerDiv.textContent = `Return to menu...`;
            } else {
                timerDiv.textContent = `Return to menu in : ${timeLeft}s`;
            }
        }, 1000);
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
        // Fonction vide - checkpoints masqués
    }

    showLapNotification(data) {
        const notification = document.createElement('div');
        const isLastLap = data.lap === data.totalLaps;
        const isSecondToLastLap = data.lap === data.totalLaps - 1;
        
        let message = `Lap ${data.lap}/${data.totalLaps}`;
        if (isLastLap) message = 'FINAL LAP !';
        
        notification.className = 'lap-notification';
        notification.innerHTML = `
            <span class="lap-icon">🏁</span>
            <span class="lap-text">${message}</span>
        `;
        
        notification.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, rgba(147, 51, 234, 0.9), rgba(236, 72, 153, 0.9));
            padding: 20px 40px;
            border-radius: 20px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            color: white;
            font-size: 2em;
            font-weight: bold;
            z-index: 200;
            animation: lapZoom 0.8s ease-out;
            box-shadow: 0 0 40px rgba(236, 72, 153, 0.8), inset 0 0 20px rgba(255, 255, 255, 0.2);
            pointer-events: none;
            text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
            display: flex;
            align-items: center;
            gap: 10px;
        `;
        
        document.getElementById('game').appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'lapDissolve 0.8s ease-out forwards';
            notification.style.pointerEvents = 'none';
            setTimeout(() => {
                notification.style.display = 'none';
                notification.remove();
            }, 790);
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
            try {
                soundManager.playVictory();
            } catch (e) {
                console.log('Son non disponible');
            }
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
        
        // Relancer la musique de fond
        if (this.backgroundMusic) {
            this.backgroundMusic.play().catch(e => console.log('Reprise de la musique de fond'));
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
        playAgainBtn.textContent = 'Replay';
        playAgainBtn.className = '';
        
        // Afficher l'écran des résultats
        this.showScreen('results');
    }

    joinGame() {
        const pseudo = document.getElementById('pseudo').value.trim();
        if (!pseudo) {
            alert('Please enter a nickname');
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
            alert('Please enter a nickname');
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

    // MODIFIÉE : Méthode startGameCountdown avec écran de chargement
    async startGameCountdown() {
        // NOUVEAU : Afficher l'écran de chargement d'abord
        await this.showLoadingScreen();
        
        // Attendre un peu pour que la transition se termine
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Puis passer à l'écran de jeu
        this.showScreen('game');
        
        // Arrêter la musique de fond quand la course commence
        if (this.backgroundMusic) {
            this.backgroundMusic.pause();
        }
        
        // Nettoyer toutes les notifications restantes de la partie précédente
        this.cleanupGameNotifications();
        
        // Créer une nouvelle instance du gameEngine à chaque partie
        this.initializeGame();

        // Appliquer les données de la map si elles ont déjà été reçues
        if (this.mapData && this.gameEngine) {
            this.gameEngine.setMapData(this.mapData);
            
            // NOUVELLE CORRECTION : Démarrer avec un volume bas puis ajuster
            if (this.gameEngine && this.gameEngine.music) {
                // Démarrer avec un volume très bas pour éviter le pic sonore
                this.gameEngine.music.volume = 0.05;
            }
            
            // Puis forcer la mise à jour du volume après un délai
            setTimeout(() => {
                if (this.gameEngine && this.gameEngine.music && soundManager) {
                    this.gameEngine.music.volume = soundManager.getVolumeFor('gameMusic');
                    soundManager.refreshAudioVolume('gameMusic');
                }
            }, 500);
        }

        this.canControl = false; // Bloquer les contrôles
        this.gameEngine.start(); // Lancer le rendu pour éviter l'écran noir
        
        // NOUVELLE LIGNE : S'assurer que le canvas a le focus
        const gameCanvas = document.getElementById('gameCanvas');
        if (gameCanvas) {
            gameCanvas.tabIndex = 0; // Rendre le canvas focusable
            gameCanvas.focus();
        }

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
        
        // Sélectionner et supprimer toutes les notifications (avec les nouveaux types)
        const notifications = gameElement.querySelectorAll(
            '.personal-finish, .finish-notification, .game-notification, ' +
            '.checkpoint-notification, .lap-notification, .time-warning, ' +
            '.damage-indicator, .death-notification, .respawn-notification'
        );
        
        notifications.forEach(notification => {
            notification.remove();
        });
    }

    initializeGame() {
        const canvas = document.getElementById('gameCanvas');
        this.gameEngine = new GameEngine(canvas, this.socket, this.playerId);
    }

    backToMenu() {
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
        this.leaveRoom();
    }

    // Modifier updatePlayersList pour afficher l'hôte et stocker les données
    updatePlayersList(players) {
        // Stocker les données des joueurs pour la gestion des couleurs
        this.lastPlayersData = players;
        
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = '<h3>Online players:</h3>';
        
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
                hostBadge.title = 'Host of the game';
                hostBadge.style.marginLeft = '5px';
                nameSpan.appendChild(hostBadge);
            }
            
            const statusDiv = document.createElement('div');
            statusDiv.className = 'player-status';
            statusDiv.style.marginLeft = 'auto';
            
            if (player.isHost) {
                const statusText = document.createElement('span');
                statusText.className = 'status-text';
                statusText.textContent = 'Host';
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
                        // Jouer le son du moteur si on est sur l'écran de jeu (même pendant le compte à rebours)
                        if (this.currentScreen === 'game') {
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
                    if (!this.keys.space) {
                        this.keys.space = true;
                        this.hasUsedSpace = false; // Réinitialiser pour permettre une nouvelle utilisation
                    }
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
                    this.hasUsedSpace = false; // Réinitialiser quand on relâche
                    break;
            }
        });
    }

    sendInput() {
        if (!this.canControl) return;
        
        // Envoyer l'état de la touche espace seulement une fois par appui
        const spacePressed = this.keys.space && !this.hasUsedSpace;
        if (spacePressed) {
            this.hasUsedSpace = true;
        }
        
        this.socket.emit('playerInput', {
            up: this.keys.up,
            down: this.keys.down,
            left: this.keys.left,
            right: this.keys.right,
            space: spacePressed // Envoyer true seulement au premier frame
        });
    }

    showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });
        
        document.getElementById(screenName).classList.remove('hidden');
        this.currentScreen = screenName;
        
        // Gérer la vidéo de fond
        const bgVideo = document.getElementById('backgroundVideo');
        if (bgVideo) {
            if (screenName === 'game' || screenName === 'loading') {
                bgVideo.style.display = 'none';
            } else {
                bgVideo.style.display = 'block';
            }
        }
        
        // Si on arrive dans le lobby, initialiser le sélecteur de couleur
        if (screenName === 'lobby') {
            this.updateLobbyColorSelector();
        }
        
        // Arrêter le son du moteur si on quitte l'écran de jeu
        if (screenName !== 'game') {
            soundManager.stopEngine();
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await window.assetManager.loadAssets();
    } catch (error) {
        // Continuer sans assets
    }
    
    window.gameClient = new GameClient();
});