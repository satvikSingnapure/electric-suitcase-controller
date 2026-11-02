// Turns suitcase state into the display strings the page shows.
// Kept free of DOM code so it is easy to read and to test.

import { ASSIST_NAMES } from '/shared/constants.js';
import { distanceM } from './map.js';

const KMH = 3.6;

export function derive(s, connected) {
  const v = {};

  if (!connected) {
    v.connState = 'off';
    v.connLabel = s ? 'Offline' : 'Connecting…';
  } else if (s?.wifi?.enabled && s.wifi.ssid) {
    v.connState = 'on';
    v.connLabel = `Wi-Fi: ${s.wifi.ssid}`;
  } else {
    v.connState = 'idle';
    v.connLabel = 'Connected';
  }
  if (!s) return v;

  v.battery = `${Math.round(s.battery)}%`;
  v.range = `${s.rangeKm.toFixed(1)} km`;
  v.load = `${s.loadKg.toFixed(1)} kg`;
  v.speed = `${(s.speedMs * KMH).toFixed(1)} km/h`;
  v.distanceToOwner = `${s.distance.toFixed(1)} m`;
  v.linkText = s.linkInRange ? 'Within range' : 'Out of range';
  v.feltLoad = `Feels like ${s.feltLoadKg.toFixed(1)} kg at the handle.`;

  if (s.locked) {
    v.statusState = 'warn';
    v.statusTitle = 'Motor locked';
    v.statusSub = s.tipped ? 'Tipped over. Stand it upright to release.' : 'Wheels braked';
  } else if (s.tipped) {
    v.statusState = 'warn';
    v.statusTitle = 'Tipped over';
    v.statusSub = 'Motor off until it is upright';
  } else if (s.mode === 'follow') {
    v.statusState = 'on';
    v.statusTitle = 'Following you';
    v.statusSub = `Staying ${s.followDistance} m behind, ${v.speed}`;
  } else if (s.mode === 'assist') {
    v.statusState = 'on';
    v.statusTitle = 'Power assist on';
    v.statusSub = `${ASSIST_NAMES[s.assistLevel]}, hill hold ${s.hillHold ? 'on' : 'off'}`;
  } else {
    v.statusState = 'idle';
    v.statusTitle = 'Motor ready';
    v.statusSub = 'Pull the handle as usual';
  }

  const gapM = distanceM(s.ownerGps, s.gps);
  v.gpsDistance = `${Math.round(gapM)} m away`;
  v.gpsAge = `Updated ${Math.round(s.gps.ageS)} s ago, accurate to about ${Math.round(s.gps.accuracyM)} m`;
  v.ringLabel = s.ringing ? 'Stop ringing' : 'Ring suitcase';
  v.mapsUrl = `https://www.openstreetmap.org/?mlat=${s.gps.lat.toFixed(6)}&mlon=${s.gps.lon.toFixed(6)}#map=18/${s.gps.lat.toFixed(6)}/${s.gps.lon.toFixed(6)}`;

  v.wifiSub = s.wifi.enabled ? (s.wifi.ssid ? `Connected to ${s.wifi.ssid}` : 'Not connected') : 'Off';
  v.remoteText = s.remoteActive ? 'Active' : s.remoteControl ? 'Needs Wi-Fi' : 'Off';
  return v;
}
