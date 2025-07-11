# Item Creation Guide for KartRush.io

This guide documents the complete workflow for adding a new item to the game, using the Poison Slick implementation as a reference.

## Overview
Adding a new item requires changes to both server-side and client-side code, plus assets (sprites and sounds).

## Step 1: Server-Side Implementation (backend/server.js)

### 1.1 Add Item to Drop Rates
Location: Around line 1457 in the item collection logic
```javascript
// In checkItemBoxCollisions method
if (rand < 0.40) {
    itemType = 'healthpack'; // 40%
} else if (rand < 0.62) {
    itemType = 'bomb'; // 22%
} else if (rand < 0.80) {
    itemType = 'rocket'; // 18%
} else if (rand < 0.88) {
    itemType = 'superboost'; // 8%
} else {
    itemType = 'poisonslick'; // 12%
}
```

### 1.2 Create Item Class (if needed)
For items that persist on track (like poison slick), create a class:
```javascript
class PoisonSlick {
    constructor(owner) {
        this.id = uuidv4();
        this.x = owner.x - Math.cos(owner.angle) * 50;
        this.y = owner.y - Math.sin(owner.angle) * 50;
        this.radius = 35;
        this.lifetime = 10000; // 10 seconds
        this.createdAt = Date.now();
        this.ownerId = owner.id;
        this.active = true;
        // Add any item-specific properties
    }
    
    update(deltaTime) {
        // Update logic
    }
    
    checkCollision(player) {
        // Collision detection
    }
}
```

### 1.3 Add Storage in Room Class
In the Room constructor:
```javascript
this.poisonSlicks = new Map(); // For persistent items
```

Clear in startGame:
```javascript
this.poisonSlicks.clear();
```

### 1.4 Add Use Method
In the useItem switch statement:
```javascript
case 'poisonslick':
    this.usePoisonSlick(player);
    break;
```

Create the use method:
```javascript
usePoisonSlick(player) {
    const slick = new PoisonSlick(player);
    this.poisonSlicks.set(slick.id, slick);
    
    io.to(this.id).emit('poisonSlickDropped', {
        id: slick.id,
        x: slick.x,
        y: slick.y,
        radius: slick.radius,
        ownerId: player.id
    });
}
```

### 1.5 Add Update Logic
In the game loop update method:
```javascript
// Update poison slicks
for (const [id, slick] of this.poisonSlicks) {
    slick.update(deltaTime);
    
    if (!slick.active) {
        this.poisonSlicks.delete(id);
        io.to(this.id).emit('poisonSlickRemoved', { id: id });
    } else {
        // Check collisions and apply effects
        for (const [playerId, player] of this.players) {
            if (slick.checkCollision(player)) {
                // Apply item effects
            }
        }
    }
}
```

### 1.6 Add to Game State
In the game state broadcast:
```javascript
poisonSlicks: Array.from(this.poisonSlicks.values()).filter(s => s.active).map(s => ({
    id: s.id,
    x: s.x,
    y: s.y,
    radius: s.radius,
    ownerId: s.ownerId
}))
```

### 1.7 Add Player Properties (if needed)
For status effects, add to Player class:
```javascript
this.isPoisoned = false;
this.poisonEndTime = 0;
this.lastPoisonDamage = 0;
```

## Step 2: Client-Side Implementation

### 2.1 Update Game State (frontend/js/game.js)
Add to gameState object:
```javascript
this.gameState = {
    players: [],
    // ... other properties
    poisonSlicks: [] // Add your item array
};
```

### 2.2 Add Sprite Position
In getItemIcon method, add position in sprite grid:
```javascript
const positions = {
    'healthpack': { row: 0, col: 0 },
    'rocket': { row: 1, col: 0 },
    'bomb': { row: 2, col: 0 },
    'superboost': { row: 0, col: 1 },
    'poisonslick': { row: 2, col: 1 } // Bottom-mid position
};
```

### 2.3 Create Render Method
Add rendering method for persistent items:
```javascript
renderPoisonSlicks(ctx) {
    if (!this.gameState.poisonSlicks) return;
    
    this.gameState.poisonSlicks.forEach(slick => {
        ctx.save();
        ctx.translate(slick.x, slick.y);
        
        // Draw the sprite
        const poisonIcon = this.getItemIcon('poisonslick');
        if (poisonIcon) {
            const spriteSize = slick.radius * 2;
            ctx.drawImage(
                poisonIcon,
                -spriteSize / 2,
                -spriteSize / 2,
                spriteSize,
                spriteSize
            );
        }
        
        ctx.restore();
    });
}
```

### 2.4 Add to Render Pipeline
In the main render method, add your render call:
```javascript
this.renderTrack(ctx);
this.renderBoosters(ctx);
this.renderItemBoxes(ctx);
this.renderPoisonSlicks(ctx); // Add your render method
this.renderFinishLine(ctx);
```

