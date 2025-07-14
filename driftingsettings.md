# Drift System Settings

This file contains different drift behavior configurations for easy switching.

## Method 1: Auto-Curve Drift (Current - Mario Kart Style)

When no directional input is pressed during drift, the kart continues to turn gently in the drift direction.

```javascript
// In updateDrift() method around line 1019
// Apply rotation based on input
if (!isCounterSteering) {
    // Not counter-steering, allow normal rotation
    if (this.inputs.left) {
        this.driftRotation -= rotationSpeed * deltaTime;
    } else if (this.inputs.right) {
        this.driftRotation += rotationSpeed * deltaTime;
    } else {
        // No input - continue drifting in the initial direction (Mario Kart style)
        // Use a slower rotation speed for the automatic drift
        const autoDriftSpeed = rotationSpeed * 0.35; // 35% of normal rotation speed - gentle curve
        this.driftRotation += this.driftDirection * autoDriftSpeed * deltaTime;
    }
}
// If counter-steering, rotation is blocked (maintains current angle)
```

### Behavior:
- **No input**: Gentle automatic curve (35% rotation speed)
- **Drift direction input**: Tightens the turn
- **Counter-steer**: Maintains angle with jump effect
- **Feel**: Natural, flowing curves like Mario Kart

### Adjustments:
- Change `0.35` to higher values (e.g., `0.5`, `0.6`) for tighter auto-curves
- Change to lower values (e.g., `0.2`, `0.25`) for even gentler curves

---

## Method 2: Classic Drift (Old - Manual Control Only)

When no directional input is pressed during drift, the kart maintains its current angle (goes straight).

```javascript
// In updateDrift() method around line 1019
// Apply rotation based on input
if (!isCounterSteering) {
    // Not counter-steering, allow normal rotation
    if (this.inputs.left) {
        this.driftRotation -= rotationSpeed * deltaTime;
    }
    if (this.inputs.right) {
        this.driftRotation += rotationSpeed * deltaTime;
    }
}
// If counter-steering, rotation is blocked (maintains current angle)
```

### Behavior:
- **No input**: Kart goes straight (maintains current drift angle)
- **Drift direction input**: Turns in that direction
- **Counter-steer**: Maintains angle with jump effect
- **Feel**: Full manual control, no automatic movement

---

## How to Switch

1. Locate the `updateDrift()` method in `/backend/server.js` (around line 978)
2. Find the rotation input handling section (around line 1019)
3. Replace the code block with your preferred method
4. Save and restart the server

## Notes

- Both methods maintain the counter-steer jump mechanic with 500ms cooldown
- The drift charge system (blue/orange/purple) works the same in both methods
- Speed reduction and boost interactions remain unchanged
- The only difference is the behavior when no directional input is pressed during drift