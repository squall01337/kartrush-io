# Racing Line Position Tracking System

## Overview
The current checkpoint-based position system is not precise enough for real-time position tracking. This document describes a new system based on tracking each player's exact progress along a "racing line".

## What is a Racing Line?
The racing line is a series of points that define the path through the track. It doesn't have to be the "optimal" racing line - it's simply a reference path used to measure progress.

### Where to Draw the Racing Line
- **Middle of the track**: The simplest approach - draw a line through the center of the driveable area
- **Between walls**: Make sure the line stays safely between the track walls
- **Through checkpoints**: The line should pass through all checkpoints and the finish line
- **Smooth curves**: Use enough points to make smooth curves (especially in corners)

### Racing Line Direction
**IMPORTANT**: Tracks can be driven in either direction:
- Some tracks go **clockwise** (start on left of finish line, go right)
- Some tracks go **counter-clockwise** (start on right of finish line, go left)
- The racing line points MUST be ordered in the correct racing direction
- Add visual arrows in the editor to show direction while drawing

### Point Density Guidelines
- **Straights**: Place a point every 80-100 pixels
- **Curves**: Place a point every 30-50 pixels (more for tight turns)
- **Total points**: Most tracks need 50-150 points
- **Too few points**: Position updates will be choppy
- **Too many points**: Unnecessary computation

### How Player Detection Works
```
TRACK CROSS-SECTION VIEW:
========================

    Wall ████████████████████████████████ Wall
         ↑                              ↑
         |<------ Track Width -------->|
         |                              |
         |  •————————•————————•         | <- Racing Line (center)
         |           ↑                  |
         |           |                  |
         |     Player can be            |
         |     ANYWHERE here            |
         |           |                  |
         |           ↓                  |
         |    🏎️ <- Player Position    |
         |    |                         |
         |    └→ Projected to nearest  |
         |       point on racing line   |
         ↓                              ↓
    Wall ████████████████████████████████ Wall

The system finds the NEAREST point on the racing line
to calculate progress - players don't need to drive ON it!
```

## Implementation Plan

### 1. Map Editor Updates
The map editor needs to add a new tool to draw the racing line:

```python
# New racing line tool features:
- Click to add points along the track
- Points connected in order to form the racing line
- Visual preview of the line
- Should start near the start/finish line
- Must form a complete loop back to the start
- Recommended: Add a point every 50-100 pixels on straights, more in curves
```

### 2. JSON Map File Format Update
Add racing line data to the map JSON files:

```json
{
  "name": "beach",
  "width": 1536,
  "height": 1024,
  "background": "assets/beach.png",
  
  // NEW: Racing line definition
  "racingLine": {
    "points": [
      {"x": 400, "y": 500},  // Start/finish area
      {"x": 450, "y": 500},
      {"x": 500, "y": 480},
      {"x": 550, "y": 450},
      // ... many more points forming a complete loop
      {"x": 380, "y": 500}   // Back near start
    ],
    "totalLength": 4567.89  // Pre-calculated total line length
  },
  
  // Existing data...
  "walls": [...],
  "checkpoints": [...],
  "finishLine": {...}
}
```

### 3. Server-Side Implementation

#### Player Class Updates
```javascript
class Player {
    constructor() {
        // ... existing properties
        this.trackProgress = 0;       // Total distance traveled
        this.currentSegment = 0;      // Which segment of racing line
        this.segmentProgress = 0;     // Progress within current segment (0-1)
    }
}
```

#### Track Progress Calculation
```javascript
calculateTrackProgress(player, racingLine) {
    // Find the closest segment of the racing line
    let closestSegment = -1;
    let closestDistance = Infinity;
    let closestPoint = null;
    
    // Check each segment of the racing line
    for (let i = 0; i < racingLine.points.length - 1; i++) {
        const p1 = racingLine.points[i];
        const p2 = racingLine.points[i + 1];
        
        // Find closest point on this segment
        const closest = getClosestPointOnSegment(
            player.x, player.y, p1.x, p1.y, p2.x, p2.y
        );
        
        const dist = distance(player.x, player.y, closest.x, closest.y);
        if (dist < closestDistance) {
            closestDistance = dist;
            closestSegment = i;
            closestPoint = closest;
        }
    }
    
    // Calculate progress along the segment (0 to 1)
    const segmentLength = distance(
        racingLine.points[closestSegment],
        racingLine.points[closestSegment + 1]
    );
    const progressOnSegment = distance(
        racingLine.points[closestSegment],
        closestPoint
    ) / segmentLength;
    
    // Calculate total progress
    const segmentStartDistance = racingLine.segmentDistances[closestSegment];
    const currentLapProgress = segmentStartDistance + (segmentLength * progressOnSegment);
    
    // Total progress includes completed laps
    player.trackProgress = (player.lap * racingLine.totalLength) + currentLapProgress;
    player.currentSegment = closestSegment;
    player.segmentProgress = progressOnSegment;
}
```

