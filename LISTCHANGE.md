# KartRush.io Change Log

## Context Reset Prompt
When starting a new session, ask these questions to quickly understand the project:
1. "What does this project do?"
2. "What technologies does this project use?"
3. "Where is the main entry point?"
4. "Explain the folder structure"

## Project Overview (Quick Reference)
**What it does**: KartRush.io is a real-time multiplayer kart racing game with:
- Room-based multiplayer (public/private)
- Multiple maps with different themes
- Power-up system (bombs, rockets, boost, healthpack)
- Collision physics and HP system
- Lap-based racing with checkpoints

**Technologies**:
- Backend: Node.js, Express.js, Socket.io, UUID
- Frontend: Vanilla JavaScript, HTML5 Canvas, CSS3
- No frameworks - pure JavaScript for performance
- WebSocket for real-time communication

**Main Entry Points**:
- Backend: `/backend/server.js` (runs on port 3000)
- Frontend: `/frontend/index.html` + `/frontend/js/client.js`

**Folder Structure**:
```
/root/kartrush-io/
├── assets/           # Images, audio files, sprites
│   ├── audio/       # Sound effects and music
│   └── *.png        # Sprites and backgrounds
├── backend/         # Server-side code
│   ├── server.js    # Main server file
│   └── package.json
├── frontend/        # Client-side code
│   ├── index.html   # Main HTML
│   ├── style.css    # Styling
│   └── js/          # JavaScript files
│       ├── client.js    # Main client entry
│       ├── game.js      # Game engine
│       ├── assets.js    # Asset management
│       └── soundManager.js
├── maps/            # JSON map definitions
└── ecosystem.config.js  # PM2 configuration
```

## Session Changes (Last Updated: 2025-07-09)

### Explosion System Fix
- Fixed explosion sprite not showing for grenades/bombs
- Added `projectileExploded` event listener in `frontend/js/game.js`
- Modified `renderExplosion` to use `explosion.png` sprite
- Explosion sprite grows from 50% to 100% size and fades out

### Rocket Sprite Orientation Fix  
- Fixed rocket sprite orientation (was facing left when shooting up)
- Added `+ Math.PI / 2` rotation to `renderRocket` method
- Adjusted flame/smoke effects to appear behind rocket (bottom position)

### Turn Rate Reduction for Boosts
- Reduced turn rate to 60% (0.6 multiplier) when ANY boost is active
- Applies to: boost pads (level 1, 2, 3) AND super boost item
- Modified `turnLeft` and `turnRight` methods in `backend/server.js`
- Check for `this.isBoosting || this.isSuperBoosting`

### Healthpack Item Implementation
- Added new item type: healthpack (restores 50 HP)
- Uses separate sprite: `assets/healthpack.png` (64x64)
- Drop rates: Healthpack 45%, Bomb 25%, Rocket 20%, Superboost 10%
- Added `useHealthpack` method in `backend/server.js`
- Added healthpack sprite loading in `frontend/js/game.js`
- Updated `getItemIcon` to handle healthpack separately
- Added to item slot animation array
- Created green healing particle effects (particles + crosses)
- Uses `respawn.mp3` sound when used
- Socket event: `healthpackUsed` with position data

### Sprite Sizes in HUD
- Item slot: 70x70px container, 50x50px icon
- Health bar: 200x25px
- Player info box: 220x85px
- All multiplied by `this.scale` (canvas.width / 1536)

### Lobby Layout Changes
- Moved map selector to right side of lobby (side-by-side with player info)
- Map selector now visible to all players but only interactive for host
- Non-hosts see opacity 0.7 and "Only host can select" message
- Added CSS wrapper `.lobby-content-wrapper` with flexbox layout

### Menu Page Reorganization
- Public and Private room sections now side-by-side
- Button text changes:
  - "Join a game" → "Join a room"
  - "Create a private room" → "Create a room"
- Room code input moved UNDER "Join with code" button
- Room code input width reduced to 120px for 6 characters
- Placeholder changed from "ROOM CODE" to "CODE"
- Section width increased to 400px max to prevent text wrapping
- All buttons set to consistent 200px width

### Public Room Browser System
- Added API endpoint `/api/rooms` to list public rooms
- Public rooms section now has two buttons:
  - "Join a room" - Opens room browser to see available rooms
  - "Create a room" - Creates a new public room
- New room browser screen shows:
  - Host name
  - Selected map
  - Current players (X/6)
  - Join button for each room
- Room browser features:
  - Refresh button to update list
  - Back button to return to menu
  - Create room button in browser
- Public rooms can still be joined via code system
- Private rooms are not shown in the API/browser
- Maximum 6 players per room (as requested)