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
        
        // DEBUG
        this.lastDebugTime = 0;
        
        // Configuration de détection (doit correspondre au serveur)
        this.CHECKPOINT_MARGIN = 20;
        
        this.setupCanvas();
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
        
        const aspectRatio = 16 / 9;
        
        let width = Math.min(maxWidth, 1280);
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
        
        this.scale = width / 1280;
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

        setMapData(mapData) {
        this.setTrack(mapData);

        // 🎵 Gérer la musique de la map
        if (this.music) {
            this.music.pause();
            this.music = null;
        }

        if (mapData.music) {
            this.music = new Audio(mapData.music);
            this.music.loop = true;
            this.music.volume = 0.5;
            this.music.play().catch(e => {
                console.warn('🔇 Musique bloquée par lautoplay. Lutilisateur doit interagir avec la page.');
            });
        }
        
        // 🖼️ Charger les assets de la map (background, etc.)
        if (window.assetManager) {
            window.assetManager.loadMapAssets(mapData).then(success => {
                if (success) {
                    console.log('✅ Assets de la map chargés');
                }
            });
        }
    }

    cacheProcessedSprite(color, kartSprite) {
        const finalSize = 28;
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = kartSprite.sw;
        tempCanvas.height = kartSprite.sh;

        // Dessiner le sprite d'origine
        tempCtx.drawImage(
            kartSprite.image,
            kartSprite.sx, kartSprite.sy, kartSprite.sw, kartSprite.sh,
            0, 0, kartSprite.sw, kartSprite.sh
        );

        // Nettoyer fond blanc (transparence)
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

        // Trouver les bords utiles (bounding box du kart réel)
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

        // Dessiner le sprite final dans un cache canvas redimensionné
        const cacheCanvas = document.createElement('canvas');
        const cacheCtx = cacheCanvas.getContext('2d');
        cacheCanvas.width = finalSize;
        cacheCanvas.height = finalSize;

        cacheCtx.save();
        cacheCtx.translate(finalSize / 2, finalSize / 2);
        cacheCtx.rotate(Math.PI / 2); // rotation standard

        // Redessiner le kart recentré et agrandi
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
        if (!this.track) return; // 👈 Sécurité pour éviter l'erreur quand la map n'est pas encore reçue
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
        if (!this.track) return;
        const ctx = this.offscreenCtx;
        
        ctx.fillStyle = this.track.background;
        ctx.fillRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
        
        ctx.save();
        ctx.scale(this.scale, this.scale);
        ctx.translate(-this.camera.x, -this.camera.y);
        
        this.renderTrack(ctx);
        this.renderDetectionZones(ctx); // Zones de détection rectangulaires
        this.renderCheckpointsAndFinishLine(ctx); // Rendu visuel des checkpoints
        this.renderPlayers(ctx);
        
        ctx.restore();
        
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        
        this.renderUI();
    }

    renderTrack(ctx) {
        // Chargement dynamique du fond depuis le JSON
        const bgName = this.track.background || 'track_background';
        const trackBg = window.assetManager.getImage(bgName);
        if (trackBg) {
            ctx.drawImage(trackBg, 0, 0, this.track.width, this.track.height);
        } else {
            // Fallback sans image : fond uni seulement
            ctx.fillStyle = '#444444';
            ctx.fillRect(0, 0, this.track.width, this.track.height);
        }
    }

    // Méthode pour afficher les lignes de détection
    renderDetectionZones(ctx) {
        ctx.save();
        
        // Lignes de détection des checkpoints
        if (this.track.checkpoints) {
            this.track.checkpoints.forEach((checkpoint, idx) => {
                // Vérifier si c'est le nouveau format ligne
                if (checkpoint.x1 !== undefined && checkpoint.y1 !== undefined) {
                    // Nouveau format : ligne directe
                    ctx.strokeStyle = '#00FF00';
                    ctx.lineWidth = 5;
                    ctx.globalAlpha = 0.6;
                    ctx.setLineDash([10, 5]);
                    
                    ctx.beginPath();
                    ctx.moveTo(checkpoint.x1, checkpoint.y1);
                    ctx.lineTo(checkpoint.x2, checkpoint.y2);
                    ctx.stroke();
                    
                    // Points aux extrémités
                    ctx.fillStyle = '#00FF00';
                    ctx.globalAlpha = 0.8;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.arc(checkpoint.x1, checkpoint.y1, 5, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(checkpoint.x2, checkpoint.y2, 5, 0, 2 * Math.PI);
                    ctx.fill();
                    
                    // Numéro du checkpoint
                    const cx = (checkpoint.x1 + checkpoint.x2) / 2;
                    const cy = (checkpoint.y1 + checkpoint.y2) / 2;
                    ctx.fillStyle = '#00FF00';
                    ctx.font = 'bold 16px Arial';
                    ctx.textAlign = 'center';
                    ctx.globalAlpha = 1;
                    ctx.fillText(`CP${idx + 1}`, cx, cy - 20);
                    
                    // Flèche directionnelle
                    const angle = Math.atan2(checkpoint.y2 - checkpoint.y1, checkpoint.x2 - checkpoint.x1);
                    const normalAngle = angle + Math.PI / 2;
                    const arrowX = cx + Math.cos(normalAngle) * 30;
                    const arrowY = cy + Math.sin(normalAngle) * 30;
                    
                    ctx.strokeStyle = '#00FF00';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(arrowX, arrowY);
                    ctx.stroke();
                    
                    // Pointe de la flèche
                    ctx.beginPath();
                    ctx.moveTo(arrowX, arrowY);
                    ctx.lineTo(arrowX - 10 * Math.cos(normalAngle - 0.5), arrowY - 10 * Math.sin(normalAngle - 0.5));
                    ctx.lineTo(arrowX - 10 * Math.cos(normalAngle + 0.5), arrowY - 10 * Math.sin(normalAngle + 0.5));
                    ctx.closePath();
                    ctx.fillStyle = '#00FF00';
                    ctx.fill();
                    
                } else {
                    // Ancien format : convertir le rectangle en ligne pour l'affichage
                    const cx = checkpoint.x + checkpoint.width / 2;
                    const cy = checkpoint.y + checkpoint.height / 2;
                    const angle = (checkpoint.angle || 0) * Math.PI / 180 + Math.PI / 2;
                    const halfLength = checkpoint.height / 2 + 30; // Avec marge
                    
                    const x1 = cx - Math.cos(angle) * halfLength;
                    const y1 = cy - Math.sin(angle) * halfLength;
                    const x2 = cx + Math.cos(angle) * halfLength;
                    const y2 = cy + Math.sin(angle) * halfLength;
                    
                    ctx.strokeStyle = '#00FF00';
                    ctx.lineWidth = 5;
                    ctx.globalAlpha = 0.6;
                    ctx.setLineDash([10, 5]);
                    
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                    
                    // Numéro
                    ctx.fillStyle = '#00FF00';
                    ctx.font = 'bold 16px Arial';
                    ctx.textAlign = 'center';
                    ctx.globalAlpha = 1;
                    ctx.setLineDash([]);
                    ctx.fillText(`CP${idx + 1}`, cx, cy - checkpoint.height / 2 - 20);
                }
            });
        }
        
        // Ligne de détection de la ligne d'arrivée
        if (this.track.finishLine) {
            const fl = this.track.finishLine;
            
            if (fl.x1 !== undefined && fl.y1 !== undefined) {
                // Nouveau format : ligne directe
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 5;
                ctx.globalAlpha = 0.6;
                ctx.setLineDash([10, 5]);
                
                ctx.beginPath();
                ctx.moveTo(fl.x1, fl.y1);
                ctx.lineTo(fl.x2, fl.y2);
                ctx.stroke();
                
                // Points aux extrémités
                ctx.fillStyle = '#FFD700';
                ctx.globalAlpha = 0.8;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(fl.x1, fl.y1, 5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(fl.x2, fl.y2, 5, 0, 2 * Math.PI);
                ctx.fill();
                
                // Label
                const cx = (fl.x1 + fl.x2) / 2;
                const cy = (fl.y1 + fl.y2) / 2;
                ctx.fillStyle = '#FFD700';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.globalAlpha = 1;
                ctx.fillText('FINISH', cx, cy - 20);
                
            } else {
                // Ancien format : convertir
                const cx = fl.x + fl.width / 2;
                const cy = fl.y + fl.height / 2;
                const angle = (fl.angle || 0) * Math.PI / 180 + Math.PI / 2;
                const halfLength = fl.height / 2 + 30;
                
                const x1 = cx - Math.cos(angle) * halfLength;
                const y1 = cy - Math.sin(angle) * halfLength;
                const x2 = cx + Math.cos(angle) * halfLength;
                const y2 = cy + Math.sin(angle) * halfLength;
                
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 5;
                ctx.globalAlpha = 0.6;
                ctx.setLineDash([10, 5]);
                
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        }
        
        ctx.restore();
    }

    // Rendu visuel des checkpoints et de la ligne d'arrivée
    renderCheckpointsAndFinishLine(ctx) {
        // Récupérer le joueur actuel
        const currentPlayer = this.gameState.players.find(p => p.id === this.playerId);
        
        // Dessiner les checkpoints
        if (this.track.checkpoints) {
            ctx.save();
            
            this.track.checkpoints.forEach((checkpoint, index) => {
                // Vérifier le format
                if (checkpoint.x1 !== undefined && checkpoint.y1 !== undefined) {
                    // NOUVEAU FORMAT : Ligne
                    const cx = (checkpoint.x1 + checkpoint.x2) / 2;
                    const cy = (checkpoint.y1 + checkpoint.y2) / 2;
                    
                    // Déterminer la couleur selon l'état
                    let strokeColor = '#FF0000'; // Rouge par défaut (non passé)
                    let alpha = 0.4;
                    let lineWidth = 8;
                    
                    if (currentPlayer) {
                        if (!currentPlayer.hasPassedStartLine) {
                            // Pas encore commencé la course
                            strokeColor = '#808080'; // Gris
                        } else if (index < currentPlayer.nextCheckpoint) {
                            // Checkpoint déjà passé
                            strokeColor = '#00FF00'; // Vert
                            alpha = 0.3;
                            lineWidth = 6;
                        } else if (index === currentPlayer.nextCheckpoint) {
                            // Prochain checkpoint attendu
                            strokeColor = '#FFFF00'; // Jaune
                            alpha = 0.8;
                            lineWidth = 10;
                            
                            // Animation pulse
                            const pulse = Math.sin(Date.now() * 0.005) * 0.2 + 0.8;
                            alpha = pulse;
                        }
                    }
                    
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = lineWidth;
                    ctx.lineCap = 'round';
                    
                    // Dessiner la ligne du checkpoint
                    ctx.beginPath();
                    ctx.moveTo(checkpoint.x1, checkpoint.y1);
                    ctx.lineTo(checkpoint.x2, checkpoint.y2);
                    ctx.stroke();
                    
                    // Numéro du checkpoint
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = '#FFFFFF';
                    ctx.font = 'bold 20px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    // Fond noir pour le texte
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    ctx.fillRect(cx - 15, cy - 15, 30, 30);
                    
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillText(`${index + 1}`, cx, cy);
                    
                } else {
                    // ANCIEN FORMAT : Rectangle
                    ctx.save();
                    
                    const cx = checkpoint.x + checkpoint.width / 2;
                    const cy = checkpoint.y + checkpoint.height / 2;
                    
                    ctx.translate(cx, cy);
                    ctx.rotate((checkpoint.angle || 0) * Math.PI / 180);
                    
                    // Déterminer la couleur selon l'état
                    let fillColor = '#FF0000'; // Rouge par défaut (non passé)
                    let alpha = 0.3;
                    
                    if (currentPlayer) {
                        if (!currentPlayer.hasPassedStartLine) {
                            fillColor = '#808080'; // Gris
                        } else if (index < currentPlayer.nextCheckpoint) {
                            fillColor = '#00FF00'; // Vert
                            alpha = 0.2;
                        } else if (index === currentPlayer.nextCheckpoint) {
                            fillColor = '#FFFF00'; // Jaune
                            alpha = 0.5;
                            
                            const pulse = Math.sin(Date.now() * 0.005) * 0.2 + 0.5;
                            alpha = pulse;
                        }
                    }
                    
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = fillColor;
                    ctx.fillRect(-checkpoint.width/2, -checkpoint.height/2, checkpoint.width, checkpoint.height);
                    
                    ctx.globalAlpha = 0.8;
                    ctx.strokeStyle = fillColor;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(-checkpoint.width/2, -checkpoint.height/2, checkpoint.width, checkpoint.height);
                    
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = '#FFFFFF';
                    ctx.font = 'bold 20px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(`${index + 1}`, 0, 0);
                    
                    ctx.restore();
                }
            });
            
            ctx.restore();
        }
        
        // Dessiner la ligne d'arrivée
        if (this.track.finishLine) {
            ctx.save();
            
            const fl = this.track.finishLine;
            
            if (fl.x1 !== undefined && fl.y1 !== undefined) {
                // NOUVEAU FORMAT : Ligne
                const cx = (fl.x1 + fl.x2) / 2;
                const cy = (fl.y1 + fl.y2) / 2;
                
                // Déterminer l'opacité selon l'état
                let alpha = 0.5;
                if (currentPlayer && !currentPlayer.hasPassedStartLine) {
                    alpha = 0.8; // Plus visible au début
                } else if (currentPlayer && currentPlayer.nextCheckpoint === this.track.checkpoints.length) {
                    alpha = 0.8;
                    const pulse = Math.sin(Date.now() * 0.003) * 0.2 + 0.8;
                    alpha = pulse;
                }
                
                ctx.globalAlpha = alpha;
                
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
                const segments = Math.floor(lineLength / 20); // Un carré tous les 20 pixels
                
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
                
                // Texte FINISH
                ctx.globalAlpha = 1;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(cx - 40, cy - 15, 80, 30);
                
                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 18px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('FINISH', cx, cy);
                
            } else {
                // ANCIEN FORMAT : Rectangle
                const cx = fl.x + fl.width / 2;
                const cy = fl.y + fl.height / 2;
                
                ctx.translate(cx, cy);
                ctx.rotate((fl.angle || 0) * Math.PI / 180);
                
                let alpha = 0.5;
                if (currentPlayer && !currentPlayer.hasPassedStartLine) {
                    alpha = 0.8;
                } else if (currentPlayer && currentPlayer.nextCheckpoint === this.track.checkpoints.length) {
                    alpha = 0.8;
                    const pulse = Math.sin(Date.now() * 0.003) * 0.2 + 0.8;
                    alpha = pulse;
                }
                
                ctx.globalAlpha = alpha;
                
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
        
        // Afficher l'état du joueur
        if (currentPlayer) {
            ctx.save();
            ctx.resetTransform();
            
            const infoX = this.canvas.width - 200 * this.scale;
            const infoY = 20 * this.scale;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(infoX - 10, infoY - 5, 190 * this.scale, 80 * this.scale);
            
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `${14 * this.scale}px Arial`;
            
            if (!currentPlayer.hasPassedStartLine) {
                ctx.fillText('⏸️ Passez la ligne de départ', infoX, infoY + 15 * this.scale);
            } else {
                ctx.fillText(`✅ Checkpoint: ${currentPlayer.nextCheckpoint}/${this.track.checkpoints.length}`, infoX, infoY + 15 * this.scale);
                ctx.fillText(`🏁 Tour: ${currentPlayer.lap}/${currentPlayer.lapsToWin}`, infoX, infoY + 35 * this.scale);
                
                // Barre de progression
                const barWidth = 170 * this.scale;
                const barHeight = 10 * this.scale;
                const barY = infoY + 50 * this.scale;
                
                ctx.fillStyle = '#333333';
                ctx.fillRect(infoX, barY, barWidth, barHeight);
                
                const progress = currentPlayer.nextCheckpoint / this.track.checkpoints.length;
                ctx.fillStyle = '#00FF00';
                ctx.fillRect(infoX, barY, barWidth * progress, barHeight);
                
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 1;
                ctx.strokeRect(infoX, barY, barWidth, barHeight);
            }
            
            ctx.restore();
        }
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
        
        // Position
        const positionEl = document.getElementById('position');
        const newPosition = `Position: ${player.position}/${this.gameState.players.length}`;
        if (positionEl.textContent !== newPosition) {
            positionEl.textContent = newPosition;
        }
        
        // Tours - CORRECTION ICI
        const lapEl = document.getElementById('lap');
        const totalLaps = this.gameState.totalLaps || 3;
        
        // Si le joueur n'a pas encore franchi la ligne pour la première fois, afficher 0/3
        // Sinon afficher le tour actuel
        const displayLap = player.lap === 0 ? 0 : player.lap;
        const newLap = `Tour: ${displayLap}/${totalLaps}`;
        
        if (lapEl.textContent !== newLap) {
            lapEl.textContent = newLap;
            
            // Animation flash quand on passe un tour
            if (player.lap > 0 && player.lap > (this.lastLap || 0)) {
                lapEl.style.animation = 'flash 0.5s';
                setTimeout(() => {
                    lapEl.style.animation = '';
                }, 500);
                
                // Mise à jour spéciale pour le dernier tour
                if (player.lap === totalLaps - 1) {
                    this.showFinalLapMessage();
                    this.finalLapShown = true;
                }
            }
            this.lastLap = player.lap;
        }
        
        // Timer avec temps restant
        const timerEl = document.getElementById('timer');
        if (this.gameState.maxTime && this.gameState.remainingTime !== null) {
            const totalSeconds = Math.floor(this.gameState.gameTime / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            
            const remainingSeconds = Math.floor(this.gameState.remainingTime / 1000);
            const remainingMinutes = Math.floor(remainingSeconds / 60);
            const remainingSecondsOnly = remainingSeconds % 60;
            
            // Afficher en rouge si moins de 60 secondes
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
            // Pas de limite de temps
            const minutes = Math.floor(this.gameState.gameTime / 60000);
            const seconds = Math.floor((this.gameState.gameTime % 60000) / 1000);
            const newTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            if (timerEl.textContent !== newTime) {
                timerEl.textContent = newTime;
            }
        }
        
        // Item slot
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
        
        // DEBUG: Afficher l'état du joueur actuel
        const myPlayer = gameData.players.find(p => p.id === this.playerId);
        if (myPlayer) {
            // Log toutes les 60 frames (1 seconde)
            if (!this.lastDebugTime || Date.now() - this.lastDebugTime > 1000) {
                console.log('🎮 État client:', {
                    position: `(${Math.round(myPlayer.x)}, ${Math.round(myPlayer.y)})`,
                    hasPassedStartLine: myPlayer.hasPassedStartLine,
                    nextCheckpoint: myPlayer.nextCheckpoint,
                    lap: myPlayer.lap
                });
                this.lastDebugTime = Date.now();
            }
        }
        
        // Nettoyer l'interpolation pour les joueurs qui ont quitté
        const currentIds = new Set(gameData.players.map(p => p.id));
        for (const [id] of this.playerInterpolation) {
            if (!currentIds.has(id)) {
                this.playerInterpolation.delete(id);
            }
        }
        
        }

}