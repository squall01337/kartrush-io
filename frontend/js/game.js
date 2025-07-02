// Moteur de jeu avec rendu Canvas OPTIMISÉ
class GameEngine {
    constructor(canvas, socket, playerId) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.socket = socket;
        this.playerId = playerId;
        this.isRunning = false;
        
        this.gameState = {
            players: [],
            gameTime: 0,
            totalLaps: 3,
            maxTime: null,
            remainingTime: null
        };
        
        this.track = null;
        this.camera = { x: 0, y: 0 };
        this.lastFrameTime = 0;
        this.lastLap = 0;
        this.finalLapShown = false;
        
        this.spriteCache = new Map();
        
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        
        this.playerInterpolation = new Map();
        this.interpolationFactor = 0.15;
        
        this.targetFPS = 60;
        this.fpsInterval = 1000 / this.targetFPS;
        this.then = Date.now();
        
        this.CHECKPOINT_MARGIN = 20;
        
        this.setupCanvas();
        this.preprocessSprites();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        this.ctx.imageSmoothingEnabled = false;
        this.canvas.style.imageRendering = 'pixelated';
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const maxWidth = window.innerWidth - 40;
        const maxHeight = window.innerHeight - 100;
        
        const aspectRatio = 16 / 9;
        
        let width = Math.min(maxWidth, 1280);
        let height = width / aspectRatio;
        
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }
        
        this.canvas.width = width;
        this.canvas.height = height;
        
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
        
        this.scale = width / 1280;
    }

    preprocessSprites() {
        const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
        
        colors.forEach(color => {
            const kartSprite = window.assetManager.getKartSprite(color);
            if (kartSprite) {
                this.cacheProcessedSprite(color, kartSprite);
            }
        });
    }

    setMapData(mapData) {
        this.setTrack(mapData);

        if (this.music) {
            if (window.soundManager) {
                window.soundManager.unregisterAudio('gameMusic');
            }
            this.music.pause();
            this.music.currentTime = 0;
            this.music = null;
        }

        if (mapData.music) {
            this.music = new Audio(mapData.music);
            this.music.loop = true;
            
            if (window.soundManager) {
                this.music.volume = window.soundManager.getVolumeFor('gameMusic');
                window.soundManager.registerAudio('gameMusic', this.music);
            } else {
                this.music.volume = 0.5;
            }
            
            this.music.play().catch(e => {
                console.warn('🔇 Musique bloquée par l\'autoplay. L\'utilisateur doit interagir avec la page.');
            });
        }
        
        if (mapData.background && mapData.background.endsWith('.png')) {
            const img = new Image();
            img.onload = () => {
                this.backgroundImage = img;
            };
            img.onerror = () => {
                this.backgroundImage = null;
            };
            img.src = mapData.background;
        } else {
            this.backgroundImage = null;
        }
    }

    cacheProcessedSprite(color, kartSprite) {
        const finalSize = 28;
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = kartSprite.sw;
        tempCanvas.height = kartSprite.sh;

        tempCtx.drawImage(
            kartSprite.image,
            kartSprite.sx, kartSprite.sy, kartSprite.sw, kartSprite.sh,
            0, 0, kartSprite.sw, kartSprite.sh
        );

        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            const isWhite = r > 200 && g > 200 && b > 200;
            if (isWhite || a < 100) {
                data[i + 3] = 0;
            }
        }
        tempCtx.putImageData(imageData, 0, 0);

        let minX = tempCanvas.width, maxX = 0, minY = tempCanvas.height, maxY = 0;
        for (let y = 0; y < tempCanvas.height; y++) {
            for (let x = 0; x < tempCanvas.width; x++) {
                const idx = (y * tempCanvas.width + x) * 4 + 3;
                const alpha = data[idx];
                if (alpha > 0) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        const trimmedWidth = maxX - minX + 1;
        const trimmedHeight = maxY - minY + 1;

        const cacheCanvas = document.createElement('canvas');
        const cacheCtx = cacheCanvas.getContext('2d');
        cacheCanvas.width = finalSize;
        cacheCanvas.height = finalSize;

        cacheCtx.save();
        cacheCtx.translate(finalSize / 2, finalSize / 2);
        cacheCtx.rotate(Math.PI / 2);

        cacheCtx.drawImage(
            tempCanvas,
            minX, minY, trimmedWidth, trimmedHeight,
            -finalSize / 2, -finalSize / 2, finalSize, finalSize
        );

        cacheCtx.restore();

        this.spriteCache.set(color, cacheCanvas);
    }

    setTrack(data) {
        this.track = {
            ...data,
            walls: data.walls || [],
            checkpoints: data.checkpoints || [],
            finishLine: data.finishLine || null,
            spawnPoints: data.spawnPoints || [],
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
        if (!this.track) return;
        
        this.interpolatePlayers();
        
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
            
            interpolated.x += (player.x - interpolated.x) * this.interpolationFactor;
            interpolated.y += (player.y - interpolated.y) * this.interpolationFactor;
            
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
        if (!this.track) return;
        const ctx = this.offscreenCtx;
        
        ctx.fillStyle = this.track.background;
        ctx.fillRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
        
        ctx.save();
        ctx.scale(this.scale, this.scale);
        ctx.translate(-this.camera.x, -this.camera.y);
        
        this.renderTrack(ctx);
        this.renderFinishLine(ctx);
        this.renderPlayers(ctx);
        this.renderPlayerInfo(ctx);
        
        ctx.restore();
        
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        
        this.renderUI();
    }

    renderTrack(ctx) {
        if (this.backgroundImage) {
            ctx.drawImage(this.backgroundImage, 0, 0, this.track.width, this.track.height);
        } else if (this.track.background && !this.track.background.endsWith('.png')) {
            ctx.fillStyle = this.track.background;
            ctx.fillRect(0, 0, this.track.width, this.track.height);
        } else {
            ctx.fillStyle = '#444444';
            ctx.fillRect(0, 0, this.track.width, this.track.height);
        }
    }

    renderFinishLine(ctx) {
        if (!this.track.finishLine) return;
        
        ctx.save();
        
        const fl = this.track.finishLine;
        
        if (fl.x1 !== undefined && fl.y1 !== undefined) {
            // NOUVEAU FORMAT : Ligne
            ctx.globalAlpha = 0.8;
            
            // Ligne principale épaisse
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 12;
            ctx.lineCap = 'butt';
            ctx.beginPath();
            ctx.moveTo(fl.x1, fl.y1);
            ctx.lineTo(fl.x2, fl.y2);
            ctx.stroke();
            
            // Pattern damier sur la ligne
            const dx = fl.x2 - fl.x1;
            const dy = fl.y2 - fl.y1;
            const lineLength = Math.sqrt(dx * dx + dy * dy);
            const segments = Math.floor(lineLength / 20);
            
            for (let i = 0; i < segments; i++) {
                if (i % 2 === 0) {
                    const t1 = i / segments;
                    const t2 = (i + 1) / segments;
                    
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 12;
                    ctx.beginPath();
                    ctx.moveTo(fl.x1 + t1 * dx, fl.y1 + t1 * dy);
                    ctx.lineTo(fl.x1 + t2 * dx, fl.y1 + t2 * dy);
                    ctx.stroke();
                }
            }
            
            // PAS DE TEXTE "FINISH" - SUPPRIMÉ
            
        } else {
            // ANCIEN FORMAT : Rectangle
            const cx = fl.x + fl.width / 2;
            const cy = fl.y + fl.height / 2;
            
            ctx.translate(cx, cy);
            ctx.rotate((fl.angle || 0) * Math.PI / 180);
            
            ctx.globalAlpha = 0.8;
            
            // Pattern damier
            const squareSize = 10;
            const rows = Math.ceil(fl.height / squareSize);
            const cols = Math.ceil(fl.width / squareSize);
            
            for (let i = 0; i < rows; i++) {
                for (let j = 0; j < cols; j++) {
                    ctx.fillStyle = (i + j) % 2 === 0 ? '#FFFFFF' : '#000000';
                    ctx.fillRect(
                        -fl.width/2 + j * squareSize, 
                        -fl.height/2 + i * squareSize, 
                        squareSize, 
                        squareSize
                    );
                }
            }
        }
        
        ctx.restore();
    }

    renderPlayerInfo(ctx) {
        const currentPlayer = this.gameState.players.find(p => p.id === this.playerId);
        if (!currentPlayer) return;
        
        ctx.save();
        ctx.resetTransform();
        
        // Ajuster les positions et largeurs pour mieux centrer le texte
        const boxWidth = 180 * this.scale;  // Largeur réduite
        const boxHeight = 60 * this.scale;
        const padding = 10 * this.scale;
        const infoX = this.canvas.width - boxWidth - (20 * this.scale);
        const infoY = 20 * this.scale;
        
        // Fond avec padding correct
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(infoX, infoY, boxWidth, boxHeight);
        
        // Texte aligné à gauche avec padding
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `${16 * this.scale}px Arial`;
        ctx.textAlign = 'left';
        
        const textX = infoX + padding;
        
        const displayLap = currentPlayer.lap === 0 ? 0 : currentPlayer.lap;
        ctx.fillText(`🏁 Lap: ${displayLap}/${currentPlayer.lapsToWin}`, textX, infoY + 25 * this.scale);
        
        const minutes = Math.floor(this.gameState.gameTime / 60000);
        const seconds = Math.floor((this.gameState.gameTime % 60000) / 1000);
        const timeString = `⏱️ Time: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        ctx.fillText(timeString, textX, infoY + 50 * this.scale);
        
        ctx.restore();
    }

    renderPlayers(ctx) {
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
        
        const cachedSprite = this.spriteCache.get(player.color);
        
        if (cachedSprite) {
            ctx.drawImage(cachedSprite, -size/2, -size/2);
        } else {
            ctx.fillStyle = player.color;
            ctx.fillRect(-size/2, -size/2, size, size);
            
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeRect(-size/2, -size/2, size, size);
        }
        
        ctx.restore();
        
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.fillStyle = '#ffffff';
        
        ctx.strokeText(player.pseudo, player.x, player.y - 25);
        ctx.fillText(player.pseudo, player.x, player.y - 25);
        
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
        
        const positionEl = document.getElementById('position');
        const newPosition = `Position: ${player.position}/${this.gameState.players.length}`;
        if (positionEl.textContent !== newPosition) {
            positionEl.textContent = newPosition;
        }
        
        const lapEl = document.getElementById('lap');
        const totalLaps = this.gameState.totalLaps || 3;
        
        const displayLap = player.lap === 0 ? 0 : player.lap;
        const newLap = `Lap: ${displayLap}/${totalLaps}`;
        
        if (lapEl.textContent !== newLap) {
            lapEl.textContent = newLap;
            
            if (player.lap > 0 && player.lap > (this.lastLap || 0)) {
                lapEl.style.animation = 'flash 0.5s';
                setTimeout(() => {
                    lapEl.style.animation = '';
                }, 500);
                
                if (player.lap === totalLaps - 1) {
                    this.showFinalLapMessage();
                    this.finalLapShown = true;
                }
            }
            this.lastLap = player.lap;
        }
        
        const timerEl = document.getElementById('timer');
        if (this.gameState.maxTime && this.gameState.remainingTime !== null) {
            const totalSeconds = Math.floor(this.gameState.gameTime / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            
            const remainingSeconds = Math.floor(this.gameState.remainingTime / 1000);
            const remainingMinutes = Math.floor(remainingSeconds / 60);
            const remainingSecondsOnly = remainingSeconds % 60;
            
            if (remainingSeconds < 60) {
                timerEl.style.color = '#ff4444';
                timerEl.style.fontWeight = 'bold';
            } else if (remainingSeconds < 120) {
                timerEl.style.color = '#ffaa44';
            } else {
                timerEl.style.color = '';
                timerEl.style.fontWeight = '';
            }
            
            const newTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} (${remainingMinutes}:${remainingSecondsOnly.toString().padStart(2, '0')})`;
            if (timerEl.textContent !== newTime) {
                timerEl.textContent = newTime;
            }
        } else {
            const minutes = Math.floor(this.gameState.gameTime / 60000);
            const seconds = Math.floor((this.gameState.gameTime % 60000) / 1000);
            const newTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            if (timerEl.textContent !== newTime) {
                timerEl.textContent = newTime;
            }
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

    showFinalLapMessage() {
        const message = document.createElement('div');
        message.className = 'final-lap-message';
        message.textContent = 'FINAL LAP!';
        message.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 4em;
            font-weight: bold;
            color: #ff0000;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
            z-index: 200;
            animation: finalLapPulse 1.5s ease-out;
        `;
        
        document.getElementById('game').appendChild(message);
        
        setTimeout(() => {
            message.remove();
        }, 1500);
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
        
        const currentIds = new Set(gameData.players.map(p => p.id));
        for (const [id] of this.playerInterpolation) {
            if (!currentIds.has(id)) {
                this.playerInterpolation.delete(id);
            }
        }
    }
}