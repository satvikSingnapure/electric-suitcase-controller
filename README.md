# electric-suitcase-controller

Controls for a smart electric suitcase. This repo has two parts:

- **Web app + simulator** (`web/`, `simulator/`, `shared/`): a phone-sized controller you can run today. It talks to a simulated suitcase that follows the same rules the real one should.
- **Android app** (`app/`): the original Bluetooth controller. It is source files only for now (see [Android app status](#android-app-status)).

## What it controls

| Feature | Where | What it does |
| --- | --- | --- |
| **Follow me** | Drive tab | The case trails you at 1, 1.5 or 2.5 m. It stops on its own if you get more than 20 m away. |
| **Power assist** | Drive tab | Eco, Normal or Boost. The motor carries part of the load while you walk, and the app shows how heavy the handle feels. Hill hold is a toggle. |
| **Lock motor** (emergency) | Bar above the tabs, on every tab | One tap brakes the wheels and switches the motor modes off. It cannot be released while the case is tipped over. |
| **GPS tracker** | Locate tab | Map, distance, fix age and accuracy, ring the case, lost mode (faster updates), and a left-behind alert at 10, 25 or 50 m. |
| **Wi-Fi** | Connect tab | Turn Wi-Fi on or off, join networks (with a password dialog), and switch remote control on or off. |
| Safety and limits | Settings tab | Top speed (3 to 6 km/h), lock if tipped, stair detection, alert sounds, auto sleep. |

## Run it

You need [Node.js](https://nodejs.org) 22 or newer.

```sh
npm install
npm start
```

Open <http://localhost:8080>. Try Follow me, then open Settings, then Simulator, and make the pretend owner walk a loop, walk 60 m away, or tip the case over.

`PORT` and `HOST` change where it listens. To try it on your phone, run `HOST=0.0.0.0 npm start` and open `http://<your computer's address>:8080`. The simulator has no login, so only do this on a network you trust.

## Tests

```sh
npm test
```

23 tests cover the control rules (lock, follow, assist, tip-over, stairs, left-behind, GPS, Wi-Fi, battery, input validation) and the server (static files, path traversal, WebSocket commands, alerts, oversized messages, cross-site connections).

## How it works

```
  browser (web/)  <-- WebSocket /ws -->  simulator/server.js  -->  simulator/suitcase.js
   renders state,                        broadcasts state 5x/s,     state + rules + physics
   sends commands                        pushes alerts
```

`shared/constants.js` holds the option lists both sides agree on. `web/src/transport.js` is the only file that knows about WebSockets, so a Bluetooth transport could replace it without touching the screens.

### Protocol

Messages are JSON. The app sends `{ "type": "cmd", "id": 1, "cmd": "setMode", "args": { "mode": "follow" } }` and gets back `{ "type": "ack", "id": 1, "ok": true }`, or `{ "ok": false, "error": "motor_locked", "message": "Release the motor lock first." }`. The suitcase sends `state` (full snapshot) and `alert` messages on its own.

| Command | Arguments |
| --- | --- |
| `setMode` | `mode`: `manual`, `follow` or `assist` |
| `setFollowDistance` | `meters`: 1, 1.5 or 2.5 |
| `setAssistLevel` | `level`: 0 (Eco), 1 (Normal) or 2 (Boost) |
| `setHillHold`, `setLostMode`, `setRemoteControl`, `ring` | `on`: true or false |
| `lockMotor`, `releaseLock` | none |
| `setLeaveAlert` | `enabled` and/or `distance` (10, 25 or 50) |
| `setWifi` | `enabled`: true or false |
| `joinWifi` | `ssid`, and `password` for secured networks |
| `setSpeedLimit` | `kmh`: 3, 4, 5 or 6 |
| `setSetting` | `key`: `tipLock`, `stairDetect`, `sounds` or `autoSleep`; `on` |
| `sim*` (`simWalk`, `simOwnerAway`, `simOwnerNear`, `simTip`, `simStairs`) | simulator only |

## What is simulated

The simulator is a stand-in, not a real suitcase. Distances, GPS fixes, battery drain and movement are made up by simple rules. It accepts any non-empty Wi-Fi password, and "hill hold" is stored but has no physical effect. Real firmware has to verify passwords, brake on slopes and report real sensor data.

## Using a real suitcase

Make the firmware (or a small gateway in front of it) speak the protocol above, then point `web/src/transport.js` at it. The state fields the app reads are listed in `Suitcase#snapshot()` in `simulator/suitcase.js`.

## Android app status

`app/` holds the Kotlin sources (`MainActivity`, `SuitcaseBluetoothManager`), the manifest and the main layout. To build it, it still needs:

- Gradle build files (`settings.gradle`, `build.gradle`, `app/build.gradle`) with view binding turned on
- `strings.xml` (`app_name`), a `Theme.ElectricSuitcaseController` style and launcher icons
- a fix in `AndroidManifest.xml`: the namespace reads `http:/schemas.android.com/...` and needs `http://`

It sends single-letter commands over Bluetooth (`F`, `B`, `L`, `R`, `S`, `V1` to `V3`, `P0`/`P1`), which is a different protocol from the web app's.

## Layout

```
web/         the controller app (HTML, CSS, ES modules, no build step)
simulator/   the simulated suitcase and the server
shared/      constants used by both
test/        node:test suites
app/         Android Bluetooth app (sources only)
```
