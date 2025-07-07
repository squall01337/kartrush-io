// Gestionnaire d'assets pour KartRush.io
class AssetManager {
    constructor() {
        this.images = new Map();
        this.sounds = new Map();
        this.loaded = false;
        this.loadingPromises = [];
    }

    async loadAssets() {
    try {
        const timeout = 10000; // 10 secondes
        
        await Promise.race([
            Promise.all([
                this.loadImage('kart_sprites', 'assets/kart_sprites.png'),
                this.loadImage('item_icons', 'assets/items_icons.png') // IMPORTANT
            ]),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout de chargement des assets')), timeout)
            )
        ]);
        
        this.loaded = true;
    } catch (error) {
        this.loaded = false;
        throw error;
    }
}

    loadImage(name, path) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.images.set(name, img);
                resolve(img);
            };
            img.onerror = () => {
                reject(new Error(`Failed to load ${path}`));
            };
            img.src = path;
        });
    }

    getImage(name) {
        return this.images.get(name);
    }
    
    getMapBackground(mapId) {
        return this.getImage(`map_background_${mapId}`);
    }

    getKartSprite(color) {
        const spriteSheet = this.getImage('kart_sprites');
        if (!spriteSheet) {
            return null;
        }

        // Mapping des couleurs aux positions dans la sprite sheet
        const colorMap = {
            '#ff4444': { x: 0, y: 0 }, // rouge
            '#44ff44': { x: 1, y: 0 }, // vert
            '#4444ff': { x: 2, y: 0 }, // bleu
            '#ffff44': { x: 0, y: 1 }, // jaune
            '#ff44ff': { x: 1, y: 1 }, // magenta
            '#44ffff': { x: 2, y: 1 }  // cyan
        };

        const pos = colorMap[color] || { x: 0, y: 0 };
        
        // Dimensions réelles de l'image
        const spriteWidth = Math.floor(spriteSheet.width / 3);
        const spriteHeight = Math.floor(spriteSheet.height / 2);
        
        const sprite = {
            image: spriteSheet,
            sx: pos.x * spriteWidth,
            sy: pos.y * spriteHeight,
            sw: spriteWidth,
            sh: spriteHeight
        };
        
        return sprite;
    }

    getItemIcon(itemType) {
        const iconSheet = this.getImage('item_icons');
        if (!iconSheet) return null;

        const iconMap = {
            'boost': { x: 0, y: 0 },
            'slow': { x: 1, y: 0 },
            'missile': { x: 2, y: 0 }
        };

        const pos = iconMap[itemType] || { x: 0, y: 0 };
        return {
            image: iconSheet,
            sx: pos.x * 200,
            sy: pos.y * 200,
            sw: 200,
            sh: 200
        };
    }

    isLoaded() {
        return this.loaded;
    }
}

// Instance globale du gestionnaire d'assets
window.assetManager = new AssetManager();