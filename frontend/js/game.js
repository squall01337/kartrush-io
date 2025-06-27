// Moteur de jeu avec rendu Canvas
class GameEngine {
    constructor(canvas, socket, playerId) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
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
        
        this.setupCanvas();
        this.loadTrack();
    }

    setupCanvas() {
        // Redimensionner le canvas
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Style du canvas
        this.canvas.style.border = '2px solid #fff';
        this.canvas.style.borderRadius = '10px';
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const maxWidth = window.innerWidth - 40;
        const maxHeight = window.innerHeight - 100;
        
        // Ratio 4:3 pour la piste
        const aspectRatio = 4 / 3;
        
        let width = Math.min(maxWidth, 800);
        let height = width / aspectRatio;
        
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }
        
        this.canvas.width = width;
        this.canvas.height = height;
        
        // Facteur d'échelle pour adapter la piste
        this.scale = width / 800;
    }

    loadTrack() {
        // Configuration de la piste ovale (correspond au JSON)
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
        this.lastFrameTime = performance.now();
        this.gameLoop();
    }

    stop() {
        this.isRunning = false;
    }

    gameLoop() {
        if (!this.isRunning) return;
        
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;
        
        this.update(deltaTime);
        this.render();
        
        requestAnimationFrame(() => this.gameLoop());
    }

    update(deltaTime) {
        // Mettre à jour la caméra pour suivre le joueur
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (player) {
            this.camera.x = player.x - (this.canvas.width / this.scale) / 2;
            this.camera.y = player.y - (this.canvas.height / this.scale) / 2;
            
            // Limiter la caméra aux bords de la piste
            this.camera.x = Math.max(0, Math.min(this.track.width - this.canvas.width / this.scale, this.camera.x));
            this.camera.y = Math.max(0, Math.min(this.track.height - this.canvas.height / this.scale, this.camera.y));
        }
        
        // Mettre à jour l'interface
        this.updateUI();
    }

    render() {
        // Effacer le canvas
        this.ctx.fillStyle = this.track.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Sauvegarder le contexte pour les transformations
        this.ctx.save();
        
        // Appliquer l'échelle et la caméra
        this.ctx.scale(this.scale, this.scale);
        this.ctx.translate(-this.camera.x, -this.camera.y);
        
        // Dessiner la piste
        this.renderTrack();
        
        // Dessiner les joueurs
        this.renderPlayers();
        
        // Restaurer le contexte
        this.ctx.restore();
        
        // Dessiner l'interface (sans transformation)
        this.renderUI();
    }

    renderTrack() {
        // Dessiner l'image de fond de la piste si disponible
        const trackBg = window.assetManager.getImage('track_background');
        if (trackBg) {
            this.ctx.drawImage(trackBg, 0, 0, this.track.width, this.track.height);
        } else {
            // Fallback vers le rendu original
            this.ctx.fillStyle = '#444444';
            this.ctx.fillRect(70, 170, 660, 260);
            
            // Dessiner les murs
            this.ctx.fillStyle = '#ffffff';
            this.track.walls.forEach(wall => {
                this.ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
            });
        }
        
        // Dessiner la ligne de départ
        this.ctx.strokeStyle = this.track.startLine.color;
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([10, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.track.startLine.x1, this.track.startLine.y1);
        this.ctx.lineTo(this.track.startLine.x2, this.track.startLine.y2);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        
        // Dessiner les checkpoints
        this.track.checkpoints.forEach(checkpoint => {
            this.ctx.strokeStyle = checkpoint.color;
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(checkpoint.x1, checkpoint.y1);
            this.ctx.lineTo(checkpoint.x2, checkpoint.y2);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        });
    }

    renderPlayers() {
        this.gameState.players.forEach(player => {
            this.renderPlayer(player);
        });
    }

    renderPlayer(player) {
        this.ctx.save();
        
        // Se déplacer au centre du joueur
        this.ctx.translate(player.x, player.y);
        this.ctx.rotate(player.angle);
        
        // Synchroniser la taille du sprite avec la hitbox de collision (KART_SIZE = 20 sur le serveur)
        const size = 28; // Légèrement plus grand que la hitbox pour un rendu visible mais proportionnel
        
        // Essayer d'utiliser le sprite du kart
        const kartSprite = window.assetManager.getKartSprite(player.color);
        
        if (kartSprite) {
            
            // Créer un canvas temporaire pour traiter la transparence
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = size;
            tempCanvas.height = size;
            
            // Dessiner le sprite sur le canvas temporaire avec la bonne orientation
            tempCtx.save();
            tempCtx.translate(size/2, size/2);
            tempCtx.rotate(Math.PI / 2); // Rotation de 90° pour corriger l'orientation
            tempCtx.drawImage(
                kartSprite.image,
                kartSprite.sx, kartSprite.sy, kartSprite.sw, kartSprite.sh,
                -size/2, -size/2, size, size
            );
            tempCtx.restore();
            
            // Traitement de transparence moins agressif pour préserver les détails
            const imageData = tempCtx.getImageData(0, 0, size, size);
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const a = data[i + 3];
                
                // Détecter uniquement les pixels de fond évidents (plus conservateur)
                const isBackground = (
                    // Pixels déjà transparents
                    a < 50 ||
                    // Blanc pur uniquement
                    (r > 250 && g > 250 && b > 250 && a > 200) ||
                    // Gris très clair avec très peu de saturation
                    (r > 240 && g > 240 && b > 240 && Math.abs(r - g) < 5 && Math.abs(g - b) < 5)
                );
                
                if (isBackground) {
                    data[i + 3] = 0; // Rendre transparent
                }
            }
            
            tempCtx.putImageData(imageData, 0, 0);
            
            // Dessiner le canvas traité sur le canvas principal
            this.ctx.drawImage(tempCanvas, -size/2, -size/2);
        } else {
            // Fallback vers le rendu original
            this.ctx.fillStyle = player.color;
            this.ctx.fillRect(-size/2, -size/2, size, size);
            
            // Bordure
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(-size/2, -size/2, size, size);
            
            // Direction (petit triangle)
            this.ctx.fillStyle = '#ffffff';
            this.ctx.beginPath();
            this.ctx.moveTo(size/2 - 2, 0);
            this.ctx.lineTo(size/2 + 4, -3);
            this.ctx.lineTo(size/2 + 4, 3);
            this.ctx.closePath();
            this.ctx.fill();
        }
        
        this.ctx.restore();
        
        // Nom du joueur
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(player.pseudo, player.x, player.y - 25);
        this.ctx.fillText(player.pseudo, player.x, player.y - 25);
        
        // Position dans la course
        this.ctx.fillStyle = player.color;
        this.ctx.font = 'bold 14px Arial';
        this.ctx.strokeText(`#${player.position}`, player.x, player.y + 35);
        this.ctx.fillText(`#${player.position}`, player.x, player.y + 35);
    }

    renderUI() {
        // Interface déjà gérée par le HTML, on peut ajouter des éléments Canvas ici si nécessaire
    }

    updateUI() {
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;
        
        // Mettre à jour les informations de course
        document.getElementById('position').textContent = `Position: ${player.position}/${this.gameState.players.length}`;
        document.getElementById('lap').textContent = `Tour: ${player.lap + 1}/3`;
        
        // Temps de course
        const minutes = Math.floor(this.gameState.gameTime / 60000);
        const seconds = Math.floor((this.gameState.gameTime % 60000) / 1000);
        document.getElementById('timer').textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Item actuel
        const itemSlot = document.getElementById('itemSlot');
        if (player.item) {
            itemSlot.textContent = this.getItemIcon(player.item);
            itemSlot.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        } else {
            itemSlot.textContent = '';
            itemSlot.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
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
        
        // Vérifier si la course est terminée
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (player && player.finished) {
            setTimeout(() => {
                this.showResults();
            }, 2000);
        }
    }

    showResults() {
        this.stop();
        
        // Trier les joueurs par position finale
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
        
        // Afficher l'écran des résultats
        document.getElementById('game').classList.add('hidden');
        document.getElementById('results').classList.remove('hidden');
    }
}

