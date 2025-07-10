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

### Room Browser UI Improvements
- Room entries now display in single-line format
- Added pagination system (5 rooms per page)
- Previous/Next navigation buttons
- Page counter shows current page
- Increased room list height to properly show 5 rooms
- Map thumbnails added to room entries (90x55px)
- Balanced spacing between all elements

### Socket Events Cleanup
- Removed redundant `joinGame` socket event
- Removed unused `findAvailableRoom` function
- Added new `createPublicRoom` event that always creates a new public room
- Current socket events:
  - `createPublicRoom` - Always creates a new public room
  - `createRoom` - Creates a private room
  - `joinRoomWithCode` - Joins any room (public/private) with code

### Main Menu Updates
- Fixed vertical gap between public room buttons to match private room section
- Switched order: "Create a room" now appears before "Join a room"
- Added "Quick match" button that joins the most populated (but not full) room
- Quick match creates a new room if none available

### Room Browser Design Updates
- Increased thumbnail size to 90x55px
- Fixed spacing: host name left-aligned, join button right-aligned
- Map name and thumbnail centered with player count positioned between thumbnail and join button
- All elements have consistent 25px spacing
- Removed "Create a room" button from browser (already in main menu)
- Styled refresh and back buttons to match game design

### Custom Alert System
- Replaced browser alerts with custom styled modal
- Dark theme with blur backdrop
- Gradient OK button matching game style
- Smooth slide-in animation
- Click overlay or OK button to close

### Kart Color System
- Players cannot choose the same color in a lobby
- Server automatically assigns first available color when joining
- 6 available colors: red, green, blue, yellow, magenta, cyan
- Taken colors show as unavailable (30% opacity) in color selector
- Cannot click on taken colors
- Server validates color changes and reverts if color is taken
- Client updates selected color to match server-assigned color
- Added `changeColor` socket event for color changes
- Added `colorNotAvailable` event when color is already taken

### Random Map Selection Feature
- Added "Random" as first option in map selector with "?" icon
- Purple gradient background with pulsing animation for random option
- Random is now the default selection when creating a room
- When "Random" is selected in lobby:
  - Players see "Random" in the selected map display
  - Actual map is only chosen when game starts
  - Server randomly picks from available maps (beach, night_city)
- Loading screen behavior:
  - Initially shows "Random Map..." with "?" when random selected
  - Updates to show actual map name/thumbnail once received
- Server includes `mapId` in `mapData` and `gameStarted` events
- Updated all default map references from 'lava_track' to 'beach'
- Non-host players get notification when map selection changes

### Map Thumbnail Adjustments
- Updated all map thumbnails to 3:2 aspect ratio (matching 1536x1024 maps)
- Map selector thumbnails: 90px height
- Room browser thumbnails: 90x60px (3:2 ratio)
- Loading screen thumbnail: 300x200px (3:2 ratio)
- Removed unnecessary `selectedMapInfo` div from lobby
- Increased map selector width (450-600px) for better display
- Reduced player list width (300-400px) to give more space to map selector
- Fixed loading screen thumbnail centering:
  - Changed from `background-size: cover` to `contain`
  - Added black background color
  - Ensures full image visibility without cropping

### Replay System Fixes
- Fixed "Return to menu" button in replay window (was conflicting with room browser button)
- Fixed map config mixing issue when random map selects different map after replay
- Added `actualMapId` tracking to properly handle random map selection
- Map data is now only loaded once to prevent conflicts

### Kick System Implementation
- Added kick functionality for room hosts
- Red X button appears next to player names (host can't kick themselves)
- Kick tracking: players kicked 3 times are banned from that specific room
- Custom confirmation dialog for kick action
- Visual feedback for kicked players and other room members
- Banned players cannot rejoin the room via room code

### Lobby Chat System
- Added real-time chat to the right of map selector in lobby
- Chat messages show player names in their kart colors
- System messages for player join/leave events
- Send button replaced with arrow icon (➤)
- Auto-scroll to latest messages
- Chat clears when joining a new room
- 100 character message limit

### Drift Mechanic (Final Version)
- Hold Shift to activate drift when moving at 30%+ speed
- Direction locked based on turn direction when drift starts
- While drifting:
  - Immediate speed reduction to 45% when starting drift
  - Kart sprite rotates at 3.2 rad/s in drift direction
  - Movement curves significantly towards facing direction (45% curve factor)
  - Outward drift inertia pushes kart to the outside of the turn
  - Inertia force increases over time (simulating centrifugal force)
  - Max rotation limited to 90° for better control
  - 50% turn rate reduction
  - Continuous speed reduction (caps at 25% of max speed)
- Release Shift to boost:
  - Single boost level (1 second duration)
  - Requires minimum 200ms drift to activate boost
  - Kart moves fully in new facing direction after boost
- Visual effects:
  - Blue/white spark trails appear after 500ms
  - Tire smoke effects with intensity based on drift duration
  - Ground glow effect
  - Shadow blur increases with drift duration