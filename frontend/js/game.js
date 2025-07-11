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
            remainingTime: null,
            itemBoxes: [],
            projectiles: [],
            poisonSlicks: []
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
        
        // NOUVEAU : Initialisation projectileAnimations
        this.projectileAnimations = new Map();
        
        // NOUVEAU : Sprite des boîtes d'objets
        this.itemBoxSprite = new Image();
        this.itemBoxSprite.src = 'assets/item_box.png';

        // NOUVEAU : Sprite sheet des objets
        this.itemIconsSprite = new Image();
        this.itemIconsSprite.src = 'assets/items_icons.png';
        this.itemIconsLoaded = false;
        this.itemIconsSprite.onload = () => {
            this.itemIconsLoaded = true;
        };
        
        this.itemSlotAnimation = null;
        this.pendingItem = null; // L'objet réel qu'on cache pendant l'animation
        this.isAnimatingItem = false;

        // Cache pour les icônes découpées
        this.itemIconsCache = {};
        
        // Item pickup notification
        this.itemNotification = null;    
        
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
        
        const aspectRatio = 3 / 2;
        
        let width = Math.min(maxWidth, 1536);
        let height = width / aspectRatio;
        
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }
        
        this.canvas.width = width;
        this.canvas.height = height;
        
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
        
        this.scale = width / 1536;
    }

    // Nouvelle méthode pour charger le sprite du booster
    loadBoosterSprite() {
        this.boosterSprite = new Image();
        this.boosterSprite.src = 'assets/booster_arrow.png';
    }
    
    // Nouvelle méthode pour charger les sprites d'effets
    loadEffectSprites() {
        // Sprites d'étincelles et d'explosion
        this.sparkSprite = new Image();
        this.sparkSprite.src = 'assets/spark.png';
        
        this.explosionSprite = new Image();
        this.explosionSprite.src = 'assets/explosion.png';
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
        this.setupDamageEvents();
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

        getItemIcon(itemType) {
        // Si pas encore chargé, retourner null
        if (!this.itemIconsLoaded) return null;
        
        // Si déjà en cache, le retourner
        if (this.itemIconsCache[itemType]) {
            return this.itemIconsCache[itemType];
        }
        
        // Positions dans la grille 3x3 (1024x1024 pixels, donc 341.33px par icône)
        const iconSize = 341.33; // 1024 / 3
        const positions = {
            'healthpack': { row: 0, col: 0 },  // 1ère de la 1ère ligne (top-left)
            'rocket': { row: 1, col: 0 },      // 1ère de la 2ème ligne
            'bomb': { row: 2, col: 0 },        // 1ère de la 3ème ligne
            'superboost': { row: 0, col: 1 },  // 2ème de la 1ère ligne
            'poisonslick': { row: 2, col: 1 }  // 2ème de la 3ème ligne (bottom-mid)
        };
        
        const pos = positions[itemType];
        if (!pos) return null;
        
        // Créer un canvas pour stocker l'icône découpée
        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = 64; // Taille finale désirée
        iconCanvas.height = 64;
        const iconCtx = iconCanvas.getContext('2d');
        
        // Découper et redimensionner l'icône
        iconCtx.drawImage(
            this.itemIconsSprite,
            pos.col * iconSize, pos.row * iconSize, iconSize, iconSize, // Source
            0, 0, 64, 64 // Destination
        );
        
        // Mettre en cache
        this.itemIconsCache[itemType] = iconCanvas;
        
        return iconCanvas;
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
    this.renderBoosters(ctx);
    this.renderItemBoxes(ctx);
    this.renderPoisonSlicks(ctx);
    this.renderFinishLine(ctx);
    
    this.particleSystem.render(ctx);
    
    this.renderProjectiles(ctx);
    this.renderPlayers(ctx);
    this.renderPlayerInfo(ctx);
    
    this.renderDamageEffects(ctx);
    
    ctx.restore();
    
    this.ctx.drawImage(this.offscreenCanvas, 0, 0);
    
    this.renderUI();
    this.renderHealthBar();
    
    // Rendre soit l'animation, soit la case d'objet normale
    if (this.itemSlotAnimation) {
        this.renderItemSlotAnimation();
    } else {
        this.renderItemSlot();
    }
    
    // Render item pickup notification
    this.renderItemNotification();
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
            
            // Dessiner le sprite
            if (this.itemBoxSprite && this.itemBoxSprite.complete) {
                ctx.drawImage(this.itemBoxSprite, -16, -16, 32, 32);
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
    
    // NOUVEAU : Rendre les poison slicks
    renderPoisonSlicks(ctx) {
        if (!this.gameState.poisonSlicks) return;
        
        this.gameState.poisonSlicks.forEach(slick => {
            ctx.save();
            ctx.translate(slick.x, slick.y);
            
            // Effet d'animation
            const time = Date.now() * 0.001;
            const pulse = 1 + Math.sin(time * 3) * 0.05;
            
            // Draw the poison slick sprite
            const poisonIcon = this.getItemIcon('poisonslick');
            if (poisonIcon) {
                ctx.globalAlpha = 0.9;
                // Scale the sprite to match the slick radius
                const spriteSize = slick.radius * 2 * pulse;
                ctx.drawImage(
                    poisonIcon,
                    -spriteSize / 2,
                    -spriteSize / 2,
                    spriteSize,
                    spriteSize
                );
            }
            
            // Simple bubble effect on top of sprite
            ctx.globalAlpha = 0.6;
            for (let i = 0; i < 3; i++) {
                const bubbleTime = time * 2 + i * 2;
                const bubbleY = -slick.radius * 0.5 + (bubbleTime % 3) * slick.radius * 0.3;
                const bubbleX = Math.sin(bubbleTime) * slick.radius * 0.3;
                const bubbleSize = 4 + Math.sin(bubbleTime * 2) * 2;
                
                ctx.fillStyle = 'rgba(200, 150, 255, 0.5)';
                ctx.beginPath();
                ctx.arc(bubbleX, bubbleY, bubbleSize, 0, Math.PI * 2);
                ctx.fill();
            }
            
            ctx.restore();
        });
    }
    
    // Rendre une bombe
    renderBomb(ctx, bomb) {
    // Initialiser l'animation si elle n'existe pas
    if (!this.projectileAnimations.has(bomb.id)) {
        this.projectileAnimations.set(bomb.id, {
            time: 0,
            startTime: Date.now()
        });
    }
    
    const anim = this.projectileAnimations.get(bomb.id);
    anim.time = Date.now() - anim.startTime;
    const time = anim.time / 1000; // Convertir en secondes
    
    // Effet de pulsation
    const scale = 1 + Math.sin(time * 10) * 0.1;
    ctx.scale(scale, scale);
    
    const bombIcon = this.getItemIcon('bomb');
    if (bombIcon) {
        // Dessiner le sprite de la bombe
        ctx.drawImage(bombIcon, -20, -20, 40, 40);
    } else {
        // Fallback : dessiner une bombe simple
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.fill();
        
        // Reflets
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(-5, -5, 5, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Mèche (toujours affichée, même avec le sprite)
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
    const timeLeft = Math.max(0, 2 - time);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeLeft.toFixed(1), 0, 0);
}
    
    // Rendre une roquette
        renderRocket(ctx, rocket) {
    ctx.save();
    ctx.rotate(rocket.angle + Math.PI / 2); // Ajouter 90 degrés pour corriger l'orientation
    
    const rocketIcon = this.getItemIcon('rocket');
    
    if (rocketIcon) {
        // Traînée de fumée - maintenant derrière la roquette (en bas)
        const gradient = ctx.createLinearGradient(0, 30, 0, 0);
        gradient.addColorStop(0, 'rgba(150, 150, 150, 0)');
        gradient.addColorStop(1, 'rgba(100, 100, 100, 0.8)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(-5, 0, 10, 30);
        
        // Sprite de la roquette
        ctx.drawImage(rocketIcon, -20, -20, 40, 40);
        
        // Flamme du propulseur - maintenant en bas de la roquette
        const flameSize = Math.random() * 10 + 10;
        const flameGradient = ctx.createRadialGradient(0, 20, 0, 0, 20, flameSize);
        flameGradient.addColorStop(0, '#ffff00');
        flameGradient.addColorStop(0.5, '#ff8800');
        flameGradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
        
        ctx.fillStyle = flameGradient;
        ctx.beginPath();
        ctx.arc(0, 20, flameSize, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // Fallback : dessiner une roquette simple si le sprite n'est pas chargé
        
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
    
    ctx.restore();
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
        
        // Calculate jump effect
        const jumpHeight = player.counterSteerJump || 0;
        const jumpScale = 1 + jumpHeight * 0.4; // Kart gets 40% bigger when jumping
        const shadowOffset = jumpHeight * 35; // Shadow separates much more from kart
        
        // Only draw shadow when jumping
        if (jumpHeight > 0.1) {
            ctx.save();
            const shadowAlpha = 0.4 * (1 - jumpHeight * 0.5);
            ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
            ctx.translate(-shadowOffset * 0.7, shadowOffset); // Shadow moves down and left
            ctx.rotate(player.angle);
            ctx.scale(0.9 - jumpHeight * 0.2, 0.5 - jumpHeight * 0.2); // Shadow gets smaller when jumping
            ctx.beginPath();
            ctx.ellipse(0, 0, 32, 32, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        
        // Add jump boost effect
        if (jumpHeight > 0.5) {
            ctx.save();
            ctx.globalAlpha = jumpHeight - 0.5;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, 40 * jumpHeight, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        
        ctx.rotate(player.angle);
        ctx.scale(jumpScale, jumpScale); // Apply jump scale
        
        const size = 28;
        
        // Effet d'invulnérabilité
        if (player.isInvulnerable) {
            const alpha = Math.sin(Date.now() * 0.01) * 0.3 + 0.3;
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(0, 0, size + 5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Effet de super boost
        if (player.isSuperBoosting) {
            // Aura orangée
            const auraGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2);
            auraGradient.addColorStop(0, 'rgba(255, 136, 0, 0.6)');
            auraGradient.addColorStop(0.5, 'rgba(255, 136, 0, 0.3)');
            auraGradient.addColorStop(1, 'rgba(255, 136, 0, 0)');
            
            ctx.fillStyle = auraGradient;
            ctx.fillRect(-size * 2, -size * 2, size * 4, size * 4);
        }
        
        // No visual effect on the kart when poisoned - the damage numbers are enough
        
        // Effet de stun
        if (player.isStunned) {
            // Étoiles tournantes
            ctx.save();
            const starCount = 3;
            const starRadius = 25;
            const rotation = Date.now() * 0.003;
            
            for (let i = 0; i < starCount; i++) {
                const angle = rotation + (i * Math.PI * 2 / starCount);
                const x = Math.cos(angle) * starRadius;
                const y = Math.sin(angle) * starRadius;
                
                ctx.fillStyle = '#ffff00';
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('⭐', x, y);
            }
            ctx.restore();
        }
        
        // Effet de dégâts (rouge clignotant)
        const damageEffect = this.damageEffects.get(player.id);
        if (damageEffect && damageEffect.time > Date.now()) {
            const intensity = (damageEffect.time - Date.now()) / damageEffect.duration;
            ctx.fillStyle = `rgba(255, 0, 0, ${intensity * 0.6})`;
            ctx.fillRect(-size/2 - 2, -size/2 - 2, size + 4, size + 4);
        }
        
        // Ne pas rendre le kart si mort
        if (!player.isDead) {
            // Unified boost glow system
            let glowColor = null;
            let glowIntensity = 0;
            let trailColor = null;
            
            // Check for different boost types and set appropriate colors
            const boostEffect = this.boosterEffects.get(player.id);
            
            if (player.isSuperBoosting) {
                // Keep super boost as is (orange aura handled separately)
                glowColor = null;
            } else if (player.isBoosting || boostEffect) {
                // Determine the boost level - prioritize the stored effect level
                let currentBoostLevel = 0;
                
                // First check the stored boost effect
                if (boostEffect && boostEffect.boostLevel !== undefined) {
                    currentBoostLevel = boostEffect.boostLevel;
                } 
                // Then check the player's current boost level
                else if (player.boostLevel !== undefined) {
                    currentBoostLevel = player.boostLevel;
                }
                
                // Set colors based on boost level
                if (currentBoostLevel === 3) {
                    glowColor = '#9933ff'; // Purple drift boost
                    trailColor = 'rgba(153, 51, 255,';
                } else if (currentBoostLevel === 2) {
                    glowColor = '#ff6600'; // Orange drift boost
                    trailColor = 'rgba(255, 102, 0,';
                } else if (currentBoostLevel === 1) {
                    glowColor = '#0088ff'; // Blue drift boost
                    trailColor = 'rgba(0, 136, 255,';
                } else {
                    // Regular boost pad (green) - boost level 0 or undefined
                    glowColor = '#00ff96';
                    trailColor = 'rgba(0, 255, 150,';
                }
                glowIntensity = 0.8;
            }
            
            // Apply boost effects if any boost is active
            if (boostEffect && trailColor) {
                const effectDuration = boostEffect ? boostEffect.duration : 1500;
                const effectIntensity = boostEffect ? (effectDuration / 1500) : 1;
                
                // Enhanced speed trail with proper color
                const trailLength = 60;
                const gradient = ctx.createLinearGradient(-trailLength, 0, 0, 0);
                gradient.addColorStop(0, trailColor + ' 0)');
                gradient.addColorStop(0.3, trailColor + ` ${0.2 * effectIntensity})`);
                gradient.addColorStop(0.6, trailColor + ` ${0.5 * effectIntensity})`);
                gradient.addColorStop(1, trailColor + ` ${0.8 * effectIntensity})`);
                
                ctx.fillStyle = gradient;
                
                // Create a tapered trail shape instead of rectangle
                ctx.beginPath();
                ctx.moveTo(0, -size/2);
                ctx.lineTo(-trailLength, -size/2 - 5);
                ctx.lineTo(-trailLength, size/2 + 5);
                ctx.lineTo(0, size/2);
                ctx.closePath();
                ctx.fill();
                
                // Enhanced particles
                ctx.save();
                const particleCount = 5;
                for (let i = 0; i < particleCount; i++) {
                    const offset = (Date.now() * 0.015 + i * 72) % 360;
                    const px = -25 - Math.random() * 25;
                    const py = (Math.sin(offset * 0.1) * 12);
                    
                    // Colored particle core
                    const particleGradient = ctx.createRadialGradient(px, py, 0, px, py, 6);
                    particleGradient.addColorStop(0, 'rgba(255, 255, 255, ' + effectIntensity + ')');
                    particleGradient.addColorStop(0.4, trailColor + ` ${0.8 * effectIntensity})`);
                    particleGradient.addColorStop(1, trailColor + ` ${0.2 * effectIntensity})`);
                    
                    ctx.fillStyle = particleGradient;
                    ctx.beginPath();
                    ctx.arc(px, py, 6, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }
            
            // Drift effects
            if (player.isDrifting) {
                const driftDuration = Date.now() - player.driftStartTime;
                const driftIntensity = Math.min(1, driftDuration / 1000); // 0 to 1 over 1 second
                
                // Determine colors based on charge level
                let colors = { spark: '#66ccff', trail: '#4488ff', glow: '#0088ff' }; // Blue (default)
                
                if (player.driftChargeLevel >= 3) {
                    // Purple (Ultra mini-turbo)
                    colors = { spark: '#ff66ff', trail: '#cc44ff', glow: '#9933ff' };
                } else if (player.driftChargeLevel >= 2) {
                    // Orange (Super mini-turbo)
                    colors = { spark: '#ffaa44', trail: '#ff8822', glow: '#ff6600' };
                } else if (player.driftChargeLevel >= 1) {
                    // Blue (Mini-turbo)
                    colors = { spark: '#66ccff', trail: '#4488ff', glow: '#0088ff' };
                }
                    
                // Simple visible drift trail
                ctx.save();
                
                // Draw multiple trail lines for a flowing effect
                const trailLines = 3;
                for (let t = 0; t < trailLines; t++) {
                    const lineOffset = t * 4;
                    const lineAlpha = (1 - t * 0.3) * 0.8 * driftIntensity;
                    const lineLength = 30 - t * 5;
                    
                    // Animated wave
                    const wave = Math.sin(Date.now() * 0.005 + t) * 2;
                    
                    const gradient = ctx.createLinearGradient(
                        -size/2, player.driftDirection * (size/2 + wave),
                        -size/2 - lineLength, player.driftDirection * (size/2 + wave)
                    );
                    
                    if (player.driftChargeLevel >= 3) {
                        // Purple
                        gradient.addColorStop(0, `rgba(255, 100, 255, ${lineAlpha})`);
                        gradient.addColorStop(0.5, `rgba(200, 50, 255, ${lineAlpha * 0.7})`);
                        gradient.addColorStop(1, 'transparent');
                    } else if (player.driftChargeLevel >= 2) {
                        // Orange
                        gradient.addColorStop(0, `rgba(255, 150, 50, ${lineAlpha})`);
                        gradient.addColorStop(0.5, `rgba(255, 100, 0, ${lineAlpha * 0.7})`);
                        gradient.addColorStop(1, 'transparent');
                    } else if (player.driftChargeLevel >= 1) {
                        // Blue
                        gradient.addColorStop(0, `rgba(100, 200, 255, ${lineAlpha})`);
                        gradient.addColorStop(0.5, `rgba(50, 150, 255, ${lineAlpha * 0.7})`);
                        gradient.addColorStop(1, 'transparent');
                    } else {
                        // Gray
                        gradient.addColorStop(0, `rgba(180, 180, 180, ${lineAlpha * 0.6})`);
                        gradient.addColorStop(1, 'transparent');
                    }
                    
                    ctx.strokeStyle = gradient;
                    ctx.lineWidth = 6 - t * 1.5;
                    ctx.lineCap = 'round';
                    
                    ctx.beginPath();
                    ctx.moveTo(-size/2 - lineOffset, player.driftDirection * (size/2 + wave));
                    ctx.lineTo(-size/2 - lineLength - lineOffset, player.driftDirection * (size/2 + wave - lineOffset * 0.5));
                    ctx.stroke();
                }
                
                // Add some smoke puffs
                const smokeCount = 4;
                for (let i = 0; i < smokeCount; i++) {
                    const smokeAge = (Date.now() * 0.002 + i * 0.3) % 1;
                    const smokeX = -size/2 - smokeAge * 25;
                    const smokeY = player.driftDirection * (size/2 + Math.sin(smokeAge * Math.PI) * 5);
                    const smokeSize = 8 * (1 - smokeAge);
                    const smokeAlpha = (1 - smokeAge) * 0.4 * driftIntensity;
                    
                    if (player.driftChargeLevel >= 3) {
                        ctx.fillStyle = `rgba(220, 150, 255, ${smokeAlpha})`;
                    } else if (player.driftChargeLevel >= 2) {
                        ctx.fillStyle = `rgba(255, 180, 100, ${smokeAlpha})`;
                    } else if (player.driftChargeLevel >= 1) {
                        ctx.fillStyle = `rgba(150, 200, 255, ${smokeAlpha})`;
                    } else {
                        ctx.fillStyle = `rgba(200, 200, 200, ${smokeAlpha})`;
                    }
                    
                    ctx.beginPath();
                    ctx.arc(smokeX, smokeY, smokeSize, 0, Math.PI * 2);
                    ctx.fill();
                }
                
                ctx.restore();
                    
                // Spark trail with different timing for each charge level
                const sparkStartTime = player.driftChargeLevel >= 1 ? 300 : 500; // Earlier sparks for charged
                if (driftDuration > sparkStartTime) {
                    ctx.save();
                    
                    // Different spark patterns for each tier
                    if (player.driftChargeLevel >= 3) {
                        // Purple: Intense sparks (no lightning)
                        const sparkCount = 15;
                        for (let i = 0; i < sparkCount; i++) {
                            const age = (Date.now() * 0.005 + i * 0.15) % 1;
                            const sparkX = -size/2 - age * 35;
                            const sparkY = player.driftDirection * (size/2 + Math.sin(age * Math.PI * 5) * 8);
                            
                            // Large purple sparks
                            const sparkSize = 4 * (1 - age);
                            ctx.fillStyle = 'white';
                            ctx.shadowColor = colors.glow;
                            ctx.shadowBlur = 15;
                            ctx.globalAlpha = (1 - age) * 0.9;
                            ctx.beginPath();
                            ctx.arc(sparkX, sparkY, sparkSize, 0, Math.PI * 2);
                            ctx.fill();
                            
                            // Purple outer glow
                            ctx.shadowBlur = 0;
                            ctx.fillStyle = colors.spark;
                            ctx.globalAlpha = (1 - age) * 0.6;
                            ctx.beginPath();
                            ctx.arc(sparkX, sparkY, sparkSize * 2, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    } else if (player.driftChargeLevel >= 2) {
                        // Orange: Flame-like particles
                        const flameCount = 8;
                        for (let i = 0; i < flameCount; i++) {
                            const age = (Date.now() * 0.005 + i * 0.3) % 1;
                            const flameX = -size/2 - age * 35;
                            const flameY = player.driftDirection * (size/2 + Math.sin(age * Math.PI * 3) * 10);
                            
                            // Flame shape
                            const flameHeight = 15 * (1 - age);
                            const flameWidth = 8 * (1 - age);
                            
                            ctx.fillStyle = `rgba(255, 255, 100, ${(1 - age) * 0.9})`;
                            ctx.beginPath();
                            ctx.moveTo(flameX, flameY);
                            ctx.quadraticCurveTo(flameX - flameWidth/2, flameY - flameHeight/2, flameX - flameWidth, flameY - flameHeight);
                            ctx.quadraticCurveTo(flameX - flameWidth/2, flameY - flameHeight*0.8, flameX, flameY - flameHeight);
                            ctx.quadraticCurveTo(flameX + flameWidth/2, flameY - flameHeight*0.8, flameX + flameWidth, flameY - flameHeight);
                            ctx.quadraticCurveTo(flameX + flameWidth/2, flameY - flameHeight/2, flameX, flameY);
                            ctx.fill();
                            
                            // Orange core
                            ctx.fillStyle = colors.spark;
                            ctx.globalAlpha = (1 - age) * 0.6;
                            ctx.beginPath();
                            ctx.arc(flameX, flameY - flameHeight/2, flameWidth/2, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    } else if (player.driftChargeLevel >= 1) {
                        // Blue: Classic sparks with trails
                        const sparkCount = 10;
                        for (let i = 0; i < sparkCount; i++) {
                            const age = (Date.now() * 0.004 + i * 0.2) % 1;
                            const sparkX = -size/2 - age * 30;
                            const sparkY = player.driftDirection * (size/2 + Math.sin(age * Math.PI * 4) * 6);
                            
                            // Spark trail
                            const trailLength = 20 * (1 - age);
                            const gradient = ctx.createLinearGradient(
                                sparkX, sparkY,
                                sparkX - trailLength, sparkY
                            );
                            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
                            gradient.addColorStop(0.3, colors.spark);
                            gradient.addColorStop(1, 'transparent');
                            
                            ctx.strokeStyle = gradient;
                            ctx.lineWidth = 3;
                            ctx.globalAlpha = (1 - age);
                            
                            ctx.beginPath();
                            ctx.moveTo(sparkX, sparkY);
                            ctx.lineTo(sparkX - trailLength, sparkY);
                            ctx.stroke();
                            
                            // Spark point
                            ctx.fillStyle = 'white';
                            ctx.shadowColor = colors.glow;
                            ctx.shadowBlur = 10;
                            ctx.beginPath();
                            ctx.arc(sparkX, sparkY, 3, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                    
                    ctx.globalAlpha = 1;
                    ctx.shadowBlur = 0;
                    ctx.restore();
                }
                    
                // Removed energy burst particles
            }
            
            // Don't apply glow aura for speed boosts - only for drifting
            
            // Draw the actual kart (no glow for speed boosts)
            
            // Add jump landing particles and effects
            if (player.counterSteerJump > 0) {
                ctx.save();
                
                // Takeoff particles (when jumping up)
                if (player.counterSteerJump > 0.7) {
                    const particleCount = 8;
                    for (let i = 0; i < particleCount; i++) {
                        const angle = (Math.PI * 2 / particleCount) * i;
                        const dist = 15 + (player.counterSteerJump - 0.7) * 50;
                        const px = Math.cos(angle) * dist;
                        const py = Math.sin(angle) * dist;
                        
                        ctx.fillStyle = `rgba(255, 255, 200, ${(player.counterSteerJump - 0.7) * 2})`;
                        ctx.beginPath();
                        ctx.arc(px, py, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                
                // Landing particles (when coming down)
                if (player.counterSteerJump < 0.3) {
                    const particleCount = 10;
                    for (let i = 0; i < particleCount; i++) {
                        const angle = (Math.PI * 2 / particleCount) * i + Date.now() * 0.01;
                        const dist = 40 * (0.3 - player.counterSteerJump);
                        const px = Math.cos(angle) * dist;
                        const py = Math.sin(angle) * dist;
                        
                        ctx.fillStyle = `rgba(255, 255, 255, ${player.counterSteerJump * 3})`;
                        ctx.beginPath();
                        ctx.arc(px, py, 5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                ctx.restore();
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
            
            // Reset shadow
            ctx.shadowBlur = 0;
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
        // Rendre les explosions de joueurs
        for (const [playerId, player] of this.gameState.players.entries()) {
            if (player.isDead) {
                this.renderExplosion(ctx, player.x, player.y, `explosion_${player.id}`);
            }
        }
        
        // Rendre les explosions de projectiles
        for (const [key, explosionData] of this.damageEffects.entries()) {
            if (key.startsWith('projectile_explosion_')) {
                this.renderExplosion(ctx, explosionData.x, explosionData.y, key);
            }
        }
    }
    
    // Méthode pour rendre une explosion
    renderExplosion(ctx, x, y, explosionKey) {
        const explosionData = this.damageEffects.get(explosionKey);
        if (!explosionData) return;
        
        const progress = (Date.now() - explosionData.startTime) / explosionData.duration;
        if (progress > 1) {
            this.damageEffects.delete(explosionKey);
            return;
        }
        
        ctx.save();
        ctx.translate(x, y);
        
        // Utiliser le sprite d'explosion s'il est chargé
        if (this.explosionSprite && this.explosionSprite.complete) {
            // Calculer la taille et l'opacité selon le progrès
            const maxSize = 120;
            const size = maxSize * (0.5 + progress * 0.5); // Grandit avec le temps
            const alpha = 1 - progress; // Devient transparent avec le temps
            
            ctx.globalAlpha = alpha;
            ctx.drawImage(
                this.explosionSprite, 
                -size / 2, 
                -size / 2, 
                size, 
                size
            );
            ctx.globalAlpha = 1;
        } else {
            // Fallback: Cercles d'explosion multiples si le sprite n'est pas chargé
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
        }
        
        // Flash central (garde cet effet même avec le sprite)
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
        
        // NOUVEAU : Gérer les explosions de projectiles
        this.socket.on('projectileExploded', (data) => {
            // Créer l'explosion visuelle
            this.damageEffects.set(`projectile_explosion_${data.id}`, {
                startTime: Date.now(),
                duration: 800,
                x: data.x,
                y: data.y,
                type: data.type,
                radius: data.radius
            });
            
            // Créer des particules d'explosion
            this.particleSystem.createExplosion(data.x, data.y);
        });
        
        // NOUVEAU : Gérer l'utilisation du healthpack
        this.socket.on('healthpackUsed', (data) => {
            // Créer des particules de soin
            this.particleSystem.createHealingEffect(data.position.x, data.position.y);
            
            // Jouer le son de respawn pour le soin
            if (soundManager) soundManager.playRespawn();
        });
    }

    renderUI() {
        // UI déjà optimisée via HTML/CSS
    }

    // Modifier updateUI() pour utiliser les vrais sprites dans le HUD
updateUI() {}

renderItemSlot() {
    // Si l'animation est en cours, ne pas afficher l'objet normal
    if (this.itemSlotAnimation) return;
    
    const player = this.gameState.players.find(p => p.id === this.playerId);
    if (!player) return;
    
    const ctx = this.ctx;
    ctx.save();
    
    // Position en bas à gauche
    const slotSize = 70 * this.scale;
    const padding = 20 * this.scale;
    const x = padding;
    const y = this.canvas.height - slotSize - padding;
    const borderRadius = 10 * this.scale;
    
    // Fond de la case d'objet
    ctx.fillStyle = player.item ? 'rgba(255, 215, 0, 0.3)' : 'rgba(0, 0, 0, 0.7)';
    this.drawRoundedRect(ctx, x, y, slotSize, slotSize, borderRadius);
    ctx.fill();
    
    // Bordure
    ctx.strokeStyle = player.item ? '#ffd700' : 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 3 * this.scale;
    this.drawRoundedRect(ctx, x, y, slotSize, slotSize, borderRadius);
    ctx.stroke();
    
    // Effet de lueur si objet présent
    if (player.item) {
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 10 * this.scale;
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    
    // Afficher l'icône de l'objet
    if (player.item) {
        const itemIcon = this.getItemIcon(player.item);
        
        if (itemIcon) {
            // Centrer l'icône dans la case
            const iconSize = 50 * this.scale;
            const iconX = x + (slotSize - iconSize) / 2;
            const iconY = y + (slotSize - iconSize) / 2;
            
            ctx.drawImage(itemIcon, iconX, iconY, iconSize, iconSize);
        } else {
            // Fallback avec emoji
            const itemIcons = {
                'bomb': '💣',
                'rocket': '🚀',
                'superboost': '⚡',
                'healthpack': '💚'
            };
            
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${32 * this.scale}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(
                itemIcons[player.item] || '?',
                x + slotSize / 2,
                y + slotSize / 2
            );
        }
        
        // Texte "SPACE" en dessous
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = `${12 * this.scale}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('SPACE', x + slotSize / 2, y + slotSize + 15 * this.scale);
    }
    
    ctx.restore();
}

// Améliorer aussi startItemSlotAnimation pour l'animation casino
startItemSlotAnimation(finalItem) {
    const items = ['bomb', 'rocket', 'superboost', 'healthpack', 'poisonslick'];
    
    // Stocker l'animation en cours
    this.itemSlotAnimation = {
        startTime: Date.now(),
        duration: 2000,
        finalItem: finalItem,
        items: items,
        currentIndex: 0,
        lastChange: 0
    };
    
}

    renderItemSlotAnimation() {
        if (!this.itemSlotAnimation) return;
    
        const anim = this.itemSlotAnimation;
        const elapsed = Date.now() - anim.startTime;
        
        if (elapsed >= anim.duration) {
            // Animation terminée, donner l'objet au joueur
            
            const player = this.gameState.players.find(p => p.id === this.playerId);
            if (player && this.pendingItem) {
                player.item = this.pendingItem;
                // Show item notification
                this.showItemNotification(this.pendingItem);
            }
            
            // Réinitialiser
            this.itemSlotAnimation = null;
            this.pendingItem = null;
            this.isAnimatingItem = false;
            return;
        }
        
        // Calculer la vitesse de défilement (ralentir progressivement)
        const progress = elapsed / anim.duration;
        const speed = Math.max(50, 300 * (1 - progress)); // De 300ms à 50ms entre les changements
        
        // Changer d'objet selon la vitesse
        if (elapsed - anim.lastChange > speed) {
            anim.currentIndex = (anim.currentIndex + 1) % anim.items.length;
            anim.lastChange = elapsed;
        }
        
        const currentItem = anim.items[anim.currentIndex];
        
        const ctx = this.ctx;
        ctx.save();
        
        // Position en bas à gauche
        const slotSize = 70 * this.scale;
        const padding = 20 * this.scale;
        const x = padding;
        const y = this.canvas.height - slotSize - padding;
        const borderRadius = 10 * this.scale;
        
        // Fond animé avec effet arc-en-ciel
        const hue = (elapsed / 10) % 360;
        ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.3)`;
        this.drawRoundedRect(ctx, x, y, slotSize, slotSize, borderRadius);
        ctx.fill();
        
        // Bordure animée
        const pulse = Math.sin(elapsed * 0.01) * 0.3 + 0.7;
        ctx.strokeStyle = `hsla(${hue}, 100%, 50%, 1)`;
        ctx.lineWidth = 3 * this.scale;
        ctx.shadowColor = `hsla(${hue}, 100%, 50%, 1)`;
        ctx.shadowBlur = 20 * this.scale * pulse;
        this.drawRoundedRect(ctx, x, y, slotSize, slotSize, borderRadius);
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // Icône qui change avec effet de rotation
        ctx.save();
        ctx.translate(x + slotSize / 2, y + slotSize / 2);
        
        // Rotation plus rapide au début, plus lente à la fin
        const rotationSpeed = 0.02 * (1 - progress * 0.8);
        const rotation = elapsed * rotationSpeed;
        ctx.rotate(rotation);
        
        // Scale pulsant
        const scaleEffect = 1 + Math.sin(elapsed * 0.005) * 0.1;
        ctx.scale(scaleEffect, scaleEffect);
        
        const itemIcon = this.getItemIcon(currentItem);
        if (itemIcon) {
            const iconSize = 50 * this.scale;
            ctx.drawImage(itemIcon, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
        } else {
            const itemIcons = {
                'bomb': '💣',
                'rocket': '🚀',
                'superboost': '⚡'
            };
            
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${32 * this.scale}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(itemIcons[currentItem] || '?', 0, 0);
        }
        
        ctx.restore();
        
        // Texte "???" pendant l'animation
        ctx.fillStyle = `hsla(${hue}, 100%, 70%, 1)`;
        ctx.font = `bold ${16 * this.scale}px Arial`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 3;
            ctx.fillText('???', x + slotSize / 2, y + slotSize + 15 * this.scale);
        
        ctx.restore();
    }

    updateGameState(gameData) {
    // Vérifier si on vient de recevoir un nouvel objet
    const localPlayer = this.gameState.players.find(p => p.id === this.playerId);
    const newLocalPlayer = gameData.players.find(p => p.id === this.playerId);
    
    if (newLocalPlayer && localPlayer) {
        // Détecter si on vient de recevoir un nouvel objet
        if (!localPlayer.item && newLocalPlayer.item && !this.isAnimatingItem) {
            // Démarrer l'animation et cacher l'objet
            this.pendingItem = newLocalPlayer.item;
            this.isAnimatingItem = true;
            this.startItemSlotAnimation(newLocalPlayer.item);
            // Forcer l'objet à null dans les données
            newLocalPlayer.item = null;
        }
        
        // Si on est en train d'animer, continuer à cacher l'objet
        if (this.isAnimatingItem && newLocalPlayer) {
            newLocalPlayer.item = null;
        }
    }
    
    // Mettre à jour l'état du jeu
    this.gameState = gameData;
    
    // Détecter les nouveaux boosts pour les effets visuels
    gameData.players.forEach(player => {
        if (player.isBoosting && !this.boosterEffects.has(player.id)) {
            // Determine boost duration based on type
            let duration = 1500; // default
            if (player.boostLevel === 1) duration = 700;   // Blue drift boost
            else if (player.boostLevel === 2) duration = 1000; // Orange drift boost
            else if (player.boostLevel === 3) duration = 1300; // Purple drift boost
            
            this.boosterEffects.set(player.id, {
                duration: duration,
                startTime: Date.now(),
                boostLevel: player.boostLevel || 0
            });
        }
        
        // Clean up effects when boost ends
        if (!player.isBoosting && this.boosterEffects.has(player.id)) {
            this.boosterEffects.delete(player.id);
        }
    });
    
    const currentIds = new Set(gameData.players.map(p => p.id));
    for (const [id] of this.playerInterpolation) {
        if (!currentIds.has(id)) {
            this.playerInterpolation.delete(id);
        }
    }
    }
    
    showItemNotification(itemType) {
        this.itemNotification = {
            type: itemType,
            startTime: Date.now(),
            duration: 2000 // 2 seconds
        };
    }
    
    renderItemNotification() {
        if (!this.itemNotification) return;
        
        const elapsed = Date.now() - this.itemNotification.startTime;
        if (elapsed >= this.itemNotification.duration) {
            this.itemNotification = null;
            return;
        }
        
        const ctx = this.ctx;
        ctx.save();
        
        // Calculate fade in/out
        let alpha = 1;
        if (elapsed < 300) {
            // Fade in
            alpha = elapsed / 300;
        } else if (elapsed > this.itemNotification.duration - 300) {
            // Fade out
            alpha = (this.itemNotification.duration - elapsed) / 300;
        }
        
        // Position at center of screen
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        
        // Semi-transparent background box
        const boxWidth = 280 * this.scale;
        const boxHeight = 120 * this.scale;
        const boxX = centerX - boxWidth / 2;
        const boxY = centerY - boxHeight / 2;
        
        // Dark transparent background
        ctx.fillStyle = `rgba(0, 0, 0, ${0.6 * alpha})`;
        this.drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 15 * this.scale);
        ctx.fill();
        
        // Subtle purple glow border
        ctx.strokeStyle = `rgba(147, 51, 234, ${0.4 * alpha})`;
        ctx.lineWidth = 2 * this.scale;
        ctx.shadowColor = `rgba(147, 51, 234, ${0.5 * alpha})`;
        ctx.shadowBlur = 10 * this.scale;
        this.drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 15 * this.scale);
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // Item icon centered
        const iconSize = 60 * this.scale;
        const iconX = centerX - iconSize / 2;
        const iconY = centerY - iconSize / 2 - 20 * this.scale;
        
        ctx.globalAlpha = alpha;
        const itemIcon = this.getItemIcon(this.itemNotification.type);
        if (itemIcon) {
            ctx.drawImage(itemIcon, iconX, iconY, iconSize, iconSize);
        }
        
        // Item name
        const itemNames = {
            'bomb': 'BOMB',
            'rocket': 'ROCKET',
            'superboost': 'SUPER BOOST',
            'healthpack': 'HEALTH PACK',
            'poisonslick': 'POISON SLICK'
        };
        
        const itemName = itemNames[this.itemNotification.type] || this.itemNotification.type.toUpperCase();
        
        ctx.font = `bold ${24 * this.scale}px Arial`;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(itemName, centerX, centerY + 35 * this.scale);
        
        // Add some glow effect
        const glowSize = 10 + Math.sin(elapsed * 0.005) * 5;
        ctx.shadowColor = `rgba(255, 255, 255, ${0.5 * alpha})`;
        ctx.shadowBlur = glowSize * this.scale;
        ctx.fillText(itemName, centerX, centerY + 35 * this.scale);
        
        ctx.restore();
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
    
    createHealingEffect(x, y) {
        // Particules vertes qui montent
        for (let i = 0; i < 20; i++) {
            const angle = (Math.random() - 0.5) * Math.PI * 0.5; // Angle vers le haut
            const speed = 50 + Math.random() * 100;
            
            this.particles.push({
                x: x + (Math.random() - 0.5) * 30,
                y: y + (Math.random() - 0.5) * 30,
                vx: Math.cos(angle) * speed * 0.3,
                vy: -Math.abs(Math.sin(angle) * speed), // Toujours vers le haut
                size: 4 + Math.random() * 3,
                life: 1 + Math.random() * 0.5,
                maxLife: 1 + Math.random() * 0.5,
                color: '#00ff00',
                type: 'healing'
            });
        }
        
        // Quelques croix vertes
        for (let i = 0; i < 5; i++) {
            this.particles.push({
                x: x + (Math.random() - 0.5) * 20,
                y: y + (Math.random() - 0.5) * 20,
                vx: (Math.random() - 0.5) * 20,
                vy: -50 - Math.random() * 50,
                size: 8,
                life: 1.5,
                maxLife: 1.5,
                color: '#00ff00',
                type: 'healingCross'
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
            } else if (particle.type === 'healing') {
                // Particules vertes brillantes
                ctx.fillStyle = particle.color;
                ctx.globalAlpha = lifeRatio * 0.8;
                ctx.shadowColor = '#00ff00';
                ctx.shadowBlur = 5;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            } else if (particle.type === 'healingCross') {
                // Croix vertes
                ctx.strokeStyle = particle.color;
                ctx.globalAlpha = lifeRatio;
                ctx.lineWidth = 3;
                const crossSize = particle.size * lifeRatio;
                ctx.beginPath();
                // Ligne verticale
                ctx.moveTo(particle.x, particle.y - crossSize);
                ctx.lineTo(particle.x, particle.y + crossSize);
                // Ligne horizontale
                ctx.moveTo(particle.x - crossSize, particle.y);
                ctx.lineTo(particle.x + crossSize, particle.y);
                ctx.stroke();
            }
        });
        
        ctx.globalAlpha = 1;
        ctx.restore();
    }
}
    
