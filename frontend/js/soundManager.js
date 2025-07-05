// soundManager.js - Gestionnaire de sons et de volume global pour KartRush.io

class SoundManager {
    constructor() {
        // Volume global
        this.globalVolume = 0.3; // Volume par défaut (30%)
        this.isMuted = false;
        this.previousVolume = 0.3; // Pour restaurer après unmute
        
        // Volumes relatifs pour chaque type de son
        this.volumeMultipliers = {
            engineLoop: 0.25,      // 25% du volume global
            countdown: 1.0,        // 100% du volume global
            backgroundMusic: 0.3,  // 30% du volume global
            gameMusic: 0.5,        // 50% du volume global
            checkpoint: 0.7,       // 70% du volume global
            lap: 0.8,             // 80% du volume global
            error: 0.5,           // 50% du volume global
            victory: 0.5,         // 50% du volume global
            boost: 0.7            // 70% du volume global
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
        // 🔁 Moteur
        this.sounds.engineLoop = new Audio('assets/audio/engine_loop.mp3');
        this.sounds.engineLoop.loop = true;
        
        // 🎵 Décompte 3-2-1-GO
        this.sounds.countdown = new Audio('assets/audio/countdown.mp3');
        
        // 🚀 Son de boost
        this.sounds.boost = new Audio('assets/audio/boost.mp3');
    }
    
    initializeUI() {
        this.volumeSlider = document.getElementById('volumeSlider');
        this.muteButton = document.getElementById('muteButton');
        this.volumeControl = document.getElementById('volumeControl');
        this.volumeIcon = document.getElementById('volumeIcon');
        
        if (!this.volumeSlider || !this.muteButton) {
            console.error('Éléments de contrôle de volume non trouvés');
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
        
        // NOUVELLE CORRECTION : Empêcher la perte de focus lors du changement de volume
        this.volumeSlider.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Empêcher le comportement par défaut
            
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
    
    playEngine() {
        const engine = this.sounds.engineLoop;
        if (engine && engine.paused) {
            engine.volume = this.getEffectiveVolume() * this.volumeMultipliers.engineLoop;
            engine.currentTime = 0;
            engine.play().catch(e => console.log('Erreur lecture moteur:', e));
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
            countdown.play().catch(e => console.log('Erreur lecture countdown:', e));
        }
    }
    
    // NOUVEAU : Méthode pour jouer le son de boost
    playBoost() {
        const boost = this.sounds.boost;
        if (boost) {
            boost.volume = this.getEffectiveVolume() * this.volumeMultipliers.boost;
            boost.currentTime = 0;
            boost.play().catch(e => {
                console.log('Erreur lecture boost:', e);
                // Fallback avec synthèse sonore
                this.playBoostSynth();
            });
        } else {
            // Fallback si pas de fichier audio
            this.playBoostSynth();
        }
    }
    
    // NOUVEAU : Son de boost synthétisé comme fallback
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
        } catch (e) {
            console.log('Erreur synthèse boost:', e);
        }
    }
    
    // Méthode générique pour jouer un son temporaire
    playSound(soundPath, volumeMultiplier = 1.0) {
        const audio = new Audio(soundPath);
        audio.volume = this.getEffectiveVolume() * volumeMultiplier;
        audio.play().catch(e => {
            console.log(`Erreur lecture ${soundPath}:`, e);
        });
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
        return this.playSound('assets/audio/victory.mp3', this.volumeMultipliers.victory);
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
        } catch (e) {
            console.log('Erreur Web Audio API:', e);
        }
    }
    
    // === GESTION DU VOLUME ===
    
    registerAudio(name, audioElement) {
        if (audioElement) {
            this.activeAudios.set(name, audioElement);
            // Appliquer le volume actuel avec le multiplicateur approprié
            const multiplier = this.volumeMultipliers[name] || 1.0;
            audioElement.volume = this.getEffectiveVolume() * multiplier;
            
            // NOUVELLE LIGNE : Forcer une mise à jour immédiate
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
    
    // Nouvelle méthode pour forcer la mise à jour du volume d'un audio spécifique
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
        } catch (e) {
            console.warn('Impossible de sauvegarder les préférences de volume');
        }
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
        } catch (e) {
            console.warn('Impossible de charger les préférences de volume');
        }
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

// Export pour les modules
export default soundManager;