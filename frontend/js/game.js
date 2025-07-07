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
        
        // Nouveau : état des boosters
        this.boosterEffects = new Map(); // Pour les effets visuels
        this.boosterSprite = null; // Pour stocker le sprite du booster
        this.loadBoosterSprite();
        
        // NOUVEAU : Gestion des effets visuels
        this.damageEffects = new Map(); // Effets de dégâts
        this.particleSystem = new ParticleSystem(); // Système de particules
        
        // Charger les sprites d'effets
        this.loadEffectSprites();
        
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

    // Nouvelle méthode pour charger le sprite du booster
    loadBoosterSprite() {
        this.boosterSprite = new Image();
        this.boosterSprite.src = 'assets/booster_arrow.png'; // Assurez-vous d'avoir ce fichier
    }
    
    // Nouvelle méthode pour charger les sprites d'effets
    loadEffectSprites() {
        // Sprites d'étincelles et d'explosion
        this.sparkSprite = new Image();
        this.sparkSprite.src = 'assets/spark.png';
        
        this.explosionSprite = new Image();
        this.explosionSprite.src = 'assets/explosion.png';
        
        // Si les sprites n'existent pas, on utilisera des effets générés
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
            
            // CORRECTION : Appliquer immédiatement le volume actuel du soundManager
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
        this.setupDamageEvents(); // NOUVEAU
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
        
        // NOUVEAU : Mettre à jour le système de particules
        this.particleSystem.update(deltaTime);
        
        const player = this.getInterpolatedPlayer(this.playerId);
        if (player) {
            this.camera.x = player.x - (this.canvas.width / this.scale) / 2;
            this.camera.y = player.y - (this.canvas.height / this.scale) / 2;
            
            this.camera.x = Math.max(0, Math.min(this.track.width - this.canvas.width / this.scale, this.camera.x));
            this.camera.y = Math.max(0, Math.min(this.track.height - this.canvas.height / this.scale, this.camera.y));
        }
        
        this.updateUI();
    }

    // Nouvelle méthode pour les effets visuels de boost
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
        this.renderBoosters(ctx); // NOUVEAU
        this.renderItemBoxes(ctx); // AJOUT : Rendre les boîtes d'objets
        this.renderFinishLine(ctx);
        
        // NOUVEAU : Rendre les effets de particules en dessous des joueurs
        this.particleSystem.render(ctx);
        
        this.renderProjectiles(ctx); // AJOUT : Rendre les projectiles
        this.renderPlayers(ctx);
        this.renderPlayerInfo(ctx);
        
        // NOUVEAU : Rendre les effets de dégâts au-dessus des joueurs
        this.renderDamageEffects(ctx);
        
        ctx.restore();
        
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        
        this.renderUI();
        
        // NOUVEAU : Rendre la barre d'HP
        this.renderHealthBar();
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

       // NOUVEAU : Rendre les boîtes d'objets
    renderItemBoxes(ctx) {
        if (!this.gameState.itemBoxes) return;
        
        const time = Date.now() * 0.001;
        
        this.gameState.itemBoxes.forEach(box => {
            ctx.save();
            ctx.translate(box.x, box.y);
            
            // Animation de rotation et flottement
            const float = Math.sin(time * 2) * 5;
            ctx.translate(0, float);
            ctx.rotate(time);
            
            // Dessiner la boîte
            if (this.itemBoxSprite) {
                ctx.drawImage(this.itemBoxSprite, -32, -32, 64, 64);
            } else {
                // Fallback
                ctx.fillStyle = '#ffd700';
                ctx.fillRect(-30, -30, 60, 60);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 3;
                ctx.strokeRect(-30, -30, 60, 60);
                
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 36px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('?', 0, 0);
            }
            
            ctx.restore();
        });
    }
    
    // NOUVEAU : Rendre les projectiles
    renderProjectiles(ctx) {
        if (!this.gameState.projectiles) return;
        
        this.gameState.projectiles.forEach(projectile => {
            ctx.save();
            ctx.translate(projectile.x, projectile.y);
            
            switch(projectile.type) {
                case 'bomb':
                    this.renderBomb(ctx, projectile);
                    break;
                case 'rocket':
                    this.renderRocket(ctx, projectile);
                    break;
            }
            
            ctx.restore();
        });
    }
    
    // Rendre une bombe
    renderBomb(ctx, bomb) {
        const anim = this.projectileAnimations.get(bomb.id);
        const time = anim ? anim.time / 1000 : 0;
        
        // Effet de pulsation
        const scale = 1 + Math.sin(time * 10) * 0.1;
        ctx.scale(scale, scale);
        
        // Corps de la bombe
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.fill();
        
        // Reflets
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(-5, -5, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Mèche
        ctx.strokeStyle = '#ff6600';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(0, -30);
        ctx.stroke();
        
        // Étincelle
        const sparkSize = 3 + Math.random() * 3;
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(0, -30, sparkSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Compte à rebours visuel
        if (anim) {
            const timeLeft = Math.max(0, 2 - time);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(timeLeft.toFixed(1), 0, 0);
        }
    }
    
    // Rendre une roquette
    renderRocket(ctx, rocket) {
        ctx.rotate(rocket.angle);
        
        // Traînée de fumée
        const gradient = ctx.createLinearGradient(-30, 0, 0, 0);
        gradient.addColorStop(0, 'rgba(150, 150, 150, 0)');
        gradient.addColorStop(1, 'rgba(100, 100, 100, 0.8)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(-30, -5, 30, 10);
        
        // Corps de la roquette
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(-15, -8, 30, 16);
        
        // Pointe
        ctx.fillStyle = '#ff6666';
        ctx.beginPath();
        ctx.moveTo(15, -8);
        ctx.lineTo(25, 0);
        ctx.lineTo(15, 8);
        ctx.closePath();
        ctx.fill();
        
        // Flamme du propulseur
        const flameSize = Math.random() * 10 + 10;
        const flameGradient = ctx.createRadialGradient(-15, 0, 0, -15, 0, flameSize);
        flameGradient.addColorStop(0, '#ffff00');
        flameGradient.addColorStop(0.5, '#ff8800');
        flameGradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
        
        ctx.fillStyle = flameGradient;
        ctx.beginPath();
        ctx.arc(-15, 0, flameSize, 0, Math.PI * 2);
        ctx.fill();
    }

    // Nouvelle méthode pour afficher les boosters
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
                const spriteSize = 64; // Votre sprite fait 64x64
                const spacing = 10; // Espace entre les flèches
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
                    const scale = 0.9 + Math.sin(pulsePhase) * 0.1; // De 0.9 à 1.1 au lieu de 0.8 à 1.2
                    ctx.scale(scale, scale);
                    
                    // Opacité constante élevée (jamais en dessous de 0.7)
                    ctx.globalAlpha = 0.7 + Math.sin(pulsePhase) * 0.3; // De 0.7 à 1.0
                    
                    // Dessiner le sprite (déjà orienté vers le haut)
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
        const boxWidth = 220 * this.scale;  // Largeur augmentée pour le temps restant
        const boxHeight = 85 * this.scale;  // Hauteur augmentée pour la position
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
    
    // Nouvelle méthode pour rendre la barre d'HP
    renderHealthBar() {
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;
        
        const ctx = this.ctx;
        ctx.save();
        
        // Position en bas à droite
        const barWidth = 200 * this.scale;
        const barHeight = 25 * this.scale;
        const padding = 20 * this.scale;
        const x = this.canvas.width - barWidth - padding;
        const y = this.canvas.height - barHeight - padding;
        const borderRadius = 12 * this.scale;
        
        // Fond de la barre avec gradient cyberpunk
        const bgGradient = ctx.createLinearGradient(x, y, x + barWidth, y);
        bgGradient.addColorStop(0, 'rgba(147, 51, 234, 0.3)');
        bgGradient.addColorStop(1, 'rgba(236, 72, 153, 0.3)');
        
        // Dessiner le fond arrondi
        this.drawRoundedRect(ctx, x, y, barWidth, barHeight, borderRadius);
        ctx.fillStyle = bgGradient;
        ctx.fill();
        
        // Bordure néon
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2 * this.scale;
        ctx.stroke();
        
        // Barre d'HP
        const hpPercent = Math.max(0, player.hp / player.maxHp);
        const hpWidth = (barWidth - 4 * this.scale) * hpPercent;
        
        if (hpWidth > 0) {
            const hpGradient = ctx.createLinearGradient(x + 2, y + 2, x + 2 + hpWidth, y + 2);
            
            // Couleur selon les HP
            if (hpPercent > 0.6) {
                // Vert/Cyan
                hpGradient.addColorStop(0, '#4ecdc4');
                hpGradient.addColorStop(1, '#44a3aa');
            } else if (hpPercent > 0.3) {
                // Jaune/Orange
                hpGradient.addColorStop(0, '#ffaa44');
                hpGradient.addColorStop(1, '#ff8844');
            } else {
                // Rouge/Rose avec pulsation
                const pulse = Math.sin(Date.now() * 0.005) * 0.2 + 0.8;
                hpGradient.addColorStop(0, `rgba(255, 68, 68, ${pulse})`);
                hpGradient.addColorStop(1, `rgba(236, 72, 153, ${pulse})`);
            }
            
            this.drawRoundedRect(
                ctx, 
                x + 2 * this.scale, 
                y + 2 * this.scale, 
                hpWidth, 
                barHeight - 4 * this.scale, 
                borderRadius - 2
            );
            ctx.fillStyle = hpGradient;
            ctx.fill();
            
            // Effet de brillance
            if (!player.isDead) {
                ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * hpPercent})`;
                this.drawRoundedRect(
                    ctx,
                    x + 2 * this.scale,
                    y + 2 * this.scale,
                    hpWidth,
                    (barHeight - 4 * this.scale) * 0.4,
                    borderRadius - 2
                );
                ctx.fill();
            }
        }
        
        // Texte HP
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${14 * this.scale}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 3 * this.scale;
        
        const hpText = player.isDead ? 'DESTROYED' : `${Math.ceil(player.hp)} HP`;
        ctx.fillText(hpText, x + barWidth / 2, y + barHeight / 2);
        
        // Effet d'invulnérabilité
        if (player.isInvulnerable) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${Math.sin(Date.now() * 0.01) * 0.5 + 0.5})`;
            ctx.lineWidth = 3 * this.scale;
            this.drawRoundedRect(ctx, x - 2, y - 2, barWidth + 4, barHeight + 4, borderRadius);
            ctx.stroke();
        }
        
        ctx.restore();
    }
    
    // Méthode utilitaire pour dessiner des rectangles arrondis
    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
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
        
        // Effet d'invulnérabilité
        if (player.isInvulnerable) {
            const alpha = Math.sin(Date.now() * 0.01) * 0.3 + 0.3;
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(0, 0, size + 5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Effet de dégâts (rouge clignotant)
        const damageEffect = this.damageEffects.get(player.id);
        if (damageEffect && damageEffect.time > Date.now()) {
            const intensity = (damageEffect.time - Date.now()) / damageEffect.duration;
            ctx.fillStyle = `rgba(255, 0, 0, ${intensity * 0.6})`;
            ctx.fillRect(-size/2 - 2, -size/2 - 2, size + 4, size + 4);
        }
        
        // Ne pas rendre le kart si mort (sera remplacé par l'explosion)
        if (!player.isDead) {
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
            } else {
                ctx.fillStyle = player.color;
                ctx.fillRect(-size/2, -size/2, size, size);
                
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.strokeRect(-size/2, -size/2, size, size);
            }
        }
        
        ctx.restore();
        
        // Pseudo et position (seulement si pas mort)
        if (!player.isDead) {
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
    }
    
    // Nouvelle méthode pour rendre les effets de dégâts
    renderDamageEffects(ctx) {
        // Rendre les explosions
        for (const [playerId, player] of this.gameState.players.entries()) {
            if (player.isDead) {
                this.renderExplosion(ctx, player.x, player.y, player.id);
            }
        }
    }
    
    // Méthode pour rendre une explosion
    renderExplosion(ctx, x, y, playerId) {
        const explosionData = this.damageEffects.get(`explosion_${playerId}`);
        if (!explosionData) return;
        
        const progress = (Date.now() - explosionData.startTime) / explosionData.duration;
        if (progress > 1) {
            this.damageEffects.delete(`explosion_${playerId}`);
            return;
        }
        
        ctx.save();
        ctx.translate(x, y);
        
        // Cercles d'explosion multiples
        for (let i = 0; i < 3; i++) {
            const delay = i * 0.1;
            const ringProgress = Math.max(0, Math.min(1, (progress - delay) / (1 - delay)));
            
            if (ringProgress > 0 && ringProgress < 1) {
                const radius = 20 + ringProgress * 60;
                const alpha = (1 - ringProgress) * 0.8;
                
                ctx.strokeStyle = `rgba(255, ${100 + i * 50}, ${i * 30}, ${alpha})`;
                ctx.lineWidth = 3 + (1 - ringProgress) * 5;
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2);
                ctx.stroke();
                
                // Remplissage
                const fillAlpha = (1 - ringProgress) * 0.3;
                ctx.fillStyle = `rgba(255, ${150 + i * 30}, 0, ${fillAlpha})`;
                ctx.fill();
            }
        }
        
        // Flash central
        if (progress < 0.3) {
            const flashAlpha = (1 - progress / 0.3) * 0.9;
            const flashRadius = 30 * (1 + progress * 2);
            
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, flashRadius);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${flashAlpha})`);
            gradient.addColorStop(0.3, `rgba(255, 200, 100, ${flashAlpha * 0.8})`);
            gradient.addColorStop(0.7, `rgba(255, 100, 0, ${flashAlpha * 0.5})`);
            gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(-flashRadius, -flashRadius, flashRadius * 2, flashRadius * 2);
        }
        
        ctx.restore();
    }
    
    // Gérer les événements de dégâts depuis le serveur
    setupDamageEvents() {
        // Importer soundManager au début de la méthode
        const soundManager = window.soundManager || (window.gameClient && window.gameClient.soundManager);
        
        this.socket.on('playerDamaged', (data) => {
            // Ajouter l'effet de dégât
            this.damageEffects.set(data.playerId, {
                time: Date.now() + 200,
                duration: 200
            });
            
            // Créer des particules selon le type
            if (data.damageType === 'scrape') {
                this.particleSystem.createSparks(data.position.x, data.position.y, 10);
                if (soundManager) soundManager.playWallScrape();
            } else if (data.damageType === 'crash') {
                this.particleSystem.createSparks(data.position.x, data.position.y, 30);
                if (soundManager) soundManager.playWallHit();
            }
        });
        
        this.socket.on('playersCollided', (data) => {
            // Créer des particules à l'impact
            this.particleSystem.createSparks(data.position.x, data.position.y, 20);
            if (soundManager) soundManager.playPlayerCollision();
        });
        
        this.socket.on('playerDeath', (data) => {
            // Créer l'explosion
            this.damageEffects.set(`explosion_${data.playerId}`, {
                startTime: Date.now(),
                duration: 1000
            });
            
            // Créer beaucoup de particules
            this.particleSystem.createExplosion(data.position.x, data.position.y);
            if (soundManager) soundManager.playExplosion();
        });
        
        this.socket.on('playerRespawned', (data) => {
            // Effet de respawn
            this.particleSystem.createRespawnEffect(data.position.x, data.position.y);
            if (soundManager) soundManager.playRespawn();
        });
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
                    duration: 1500, // 1.5 secondes d'effet visuel
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

// Nouveau système de particules
class ParticleSystem {
    constructor() {
        this.particles = [];
    }
    
    createSparks(x, y, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 50 + Math.random() * 150;
            const size = 2 + Math.random() * 3;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: size,
                life: 0.5 + Math.random() * 0.5,
                maxLife: 0.5 + Math.random() * 0.5,
                color: `hsl(${30 + Math.random() * 30}, 100%, ${50 + Math.random() * 50}%)`,
                type: 'spark'
            });
        }
    }
    
    createExplosion(x, y) {
        // Débris
        for (let i = 0; i < 40; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 100 + Math.random() * 200;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 3 + Math.random() * 5,
                life: 1 + Math.random() * 0.5,
                maxLife: 1 + Math.random() * 0.5,
                color: `hsl(${Math.random() * 60}, 100%, ${50 + Math.random() * 50}%)`,
                type: 'debris'
            });
        }
        
        // Fumée
        for (let i = 0; i < 20; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 20 + Math.random() * 50;
            
            this.particles.push({
                x: x + (Math.random() - 0.5) * 20,
                y: y + (Math.random() - 0.5) * 20,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 30,
                size: 10 + Math.random() * 20,
                life: 2,
                maxLife: 2,
                color: 'rgba(100, 100, 100, 0.6)',
                type: 'smoke'
            });
        }
    }
    
    createRespawnEffect(x, y) {
        // Effet de téléportation
        for (let i = 0; i < 30; i++) {
            const angle = (i / 30) * Math.PI * 2;
            const speed = 100;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 3,
                life: 0.8,
                maxLife: 0.8,
                color: '#4ecdc4',
                type: 'respawn',
                angle: angle
            });
        }
    }
    
    update(deltaTime) {
        this.particles = this.particles.filter(particle => {
            particle.life -= deltaTime;
            
            if (particle.life <= 0) return false;
            
            // Physique
            particle.x += particle.vx * deltaTime;
            particle.y += particle.vy * deltaTime;
            
            // Gravité pour certains types
            if (particle.type === 'debris' || particle.type === 'smoke') {
                particle.vy += 200 * deltaTime;
            }
            
            // Friction
            particle.vx *= 0.98;
            particle.vy *= 0.98;
            
            return true;
        });
    }
    
    render(ctx) {
        ctx.save();
        
        this.particles.forEach(particle => {
            const lifeRatio = particle.life / particle.maxLife;
            
            if (particle.type === 'spark') {
                ctx.fillStyle = particle.color;
                ctx.globalAlpha = lifeRatio;
                ctx.fillRect(
                    particle.x - particle.size/2,
                    particle.y - particle.size/2,
                    particle.size,
                    particle.size
                );
            } else if (particle.type === 'debris') {
                ctx.save();
                ctx.translate(particle.x, particle.y);
                ctx.rotate(particle.angle || 0);
                ctx.fillStyle = particle.color;
                ctx.globalAlpha = lifeRatio;
                ctx.fillRect(
                    -particle.size/2,
                    -particle.size/2,
                    particle.size,
                    particle.size * 0.5
                );
                ctx.restore();
            } else if (particle.type === 'smoke') {
                const alpha = lifeRatio * 0.3;
                ctx.fillStyle = `rgba(100, 100, 100, ${alpha})`;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.size * (2 - lifeRatio), 0, Math.PI * 2);
                ctx.fill();
            } else if (particle.type === 'respawn') {
                ctx.strokeStyle = particle.color;
                ctx.globalAlpha = lifeRatio;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(particle.x, particle.y);
                ctx.lineTo(
                    particle.x + Math.cos(particle.angle) * 20 * lifeRatio,
                    particle.y + Math.sin(particle.angle) * 20 * lifeRatio
                );
                ctx.stroke();
            }
        });
        
        ctx.globalAlpha = 1;
        ctx.restore();
    }
}