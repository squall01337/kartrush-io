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
            // Charger les images de base avec timeout
            const timeout = 10000; // 10 secondes
            
            await Promise.race([
                Promise.all([
                    // Ne plus charger track_background par défaut
                    this.loadImage('kart_sprites', 'assets/kart_sprites.png'),
                    this.loadImage('item_icons', 'assets/item_icons.png')
                ]),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout de chargement des assets')), timeout)
                )
            ]);
            
            this.loaded = true;
        } catch (error) {
            console.warn('Erreur lors du chargement des assets:', error);
            this.loaded = false;
        }
    }

    // Nouvelle méthode pour charger les assets d'une map spécifique
    async loadMapAssets(mapData) {
        const promises = [];
        
        // Charger le background si spécifié
        if (mapData.background && mapData.background.endsWith('.png')) {
            const backgroundName = `map_background_${mapData.id}`;
            promises.push(this.loadImage(backgroundName, mapData.background));
        }
        
        // On pourrait aussi charger d'autres assets spécifiques à la map ici
        // Par exemple: des textures spéciales, des sprites d'obstacles, etc.
        
        try {
            await Promise.all(promises);
            console.log(`✅ Assets de la map ${mapData.id} chargés`);
            return true;
        } catch (error) {
            console.error(`❌ Erreur lors du chargement des assets de la map ${mapData.id}:`, error);
            return false;
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
                console.error(`Erreur de chargement: ${name}`);
                reject(new Error(`Failed to load ${path}`));
            };
            img.src = path;
        });
    }

    getImage(name) {
        return this.images.get(name);
    }
    
    // Nouvelle méthode pour obtenir le background d'une map
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
        
        // Dimensions réelles de l'image (pas hardcodées)
        const spriteWidth = Math.floor(spriteSheet.width / 3);  // ~113px
        const spriteHeight = Math.floor(spriteSheet.height / 2); // ~256px
        
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
            sx: pos.x * 200, // Approximativement 200px par icône
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

