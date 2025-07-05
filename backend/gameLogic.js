// gameLogic.js - Gestion de la logique de jeu (physique, collisions, progression)

const GAME_CONFIG = {
    MAX_PLAYERS_PER_ROOM: 8,
    MIN_PLAYERS_TO_START: 1,
    TICK_RATE: 60,
    TRACK_WIDTH: 1280,
    TRACK_HEIGHT: 720,
    KART_SIZE: 20,
    MAX_SPEED: 4,
    ACCELERATION: 0.2,
    FRICTION: 0.98,
    TURN_SPEED: 0.075,
    COLLISION_GRID_SIZE: 100
};

class Player {
    constructor(id, pseudo, color) {
        this.id = id;
        this.pseudo = pseudo;
        this.color = color;
        this.x = 100;
        this.y = 300;
        this.angle = 0;
        this.speed = 0;
        this.lap = 0;
        this.position = 1;
        this.item = null;
        this.nextCheckpoint = 0;
        this.hasPassedStartLine = false;
        this.raceTime = 0;
        this.finishTime = null;
        this.finished = false;
        this.ready = false;
        this.isHost = false;
        
        this.lastX = this.x;
        this.lastY = this.y;
        
        this.lastCheckpointTime = {};
        this.lastFinishLineTime = 0;
        
        this.inputs = {
            up: false,
            down: false,
            left: false,
            right: false
        };
        
        this.isBoosting = false;
        this.boostEndTime = 0;
        this.lastBoosterIndex = -1;
        this.boostCooldown = 0;
        this.boostLevel = 0;
    }

    update(deltaTime) {
        this.lastX = this.x;
        this.lastY = this.y;
        
        if (this.isBoosting && Date.now() > this.boostEndTime) {
            this.isBoosting = false;
            this.boostLevel = 0;
        }
        
        if (this.boostCooldown > 0) {
            this.boostCooldown -= deltaTime * 1000;
        }
        
        if (this.inputs.up) this.accelerate();
        if (this.inputs.down) this.brake();
        if (this.inputs.left) this.turnLeft();
        if (this.inputs.right) this.turnRight();
        
        if (this.inputs.up && this.speed > 0) {
            this.speed *= GAME_CONFIG.FRICTION + 0.01;
        } else if (this.inputs.down && this.speed < 0) {
            this.speed *= GAME_CONFIG.FRICTION + 0.01;
        } else {
            this.speed *= GAME_CONFIG.FRICTION - 0.02;
        }
        
        let maxSpeedLimit = GAME_CONFIG.MAX_SPEED;
        if (this.isBoosting) {
            switch(this.boostLevel) {
                case 1: maxSpeedLimit *= 1.25; break;
                case 2: maxSpeedLimit *= 1.50; break;
                case 3: maxSpeedLimit *= 1.75; break;
            }
        }
        
        if (this.speed > maxSpeedLimit) {
            this.speed = maxSpeedLimit;
        } else if (this.speed < -GAME_CONFIG.MAX_SPEED * 0.5) {
            this.speed = -GAME_CONFIG.MAX_SPEED * 0.5;
        }
        
        if (Math.abs(this.speed) < 0.1) {
            this.speed = 0;
        }
        
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        
        this.x = Math.max(GAME_CONFIG.KART_SIZE, Math.min(GAME_CONFIG.TRACK_WIDTH - GAME_CONFIG.KART_SIZE, this.x));
        this.y = Math.max(GAME_CONFIG.KART_SIZE, Math.min(GAME_CONFIG.TRACK_HEIGHT - GAME_CONFIG.KART_SIZE, this.y));
    }

    accelerate() {
        let speedMultiplier = 1.0;
        if (this.isBoosting) {
            switch(this.boostLevel) {
                case 1: speedMultiplier = 1.25; break;
                case 2: speedMultiplier = 1.50; break;
                case 3: speedMultiplier = 1.75; break;
                default: speedMultiplier = 1.25; break;
            }
        }
        
        const maxSpeed = GAME_CONFIG.MAX_SPEED * speedMultiplier;
        const acceleration = this.isBoosting ? GAME_CONFIG.ACCELERATION * 1.5 : GAME_CONFIG.ACCELERATION;
        
        this.speed = Math.min(this.speed + acceleration, maxSpeed);
        
        if (this.speed > maxSpeed * 0.98) {
            this.speed = maxSpeed;
        }
    }
    
    brake() {
        if (this.speed > 0) {
            this.speed = Math.max(0, this.speed - GAME_CONFIG.ACCELERATION * 2);
        } else {
            this.speed = Math.max(this.speed - GAME_CONFIG.ACCELERATION, -GAME_CONFIG.MAX_SPEED * 0.5);
        }
    }

    turnLeft() {
        if (Math.abs(this.speed) > 0.1) {
            this.angle -= GAME_CONFIG.TURN_SPEED * (this.speed / GAME_CONFIG.MAX_SPEED);
        }
    }

