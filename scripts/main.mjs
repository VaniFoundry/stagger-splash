/**
 * Stagger Splash — Foundry VTT Module
 *
 * Renders a Limbus Company-style STAGGER image directly over the token
 * on the canvas HUD layer. Slams in when "Staggered" status is applied,
 * pulses while active, removed when the status is cleared.
 *
 * Visible to ALL clients via socket sync.
 * Positioned and scaled to match the token size + canvas zoom.
 */

const MODULE_ID    = "stagger-splash";
const SOCKET_EVENT = `module.${MODULE_ID}`;
const STATUS_ID    = "Staggered";
const IMAGE_PATH   = `modules/${MODULE_ID}/assets/stagger.png`;

// actorId → token placeable (used to clean up on scene change)
const activeEffects = new Map();

// ============================================================
// EFFECT ELEMENT — injected into #hud (canvas-space)
// ============================================================

function _effectId(tokenId) {
  return `stagger-effect-${tokenId}`;
}

/**
 * Convert a canvas-space point to CSS screen pixels.
 * NOTE: It uses the same Foundry v13 API as the held-die module.
 */
function _canvasToScreen(cx, cy) {
  try {
    const sc = canvas.clientCoordinatesFromCanvas({ x: cx, y: cy });
    return { x: sc.x, y: sc.y };
  } catch {
    const t = canvas.stage?.transform?.worldTransform;
    if (!t) return { x: cx, y: cy };
    return { x: cx * t.a + t.tx, y: cy * t.d + t.ty };
  }
}

/**
 * Position and size the effect element over the token.
 * Uses position:fixed on document.body — same approach as held-die.
 * clientCoordinatesFromCanvas gives us exact CSS screen pixels
 * accounting for both pan and zoom correctly.
 */
/**
 * Read the token's LIVE render position from its PIXI mesh.
 * token.mesh.position gives us the actual animated position mid-movement,
 * not just the destination stored in token.x / token.y.
 */
function _getTokenLivePos(token) {
  const mesh = token.mesh ?? token.icon ?? token.sprite;
  if (mesh?.position) {
    // mesh.position is in canvas coords — mesh is anchored at token center
    const cw = token.w ?? (token.document?.width  ?? 1) * canvas.grid.size;
    const ch = token.h ?? (token.document?.height ?? 1) * canvas.grid.size;
    return {
      cx: mesh.position.x - cw / 2,
      cy: mesh.position.y - ch / 2,
      cw,
      ch,
    };
  }
  // Fallback to document position
  return {
    cx: token.x,
    cy: token.y,
    cw: token.w ?? (token.document?.width  ?? 1) * canvas.grid.size,
    ch: token.h ?? (token.document?.height ?? 1) * canvas.grid.size,
  };
}

function _applyTokenPosition(el, token) {
  const { cx, cy, cw, ch } = _getTokenLivePos(token);

  const topLeft     = _canvasToScreen(cx, cy);
  const bottomRight = _canvasToScreen(cx + cw, cy + ch);

  const sw = bottomRight.x - topLeft.x;
  const sh = bottomRight.y - topLeft.y;

  // 2× the token footprint so the image has room to breathe
  const ew = sw * 2;
  const eh = sh * 2;
  const ex = topLeft.x - (ew - sw) / 2;
  const ey = topLeft.y - (eh - sh) / 2;

  el.style.left   = `${ex}px`;
  el.style.top    = `${ey}px`;
  el.style.width  = `${ew}px`;
  el.style.height = `${eh}px`;
}

// ============================================================
// ANIMATION LOOP — tracks tokens mid-movement every frame
// ============================================================

// tokenId → { destX, destY } — set when token starts moving, cleared on arrival
const movingTokens = new Map();
let _animLoopRunning = false;

function _startAnimLoop() {
  if (_animLoopRunning) return;
  _animLoopRunning = true;
  _animLoop();
}

function _animLoop() {
  if (movingTokens.size === 0) {
    _animLoopRunning = false;
    return;
  }
  for (const [tokenId, dest] of movingTokens) {
    const token = canvas.tokens?.placeables.find(t => t.id === tokenId);
    const el    = document.getElementById(_effectId(tokenId));
    if (!token || !el) { movingTokens.delete(tokenId); continue; }

    _applyTokenPosition(el, token);

    // Check if the token has reached its destination
    const { cx, cy } = _getTokenLivePos(token);
    if (Math.abs(cx - dest.x) < 1 && Math.abs(cy - dest.y) < 1) {
      movingTokens.delete(tokenId);
    }
  }
  // Only reschedule if there are still tokens to track
  if (movingTokens.size > 0) {
    requestAnimationFrame(_animLoop);
  } else {
    _animLoopRunning = false;
  }
}

