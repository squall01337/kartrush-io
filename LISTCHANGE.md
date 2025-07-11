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

## Session Changes (Last Updated: 2025-07-11)

### Gameplay Updates
- **Explosion Fix**: Fixed explosion sprite for bombs/grenades
- **Rocket Fix**: Corrected rocket sprite orientation and effects
- **Boost Mechanics**: Reduced turn rate to 60% when boosting
- **Healthpack Item**: New item that restores 50 HP (45% drop rate)
- **Drift Boost Balance**: Level 3 now requires 2.0s (was 1.5s), gives 145% speed

### Visual Improvements  
- **Drift Effects**: Tier-specific visuals (blue sparks, orange flames, purple intense)
- **Speed Boost Colors**: Green for pads, blue/orange/purple for drift boosts
- **Counter-Steer Jump**: 40% scale effect with shadow separation
- **Item Notifications**: 2-second popup when receiving items

### UI/UX Changes
- **HUD Sizes**: Item slot 70x70px, health bar 200x25px
- **Lobby Layout**: Map selector on right, visible to all (host-only control)
- **Menu Reorganization**: Public/private sections side-by-side
- **Custom Alerts**: Replaced browser alerts with styled modals

### Multiplayer Features
- **Room Browser**: Shows public rooms with pagination (5 per page)
- **Quick Match**: Auto-joins most populated room
- **Kick System**: Host can kick players (3 kicks = ban)
- **Lobby Chat**: Real-time chat with 100 char limit
- **Color System**: No duplicate colors allowed in room

### Map System
- **Random Map**: Default option with "?" icon, chosen at game start
- **Thumbnails**: 3:2 aspect ratio, various sizes for different screens
- **Replay Fixes**: Fixed menu button conflicts and map mixing

### Technical Changes
- **Socket Cleanup**: Removed redundant events, added `createPublicRoom`
- **API Endpoint**: `/api/rooms` lists public rooms
- **Drift Mechanics**: Mario Kart style with 3-tier boost system

### Drift Visual Effects Overhaul
- Completely redesigned drift visual effects with tier-specific appearances:
  - **Blue (Mini-turbo)**: Classic blue sparks with trails
  - **Orange (Super mini-turbo)**: Flame-like particles
  - **Purple (Ultra mini-turbo)**: Intense purple sparks (removed lightning effect)
- Added dynamic drift trail that flows behind kart
- Removed circular aura effect from drifting
- Added colored smoke/trail effects matching drift charge level

### Speed Boost Visual Update
- Speed boost aura now changes color based on boost type:
  - **Green**: Regular boost pads
  - **Blue**: Level 1 drift boost
  - **Orange**: Level 2 drift boost  
  - **Purple**: Level 3 drift boost
- Removed glow aura from speed boosts (only particles and trails)
- Fixed server to send boostLevel to client for proper color detection

### Counter-Steer Jump Visual Effect
- Added visual jump effect when counter-steering during drift
- Kart scales up 40% when jumping (simulating height)
- Shadow appears and separates from kart during jump
- Shadow only visible during jump, not during normal driving
- White ring effect at peak of jump
- Takeoff and landing particle effects
- Uses counterSteerJump value from server (0-1.035)

### Level 3 Drift Boost Balance
- Increased time requirement: 2.0 seconds (was 1.5)
- Increased boost duration: 1.5 seconds (was 1.3)
- Increased max speed: 145% (was 135%)
- Increased initial impulse: +2.0 (was +1.6)
- Makes purple boost harder to achieve but more rewarding

### Poison Slick Item (New)
- **Effect**: Drops a toxic puddle that slows players to 30% speed and deals damage over time
- **Duration**: Puddle stays on track for 10 seconds
- **Damage**: 5 HP every 500ms while poisoned
- **Poison Duration**: 1 second after leaving the puddle
- **Drop Rate**: 12% (balanced with other items)
- **Visual**: Purple/green puddle using sprite from items_icons.png (bottom-mid position)
- **Audio**: slick_dropping.mp3 when used, slick_crossing.mp3 when hit
- **Mechanics**: 
  - Drops 50 pixels behind the kart
  - Owner has 1.5 second immunity to prevent self-damage
  - Aggressive slowdown with extra friction while in puddle
  - Purple screen flash and damage numbers when poisoned

### Racing Line Position System (Updated)
- **Precise Position Tracking**: Real-time position calculation based on distance along racing line
- **Map Editor Tool**: New "🏎️ Ligne de course" button to draw racing lines
- **Visual Feedback**: Click-to-close system like continuous curves, shows closing preview
- **Server Integration**: Automatic position updates using racing line when available
- **Fallback System**: Uses checkpoint-based positioning if no racing line exists
- **No Duplicate Points**: Closed loops don't store duplicate first point
- **JSON Export**: Racing line data included in map files with proper formatting
- **Wrong Way Handling**: New `wrongWayCrossing` flag system prevents exploits
  - Crossing finish line backwards sets flag (no lap change)
  - Position penalty applied through track progress calculation
  - Crossing forward again clears the penalty smoothly
  - No position flickering or sudden jumps
- **Respawn Fix**: Players with checkpoints who respawn behind start line maintain race status
- **Smooth Transitions**: Position changes based on actual track progress, not hard penalties