    turnRight() {
        if (Math.abs(this.speed) > 0.1) {
            this.angle += GAME_CONFIG.TURN_SPEED * (this.speed / GAME_CONFIG.MAX_SPEED);
        }
    }
}

// Fonctions de collision et de détection
function checkWallCollisions(player, trackData) {
    const kx = player.x;
    const ky = player.y;
    const radius = GAME_CONFIG.KART_SIZE;
    const minDist = radius + 4;
    const minDistSq = minDist * minDist;

    const prevX = player.x;
    const prevY = player.y;

    for (const curve of trackData.continuousCurves || []) {
        const points = curve.points;
        const len = points.length;
        const segmentCount = curve.closed ? len : len - 1;

        for (let i = 0; i < segmentCount; i++) {
            const [x1, y1] = points[i];
            const nextIndex = curve.closed ? ((i + 1) % len) : (i + 1);
            const [x2, y2] = points[nextIndex];

            const dx = x2 - x1;
            const dy = y2 - y1;
            const segLenSq = dx * dx + dy * dy;
            if (segLenSq === 0) continue;

            let t = ((kx - x1) * dx + (ky - y1) * dy) / segLenSq;
            t = Math.max(0, Math.min(1, t));

            const closestX = x1 + t * dx;
            const closestY = y1 + t * dy;

            const distX = kx - closestX;
            const distY = ky - closestY;
            const distSq = distX * distX + distY * distY;

            if (distSq < minDistSq) {
                const dist = Math.sqrt(distSq) || 0.001;
                const nx = distX / dist;
                const ny = distY / dist;

                const penetration = minDist - dist;
                player.x += nx * (penetration + 2);
                player.y += ny * (penetration + 2);

                const vx = Math.cos(player.angle) * player.speed;
                const vy = Math.sin(player.angle) * player.speed;
                
                const dot = vx * nx + vy * ny;
                
                const wallLength = Math.sqrt(dx * dx + dy * dy);
                const wallDirX = dx / wallLength;
                const wallDirY = dy / wallLength;
                
                const playerDirX = Math.cos(player.angle);
                const playerDirY = Math.sin(player.angle);
                const wallDot = Math.abs(playerDirX * wallDirX + playerDirY * wallDirY);

                if (dot < -0.5 && wallDot < 0.5) {
                    player.speed *= -0.2;
                    player.x += nx * 8;
                    player.y += ny * 8;
                    player.angle += (Math.random() - 0.5) * 0.2;
                } else if (Math.abs(dot) < 0.7) {
                    const velocityAlongWall = vx * wallDirX + vy * wallDirY;
                    const newVx = wallDirX * velocityAlongWall * 0.85;
                    const newVy = wallDirY * velocityAlongWall * 0.85;
                    
                    player.speed = Math.sqrt(newVx * newVx + newVy * newVy);
                    
                    if (player.speed > 0.1) {
                        const targetAngle = Math.atan2(newVy, newVx);
                        const angleDiff = targetAngle - player.angle;
                        
                        let normalizedDiff = angleDiff;
                        while (normalizedDiff > Math.PI) normalizedDiff -= 2 * Math.PI;
                        while (normalizedDiff < -Math.PI) normalizedDiff += 2 * Math.PI;
                        
                        player.angle += normalizedDiff * 0.3;
                    }
                } else {
                    player.speed *= 0.95;
                }
                
                const finalDistX = player.x - closestX;
                const finalDistY = player.y - closestY;
                const finalDistSq = finalDistX * finalDistX + finalDistY * finalDistY;
                
                if (finalDistSq < minDistSq) {
                    const pushDist = Math.sqrt(minDistSq) + 2;
                    player.x = closestX + (finalDistX / Math.sqrt(finalDistSq)) * pushDist;
                    player.y = closestY + (finalDistY / Math.sqrt(finalDistSq)) * pushDist;
                }
                
                if (Math.abs(player.speed) < 0.5 && Math.abs(player.speed) > 0) {
                    player.speed = 0;
                }
                
                break;
            }
        }
    }
}

function checkPlayerCollisions(players) {
    const activePlayers = Array.from(players).filter(p => !p.finished);
    
    for (let i = 0; i < activePlayers.length; i++) {
        for (let j = i + 1; j < activePlayers.length; j++) {
            const player1 = activePlayers[i];
            const player2 = activePlayers[j];
            
            const dx = player2.x - player1.x;
            const dy = player2.y - player1.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const collisionRadius = GAME_CONFIG.KART_SIZE;
            
            if (distance < collisionRadius * 1.4) {
                resolvePlayerCollision(player1, player2, dx, dy, distance);
            }
        }
    }
}

