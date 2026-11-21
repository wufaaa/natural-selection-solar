import * as THREE from 'three';
import { SHIP_CONFIG, SOLAR_BODIES, WEAPON_CONFIG } from '../core/Constants.js';

export class HUDManager {
  constructor() {
    this.hudCanvas = document.getElementById('hud-canvas');
    this.ctx = this.hudCanvas.getContext('2d');
    this.radarCanvas = document.getElementById('radar-canvas');
    this.radarCtx = this.radarCanvas.getContext('2d');

    this.titleOverlay = document.getElementById('title-overlay');
    this.hudRoot = document.getElementById('hud-root');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.loadingBar = document.getElementById('loading-bar');
    this.loadingText = document.getElementById('loading-text');

    this.helpDrawer = document.getElementById('help-drawer');
    this.commsFeed = document.getElementById('comms-feed');
    this.warpPrompt = document.getElementById('hud-warp-prompt');
    this.bossBar = document.getElementById('hud-boss-bar');
    this.bossState = document.getElementById('hud-boss-state');
    this.bossFill = document.getElementById('hud-boss-fill');
    this.compassBar = document.getElementById('hud-compass');

    // Numeric DOM refs
    this.elStageCode = document.getElementById('hud-stage-code');
    this.elScore = document.getElementById('hud-score');
    this.elStageTitle = document.getElementById('hud-stage-title');
    this.elObjective = document.getElementById('hud-objective');
    this.elEnemiesLeft = document.getElementById('hud-enemies-left');
    this.elKills = document.getElementById('hud-kills');
    this.elCamMode = document.getElementById('hud-cam-mode');
    this.elFps = document.getElementById('hud-fps');
    this.elTitleFps = document.getElementById('title-fps');

    this.elShieldVal = document.getElementById('hud-shield-val');
    this.elShieldBar = document.getElementById('hud-shield-bar');
    this.elHullVal = document.getElementById('hud-hull-val');
    this.elHullBar = document.getElementById('hud-hull-bar');
    this.elBoostVal = document.getElementById('hud-boost-val');
    this.elBoostBar = document.getElementById('hud-boost-bar');
    this.elSpeed = document.getElementById('hud-speed');
    this.elNearest = document.getElementById('hud-nearest');

    this.elGammaState = document.getElementById('hud-gamma-state');
    this.elGammaBar = document.getElementById('hud-gamma-bar');
    this.elMissileVal = document.getElementById('hud-missile-val');
    this.elEmpVal = document.getElementById('hud-emp-val');
    this.elOverdriveVal = document.getElementById('hud-overdrive-val');
    this.elBtnAssist = document.getElementById('btn-assist');

    // Contract F DOM (all null-guarded — index.html owns creation)
    this.elTotalEnemies = document.getElementById('hud-total-enemies');
    this.elModulesStrip = document.getElementById('hud-modules-strip');
    this.elTacticalHint = document.getElementById('hud-tactical-hint');
    this._lastModulesSig = '';
    this._hintTimer = 0;
    this._hintDuration = 3.6;

    this.hitmarkerTimer = 0;
    this.hitmarkerKind = 'hit';
    this.damageDirAngle = 0;
    this.damageDirTimer = 0;
    this.floatingNumbers = []; // { pos: Vector3, text, color, age, life, scale }
    this.streakBanner = null; // { text, color, age, life }

    this.aimedWarpBodyId = null;
    this.fpsSmooth = 60;
    this._compassBuilt = false;
    this._compassEls = new Map();

    // Adaptive-cost guards: radar throttle + last-written text cache
    this._radarAcc = 0;
    this._radarInterval = 0.04; // ~25 Hz
    this._textCache = new Map();

    // Comfort / motion settings (global default comes from DEFAULT_SETTINGS.reduceMotion)
    this.reduceMotion = true;
    this._compassFrame = 0;

    // Kill confirmation badge + cadence limiter
    this.killBadge = null; // { text, sub, age, life, major }
    this._lastHitFeedbackAt = -1e9;
    this._hitFeedbackMinGap = 0.1; // 100 ms

    // DPR ceiling owned here and persisted across window resizes: the quality preset sets
    // it once via resize(preset.maxPixelRatio), and the resize listener must not reset it
    // back to the default (which used to silently undo the player's quality choice).
    this._maxPixelRatio = 2;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(maxPixelRatio) {
    if (maxPixelRatio !== undefined) {
      this._maxPixelRatio = Math.min(Math.max(0.5, Number(maxPixelRatio) || 2), 3);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, this._maxPixelRatio);
    this.hudCanvas.width = Math.floor(window.innerWidth * dpr);
    this.hudCanvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The radar canvas used to keep its hard-coded 164x164 backing store, so on any HiDPI
    // display it was a stretched bitmap next to a pin-sharp main canvas. Size its backing
    // store from its real CSS box times the same capped DPR, then draw in logical units.
    if (this.radarCanvas) {
      this._sizeRadarCanvas(dpr);
    }
  }

  /**
   * Resize the radar backing store. Deferred one frame because a canvas whose CSS size is
   * not yet resolved reports its attribute size, which would feed back into layout and stop
   * the box from ever settling at the DPR-scaled size.
   */
  _sizeRadarCanvas(dpr) {
    const canvas = this.radarCanvas;
    if (!canvas) return;
    const apply = () => {
      // clientWidth/clientHeight report the layout box, unaffected by the parent's
      // perspective+rotateY transform; getBoundingClientRect() would return the
      // foreshortened box and under-size the backing store.
      const rw = Math.max(1, Math.round(canvas.clientWidth || 152));
      const rh = Math.max(1, Math.round(canvas.clientHeight || 152));
      const bw = Math.max(1, Math.round(rw * dpr));
      const bh = Math.max(1, Math.round(rh * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      this.radarCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._radarLogicalSize = rw;
      this._drawRadarPending = true;
    };
    apply();
    // Second pass on the next frame catches the case where CSS had not laid out yet.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(apply);
    }
  }

  setLoading(pct, text) {
    this.loadingBar.style.width = `${Math.round(pct * 100)}%`;
    if (text) this.loadingText.textContent = text;
  }

  hideLoading() {
    this.loadingOverlay.classList.add('hidden');
  }

  // Write a DOM text node only when its string actually changes (cuts per-frame layout work).
  _setText(el, text) {
    if (!el) return;
    const prev = this._textCache.get(el);
    if (prev === text) return;
    this._textCache.set(el, text);
    el.textContent = text;
  }

  /**
   * Full HUD teardown for campaign restart / return to title.
   * Clears every transient combat readout so nothing from the previous run bleeds through.
   */
  reset() {
    this.floatingNumbers.length = 0;
    this.hitmarkerTimer = 0;
    this.hitmarkerKind = 'hit';
    this.damageDirAngle = 0;
    this.damageDirTimer = 0;
    this.streakBanner = null;
    this.killBadge = null;
    this.killPulseTimer = 0;
    this.killPulseMajor = false;
    this._lastHitFeedbackAt = -1e9;
    this._hintTimer = 0;
    this._hintDuration = 3.6;
    this._textCache.clear();
    this._radarAcc = 0;

    if (this.elTacticalHint) {
      this.elTacticalHint.classList.remove('fade-out');
      this.elTacticalHint.classList.add('hidden');
    }

    if (this.bossBar) {
      this.bossBar.classList.add('hidden');
      this.bossBar.classList.remove('phase2');
    }

    if (this.commsFeed) this.commsFeed.innerHTML = '';

    this._lastModulesSig = '';
    if (this.elModulesStrip) {
      this.elModulesStrip.innerHTML = '';
      this.elModulesStrip.classList.add('empty');
    }

    if (this.elTotalEnemies) {
      this.elTotalEnemies.textContent = '';
      this.elTotalEnemies.style.display = 'none';
    }

    // Force the radar to repaint immediately on the first frame after a reset.
    this._drawRadarPending = true;
    this.aimedWarpBodyId = null;
  }

  setMode(mode) {
    if (mode === 'TITLE') {
      this.titleOverlay.classList.remove('hidden');
      this.hudRoot.classList.add('hidden');
      this.hudCanvas.classList.add('hidden');
    } else if (mode === 'PLAYING') {
      this.titleOverlay.classList.add('hidden');
      this.hudRoot.classList.remove('hidden');
      this.hudCanvas.classList.remove('hidden');
      // Wipe the last frame so resuming from pause can never flash a stale reticle
      // or the previous engagement's target boxes for one frame.
      this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    } else {
      this.titleOverlay.classList.add('hidden');
      this.hudRoot.classList.add('hidden');
      this.hudCanvas.classList.add('hidden');
    }
  }

  setCockpitLayout(isFP) {
    this.hudRoot.classList.toggle('fp-cockpit-active', !!isFP);
  }

  /**
   * Comfort mode. Default on: hides the per-frame joystick dot, slows the compass
   * scroll, stabilises the damage arc and halves the hitmarker pop.
   */
  setReduceMotion(enabled) {
    this.reduceMotion = !!enabled;
    this.hudRoot.classList.toggle('reduce-motion', this.reduceMotion);
  }

  /** Brief veil that hides the third<->first person camera cut. */
  triggerCockpitVeil() {
    const el = document.getElementById('fp-transition-veil');
    if (!el) return;
    el.classList.remove('veil-fade');
    // Force a reflow so the animation restarts even when triggered twice in a row.
    void el.offsetWidth;
    el.classList.add('veil-fade');
  }

  /**
   * Kill confirmation: a diamond pulse around the reticle plus a short badge above it.
   * Rate-limited so a multi-kill volley cannot stack badges or strobe the screen.
   */
  triggerKillFeedback(enemyName = '', scoreValue = 0, isMajor = false) {
    const now = performance.now() * 0.001;
    const badgeText = enemyName ? `击毁 ${enemyName}` : '目标击毁';
    const sub = scoreValue > 0 ? `+${scoreValue}` : '';
    // Major kills always play; normal kills respect the 100 ms cadence window.
    if (!isMajor && now - this._lastHitFeedbackAt < this._hitFeedbackMinGap) return;
    this._lastHitFeedbackAt = now;

    this.killBadge = {
      text: badgeText,
      sub,
      age: 0,
      life: isMajor ? 2.0 : 1.25,
      major: isMajor,
    };
    this.killPulseTimer = isMajor ? 0.52 : 0.34;
    this.killPulseMajor = isMajor;
  }

  toggleHelp() {
    this.helpDrawer.classList.toggle('hidden');
  }

  triggerHitmarker(kind) {
    this.hitmarkerKind = kind;
    this.hitmarkerTimer = kind === 'kill' ? 0.28 : 0.14;
  }

  triggerDamageDir(ship, fromWorldPos) {
    if (!fromWorldPos) return;
    const local = ship.root.worldToLocal(fromWorldPos.clone());
    this.damageDirAngle = Math.atan2(local.x, -local.z);
    this.damageDirTimer = 0.55;
  }

  spawnDamageNumber(worldPos, dmg, kind = 'hull') {
    if (this.floatingNumbers.length > 22) this.floatingNumbers.shift();
    const jitter = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4);
    const color = kind === 'shield' ? '#5ceeff' : kind === 'crit' ? '#ffe066' : '#ffffff';
    const text = kind === 'crit' ? `${dmg}!` : `${dmg}`;
    this.floatingNumbers.push({
      pos: worldPos.clone().add(jitter),
      text,
      color,
      age: 0,
      life: 0.72,
      scale: kind === 'crit' ? 1.25 : 1.0,
    });
  }

  triggerBanner(text, color = '#ffbe30') {
    this.streakBanner = { text, color, age: 0, life: 2.3 };
  }

  // Context-aware tactical hint strip directly below the reticle (3A tutorial / perfect evade)
  showTacticalHint(text, color = '#4ce8ff', duration = 3.6) {
    if (!this.elTacticalHint) return;
    this.elTacticalHint.textContent = text;
    this.elTacticalHint.style.color = color;
    this.elTacticalHint.style.borderColor = color;
    this.elTacticalHint.classList.remove('hidden', 'fade-out');
    this._hintTimer = duration;
    this._hintDuration = duration;
  }

  _updateTacticalHint(dt) {
    if (!this.elTacticalHint || this._hintTimer <= 0) return;
    this._hintTimer -= dt;
    // Fade window scales with the hint's own duration so short hints stay readable:
    // 3.6s default keeps the specified 0.6s tail, 1.0s hints get a 0.25s tail.
    const fadeWindow = Math.min(0.6, this._hintDuration * 0.25);
    if (this._hintTimer > 0 && this._hintTimer <= fadeWindow) {
      this.elTacticalHint.classList.add('fade-out');
    }
    if (this._hintTimer <= 0) {
      this._hintTimer = 0;
      this.elTacticalHint.classList.add('hidden');
      this.elTacticalHint.classList.remove('fade-out');
    }
  }

  // Rebuild the active module / synergy badge strip only when its signature changes
  _updateModulesStrip(upgradeSystem) {
    if (!this.elModulesStrip || !upgradeSystem) return;
    const modules = upgradeSystem.getActiveModules?.() || [];
    const synergies = upgradeSystem.activeSynergies || [];
    const sig = `${modules.map((m) => `${m.id}:${m.lv}`).join(',')}|${synergies.map((s) => s.id).join(',')}`;
    if (sig === this._lastModulesSig) return;
    this._lastModulesSig = sig;

    if (modules.length === 0 && synergies.length === 0) {
      this.elModulesStrip.innerHTML = '';
      this.elModulesStrip.classList.add('empty');
      return;
    }
    this.elModulesStrip.classList.remove('empty');

    const pills = modules
      .map(
        (m) =>
          `<span class="module-pill" style="--m-accent:${m.color || '#4ce8ff'}" title="${m.name}"><i>${m.tag || ''}</i>${m.name}<b>LV.${m.lv}</b></span>`
      )
      .join('');
    const synPills = synergies
      .map(
        (s) =>
          `<span class="synergy-pill" style="--s-accent:${s.color || '#ffd95e'}" title="${s.desc || ''}">◆ ${s.name}</span>`
      )
      .join('');
    this.elModulesStrip.innerHTML = pills + synPills;
  }

  addComm(sender, text) {
    const toast = document.createElement('div');
    toast.className = 'comm-toast';
    toast.innerHTML = `<div class="comm-sender">${sender}</div><div>${text}</div>`;
    this.commsFeed.appendChild(toast);
    while (this.commsFeed.children.length > 3) {
      this.commsFeed.removeChild(this.commsFeed.firstChild);
    }
    setTimeout(() => {
      if (toast.parentNode === this.commsFeed) {
        this.commsFeed.removeChild(toast);
      }
    }, 6800);
  }

  update(dt, { ship, camera, cameraRig, input, keybinds, solarSystem, enemyManager, weaponSystem, missionManager, upgradeSystem, playMode, elapsed = null, rawFps = null }) {
    // Prefer a caller-supplied real frame rate: main.js clamps dt to 0.05, which would otherwise
    // floor the displayed value at 20 FPS and hide genuine low-framerate conditions.
    const instantFps = Number.isFinite(rawFps) && rawFps > 0 ? rawFps : dt > 0.0001 ? 1 / dt : 0;
    if (instantFps > 0) {
      this.fpsSmooth = THREE.MathUtils.lerp(this.fpsSmooth, Math.min(999, instantFps), 0.08);
    }
    const fpsStr = `${Math.round(this.fpsSmooth)} FPS`;
    this._setText(this.elTitleFps, fpsStr);
    this._setText(this.elFps, fpsStr);

    if (playMode !== 'PLAYING') return;

    // Reset the radar throttle state on the first PLAYING frame so it never lags into a blank panel.
    if (this._lastMode !== 'PLAYING') {
      this._lastMode = 'PLAYING';
      this._radarAcc = this._radarInterval;
    }

    this._updateTacticalHint(dt);

    this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - dt);
    this.damageDirTimer = Math.max(0, this.damageDirTimer - dt);
    for (let i = this.floatingNumbers.length - 1; i >= 0; i--) {
      this.floatingNumbers[i].age += dt;
      this.floatingNumbers[i].pos.y += dt * 10;
      if (this.floatingNumbers[i].age >= this.floatingNumbers[i].life) {
        this.floatingNumbers.splice(i, 1);
      }
    }
    if (this.streakBanner) {
      this.streakBanner.age += dt;
      if (this.streakBanner.age >= this.streakBanner.life) this.streakBanner = null;
    }
    if (this.killBadge) {
      this.killBadge.age += dt;
      if (this.killBadge.age >= this.killBadge.life) this.killBadge = null;
    }
    if (this.killPulseTimer > 0) {
      this.killPulseTimer = Math.max(0, this.killPulseTimer - dt);
    }

    // Update DOM status panels
    const maxShield = ship.effectiveMaxShield || SHIP_CONFIG.maxShield;
    const hullPct = (ship.hull / SHIP_CONFIG.maxHull) * 100;
    const shieldPct = (ship.shield / maxShield) * 100;
    const boostPct = (ship.boost / SHIP_CONFIG.maxBoost) * 100;

    this._setText(this.elShieldVal, `${Math.ceil(ship.shield)} / ${maxShield}`);
    this.elShieldBar.style.width = `${shieldPct}%`;

    this._setText(this.elHullVal, `${Math.ceil(ship.hull)} / ${SHIP_CONFIG.maxHull}`);
    this.elHullBar.style.width = `${hullPct}%`;
    this.elHullBar.classList.toggle('low', hullPct < 35);

    this._setText(this.elBoostVal, `${Math.round(boostPct)}%`);
    this.elBoostBar.style.width = `${boostPct}%`;

    const kmSpeed = Math.round(ship.velocity.length() * 14);
    this._setText(this.elSpeed, `${kmSpeed.toLocaleString()} km/s`);

    const nearest = solarSystem.getNearestBody(ship.root.position);
    const au = (ship.root.position.length() / 2950).toFixed(2);
    if (nearest) {
      this._setText(this.elNearest, `${nearest.rec.def.name} · ${au} AU`);
    }

    const stage = missionManager.currentStage;
    const lvTag = upgradeSystem ? ` · LV.${upgradeSystem.level}` : '';
    if (missionManager.campaignComplete) {
      this._setText(this.elStageCode, `FREE PATROL${lvTag}`);
      this._setText(this.elStageTitle, '太阳系自由巡航');
      this._setText(this.elObjective, '全太阳系威胁已解除 — 按 [M] 跃迁探索或狩猎残余编队');
    } else if (stage) {
      this._setText(this.elStageCode, `${stage.code}${lvTag}`);
      this._setText(this.elStageTitle, stage.title);
      this._setText(this.elObjective, stage.objective);
    }

    this._setText(this.elScore, `SCORE ${String(enemyManager.score).padStart(5, '0')}`);

    // Sector objective count vs. whole-system stragglers (contract A/C-4 getObjectiveRemaining)
    const objectiveRemaining =
      typeof missionManager.getObjectiveRemaining === 'function'
        ? missionManager.getObjectiveRemaining(enemyManager)
        : null;
    this._setText(this.elEnemiesLeft, String(objectiveRemaining ?? enemyManager.enemies.length));

    if (this.elTotalEnemies) {
      const total = enemyManager.enemies.length;
      const shown = objectiveRemaining ?? total;
      if (total > shown) {
        this._setText(this.elTotalEnemies, ` / 总 ${total}`);
        this.elTotalEnemies.style.display = '';
      } else {
        this._setText(this.elTotalEnemies, '');
        this.elTotalEnemies.style.display = 'none';
      }
    }
    this._setText(this.elKills, String(enemyManager.kills));

    this._updateModulesStrip(upgradeSystem);

    const camNames = {
      TACTICAL: '战术全景',
      HERO_FLANK: '侧翼电影',
      FIRST_PERSON: '第一人称',
      WIDE: '广角巡航',
    };
    const camKey = keybinds ? keybinds.getLabel('camera') : 'V';
    const assistKey = keybinds ? keybinds.getLabel('aimAssist') : 'B';
    this._setText(this.elCamMode, `视角: ${camNames[cameraRig.mode] || cameraRig.mode} [${camKey}]`);

    if (this.elBtnAssist) {
      const assistLabels = { STRONG: '强', STANDARD: '标准', OFF: '关' };
      this._setText(this.elBtnAssist, `[${assistKey}] 辅瞄: ${assistLabels[weaponSystem.aimAssistMode] || '强'}`);
      this.elBtnAssist.classList.toggle('active-toggle', weaponSystem.aimAssistMode !== 'OFF');
    }

    // Weapon telemetry
    const maxAmmo = WEAPON_CONFIG.missileMaxAmmo + (weaponSystem.bonusMissileMax || 0);
    this._setText(
      this.elGammaState,
      weaponSystem.gammaOverheated ? '过热冷却' : `${Math.round(weaponSystem.gammaHeat)}%`
    );
    this.elGammaBar.style.width = `${weaponSystem.gammaHeat}%`;
    this._setText(this.elMissileVal, `${weaponSystem.missileAmmo} / ${maxAmmo}`);
    this._setText(
      this.elEmpVal,
      weaponSystem.empCooldown > 0 ? `${weaponSystem.empCooldown.toFixed(1)}s` : 'READY'
    );
    if (this.elOverdriveVal && upgradeSystem) {
      const odKey = keybinds ? keybinds.getLabel('overdrive') : 'Z';
      if (upgradeSystem.isOverdriveActive) {
        this._setText(this.elOverdriveVal, `超载激活 ${upgradeSystem.overdriveTimer.toFixed(1)}s`);
        this.elOverdriveVal.style.color = '#38f294';
      } else if (upgradeSystem.overdriveCharge >= 100) {
        this._setText(this.elOverdriveVal, `[${odKey}] READY!`);
        this.elOverdriveVal.style.color = '#ffd95e';
      } else {
        this._setText(this.elOverdriveVal, `${Math.round(upgradeSystem.overdriveCharge)}%`);
        this.elOverdriveVal.style.color = '#4ce8ff';
      }
    }

    // Boss bar: always track the droplet the player is actually fighting.
    // Prefer EnemyManager.getNearestDroplet so a farther/older boss can never mask a nearby one.
    let droplet = null;
    if (typeof enemyManager.getNearestDroplet === 'function') {
      droplet = enemyManager.getNearestDroplet(ship.root.position, 2200) || null;
    } else {
      let bestDist = 2200;
      for (const e of enemyManager.enemies) {
        if (e.type !== 'droplet' || e.hp <= 0) continue;
        const d = e.mesh.position.distanceTo(ship.root.position);
        if (d < bestDist) {
          bestDist = d;
          droplet = e;
        }
      }
    }

    if (droplet) {
      this.bossBar.classList.remove('hidden');
      this.bossFill.style.width = `${Math.max(0, (droplet.hp / droplet.maxHp) * 100)}%`;
      const isPhase2 = droplet.phase === 2;
      this.bossBar.classList.toggle('phase2', isPhase2);
      if (droplet.vulnerableTimer > 0) {
        this._setText(this.bossState, `热散窗开启 · 弱点暴露 (${droplet.vulnerableTimer.toFixed(1)}s)`);
        this.bossState.style.color = '#4ce8ff';
      } else if (isPhase2) {
        this._setText(this.bossState, '绝对零度暴走 PHASE II · 高频折线突袭');
        this.bossState.style.color = '#ff4a7a';
      } else if (droplet.state === 'TELEGRAPH_RAM') {
        this._setText(this.bossState, '高能突刺锁定中 — 立即规避！');
        this.bossState.style.color = '#ff3858';
      } else {
        this._setText(this.bossState, '强互作用力场护甲 · 建议伽马光矛 / EMP');
        this.bossState.style.color = '#ffb430';
      }
    } else {
      this.bossBar.classList.add('hidden');
      this.bossBar.classList.remove('phase2');
    }

    this._updateCompass(ship, solarSystem);
    this._drawCanvasHUD(ship, camera, cameraRig, input, keybinds, solarSystem, enemyManager, weaponSystem, missionManager, upgradeSystem, elapsed);

    // Radar is a decorative sweep: ~25 Hz reads identically and costs far less than per-frame.
    this._radarAcc += dt;
    if (this._radarAcc >= this._radarInterval || this._drawRadarPending) {
      this._radarAcc = 0;
      this._drawRadarPending = false;
      this._drawRadar(ship, solarSystem, enemyManager, upgradeSystem);
    }
  }

