# KartRush.io Items Documentation

## Current Items

### 1. **Health Pack** ❤️
- **Effect**: Restores 50 HP to the player
- **Drop Rate**: 45%
- **Usage**: Instant
- **Visual**: Green healing particles and crosses
- **Sound**: respawn.mp3

### 2. **Triple Bombs** 💣💣💣 (Replaces Single Bomb)
- **Effect**: Drops 3 bombs in a spread pattern behind the player
- **Drop Rate**: 25%
- **Damage**: 30 HP per bomb explosion
- **Explosion Radius**: 80 units per bomb
- **Visual**: Bomb sprites with fuse, explosion animation
- **Sound**: bomb_drop.mp3, bomb_explode.mp3

### 3. **Rocket** 🚀
- **Effect**: Fires a homing rocket that tracks the nearest player ahead
- **Drop Rate**: 20%
- **Damage**: 40 HP on direct hit
- **Speed**: 600 units/second
- **Explosion Radius**: 100 units
- **Visual**: Rocket sprite with flame trail
- **Sound**: rocket_launch.mp3, rocket_explode.mp3

### 4. **Super Boost** ⚡
- **Effect**: Powerful speed boost for 2 seconds
- **Drop Rate**: 10%
- **Speed Multiplier**: 1.8x max speed
- **Visual**: Blue/purple boost effects
- **Sound**: superboost.mp3

## Planned Items

### 5. **Shield** 🛡️
- **Effect**: Protects from one hit (bomb, rocket, or collision damage)
- **Duration**: Until hit or 15 seconds
- **Visual**: Translucent bubble effect around kart
- **Drop Rate**: 15% (requires rebalancing)

### 6. **Oil Slick** 🛢️
- **Effect**: Drops a slippery oil puddle that causes spin-outs
- **Duration**: Stays on track for 10 seconds
- **Spin Duration**: 1 second loss of control
- **Visual**: Black puddle with rainbow sheen
- **Drop Rate**: 20%

### 7. **Lightning** ⚡
- **Effect**: Strikes all players ahead, stunning and slowing them
- **Stun Duration**: 0.5 seconds
- **Speed Reduction**: 50% for 2 seconds
- **Visual**: Lightning bolt animation from sky
- **Drop Rate**: 5% (rare item)

### 8. **Ice Beam** ❄️
- **Effect**: Freezes the first player hit
- **Freeze Duration**: 2 seconds (slides with no control)
- **Range**: Linear projectile
- **Visual**: Blue ice projectile, frozen kart effect
- **Drop Rate**: 15%

### 9. **Swap** 🔄
- **Effect**: Instantly swap positions with a random player
- **Cooldown**: Cannot be used in first/last 10 seconds of race
- **Visual**: Teleportation effect on both players
- **Drop Rate**: 3% (very rare)

## Item Distribution (Proposed)

With the new items, the distribution would need rebalancing:

| Item | Current Rate | Proposed Rate |
|------|--------------|---------------|
| Health Pack | 45% | 30% |
| Triple Bombs | 25% | 20% |
| Rocket | 20% | 15% |
| Super Boost | 10% | 5% |
| Shield | - | 10% |
| Oil Slick | - | 10% |
| Ice Beam | - | 7% |
| Lightning | - | 2% |
| Swap | - | 1% |
| **Total** | **100%** | **100%** |

## Technical Implementation Notes

### Current Structure
- Items are handled in a switch statement in `server.js`
- Item selection uses random percentage ranges
- Each item has its own use method (useBomb, useRocket, etc.)

### Proposed Refactoring
1. Create `items/` directory with separate files for each item
2. Base Item class with common functionality
3. Item registry system for easy addition of new items
4. Separate client-side item effects from server logic
5. Configuration file for drop rates and item properties

### Item Interface
```javascript
class BaseItem {
    constructor(player, room) {
        this.player = player;
        this.room = room;
    }
    
    use() {
        // Override in subclasses
    }
    
    canUse() {
        return !this.player.isDead && !this.player.isStunned;
    }
}
```

### Adding New Items (After Refactoring)
1. Create new item class extending BaseItem
2. Add to item registry
3. Add sprite/assets
4. Add to drop rate configuration
5. Add client-side visual effects