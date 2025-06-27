// Moteur de jeu avec rendu Canvas OPTIMISÉ
class GameEngine {
    constructor(canvas, socket, playerId) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false }); // Désactiver la transparence du canvas
        this.socket = socket;
        this.playerId = playerId;
        this.isRunning = false;
        
        this.gameState = {
            players: [],
            gameTime: 0
        };
        
        this.track = null;
        this.camera = { x: 0, y: 0 };
        this.lastFrameTime = 0;
        
        // OPTIMISATION: Cache pour les sprites traités
        this.spriteCache = new Map();
        
        // OPTIMISATION: Canvas hors-écran pour le double buffering
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        
        // OPTIMISATION: Interpolation pour un rendu fluide
        this.playerInterpolation = new Map();
        this.interpolationFactor = 0.15;
        
        // OPTIMISATION: Limiteur de FPS
        this.targetFPS = 60;
        this.fpsInterval = 1000 / this.targetFPS;
        this.then = Date.now();
        
        this.setupCanvas();
        this.loadTrack();
        this.preprocessSprites();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // OPTIMISATION: Désactiver l'antialiasing pour de meilleures perfs
        this.ctx.imageSmoothingEnabled = false;
        this.canvas.style.imageRendering = 'pixelated';
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const maxWidth = window.innerWidth - 40;
        const maxHeight = window.innerHeight - 100;
        
        const aspectRatio = 4 / 3;
        
        let width = Math.min(maxWidth, 800);
        let height = width / aspectRatio;
        
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }
        
        this.canvas.width = width;
        this.canvas.height = height;
        
        // Ajuster le canvas hors-écran
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
        
        this.scale = width / 800;
    }

    // OPTIMISATION: Pré-traiter tous les sprites une seule fois
    preprocessSprites() {
        const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
        
        colors.forEach(color => {
            const kartSprite = window.assetManager.getKartSprite(color);
            if (kartSprite) {
                this.cacheProcessedSprite(color, kartSprite);
            }
        });
    }

    cacheProcessedSprite(color, kartSprite) {
        const size = 28;
        const cacheCanvas = document.createElement('canvas');
        const cacheCtx = cacheCanvas.getContext('2d');
        cacheCanvas.width = size;
        cacheCanvas.height = size;
        
        // Dessiner et traiter le sprite une seule fois
        cacheCtx.save();
        cacheCtx.translate(size/2, size/2);
        cacheCtx.rotate(Math.PI / 2);
        cacheCtx.drawImage(
            kartSprite.image,
            kartSprite.sx, kartSprite.sy, kartSprite.sw, kartSprite.sh,
            -size/2, -size/2, size, size
        );
        cacheCtx.restore();
        
        // Traitement de transparence optimisé
        const imageData = cacheCtx.getImageData(0, 0, size, size);
        const data = imageData.data;
        
        // Traitement plus rapide avec moins de conditions
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 50 || 
                (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250)) {
                data[i + 3] = 0;
            }
        }
        
        cacheCtx.putImageData(imageData, 0, 0);
        
        // Stocker le canvas traité
        this.spriteCache.set(color, cacheCanvas);
    }

    loadTrack() {
        this.track = {
            width: 800,
            height: 600,
            background: '#2a5a2a',
            walls: [
                {x: 50, y: 150, width: 700, height: 20},
                {x: 50, y: 430, width: 700, height: 20},
                {x: 50, y: 150, width: 20, height: 300},
                {x: 730, y: 150, width: 20, height: 300},
                {x: 200, y: 250, width: 400, height: 20},
                {x: 200, y: 330, width: 400, height: 20},
                {x: 200, y: 250, width: 20, height: 100},
                {x: 580, y: 250, width: 20, height: 100}
            ],
            startLine: {
                x1: 70, y1: 280, x2: 70, y2: 320,
                color: '#ffffff'
            },
            checkpoints: [
                {x1: 400, y1: 170, x2: 400, y2: 210, color: '#ffff00'},
                {x1: 720, y1: 280, x2: 720, y2: 320, color: '#ffff00'},
                {x1: 400, y1: 390, x2: 400, y2: 430, color: '#ffff00'}
            ]
        };
    }

    start() {
        this.isRunning = true;
        this.then = Date.now();
        this.gameLoop();
    }

    stop() {
        this.isRunning = false;
    }

    gameLoop() {
        if (!this.isRunning) return;
        
        requestAnimationFrame(() => this.gameLoop());
        
        // OPTIMISATION: Limiteur de FPS
        const now = Date.now();
        const elapsed = now - this.then;
        
        if (elapsed > this.fpsInterval) {
            this.then = now - (elapsed % this.fpsInterval);
            
            const deltaTime = elapsed / 1000;
            this.update(deltaTime);
            this.render();
        }
    }

    update(deltaTime) {
        // OPTIMISATION: Interpolation des positions pour un mouvement fluide
        this.interpolatePlayers();
        
        // Mettre à jour la caméra
        const player = this.getInterpolatedPlayer(this.playerId);
        if (player) {
            this.camera.x = player.x - (this.canvas.width / this.scale) / 2;
            this.camera.y = player.y - (this.canvas.height / this.scale) / 2;
            
            this.camera.x = Math.max(0, Math.min(this.track.width - this.canvas.width / this.scale, this.camera.x));
            this.camera.y = Math.max(0, Math.min(this.track.height - this.canvas.height / this.scale, this.camera.y));
        }
        
        this.updateUI();
    }

    interpolatePlayers() {
        this.gameState.players.forEach(player => {
            let interpolated = this.playerInterpolation.get(player.id);
            
            if (!interpolated) {
                interpolated = { x: player.x, y: player.y, angle: player.angle };
                this.playerInterpolation.set(player.id, interpolated);
            }
            
            // Interpolation douce
            interpolated.x += (player.x - interpolated.x) * this.interpolationFactor;
            interpolated.y += (player.y - interpolated.y) * this.interpolationFactor;
            
            // Interpolation d'angle avec gestion du wraparound
            let angleDiff = player.angle - interpolated.angle;
            if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            interpolated.angle += angleDiff * this.interpolationFactor;
        });
    }

    getInterpolatedPlayer(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) return null;
        
        const interpolated = this.playerInterpolation.get(playerId);
        return interpolated ? { ...player, ...interpolated } : player;
    }

    render() {
        // OPTIMISATION: Utiliser le canvas hors-écran pour éviter le flickering
        const ctx = this.offscreenCtx;
        
        // Effacer avec fillRect (plus rapide que clearRect)
        ctx.fillStyle = this.track.background;
        ctx.fillRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
        
        ctx.save();
        ctx.scale(this.scale, this.scale);
        ctx.translate(-this.camera.x, -this.camera.y);
        
        this.renderTrack(ctx);
        this.renderPlayers(ctx);
        
        ctx.restore();
        
        // Copier le rendu final sur le canvas principal
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        
        this.renderUI();
    }

    renderTrack(ctx) {
        const trackBg = window.assetManager.getImage('track_background');
        if (trackBg) {
            ctx.drawImage(trackBg, 0, 0, this.track.width, this.track.height);
        } else {
            // Fallback optimisé
            ctx.fillStyle = '#444444';
            ctx.fillRect(70, 170, 660, 260);
            
            ctx.fillStyle = '#ffffff';
            // OPTIMISATION: Dessiner tous les murs en une fois
            this.track.walls.forEach(wall => {
                ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
            });
        }
        
        // Lignes avec un seul path
        ctx.strokeStyle = this.track.startLine.color;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.moveTo(this.track.startLine.x1, this.track.startLine.y1);
        ctx.lineTo(this.track.startLine.x2, this.track.startLine.y2);
        ctx.stroke();
        
        // Checkpoints
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        this.track.checkpoints.forEach(checkpoint => {
            ctx.moveTo(checkpoint.x1, checkpoint.y1);
            ctx.lineTo(checkpoint.x2, checkpoint.y2);
        });
        ctx.stroke();
        ctx.setLineDash([]);
    }

    renderPlayers(ctx) {
        // OPTIMISATION: Trier les joueurs une seule fois par distance à la caméra
        const sortedPlayers = [...this.gameState.players].sort((a, b) => {
            const distA = Math.abs(a.x - this.camera.x) + Math.abs(a.y - this.camera.y);
            const distB = Math.abs(b.x - this.camera.x) + Math.abs(b.y - this.camera.y);
            return distA - distB;
        });
        
        sortedPlayers.forEach(player => {
            const interpolated = this.playerInterpolation.get(player.id) || player;
            this.renderPlayer(ctx, { ...player, ...interpolated });
        });
    }

    renderPlayer(ctx, player) {
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(player.angle);
        
        const size = 28;
        
        // OPTIMISATION: Utiliser le sprite pré-traité du cache
        const cachedSprite = this.spriteCache.get(player.color);
        
        if (cachedSprite) {
            ctx.drawImage(cachedSprite, -size/2, -size/2);
        } else {
            // Fallback simple
            ctx.fillStyle = player.color;
            ctx.fillRect(-size/2, -size/2, size, size);
            
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeRect(-size/2, -size/2, size, size);
        }
        
        ctx.restore();
        
        // Texte optimisé avec un seul style
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.fillStyle = '#ffffff';
        
        // Nom du joueur
        ctx.strokeText(player.pseudo, player.x, player.y - 25);
        ctx.fillText(player.pseudo, player.x, player.y - 25);
        
        // Position
        ctx.fillStyle = player.color;
        ctx.font = 'bold 14px Arial';
        const posText = `#${player.position}`;
        ctx.strokeText(posText, player.x, player.y + 35);
        ctx.fillText(posText, player.x, player.y + 35);
    }

    renderUI() {
        // UI déjà optimisée via HTML/CSS
    }

    updateUI() {
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;
        
        // OPTIMISATION: Mettre à jour le DOM seulement si nécessaire
        const positionEl = document.getElementById('position');
        const newPosition = `Position: ${player.position}/${this.gameState.players.length}`;
        if (positionEl.textContent !== newPosition) {
            positionEl.textContent = newPosition;
        }
        
        const lapEl = document.getElementById('lap');
        const newLap = `Tour: ${player.lap + 1}/3`;
        if (lapEl.textContent !== newLap) {
            lapEl.textContent = newLap;
        }
        
        const minutes = Math.floor(this.gameState.gameTime / 60000);
        const seconds = Math.floor((this.gameState.gameTime % 60000) / 1000);
        const timerEl = document.getElementById('timer');
        const newTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        if (timerEl.textContent !== newTime) {
            timerEl.textContent = newTime;
        }
        
        const itemSlot = document.getElementById('itemSlot');
        if (player.item && !itemSlot.dataset.item) {
            itemSlot.textContent = this.getItemIcon(player.item);
            itemSlot.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
            itemSlot.dataset.item = player.item;
        } else if (!player.item && itemSlot.dataset.item) {
            itemSlot.textContent = '';
            itemSlot.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            delete itemSlot.dataset.item;
        }
    }

    getItemIcon(itemType) {
        switch(itemType) {
            case 'boost': return '🚀';
            case 'slow': return '🐌';
            case 'missile': return '💥';
            default: return '?';
        }
    }

    updateGameState(gameData) {
        this.gameState = gameData;
        
        // Nettoyer l'interpolation pour les joueurs qui ont quitté
        const currentIds = new Set(gameData.players.map(p => p.id));
        for (const [id] of this.playerInterpolation) {
            if (!currentIds.has(id)) {
                this.playerInterpolation.delete(id);
            }
        }
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (player && player.finished) {
            setTimeout(() => {
                this.showResults();
            }, 2000);
        }
    }

    showResults() {
        this.stop();
        
        const sortedPlayers = [...this.gameState.players].sort((a, b) => a.position - b.position);
        
        const ranking = document.getElementById('finalRanking');
        ranking.innerHTML = '';
        
        sortedPlayers.forEach((player, index) => {
            const rankDiv = document.createElement('div');
            rankDiv.className = 'rank-item';
            
            const position = document.createElement('span');
            position.className = 'rank-position';
            position.textContent = `#${index + 1}`;
            
            const playerInfo = document.createElement('div');
            playerInfo.className = 'rank-player';
            
            const colorDiv = document.createElement('div');
            colorDiv.className = 'player-color';
            colorDiv.style.backgroundColor = player.color;
            
            const name = document.createElement('span');
            name.textContent = player.pseudo;
            name.style.marginLeft = '10px';
            
            const time = document.createElement('span');
            time.className = 'rank-time';
            const minutes = Math.floor(player.raceTime / 60000);
            const seconds = Math.floor((player.raceTime % 60000) / 1000);
            const milliseconds = Math.floor((player.raceTime % 1000) / 10);
            time.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
            
            playerInfo.appendChild(colorDiv);
            playerInfo.appendChild(name);
            
            rankDiv.appendChild(position);
            rankDiv.appendChild(playerInfo);
            rankDiv.appendChild(time);
            
            ranking.appendChild(rankDiv);
        });
        
        document.getElementById('game').classList.add('hidden');
        document.getElementById('results').classList.remove('hidden');
    }
}