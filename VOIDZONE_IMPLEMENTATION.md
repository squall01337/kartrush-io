# Void Zone Implementation Guide for KartRush.io

This guide explains how to add void zones (falling/hazard areas) to the game, following the existing patterns and architecture.

## CURRENT STATUS (2025-07-13)

- ✅ **Map Editor**: Void zone creation/editing fully working
- ✅ **Server Logic**: Collision detection and falling state working correctly
- ✅ **Death Mechanic**: Players die after 1.5 seconds of falling
- ✅ **Sound**: Falling sound plays when entering void zone
- ✅ **Map Support**: Void zones load from JSON map files correctly
- ❌ **Visual Animation**: Falling animation (shrinking, rotating, drift) NOT WORKING - players fall but without visual effects

### Known Issues
- The falling animation code is implemented but not displaying:
  - No shrinking effect (should scale from 100% to 10%)
  - No rotation during fall
  - No expanding dark void circle
  - Drift based on velocity may be working but hard to see without other effects

The core mechanic works - entering a void zone triggers falling state and death after 1.5 seconds - but the visual feedback needs debugging.

## Overview

Void zones are areas on the track where karts fall off and die after a falling animation. Think of them as cliff edges or pits in racing games. All void zones work the same way - instant death after 1.5 seconds of falling.

## 1. Map Structure Update

### JSON Format
Add `voidZones` array to map files following the continuous curves pattern:

```json
{
  "name": "lava_track",
  "width": 1536,
  "height": 1024,
  "walls": [...],
  "continuousCurves": [...],
  "voidZones": [
    {
      "points": [[100, 200], [150, 250], [200, 200], [150, 150]],
      "closed": true
    }
  ],
  "racingLine": {...},
  // ... other elements
}
```

## 2. Map Editor Updates (map_editor.py)

### Add Void Zone Mode
```python
# Add to modes
self.modes = ["spawn_point", "wall", "curve", "continuous_curve", 
              "checkpoint", "finish_line", "booster", "item", "racing_line", 
              "void_zone"]  # NEW

# Add void zone drawing state
self.void_zone_drawing = False
self.current_void_zone_points = []

# Add color for void zones
void_color = (255, 100, 50, 128)  # Semi-transparent orange-red
```

### Drawing Logic
- Similar to continuous curves but always closed
- Draw with semi-transparent fill to show danger area
- Use orange/red color scheme
- Show preview line when drawing

### Export Logic
```python
# In export_map function
if self.void_zones:
    map_data["voidZones"] = []
    for zone in self.void_zones:
        zone_data = {
            "points": zone["points"],
            "closed": True
        }
        map_data["voidZones"].append(zone_data)
```

## 3. Backend Implementation (server.js)

### Load Void Zones
```javascript
// In map loading
if (mapData.voidZones) {
    trackData.voidZones = mapData.voidZones;
}
```

### Collision Detection
```javascript
// Add to Player class or collision system
checkVoidZoneCollision(voidZones) {
    if (!voidZones) return false;
    
    for (const zone of voidZones) {
        if (zone.closed && this.isPointInPolygon(this.x, this.y, zone.points)) {
            return zone;
        }
    }
    return null;
}

// Point-in-polygon algorithm
isPointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i][0], yi = points[i][1];
        const xj = points[j][0], yj = points[j][1];
        
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
```

### Void Zone Detection
```javascript
// In game update loop
const voidZone = player.checkVoidZoneCollision(trackData.voidZones);
if (voidZone && !player.isFalling && !player.isDead) {
    player.isFalling = true;
    player.fallStartTime = Date.now();
    
    // Store velocity at moment of falling (for drift effect)
    player.fallVelocityX = Math.cos(player.angle) * player.speed;
    player.fallVelocityY = Math.sin(player.angle) * player.speed;
    
    // Stop player movement immediately
    player.speed = 0;
    player.canControl = false;
    
    // Emit falling event with velocity data
    io.to(this.id).emit('playerFalling', {
        playerId: player.id,
        position: { x: player.x, y: player.y },
        velocityX: player.fallVelocityX,
        velocityY: player.fallVelocityY
    });
}
```

