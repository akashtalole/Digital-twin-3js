// Shared yard geometry (metres). Used by the simulator, the ThingsBoard
// telemetry generator and the 3D scene so positions line up everywhere.
// World axes: +x towards the warehouse, +z towards the camera.
// Heading θ follows three.js rotation.y: forward = (cos θ, −sin θ) in (x, z).

export const SITE = { code: 'WH-04', name: 'Southfield Cross-Dock', capacity: 1600 };

export const DOCK_COUNT = 6;
export const DOCK_SPACING = 9;
export const DOCK_Z0 = -33;
export const dockZ = (i) => DOCK_Z0 + i * DOCK_SPACING;

export const BUILDING = {
  x0: 12, // façade facing the yard
  x1: 44,
  z0: dockZ(0) - DOCK_SPACING / 2,
  z1: dockZ(DOCK_COUNT - 1) + DOCK_SPACING / 2,
  h: 9,
};

export const ROAD_X = -38;
export const ROAD_WIDTH = 10;
export const LANE_X = 6.2; // forklift travel lane between trailers and doors

export const TRAILER_REAR_X = 1.5;
export const TRUCK_REAR = 7; // distance from truck origin to trailer rear
export const TRUCK_PARK_X = TRAILER_REAR_X - TRUCK_REAR;

export const DOOR_X = BUILDING.x0;
export const PICK_TRAILER_X = TRAILER_REAR_X + 2.1;
export const PICK_DOOR_X = DOOR_X - 1.9;

export const CHARGER_COUNT = 4;
export const CHARGER_Z = -44.2; // cabinet line
export const CHARGER_SPOT_Z = -42.2; // forklift parks here, facing −z
export const CHARGER_APPROACH_Z = -39.6;
export const chargerX = (i) => -16 + i * 3.4;

export const IDLE_Z = 23.5;
export const idleX = (i) => -12 + i * 3.4;

export const dockLabel = (i) => (i < 3 ? `In ${i + 1}` : `Out ${i - 2}`);
export const dockKind = (i) => (i < 3 ? 'inbound' : 'outbound');

export const headingFrom = (dx, dz) => Math.atan2(-dz, dx);

// Drone hub: landing pads behind the charging bay, by the back fence.
export const DRONE_COUNT = 3;
export const DRONE_PAD_Z = -48.5;
export const dronePadX = (i) => -28.5 + i * 4.2;
export const DRONE_CRUISE = 16; // patrol altitude (m)