### 2.5 Update Casino Animation
In startItemSlotAnimation:
```javascript
const items = ['bomb', 'rocket', 'superboost', 'healthpack', 'poisonslick'];
```

### 2.6 Add to Item Notifications
In renderItemNotification:
```javascript
const itemNames = {
    'bomb': 'BOMB',
    'rocket': 'ROCKET',
    'superboost': 'SUPER BOOST',
    'healthpack': 'HEALTH PACK',
    'poisonslick': 'POISON SLICK'
};
```

## Step 3: Socket Events (frontend/js/client.js)

### 3.1 Add Socket Listeners
```javascript
this.socket.on('poisonSlickDropped', (data) => {
    soundManager.playSlickDropping();
});

this.socket.on('poisonSlickRemoved', (data) => {
    // Handled by game state update
});

this.socket.on('playerPoisoned', (data) => {
    if (data.playerId === this.playerId) {
        this.showScreenFlash('#8B008B', 300);
        soundManager.playSlickCrossing();
    }
});
```

## Step 4: Sound Implementation (frontend/js/soundManager.js)

### 4.1 Add Volume Multipliers
```javascript
this.volumeMultipliers = {
    // ... existing sounds
    slickDropping: 0.6,
    slickCrossing: 0.5
};
```

### 4.2 Initialize Sounds
In initializeSounds:
```javascript
this.sounds.slickDropping = new Audio('assets/audio/slick_dropping.mp3');
this.sounds.slickCrossing = new Audio('assets/audio/slick_crossing.mp3');
```

### 4.3 Create Play Methods
```javascript
playSlickDropping() {
    const drop = this.sounds.slickDropping;
    if (drop) {
        drop.volume = this.getEffectiveVolume() * this.volumeMultipliers.slickDropping;
        drop.currentTime = 0;
        drop.play().catch(e => console.log('Erreur lecture slick_dropping:', e));
    }
}

playSlickCrossing() {
    const cross = this.sounds.slickCrossing;
    if (cross) {
        cross.volume = this.getEffectiveVolume() * this.volumeMultipliers.slickCrossing;
        cross.currentTime = 0;
        cross.play().catch(e => console.log('Erreur lecture slick_crossing:', e));
    }
}
```

## Step 5: Assets

### 5.1 Sprite
- Add icon to items_icons.png sprite sheet
- Note the grid position (row, col) for the sprite mapping

### 5.2 Sounds
Add sound files to /assets/audio/:
- Item use sound (e.g., slick_dropping.mp3)
- Item effect sound (e.g., slick_crossing.mp3)

## Step 6: Damage System Integration (if applicable)

### 6.1 For Damage Over Time
In Player update method:
```javascript
if (this.isPoisoned) {
    if (now > this.poisonEndTime) {
        this.isPoisoned = false;
    } else {
        if (now - this.lastPoisonDamage > 500) {
            const result = this.takeDamage(5);
            this.lastPoisonDamage = now;
            poisonDamageResult = { damage: 5, result: result };
        }
    }
}
// Return poisonDamageResult at end of update
```

### 6.2 Emit Damage Events
In game loop where player.update is called:
```javascript
const poisonDamageResult = player.update(deltaTime);
if (poisonDamageResult) {
    io.to(this.id).emit('playerDamaged', {
        playerId: player.id,
        damage: poisonDamageResult.damage,
        hp: player.hp,
        damageType: 'poison',
        position: { x: player.x, y: player.y },
        isDead: poisonDamageResult.result === 'death'
    });
}
```

## Testing Workflow

1. **Temporarily adjust drop rates** for easy testing:
```javascript
if (rand < 0.90) {
    itemType = 'youritem'; // 90% for testing
}
```

2. **Test all aspects**:
   - Item pickup and casino animation
   - Item use and effects
   - Visual rendering
   - Sound effects
   - Damage/effects application
   - Network synchronization

3. **Revert drop rates** to balanced values after testing

## Common Patterns

### Projectile Items (like bomb/rocket)
- Create with Projectile class
- Store in this.projectiles Map
- Handle explosion/impact in handleProjectileExplosion

### Instant Effect Items (like healthpack/superboost)
- Apply effect immediately in use method
- Emit single event for confirmation

### Persistent Track Items (like poison slick)
- Create dedicated class
- Store in dedicated Map
- Update in game loop
- Handle collisions continuously
- Clean up when lifetime expires

### Status Effect Items
- Add properties to Player class
- Handle in Player.update method
- Apply effects over time
- Clear on respawn/death

## Debugging Tips

1. Use console.log in critical points:
   - Item drop determination
   - Use method execution
   - Collision detection
   - Socket event emission/reception

2. Check browser console for:
   - Asset loading errors
   - Socket event reception
   - Rendering errors

3. Verify game state synchronization:
   - Server state includes new item data
   - Client receives and stores item data
   - Rendering uses correct game state

Remember to update LISTCHANGE.md with your new item details after implementation!