### Falling State
```javascript
// Global constant for fall duration
const FALL_DURATION = 1500; // 1.5 seconds - same for all void zones

// Add to Player class
this.isFalling = false;
this.fallStartTime = 0;
this.fallVelocityX = 0;
this.fallVelocityY = 0;
this.canControl = true;

// In player update
if (this.isFalling) {
    const elapsed = Date.now() - this.fallStartTime;
    
    // Continue drifting based on initial velocity
    this.x += this.fallVelocityX * deltaTime * 0.5; // Half speed drift
    this.y += this.fallVelocityY * deltaTime * 0.5;
    
    if (elapsed >= FALL_DURATION) {
        // Instant death - no damage calculation
        this.hp = 0;
        this.isDead = true;
        this.isFalling = false;
        this.canControl = true;
        // Normal death/respawn logic will handle the rest
    }
}
```

## 4. Frontend Implementation

### NO Visual Rendering for Void Zones
Void zones are invisible - they only trigger the falling mechanic when a player enters them.

### Falling Animation (game.js)
```javascript
// Handle falling state from server
socket.on('playerFalling', (data) => {
    // Play falling sound for any player
    soundManager.playFalling();
    
    // Store fall data for animation
    const player = this.gameState.players.find(p => p.id === data.playerId);
    if (player) {
        player.isFalling = true;
        player.fallStartTime = Date.now();
        player.fallStartX = player.x;
        player.fallStartY = player.y;
        player.fallVelocityX = data.velocityX; // Preserve momentum
        player.fallVelocityY = data.velocityY;
    }
});

// Global constant (same as server)
const FALL_DURATION = 1500; // 1.5 seconds

// In player rendering (inside renderPlayers method)
if (player.isFalling) {
    const elapsed = Date.now() - player.fallStartTime;
    const progress = Math.min(elapsed / FALL_DURATION, 1);
    
    // Calculate position based on initial velocity (drift while falling)
    const driftX = player.fallVelocityX * (elapsed / 1000) * 0.5; // Slow down drift
    const driftY = player.fallVelocityY * (elapsed / 1000) * 0.5;
    
    ctx.save();
    ctx.translate(player.x + driftX, player.y + driftY);
    
    // Shrinking effect (getting smaller as falling)
    const scale = 1 - (progress * 0.9); // Scale from 1.0 to 0.1
    ctx.scale(scale, scale);
    
    // Slight rotation while falling
    ctx.rotate(progress * Math.PI * 2);
    
    // Render the kart normally but with transformations
    this.renderKart(ctx, player);
    
    ctx.restore();
}
```

## 5. Sound Implementation

### Add to soundManager.js
```javascript
// In initializeSounds()
this.sounds.falling = new Audio('assets/audio/falling.mp3');

// In volumeMultipliers
falling: 0.7,

// Add method
playFalling() {
    const fall = this.sounds.falling;
    if (fall) {
        fall.volume = this.getEffectiveVolume() * this.volumeMultipliers.falling;
        fall.currentTime = 0;
        fall.play().catch(e => console.log('Erreur lecture falling:', e));
    }
}
```

## 6. Gameplay Considerations

### Balance
- Place void zones strategically (shortcuts with risk)
- Not too close to racing line
- Always have safe path

### Physics
- Players maintain momentum when falling
- Fast players fall further from track edge
- Slow players fall closer to track edge
- No control during fall

## 7. Testing Checklist

- [ ] Void zones load from JSON correctly
- [ ] Collision detection works accurately
- [ ] Player loses control when entering void zone
- [ ] Falling animation scales kart down smoothly
- [ ] Momentum preservation works (fast = far, slow = close)
- [ ] Falling sound plays correctly
- [ ] Death and respawn after 1.5 seconds
- [ ] Network sync for all players
- [ ] Map editor can create/edit/delete void zones
- [ ] No performance issues with complex void shapes

## Implementation Summary

The void zone system is simple and focused:
1. **Invisible zones** - No visual representation in-game
2. **Falling mechanic** - Kart shrinks and drifts based on speed
3. **Momentum physics** - Faster karts fall further from edge
4. **Simple sound** - Just falling.mp3 when entering void
5. **Instant death** - Always kills player after 1.5 seconds (no damage values)

Every void zone behaves exactly the same way - it's a consistent game mechanic with no variations or special cases.