#### Position Update
```javascript
updatePositions() {
    const activePlayers = Array.from(this.players.values())
        .filter(p => !p.finished && p.hasPassedStartLine);
    
    // Calculate track progress for each player
    activePlayers.forEach(player => {
        this.calculateTrackProgress(player, trackData.racingLine);
    });
    
    // Sort by track progress (higher = further ahead)
    activePlayers.sort((a, b) => b.trackProgress - a.trackProgress);
    
    // Assign positions
    activePlayers.forEach((player, index) => {
        player.position = index + 1;
    });
    
    // Handle finished players separately (keep their finish positions)
}
```

### 4. Pre-processing Racing Line Data
When loading a map, pre-calculate distances:

```javascript
function preprocessRacingLine(racingLine) {
    racingLine.segmentDistances = [0];
    let totalDistance = 0;
    
    for (let i = 0; i < racingLine.points.length - 1; i++) {
        const dist = distance(
            racingLine.points[i],
            racingLine.points[i + 1]
        );
        totalDistance += dist;
        racingLine.segmentDistances.push(totalDistance);
    }
    
    racingLine.totalLength = totalDistance;
}
```

### 5. Benefits of This System
- **Precise positions**: Accurate to within a few pixels
- **Real-time updates**: Positions update smoothly as players move
- **Fair overtaking**: Position changes immediately when one player passes another
- **Works with any track layout**: Circular, figure-8, complex shapes
- **Checkpoint compatibility**: Can still use checkpoints for validation

### 6. Migration Plan
1. Update map editor to support racing line drawing
2. Add racing lines to existing maps
3. Update server code to use new position system
4. Keep checkpoint system for anti-cheat validation
5. Test thoroughly with multiple players

### 7. Visualization (Optional)
For debugging, you could:
- Show the racing line in spectator mode
- Display each player's closest point on the line
- Show segment numbers and progress values

## Visual Example of Position Calculation

```
TOP-DOWN TRACK VIEW:
====================

Start/Finish Line
      ↓
███████████████████████████████████████████████
█     |                                       █
█  1  2  3 <- Starting positions              █
█     ↓                                       █
█     •——————•——————•——————•                  █ 
█    /1️⃣              2️⃣    \                 █
█   •                      •——————•           █
█   |                              \          █
█   | Player 1 ahead even though   •         █
█   | Player 2 is "higher" on map  |         █
█   •                              •         █
█    \                            /          █
█     •——————•——————•——————•——————•           █
█                                             █
███████████████████████████████████████████████

Racing Line Progress:
- Player 1️⃣: 45% of lap complete (position: 1st)
- Player 2️⃣: 38% of lap complete (position: 2nd)

Even though Player 2 appears "ahead" visually,
Player 1 has traveled further along the racing line!
```

## Common Scenarios

### Shortcuts/Cutting Corners
```
Normal Path:  •——————•——————•
              /             \
Player: 🏎️--------------------> (Cutting)
```
- Player is projected to nearest racing line point
- No advantage gained from cutting (same progress %)
- Walls prevent extreme cutting anyway

### Wide Racing Lines
```
Racing Line:    •————————•
                    ↑
          🏎️ ←------┘ (Player taking wide line)
```
- Player still tracked accurately
- Position based on forward progress, not lateral position

## Next Steps
1. Add `map_editor.py` to the repository
2. Implement racing line drawing tool with:
   - Direction arrows while drawing
   - Point density visualization
   - Ability to reverse direction if needed
3. Update existing maps with racing lines
4. Implement the server-side position tracking
5. Test with various racing scenarios

This system will provide much more accurate real-time positions, especially important for close racing and photo finishes!