  _updateCompass(ship, solarSystem) {
    // Comfort mode refreshes the scrolling compass at ~20 Hz instead of every frame:
    // edge-scrolling text is a strong peripheral motion cue. Compass is a position
    // indicator, not a precision instrument, so the slower cadence is imperceptible.
    if (this.reduceMotion) {
      this._compassFrame = (this._compassFrame || 0) + 1;
      if (this._compassFrame % 3 !== 0) return;
    }
    if (!this._compassBuilt) {
      this._compassBuilt = true;
      for (const b of SOLAR_BODIES) {
        const el = document.createElement('div');
        el.className = 'compass-item';
        el.style.color = b.color;
        el.innerHTML = `<span class="compass-pip"></span><span>${b.name}</span>`;
        this.compassBar.appendChild(el);
        this._compassEls.set(b.id, el);
      }
    }
    const width = this.compassBar.clientWidth || 420;
    const shipPos = ship.root.position;
    const fwd = ship.getForward();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.root.quaternion);

    const tmpPos = new THREE.Vector3();
    const visibleItems = [];
    for (const b of SOLAR_BODIES) {
      const el = this._compassEls.get(b.id);
      const pos = solarSystem.getBodyWorldPosition(b.id, tmpPos);
      if (!pos) continue;
      const dir = pos.sub(shipPos);
      if (dir.lengthSq() < 1) {
        el.style.display = 'none';
        continue;
      }
      dir.normalize();
      const xProj = dir.dot(right);
      const zProj = dir.dot(fwd);
      const angle = Math.atan2(xProj, zProj); // -PI..PI, 0 = straight ahead
      if (Math.abs(angle) > Math.PI * 0.45) {
        el.style.display = 'none';
      } else {
        const px = width * 0.5 + (angle / (Math.PI * 0.45)) * (width * 0.46);
        visibleItems.push({ el, px });
      }
    }

