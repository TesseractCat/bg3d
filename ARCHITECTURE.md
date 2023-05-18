# Architecture

One good way to understand the architecture is through the 'pawn'/piece object (which is the super class for all pawn types).
It's defined in three places:
- The Rust backend (in `src/`), in `lobby.rs`
- The JS frontend, in `pawn.js`
- The plugin prelude, in `prelude.js`

Essentially the Rust backend synchronizes state with the JS frontend, which synchronizes state with the plugin system.

Nearly all data is stored in this data-structure: `type Lobbies = Arc<RwLock<HashMap<String, Arc<RwLock<Lobby>>>>>`.

## Multiplayer

The application is entirely server-authoritative, and uses an event system to synchronize state (defined in `events.rs`).
This is not an RPC system, so events don't (and shouldn't) have a response.

Most events are bi-directional, so an event sent from the client to the server acts as a command, whereas the same event sent from the server to the client acts as a state update. Some events are server-only or client-only.

The server routes events to the corresponding *lobby*.

## Threading

Each lobby gets a tokio task to simulate physics, and each player gets a tokio task to handle messages.
Ideally, there shouldn't be too much coupling between tasks, so anhy failure in an individual task shouldn't affect any other lobbies.

## Plugins (`plugins/*/`)

All games are defined as plugins, which run on the host's browser, sending commands to the server.
Plugins run in a web-worker, meaning they cannot be easily transferred between players.
Plugins are just a zip file with a `manifest.json` and assets.

Plugins can use all static assets defined in the `static/games/` folder, and can also register new assets.
All assets in the zip file are uploaded temporarily to the lobby (with limits) and can be used by the plugin.

Model metadata is defined with GLTF custom properties, which are read on the server.
These custom properties are used for colliders right now, but could be extended to add more functionality to pawns.

## Frontend (`static/js/`)

The frontend is just vanilla JS plus THREE.js. Ideally the frontend should be swappable.
The `manager.js` defines the Manager singleton, which handles/delegates all the game logic, holds and processes the websocket connection, et cetera.

The chat, tooltip, card hand, and right-click menu are all implemented as web components.
They should be uncoupled with game logic (ideally... the hand component is a bit coupled right now).

I've modified a number of THREE.js built in classes:
- ExtrudeGeometry to add UVs to the front and back of decks.
- OrbitControls to add smoother WASD movement.
- Standard materials to add dithered cutout opacity for loading in objects.

## Misc

- I have a small itch.io/embeddable front-page in `itch/`.
- `templates/index.html` is versioned by the git commit hash, run `version.sh` to redo the versioning (automatically done in `build.sh`).
- I used Blender for all 3D modeling work. Krita for the post-it note textures.
- `variables.css` defines a lot of style variables, and the style/color scheme of the page should be easily changeable by modifying those.
- Many objects on the frontend have an `animate` function, which should run every frame. This is generally propogated down from the manager `animate` function.
    - I use a web worker `loop.js` to run on the manager even when the screen isn't focused, not sure if this is necessary anymore.
- I use spring physics (`spring.js`) for fluid animation (inspired by react-spring).