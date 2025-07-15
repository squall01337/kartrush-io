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

### Direction-Based Wrong Way Detection (Enhanced)
- **Instant Detection**: Compares player's facing direction with racing line direction
- **Works at Lap 0**: Detection now works even before crossing finish line for first time
- **Vector-Based**: Uses dot product of player direction vs racing line segment direction
- **Threshold System**: Triggers when facing > 90° from correct direction (dot < -0.1)
- **Speed Check**: Only activates when moving (speed > 0.5) to avoid false positives
- **2-Second Alert Delay**: Alert shows after 2 seconds of wrong way driving to prevent false positives
- **Replaces Progress-Based System**: More accurate than old system that waited for position loss

### Canvas-Based Wrong Way Alert (New)
- **Centered Display**: Alert appears in center of screen for maximum visibility
- **Purple Theme**: Uses game's signature purple gradient to match aesthetic
- **Subtle Pulsing**: 5% scale pulsing on box, text, and icons for attention
- **Warning Icons**: Dual warning triangles (⚠️) flanking the "WRONG WAY" text
- **Semi-Transparent Overlay**: Purple background overlay with pulsing effect
- **1-Second Hide Delay**: Alert stays visible for 1 second after correcting direction
- **Replaces HTML Alert**: No more DOM-based alerts, everything rendered on canvas
- **Consistent Styling**: Matches lap notification visual style with rounded corners and glow

### Lightning Item (New)
- **Effect**: Stuns and slows all players ahead of the user
- **Stun Duration**: 1 second (players cannot move or use items)
- **Speed Reduction**: 50% speed for 7 seconds after stun
- **Visual Effects**: 
  - Lightning sprite appears on all affected players
  - Blue circle aura shows speed reduction
  - Yellow screen flash for affected players
- **Drop Rate**: Currently set to 16.67% for testing (equal with other items)
- **Bug Fix**: Fixed issue where lightning sprite only appeared on one player instead of all affected players

### Code Cleanup
- **Removed Unused Variables**: Cleaned up `closestPoint` and `elapsed` variables
- **Removed Redundant Notifications**: No more yellow "Wrong way!" popup when crossing finish backwards
- **Removed Checkpoint Notifications**: No more "Il vous reste X checkpoints" messages
- **Streamlined Detection**: Single direction-based system handles all wrong way scenarios
- **Fixed TypeScript Warning**: Removed unused `isInitialPosition` parameter from `calculateTrackProgress`

### Rocket Racing Line Following (New)
- **Smart Trajectory**: Rockets now follow the racing line before targeting players
- **Two-Phase System**: 
  - Phase 1: Follow racing line to avoid walls (blue glow indicator)
  - Phase 2: Target acquisition when within 300 pixels AND line of sight (red glow indicator)
- **Enhanced Line of Sight**: 
  - Initial check: If target visible at launch, skip racing line entirely
  - Continuous monitoring: Returns to racing line if line of sight is lost
  - Prevents wall collisions on parallel track sections
- **No Distance Limit**: Rockets follow racing line for their entire 3.5-second lifetime
  - Similar to Mario Kart red shells behavior
- **Smooth Navigation**: Rockets navigate around corners using racing line segments
- **Clean Visual**: No additional indicators, just the rocket sprite and effects
- **Same Damage/Explosion**: All existing rocket mechanics remain unchanged
- **Fallback Behavior**: Works normally on maps without racing lines

### Void Zone Mechanic (New)
- **Map Editor Support**: New "🕳️ Zone de vide" button to draw void zones (like lava pits or cliffs)
- **Invisible Hazards**: Void zones are not visually rendered in-game, only in map editor
- **Falling Animation (Updated)**: 
  - Kart starts at 55% size to eliminate "jump" feeling, shrinks to 10% over 1.5 seconds
  - No rotation for first 0.1 seconds, then spins 2 full turns
  - Expanding dark void shadow effect (30-130 radius) rendered between track and karts
  - Falling sound effect plays for all players
- **Momentum-Based Physics (Refined)**: 
  - Players maintain their velocity when falling (diagonal trajectory)
  - Subtle momentum multiplier: 0.5-1x based on speed (was 3-10x)
  - Natural falling physics without excessive drift
  - Realistic movement preserved without visual artifacts
- **Death Mechanics**:
  - Instant death after 1.5 seconds of falling (no HP damage)
  - 2-second respawn delay after death (total 3.5s penalty)
  - Player loses item when falling
- **Server Sync**: Falling state properly synchronized between server and all clients
- **Map Integration**: Void zones stored in map JSON with closed polygon format
- **Collision Detection (Improved)**: 
  - Multi-point detection system checks 9 points around kart perimeter
  - Requires ~75% of kart (7 out of 9 points) inside void zone to trigger
  - More forgiving edge detection prevents accidental falls