function showEffect(tokenId) {
  const token = canvas.tokens?.placeables.find(t => t.id === tokenId);
  if (!token) return;

  // Already showing
  if (document.getElementById(_effectId(tokenId))) return;

  const el  = document.createElement("div");
  el.id     = _effectId(tokenId);
  el.className = "stagger-effect";

  const img = document.createElement("img");
  img.src   = IMAGE_PATH;
  img.alt   = "STAGGER";
  el.appendChild(img);

  document.body.appendChild(el);
  _applyTokenPosition(el, token);

  activeEffects.set(tokenId, token);
  console.log(`${MODULE_ID} | Showing stagger effect on token ${tokenId}`);
}

function hideEffect(tokenId) {
  const el = document.getElementById(_effectId(tokenId));
  activeEffects.delete(tokenId);
  if (!el) return;

  el.classList.add("stagger-removing");
  el.addEventListener("animationend", () => el.remove(), { once: true });

  // Safety timeout in case animationend never fires
  setTimeout(() => el.remove(), 800);
  console.log(`${MODULE_ID} | Hiding stagger effect on token ${tokenId}`);
}

function _repositionAll() {
  for (const [tokenId] of activeEffects) {
    const token = canvas.tokens?.placeables.find(t => t.id === tokenId);
    const el    = document.getElementById(_effectId(tokenId));
    if (token && el) _applyTokenPosition(el, token);
  }
}

// ============================================================
// STATUS DETECTION
// ============================================================

function _hasStaggered(actor, tokenDoc) {
  if (!actor) return false;

  // Cast a wide net — check every possible place SotC could store statuses
  const needle = STATUS_ID.toLowerCase();

  // 1. ActiveEffects — check name, label, statuses set, flags
  for (const e of (actor.effects ?? [])) {
    if (e.disabled) continue;
    if (e.name?.toLowerCase()  === needle) return true;
    if (e.label?.toLowerCase() === needle) return true;
    if (e.statuses?.has(needle)) return true;
    if (e.statuses?.has(STATUS_ID)) return true;
    if (e.flags?.core?.statusId?.toLowerCase() === needle) return true;
    // Some systems store it in the effect id itself
    if (e.id?.toLowerCase().includes(needle)) return true;
  }

  // 2. actor.statuses (Foundry v11+ built-in Set)
  if (actor.statuses?.has(needle)) return true;
  if (actor.statuses?.has(STATUS_ID)) return true;

  // 3. SotC system.statuses (array or object)
  const sys = actor.system?.statuses;
  if (Array.isArray(sys)) {
    if (sys.some(s => s?.toLowerCase?.() === needle || s === STATUS_ID)) return true;
  } else if (sys && typeof sys === "object") {
    for (const [k, v] of Object.entries(sys)) {
      if (k.toLowerCase() === needle && v) return true;
      if (typeof v === "string" && v.toLowerCase() === needle) return true;
    }
  }

  // 4. Token-level statuses — use the supplied tokenDoc directly for unlinked
  //    tokens so each copy is checked independently rather than doing a find()
  //    which always returns the first token sharing this actor id.
  if (tokenDoc?.statuses?.has(needle)) return true;
  if (tokenDoc?.statuses?.has(STATUS_ID)) return true;

  return false;
}

/**
 * Debug helper — call staggerDebug() in the browser console to see
 * exactly how a selected token stores its status effects.
 * This tells us if _hasStaggered is matching correctly.
 */
window.staggerDebug = function() {
  const token = canvas.tokens?.controlled?.[0];
  if (!token) { console.log("Select a token first"); return; }
  const actor = token.actor;
  console.group("=== Stagger Debug ===");
  console.log("Actor statuses Set:", [...(actor.statuses ?? [])]);
  console.log("Token statuses Set:", [...(token.document?.statuses ?? [])]);
  console.log("system.statuses:", actor.system?.statuses);
  console.log("ActiveEffects:");
  for (const e of (actor.effects ?? [])) {
    console.log("  effect:", { id: e.id, name: e.name, label: e.label, disabled: e.disabled, statuses: [...(e.statuses ?? [])], flags: e.flags });
  }
  console.log("_hasStaggered result:", _hasStaggered(actor));
  console.groupEnd();
};

