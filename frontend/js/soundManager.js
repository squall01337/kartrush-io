// soundManager.js - Gestionnaire de sons et de volume global pour KartRush.io

class SoundManager {
    constructor() {
        // Volume global
        this.globalVolume = 0.3;
        this.isMuted = false;
        this.previousVolume = 0.3;
        
        // Volumes relatifs pour chaque type de son
        this.volumeMultipliers = {
            engineLoop: 0.05,
            countdown: 1.0,
            backgroundMusic: 0.3,
            gameMusic: 0.5,
            checkpoint: 0.7,
            lap: 0.8,
            error: 0.5,
            victory: 0.5,
            boost: 0.7,
            wallScrape: 0.4,      // 40% du volume global
            wallHit: 0.8,         // 80% du volume global  
            playerCollision: 0.7, // 70% du volume global
            explosion: 0.9,       // 90% du volume global
            respawn: 0.6,        // 60% du volume global
            itemPickup: 0.5,
            bombDrop: 0.6,
            bombExplode: 0.9,
            rocketLaunch: 0.7,
            rocketExplode: 0.8,
            superboost: 0.8

        };
        
        // Sons préchargés
        this.sounds = {};
        this.initializeSounds();
        
        // Liste de tous les éléments audio actifs
        this.activeAudios = new Map();
        
        // Charger les préférences sauvegardées
        this.loadPreferences();
        
        // Initialiser l'interface après le chargement du DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeUI());
        } else {
            this.initializeUI();
        }
    }
    
    initializeSounds() {
        // Moteur
        this.sounds.engineLoop = new Audio('assets/audio/engine_loop.mp3');
        this.sounds.engineLoop.loop = true;
        
        // Décompte 3-2-1-GO
        this.sounds.countdown = new Audio('assets/audio/countdown.mp3');
        
        // Son de boost
        this.sounds.boost = new Audio('assets/audio/boost.mp3');

        this.sounds.wallScrape = new Audio('assets/audio/wall_scrape.mp3');
        this.sounds.wallHit = new Audio('assets/audio/wall_hit.mp3');
        this.sounds.playerCollision = new Audio('assets/audio/player_collision.mp3');
        this.sounds.explosion = new Audio('assets/audio/explosion.mp3');
        this.sounds.respawn = new Audio('assets/audio/respawn.mp3');
        this.sounds.itemPickup = new Audio('assets/audio/item_pickup.mp3');
        this.sounds.bombDrop = new Audio('assets/audio/bomb_drop.mp3');
        this.sounds.bombExplode = new Audio('assets/audio/bomb_explode.mp3');
        this.sounds.rocketLaunch = new Audio('assets/audio/rocket_launch.mp3');
        this.sounds.rocketExplode = new Audio('assets/audio/rocket_explode.mp3');
        this.sounds.superboost = new Audio('assets/audio/superboost.mp3');

    }
    
    initializeUI() {
        this.volumeSlider = document.getElementById('volumeSlider');
        this.muteButton = document.getElementById('muteButton');
        this.volumeControl = document.getElementById('volumeControl');
        this.volumeIcon = document.getElementById('volumeIcon');
        
        if (!this.volumeSlider || !this.muteButton) {
            return;
        }
        
        // Appliquer les valeurs initiales
        this.volumeSlider.value = this.globalVolume * 100;
        this.updateVolumeSliderStyle();
        
        if (this.isMuted) {
            this.applyMuteState();
        }
        
        // Événements
        this.volumeSlider.addEventListener('input', (e) => {
            this.setVolume(e.target.value / 100);
        });
        
        // Empêcher la perte de focus lors du changement de volume
        this.volumeSlider.addEventListener('mousedown', (e) => {
            e.preventDefault();
            
            // Sauvegarder l'élément actuellement focus
            const currentFocus = document.activeElement;
            
            // Gérer le drag du slider
            const onMouseMove = (moveEvent) => {
                const rect = this.volumeSlider.getBoundingClientRect();
                const x = moveEvent.clientX - rect.left;
                const width = rect.width;
                const value = Math.max(0, Math.min(100, (x / width) * 100));
                
                this.volumeSlider.value = value;
                this.setVolume(value / 100);
            };
            
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                
                // Restaurer le focus sur l'élément précédent (probablement le canvas)
                if (currentFocus && currentFocus.id === 'gameCanvas') {
                    currentFocus.focus();
                }
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            
            // Déclencher immédiatement pour le clic initial
            onMouseMove(e);
        });
        
        // Empêcher le focus sur le slider lors du clic
        this.volumeSlider.addEventListener('focus', (e) => {
            // Si on est en jeu, rendre immédiatement le focus au canvas
            const gameCanvas = document.getElementById('gameCanvas');
            const gameScreen = document.getElementById('game');
            
            if (gameCanvas && gameScreen && !gameScreen.classList.contains('hidden')) {
                e.preventDefault();
                gameCanvas.focus();
            }
        });
        
        // Même chose pour le bouton mute
        this.muteButton.addEventListener('click', (e) => {
            this.toggleMute();
            
            // Rendre le focus au canvas si on est en jeu
            const gameCanvas = document.getElementById('gameCanvas');
            const gameScreen = document.getElementById('game');
            
            if (gameCanvas && gameScreen && !gameScreen.classList.contains('hidden')) {
                e.preventDefault();
                gameCanvas.focus();
            }
        });
        
        // Raccourcis clavier
        document.addEventListener('keydown', (e) => {
            // M pour mute/unmute
            if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.altKey) {
                // Ne pas muter si on est dans un input
                if (document.activeElement.tagName !== 'INPUT' && 
                    document.activeElement.tagName !== 'TEXTAREA') {
                    this.toggleMute();
                }
            }
        });
    }
    
    // === MÉTHODES DE LECTURE DES SONS ===

        playWallScrape() {
        const scrape = this.sounds.wallScrape;
        if (scrape) {
            // Permettre plusieurs instances simultanées en clonant
            const scrapeClone = scrape.cloneNode();
            scrapeClone.volume = this.getEffectiveVolume() * this.volumeMultipliers.wallScrape;
            scrapeClone.play().catch(e => {
                console.log('Erreur lecture wall_scrape:', e);
                this.playWallScrapeSynth();
            });
        } else {
            this.playWallScrapeSynth();
        }
    }
    
    playWallHit() {
        const hit = this.sounds.wallHit;
        if (hit) {
            hit.volume = this.getEffectiveVolume() * this.volumeMultipliers.wallHit;
            hit.currentTime = 0;
            hit.play().catch(e => {
                console.log('Erreur lecture wall_hit:', e);
                this.playWallHitSynth();
            });
        } else {
            this.playWallHitSynth();
        }
    }
    
    playPlayerCollision() {
        const collision = this.sounds.playerCollision;
        if (collision) {
            collision.volume = this.getEffectiveVolume() * this.volumeMultipliers.playerCollision;
            collision.currentTime = 0;
            collision.play().catch(e => {
                console.log('Erreur lecture player_collision:', e);
                this.playCollisionSynth();
            });
        } else {
            this.playCollisionSynth();
        }
    }
    
    playExplosion() {
        const explosion = this.sounds.explosion;
        if (explosion) {
            explosion.volume = this.getEffectiveVolume() * this.volumeMultipliers.explosion;
            explosion.currentTime = 0;
            explosion.play().catch(e => {
                console.log('Erreur lecture explosion:', e);
                this.playExplosionSynth();
            });
        } else {
            this.playExplosionSynth();
        }
    }
    
    playRespawn() {
        const respawn = this.sounds.respawn;
        if (respawn) {
            respawn.volume = this.getEffectiveVolume() * this.volumeMultipliers.respawn;
            respawn.currentTime = 0;
            respawn.play().catch(e => {
                console.log('Erreur lecture respawn:', e);
                this.playRespawnSynth();
            });
        } else {
            this.playRespawnSynth();
        }
    }

       playItemPickup() {
        const pickup = this.sounds.itemPickup;
        if (pickup) {
            pickup.volume = this.getEffectiveVolume() * this.volumeMultipliers.itemPickup;
            pickup.currentTime = 0;
            pickup.play().catch(e => {
                console.log('Erreur lecture item_pickup:', e);
                this.playItemPickupSynth();
            });
        } else {
            this.playItemPickupSynth();
        }
    }
    
    playBombDrop() {
        const drop = this.sounds.bombDrop;
        if (drop) {
            drop.volume = this.getEffectiveVolume() * this.volumeMultipliers.bombDrop;
            drop.currentTime = 0;
            drop.play().catch(e => {
                console.log('Erreur lecture bomb_drop:', e);
                this.playBombDropSynth();
            });
        } else {
            this.playBombDropSynth();
        }
    }
    
    playBombExplode() {
        const explode = this.sounds.bombExplode;
        if (explode) {
            explode.volume = this.getEffectiveVolume() * this.volumeMultipliers.bombExplode;
            explode.currentTime = 0;
            explode.play().catch(e => {
                console.log('Erreur lecture bomb_explode:', e);
                this.playExplosionSynth();
            });
        } else {
            this.playExplosionSynth();
        }
    }
    
    playRocketLaunch() {
        const launch = this.sounds.rocketLaunch;
        if (launch) {
            launch.volume = this.getEffectiveVolume() * this.volumeMultipliers.rocketLaunch;
            launch.currentTime = 0;
            launch.play().catch(e => {
                console.log('Erreur lecture rocket_launch:', e);
                this.playRocketLaunchSynth();
            });
        } else {
            this.playRocketLaunchSynth();
        }
    }
    
    playRocketExplode() {
        const explode = this.sounds.rocketExplode;
        if (explode) {
            explode.volume = this.getEffectiveVolume() * this.volumeMultipliers.rocketExplode;
            explode.currentTime = 0;
            explode.play().catch(e => {
                console.log('Erreur lecture rocket_explode:', e);
                this.playExplosionSynth();
            });
        } else {
            this.playExplosionSynth();
        }
    }
    
    playSuperBoost() {
        const boost = this.sounds.superboost;
        if (boost) {
            boost.volume = this.getEffectiveVolume() * this.volumeMultipliers.superboost;
            boost.currentTime = 0;
            boost.play().catch(e => {
                console.log('Erreur lecture superboost:', e);
                this.playSuperBoostSynth();
            });
        } else {
            this.playSuperBoostSynth();
        }
    }
    
    // Sons synthétisés de fallback pour les objets
    
    playItemPickupSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Son de collecte agréable
            for (let i = 0; i < 3; i++) {
                const oscillator = audioContext.createOscillator();
                oscillator.frequency.setValueAtTime(400 + i * 200, audioContext.currentTime + i * 0.1);
                
                const gain = audioContext.createGain();
                gain.gain.setValueAtTime(this.getEffectiveVolume() * 0.3, audioContext.currentTime + i * 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + i * 0.1 + 0.2);
                
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                
                oscillator.start(audioContext.currentTime + i * 0.1);
                oscillator.stop(audioContext.currentTime + i * 0.1 + 0.2);
            }
        } catch (e) {
            console.log('Erreur synthèse item_pickup:', e);
        }
    }
    
    playBombDropSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Son grave de chute
            const oscillator = audioContext.createOscillator();
            oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.3);
            
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(this.getEffectiveVolume() * 0.5, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (e) {
            console.log('Erreur synthèse bomb_drop:', e);
        }
    }
    
    playRocketLaunchSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Sifflement ascendant
            const oscillator = audioContext.createOscillator();
            oscillator.frequency.setValueAtTime(100, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(2000, audioContext.currentTime + 0.5);
            
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(this.getEffectiveVolume() * 0.6, audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(this.getEffectiveVolume() * 0.3, audioContext.currentTime + 0.5);
            
            // Filtre pour le sifflement
            const filter = audioContext.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 1000;
            
            oscillator.connect(filter);
            filter.connect(gain);
            gain.connect(audioContext.destination);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5);
            
            // Bruit de propulsion
            this.playNoiseBurst(audioContext, 0.5, 3000, 0.4);
        } catch (e) {
            console.log('Erreur synthèse rocket_launch:', e);
        }
    }
    
    playSuperBoostSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Son électrique puissant
            for (let i = 0; i < 5; i++) {
                const oscillator = audioContext.createOscillator();
                oscillator.type = 'sawtooth';
                oscillator.frequency.setValueAtTime(100 + i * 100, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(1000 + i * 200, audioContext.currentTime + 0.5);
                
                const gain = audioContext.createGain();
                gain.gain.setValueAtTime(0, audioContext.currentTime);
                gain.gain.linearRampToValueAtTime(this.getEffectiveVolume() * 0.2, audioContext.currentTime + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
                
                const filter = audioContext.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 500 + i * 200;
                filter.Q.value = 5;
                
                oscillator.connect(filter);
                filter.connect(gain);
                gain.connect(audioContext.destination);
                
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 1);
            }
        } catch (e) {
            console.log('Erreur synthèse superboost:', e);
        }
    }
    
    // Sons synthétisés comme fallback
    
    playWallScrapeSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const duration = 0.3;
            
            // Bruit blanc pour le frottement
            const bufferSize = audioContext.sampleRate * duration;
            const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * 0.1;
            }
            
            const noise = audioContext.createBufferSource();
            noise.buffer = buffer;
            
            const filter = audioContext.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1000;
            filter.Q.value = 10;
            
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(this.getEffectiveVolume() * 0.3, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(audioContext.destination);
            
            noise.start();
            noise.stop(audioContext.currentTime + duration);
        } catch (e) {
            console.log('Erreur synthèse wall_scrape:', e);
        }
    }
    
    playWallHitSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Impact basse fréquence
            const oscillator = audioContext.createOscillator();
            oscillator.frequency.setValueAtTime(100, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.2);
            
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(this.getEffectiveVolume() * 0.8, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.3);
            
            // Bruit d'impact
            this.playNoiseBurst(audioContext, 0.1, 2000);
        } catch (e) {
            console.log('Erreur synthèse wall_hit:', e);
        }
    }
    
    playCollisionSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Double impact
            for (let i = 0; i < 2; i++) {
                const delay = i * 0.05;
                const oscillator = audioContext.createOscillator();
                oscillator.frequency.setValueAtTime(150 - i * 30, audioContext.currentTime + delay);
                
                const gain = audioContext.createGain();
                gain.gain.setValueAtTime(this.getEffectiveVolume() * 0.6, audioContext.currentTime + delay);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + delay + 0.2);
                
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                
                oscillator.start(audioContext.currentTime + delay);
                oscillator.stop(audioContext.currentTime + delay + 0.2);
            }
        } catch (e) {
            console.log('Erreur synthèse collision:', e);
        }
    }
    
    playExplosionSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Explosion basse fréquence
            const oscillator = audioContext.createOscillator();
            oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(20, audioContext.currentTime + 0.5);
            
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(this.getEffectiveVolume() * 0.9, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
            
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 1);
            
            // Bruit blanc pour l'explosion
            this.playNoiseBurst(audioContext, 0.8, 500, 0.9);
        } catch (e) {
            console.log('Erreur synthèse explosion:', e);
        }
    }
    
    playRespawnSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Son de téléportation ascendant
            const oscillator = audioContext.createOscillator();
            oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(1600, audioContext.currentTime + 0.5);
            
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(0, audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(this.getEffectiveVolume() * 0.5, audioContext.currentTime + 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) {
            console.log('Erreur synthèse respawn:', e);
        }
    }
    
    // Méthode utilitaire pour générer du bruit
    playNoiseBurst(audioContext, duration, frequency, volume = 0.5) {
        const bufferSize = audioContext.sampleRate * duration;
        const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = audioContext.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = frequency;
        
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(this.getEffectiveVolume() * volume, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioContext.destination);
        
        noise.start();
        noise.stop(audioContext.currentTime + duration);
    }
    
    playEngine() {
        const engine = this.sounds.engineLoop;
        if (engine && engine.paused) {
            engine.volume = this.getEffectiveVolume() * this.volumeMultipliers.engineLoop;
            engine.currentTime = 0;
            engine.play().catch(e => {});
            this.activeAudios.set('engineLoop', engine);
        }
    }
    
    stopEngine() {
        const engine = this.sounds.engineLoop;
        if (engine && !engine.paused) {
            engine.pause();
            engine.currentTime = 0;
            this.activeAudios.delete('engineLoop');
        }
    }
    
    playCountdown() {
        const countdown = this.sounds.countdown;
        if (countdown) {
            countdown.volume = this.getEffectiveVolume() * this.volumeMultipliers.countdown;
            countdown.currentTime = 0;
            countdown.play().catch(e => {});
        }
    }
    
    playBoost() {
        const boost = this.sounds.boost;
        if (boost) {
            boost.volume = this.getEffectiveVolume() * this.volumeMultipliers.boost;
            boost.currentTime = 0;
            boost.play().catch(e => {
                // Fallback avec synthèse sonore
                this.playBoostSynth();
            });
        } else {
            // Fallback si pas de fichier audio
            this.playBoostSynth();
        }
    }
    
    playBoostSynth() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            // Effet de montée en fréquence
            oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.2);
            oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.5);
            
            // Volume qui diminue
            gainNode.gain.setValueAtTime(this.getEffectiveVolume() * 0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) {}
    }
    
    // Méthode générique pour jouer un son temporaire
    playSound(soundPath, volumeMultiplier = 1.0) {
        const audio = new Audio(soundPath);
        audio.volume = this.getEffectiveVolume() * volumeMultiplier;
        audio.play().catch(e => {});
        return audio;
    }
    
    // Méthodes spécifiques pour les effets sonores
    playCheckpoint() {
        return this.playSound('assets/audio/checkpoint.mp3', this.volumeMultipliers.checkpoint);
    }
    
    playLap() {
        return this.playSound('assets/audio/lap.mp3', this.volumeMultipliers.lap);
    }
    
    playError() {
        return this.playSound('assets/audio/error.mp3', this.volumeMultipliers.error);
    }
    
    playVictory() {
        return this.playSound('assets/audio/victory.wav', this.volumeMultipliers.victory);
    }
    
    // Méthode de fallback avec Web Audio API
    playTone(frequency, duration = 0.1, volumeMultiplier = 0.3) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = frequency;
            gainNode.gain.value = this.getEffectiveVolume() * volumeMultiplier;
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + duration);
        } catch (e) {}
    }
    
    // === GESTION DU VOLUME ===
    
    registerAudio(name, audioElement) {
        if (audioElement) {
            this.activeAudios.set(name, audioElement);
            // Appliquer le volume actuel avec le multiplicateur approprié
            const multiplier = this.volumeMultipliers[name] || 1.0;
            audioElement.volume = this.getEffectiveVolume() * multiplier;
            
            // Forcer une mise à jour immédiate
            setTimeout(() => {
                if (this.activeAudios.has(name)) {
                    audioElement.volume = this.getEffectiveVolume() * multiplier;
                }
            }, 10);
        }
    }
    
    unregisterAudio(name) {
        this.activeAudios.delete(name);
    }
    
    refreshAudioVolume(name) {
        const audio = this.activeAudios.get(name);
        if (audio && audio.volume !== undefined) {
            const multiplier = this.volumeMultipliers[name] || 1.0;
            audio.volume = this.getEffectiveVolume() * multiplier;
        }
    }
    
    setVolume(value) {
        this.globalVolume = Math.max(0, Math.min(1, value));
        
        // Si on change le volume, on unmute automatiquement
        if (this.isMuted && value > 0) {
            this.isMuted = false;
            this.updateMuteButton();
        }
        
        // Appliquer à tous les éléments audio
        this.applyVolumeToAll();
        
        // Mettre à jour l'UI
        this.updateVolumeSliderStyle();
        this.updateVolumeIcon();
        
        // Sauvegarder
        this.savePreferences();
    }
    
    toggleMute() {
        this.isMuted = !this.isMuted;
        
        if (this.isMuted) {
            this.previousVolume = this.globalVolume;
            this.applyMuteState();
        } else {
            this.globalVolume = this.previousVolume || 0.3;
            this.volumeSlider.value = this.globalVolume * 100;
            this.updateVolumeSliderStyle();
            this.applyVolumeToAll();
            this.volumeControl.classList.remove('muted');
        }
        
        this.updateMuteButton();
        this.updateVolumeIcon();
        this.savePreferences();
    }
    
    applyMuteState() {
        this.volumeControl.classList.add('muted');
        this.applyVolumeToAll();
    }
    
    applyVolumeToAll() {
        const effectiveVolume = this.getEffectiveVolume();
        
        // Appliquer aux sons préchargés
        if (this.sounds.engineLoop) {
            this.sounds.engineLoop.volume = effectiveVolume * this.volumeMultipliers.engineLoop;
        }
        if (this.sounds.countdown) {
            this.sounds.countdown.volume = effectiveVolume * this.volumeMultipliers.countdown;
        }
        if (this.sounds.boost) {
            this.sounds.boost.volume = effectiveVolume * this.volumeMultipliers.boost;
        }

        if (this.sounds.wallScrape) {
            this.sounds.wallScrape.volume = effectiveVolume * this.volumeMultipliers.wallScrape;
        }
        if (this.sounds.wallHit) {
            this.sounds.wallHit.volume = effectiveVolume * this.volumeMultipliers.wallHit;
        }
        if (this.sounds.playerCollision) {
            this.sounds.playerCollision.volume = effectiveVolume * this.volumeMultipliers.playerCollision;
        }
        if (this.sounds.explosion) {
            this.sounds.explosion.volume = effectiveVolume * this.volumeMultipliers.explosion;
        }
        if (this.sounds.respawn) {
            this.sounds.respawn.volume = effectiveVolume * this.volumeMultipliers.respawn;
        }

         if (this.sounds.itemPickup) {
            this.sounds.itemPickup.volume = effectiveVolume * this.volumeMultipliers.itemPickup;
        }
        if (this.sounds.bombDrop) {
            this.sounds.bombDrop.volume = effectiveVolume * this.volumeMultipliers.bombDrop;
        }
        if (this.sounds.bombExplode) {
            this.sounds.bombExplode.volume = effectiveVolume * this.volumeMultipliers.bombExplode;
        }
        if (this.sounds.rocketLaunch) {
            this.sounds.rocketLaunch.volume = effectiveVolume * this.volumeMultipliers.rocketLaunch;
        }
        if (this.sounds.rocketExplode) {
            this.sounds.rocketExplode.volume = effectiveVolume * this.volumeMultipliers.rocketExplode;
        }
        if (this.sounds.superboost) {
            this.sounds.superboost.volume = effectiveVolume * this.volumeMultipliers.superboost;
        }
        
        // Appliquer à tous les éléments audio actifs enregistrés
        for (const [name, audio] of this.activeAudios) {
            if (audio && audio.volume !== undefined) {
                const multiplier = this.volumeMultipliers[name] || 1.0;
                audio.volume = effectiveVolume * multiplier;
            }
        }
        
        // Appliquer aussi aux éléments audio globaux connus
        // Background music
        if (window.gameClient && window.gameClient.backgroundMusic) {
            window.gameClient.backgroundMusic.volume = effectiveVolume * this.volumeMultipliers.backgroundMusic;
        }
        
        // Game music
        if (window.gameClient && window.gameClient.gameEngine && window.gameClient.gameEngine.music) {
            window.gameClient.gameEngine.music.volume = effectiveVolume * this.volumeMultipliers.gameMusic;
        }
    }
    
    updateVolumeSliderStyle() {
        // Mettre à jour la barre de progression
        const percent = this.volumeSlider.value;
        this.volumeSlider.style.setProperty('--volume-percent', percent + '%');
    }
    
    updateVolumeIcon() {
        // Mettre à jour l'icône selon le niveau
        const svgPath = this.volumeIcon.querySelector('path');
        if (!svgPath) return;
        
        if (this.isMuted || this.globalVolume === 0) {
            // Icône muet
            svgPath.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
        } else if (this.globalVolume < 0.5) {
            // Icône volume faible
            svgPath.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z');
        } else {
            // Icône volume élevé
            svgPath.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z');
        }
    }
    
    updateMuteButton() {
        const muteIcon = this.muteButton.querySelector('.mute-icon');
        const volumeIcon = this.muteButton.querySelector('.volume-icon');
        
        if (muteIcon && volumeIcon) {
            if (this.isMuted) {
                muteIcon.style.display = 'block';
                volumeIcon.style.display = 'none';
            } else {
                muteIcon.style.display = 'none';
                volumeIcon.style.display = 'block';
            }
        }
    }
    
    savePreferences() {
        try {
            localStorage.setItem('kartrush_volume', this.globalVolume.toString());
            localStorage.setItem('kartrush_muted', this.isMuted.toString());
        } catch (e) {}
    }
    
    loadPreferences() {
        try {
            const savedVolume = localStorage.getItem('kartrush_volume');
            const savedMuted = localStorage.getItem('kartrush_muted');
            
            if (savedVolume !== null) {
                this.globalVolume = parseFloat(savedVolume);
            }
            
            if (savedMuted !== null) {
                this.isMuted = savedMuted === 'true';
            }
        } catch (e) {}
    }
    
    // Méthode pour obtenir le volume effectif actuel
    getEffectiveVolume() {
        return this.isMuted ? 0 : this.globalVolume;
    }
    
    // Méthode helper pour obtenir le volume avec multiplicateur
    getVolumeFor(soundType) {
        const multiplier = this.volumeMultipliers[soundType] || 1.0;
        return this.getEffectiveVolume() * multiplier;
    }
}

// Créer une instance globale
const soundManager = new SoundManager();

// Rendre soundManager accessible globalement
window.soundManager = soundManager;

// Export pour les modules
export default soundManager;