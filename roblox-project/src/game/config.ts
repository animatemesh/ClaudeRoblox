// Central tuning constants for the whole game.

export const MAP_SCALE = 12;

// Movement
export const PLAYER_SPEED = 7.0;
export const BOT_SPEED = 6.2;
export const CARRY_SPEED_MULT = 0.78;
export const TURN_LERP = 12; // how fast characters rotate toward heading
export const PLAYER_HEIGHT = 1.7; // normalized character height in world units
export const GRAVITY = 28;
export const JUMP_VELOCITY = 9.5;
export const ENTITY_RADIUS = 0.55;

// Combat
export const BAT_RANGE = 2.6;
export const BAT_ARC_DEG = 110;
export const BAT_COOLDOWN = 0.85;
export const BAT_SWING_TIME = 0.45; // Tool animation is retimed to this
export const HIT_KNOCKBACK = 11;
export const HIT_STUN_TIME = 0.65;

// Conveyor
export const CONVEYOR_SPEED = 1.8;
export const CONVEYOR_SPAWN_INTERVAL = 3.6;
export const CONVEYOR_MAX_ITEMS = 9;

// Economy
export const STARTING_MONEY = 180;
export const BOT_STARTING_MONEY = 180;

// Bases
export const BASE_SLOT_COLS = 4;
export const BASE_SLOT_ROWS = 2;
export const BASE_SLOTS = BASE_SLOT_COLS * BASE_SLOT_ROWS;
export const BASE_FOOTPRINT = 13.5;     // world-units width/depth of a base building
export const BASE_GAP_FROM_CARPET = 2.4;

// Collecting money from stored brainrots
export const COLLECT_BUTTON_RADIUS = 1.0;  // step-on radius
export const COLLECT_MIN_AMOUNT = 1;       // need at least this much accrued

// Base blockade (laser wall across the entrance)
export const BLOCKADE_DURATION = 14;
export const BLOCKADE_COOLDOWN = 10;
export const BLOCKADE_BUTTON_RADIUS = 1.1;

// Stolen item return flight
export const RETURN_FLIGHT_TIME = 1.6;
export const RETURN_FLIGHT_ARC = 7;

// Interaction
export const PICKUP_RADIUS = 2.6;

// Bot brain
export const BOT_THINK_INTERVAL = 0.45;
export const BOT_DEFEND_RADIUS = 9.0;
export const BOT_CHASE_LEASH = 26.0;
export const BOT_ATTACK_RANGE = 2.3;
export const BOT_COLLECT_THRESHOLD = 35; // accrued $ that sends a bot collecting
