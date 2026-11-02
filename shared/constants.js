// Values shared by the suitcase (simulator today, firmware later) and the web app.
// Plain ES module with no Node-only imports so the browser can load it too.

export const PROTOCOL_VERSION = 1;

export const MODES = ['manual', 'follow', 'assist'];
export const FOLLOW_DISTANCES = [1, 1.5, 2.5]; // metres behind the owner
export const ASSIST_LEVELS = [0, 1, 2]; // Eco, Normal, Boost
export const ASSIST_NAMES = ['Eco', 'Normal', 'Boost'];
export const SPEED_LIMITS_KMH = [3, 4, 5, 6];
export const LEAVE_DISTANCES = [10, 25, 50]; // left-behind alert thresholds, metres
export const SETTING_KEYS = ['tipLock', 'stairDetect', 'sounds', 'autoSleep'];

// Follow me needs the owner's phone within this range to keep tracking.
export const LINK_RANGE_M = 20;