function resolvePlayerCollision(player1, player2, dx, dy, distance) {
    if (distance === 0) {
        dx = 1;
        dy = 0;
        distance = 1;
    }
    
    const nx = dx / distance;
    const ny = dy / distance;
    
    const overlap = (GAME_CONFIG.KART_SIZE * 1.4) - distance;
    const separationX = nx * overlap * 0.5;
    const separationY = ny * overlap * 0.5;
    
    player1.x -= separationX;
    player1.y -= separationY;
    player2.x += separationX;
    player2.y += separationY;
    
    const relativeVelocityX = Math.cos(player2.angle) * player2.speed - Math.cos(player1.angle) * player1.speed;
    const relativeVelocityY = Math.sin(player2.angle) * player2.speed - Math.sin(player1.angle) * player1.speed;
    
    const relativeSpeed = relativeVelocityX * nx + relativeVelocityY * ny;
    
    if (relativeSpeed > 0) return;
    
    const restitution = 0.6;
    const impulse = -(1 + restitution) * relativeSpeed / 2;
    
    const impulseX = impulse * nx;
    const impulseY = impulse * ny;
    
    const speed1X = Math.cos(player1.angle) * player1.speed - impulseX;
    const speed1Y = Math.sin(player1.angle) * player1.speed - impulseY;
    const speed2X = Math.cos(player2.angle) * player2.speed + impulseX;
    const speed2Y = Math.sin(player2.angle) * player2.speed + impulseY;
    
    player1.speed = Math.sqrt(speed1X * speed1X + speed1Y * speed1Y) * Math.sign(player1.speed);
    player2.speed = Math.sqrt(speed2X * speed2X + speed2Y * speed2Y) * Math.sign(player2.speed);
    
    player1.speed = Math.max(-GAME_CONFIG.MAX_SPEED, Math.min(GAME_CONFIG.MAX_SPEED, player1.speed));
    player2.speed = Math.max(-GAME_CONFIG.MAX_SPEED, Math.min(GAME_CONFIG.MAX_SPEED, player2.speed));
    
    const rotationEffect = 0.1;
    player1.angle += (Math.random() - 0.5) * rotationEffect;
    player2.angle += (Math.random() - 0.5) * rotationEffect;
}

// Fonctions de boost
function checkBoosterCollisions(player, trackData, io) {
    if (!trackData || !trackData.boosters || player.boostCooldown > 0) return;
    
    const playerRadius = GAME_CONFIG.KART_SIZE;
    
    trackData.boosters.forEach((booster, index) => {
        if (index === player.lastBoosterIndex) return;
        
        const distToLine = pointToLineDistance(
            player.x, player.y,
            booster.x1, booster.y1,
            booster.x2, booster.y2
        );
        
        const boosterWidth = 5;
        
        if (distToLine < boosterWidth + playerRadius) {
            const projection = projectPointOnLine(
                player.x, player.y,
                booster.x1, booster.y1,
                booster.x2, booster.y2
            );
            
            if (projection.t >= 0 && projection.t <= 1) {
                activateBoost(player, io);
                player.lastBoosterIndex = index;
            }
        } else if (index === player.lastBoosterIndex && distToLine > boosterWidth * 2) {
            player.lastBoosterIndex = -1;
        }
    });
}

function activateBoost(player, io) {
    if (player.boostCooldown > 0) return;
    
    if (player.isBoosting) {
        player.boostLevel = Math.min(3, player.boostLevel + 1);
    } else {
        player.isBoosting = true;
        player.boostLevel = 1;
    }
    
    player.boostEndTime = Date.now() + 1500;
    player.boostCooldown = 500;
    
    const impulse = 1 + (player.boostLevel * 0.5);
    player.speed = Math.min(player.speed + impulse, GAME_CONFIG.MAX_SPEED * (1 + player.boostLevel * 0.25));
    
    io.to(player.id).emit('boostActivated', { level: player.boostLevel });
    
    console.log(`🚀 ${player.pseudo} - Boost niveau ${player.boostLevel} !`);
}

// Fonctions utilitaires
function pointToLineDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) {
        return Math.sqrt(A * A + B * B);
    }
    
    const param = dot / lenSq;
    
    let xx, yy;
    
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    
    const dx = px - xx;
    const dy = py - yy;
    
    return Math.sqrt(dx * dx + dy * dy);
}

function projectPointOnLine(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    
    if (lenSq === 0) {
        return { x: x1, y: y1, t: 0 };
    }
    
    const t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    
    return {
        x: x1 + t * dx,
        y: y1 + t * dy,
        t: t
    };
}

function lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    
    if (Math.abs(denom) < 0.0001) return false;
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function useItem(player, room) {
    switch (player.item) {
        case 'boost':
            player.speed = Math.min(player.speed + 3, GAME_CONFIG.MAX_SPEED * 1.5);
            break;
        case 'slow':
            for (let otherPlayer of room.players.values()) {
                if (otherPlayer.id !== player.id) {
                    otherPlayer.speed *= 0.5;
                }
            }
            break;
    }
    player.item = null;
}

module.exports = {
    GAME_CONFIG,
    Player,
    checkWallCollisions,
    checkPlayerCollisions,
    checkBoosterCollisions,
    lineSegmentsIntersect,
    useItem
};