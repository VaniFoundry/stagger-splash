# Stagger Splash
**Designed with [Stars of the City](https://github.com/tsu-b-asa/sotc) in mind** - a Project Moon inspired TTRPG by Jakkafang & community.

A Foundry VTT module that displays a Limbus Company-style **STAGGER** image directly over a token when it gains the Staggered status. The effect tracks the token as it moves and disappears when the status is cleared.

## Features

- **On-Token Effect**: Slams a STAGGER image onto the token the moment the Staggered status is applied — scales to match the token size and canvas zoom automatically
- **Animated**: Crashes in large and bright, settles to token size, then pulses with a slow golden glow while active. Flashes and shrinks out on removal
- **Movement Tracking**: The overlay follows the token in real time during movement animations, staying locked to it across pans and zooms
- **Multiplayer Sync**: Effect is broadcast to all connected clients via socket — everyone sees it simultaneously
- **Scene-Aware**: Cleans up properly on scene changes and restores any active effects when re-entering a scene where a token is already Staggered

<!-- [Screenshot of the STAGGER effect overlaid on a token] -->

## How It Works

The module watches for the `Staggered` status being added or removed from any actor on the current scene. When detected, it injects a fixed-position overlay element directly onto the page and positions it over the token using Foundry's canvas coordinate API. A per-frame animation loop keeps it locked to the token during movement.

> Note: A `staggerDebug()` helper is available in the browser console — select a token and call it to inspect exactly how the status is being stored, useful if the effect isn't triggering as expected

## Installation

1. Place the `stagger-splash/` folder inside your Foundry `Data/modules/` directory
2. Enable the module in Foundry's module management screen

No configuration needed — the effect triggers automatically whenever the Staggered status is applied to any token on the scene.

## Compatibility

| Foundry Version | Status |
|---|---|
| v13 | ✅ Verified |