    // Stagger vertically if two planet labels cluster horizontally
    visibleItems.sort((a, b) => a.px - b.px);
    let lastTopPx = -999;
    let lastBotPx = -999;
    for (const item of visibleItems) {
      item.el.style.display = 'flex';
      item.el.style.left = `${item.px}px`;
      if (item.px - lastTopPx >= 36) {
        item.el.style.top = '1px';
        lastTopPx = item.px;
      } else if (item.px - lastBotPx >= 36) {
        item.el.style.top = '16px';
        lastBotPx = item.px;
      } else {
        item.el.style.display = 'none';
      }
    }
  }

  _drawFirstPersonCockpit(ctx, w, h, ship) {
    const cx = w * 0.5;
    const cy = h * 0.5;

    ctx.save();
    // Ultra-clean holographic Combiner-Glass Fighter Optics (3D titanium struts & MFDs are rendered in 3D!)
    const fwd = ship.getForward();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.root.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.root.quaternion);
    const pitchDeg = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) * (180 / Math.PI);
    const rollRad = Math.atan2(right.y, up.y);

    // 1. Dynamic Artificial Horizon & Pitch Ladder rotating cleanly with roll
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rollRad);

    const pxPerDeg = 3.4;
    ctx.strokeStyle = 'rgba(82, 238, 255, 0.42)';
    ctx.fillStyle = 'rgba(82, 238, 255, 0.72)';
    ctx.font = 'bold 9.5px "Cascadia Mono", monospace';
    ctx.lineWidth = 1.25;

    for (let deg = -20; deg <= 20; deg += 10) {
      const yOff = (pitchDeg - deg) * pxPerDeg;
      if (Math.abs(yOff) > 135) continue;
      const halfSpan = deg === 0 ? 124 : 74;
      const gap = 50;
      ctx.beginPath();
      if (deg < 0) ctx.setLineDash([5, 4]);
      else ctx.setLineDash([]);
      ctx.moveTo(-halfSpan, yOff);
      ctx.lineTo(-gap, yOff);
      ctx.moveTo(gap, yOff);
      ctx.lineTo(halfSpan, yOff);
      ctx.stroke();

      // End ticks on pitch bars
      const tick = deg >= 0 ? 5 : -5;
      ctx.beginPath();
      ctx.moveTo(-halfSpan, yOff);
      ctx.lineTo(-halfSpan, yOff + tick);
      ctx.moveTo(halfSpan, yOff);
      ctx.lineTo(halfSpan, yOff + tick);
      ctx.stroke();

      if (deg !== 0) {
        const sign = deg > 0 ? `+${deg}` : `${deg}`;
        ctx.textAlign = 'right';
        ctx.fillText(sign, -halfSpan - 6, yOff + 3);
        ctx.textAlign = 'left';
        ctx.fillText(sign, halfSpan + 6, yOff + 3);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();

    // 2. Top Curved Bank-Roll Scale (-30..+30 deg)
    ctx.save();
    ctx.strokeStyle = 'rgba(82, 238, 255, 0.35)';
    ctx.lineWidth = 1.2;
    const bankR = 138;
    ctx.beginPath();
    ctx.arc(cx, cy, bankR, -Math.PI * 0.5 - 0.52, -Math.PI * 0.5 + 0.52);
    ctx.stroke();
    for (let deg = -30; deg <= 30; deg += 15) {
      const a = -Math.PI * 0.5 + (deg * Math.PI) / 180;
      const len = deg === 0 ? 8 : 5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * bankR, cy + Math.sin(a) * bankR);
      ctx.lineTo(cx + Math.cos(a) * (bankR - len), cy + Math.sin(a) * (bankR - len));
      ctx.stroke();
    }
    // Rotating roll caret pointer
    const ptrAng = -Math.PI * 0.5 + THREE.MathUtils.clamp(-rollRad, -0.55, 0.55);
    ctx.fillStyle = '#ffbe40';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ptrAng) * (bankR - 10), cy + Math.sin(ptrAng) * (bankR - 10));
    ctx.lineTo(cx + Math.cos(ptrAng - 0.04) * (bankR - 18), cy + Math.sin(ptrAng - 0.04) * (bankR - 18));
    ctx.lineTo(cx + Math.cos(ptrAng + 0.04) * (bankR - 18), cy + Math.sin(ptrAng + 0.04) * (bankR - 18));
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 3. Visor Mach/Boost & Shield Holographic Brackets
    const speedRatio = THREE.MathUtils.clamp(ship.velocity.length() / SHIP_CONFIG.boostSpeed, 0, 1);
    const shieldRatio = THREE.MathUtils.clamp(ship.shield / (ship.effectiveMaxShield || SHIP_CONFIG.maxShield), 0, 1);
    const arcR = Math.min(w, h) * 0.24;

    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(82, 238, 255, 0.14)';
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, Math.PI * 0.80, Math.PI * 1.20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, -Math.PI * 0.20, Math.PI * 0.20);
    ctx.stroke();

    ctx.strokeStyle = '#52eeff';
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, Math.PI * 1.20 - Math.PI * 0.40 * speedRatio, Math.PI * 1.20);
    ctx.stroke();

    ctx.strokeStyle = '#38f294';
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, Math.PI * 0.20 - Math.PI * 0.40 * shieldRatio, Math.PI * 0.20);
    ctx.stroke();

    ctx.restore();
  }

  _drawCanvasHUD(ship, camera, cameraRig, input, keybinds, solarSystem, enemyManager, weaponSystem, missionManager, upgradeSystem = null, elapsed = null) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w * 0.5;
    const cy = h * 0.5;

    // Reset text state every frame: several draw helpers set textAlign without restoring,
    // which used to leak "center" into the damage numbers and streak banner.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.setLineDash([]);

    ctx.clearRect(0, 0, w, h);

    if (cameraRig && cameraRig.mode === 'FIRST_PERSON') {
      this._drawFirstPersonCockpit(ctx, w, h, ship);
    }

    // 1. Center Gimbal Reticle & Heat/Boost Arcs (reticle blooms outward on sustained fire)
    ctx.save();
    const reticleR = 24 + (weaponSystem.reticleBloom || 0) * 9;
    // Free-orbit look (holding Alt) means the player is not aiming: soften the ring so the
    // reticle stops competing with the cinematic ship view, and label the state instead.
    const freeOrbit = !!(cameraRig && cameraRig.isFreeOrbitActive);
    ctx.strokeStyle = freeOrbit ? 'rgba(76, 232, 255, 0.26)' : 'rgba(76, 232, 255, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, reticleR, 0, Math.PI * 2);
    ctx.stroke();

    // Free-look state tag: compact, sits at cy-52 so it clears both the barrel-roll
    // readout (cy+56) and the kill badge band (cy-118). Drawn only while orbiting.
    if (freeOrbit) {
      const label = 'FREE LOOK · 自由视角';
      ctx.font = 'bold 10px "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(label).width;
      const boxW = tw + 18;
      const boxH = 18;
      const bx = cx - boxW * 0.5;
      const byTop = cy - 52 - boxH * 0.5;

      ctx.fillStyle = 'rgba(10, 24, 36, 0.46)';
      ctx.fillRect(bx, byTop, boxW, boxH);
      ctx.strokeStyle = 'rgba(143, 212, 236, 0.42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, byTop + 4);
      ctx.lineTo(bx, byTop + boxH - 4);
      ctx.moveTo(bx + boxW, byTop + 4);
      ctx.lineTo(bx + boxW, byTop + boxH - 4);
      ctx.stroke();

      ctx.fillStyle = 'rgba(206, 234, 248, 0.92)';
      ctx.fillText(label, cx, byTop + boxH * 0.5 + 3.5);
      ctx.textAlign = 'left';
    }

    // Boost arc (left)
    const boostFrac = ship.boost / SHIP_CONFIG.maxBoost;
    ctx.strokeStyle = 'rgba(255, 190, 60, 0.78)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, Math.PI * 0.72, Math.PI * 0.72 + Math.PI * 0.56 * boostFrac);
    ctx.stroke();

    // Gamma heat arc (right)
    const heatFrac = weaponSystem.gammaHeat / 100;
    ctx.strokeStyle = weaponSystem.gammaOverheated ? '#ff3858' : 'rgba(76, 232, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, 34, -Math.PI * 0.28, -Math.PI * 0.28 + Math.PI * 0.56 * heatFrac);
    ctx.stroke();

    // Phase Barrel-Roll dodge cooldown micro-arc below the reticle (contract B: 0~1.4s cd / 0~0.46s evade)
    const dodgeCd = ship.dodgeCooldown || 0;
    const dodgeT = ship.dodgeTimer || 0;
    if (dodgeCd > 0 || dodgeT > 0) {
      const evading = dodgeT > 0;
      const cdReady = 1 - Math.min(1, dodgeCd / 1.4);
      const microR = 44;
      const arcSpan = Math.PI * 0.42;
      const arcStart = Math.PI * 0.5 - arcSpan * 0.5;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, microR, arcStart, arcStart + arcSpan);
      ctx.stroke();

      ctx.strokeStyle = evading ? '#ffe066' : cdReady >= 0.999 ? '#38f294' : '#4ce8ff';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(cx, cy, microR, arcStart, arcStart + arcSpan * (evading ? 1 : cdReady));
      ctx.stroke();

      ctx.fillStyle = evading ? '#ffe066' : cdReady >= 0.999 ? '#38f294' : 'rgba(160, 220, 255, 0.72)';
      ctx.font = 'bold 8.5px "Cascadia Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(evading ? 'EVADING' : cdReady >= 0.999 ? 'ROLL READY' : 'ROLL', cx, cy + microR + 13);
    }

    // Virtual steering dot — a second, differently-phased motion reference on screen,
    // which is a known motion-sickness amplifier. Hidden entirely in comfort mode and
    // in the cockpit (where the 3D MFDs already carry the input feedback).
    const isCockpit = cameraRig && cameraRig.mode === 'FIRST_PERSON';
    if (!this.reduceMotion && !isCockpit) {
      const stickX = cx + input.aimX * 64;
      const stickY = cy + input.aimY * 64;
      ctx.strokeStyle = 'rgba(200, 245, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(stickX, stickY);
      ctx.stroke();
      ctx.fillStyle = '#6cf0ff';
      ctx.beginPath();
      ctx.arc(stickX, stickY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outer Fire-Control Aim Assist Gimbal Ring
    if (weaponSystem.aimAssistMode !== 'OFF') {
      const gimbalR = weaponSystem.aimAssistMode === 'STRONG' ? 96 : 70;
      const locked = weaponSystem.hasAimAssistLock;
      ctx.save();
      ctx.strokeStyle = locked ? 'rgba(56, 242, 148, 0.72)' : 'rgba(76, 232, 255, 0.24)';
      ctx.lineWidth = locked ? 1.6 : 1.0;
      ctx.setLineDash(locked ? [16, 12] : [6, 8]);
      ctx.beginPath();
      ctx.arc(cx, cy, gimbalR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (locked && weaponSystem.aimAssistTarget) {
        const projAssist = weaponSystem.aimAssistLeadPos.clone().project(camera);
        if (projAssist.z < 1) {
          const ax = (projAssist.x * 0.5 + 0.5) * w;
          const ay = (-projAssist.y * 0.5 + 0.5) * h;
          ctx.strokeStyle = 'rgba(56, 242, 148, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(ax, ay);
          ctx.stroke();

          ctx.strokeStyle = '#38f294';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(ax, ay, 11, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(56, 242, 148, 0.9)';
        ctx.font = 'bold 10.5px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('火控辅助锁定 · AUTO LEAD', cx, cy - gimbalR - 10);
      }
      ctx.restore();
    }

    // Elastic Hitmarker Pop X-flash (Shield=cyan, Hit=white, Crit=double gold, Kill=crimson diamond)
    if (this.hitmarkerTimer > 0) {
      const maxT = this.hitmarkerKind === 'kill' ? 0.28 : 0.14;
      const prog = 1 - Math.min(1, this.hitmarkerTimer / maxT);
      // Comfort mode halves the pop amplitude: the flash still reads, without the punch.
      const popScale = this.reduceMotion
        ? THREE.MathUtils.lerp(1.26, 1.0, Math.min(1, prog * 2.2))
        : THREE.MathUtils.lerp(1.55, 1.0, Math.min(1, prog * 2.2));
      const alpha = Math.min(1, this.hitmarkerTimer * 6.5);
      ctx.strokeStyle =
        this.hitmarkerKind === 'kill'
          ? `rgba(255, 56, 88, ${alpha})`
          : this.hitmarkerKind === 'crit'
          ? `rgba(255, 218, 72, ${alpha})`
          : this.hitmarkerKind === 'shield'
          ? `rgba(82, 238, 255, ${alpha})`
          : `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = this.hitmarkerKind === 'kill' ? 2.8 : this.hitmarkerKind === 'crit' ? 2.4 : 1.9;
      const r1 = 8 * popScale;
      const r2 = 18 * popScale;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + sx * r1, cy + sy * r1);
          ctx.lineTo(cx + sx * r2, cy + sy * r2);
          ctx.stroke();
        }
      }
      if (this.hitmarkerKind === 'kill') {
        const kr = 22 * (1 + prog * 0.45);
        ctx.beginPath();
        ctx.moveTo(cx, cy - kr);
        ctx.lineTo(cx + kr, cy);
        ctx.lineTo(cx, cy + kr);
        ctx.lineTo(cx - kr, cy);
        ctx.closePath();
        ctx.stroke();
      } else if (this.hitmarkerKind === 'crit') {
        ctx.beginPath();
        ctx.arc(cx, cy, 13 * popScale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Directional damage arc — comfort mode keeps it static (no rotating flash), which
    // removes one of the stronger peripheral-motion triggers while staying readable.
    if (this.damageDirTimer > 0) {
      const t = this.damageDirTimer / 0.55;
      const a = Math.min(0.9, this.damageDirTimer * 1.8);
      const ang = this.damageDirAngle - Math.PI * 0.5;
      if (this.reduceMotion) {
        // Stable compass-style bearing blip: fixed radius, gentle opacity breath only.
        const pulse = 0.65 + 0.35 * Math.sin(t * Math.PI);
        ctx.strokeStyle = `rgba(255, 62, 92, ${a * pulse * 0.85})`;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 92, ang - 0.22, ang + 0.22);
        ctx.stroke();
      } else {
        ctx.strokeStyle = `rgba(255, 42, 72, ${a})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, 92, ang - 0.35, ang + 0.35);
        ctx.stroke();
      }
    }

    // Kill confirmation: diamond expansion pulse hugging the reticle (never over it)
    if (this.killPulseTimer > 0) {
      const life = this.killPulseMajor ? 0.52 : 0.34;
      const prog = 1 - this.killPulseTimer / life;
      const ease = 1 - Math.pow(1 - prog, 2.2);
      const pr = 30 + ease * (this.killPulseMajor ? 74 : 48);
      const fade = 1 - prog;
      ctx.strokeStyle = this.killPulseMajor
        ? `rgba(255, 176, 64, ${0.92 * fade})`
        : `rgba(255, 232, 160, ${0.85 * fade})`;
      ctx.lineWidth = this.killPulseMajor ? 2.4 : 1.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy - pr);
      ctx.lineTo(cx + pr, cy);
      ctx.lineTo(cx, cy + pr);
      ctx.lineTo(cx - pr, cy);
      ctx.closePath();
      ctx.stroke();
      if (this.killPulseMajor) {
        ctx.strokeStyle = `rgba(255, 120, 60, ${0.55 * fade})`;
        ctx.lineWidth = 1.2;
        const pr2 = pr * 1.28;
        ctx.beginPath();
        ctx.moveTo(cx, cy - pr2);
        ctx.lineTo(cx + pr2, cy);
        ctx.lineTo(cx, cy + pr2);
        ctx.lineTo(cx - pr2, cy);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Kill confirmation badge: floats in the safe band above the reticle, never on it
    if (this.killBadge) {
      const b = this.killBadge;
      const t = b.age / b.life;
      const rise = Math.min(1, t * 4) * 10;
      const fade = t < 0.72 ? 1 : Math.max(0, (1 - t) / 0.28);
      const by = cy - 118 - rise;
      const label = b.sub ? `${b.text}  ${b.sub}` : b.text;
      ctx.font = b.major
        ? 'bold 14px "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif'
        : 'bold 12px "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(label).width;
      const padX = 12;
      const boxW = tw + padX * 2;
      const boxH = b.major ? 26 : 22;
      const bx = cx - boxW * 0.5;
      const byTop = by - boxH + 6;

      // Hairline frame + faint wash: no full-opacity slab, keeps the reticle area clean
      ctx.fillStyle = b.major ? `rgba(56, 26, 8, ${0.5 * fade})` : `rgba(10, 22, 34, ${0.44 * fade})`;
      ctx.fillRect(bx, byTop, boxW, boxH);
      ctx.strokeStyle = b.major
        ? `rgba(255, 176, 64, ${0.8 * fade})`
        : `rgba(150, 220, 245, ${0.5 * fade})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, byTop + 0.5, boxW - 1, boxH - 1);
      // Tiny accent ticks at both ends instead of a heavy bracket
      ctx.beginPath();
      ctx.moveTo(bx, byTop + 4);
      ctx.lineTo(bx, byTop + boxH - 4);
      ctx.moveTo(bx + boxW, byTop + 4);
      ctx.lineTo(bx + boxW, byTop + boxH - 4);
      ctx.stroke();

      ctx.fillStyle = b.major ? `rgba(255, 224, 170, ${fade})` : `rgba(232, 246, 255, ${fade})`;
      ctx.fillText(label, cx, byTop + boxH * 0.5 + 4);
      ctx.textAlign = 'left';
    }

    // 2. Planet Warp Waypoint Beacons
    const shipPos = ship.root.position;
    const fwd = ship.getForward();
    const proj = new THREE.Vector3();
    let bestAimedBody = null;
    let bestAimDot = 0.965; // ~15 deg forward cone

    const missionSectorId = missionManager.activeTargetSectorId;

    for (const rec of solarSystem.bodyList) {
      const wp = solarSystem.getBodyWorldPosition(rec.def.id);
      if (!wp) continue;
      const dist = wp.distanceTo(shipPos);
      if (dist < rec.def.radius * 3.5 + 240) continue;

      const dir = wp.clone().sub(shipPos).normalize();
      const dot = dir.dot(fwd);
      if (dot > bestAimDot) {
        bestAimDot = dot;
        bestAimedBody = rec.def;
      }

      proj.copy(wp).project(camera);
      if (proj.z < 1 && Math.abs(proj.x) <= 1.02 && Math.abs(proj.y) <= 1.02) {
        const sx = (proj.x * 0.5 + 0.5) * w;
        const sy = (-proj.y * 0.5 + 0.5) * h;
        const isMission = rec.def.id === missionSectorId;

        ctx.strokeStyle = isMission ? '#ffb430' : 'rgba(140, 200, 255, 0.42)';
        ctx.lineWidth = isMission ? 1.8 : 1;
        ctx.beginPath();
        ctx.arc(sx, sy, isMission ? 13 : 8, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = isMission ? '#ffd470' : 'rgba(200, 225, 255, 0.72)';
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          `${rec.def.name}${isMission ? ' ★任务' : ''} · ${Math.round(dist)}u`,
          sx,
          sy - (isMission ? 18 : 13)
        );
      }
    }

    this.aimedWarpBodyId = bestAimedBody ? bestAimedBody.id : missionSectorId;
    const warpKey = keybinds ? keybinds.getLabel('warp') : 'G';
    const mapKey = keybinds ? keybinds.getLabel('starmap') : 'M';
    const backKey = keybinds ? keybinds.getLabel('thrustBack') : 'S';
    if (ship.warpState === 'CHARGING') {
      this.warpPrompt.classList.remove('hidden');
      this.warpPrompt.textContent = '曲率引擎充能中 — 正在校准航向...';
    } else if (ship.warpState === 'WARPING') {
      this.warpPrompt.classList.remove('hidden');
      this.warpPrompt.textContent = `曲率超巡航中 [按 ${warpKey} 或 ${backKey} 随时脱离]`;
    } else if (bestAimedBody) {
      this.warpPrompt.classList.remove('hidden');
      this.warpPrompt.textContent = `已锁定「${bestAimedBody.name}」— 按 [${warpKey}] 启动曲率跃迁`;
    } else if (missionSectorId && !enemyManager.enemies.some((e) => e.sectorId === missionSectorId && e.mesh.position.distanceTo(shipPos) < 1200)) {
      const mDef = SOLAR_BODIES.find((b) => b.id === missionSectorId);
      if (mDef) {
        this.warpPrompt.classList.remove('hidden');
        this.warpPrompt.textContent = `任务目标在「${mDef.name}」— 按 [${warpKey}] 直接跃迁或 [${mapKey}] 打开星图`;
      } else {
        this.warpPrompt.classList.add('hidden');
      }
    } else {
      this.warpPrompt.classList.add('hidden');
    }

    // 3. Project Enemies with High-Tech Military Target-Acquisition Reticles & Offscreen Chevrons
    const lockedSet = new Set(weaponSystem.lockedTargets.map((t) => t.id));
    const assistTarget = weaponSystem.aimAssistTarget;
    const nowSec = performance.now() * 0.001;
    const callsignMap = { drone: 'DRN', gunship: 'GNS', destroyer: 'DST', relay: 'RLY', droplet: 'Ω-DRP' };

    let primaryEnemy = null;
    let primaryScreenDist = 1e9;
    let primarySX = 0;
    let primarySY = 0;

    for (const e of enemyManager.enemies) {
      const dist = e.mesh.position.distanceTo(shipPos);
      if (dist > 2600) continue;

      proj.copy(e.mesh.position).project(camera);
      const inFront = proj.z < 1;
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;

      if (inFront && sx > 16 && sx < w - 16 && sy > 16 && sy < h - 16) {
        const isBoss = e.type === 'droplet';
        const isRelay = e.type === 'relay';
        const isAssistLock = assistTarget && assistTarget.id === e.id && weaponSystem.hasAimAssistLock;
        const isMissileLocked = lockedSet.has(e.id);
        const baseColor = isAssistLock
          ? '#38f294'
          : isBoss
          ? e.vulnerableTimer > 0
            ? '#4ce8ff'
            : '#ff3858'
          : isRelay
          ? '#ff5577'
          : '#ffaa38';

        const r = isBoss ? 27 : isRelay ? 24 : e.type === 'destroyer' ? 21 : 16;
        const hpFrac = THREE.MathUtils.clamp(e.hp / e.maxHp, 0, 1);
        const shFrac = e.maxShield > 0 ? THREE.MathUtils.clamp(e.shield / e.maxShield, 0, 1) : 0;

        ctx.save();

        // Subtle holographic aperture backdrop tint
        ctx.fillStyle = isAssistLock
          ? 'rgba(56, 242, 148, 0.07)'
          : isBoss || isRelay
          ? 'rgba(255, 56, 88, 0.08)'
          : 'rgba(255, 170, 56, 0.05)';
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.92, 0, Math.PI * 2);
        ctx.fill();

        // Precision Chamfered L-Corner Acquisition Brackets
        const leg = Math.max(5, r * 0.42);
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = isBoss || isRelay || isAssistLock ? 1.85 : 1.35;
        for (const qx of [-1, 1]) {
          for (const qy of [-1, 1]) {
            const x0 = sx + qx * r;
            const y0 = sy + qy * r;
            ctx.beginPath();
            ctx.moveTo(x0 - qx * leg, y0);
            ctx.lineTo(x0, y0);
            ctx.lineTo(x0, y0 - qy * leg);
            ctx.stroke();
          }
        }

        // Micro crosshair cardinal ticks
        ctx.strokeStyle = 'rgba(205, 242, 255, 0.52)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - r - 3, sy);
        ctx.lineTo(sx - r + 2, sy);
        ctx.moveTo(sx + r - 2, sy);
        ctx.lineTo(sx + r + 3, sy);
        ctx.moveTo(sx, sy - r - 3);
        ctx.lineTo(sx, sy - r + 2);
        ctx.moveTo(sx, sy + r - 2);
        ctx.lineTo(sx, sy + r + 3);
        ctx.stroke();

        // Curved Radial HP & Shield Arcs hugging aperture perimeter
        const arcR = r + 5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(sx, sy, arcR, Math.PI * 0.65, Math.PI * 1.35);
        ctx.stroke();

        ctx.strokeStyle = hpFrac < 0.35 ? '#ff3858' : baseColor;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(sx, sy, arcR, Math.PI * 1.35 - Math.PI * 0.70 * hpFrac, Math.PI * 1.35);
        ctx.stroke();

        if (e.maxShield > 0 && shFrac > 0.01) {
          ctx.strokeStyle = '#4ce8ff';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(sx, sy, arcR, -Math.PI * 0.35, -Math.PI * 0.35 + Math.PI * 0.70 * shFrac);
          ctx.stroke();
        }

        // Active fire-control: keep the lock ring, drop the centre-line text — the state is
        // already reported by the fixed LOCK slot outside the reticle clearance zone.
        if (isAssistLock) {
          const rot = nowSec * (this.reduceMotion ? 0.8 : 1.9);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(rot);
          ctx.strokeStyle = 'rgba(56, 242, 148, 0.85)';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([7, 6]);
          ctx.beginPath();
          ctx.arc(0, 0, r + 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          if (!this.reduceMotion) {
            ctx.rotate(-rot * 2.1);
            ctx.strokeStyle = '#4ce8ff';
            ctx.lineWidth = 1.6;
            for (let k = 0; k < 4; k++) {
              const a = (k * Math.PI) / 2;
              ctx.beginPath();
              ctx.arc(0, 0, r + 14, a - 0.16, a + 0.16);
              ctx.stroke();
            }
          }
          ctx.restore();
        }

        // Swarm Missile Multi-Lock Rotating Hexagonal Seeker Ring (ring only, no "MSL" text;
        // the ammo count lives in the weapons panel and the ring itself is the state cue)
        if (isMissileLocked) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(-nowSec * (this.reduceMotion ? 0.6 : 1.35));
          const mr = r + (isAssistLock ? 18 : 11);
          ctx.strokeStyle = '#ffbe30';
          ctx.lineWidth = 1.35;
          ctx.beginPath();
          for (let v = 0; v < 6; v++) {
            const ang = (v * Math.PI) / 3;
            const px = Math.cos(ang) * mr;
            const py = Math.sin(ang) * mr;
            if (v === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }

        // Leader-line callout tag: ONLY for the assist/lock target and the single closest
        // on-screen hostile. Labelling every contact was the cause of the green/amber
        // text soup piling up on the reticle. Everything else keeps just the brackets.
        const cDist = Math.hypot(sx - cx, sy - cy);
        let isClosest = false;
        if (cDist < primaryScreenDist && cDist < 340) {
          primaryScreenDist = cDist;
          primaryEnemy = e;
          primarySX = sx;
          primarySY = sy;
          isClosest = true;
        }
        const showCallout = isAssistLock || isMissileLocked || isClosest || isBoss;

        if (showCallout) {
          const code = callsignMap[e.type] || 'TGT';
          const lx1 = sx + r * 0.85;
          const ly1 = sy - r * 0.85;
          const lx2 = lx1 + 10;
          const ly2 = ly1 - 9;
          ctx.strokeStyle = 'rgba(130, 215, 255, 0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(lx1, ly1);
          ctx.lineTo(lx2, ly2);
          ctx.lineTo(lx2 + 12, ly2);
          ctx.stroke();

          ctx.fillStyle = isBoss || isRelay ? '#ffdce3' : '#e6f4ff';
          ctx.font = 'bold 10.5px "Cascadia Mono", "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(`${code}·${e.name}`, lx2 + 15, ly2 + 2);
          ctx.fillStyle = baseColor;
          ctx.font = '9.5px "Cascadia Mono", monospace';
          ctx.fillText(`${Math.round(dist)}m`, lx2 + 15, ly2 + 12);
        }

        ctx.restore();
      } else {
        // Upgraded Off-Screen Directional Threat Chevron + Halo
        let dx = sx - cx;
        let dy = sy - cy;
        if (!inFront) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const rx = w * 0.37;
        const ry = h * 0.37;
        const ax = cx + Math.cos(ang) * rx;
        const ay = cy + Math.sin(ang) * ry;
        const hiThreat = e.type === 'droplet' || e.type === 'relay';

        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        ctx.fillStyle = hiThreat ? '#ff3858' : 'rgba(255, 178, 64, 0.86)';
        ctx.beginPath();
        ctx.moveTo(11, 0);
        ctx.lineTo(-6, -5.5);
        ctx.lineTo(-2.5, 0);
        ctx.lineTo(-6, 5.5);
        ctx.closePath();
        ctx.fill();
        if (hiThreat) {
          ctx.strokeStyle = 'rgba(255, 56, 88, 0.6)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(0, 0, 12, -0.7, 0.7);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 4. Advanced Ballistic Lead-Prediction Intercept Vector & Convergence Pip
    if (primaryEnemy && primaryEnemy.vel.lengthSq() > 1) {
      const dist = primaryEnemy.mesh.position.distanceTo(shipPos);
      const leadPos = primaryEnemy.mesh.position
        .clone()
        .addScaledVector(primaryEnemy.vel, dist / WEAPON_CONFIG.railgunSpeed);
      proj.copy(leadPos).project(camera);
      if (proj.z < 1) {
        const lx = (proj.x * 0.5 + 0.5) * w;
        const ly = (-proj.y * 0.5 + 0.5) * h;
        const pipLocked = assistTarget && assistTarget.id === primaryEnemy.id && weaponSystem.hasAimAssistLock;
        const pipCol = pipLocked ? '#38f294' : '#4ce8ff';

        ctx.save();
        ctx.strokeStyle = pipLocked ? 'rgba(56, 242, 148, 0.58)' : 'rgba(76, 232, 255, 0.45)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(primarySX, primarySY);
        ctx.lineTo(lx, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = pipCol;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(lx, ly, 8.5, 0, Math.PI * 2);
        ctx.stroke();
        // Triple convergence ticks
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI * 0.5 + (k * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.moveTo(lx + Math.cos(a) * 6, ly + Math.sin(a) * 6);
          ctx.lineTo(lx + Math.cos(a) * 12, ly + Math.sin(a) * 12);
          ctx.stroke();
        }
        ctx.fillStyle = pipCol;
        ctx.beginPath();
        ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Solar Overdrive curved gauge arc & Combo Multiplier beneath crosshair
    if (upgradeSystem) {
      const odFrac = upgradeSystem.isOverdriveActive
        ? upgradeSystem.overdriveTimer / 8.5
        : upgradeSystem.overdriveCharge / 100;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(cx, cy, 42, Math.PI * 0.28, Math.PI * 0.72);
      ctx.stroke();

      if (odFrac > 0.01) {
        ctx.strokeStyle = upgradeSystem.isOverdriveActive
          ? '#38f294'
          : upgradeSystem.overdriveCharge >= 100
          ? '#ffd95e'
          : '#4ce8ff';
        ctx.beginPath();
        ctx.arc(cx, cy, 42, Math.PI * 0.5 - Math.PI * 0.22 * odFrac, Math.PI * 0.5 + Math.PI * 0.22 * odFrac);
        ctx.stroke();
      }

      if (upgradeSystem.isOverdriveActive) {
        ctx.fillStyle = '#38f294';
        ctx.font = 'bold 10px "Cascadia Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`SOLAR OVERDRIVE ${upgradeSystem.overdriveTimer.toFixed(1)}s`, cx, cy + 56);
      } else if (upgradeSystem.overdriveCharge >= 100) {
        const odKey = keybinds ? keybinds.getLabel('overdrive') : 'Z';
        ctx.fillStyle = '#ffd95e';
        ctx.font = 'bold 10px "Cascadia Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`[${odKey}] 恒星聚变超载就绪`, cx, cy + 56);
      }

      if (upgradeSystem.comboCount >= 2) {
        ctx.fillStyle = '#ffbe30';
        ctx.font = 'bold 12px "Cascadia Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`COMBO ×${upgradeSystem.comboCount}`, cx, cy + 72);
      }
    }

    // Floating 3D-Projected Damage Numbers
    const dProj = new THREE.Vector3();
    for (const fn of this.floatingNumbers) {
      dProj.copy(fn.pos).project(camera);
      if (dProj.z < 1) {
        const fx = (dProj.x * 0.5 + 0.5) * w;
        const fy = (-dProj.y * 0.5 + 0.5) * h;
        const a = Math.pow(Math.max(0, 1 - fn.age / fn.life), 0.75);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = fn.color;
        ctx.font = `bold ${Math.round(13 * fn.scale)}px "Cascadia Mono", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(fn.text, fx, fy);
        ctx.restore();
      }
    }

    // High-Tech Holographic Streak / Overdrive Banner
    if (this.streakBanner) {
      const a = Math.min(1, this.streakBanner.age * 6) * Math.min(1, (this.streakBanner.life - this.streakBanner.age) * 3);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = this.streakBanner.color;
      ctx.font = 'bold 15px "Cascadia Mono", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.streakBanner.text, cx, h * 0.24);
      ctx.restore();
    }

    ctx.restore();
  }

  _drawRadar(ship, solarSystem, enemyManager, upgradeSystem = null) {
    const ctx = this.radarCtx;
    // Draw in logical CSS units: the backing store is scaled by DPR in resize(), and the
    // context transform already maps logical -> device pixels.
    const size = this._radarLogicalSize || this.radarCanvas.clientWidth || 164;
    const half = size * 0.5;
    const rMax = half - 8;
    const range = 900;
    const nowSec = performance.now() * 0.001;

    ctx.clearRect(0, 0, size, size);

    // Holographic concentric rings + rotating sonar sweep wedge
    ctx.strokeStyle = 'rgba(76, 232, 255, 0.22)';
    ctx.lineWidth = 1;
    for (const f of [0.33, 0.66, 1.0]) {
      ctx.beginPath();
      ctx.arc(half, half, rMax * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(half, 8);
    ctx.lineTo(half, size - 8);
    ctx.moveTo(8, half);
    ctx.lineTo(size - 8, half);
    ctx.stroke();

    const sweep = (nowSec * 1.9) % (Math.PI * 2);
    ctx.fillStyle = 'rgba(76, 232, 255, 0.11)';
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.arc(half, half, rMax, sweep - 0.55, sweep);
    ctx.closePath();
    ctx.fill();

    // Forward FOV wedge
    ctx.fillStyle = 'rgba(76, 232, 255, 0.09)';
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.arc(half, half, rMax, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();

    // Allied Wingmen in bright green-cyan
    if (upgradeSystem?.wingmen) {
      ctx.fillStyle = '#38f294';
      for (const w of upgradeSystem.wingmen) {
        const local = ship.root.worldToLocal(w.mesh.position.clone());
        const rx = THREE.MathUtils.clamp((local.x / range) * rMax, -rMax, rMax);
        const ry = THREE.MathUtils.clamp((local.z / range) * rMax, -rMax, rMax);
        ctx.fillRect(half + rx - 2, half + ry - 2, 4, 4);
      }
    }

    // Pickups
    for (const pk of enemyManager.pickups) {
      const local = ship.root.worldToLocal(pk.mesh.position.clone());
      const rx = THREE.MathUtils.clamp((local.x / range) * rMax, -rMax, rMax);
      const ry = THREE.MathUtils.clamp((local.z / range) * rMax, -rMax, rMax);
      ctx.fillStyle = pk.kind === 'hull' ? '#38f294' : '#4ce8ff';
      ctx.fillRect(half + rx - 2, half + ry - 2, 4, 4);
    }

    // Enemies with vertical altitude stems (AAA Elite/Starfighter style!)
    for (const e of enemyManager.enemies) {
      const local = ship.root.worldToLocal(e.mesh.position.clone());
      const len = Math.hypot(local.x, local.z);
      const scale = Math.min(1, len / range);
      const ang = Math.atan2(local.z, local.x);
      const px = half + Math.cos(ang) * scale * rMax;
      const py = half + Math.sin(ang) * scale * rMax;
      const alt = THREE.MathUtils.clamp(local.y / 140, -1, 1) * 9;

      const dotCol = e.type === 'droplet' || e.type === 'relay' ? '#ff3858' : '#ffaa38';
      ctx.strokeStyle = dotCol;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - alt);
      ctx.stroke();

      ctx.fillStyle = dotCol;
      ctx.beginPath();
      ctx.arc(px, py - alt, e.type === 'droplet' || e.type === 'relay' ? 3.8 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player center chevron
    ctx.fillStyle = '#4ce8ff';
    ctx.beginPath();
    ctx.moveTo(half, half - 5);
    ctx.lineTo(half + 4, half + 4);
    ctx.lineTo(half - 4, half + 4);
    ctx.closePath();
    ctx.fill();
  }
}