### Ice Beam Item (New)
- **Effect**: Fires a straight beam that freezes players on contact
- **Mechanics**:
  - One-shot beam fired in player's facing direction
  - Starts 5 pixels in front of the kart
  - Effectively infinite range (5000px) until hitting a wall
  - Can freeze multiple players in the same trajectory
  - Frozen players slide in their current direction for 3 seconds
  - Frozen players cannot steer or control their kart
  - Hit detection radius: 40 pixels
- **Visual Effects**:
  - 3-part sprite system: base (bottom), core (stretchable middle), tip (top)
  - Beam width: 100 pixels
  - Beam grows at 25 pixels/frame
  - Gradual fade out effect as beam expires (0.8 second lifetime)
  - Ice overlay on frozen players with 65% opacity (ice.png)
  - Falls back to crystalline effect if ice.png missing
- **Drop Rate**: Currently 80% for testing (needs balancing)
- **Sprite Location**: Mid-mid position in items_icons.png grid (row 1, col 1)
- **Audio**: 
  - Firing: icebeam.mp3
  - Player frozen: frozen.mp3

### Bomb Size Update
- **Visual Size**: Increased by 15% (now 46x46 pixels, was 40x40)
- **Explosion Radius**: Increased by 15% (now 57.5 pixels, was 50)

### Side Force Item (New)
- **Effect**: Violently pushes all players on the sides with a curved lateral magnetic field
- **Detection**: 30-degree cone on each side, 250 pixel range
- **Push Force**: Very strong lateral force (500 units) perpendicular to caster's direction
- **Wall Collision**: Players pushed into walls take instant 50 damage and 1.5s stun
- **Visual Effects**: 
  - Purple curved magnetic waves expanding from both sides
  - Push motion lines on affected players
  - Purple screen flash for affected players
- **Drop Rate**: Currently 3% (was 80% for testing)
- **Sprite Location**: Bottom-right position in items_icons.png (row 2, col 2)
- **Audio**: sideforce.mp3 when used

### Rotor Shield Item (New)
- **Effect**: Creates a rotating shield orb that blocks 1 instance of damage/effect from items
- **Blocks**: All item damage and effects (bombs, rockets, ice beam freeze, lightning stun, poison, side force push)
- **Does NOT Block**: Kart collisions and wall collision damage
- **Duration**: Permanent until it blocks something
- **Visual Effects**:
  - Small shield orb rotating around the kart
  - Glowing trail effect as it orbits
  - Shield shatter particles when destroyed
  - "X BLOCKED!" text appears when blocking
- **Shield Mechanics**:
  - Only blocks damage/effects from items, not environmental hazards
  - Destroyed immediately after blocking one effect
  - Shows blue burst effect when destroyed
- **Drop Rate**: 3-5% depending on position (see Position-Based Item System)
- **Sprite Location**: Top-right position in items_icons.png (row 0, col 2)
- **Sound Effects**: 
  - Activation: shield.mp3
  - Block: shieldblock.mp3

### Position-Based Item Drop System (New)
- **Item distribution now depends on player position in the race**:
  
  **Last Place (6/6 with 3+ players):**
  - Bomb: 30%
  - Poison Slick: 20%
  - Rocket: 15%
  - Health Pack: 10%
  - Side Force: 7%
  - Ice Beam: 6%
  - Rotor Shield: 5%
  - Lightning: 4%
  - Super Boost: 3% (VERY RARE - Last place exclusive)
  
  **5th-6th Place (with 4+ players):**
  - Bomb: 30%
  - Poison Slick: 20%
  - Rocket: 15%
  - Health Pack: 10%
  - Side Force: 8%
  - Ice Beam: 7%
  - Rotor Shield: 5%
  - Lightning: 5% (Catchup item)
  - Super Boost: 0% (Not available)
  
  **1st-4th Place (or when not enough players):**
  - Bomb: 35% (MOST COMMON)
  - Poison Slick: 30% (MOST COMMON)
  - Rocket: 15% (2ND MOST COMMON)
  - Health Pack: 10% (2ND MOST COMMON)
  - Side Force: 4% (LESS COMMON)
  - Ice Beam: 3% (LESS COMMON)
  - Rotor Shield: 3% (LESS COMMON)
  - Lightning: 0% (Not available)
  - Super Boost: 0% (Not available)

- **Catchup items** (Lightning & Super Boost) are only available to players in back positions
- **Super Boost** is exclusive to last place and extremely rare (3% chance)
- **Lightning** is available to 5th and 6th place players only

### Grace Period at Race Start (New)
- **2-second damage immunity** after "GO!" appears
- During grace period:
  - No damage from any source (projectiles, collisions, items)
  - No stun, freeze, or push effects
  - No speed reduction effects
  - Players can still collect and use items
  - Shields can still be consumed if they block something
- Prevents unfair damage in crowded starting area