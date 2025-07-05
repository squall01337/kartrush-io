// uiManager.js - Gestion de toute l'interface utilisateur et des écrans
import soundManager from './soundManager.js';

export class UIManager {
    constructor() {
        this.currentScreen = 'splash';
        this.elements = {};
        this.selectedColor = '#ff4444';
        this.availableMaps = [];
        this.selectedMap = null;
        this.currentMapPage = 0;
        this.mapsPerPage = 6;
        this.rematchVotes = 0;
        this.totalPlayers = 0;
        this.isHost = false;
        this.playerId = null;
        this.lastPlayersData = [];
        
        this.initializeElements();
        this.initializeEventListeners();
    }

    initializeElements() {
        // Écrans
        this.elements.screens = {
            splash: document.getElementById('splash'),
            menu: document.getElementById('menu'),
            lobby: document.getElementById('lobby'),
            loading: document.getElementById('loading'),
            game: document.getElementById('game'),
            results: document.getElementById('results')
        };

        // Éléments du menu
        this.elements.menu = {
            playButton: document.getElementById('playButton'),
            pseudo: document.getElementById('pseudo'),
            joinGame: document.getElementById('joinGame'),
            createRoom: document.getElementById('createRoom'),
            joinWithCode: document.getElementById('joinWithCode'),
            roomCodeInput: document.getElementById('roomCodeInput')
        };

        // Éléments du lobby
        this.elements.lobby = {
            roomType: document.getElementById('roomType'),
            roomCode: document.getElementById('roomCode'),
            playersList: document.getElementById('playersList'),
            startGame: document.getElementById('startGame'),
            leaveRoom: document.getElementById('leaveRoom'),
            mapSelector: document.getElementById('mapSelector'),
            mapGrid: document.getElementById('mapGrid'),
            mapPrevBtn: document.getElementById('mapPrevBtn'),
            mapNextBtn: document.getElementById('mapNextBtn'),
            selectedMapName: document.getElementById('selectedMapName')
        };

        // Éléments de chargement
        this.elements.loading = {
            video: document.getElementById('loadingVideo'),
            fillBar: document.querySelector('.loading-bar-fill'),
            percentage: document.querySelector('.loading-percentage'),
            mapName: document.querySelector('.loading-map-name'),
            mapThumbnail: document.querySelector('.loading-map-thumbnail')
        };

        // Éléments de jeu
        this.elements.game = {
            canvas: document.getElementById('gameCanvas'),
            countdown: document.getElementById('countdown'),
            itemSlot: document.getElementById('itemSlot')
        };

        // Éléments de résultats
        this.elements.results = {
            finalRanking: document.getElementById('finalRanking'),
            playAgain: document.getElementById('playAgain'),
            backToMenu: document.getElementById('backToMenu')
        };

        // Vidéo de fond
        this.elements.backgroundVideo = document.getElementById('backgroundVideo');
    }

    initializeEventListeners() {
        // Bouton PLAY
        this.elements.menu.playButton?.addEventListener('click', () => {
            this.emit('playButtonClicked');
        });

        // Menu
        this.elements.menu.joinGame?.addEventListener('click', () => {
            this.emit('joinGameClicked');
        });

        this.elements.menu.createRoom?.addEventListener('click', () => {
            this.emit('createRoomClicked');
        });

        this.elements.menu.joinWithCode?.addEventListener('click', () => {
            this.emit('joinWithCodeClicked');
        });

        this.elements.menu.roomCodeInput?.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        // Lobby
        this.elements.lobby.leaveRoom?.addEventListener('click', () => {
            this.emit('leaveRoomClicked');
        });

        this.elements.lobby.startGame?.addEventListener('click', () => {
            if (this.isHost) {
                this.emit('hostStartGameClicked');
            } else {
                this.emit('playerReadyClicked');
            }
        });

        // Résultats
        this.elements.results.playAgain?.addEventListener('click', () => {
            this.emit('playAgainClicked');
        });

        this.elements.results.backToMenu?.addEventListener('click', () => {
            this.emit('backToMenuClicked');
        });

        // Sélecteur de couleur
        this.initializeLobbyColorSelector();

        // Sélecteur de maps
        this.initializeMapSelector();
    }

