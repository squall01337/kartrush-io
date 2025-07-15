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
            poisonSlicks: [],
            iceBeams: []
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
        
        // Load ice sprite for frozen effect
        this.iceSprite = null;
        this.loadIceSprite();
        
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
        
        // Wrong way alert
        this.wrongWayAlert = {
            active: false,
            startTime: 0,
            pulsePhase: 0,
            hideDelay: null  // Timer for delayed hiding
        };
        
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
    
    loadIceSprite() {
        this.iceSprite = new Image();
        this.iceSprite.onload = () => {
            console.log('Ice sprite loaded successfully');
        };
        this.iceSprite.onerror = () => {
            console.log('Ice sprite not found, using fallback rendering');
            this.iceSprite = null;
        };
        this.iceSprite.src = 'assets/ice.png';
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
            'poisonslick': { row: 2, col: 1 }, // 2ème de la 3ème ligne (bottom-mid)
            'lightning': { row: 1, col: 2 },   // 3ème de la 2ème ligne (middle-right)
            'icebeam': { row: 1, col: 1 },     // 2ème de la 2ème ligne (mid-mid)
            'sideforce': { row: 2, col: 2 },   // 3ème de la 3ème ligne (bottom-right)
            'rotorshield': { row: 0, col: 2 }  // 3ème de la 1ère ligne (top-right)
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
    this.renderIceBeams(ctx);
    this.renderFinishLine(ctx);
    
    this.particleSystem.render(ctx);
    
    this.renderVoidEffects(ctx);
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
    
    // Render wrong way alert
    this.renderWrongWayAlert();
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
    
    // Render void effects for falling players
    renderVoidEffects(ctx) {
        if (!this.gameState.players) return;
        
        const FALL_DURATION = 1500; // Same as in renderPlayer
        
        this.gameState.players.forEach(player => {
            if (player.isFalling && player.fallStartTime) {
                const elapsed = Date.now() - player.fallStartTime;
                const fallProgress = Math.min(elapsed / FALL_DURATION, 1);
                
                if (fallProgress < 1) {
                    // Calculate drift position
                    const velocityX = player.fallVelocityX || 0;
                    const velocityY = player.fallVelocityY || 0;
                    const velocity = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
                    const MAX_SPEED = 4;
                    const momentumScale = 0.5 + (velocity / MAX_SPEED) * 0.5;
                    const driftX = velocityX * (elapsed / 1000) * momentumScale;
                    const driftY = velocityY * (elapsed / 1000) * momentumScale;
                    
                    ctx.save();
                    ctx.translate(player.x + driftX, player.y + driftY);
                    
                    // Draw expanding void shadow
                    const voidRadius = Math.max(25, 25 + (fallProgress * 90)); // Expands from 25 to 115
                    const voidGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, voidRadius);
                    voidGradient.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
                    voidGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.4)');
                    voidGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    ctx.fillStyle = voidGradient;
                    ctx.beginPath();
                    ctx.arc(0, 0, voidRadius, 0, Math.PI * 2);
                    ctx.fill();
                    
                    ctx.restore();
                }
            }
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
        ctx.drawImage(bombIcon, -23, -23, 46, 46);  // Increased by 15% (was 40x40)
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
    
    renderIceBeams(ctx) {
        if (!this.gameState.iceBeams) return;
        
        this.gameState.iceBeams.forEach(beam => {
            ctx.save();
            
            // Work directly with the sprite sheet instead of cached icon
            if (!this.itemIconsSprite || !this.itemIconsSprite.complete) {
                ctx.restore();
                return;
            }
            
            // The sprite is vertical with base at bottom and tip at top
            // We need to split it into 3 parts: base, core, tip
            const iconSize = 341.33; // Size of each icon in the sprite sheet
            const sourceX = iconSize * 1; // Column 1 (mid)
            const sourceY = iconSize * 1; // Row 1 (mid)
            
            // Define the three sections (adjust these based on actual sprite)
            const baseHeight = iconSize * 0.3;  // Bottom 30%
            const tipHeight = iconSize * 0.2;   // Top 20%
            const coreHeight = iconSize * 0.5;  // Middle 50%
            
            // Calculate fade based on beam lifetime
            const fadeStart = 0.6; // Start fading at 60% of lifetime
            const elapsed = (Date.now() - beam.createdAt) / beam.lifetime;
            const opacity = elapsed > fadeStart ? 1 - (elapsed - fadeStart) / (1 - fadeStart) : 1;
            
            ctx.globalAlpha = opacity;
            
            // Rotate context to beam angle - add 90 degrees because sprite is vertical
            ctx.translate(beam.startX, beam.startY);
            ctx.rotate(beam.angle + Math.PI / 2); // Add 90 degrees to align vertical sprite with horizontal beam
            
            // Scale for beam width
            const beamWidth = 100;  // Increased from 80
            
            // Draw base (bottom of sprite) at the start of the beam (near kart)
            // The beam now grows along negative Y after rotation
            ctx.drawImage(
                this.itemIconsSprite,                   // Use sprite sheet directly
                sourceX,                                // Source X
                sourceY + iconSize - baseHeight,        // Source Y (bottom part of icon)
                iconSize,                               // Source width
                baseHeight,                             // Source height
                -beamWidth / 2,                         // Dest X (centered)
                -baseHeight,                            // Dest Y (negative because beam grows down)
                beamWidth,                              // Dest width
                baseHeight                              // Dest height
            );
            
            // Draw core (stretched middle section)
            if (beam.length > baseHeight) {
                const coreLength = Math.max(0, beam.length - baseHeight - tipHeight);
                if (coreLength > 0) {
                    ctx.drawImage(
                        this.itemIconsSprite,                   // Use sprite sheet directly
                        sourceX,                                // Source X
                        sourceY + tipHeight,                    // Source Y (middle part)
                        iconSize,                               // Source width
                        coreHeight,                             // Source height
                        -beamWidth / 2,                         // Dest X (centered)
                        -(baseHeight + coreLength),             // Dest Y (negative, after base)
                        beamWidth,                              // Dest width
                        coreLength                              // Dest height (stretched)
                    );
                }
            }
            
            // Draw tip (top of sprite) at the end of the beam
            if (beam.length > baseHeight + tipHeight) {
                ctx.drawImage(
                    this.itemIconsSprite,                   // Use sprite sheet directly
                    sourceX,                                // Source X
                    sourceY,                                // Source Y (top part of icon)
                    iconSize,                               // Source width
                    tipHeight,                              // Source height
                    -beamWidth / 2,                         // Dest X (centered)
                    -beam.length,                           // Dest Y (at the end, negative)
                    beamWidth,                              // Dest width
                    tipHeight                               // Dest height
                );
            }
            
            // No additional glow effect - just use the sprite
            
            ctx.restore();
        });
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
        
        // Global constant (same as server)
        const FALL_DURATION = 1500; // 1.5 seconds
        
        // Check if player is falling first
        let isFalling = false;
        let fallProgress = 0;
        let driftX = 0;
        let driftY = 0;
        
        if (player.isFalling && player.fallStartTime) {
            const elapsed = Date.now() - player.fallStartTime;
            fallProgress = Math.min(elapsed / FALL_DURATION, 1);
            
            // Skip rendering if fully fallen
            if (fallProgress >= 1) {
                ctx.restore();
                return;
            }
            
            isFalling = true;
            
            // Calculate momentum - keep it simple and consistent
            const velocityX = player.fallVelocityX || 0;
            const velocityY = player.fallVelocityY || 0;
            const velocity = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
            const MAX_SPEED = 4; // Same as server GAME_CONFIG.MAX_SPEED
            
            // Simple linear momentum based on speed
            const momentumScale = 0.5 + (velocity / MAX_SPEED) * 0.5; // 0.5-1x based on speed
            driftX = velocityX * (elapsed / 1000) * momentumScale;
            driftY = velocityY * (elapsed / 1000) * momentumScale;
        }
        
        ctx.translate(player.x + driftX, player.y + driftY);
        
        // Draw speed reduction effect if active
        if (player.speedReductionFactor && player.speedReductionFactor < 1 && 
            player.speedReductionEndTime && player.speedReductionEndTime > Date.now()) {
            ctx.save();
            
            // Pulsing blue circle effect
            const pulseTime = Date.now() * 0.003;
            const pulseScale = 1 + Math.sin(pulseTime) * 0.1;
            
            // Blue chains/slow effect
            ctx.strokeStyle = '#4488ff';
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.4;
            ctx.setLineDash([10, 10]);
            ctx.lineDashOffset = pulseTime * 10;
            
            ctx.beginPath();
            ctx.arc(0, 0, 35 * pulseScale, 0, Math.PI * 2);
            ctx.stroke();
            
            // Inner circle
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.arc(0, 0, 25 * pulseScale, 0, Math.PI * 2);
            ctx.stroke();
            
            // Snowflake/ice particles around the player
            ctx.setLineDash([]);
            ctx.fillStyle = '#88ccff';
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI * 2 / 6) * i + pulseTime * 0.5;
                const distance = 30 + Math.sin(pulseTime + i) * 5;
                const x = Math.cos(angle) * distance;
                const y = Math.sin(angle) * distance;
                
                ctx.globalAlpha = 0.6 + Math.sin(pulseTime + i) * 0.2;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            
            ctx.restore();
        }
        
        // Always apply player angle first
        ctx.rotate(player.angle);
        
        if (!isFalling) {
            // Calculate jump effect (only when not falling)
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
            
            ctx.scale(jumpScale, jumpScale); // Apply jump scale
        }
        
        // Apply falling transformations
        if (isFalling) {
            // Shrinking effect - start at 0.55 (45% smaller than normal)
            const scale = 0.55 - (fallProgress * 0.45); // Scale from 0.55 to 0.1
            ctx.scale(scale, scale);
            
            // Rotation while falling - start immediately for testing
            const fallRotation = fallProgress * Math.PI * 4; // 2 full rotations over 1.5 seconds
            ctx.rotate(fallRotation);
        }
        
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
            
            // Render exhaust flames when accelerating
            if (player.speed > 0.5 && !player.isDead && !player.isFrozen) {
                this.renderExhaustFlames(ctx, player, size);
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
            
            // Render frozen effect overlay if player is frozen
            if (player.isFrozen) {
                // Check if we have the ice sprite loaded
                if (this.iceSprite) {
                    ctx.globalAlpha = 0.65;  // Adjusted to 0.65 (between 0.5 and 0.8)
                    const iceSize = size * 1.5; // Make ice overlay slightly larger
                    ctx.drawImage(this.iceSprite, -iceSize/2, -iceSize/2, iceSize, iceSize);
                    ctx.globalAlpha = 1;
                } else {
                    // Fallback: draw ice effect without sprite
                    ctx.fillStyle = 'rgba(150, 200, 255, 0.6)';
                    ctx.fillRect(-size/2 - 5, -size/2 - 5, size + 10, size + 10);
                    
                    // Add some ice crystal lines
                    ctx.strokeStyle = 'rgba(200, 230, 255, 0.8)';
                    ctx.lineWidth = 2;
                    const crystalSize = size * 0.7;
                    for (let i = 0; i < 6; i++) {
                        const angle = (i * Math.PI) / 3;
                        ctx.beginPath();
                        ctx.moveTo(0, 0);
                        ctx.lineTo(Math.cos(angle) * crystalSize, Math.sin(angle) * crystalSize);
                        ctx.stroke();
                    }
                }
            }
            
            // Render Rotor Shield if active
            if (player.hasShield) {
                this.renderRotorShield(ctx, player, size);
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
            } else if (key.startsWith('lightning_')) {
                // If we have a playerId, follow the player; otherwise use static position
                if (explosionData.playerId) {
                    const player = this.gameState.players.find(p => p.id === explosionData.playerId);
                    if (player) {
                        this.renderLightningEffect(ctx, player.x, player.y, key);
                    } else {
                        this.renderLightningEffect(ctx, explosionData.x, explosionData.y, key);
                    }
                } else {
                    this.renderLightningEffect(ctx, explosionData.x, explosionData.y, key);
                }
            } else if (key.startsWith('sideforce_')) {
                this.renderSideForceEffect(ctx, explosionData, key);
            } else if (key.startsWith('push_')) {
                // Render push effect on affected player
                if (explosionData.playerId) {
                    const player = this.gameState.players.find(p => p.id === explosionData.playerId);
                    if (player) {
                        this.renderPushEffect(ctx, player, explosionData);
                    }
                }
            } else if (key.startsWith('shieldblock_')) {
                // Render shield block effect on player
                if (explosionData.playerId) {
                    const player = this.gameState.players.find(p => p.id === explosionData.playerId);
                    if (player) {
                        this.renderShieldBlockEffect(ctx, player, explosionData);
                    }
                }
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
                'healthpack': '💚',
                'poisonslick': '☠️',
                'lightning': '⚡'
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
    const items = ['bomb', 'rocket', 'superboost', 'healthpack', 'poisonslick', 'lightning', 'icebeam', 'sideforce', 'rotorshield'];
    
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
    
    showWrongWayAlert() {
        // Clear any pending hide
        if (this.wrongWayAlert.hideDelay) {
            clearTimeout(this.wrongWayAlert.hideDelay);
            this.wrongWayAlert.hideDelay = null;
        }
        
        if (!this.wrongWayAlert.active) {
            this.wrongWayAlert.active = true;
            this.wrongWayAlert.startTime = Date.now();
            this.wrongWayAlert.pulsePhase = 0;
            soundManager.playWrongDirection();
        }
    }
    
    hideWrongWayAlert() {
        // Don't hide immediately - add a 1 second delay
        if (this.wrongWayAlert.active && !this.wrongWayAlert.hideDelay) {
            this.wrongWayAlert.hideDelay = setTimeout(() => {
                this.wrongWayAlert.active = false;
                this.wrongWayAlert.hideDelay = null;
                soundManager.stopWrongDirection();
            }, 1000); // 1 second delay
        }
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
            'poisonslick': 'POISON SLICK',
            'lightning': 'LIGHTNING',
            'icebeam': 'ICE BEAM',
            'sideforce': 'SIDE FORCE',
            'rotorshield': 'ROTOR SHIELD'
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
    
    renderExhaustFlames(ctx, player, kartSize) {
        // Time-based animation
        const time = Date.now() * 0.001;
        const speedFactor = Math.min(player.speed / 10, 1); // Normalize speed
        
        // Single central exhaust position
        // x negative = behind the kart (kart faces right at angle 0)
        const exhaustPositions = [
            { x: -kartSize * 0.4, y: 0 }  // Central exhaust closer to the back
        ];
        
        exhaustPositions.forEach((pos, index) => {
            ctx.save();
            ctx.translate(pos.x, pos.y);
            
            // Draw multiple flame segments for each exhaust
            const segmentCount = 5;
            for (let i = 0; i < segmentCount; i++) {
                const segmentTime = time * 8 + i * 0.5;
                const age = i / segmentCount;
                
                // Flame properties with variation
                const baseSize = 35 * speedFactor;  // Even bigger central flame
                const flameHeight = (50 + Math.sin(segmentTime) * 12) * speedFactor * (1 - age * 0.2);  // Bigger central flame
                const flameWidth = baseSize * (1 - age * 0.3);  // Less width reduction for bigger effect
                const curve = Math.sin(segmentTime * 2) * 3 * (1 - age);
                
                // Flame position along trail (extending backward)
                const flameX = -i * 6 * speedFactor;  // Negative X = behind the kart
                const flameY = curve;  // Curve is now on Y axis for left/right wobble
                
                // Create gradient for flame (horizontal orientation)
                const gradient = ctx.createRadialGradient(
                    flameX - flameHeight * 0.3, flameY,
                    0,
                    flameX - flameHeight, flameY,
                    flameWidth
                );
                
                // Flame colors from hot to cool
                // Keep base opacity high, only reduce it slightly with age
                const baseOpacity = Math.max(0.7, speedFactor); // Minimum 70% opacity
                const opacity = baseOpacity * (1 - age * 0.3);  // Only slight reduction with age
                if (i === 0) {
                    // Hottest part (white-blue-purple core)
                    gradient.addColorStop(0, `rgba(200, 220, 255, ${opacity})`);
                    gradient.addColorStop(0.2, `rgba(150, 150, 255, ${opacity * 0.9})`);
                    gradient.addColorStop(0.4, `rgba(180, 100, 255, ${opacity * 0.7})`);
                    gradient.addColorStop(0.6, `rgba(150, 50, 200, ${opacity * 0.5})`);
                    gradient.addColorStop(1, 'transparent');
                } else if (i === 1) {
                    // Transition from purple to blue to orange
                    gradient.addColorStop(0, `rgba(180, 120, 255, ${opacity * 0.8})`);
                    gradient.addColorStop(0.3, `rgba(150, 150, 255, ${opacity * 0.7})`);
                    gradient.addColorStop(0.5, `rgba(255, 150, 150, ${opacity * 0.6})`);
                    gradient.addColorStop(0.7, `rgba(255, 150, 50, ${opacity * 0.4})`);
                    gradient.addColorStop(1, 'transparent');
                } else {
                    // Purple-red-orange flame
                    gradient.addColorStop(0, `rgba(220, 100, 150, ${opacity * 0.7})`);
                    gradient.addColorStop(0.3, `rgba(255, 100, 100, ${opacity * 0.6})`);
                    gradient.addColorStop(0.6, `rgba(255, 100, 0, ${opacity * 0.5})`);
                    gradient.addColorStop(0.8, `rgba(200, 50, 0, ${opacity * 0.3})`);
                    gradient.addColorStop(1, 'transparent');
                }
                
                ctx.fillStyle = gradient;
                
                // Draw flame segment as horizontal curved teardrop shape
                ctx.beginPath();
                ctx.moveTo(flameX, flameY - flameWidth/2);
                ctx.quadraticCurveTo(
                    flameX - flameHeight * 0.3, flameY - flameWidth * 0.7,
                    flameX - flameHeight, flameY
                );
                ctx.quadraticCurveTo(
                    flameX - flameHeight * 0.3, flameY + flameWidth * 0.7,
                    flameX, flameY + flameWidth/2
                );
                ctx.closePath();
                ctx.fill();
                
                // Add glow effect for first segments
                if (i < 2) {
                    ctx.shadowColor = 'rgba(100, 150, 255, 0.5)';
                    ctx.shadowBlur = 10 * speedFactor;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
            
            ctx.restore();
        });
    }
    
    renderWrongWayAlert() {
        if (!this.wrongWayAlert.active) return;
        
        const ctx = this.ctx;
        ctx.save();
        
        // Update pulse phase for animation
        this.wrongWayAlert.pulsePhase += 0.08;
        
        // Center of screen
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        
        // Subtle pulse effect (no growing)
        const pulseAlpha = 0.8 + Math.sin(this.wrongWayAlert.pulsePhase) * 0.1;
        
        // Purple semi-transparent background overlay
        const overlayAlpha = 0.2 + Math.abs(Math.sin(this.wrongWayAlert.pulsePhase * 1.5)) * 0.1;
        ctx.fillStyle = `rgba(147, 51, 234, ${overlayAlpha})`;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Alert box (similar to lap notification style) with subtle pulsing
        const pulseScale = 1 + Math.sin(this.wrongWayAlert.pulsePhase) * 0.05; // 5% scale variation
        const boxWidth = 280 * this.scale * pulseScale;
        const boxHeight = 60 * this.scale * pulseScale;
        const boxX = centerX - boxWidth / 2;
        const boxY = centerY - boxHeight / 2;
        const borderRadius = 20 * this.scale;
        
        // Purple gradient background (like lap notification)
        const gradient = ctx.createLinearGradient(boxX, boxY, boxX + boxWidth, boxY + boxHeight);
        gradient.addColorStop(0, `rgba(147, 51, 234, ${pulseAlpha})`);
        gradient.addColorStop(1, `rgba(236, 72, 153, ${pulseAlpha})`);
        
        ctx.fillStyle = gradient;
        ctx.shadowColor = 'rgba(236, 72, 153, 0.8)';
        ctx.shadowBlur = 40 * this.scale;
        this.drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, borderRadius);
        ctx.fill();
        
        // White border with inner glow
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2 * this.scale;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.2)';
        ctx.shadowBlur = 20 * this.scale;
        ctx.shadowInset = true;
        this.drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, borderRadius);
        ctx.stroke();
        
        // Reset shadow
        ctx.shadowBlur = 0;
        
        // Icons and text all in one line with pulsing
        const iconSize = 24 * this.scale * pulseScale;
        const spacing = 15 * this.scale;
        
        // Calculate total width for centering
        ctx.font = `bold ${28 * this.scale * pulseScale}px Arial`;
        const textWidth = ctx.measureText('WRONG WAY').width;
        const totalWidth = iconSize + spacing + textWidth + spacing + iconSize;
        const startX = centerX - totalWidth / 2;
        
        // Warning icon (left)
        ctx.save();
        ctx.translate(startX + iconSize / 2, centerY);
        ctx.scale(pulseScale, pulseScale);
        
        // Simple warning triangle
        ctx.beginPath();
        ctx.moveTo(0, -iconSize / 2 / pulseScale);
        ctx.lineTo(-iconSize / 2 / pulseScale, iconSize / 2 / pulseScale);
        ctx.lineTo(iconSize / 2 / pulseScale, iconSize / 2 / pulseScale);
        ctx.closePath();
        
        ctx.fillStyle = '#ffff00';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5 * this.scale;
        ctx.stroke();
        
        // Exclamation mark
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${16 * this.scale}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', 0, 2 * this.scale);
        ctx.restore();
        
        // "WRONG WAY" text (center) with pulsing
        ctx.font = `bold ${28 * this.scale * pulseScale}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3 * this.scale;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        ctx.shadowBlur = 10 * this.scale;
        
        // Text with black outline
        const textX = startX + iconSize + spacing + textWidth / 2;
        ctx.strokeText('WRONG WAY', textX, centerY);
        ctx.fillText('WRONG WAY', textX, centerY);
        
        // Second warning icon (right) instead of arrow
        ctx.save();
        ctx.translate(startX + iconSize + spacing + textWidth + spacing + iconSize / 2, centerY);
        ctx.scale(pulseScale, pulseScale);
        
        // Another warning triangle
        ctx.beginPath();
        ctx.moveTo(0, -iconSize / 2 / pulseScale);
        ctx.lineTo(-iconSize / 2 / pulseScale, iconSize / 2 / pulseScale);
        ctx.lineTo(iconSize / 2 / pulseScale, iconSize / 2 / pulseScale);
        ctx.closePath();
        
        ctx.fillStyle = '#ffff00';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5 * this.scale;
        ctx.stroke();
        
        // Exclamation mark
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${16 * this.scale}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', 0, 2 * this.scale);
        
        ctx.restore();
        
        ctx.restore();
    }
    
    createLightningEffect(x, y, playerId) {
        // Create lightning strike visual effect attached to a player
        const key = `lightning_${playerId}_${Date.now()}_${Math.random()}`;
        
        this.damageEffects.set(key, {
            type: 'lightning',
            x: x,
            y: y,
            playerId: playerId,
            startTime: Date.now(),
            duration: 800 // 0.8 seconds
        });
        
        // Add particles for lightning effect
        if (this.particleSystem && this.particleSystem.particles) {
            // Lightning bolts
            for (let i = 0; i < 5; i++) {
                const angle = (Math.PI * 2) * (i / 5);
                this.particleSystem.particles.push({
                    x: x,
                    y: y,
                    vx: Math.cos(angle) * 100,
                    vy: Math.sin(angle) * 100,
                    size: 3,
                    color: '#ffff88',
                    type: 'spark',
                    life: 0.5,
                    maxLife: 0.5
                });
            }
            
            // Electric sparks
            for (let i = 0; i < 10; i++) {
                this.particleSystem.particles.push({
                    x: x + (Math.random() - 0.5) * 40,
                    y: y + (Math.random() - 0.5) * 40,
                    vx: (Math.random() - 0.5) * 200,
                    vy: (Math.random() - 0.5) * 200,
                    size: 2,
                    color: '#ffffff',
                    type: 'spark',
                    life: 0.3,
                    maxLife: 0.3
                });
            }
        }
    }
    
    createSideForceEffect(x, y, angle) {
        // Create the main side force wave effect
        const key = `sideforce_${Date.now()}_${Math.random()}`;
        
        this.damageEffects.set(key, {
            type: 'sideforce',
            x: x,
            y: y,
            angle: angle,
            startTime: Date.now(),
            duration: 1200 // 1.2 seconds
        });
        
        // Add stylish magnetic field particles
        if (this.particleSystem && this.particleSystem.particles) {
            // Create multiple waves for depth
            for (let wave = 0; wave < 3; wave++) {
                const waveDelay = wave * 100; // Stagger the waves
                
                setTimeout(() => {
                    for (let side = -1; side <= 1; side += 2) { // -1 for left, 1 for right
                        const sideAngle = angle + (side * Math.PI / 2);
                        
                        // Create energy burst at origin
                        for (let i = 0; i < 8; i++) {
                            const burstAngle = sideAngle + (Math.random() - 0.5) * Math.PI / 4;
                            const speed = 150 + Math.random() * 100;
                            
                            this.particleSystem.particles.push({
                                x: x,
                                y: y,
                                vx: Math.cos(burstAngle) * speed,
                                vy: Math.sin(burstAngle) * speed,
                                size: 6 - wave * 1.5,
                                color: wave === 0 ? '#ffffff' : (wave === 1 ? '#cc66ff' : '#9400d3'),
                                type: 'spark',
                                life: 0.6,
                                maxLife: 0.6
                            });
                        }
                        
                        // Create curved force lines
                        for (let i = 0; i < 15; i++) {
                            const arcProgress = i / 14;
                            const arcAngle = sideAngle + (arcProgress - 0.5) * Math.PI / 2.5;
                            const radius = 30 + arcProgress * 200;
                            const speed = 80 + arcProgress * 40;
                            
                            this.particleSystem.particles.push({
                                x: x + Math.cos(arcAngle) * radius,
                                y: y + Math.sin(arcAngle) * radius,
                                vx: Math.cos(arcAngle) * speed,
                                vy: Math.sin(arcAngle) * speed,
                                size: 5 - wave,
                                color: wave === 0 ? '#cc66ff' : '#9400d3',
                                type: 'magnetic',
                                life: 0.8 - wave * 0.1,
                                maxLife: 0.8 - wave * 0.1
                            });
                        }
                    }
                }, waveDelay);
            }
        }
    }
    
    createPushEffect(playerId, pushDirection, pushAngle) {
        // Create push effect for affected player
        const key = `push_${playerId}_${Date.now()}`;
        
        this.damageEffects.set(key, {
            type: 'push',
            playerId: playerId,
            pushDirection: pushDirection,
            pushAngle: pushAngle,
            startTime: Date.now(),
            duration: 500 // 0.5 seconds
        });
    }
    
    renderSideForceEffect(ctx, effectData, effectKey) {
        const progress = (Date.now() - effectData.startTime) / effectData.duration;
        if (progress > 1) {
            this.damageEffects.delete(effectKey);
            return;
        }
        
        ctx.save();
        ctx.translate(effectData.x, effectData.y);
        ctx.rotate(effectData.angle);
        
        // Create multiple expanding rings for depth
        for (let ring = 0; ring < 3; ring++) {
            const ringProgress = Math.max(0, progress - ring * 0.1);
            if (ringProgress > 1) continue;
            
            const maxRadius = 250 + ring * 30;
            const currentRadius = maxRadius * ringProgress;
            const alpha = (1 - ringProgress) * (1 - ring * 0.2);
            
            // Gradient stroke for the waves
            const gradient = ctx.createRadialGradient(0, 0, currentRadius * 0.8, 0, 0, currentRadius);
            gradient.addColorStop(0, `rgba(204, 102, 255, ${alpha * 0.8})`); // Light purple
            gradient.addColorStop(0.5, `rgba(148, 0, 211, ${alpha * 0.6})`); // Purple
            gradient.addColorStop(1, `rgba(148, 0, 211, 0)`); // Fade out
            
            ctx.strokeStyle = gradient;
            ctx.lineWidth = (8 - ring * 2) * this.scale * (1 - ringProgress * 0.5);
            
            // Left side wave with glow
            ctx.shadowColor = '#cc66ff';
            ctx.shadowBlur = 20 * (1 - ringProgress);
            ctx.beginPath();
            ctx.arc(0, 0, currentRadius, -Math.PI * 0.8, -Math.PI * 0.2, false);
            ctx.stroke();
            
            // Right side wave with glow
            ctx.beginPath();
            ctx.arc(0, 0, currentRadius, Math.PI * 0.2, Math.PI * 0.8, false);
            ctx.stroke();
            
            // Add energy lines
            if (ring === 0 && ringProgress < 0.5) {
                ctx.globalAlpha = alpha * 0.6;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2 * this.scale;
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#cc66ff';
                
                // Draw energy lines radiating outward
                for (let i = 0; i < 8; i++) {
                    const lineAngle = (i / 8) * Math.PI - Math.PI / 2;
                    const lineLength = currentRadius * 0.8;
                    
                    // Only draw lines on the sides
                    if (Math.abs(lineAngle) < Math.PI * 0.3) continue;
                    
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(lineAngle) * currentRadius * 0.3, Math.sin(lineAngle) * currentRadius * 0.3);
                    ctx.lineTo(Math.cos(lineAngle) * lineLength, Math.sin(lineAngle) * lineLength);
                    ctx.stroke();
                }
            }
        }
        
        // Central burst effect
        if (progress < 0.3) {
            const burstAlpha = 1 - (progress / 0.3);
            const burstSize = 80 * (1 + progress);
            
            const burstGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, burstSize);
            burstGradient.addColorStop(0, `rgba(255, 255, 255, ${burstAlpha * 0.8})`);
            burstGradient.addColorStop(0.3, `rgba(204, 102, 255, ${burstAlpha * 0.6})`);
            burstGradient.addColorStop(1, `rgba(148, 0, 211, 0)`);
            
            ctx.fillStyle = burstGradient;
            ctx.fillRect(-burstSize, -burstSize, burstSize * 2, burstSize * 2);
        }
        
        ctx.restore();
    }
    
    renderPushEffect(ctx, player, effectData) {
        if (!player) return;
        
        const progress = (Date.now() - effectData.startTime) / effectData.duration;
        if (progress > 1) {
            this.damageEffects.delete(`push_${player.id}_${effectData.startTime}`);
            return;
        }
        
        ctx.save();
        ctx.translate(player.x, player.y);
        
        // Create a shockwave ring around the player
        const shockwaveRadius = 40 * (1 + progress * 2);
        const shockwaveAlpha = (1 - progress) * 0.6;
        
        const shockGradient = ctx.createRadialGradient(0, 0, shockwaveRadius * 0.7, 0, 0, shockwaveRadius);
        shockGradient.addColorStop(0, `rgba(204, 102, 255, 0)`);
        shockGradient.addColorStop(0.7, `rgba(204, 102, 255, ${shockwaveAlpha})`);
        shockGradient.addColorStop(1, `rgba(148, 0, 211, 0)`);
        
        ctx.strokeStyle = shockGradient;
        ctx.lineWidth = 3 * this.scale;
        ctx.beginPath();
        ctx.arc(0, 0, shockwaveRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Draw stylized motion blur/trail
        const trailLength = 60 + progress * 40;
        const trailAlpha = (1 - progress) * 0.7;
        
        ctx.globalAlpha = trailAlpha;
        
        // Create gradient for trail
        const trailGradient = ctx.createLinearGradient(
            Math.cos(effectData.pushAngle + Math.PI) * 20,
            Math.sin(effectData.pushAngle + Math.PI) * 20,
            Math.cos(effectData.pushAngle + Math.PI) * (20 + trailLength),
            Math.sin(effectData.pushAngle + Math.PI) * (20 + trailLength)
        );
        trailGradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
        trailGradient.addColorStop(0.3, `rgba(204, 102, 255, ${trailAlpha * 0.8})`);
        trailGradient.addColorStop(0.7, `rgba(148, 0, 211, ${trailAlpha * 0.5})`);
        trailGradient.addColorStop(1, `rgba(148, 0, 211, 0)`);
        
        // Draw multiple trail segments for depth
        for (let i = 0; i < 7; i++) {
            const offset = (i - 3) * 8;
            const segmentAlpha = 1 - Math.abs(i - 3) / 3;
            
            ctx.strokeStyle = trailGradient;
            ctx.lineWidth = (5 - Math.abs(i - 3)) * this.scale * segmentAlpha;
            ctx.globalAlpha = trailAlpha * segmentAlpha;
            
            ctx.beginPath();
            ctx.moveTo(
                Math.cos(effectData.pushAngle + Math.PI) * 15 + Math.sin(effectData.pushAngle) * offset,
                Math.sin(effectData.pushAngle + Math.PI) * 15 - Math.cos(effectData.pushAngle) * offset
            );
            ctx.lineTo(
                Math.cos(effectData.pushAngle + Math.PI) * (15 + trailLength) + Math.sin(effectData.pushAngle) * offset,
                Math.sin(effectData.pushAngle + Math.PI) * (15 + trailLength) - Math.cos(effectData.pushAngle) * offset
            );
            ctx.stroke();
        }
        
        // Add spark particles at the player position
        if (progress < 0.3 && this.particleSystem && this.particleSystem.particles) {
            for (let i = 0; i < 3; i++) {
                this.particleSystem.particles.push({
                    x: player.x + (Math.random() - 0.5) * 20,
                    y: player.y + (Math.random() - 0.5) * 20,
                    vx: Math.cos(effectData.pushAngle + Math.PI) * (50 + Math.random() * 50),
                    vy: Math.sin(effectData.pushAngle + Math.PI) * (50 + Math.random() * 50),
                    size: 3,
                    color: '#cc66ff',
                    type: 'spark',
                    life: 0.4,
                    maxLife: 0.4
                });
            }
        }
        
        ctx.restore();
    }
    
    renderRotorShield(ctx, player, size) {
        // Save context for shield rendering
        ctx.save();
        
        // Shield orbits around the kart
        const time = Date.now() * 0.003; // Rotation speed
        const orbitRadius = size * 0.8; // Distance from kart center
        const shieldSize = size * 0.6; // Shield orb size (increased from 0.4)
        
        // Calculate shield position
        const shieldX = Math.cos(time) * orbitRadius;
        const shieldY = Math.sin(time) * orbitRadius;
        
        ctx.translate(shieldX, shieldY);
        
        // Get the shield icon
        const shieldIcon = this.getItemIcon('rotorshield');
        if (shieldIcon) {
            // Draw the shield sprite smaller and with some transparency
            ctx.globalAlpha = 0.9;
            ctx.drawImage(shieldIcon, -shieldSize/2, -shieldSize/2, shieldSize, shieldSize);
            ctx.globalAlpha = 1;
        } else {
            // Fallback: draw a circular shield
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, shieldSize/2);
            gradient.addColorStop(0, 'rgba(100, 200, 255, 0.8)');
            gradient.addColorStop(0.5, 'rgba(50, 150, 255, 0.6)');
            gradient.addColorStop(1, 'rgba(0, 100, 255, 0.3)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(0, 0, shieldSize/2, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(150, 220, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        
        // Add a glowing trail effect
        ctx.globalAlpha = 0.3;
        for (let i = 1; i <= 3; i++) {
            const trailTime = time - i * 0.1;
            const trailX = Math.cos(trailTime) * orbitRadius - shieldX;
            const trailY = Math.sin(trailTime) * orbitRadius - shieldY;
            
            const trailGradient = ctx.createRadialGradient(trailX, trailY, 0, trailX, trailY, shieldSize/2);
            trailGradient.addColorStop(0, 'rgba(100, 200, 255, 0.4)');
            trailGradient.addColorStop(1, 'rgba(100, 200, 255, 0)');
            
            ctx.fillStyle = trailGradient;
            ctx.beginPath();
            ctx.arc(trailX, trailY, shieldSize/2 * (1 - i * 0.2), 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }
    
    createShieldBlockEffect(playerId, blockedType) {
        // Create a shield block visual effect
        const key = `shieldblock_${playerId}_${Date.now()}`;
        
        this.damageEffects.set(key, {
            type: 'shieldblock',
            playerId: playerId,
            blockedType: blockedType,
            startTime: Date.now(),
            duration: 1500  // Increased from 800ms to 1.5s for better readability
        });
        
        // Add particles for shield break effect
        if (this.particleSystem && this.particleSystem.particles) {
            const player = this.gameState.players.find(p => p.id === playerId);
            if (player) {
                // Create shield shatter particles
                for (let i = 0; i < 12; i++) {
                    const angle = (Math.PI * 2) * (i / 12);
                    const speed = 100 + Math.random() * 50;
                    
                    this.particleSystem.particles.push({
                        x: player.x,
                        y: player.y,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        size: 4,
                        color: '#66ccff',
                        type: 'spark',
                        life: 0.6,
                        maxLife: 0.6
                    });
                }
            }
        }
    }
    
    renderShieldBlockEffect(ctx, player, effectData) {
        if (!player) return;
        
        const progress = (Date.now() - effectData.startTime) / effectData.duration;
        if (progress > 1) {
            this.damageEffects.delete(`shieldblock_${player.id}_${effectData.startTime}`);
            return;
        }
        
        ctx.save();
        ctx.translate(player.x, player.y);
        
        // Create a shield burst effect
        const burstRadius = 50 + progress * 30;
        const alpha = 1 - progress;
        
        // Draw expanding ring
        ctx.strokeStyle = `rgba(100, 200, 255, ${alpha * 0.8})`;
        ctx.lineWidth = 4 * this.scale * (1 - progress * 0.5);
        ctx.shadowColor = '#66ccff';
        ctx.shadowBlur = 20 * (1 - progress);
        
        ctx.beginPath();
        ctx.arc(0, 0, burstRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Draw inner ring
        ctx.strokeStyle = `rgba(150, 220, 255, ${alpha * 0.6})`;
        ctx.lineWidth = 2 * this.scale;
        ctx.beginPath();
        ctx.arc(0, 0, burstRadius * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        
        // Add blocked type indicator
        if (progress < 0.5) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${16 * this.scale}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#0088ff';
            ctx.shadowBlur = 10;
            
            const blockedText = effectData.blockedType.toUpperCase() + ' BLOCKED!';
            ctx.fillText(blockedText, 0, -40 * this.scale);
        }
        
        ctx.restore();
    }
    
    renderLightningEffect(ctx, x, y, effectKey) {
        const effectData = this.damageEffects.get(effectKey);
        if (!effectData) return;
        
        const progress = (Date.now() - effectData.startTime) / effectData.duration;
        if (progress > 1) {
            this.damageEffects.delete(effectKey);
            return;
        }
        
        ctx.save();
        ctx.translate(x, y);
        
        // Draw lightning sprite using the item icon
        const lightningIcon = this.getItemIcon('lightning');
        if (lightningIcon) {
            const maxSize = 100;
            const size = maxSize * (1.5 - progress * 0.5); // Starts big, shrinks
            const alpha = 1 - progress * 0.8; // Fades out
            
            ctx.globalAlpha = alpha;
            ctx.drawImage(
                lightningIcon,
                -size / 2,
                -size / 2,
                size,
                size
            );
            
            // Add glow effect
            ctx.shadowColor = '#ffff88';
            ctx.shadowBlur = 20 * (1 - progress);
            ctx.drawImage(
                lightningIcon,
                -size / 2,
                -size / 2,
                size,
                size
            );
            ctx.shadowBlur = 0;
        } else {
            // Fallback: draw lightning bolt shape
            const boltHeight = 80 * (1.5 - progress * 0.5);
            const alpha = 1 - progress * 0.8;
            
            ctx.strokeStyle = `rgba(255, 255, 136, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.shadowColor = '#ffff88';
            ctx.shadowBlur = 10;
            
            ctx.beginPath();
            ctx.moveTo(0, -boltHeight / 2);
            ctx.lineTo(-10, -boltHeight / 4);
            ctx.lineTo(5, 0);
            ctx.lineTo(-5, boltHeight / 4);
            ctx.lineTo(0, boltHeight / 2);
            ctx.stroke();
            
            ctx.shadowBlur = 0;
        }
        
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
    
