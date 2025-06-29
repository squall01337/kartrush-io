// soundManager.js

// 🔁 Moteur
const engineLoop = new Audio('assets/audio/engine_loop.mp3');
engineLoop.loop = true;
engineLoop.volume = 0.25;

// 🎵 Décompte 3-2-1-GO
const countdown = new Audio('assets/audio/countdown.mp3');
countdown.volume = 1.0;

const soundManager = {
    // 🔁 Moteur
    playEngine() {
        if (engineLoop.paused) {
            engineLoop.currentTime = 0;
            engineLoop.play();
        }
    },
    stopEngine() {
        if (!engineLoop.paused) {
            engineLoop.pause();
            engineLoop.currentTime = 0;
        }
    },

    // ⏱️ Décompte
    playCountdown() {
        countdown.currentTime = 0;
        countdown.play();
    }
};

export default soundManager;