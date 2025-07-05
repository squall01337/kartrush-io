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
        
        this.spriteCache = new Map();
        
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
        
        this.playerInterpolation = new Map();
        this.interpolationFactor = 0.15;
        
        this.targetFPS = 60;
        this.fpsInterval = 1000 / this.targetFPS;
        this.then = Date.now();
        
        this.CHECKPOINT_MARGIN = 20;
        
        // État des boosters
        this.boosterEffects = new Map();
        this.boosterSprite = null;
        this.loadBoosterSprite();
        
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

    loadBoosterSprite() {
        this.boosterSprite = new Image();
        this.boosterSprite.src = 'assets/booster_arrow.png';
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
            
            this.music.play().catch(e => {});
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
        
        // Mettre à jour les effets de boost
        this.updateBoosterEffects(deltaTime);
        
        const player = this.getInterpolatedPlayer(this.playerId);
        if (player) {
            this.camera.x = player.x - (this.canvas.width / this.scale) / 2;
            this.camera.y = player.y - (this.canvas.height / this.scale) / 2;
            
            this.camera.x = Math.max(0, Math.min(this.track.width - this.canvas.width / this.scale, this.camera.x));
            this.camera.y = Math.max(0, Math.min(this.track.height - this.canvas.height / this.scale, this.camera.y));
        }
        
        this.updateUI();
    }

    updateBoosterEffects(deltaTime) {
        // Nettoyer les effets terminés
        for (const [playerId, effect] of this.boosterEffects) {
            effect.duration -= deltaTime * 1000;
            if (effect.duration <= 0) {
                this.boosterEffects.delete(playerId);
            }
        }
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
        this.renderBoosters(ctx);
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

    renderBoosters(ctx) {
        if (!this.track || !this.track.boosters) return;
        
        ctx.save();
        
        this.track.boosters.forEach((booster, index) => {
            // Calculer le centre et l'angle du booster
            const cx = (booster.x1 + booster.x2) / 2;
            const cy = (booster.y1 + booster.y2) / 2;
            const dx = booster.x2 - booster.x1;
            const dy = booster.y2 - booster.y1;
            const angle = Math.atan2(dy, dx);
            const length = Math.sqrt(dx * dx + dy * dy);
            
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            
            // Si on a le sprite, dessiner des flèches
            if (this.boosterSprite && this.boosterSprite.complete) {
                // Calculer combien de flèches on peut mettre
                const spriteSize = 64;
                const spacing = 10;
                const totalSize = spriteSize + spacing;
                const arrowCount = Math.max(1, Math.floor(length / totalSize));
                
                // Calculer la position de départ pour centrer les flèches
                const totalWidth = arrowCount * spriteSize + (arrowCount - 1) * spacing;
                const startX = -totalWidth / 2;
                
                for (let i = 0; i < arrowCount; i++) {
                    const x = startX + i * totalSize + spriteSize/2;
                    
                    ctx.save();
                    ctx.translate(x, 0);
                    
                    // Effet de pulsation plus subtile
                    const pulsePhase = (Date.now() * 0.002 + i * 0.8) % (Math.PI * 2);
                    const scale = 0.9 + Math.sin(pulsePhase) * 0.1;
                    ctx.scale(scale, scale);
                    
                    // Opacité constante élevée
                    ctx.globalAlpha = 0.7 + Math.sin(pulsePhase) * 0.3;
                    
                    // Dessiner le sprite
                    ctx.drawImage(
                        this.boosterSprite,
                        -spriteSize/2, -spriteSize/2,
                        spriteSize, spriteSize
                    );
                    
                    ctx.restore();
                }
                
                ctx.globalAlpha = 1;
            } else {
                // Fallback : dessiner des chevrons
                ctx.strokeStyle = `rgba(255, 255, 255, 0.9)`;
                ctx.lineWidth = 3;
                
                const chevronCount = Math.floor(length / 30);
                const chevronSpacing = length / (chevronCount + 1);
                
                for (let i = 1; i <= chevronCount; i++) {
                    const x = -length/2 + i * chevronSpacing;
                    ctx.beginPath();
                    ctx.moveTo(x - 10, 5);
                    ctx.lineTo(x, -5);
                    ctx.lineTo(x + 10, 5);
                    ctx.stroke();
                }
            }
            
            ctx.restore();
        });
        
        ctx.restore();
    }

    renderFinishLine(ctx) {
        if (!this.track.finishLine) return;
        
        ctx.save();
        
        const fl = this.track.finishLine;
        
        if (fl.x1 !== undefined && fl.y1 !== undefined) {
            // Format ligne
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
        }
        
        ctx.restore();
    }

    renderPlayerInfo(ctx) {
        const currentPlayer = this.gameState.players.find(p => p.id === this.playerId);
        if (!currentPlayer) return;
        
        ctx.save();
        ctx.resetTransform();
        
        // Ajuster les positions et largeurs pour mieux centrer le texte
        const boxWidth = 220 * this.scale;
        const boxHeight = 85 * this.scale;
        const padding = 10 * this.scale;
        const infoX = this.canvas.width - boxWidth - (20 * this.scale);
        const infoY = 20 * this.scale;
        const borderRadius = 15 * this.scale;
        
        // Créer un gradient pour le fond
        const gradient = ctx.createLinearGradient(infoX, infoY, infoX + boxWidth, infoY + boxHeight);
        gradient.addColorStop(0, 'rgba(147, 51, 234, 0.7)');
        gradient.addColorStop(1, 'rgba(236, 72, 153, 0.7)');
        
        // Dessiner le rectangle arrondi avec gradient
        ctx.beginPath();
        ctx.moveTo(infoX + borderRadius, infoY);
        ctx.lineTo(infoX + boxWidth - borderRadius, infoY);
        ctx.quadraticCurveTo(infoX + boxWidth, infoY, infoX + boxWidth, infoY + borderRadius);
        ctx.lineTo(infoX + boxWidth, infoY + boxHeight - borderRadius);
        ctx.quadraticCurveTo(infoX + boxWidth, infoY + boxHeight, infoX + boxWidth - borderRadius, infoY + boxHeight);
        ctx.lineTo(infoX + borderRadius, infoY + boxHeight);
        ctx.quadraticCurveTo(infoX, infoY + boxHeight, infoX, infoY + boxHeight - borderRadius);
        ctx.lineTo(infoX, infoY + borderRadius);
        ctx.quadraticCurveTo(infoX, infoY, infoX + borderRadius, infoY);
        ctx.closePath();
        
        // Remplir avec le gradient
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Ajouter une bordure néon
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2 * this.scale;
        ctx.stroke();
        
        // Effet de lueur externe
        ctx.shadowColor = 'rgba(236, 72, 153, 0.8)';
        ctx.shadowBlur = 20 * this.scale;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.stroke();
        
        // Réinitialiser l'ombre pour le texte
        ctx.shadowBlur = 0;
        
        // Texte aligné à gauche avec padding
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `${16 * this.scale}px Arial`;
        ctx.textAlign = 'left';
        
        // Ajouter une légère ombre au texte pour la lisibilité
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 2 * this.scale;
        
        const textX = infoX + padding;
        
        // Position
        ctx.fillText(`🏆 Position: ${currentPlayer.position}/${this.gameState.players.length}`, textX, infoY + 22 * this.scale);
        
        // Laps
        const displayLap = currentPlayer.lap === 0 ? 0 : currentPlayer.lap;
        ctx.fillText(`🏁 Lap: ${displayLap}/${currentPlayer.lapsToWin}`, textX, infoY + 44 * this.scale);
        
        // Timer avec temps restant
        const minutes = Math.floor(this.gameState.gameTime / 60000);
        const seconds = Math.floor((this.gameState.gameTime % 60000) / 1000);
        let timeString = `⏱️ Time: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Ajouter le temps restant si applicable
        if (this.gameState.maxTime && this.gameState.remainingTime !== null) {
            const remainingSeconds = Math.floor(this.gameState.remainingTime / 1000);
            const remainingMinutes = Math.floor(remainingSeconds / 60);
            const remainingSecondsOnly = remainingSeconds % 60;
            
            // Changer la couleur selon le temps restant
            if (remainingSeconds < 60) {
                ctx.fillStyle = '#ff4444';
                ctx.font = `bold ${16 * this.scale}px Arial`;
                ctx.shadowColor = 'rgba(255, 68, 68, 0.5)';
                ctx.shadowBlur = 4 * this.scale;
            } else if (remainingSeconds < 120) {
                ctx.fillStyle = '#ffaa44';
                ctx.shadowColor = 'rgba(255, 170, 68, 0.5)';
                ctx.shadowBlur = 3 * this.scale;
            }
            
            timeString += ` (${remainingMinutes}:${remainingSecondsOnly.toString().padStart(2, '0')})`;
        }
        
        ctx.fillText(timeString, textX, infoY + 66 * this.scale);
        
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
        
        // Effet de boost si actif
        const boostEffect = this.boosterEffects.get(player.id);
        if (boostEffect) {
            // Traînée de vitesse
            const trailLength = 40;
            const gradient = ctx.createLinearGradient(-trailLength, 0, 0, 0);
            gradient.addColorStop(0, 'rgba(0, 255, 150, 0)');
            gradient.addColorStop(1, `rgba(0, 255, 150, ${0.6 * (boostEffect.duration / 1500)})`);
            
            ctx.fillStyle = gradient;
            ctx.fillRect(-trailLength, -size/2, trailLength, size);
            
            // Particules
            ctx.save();
            const particleCount = 3;
            for (let i = 0; i < particleCount; i++) {
                const offset = (Date.now() * 0.01 + i * 120) % 360;
                const px = -20 - Math.random() * 20;
                const py = (Math.sin(offset * 0.1) * 10);
                
                ctx.fillStyle = `rgba(0, 255, 150, ${0.5 * (boostEffect.duration / 1500)})`;
                ctx.beginPath();
                ctx.arc(px, py, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            
            // Aura autour du kart
            ctx.shadowColor = 'rgba(0, 255, 150, 0.8)';
            ctx.shadowBlur = 20;
        }
        
        const cachedSprite = this.spriteCache.get(player.color);
        
        if (cachedSprite) {
            ctx.drawImage(cachedSprite, -size/2, -size/2);
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
        
        // Gérer uniquement l'item slot
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
        
        // Détecter les nouveaux boosts pour les effets visuels uniquement
        gameData.players.forEach(player => {
            if (player.isBoosting && !this.boosterEffects.has(player.id)) {
                this.boosterEffects.set(player.id, {
                    duration: 1500,
                    startTime: Date.now()
                });
            }
        });
        
        const currentIds = new Set(gameData.players.map(p => p.id));
        for (const [id] of this.playerInterpolation) {
            if (!currentIds.has(id)) {
                this.playerInterpolation.delete(id);
            }
        }
    }
}