// tokenId → true — tracks which tokens currently have the splash shown.
// Keyed by tokenId (not actorId) so multiple unlinked copies of the same
// actor are each tracked independently.
const shownTokens = new Map(); // tokenId → true

/**
 * Handle a status change for a specific token.
 * Always called with the concrete token so unlinked duplicates are
 * treated as entirely separate entities.
 */
function _handleTokenUpdate(tokenDoc) {
  if (!tokenDoc) return;

  const token = tokenDoc.object;
  if (!token) return; // token not on this scene

  const tokenId     = tokenDoc.id;
  const wasShown    = shownTokens.has(tokenId);
  const isStaggered = _hasStaggered(tokenDoc.actor, tokenDoc);

  if (isStaggered && !wasShown) {
    shownTokens.set(tokenId, true);
    game.socket.emit(SOCKET_EVENT, { action: "show", tokenId });
    showEffect(tokenId);
  } else if (!isStaggered && wasShown) {
    shownTokens.delete(tokenId);
    game.socket.emit(SOCKET_EVENT, { action: "hide", tokenId });
    hideEffect(tokenId);
  }
}

/**
 * Called from actor-level hooks (updateActor, createActiveEffect, etc.).
 * For LINKED tokens there is exactly one token per actor so this is fine.
 * For UNLINKED tokens the effect lives on the token document, not the actor,
 * so actor hooks won't fire for them — updateToken handles those instead.
 * We still walk all matching tokens as a safety net.
 */
function _handleActorUpdate(actor) {
  if (!actor) return;
  for (const token of (canvas.tokens?.placeables ?? [])) {
    if (token.actor?.id === actor.id) {
      _handleTokenUpdate(token.document);
    }
  }
}

// ============================================================
// HOOKS
// ============================================================

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET_EVENT, msg => {
    switch (msg.action) {
      case "show": showEffect(msg.tokenId); break;
      case "hide": hideEffect(msg.tokenId); break;
    }
  });
  console.log(`${MODULE_ID} | ready`);
});

// Reposition effects when canvas pans or zooms
Hooks.on("canvasPan", () => {
  requestAnimationFrame(_repositionAll);
});

// Rebuild on scene change
Hooks.on("canvasReady", () => {
  // Stop any running animation loop and clear movement tracking
  movingTokens.clear();

  // Remove all stagger effect DOM elements that may be stuck on screen.
  // document.body is NOT wiped on scene change, so position:fixed elements
  // persist across scenes and freeze at their last position.
  document.querySelectorAll(".stagger-effect").forEach(el => el.remove());

  // Clear all old state
  activeEffects.clear();
  shownTokens.clear();

  // Re-check all tokens for existing Staggered status.
  // Use tokenId as the key so unlinked duplicates are independent.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const token of (canvas.tokens?.placeables ?? [])) {
      if (_hasStaggered(token.actor, token.document)) {
        shownTokens.set(token.id, true);
        showEffect(token.id);
      }
    }
  }));
});

// Token moved — start per-frame tracking so the effect follows the movement animation
Hooks.on("updateToken", (tokenDoc, changes) => {
  const isMove = "x" in changes || "y" in changes || "width" in changes || "height" in changes;
  if (!isMove) {
    // Status changes on unlinked tokens arrive here (not via actor hooks).
    // Always use the token document directly so each copy is independent.
    _handleTokenUpdate(tokenDoc);
    return;
  }
  // Only track if this token has an active effect
  if (activeEffects.has(tokenDoc.id)) {
    const destX = changes.x ?? tokenDoc.x;
    const destY = changes.y ?? tokenDoc.y;
    movingTokens.set(tokenDoc.id, { x: destX, y: destY });
    _startAnimLoop();
  }
  _handleTokenUpdate(tokenDoc);
});

// Status added/removed via ActiveEffect
Hooks.on("createActiveEffect", (effect) => {
  if (effect.parent instanceof Actor) _handleActorUpdate(effect.parent);
});

Hooks.on("deleteActiveEffect", (effect) => {
  if (effect.parent instanceof Actor) _handleActorUpdate(effect.parent);
});

Hooks.on("updateActiveEffect", (effect) => {
  if (effect.parent instanceof Actor) _handleActorUpdate(effect.parent);
});

// Direct actor update
Hooks.on("updateActor", (actor) => {
  _handleActorUpdate(actor);
});