    initializeLobbyColorSelector() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('lobby-color-option')) {
                document.querySelectorAll('.lobby-color-option').forEach(opt => 
                    opt.classList.remove('selected')
                );
                
                e.target.classList.add('selected');
                const newColor = e.target.dataset.color;
                
                if (this.selectedColor !== newColor) {
                    this.selectedColor = newColor;
                    this.emit('colorChanged', newColor);
                    
                    e.target.style.animation = 'colorPulse 0.5s ease-out';
                    setTimeout(() => {
                        e.target.style.animation = '';
                    }, 500);
                }
            }
        });
    }

    initializeMapSelector() {
        this.elements.lobby.mapPrevBtn?.addEventListener('click', () => {
            this.navigateMaps(-1);
        });
        
        this.elements.lobby.mapNextBtn?.addEventListener('click', () => {
            this.navigateMaps(1);
        });
        
        this.elements.lobby.mapGrid?.addEventListener('click', (e) => {
            const mapItem = e.target.closest('.map-item');
            if (mapItem && this.isHost) {
                this.selectMap(mapItem.dataset.mapId);
            }
        });
    }

    // Gestion des écrans
    showScreen(screenName) {
        Object.values(this.elements.screens).forEach(screen => {
            screen?.classList.add('hidden');
        });
        
        this.elements.screens[screenName]?.classList.remove('hidden');
        this.currentScreen = screenName;
        
        // Gérer la vidéo de fond
        if (this.elements.backgroundVideo) {
            if (screenName === 'game' || screenName === 'loading') {
                this.elements.backgroundVideo.style.display = 'none';
            } else {
                this.elements.backgroundVideo.style.display = 'block';
            }
        }
        
        if (screenName === 'lobby') {
            this.updateLobbyColorSelector();
        }
        
        if (screenName !== 'game') {
            soundManager.stopEngine();
        }
    }

    // Méthodes du lobby
    updateRoomInfo(data) {
        const { roomCode, isPrivate, isHost } = data;
        
        if (this.elements.lobby.roomCode) {
            this.elements.lobby.roomCode.textContent = roomCode;
            this.elements.lobby.roomCode.style.display = 'block';
            this.elements.lobby.roomCode.className = isPrivate ? 'room-code private' : 'room-code public';
        }
        
        if (this.elements.lobby.roomType) {
            this.elements.lobby.roomType.innerHTML = isPrivate ? 
                '🔒 Private Room' + (isHost ? ' (Host)' : '') : 
                '🌍 Public Room';
        }
        
        this.isHost = isHost;
        this.showRoomShareInfo(roomCode, isPrivate);
    }

    showRoomShareInfo(code, isPrivate) {
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
        
        notification.addEventListener('click', () => {
            navigator.clipboard.writeText(code).then(() => {
                notification.innerHTML = `
                    <div class="share-icon">✅</div>
                    <div class="share-text">Code copied !</div>
                `;
                setTimeout(() => notification.remove(), 1000);
            }).catch(() => {
                alert(`Room code : ${code}`);
            });
        });
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.5s ease-out';
            setTimeout(() => notification.remove(), 500);
        }, 5000);
    }

    updatePlayersList(players) {
        this.lastPlayersData = players;
        const playersList = this.elements.lobby.playersList;
        if (!playersList) return;
        
        playersList.innerHTML = '<h3>Online players:</h3>';
        
        players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-item';
            
            if (player.isHost) {
                playerDiv.className += ' is-host';
            }
            
            const colorDiv = document.createElement('div');
            colorDiv.className = 'player-color';
            colorDiv.style.backgroundColor = player.color;
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = player.pseudo;
            
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
            
            if (player.id === this.playerId) {
                playerDiv.style.border = '2px solid #4ecdc4';
                playerDiv.style.backgroundColor = 'rgba(78, 205, 196, 0.1)';
            }
            
            playersList.appendChild(playerDiv);
        });
    }

    updateStartButton(canStart, isHost) {
        const startButton = this.elements.lobby.startGame;
        if (!startButton) return;
        
        if (isHost) {
            if (canStart) {
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
            const myPlayer = this.lastPlayersData.find(p => p.id === this.playerId);
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
                startButton.classList.add('hidden');
            }
        }
    }

    updateLobbyColorSelector() {
        document.querySelectorAll('.lobby-color-option').forEach(opt => {
            opt.classList.remove('selected');
            if (opt.dataset.color === this.selectedColor) {
                opt.classList.add('selected');
            }
        });
    }

    // Gestion des maps
    setAvailableMaps(maps) {
        this.availableMaps = maps;
        if (maps.length > 0) {
            this.selectedMap = maps[0].id;
        }
    }

    navigateMaps(direction) {
        const totalPages = Math.ceil(this.availableMaps.length / this.mapsPerPage);
        this.currentMapPage = Math.max(0, Math.min(totalPages - 1, this.currentMapPage + direction));
        this.renderMapSelector();
    }

    selectMap(mapId) {
        if (!this.isHost) return;
        
        this.selectedMap = mapId;
        this.renderMapSelector();
        
        const mapInfo = this.availableMaps.find(m => m.id === mapId);
        if (mapInfo && this.elements.lobby.selectedMapName) {
            this.elements.lobby.selectedMapName.textContent = mapInfo.name;
        }
        
        this.emit('mapSelected', mapId);
        
        const selectedItem = document.querySelector(`.map-item[data-map-id="${mapId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('pulse');
            setTimeout(() => selectedItem.classList.remove('pulse'), 500);
        }
    }

    renderMapSelector() {
        const mapGrid = this.elements.lobby.mapGrid;
        const prevBtn = this.elements.lobby.mapPrevBtn;
        const nextBtn = this.elements.lobby.mapNextBtn;
        
        if (!mapGrid) return;
        
        const startIdx = this.currentMapPage * this.mapsPerPage;
        const endIdx = Math.min(startIdx + this.mapsPerPage, this.availableMaps.length);
        const mapsToShow = this.availableMaps.slice(startIdx, endIdx);
        
        mapGrid.innerHTML = '';
        
        mapsToShow.forEach((map, index) => {
            const mapItem = document.createElement('div');
            mapItem.className = 'map-item';
            mapItem.dataset.mapId = map.id;
            
            if (map.id === this.selectedMap) {
                mapItem.classList.add('selected');
            }
            
            const thumbnail = document.createElement('div');
            thumbnail.className = 'map-thumbnail';
            
            const img = new Image();
            img.onload = () => {
                thumbnail.style.backgroundImage = `url(${map.thumbnail})`;
                thumbnail.style.backgroundSize = 'cover';
                thumbnail.style.backgroundPosition = 'center';
            };
            img.onerror = () => {
                thumbnail.classList.add('placeholder');
                thumbnail.innerHTML = '🏁';
            };
            img.src = map.thumbnail;
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'map-name';
            nameDiv.textContent = map.name;
            
            mapItem.appendChild(thumbnail);
            mapItem.appendChild(nameDiv);
            
            mapItem.style.animationDelay = `${index * 0.05}s`;
            
            mapGrid.appendChild(mapItem);
        });
        
        const totalPages = Math.ceil(this.availableMaps.length / this.mapsPerPage);
        if (prevBtn) prevBtn.disabled = this.currentMapPage === 0;
        if (nextBtn) nextBtn.disabled = this.currentMapPage >= totalPages - 1;
    }

    showMapSelector(show) {
        if (this.elements.lobby.mapSelector) {
            if (show) {
                this.elements.lobby.mapSelector.classList.remove('hidden');
                this.renderMapSelector();
            } else {
                this.elements.lobby.mapSelector.classList.add('hidden');
            }
        }
    }

    // Écran de chargement
    async showLoadingScreen() {
        this.showScreen('loading');
        
        const { video, fillBar, percentage, mapName, mapThumbnail } = this.elements.loading;
        
        fillBar.style.width = '0%';
        percentage.textContent = '0%';
        
        const mapInfo = this.availableMaps.find(m => m.id === this.selectedMap);
        if (mapInfo) {
            mapName.textContent = mapInfo.name;
            mapThumbnail.classList.remove('placeholder');
            
            const img = new Image();
            img.onload = () => {
                mapThumbnail.style.backgroundImage = `url(${mapInfo.thumbnail})`;
            };
            img.onerror = () => {
                mapThumbnail.classList.add('placeholder');
                mapThumbnail.innerHTML = '🏁';
            };
            img.src = mapInfo.thumbnail;
        } else {
            mapName.textContent = 'Loading Track...';
            mapThumbnail.classList.add('placeholder');
            mapThumbnail.innerHTML = '🏁';
        }
        
        video.currentTime = 0;
        
        const loadingDuration = 5000;
        const startTime = Date.now();
        
        return new Promise((resolve) => {
            video.play().catch(e => console.log('Erreur lecture vidéo:', e));
            
            const updateProgress = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min((elapsed / loadingDuration) * 100, 100);
                
                fillBar.style.width = `${progress}%`;
                percentage.textContent = `${Math.floor(progress)}%`;
                
                if (progress < 100) {
                    requestAnimationFrame(updateProgress);
                } else {
                    setTimeout(() => {
                        this.transitionToGame(video);
                        resolve();
                    }, 200);
                }
            };
            
            requestAnimationFrame(updateProgress);
            
            setTimeout(() => {
                this.transitionToGame(video);
                resolve();
            }, loadingDuration + 200);
        });
    }

    transitionToGame(video) {
        const flash = document.createElement('div');
        flash.className = 'loading-flash';
        document.body.appendChild(flash);
        
        setTimeout(() => {
            flash.classList.add('active');
        }, 10);
        
        const loadingScreen = this.elements.screens.loading;
        loadingScreen.classList.add('fade-out');
        
        const gameScreen = this.elements.screens.game;
        gameScreen.classList.add('fade-in');
        
        setTimeout(() => {
            video.pause();
            loadingScreen.classList.remove('fade-out');
            
            setTimeout(() => {
                flash.remove();
                gameScreen.classList.remove('fade-in');
            }, 600);
        }, 800);
    }

    // Notifications de jeu
    showNotification(options) {
        const notification = document.createElement('div');
        notification.className = 'game-notification';
        notification.innerHTML = `
            <div class="notification-icon">${options.icon || '📢'}</div>
            <div class="notification-text">${options.text}</div>
        `;
        
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
        
        this.elements.screens.game.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.5s ease-out';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    showLapNotification(data) {
        const existingNotifications = document.querySelectorAll('.lap-notification');
        existingNotifications.forEach(notif => notif.remove());
        
        const notification = document.createElement('div');
        const isLastLap = data.lap === data.totalLaps;
        
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
        
        this.elements.screens.game.appendChild(notification);
        
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
        
        this.elements.screens.game.appendChild(warning);
        
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
        
        this.elements.screens.game.appendChild(notification);
        
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
        
        this.elements.screens.game.appendChild(message);
        
        if (data.position <= 3) {
            try {
                soundManager.playVictory();
            } catch (e) {
                console.log('Son non disponible');
            }
        }
    }

    cleanupGameNotifications() {
        const gameElement = this.elements.screens.game;
        if (!gameElement) return;
        
        const notifications = gameElement.querySelectorAll(
            '.personal-finish, .finish-notification, .game-notification, ' +
            '.checkpoint-notification, .lap-notification, .time-warning'
        );
        
        notifications.forEach(notification => {
            notification.remove();
        });
    }

    // Résultats
    showRaceResults(results) {
        const ranking = this.elements.results.finalRanking;
        ranking.innerHTML = '';
        
        results.forEach((player, index) => {
            const rankDiv = document.createElement('div');
            rankDiv.className = 'rank-item';
            
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
        
        const playAgainBtn = this.elements.results.playAgain;
        playAgainBtn.disabled = false;
        playAgainBtn.textContent = 'Replay';
        playAgainBtn.className = '';
        
        this.showScreen('results');
    }

    updateRematchButton(votes, total) {
        this.rematchVotes = votes;
        this.totalPlayers = total;
        
        const btn = this.elements.results.playAgain;
        if (!btn.disabled) {
            btn.textContent = `Replay (${votes}/${total})`;
        } else {
            btn.textContent = `Vote registered (${votes}/${total})`;
        }
    }

    disableRematchButton() {
        const btn = this.elements.results.playAgain;
        btn.disabled = true;
        btn.textContent = `Vote registered (${this.rematchVotes + 1}/${this.totalPlayers})`;
        btn.className = 'voted';
    }

    startRematchTimer() {
        this.rematchVotes = 0;
        let timeLeft = 10;
        
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
        
        this.elements.screens.results.appendChild(timerDiv);
        
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

    // Countdown
    async showCountdown() {
        const countdown = this.elements.game.countdown;
        countdown.classList.remove('hidden');

        let count = 3;
        countdown.textContent = count;

        soundManager.playCountdown();

        return new Promise((resolve) => {
            const countdownInterval = setInterval(() => {
                count--;

                if (count > 0) {
                    countdown.textContent = count;
                } else if (count === 0) {
                    countdown.textContent = 'GO!';
                    
                    setTimeout(() => {
                        countdown.classList.add('hidden');
                    }, 800);

                    clearInterval(countdownInterval);
                    resolve();
                }
            }, 1000);
        });
    }

    // Utilitaires
    formatTime(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = Math.floor((ms % 1000) / 10);
        return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }

    getInputValues() {
        return {
            pseudo: this.elements.menu.pseudo?.value.trim() || '',
            roomCode: this.elements.menu.roomCodeInput?.value.trim() || '',
            color: this.selectedColor
        };
    }

    // Event Emitter pattern
    emit(event, data) {
        window.dispatchEvent(new CustomEvent(`ui:${event}`, { detail: data }));
    }
}