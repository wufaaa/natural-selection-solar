import * as THREE from 'three';
import { AudioEngine } from './audio/AudioEngine.js';
import { EnemyManager } from './combat/EnemyManager.js';
import { MissionManager } from './combat/MissionManager.js';
import { UpgradeSystem } from './combat/UpgradeSystem.js';
import { VFXManager } from './combat/VFXManager.js';
import { WeaponSystem } from './combat/WeaponSystem.js';
import {
  CAREER_STORAGE_KEY,
  DEFAULT_SETTINGS,
  QUALITY_PRESETS,
  SETTINGS_STORAGE_KEY,
  SHIP_LOADOUTS,
} from './core/Constants.js';
import { InputManager } from './core/InputManager.js';
import { HandGestureController } from './input/HandGestureController.js';
import { KeybindManager } from './core/KeybindManager.js';
import { PostProcessing } from './core/PostProcessing.js';
import { createArmorDetailTextures, createSpaceEnvMap } from './core/ProceduralTextures.js';
import { CameraRig } from './ship/CameraRig.js';
import { BridgeCockpit3D } from './ship/BridgeCockpit3D.js';
import { NaturalSelectionShip } from './ship/NaturalSelectionShip.js';
import { HUDManager } from './ui/HUDManager.js';
import { KeybindUI } from './ui/KeybindUI.js';
import { StarMapUI } from './ui/StarMapUI.js';
import { UpgradeUI } from './ui/UpgradeUI.js';
import { Landmarks } from './world/Landmarks.js';
import { SolarSystem } from './world/SolarSystem.js';
import { Starfield } from './world/Starfield.js';

async function bootstrap() {
  const canvas = document.getElementById('game-canvas');
  const hud = new HUDManager();
  hud.setLoading(0.18, '初始化深空渲染管线...');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#02040a');
  scene.environment = createSpaceEnvMap(renderer);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.12, 120000);
  const post = new PostProcessing(renderer, scene, camera);

  hud.setLoading(0.35, '生成太阳系天体与自定义行星着色器...');
  const starfield = new Starfield(scene);
  const solarSystem = new SolarSystem(scene);
  const landmarks = new Landmarks(scene);
  const armorTextures = createArmorDetailTextures();

  hud.setLoading(0.55, '正在解析「自然选择号」Blender 精模 (GLB)...');
  const ship = new NaturalSelectionShip(scene, armorTextures);
  await ship.load();
  const cockpit3D = new BridgeCockpit3D(ship.cockpitMount, armorTextures);

  hud.setLoading(0.88, '部署武器火控与太阳系防御战役...');
  const cameraRig = new CameraRig(camera);
  cameraRig.onFirstPersonTransition = () => hud.triggerCockpitVeil?.();
  const keybinds = new KeybindManager();
  const input = new InputManager(canvas, keybinds);
  const audio = new AudioEngine();
  const vfx = new VFXManager(scene);
  const enemyManager = new EnemyManager(scene, audio, vfx);
  const weaponSystem = new WeaponSystem(scene, audio, vfx);
  const upgradeSystem = new UpgradeSystem(scene, audio, vfx);
  enemyManager.upgradeSystem = upgradeSystem;
  enemyManager.listenerShip = ship;
  weaponSystem.upgradeSystem = upgradeSystem;
  weaponSystem.solarSystem = solarSystem;
  weaponSystem.cockpit = cockpit3D;

  const missionManager = new MissionManager(solarSystem, enemyManager, audio, (sender, text) => {
    hud.addComm(sender, text);
  });

  const loadSettings = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        const sens = Number(raw.mouseSensitivity);
        const gSens = Number(raw.gestureSensitivity);
        const shake = Number(raw.shakeScale);
        const vol = Number(raw.masterVolume);
        const hasV2 = Number(raw.gestureHandPrefVersion) >= 2;
        const loaded = {
          mouseSensitivity: Number.isFinite(sens) ? THREE.MathUtils.clamp(sens, 0.4, 2.2) : DEFAULT_SETTINGS.mouseSensitivity,
          gestureSensitivity: Number.isFinite(gSens) ? THREE.MathUtils.clamp(gSens, 0.6, 1.6) : DEFAULT_SETTINGS.gestureSensitivity,
          gestureFlightHand: hasV2 ? (raw.gestureFlightHand === 'RIGHT' ? 'RIGHT' : 'LEFT') : 'LEFT',
          gestureHandPrefVersion: 2,
          invertPitch: Boolean(raw.invertPitch),
          autoLevel: raw.autoLevel === undefined ? DEFAULT_SETTINGS.autoLevel : Boolean(raw.autoLevel),
          shakeScale: Number.isFinite(shake) ? THREE.MathUtils.clamp(shake, 0, 1.5) : DEFAULT_SETTINGS.shakeScale,
          masterVolume: Number.isFinite(vol) ? THREE.MathUtils.clamp(vol, 0, 1.5) : DEFAULT_SETTINGS.masterVolume,
          reduceMotion: raw.reduceMotion === undefined ? DEFAULT_SETTINGS.reduceMotion : Boolean(raw.reduceMotion),
        };
        if (!hasV2) {
          try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(loaded));
          } catch (_) {}
        }
        return loaded;
      }
    } catch (_) {}
    return { ...DEFAULT_SETTINGS, gestureFlightHand: 'LEFT', gestureHandPrefVersion: 2 };
  };

  let settings = loadSettings();
  let gestureDesired = false;
  let windowFocused = typeof document !== 'undefined' ? !document.hidden : true;
  const saveSettings = () => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
  };

  const settingVolumeEl = document.getElementById('setting-volume');
  const settingVolumeValEl = document.getElementById('setting-volume-val');
  const settingReduceMotionEl = document.getElementById('setting-reduce-motion');
  const settingSensEl = document.getElementById('setting-sens');
  const settingSensValEl = document.getElementById('setting-sens-val');
  const settingInvertEl = document.getElementById('setting-invert-y');
  const settingAutoLevelEl = document.getElementById('setting-autolevel');
  const settingShakeEl = document.getElementById('setting-shake');
  const settingShakeValEl = document.getElementById('setting-shake-val');
  const settingGestureModeEl = document.getElementById('setting-gesture-mode');
  const settingGestureSensEl = document.getElementById('setting-gesture-sens');
  const settingGestureSensValEl = document.getElementById('setting-gesture-sens-val');
  const settingGestureFlightHandEl = document.getElementById('setting-gesture-flight-hand');
  const upgradeOverlayEl = document.getElementById('upgrade-overlay');
  const btnModalExitGesture = document.getElementById('btn-modal-exit-gesture');
  const settingsOverlay = document.getElementById('settings-overlay');

  const applySettings = () => {
    ship.settings.mouseSensitivity = settings.mouseSensitivity;
    ship.settings.gestureSensitivity = settings.gestureSensitivity;
    ship.settings.invertPitch = settings.invertPitch;
    ship.settings.autoLevel = settings.autoLevel;
    ship.settings.shakeScale = settings.shakeScale;
    ship.settings.reduceMotion = settings.reduceMotion;
    cameraRig.shakeScale = settings.shakeScale;
    cameraRig.reduceMotion = settings.reduceMotion;
    hud.setReduceMotion?.(settings.reduceMotion);
    audio.setMasterVolume?.(settings.masterVolume);

    if (settingVolumeEl) settingVolumeEl.value = String(settings.masterVolume);
    if (settingVolumeValEl) settingVolumeValEl.textContent = `${Math.round(settings.masterVolume * 100)}%`;
    if (settingReduceMotionEl) settingReduceMotionEl.checked = settings.reduceMotion;
    if (settingSensEl) settingSensEl.value = String(settings.mouseSensitivity);
    if (settingSensValEl) settingSensValEl.textContent = `${settings.mouseSensitivity.toFixed(1)}x`;
    if (settingInvertEl) settingInvertEl.checked = settings.invertPitch;
    if (settingAutoLevelEl) settingAutoLevelEl.checked = settings.autoLevel;
    if (settingShakeEl) settingShakeEl.value = String(settings.shakeScale);
    if (settingShakeValEl) settingShakeValEl.textContent = `${Math.round(settings.shakeScale * 100)}%`;
    if (settingGestureModeEl) settingGestureModeEl.checked = Boolean(gestureDesired || input.controlMode === 'GESTURE');
    if (settingGestureSensEl) settingGestureSensEl.value = String(settings.gestureSensitivity);
    if (settingGestureSensValEl) settingGestureSensValEl.textContent = `${settings.gestureSensitivity.toFixed(1)}x`;
    if (settingGestureFlightHandEl) {
      for (const btn of settingGestureFlightHandEl.querySelectorAll('.seg-btn')) {
        btn.classList.toggle('active', (btn.dataset.flightHand === 'LEFT' ? 'LEFT' : 'RIGHT') === settings.gestureFlightHand);
      }
    }
  };

  const loadCareer = () => {
    const empty = { runs: 0, victories: 0, bestScore: 0, bestEndlessWave: 0, fastestCampaignSec: null, totalKills: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(CAREER_STORAGE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        return {
          runs: Math.max(0, Number(raw.runs) || 0),
          victories: Math.max(0, Number(raw.victories) || 0),
          bestScore: Math.max(0, Number(raw.bestScore) || 0),
          bestEndlessWave: Math.max(0, Number(raw.bestEndlessWave) || 0),
          fastestCampaignSec: Number.isFinite(raw.fastestCampaignSec) && raw.fastestCampaignSec > 0 ? raw.fastestCampaignSec : null,
          totalKills: Math.max(0, Number(raw.totalKills) || 0),
        };
      }
    } catch (_) {}
    return empty;
  };

  let careerStats = loadCareer();
  const saveCareer = () => {
    try {
      localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(careerStats));
      const prevHigh = Number(localStorage.getItem('solaris_high_score_v1') || 0);
      if (careerStats.bestScore > prevHigh) localStorage.setItem('solaris_high_score_v1', String(careerStats.bestScore));
    } catch (_) {}
  };

  let selectedCampaignMode = 'CAMPAIGN';
  let selectedLoadoutId = 'STANDARD';
  let playMode = 'TITLE'; // TITLE | PLAYING | STARMAP | UPGRADE | PAUSED | KEYBINDS | SETTINGS | VICTORY | DEFEAT
  let simTime = 0;
  let runElapsedSec = 0;
  let hitstopTimer = 0;
  let timeScale = 1.0;
  let pendingUpgradeOpen = false;
  let runOutcomeRecorded = false;
  let lastModalCfg = null;
  const shownHints = new Set();

  const hintOnce = (id, text, color = '#4ce8ff', duration = 3.6) => {
    if (shownHints.has(id)) return false;
    shownHints.add(id);
    hud.showTacticalHint(text, color, duration);
    return true;
  };

  const updateHighScoreBadge = () => {
    const el = document.getElementById('title-highscore');
    if (!el) return;
    try {
      const hs = Math.max(careerStats.bestScore, Number(localStorage.getItem('solaris_high_score_v1') || 0));
      el.textContent = `最高纪录 ${String(hs).padStart(5, '0')}`;
    } catch (_) {}
  };
  updateHighScoreBadge();

  const syncBestScores = () => {
    if (enemyManager.score > careerStats.bestScore) {
      careerStats.bestScore = enemyManager.score;
    }
    try {
      const prev = Number(localStorage.getItem('solaris_high_score_v1') || 0);
      if (enemyManager.score > prev) localStorage.setItem('solaris_high_score_v1', String(enemyManager.score));
    } catch (_) {}
  };

  const recordRunOutcome = (isVictory) => {
    if (runOutcomeRecorded) {
      syncBestScores();
      saveCareer();
      return;
    }
    runOutcomeRecorded = true;
    careerStats.runs += 1;
    careerStats.totalKills += enemyManager.kills;
    if (isVictory) {
      careerStats.victories += 1;
      if (selectedCampaignMode === 'CAMPAIGN') {
        const secs = Math.max(1, Math.round(runElapsedSec));
        if (!careerStats.fastestCampaignSec || secs < careerStats.fastestCampaignSec) {
          careerStats.fastestCampaignSec = secs;
        }
      }
    }
    if (missionManager.mode === 'ENDLESS') {
      careerStats.bestEndlessWave = Math.max(careerStats.bestEndlessWave, missionManager.endlessWave);
    }
    syncBestScores();
    saveCareer();
    updateHighScoreBadge();
  };

  // Wire combat, damage numbers, dodge, kill confirmation, shield counter-pulse & Roguelite upgrade callbacks
  weaponSystem.onHitFeedback = (kind) => {
    hud.triggerHitmarker(kind);
    audio.playHitmarker(kind);
    if (kind === 'kill') cameraRig.addShake(0.14);
  };
  enemyManager.onDamageDealt = (worldPos, dmg, kind) => {
    hud.spawnDamageNumber(worldPos, dmg, kind);
  };
  enemyManager.onEnemyKilled = (enemy) => {
    const isMajor = enemy.type === 'droplet' || enemy.type === 'destroyer' || enemy.type === 'relay';
    audio.playKillConfirm?.(isMajor);
    hud.triggerKillFeedback?.(enemy.name, enemy.scoreValue, isMajor);
    vfx.spawnKillBurst?.(enemy.mesh.position, enemy.type === 'droplet' ? '#6be8ff' : '#6ecff6', isMajor);
    cameraRig.addShake(isMajor ? 0.34 : 0.16);
    upgradeSystem.registerKill(enemy, weaponSystem, enemyManager, ship);
    syncBestScores();
  };
  enemyManager.onMajorKill = (enemy) => {
    const isBoss = enemy.type === 'droplet';
    timeScale = isBoss ? 0.32 : 0.42;
    hitstopTimer = isBoss ? 0.34 : 0.24;
    cameraRig.addShake(isBoss ? 0.52 : 0.34);
  };
  enemyManager.onPlayerHit = (dmg, fromPos) => {
    hud.triggerDamageDir(ship, fromPos);
  };
  ship.onDodge = () => {
    audio.playDodge();
    cameraRig.addShake(0.14);
  };
  ship.onPerfectDodge = () => {
    audio.playPerfectDodge();
    upgradeSystem.overdriveCharge = Math.min(100, upgradeSystem.overdriveCharge + 18);
    upgradeSystem.comboTimer = Math.max(upgradeSystem.comboTimer, 3.2);
    cameraRig.addShake(0.22);
    hud.showTacticalHint('⚡ 相位完美闪避！聚变超载 +18%', '#ffd95e', 2.4);
  };
  ship.onShieldRestore = () => {
    audio.playShieldRestore();
  };
  ship.onShieldBreak = () => {
    const pLv = upgradeSystem.getLevel('phase_shield');
    if (pLv > 0) {
      vfx.spawnEmpWave(ship.root.position, 65, '#4ce8ff');
      audio.playEmp();
      for (const e of [...enemyManager.enemies]) {
        if (e.hp > 0 && e.mesh.position.distanceTo(ship.root.position) <= 68) {
          enemyManager.applyDamage(e, 140 * pLv, e.mesh.position, 'emp');
        }
      }
    }
  };
  upgradeSystem.onBanner = (text, col) => hud.triggerBanner(text, col);

  const placeShipAtSector = (sectorId) => {
    const startPos = solarSystem.getWarpTargetPosition(sectorId) || new THREE.Vector3(2750, 58, 920);
    const bodyPos = solarSystem.getBodyWorldPosition(sectorId) || new THREE.Vector3(2950, 0, 650);
    ship.resetAt(startPos, bodyPos);
    ship.applyLoadout(SHIP_LOADOUTS[selectedLoadoutId] || SHIP_LOADOUTS.STANDARD, true);
    applySettings();
  };

  // Position Natural Selection above Earth's glowing terminator for Title Showcase!
  solarSystem.update(0, 0, new THREE.Vector3(2750, 58, 920));
  landmarks.update(0, solarSystem);
  placeShipAtSector('earth');

  const modalOverlay = document.getElementById('modal-overlay');
  const modalTag = document.getElementById('modal-tag');
  const modalTitle = document.getElementById('modal-title');
  const modalDesc = document.getElementById('modal-desc');
  const modalStats = document.getElementById('modal-stats');
  const modalBreakdown = document.getElementById('modal-breakdown');
  const btnModalPrimary = document.getElementById('btn-modal-primary');
  const btnModalSecondary = document.getElementById('btn-modal-secondary');

  const fmtDuration = (sec) => {
    const total = Math.max(0, Math.round(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const renderModalBreakdown = () => {
    if (!modalBreakdown) return;
    const st = enemyManager.stats || { damageByWeapon: {}, maxCombo: 0, perfectDodges: 0 };
    const dmg = st.damageByWeapon || {};
    const weaponEntries = [
      ['脉冲激光', Math.round(dmg.railgun || 0), '#4ce8ff'],
      ['光矛', Math.round(dmg.gamma || 0), '#ff4878'],
      ['导弹', Math.round(dmg.missile || 0), '#ffb444'],
      ['EMP', Math.round(dmg.emp || 0), '#7ef2ff'],
      ['僚机', Math.round(dmg.wingman || 0), '#5ceaff'],
    ];
    const totalDmg = weaponEntries.reduce((acc, [, v]) => acc + v, 0);
    const barsHtml = weaponEntries
      .map(([label, val, col]) => {
        const pct = totalDmg > 0 ? Math.min(100, Math.round((val / totalDmg) * 100)) : 0;
        return `<div class="breakdown-row" title="伤害占比 ${pct}%"><span>${label}</span><div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width:${pct}%;--b-accent:${col}"></div></div><strong>${val}</strong></div>`;
      })
      .join('');

    const modules = upgradeSystem.getActiveModules();
    const synergies = upgradeSystem.activeSynergies || [];
    const chipsHtml = [
      ...synergies.map((s) => `<span class="breakdown-chip">✦ ${s.name}</span>`),
      ...modules.map((m) => `<span class="breakdown-chip">${m.name} LV.${m.lv}</span>`),
      `<span class="breakdown-chip">最高连击 ×${st.maxCombo || 0}</span>`,
      `<span class="breakdown-chip">完美闪避 ${st.perfectDodges || 0}</span>`,
      `<span class="breakdown-chip">出击耗时 ${fmtDuration(runElapsedSec)}</span>`,
    ].join('');

    const bestFastest = careerStats.fastestCampaignSec ? ` · 最快 ${fmtDuration(careerStats.fastestCampaignSec)}` : '';
    const endlessRec = careerStats.bestEndlessWave > 0 ? ` · 无尽 ${careerStats.bestEndlessWave}波` : '';
    const careerHtml = `<span class="breakdown-chip">生涯结算 ${careerStats.runs} · 胜 ${careerStats.victories} · 最高分 ${careerStats.bestScore}${bestFastest}${endlessRec}</span>`;

    modalBreakdown.innerHTML = `
      <div class="breakdown-group">
        <div class="breakdown-title">武器伤害输出统计</div>
        ${barsHtml}
      </div>
      <div class="breakdown-group">
        <div class="breakdown-title">战斗统计与生涯档案</div>
        <div class="breakdown-chips">${chipsHtml}${careerHtml}</div>
      </div>
    `;
    modalBreakdown.classList.remove('hidden');
  };

  const openModal = (cfg) => {
    lastModalCfg = cfg;
    modalTag.textContent = cfg.tag;
    modalTitle.textContent = cfg.title;
    modalDesc.textContent = cfg.desc;
    modalStats.innerHTML = `
      <div>击毁敌舰: <strong>${enemyManager.kills}</strong></div>
      <div>战役得分: <strong>${enemyManager.score}</strong></div>
      <div>舰体完整度: <strong>${Math.max(0, Math.round((ship.hull / 1000) * 100))}%</strong></div>
    `;
    if (cfg.showBreakdown === false) {
      modalBreakdown?.classList.add('hidden');
    } else {
      renderModalBreakdown();
    }
    btnModalPrimary.textContent = cfg.primaryLabel;
    btnModalSecondary.textContent = cfg.secondaryLabel;
    btnModalPrimary.onclick = cfg.onPrimary;
    btnModalSecondary.onclick = cfg.onSecondary;
    modalOverlay.classList.remove('hidden');
  };

  const closeModal = () => modalOverlay.classList.add('hidden');

  const shouldSuspendGesture = () =>
    (playMode !== 'PLAYING' && playMode !== 'UPGRADE') ||
    !windowFocused ||
    (typeof document !== 'undefined' && document.hidden) ||
    (playMode === 'PLAYING' && ship.warpState !== 'IDLE');

  const syncGestureUI = () => {
    if (settingGestureModeEl) {
      settingGestureModeEl.checked = Boolean(gestureDesired || input.controlMode === 'GESTURE');
    }
    btnModalExitGesture?.classList.toggle(
      'hidden',
      !(playMode === 'PAUSED' && (input.controlMode === 'GESTURE' || gestureDesired))
    );
    hud.setGestureButtonState?.(input.controlMode === 'GESTURE', keybinds);
  };

  let gestureController = null;
  let upgradeUI = null;
  let starMap = null;

  const setGestureFlightHand = (nextHand) => {
    const normalized = nextHand === 'LEFT' ? 'LEFT' : 'RIGHT';
    settings.gestureFlightHand = normalized;
    saveSettings();
    applySettings();
    gestureController?.setFlightHand?.(normalized);
    input.clearGestureInput();
    if (playMode === 'PLAYING' && input.controlMode === 'GESTURE') {
      const handWord = normalized === 'LEFT' ? '左飞右火' : '右飞左火';
      const sideWord = normalized === 'LEFT' ? '左' : '右';
      hud.showTacticalHint(
        `已切换${handWord}：请用${sideWord}手张掌校准 · 半握巡航/全拳冲刺，操作手独立开火`,
        '#ffd95e',
        3.6
      );
    }
  };

  const exitGestureMode = ({ reason = null, isError = false, silent = false } = {}) => {
    gestureDesired = false;
    input.clearGestureInput();
    input.setControlMode('KBM');
    if (gestureController && gestureController.phase !== 'OFF' && gestureController.phase !== 'ERROR') {
      gestureController.disable();
    }
    upgradeOverlayEl?.classList.remove('gesture-pip-open');
    upgradeUI?.setGestureState?.(null, 'KBM');
    if (playMode === 'UPGRADE') {
      hud.setMode('UPGRADE', { keepGesturePip: false });
    }
    hud.updateGesturePiP?.(null, 'KBM', keybinds, { flightHand: settings.gestureFlightHand });
    syncGestureUI();
    if (reason) {
      hud.showTacticalHint(reason, isError ? '#ff8c50' : '#4ce8ff', isError ? 4.4 : 2.8);
      if (isError) hud.addComm('手势飞控核心', reason);
    } else if (!silent) {
      hud.showTacticalHint('已切回键鼠飞控模式', '#4ce8ff', 2.4);
    }
  };

  gestureController = new HandGestureController({
    onStateChange: (snap) => {
      if (snap?.phase === 'ERROR') {
        const msg = snap.errorMessage || '无法启动摄像头，已切回键鼠。';
        exitGestureMode({ reason: msg, isError: true });
      }
    },
  });
  gestureController.setFlightHand?.(settings.gestureFlightHand);

  const syncGestureSuspension = () => {
    if (input.controlMode !== 'GESTURE') return;
    const suspend = shouldSuspendGesture();
    gestureController.setSuspended(suspend);
    if (suspend) {
      input.clearGestureInput();
    }
  };

  const enterGestureMode = async () => {
    gestureDesired = true;
    if (playMode !== 'PLAYING') {
      syncGestureUI();
      return true;
    }
    input.setControlMode('GESTURE');
    gestureController.setFlightHand?.(settings.gestureFlightHand);
    gestureController.setContextMode?.('FLIGHT');
    gestureController.setSuspended(shouldSuspendGesture());
    syncGestureUI();
    const initialSnap = gestureController.getSnapshot(performance.now());
    input.setGestureInput({ aimX: 0, aimY: 0, throttle: 0, firePrimary: false, fireSecondary: false, boost: false, snapshot: initialSnap });
    hud.updateGesturePiP?.(initialSnap, 'GESTURE', keybinds, { flightHand: settings.gestureFlightHand });
    const videoEl = hud.getGestureVideoElement?.();
    const ok = await gestureController.enable(videoEl);
    if (!ok || !gestureDesired || input.controlMode !== 'GESTURE') {
      if (ok && (!gestureDesired || input.controlMode !== 'GESTURE')) {
        gestureController.disable();
      } else if (input.controlMode === 'GESTURE') {
        const errSnap = gestureController.getSnapshot(performance.now());
        exitGestureMode({ reason: errSnap?.errorMessage || '无法启动摄像头，已切回键鼠。', isError: true });
      }
      return false;
    }
    syncGestureSuspension();
    const flightSideWord = settings.gestureFlightHand === 'LEFT' ? '左' : '右';
    const opsSideWord = settings.gestureFlightHand === 'LEFT' ? '右' : '左';
    hud.showTacticalHint(
      `双手手势已开启：${flightSideWord}手(张掌停止/半握巡航/握紧全拳冲刺/摆向转向/1指精瞄/拇指左右翻滚) · ${opsSideWord}手(握拳/1-2-3指武器/捏合跃迁) · [${keybinds.getLabel('gestureToggle')}] 退出`,
      '#4ce8ff',
      4.8
    );
    return true;
  };

  const recalibrateGesture = () => {
    if (input.controlMode !== 'GESTURE') return;
    gestureController.recalibrate();
    input.clearGestureInput();
    hud.showTacticalHint('正在重新校准飞控手中立位，请飞控手张掌保持约 0.55 秒', '#ffd95e', 2.4);
  };

  const setPlayMode = (next) => {
    playMode = next;
    if (next !== 'PLAYING') {
      input.clearGestureInput();
    }
    input.enabled = next === 'PLAYING';
    input.captureTab = next === 'PLAYING' || next === 'STARMAP';
    const keepGestureUpgrade = next === 'UPGRADE' && input.controlMode === 'GESTURE';
    upgradeOverlayEl?.classList.toggle('gesture-pip-open', keepGestureUpgrade);

    if (next === 'PLAYING') {
      upgradeUI?.setGestureState?.(null, 'KBM');
      input.resetAim();
      if (gestureDesired && input.controlMode !== 'GESTURE') {
        void enterGestureMode();
      } else if (input.controlMode === 'GESTURE') {
        gestureController.setContextMode?.('FLIGHT');
        input.clearGestureInput();
        gestureController.setSuspended(shouldSuspendGesture());
      }
    } else if (next === 'UPGRADE') {
      input.releaseLock();
      audio.setGammaActive(false);
      weaponSystem.gammaActive = false;
      weaponSystem.gammaGroup.visible = false;
      if (input.controlMode === 'GESTURE') {
        gestureController.setContextMode?.('UPGRADE', { draftVersion: upgradeUI?.draftVersion || 0 });
        syncGestureSuspension();
        const snap = gestureController.getSnapshot(performance.now());
        input.setGestureInput({ aimX: 0, aimY: 0, throttle: 0, firePrimary: false, fireSecondary: false, boost: false, snapshot: snap });
        upgradeUI?.setGestureState?.(snap, 'GESTURE');
      } else {
        upgradeUI?.setGestureState?.(null, 'KBM');
      }
    } else {
      upgradeUI?.setGestureState?.(null, 'KBM');
      input.releaseLock();
      audio.setGammaActive(false);
      weaponSystem.gammaActive = false;
      weaponSystem.gammaGroup.visible = false;
      if (next === 'VICTORY' || next === 'DEFEAT' || (next === 'TITLE' && input.controlMode === 'GESTURE')) {
        exitGestureMode({ silent: true });
      } else if (input.controlMode === 'GESTURE') {
        syncGestureSuspension();
      }
    }
    hud.setMode(next, { keepGesturePip: keepGestureUpgrade });
    syncGestureUI();
  };

  const startNewCampaign = () => {
    closeModal();
    settingsOverlay?.classList.add('hidden');
    keybindUI?.close();
    starMap?.clearLockedTarget?.();
    lastModalCfg = null;
    upgradeUI?.close();
    upgradeSystem.reset();
    weaponSystem.reset();
    vfx.clearAll?.();
    hud.reset?.();
    audio.dampMenuAudio?.(0.05, true);
    ship.shieldRegenMult = 1;
    ship.boostDrainMult = 1;
    hitstopTimer = 0;
    timeScale = 1.0;
    runElapsedSec = 0;
    pendingUpgradeOpen = false;
    runOutcomeRecorded = false;
    shownHints.clear();
    placeShipAtSector('earth');
    missionManager.startCampaign(selectedCampaignMode);
    cameraRig.beginLaunchTransition();
    setPlayMode('PLAYING');
    hud.showTacticalHint('太阳系防线进入战斗！[Shift] 脉冲加速 · [双击 A/D] 无敌滚转闪避', '#4ce8ff', 3.4);
    input.requestLock();
  };

  const openPauseModal = () => {
    setPlayMode('PAUSED');
    openModal({
      tag: '战术待命',
      title: '战斗暂停',
      desc: '「自然选择号」保持轨道悬停。你可调整操控手感、键位或继续拦截敌舰。',
      primaryLabel: '继续作战',
      secondaryLabel: '重新开始战役',
      onPrimary: () => {
        closeModal();
        setPlayMode('PLAYING');
        input.requestLock();
      },
      onSecondary: () => startNewCampaign(),
    });
  };

  const openVictoryModal = () => {
    recordRunOutcome(true);
    pendingUpgradeOpen = false;
    setPlayMode('VICTORY');
    openModal({
      tag: '太阳系防线胜利守卫',
      title: '战役捷报',
      desc: '已肃清全数智子中继信标并瓦解「水滴」强互作用力场，人类舰队重掌太阳系航道控制权。',
      primaryLabel: '继续自由巡航探索太阳系',
      secondaryLabel: '重玩四阶段战役',
      onPrimary: () => {
        closeModal();
        setPlayMode('PLAYING');
        input.requestLock();
      },
      onSecondary: () => startNewCampaign(),
    });
  };

  const openDefeatModal = () => {
    recordRunOutcome(false);
    pendingUpgradeOpen = false;
    setPlayMode('DEFEAT');
    openModal({
      tag: '舰体损毁告警',
      title: '「自然选择号」受损迫降',
      desc: '舰体装甲在敌方火力下失稳。请留意利用 [Shift] 脉冲加速与 [X] EMP 脉冲打断强敌突刺。',
      primaryLabel: '重整舰队再次启航',
      secondaryLabel: '返回主界面',
      onPrimary: () => startNewCampaign(),
      onSecondary: () => {
        closeModal();
        lastModalCfg = null;
        starMap?.clearLockedTarget?.();
        enemyManager.clearAll();
        weaponSystem.reset();
        upgradeSystem.reset();
        vfx.clearAll?.();
        hud.reset?.();
        placeShipAtSector('earth');
        updateHighScoreBadge();
        audio.dampMenuAudio?.(0.016, false);
        setPlayMode('TITLE');
      },
    });
  };

  const isShipAwayFromBody = (bodyId) => {
    if (!bodyId) return false;
    const def = solarSystem.bodies.get(bodyId)?.def;
    const wp = solarSystem.getBodyWorldPosition(bodyId);
    if (!def || !wp) return false;
    return wp.distanceTo(ship.root.position) >= def.radius * 3.5 + 240;
  };

  const resolveExplicitWarpTarget = () => {
    if (hud.explicitAimedWarpBodyId && isShipAwayFromBody(hud.explicitAimedWarpBodyId)) {
      return hud.explicitAimedWarpBodyId;
    }
    const mapLocked = starMap?.getLockedTargetId?.();
    if (mapLocked && isShipAwayFromBody(mapLocked)) {
      return mapLocked;
    }
    if (hud.explicitMissionWarpBodyId && isShipAwayFromBody(hud.explicitMissionWarpBodyId)) {
      return hud.explicitMissionWarpBodyId;
    }
    return null;
  };

  const initiateWarp = (sectorId) => {
    const dest = solarSystem.getWarpTargetPosition(sectorId);
    if (!dest) return;
    if (starMap?.getLockedTargetId?.() === sectorId) {
      starMap.clearLockedTarget();
    }
    const waypoints = solarSystem.computeSafeWarpWaypoints?.(ship.root.position, dest) || [dest];
    ship.startWarp(sectorId, dest, waypoints);
    input.clearGestureInput();
    syncGestureSuspension();
    audio.playWarpCharge();
    const body = solarSystem.bodies.get(sectorId)?.def;
    if (body) {
      const detourMsg = waypoints.length > 1 ? '（已自动规划绕越恒星安全曲率航线）' : '';
      hud.addComm('曲率导航核心', `航向锁定「${body.name}」，主引擎进入超巡航${detourMsg}。`);
    }
  };

  starMap = new StarMapUI(
    solarSystem,
    missionManager,
    enemyManager,
    (sectorId) => {
      starMap.close();
      setPlayMode('PLAYING');
      initiateWarp(sectorId);
      input.requestLock();
    },
    () => {
      starMap.close();
      setPlayMode('PLAYING');
      input.requestLock();
    }
  );

  // Title Screen Launch, Loadout, Game Mode & Quality Buttons
  for (const lBtn of document.querySelectorAll('.loadout-btn')) {
    lBtn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.loadout-btn')) b.classList.remove('active');
      lBtn.classList.add('active');
      selectedLoadoutId = lBtn.dataset.loadout || 'STANDARD';
      ship.applyLoadout(SHIP_LOADOUTS[selectedLoadoutId] || SHIP_LOADOUTS.STANDARD, playMode === 'TITLE');
    });
  }

  for (const mBtn of document.querySelectorAll('.mode-btn')) {
    mBtn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.mode-btn')) b.classList.remove('active');
      mBtn.classList.add('active');
      selectedCampaignMode = mBtn.dataset.mode || 'CAMPAIGN';
    });
  }

  document.getElementById('btn-launch').addEventListener('click', () => {
    audio.ensureInit();
    startNewCampaign();
  });

  for (const qBtn of document.querySelectorAll('.q-btn')) {
    qBtn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.q-btn')) b.classList.remove('active');
      qBtn.classList.add('active');
      const qKey = qBtn.dataset.q;
      post.setQuality(qKey);
      hud.resize?.(QUALITY_PRESETS[qKey]?.maxPixelRatio ?? 1.5);
    });
  }

  const toggleAssistMode = () => {
    const mode = weaponSystem.cycleAimAssist();
    const names = { STRONG: '强力火控辅瞄 (16° 广域锁定)', STANDARD: '标准辅助瞄准 (12°)', OFF: '手动纯享瞄准' };
    hud.addComm('火控计算机', `瞄准模式切换：${names[mode]}`);
  };
  document.getElementById('btn-assist').addEventListener('click', toggleAssistMode);

  const restoreOverlayOriginMode = (originMode) => {
    setPlayMode(originMode);
    if (originMode === 'PAUSED' && lastModalCfg) {
      openModal(lastModalCfg);
    } else if ((originMode === 'VICTORY' || originMode === 'DEFEAT') && lastModalCfg) {
      openModal(lastModalCfg);
    } else if (originMode === 'PLAYING') {
      input.requestLock();
    }
  };

  let returnModeAfterKeys = 'TITLE';
  const closeKeybinds = () => {
    keybindUI.close();
    restoreOverlayOriginMode(returnModeAfterKeys);
  };
  const keybindUI = new KeybindUI(keybinds, input, closeKeybinds);

  const openKeybinds = () => {
    if (playMode === 'SETTINGS') settingsOverlay?.classList.add('hidden');
    returnModeAfterKeys = playMode === 'KEYBINDS' ? returnModeAfterKeys : playMode;
    if (playMode === 'PAUSED' || playMode === 'VICTORY' || playMode === 'DEFEAT') closeModal();
    setPlayMode('KEYBINDS');
    keybindUI.open();
  };

  let returnModeAfterSettings = 'TITLE';
  const closeSettings = () => {
    settingsOverlay?.classList.add('hidden');
    restoreOverlayOriginMode(returnModeAfterSettings);
  };

  const openSettings = () => {
    if (playMode === 'KEYBINDS') keybindUI.close();
    returnModeAfterSettings = playMode === 'SETTINGS' ? returnModeAfterSettings : playMode;
    if (playMode === 'PAUSED' || playMode === 'VICTORY' || playMode === 'DEFEAT') closeModal();
    applySettings();
    setPlayMode('SETTINGS');
    settingsOverlay?.classList.remove('hidden');
  };

  settingVolumeEl?.addEventListener('input', () => {
    const val = Number(settingVolumeEl.value);
    settings.masterVolume = Number.isFinite(val) ? THREE.MathUtils.clamp(val, 0, 1.5) : DEFAULT_SETTINGS.masterVolume;
    applySettings();
    saveSettings();
  });
  settingVolumeEl?.addEventListener('change', () => settingVolumeEl.blur());
  settingReduceMotionEl?.addEventListener('change', () => {
    settings.reduceMotion = Boolean(settingReduceMotionEl.checked);
    applySettings();
    saveSettings();
    settingReduceMotionEl.blur();
  });
  settingSensEl?.addEventListener('input', () => {
    settings.mouseSensitivity = THREE.MathUtils.clamp(Number(settingSensEl.value) || 1.0, 0.4, 2.2);
    applySettings();
    saveSettings();
  });
  settingSensEl?.addEventListener('change', () => settingSensEl.blur());
  settingInvertEl?.addEventListener('change', () => {
    settings.invertPitch = Boolean(settingInvertEl.checked);
    applySettings();
    saveSettings();
    settingInvertEl.blur();
  });
  settingAutoLevelEl?.addEventListener('change', () => {
    settings.autoLevel = Boolean(settingAutoLevelEl.checked);
    applySettings();
    saveSettings();
    settingAutoLevelEl.blur();
  });
  settingShakeEl?.addEventListener('input', () => {
    const val = Number(settingShakeEl.value);
    settings.shakeScale = Number.isFinite(val) ? THREE.MathUtils.clamp(val, 0, 1.5) : 1.0;
    applySettings();
    saveSettings();
  });
  settingShakeEl?.addEventListener('change', () => settingShakeEl.blur());
  settingGestureModeEl?.addEventListener('change', () => {
    const wantGesture = Boolean(settingGestureModeEl.checked);
    if (wantGesture) {
      gestureDesired = true;
      syncGestureUI();
    } else {
      exitGestureMode({ silent: playMode !== 'PLAYING' });
    }
    settingGestureModeEl.blur();
  });
  settingGestureSensEl?.addEventListener('input', () => {
    const val = Number(settingGestureSensEl.value);
    settings.gestureSensitivity = Number.isFinite(val) ? THREE.MathUtils.clamp(val, 0.6, 1.6) : 1.0;
    applySettings();
    saveSettings();
  });
  settingGestureSensEl?.addEventListener('change', () => settingGestureSensEl.blur());
  settingGestureFlightHandEl?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('.seg-btn');
    if (!btn) return;
    setGestureFlightHand(btn.dataset.flightHand === 'LEFT' ? 'LEFT' : 'RIGHT');
    btn.blur?.();
  });
  document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS, gestureFlightHand: 'LEFT', gestureHandPrefVersion: 2 };
    applySettings();
    saveSettings();
    gestureController.setFlightHand?.(settings.gestureFlightHand);
  });
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSettings);
  document.getElementById('btn-title-settings')?.addEventListener('click', openSettings);
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    if (playMode === 'PLAYING') openSettings();
  });
  document.getElementById('modal-btn-settings')?.addEventListener('click', openSettings);

  upgradeUI = new UpgradeUI(upgradeSystem, (picked) => {
    upgradeSystem.applyUpgrade(picked.id, ship, weaponSystem);
    ship.shieldRegenMult = 1 + upgradeSystem.getLevel('phase_shield') * 0.45;
    ship.boostDrainMult = Math.max(0.35, 1 - upgradeSystem.getLevel('overdrive_core') * 0.45);
    hud.addComm('战术模块集成', `已部署强化核心「${picked.name}」(LV.${upgradeSystem.getLevel(picked.id)})！`);
    if (upgradeSystem.pendingDrafts > 0 && upgradeUI.open()) {
      setPlayMode('UPGRADE');
    } else {
      pendingUpgradeOpen = false;
      input.clearGestureInput();
      setPlayMode('PLAYING');
      input.requestLock();
    }
  });

  upgradeSystem.onDraftReady = () => {
    if (playMode === 'PLAYING' && !upgradeUI.isOpen) {
      pendingUpgradeOpen = true;
    }
  };
  missionManager.onSectorCleared = () => {
    upgradeSystem.grantSectorDraft();
  };

  document.getElementById('btn-title-keys').addEventListener('click', openKeybinds);
  document.getElementById('btn-keybinds').addEventListener('click', () => {
    if (playMode === 'PLAYING') openKeybinds();
  });
  document.getElementById('btn-modal-keys').addEventListener('click', openKeybinds);

  document.getElementById('btn-starmap').addEventListener('click', () => {
    if (playMode === 'PLAYING') {
      setPlayMode('STARMAP');
      starMap.open();
    }
  });
  document.getElementById('btn-help').addEventListener('click', () => hud.toggleHelp());
  document.getElementById('hud-cam-mode')?.addEventListener('click', () => {
    if (playMode === 'PLAYING') cameraRig.cycleMode();
  });
  document.getElementById('btn-gesture-mode')?.addEventListener('click', () => {
    if (playMode !== 'PLAYING') return;
    if (input.controlMode === 'GESTURE') exitGestureMode();
    else void enterGestureMode();
  });
  document.getElementById('btn-gesture-flight-hand')?.addEventListener('click', () => {
    if (input.controlMode !== 'GESTURE') return;
    setGestureFlightHand(settings.gestureFlightHand === 'LEFT' ? 'RIGHT' : 'LEFT');
  });
  document.getElementById('btn-gesture-cal')?.addEventListener('click', () => {
    if (playMode === 'PLAYING') recalibrateGesture();
  });
  document.getElementById('btn-gesture-exit')?.addEventListener('click', () => {
    if (input.controlMode === 'GESTURE' || gestureDesired) exitGestureMode();
  });
  btnModalExitGesture?.addEventListener('click', () => {
    exitGestureMode({ silent: true });
    syncGestureUI();
  });

  const updateMuteButtonLabel = (muted) => {
    const btnMute = document.getElementById('btn-mute');
    if (!btnMute) return;
    btnMute.textContent = muted ? `[${keybinds.getLabel('mute')}] 已静音` : `[${keybinds.getLabel('mute')}] 音效`;
  };
  document.getElementById('btn-mute').addEventListener('click', () => {
    audio.ensureInit();
    updateMuteButtonLabel(audio.toggleMute());
  });

  // Safety guard against accidental browser right-drag back gesture during combat
  window.addEventListener('beforeunload', (e) => {
    if (playMode === 'PLAYING') {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Global first interaction unlocks Web Audio
  window.addEventListener('pointerdown', () => audio.ensureInit(), { once: true });
  window.addEventListener('keydown', () => audio.ensureInit(), { once: true });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    post.resize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener('blur', () => {
    windowFocused = false;
    input.clearGestureInput();
    syncGestureSuspension();
  });
  window.addEventListener('focus', () => {
    windowFocused = true;
    syncGestureSuspension();
  });
  document.addEventListener('visibilitychange', () => {
    windowFocused = !document.hidden;
    if (document.hidden) input.clearGestureInput();
    syncGestureSuspension();
  });
  window.addEventListener('pagehide', () => {
    gestureController.disable();
  });

  input.onLockDenied = () => {
    if (playMode === 'PLAYING' && input.controlMode !== 'GESTURE') {
      hintOnce('lock_denied', '点击游戏画面中央即可捕获鼠标准星（或直接用方向手感操舵）', '#4ce8ff', 3.4);
    }
  };

  // Expose light read-only telemetry for inspection
  window.__SOLARIS__ = {
    get state() {
      const gSnap = input.controlMode === 'GESTURE'
        ? gestureController.getSnapshot(performance.now())
        : gestureController.status || null;
      return {
        playMode,
        controlMode: input.controlMode,
        mode: missionManager.mode,
        stage: missionManager.stageIndex + 1,
        wave: missionManager.endlessWave,
        loadout: selectedLoadoutId,
        hull: Math.round(ship.hull),
        shield: Math.round(ship.shield),
        pos: ship.root.position.toArray().map((n) => Math.round(n)),
        enemies: enemyManager.enemies.length,
        objectiveLeft: missionManager.getObjectiveRemaining(enemyManager),
        warpState: ship.warpState,
        camMode: cameraRig.mode,
        synergies: upgradeSystem.activeSynergies.map((s) => s.id),
        stats: {
          ...enemyManager.stats,
          damageByWeapon: { ...enemyManager.stats.damageByWeapon },
        },
        settings: { ...settings },
        gesture: {
          controllerPhase: gestureController.phase,
          suspended: gestureController.suspended,
          handMode: gSnap?.handMode || 'DUAL',
          flightHand: gSnap?.flightHand || settings.gestureFlightHand,
          contextMode: gSnap?.contextMode || 'FLIGHT',
          phase: gSnap?.phase || 'OFF',
          pose: gSnap?.pose || 'NONE',
          flightPose: gSnap?.flightPose || 'NONE',
          tracking: Boolean(gSnap?.tracking),
          calibrated: Boolean(gSnap?.calibrated),
          aimX: Number((gSnap?.aimX || 0).toFixed(4)),
          aimY: Number((gSnap?.aimY || 0).toFixed(4)),
          throttle: Number((gSnap?.throttle || 0).toFixed(4)),
          firePrimary: Boolean(gSnap?.firePrimary),
          fireSecondary: Boolean(gSnap?.fireSecondary),
          boost: Boolean(gSnap?.boost),
          boostSource: gSnap?.boostSource || null,
          eventEpoch: gSnap?.eventEpoch ?? 0,
          events: gSnap?.events || null,
          warpTargetId: gSnap?.warpTargetId || null,
          warpChargeProgress: Number((gSnap?.warpChargeProgress || 0).toFixed(4)),
          crossingGuard: Boolean(gSnap?.crossingGuard),
          flightStatus: gSnap?.flightStatus || null,
          opsStatus: gSnap?.opsStatus || null,
          upgradeSelection: gSnap?.upgradeSelection || null,
          debug: gSnap?.debug || null,
          requireOpenPalmToArm: Boolean(gSnap?.requireOpenPalmToArm),
          errorMessage: gSnap?.errorMessage || null,
        },
        simTime: Number(simTime.toFixed(2)),
      };
    },
    warpTo: (id) => initiateWarp(id),
    setControlMode: (mode) => (mode === 'GESTURE' ? enterGestureMode() : (exitGestureMode({ silent: true }), Promise.resolve(true))),
    setGestureFlightHand: (hand) => setGestureFlightHand(hand),
    getGestureTelemetry: (limit) => gestureController?.getTelemetry?.(limit) ?? [],
    getExplicitWarpTarget: () => resolveExplicitWarpTarget(),
    setStarMapLockedTarget: (id) => {
      if (id) starMap?.selectBody?.(id, { userExplicit: true });
      else starMap?.clearLockedTarget?.();
    },
    openTestUpgrade: () => {
      if (playMode !== 'PLAYING' || upgradeUI?.isOpen) return false;
      upgradeSystem.pendingDrafts = Math.max(1, upgradeSystem.pendingDrafts);
      if (upgradeUI?.open()) {
        setPlayMode('UPGRADE');
        return true;
      }
      return false;
    },
    recalibrateGesture: () => recalibrateGesture(),
    injectGestureSample: (sample, nowMs = performance.now()) => {
      const snap = gestureController.injectMockSample(sample, nowMs);
      if (input.controlMode === 'GESTURE' && !shouldSuspendGesture()) {
        if (playMode === 'PLAYING') {
          input.setGestureInput({ ...snap, snapshot: snap });
        } else if (playMode === 'UPGRADE') {
          input.setGestureInput({ aimX: 0, aimY: 0, throttle: 0, firePrimary: false, fireSecondary: false, boost: false, snapshot: snap });
          upgradeUI?.setGestureState?.(snap, 'GESTURE');
        }
      }
      return snap;
    },
  };

  hud.setLoading(1.0, '就绪');
  hud.setMode('TITLE');
  setTimeout(() => hud.hideLoading(), 180);

  const evaluateTacticalHints = () => {
    if (upgradeSystem.overdriveCharge >= 100 && !upgradeSystem.isOverdriveActive) {
      hintOnce('overdrive_ready', `恒星聚变超载充能完毕！按 [${keybinds.getLabel('overdrive')}] 激活极限火力`, '#ffd95e', 3.8);
    }
    if (weaponSystem.gammaOverheated) {
      hintOnce('gamma_heat', '伽马光矛热能过载冷却中，请切换 [左击] 双联脉冲激光或发射导弹！', '#ff8c50', 3.4);
    }
    const shipPos = ship.root.position;
    for (const e of enemyManager.enemies) {
      if (e.hp <= 0) continue;
      const distSq = e.mesh.position.distanceToSquared(shipPos);
      if (e.shield > 0 && distSq < 540 * 540) {
        hintOnce('shielded_enemy', `侦测高能护盾敌舰：使用 [${keybinds.getLabel('fireSecondary')}/R] 伽马光矛或 [${keybinds.getLabel('emp')}] EMP 破盾`, '#4ce8ff', 3.8);
      }
      if (e.type === 'droplet' && distSq < 820 * 820) {
        if (e.state === 'TELEGRAPH_RAM') {
          hintOnce('droplet_ram', '警报：「水滴」高速突刺锁定！按 [Shift] 机动或双击 [A/D] 触发完美闪避', '#ff6470', 4.0);
        }
        if (e.vulnerableTimer > 0) {
          hintOnce('droplet_vent', '「水滴」散热口暴露！强互作用力屏障暂时削弱，立即集火输出！', '#ffd95e', 3.6);
        }
      }
    }
  };

  // Main Simulation & Render Loop
  let lastTime = performance.now();
  let elapsed = 0;

  function tick(now) {
    requestAnimationFrame(tick);
    const rawDt = Math.max(0.0001, (now - lastTime) / 1000);
    const rawFps = Math.min(240, 1 / rawDt);
    const dt = Math.min(0.05, rawDt);
    lastTime = now;
    elapsed += dt;
    input.pollGamepad(dt);

    if (playMode === 'PLAYING' && hitstopTimer > 0) {
      hitstopTimer = Math.max(0, hitstopTimer - dt);
      if (hitstopTimer === 0) timeScale = 1.0;
    } else if (playMode !== 'PLAYING') {
      timeScale = 1.0;
    } else {
      timeScale += (1.0 - timeScale) * Math.min(1, dt * 8.0);
    }
    const simDt = playMode === 'PLAYING' ? dt * timeScale : dt;
    if (playMode === 'TITLE' || playMode === 'PLAYING') {
      simTime += simDt;
    }
    if (playMode === 'PLAYING') {
      runElapsedSec += dt;
    }

    // Poll dual-hand gesture snapshot BEFORE hotkey / gestureWarp dispatch and BEFORE ship.update
    let explicitWarpTargetId = null;
    if (playMode === 'PLAYING' && input.controlMode === 'GESTURE') {
      explicitWarpTargetId = ship.warpState === 'IDLE' ? resolveExplicitWarpTarget() : null;
      gestureController.setWarpTarget?.(explicitWarpTargetId);
      syncGestureSuspension();
      const gSnap = gestureController.getSnapshot(performance.now());
      if (!shouldSuspendGesture()) {
        input.setGestureInput({ ...gSnap, snapshot: gSnap });
      } else {
        input.setGestureInput({ aimX: 0, aimY: 0, throttle: 0, firePrimary: false, fireSecondary: false, boost: false, snapshot: gSnap });
      }
    }

    // Hotkey actions
    if (input.consumeAction('mute') && playMode !== 'KEYBINDS') {
      audio.ensureInit();
      updateMuteButtonLabel(audio.toggleMute());
    }

    if (playMode === 'SETTINGS') {
      if (input.consumeJustPressed('Escape') || input.consumeAction('settings')) {
        closeSettings();
      }
    } else if (playMode === 'KEYBINDS') {
      if (input.consumeJustPressed('Escape')) {
        closeKeybinds();
      }
    } else if (playMode === 'UPGRADE') {
      if (input.consumeAction('gestureToggle') && input.controlMode === 'GESTURE') {
        exitGestureMode();
      } else if (input.consumeJustPressed('Digit1') || input.consumeJustPressed('Numpad1')) {
        upgradeUI.pickIndex(0, upgradeUI.draftVersion);
      } else if (input.consumeJustPressed('Digit2') || input.consumeJustPressed('Numpad2')) {
        upgradeUI.pickIndex(1, upgradeUI.draftVersion);
      } else if (input.consumeJustPressed('Digit3') || input.consumeJustPressed('Numpad3')) {
        upgradeUI.pickIndex(2, upgradeUI.draftVersion);
      } else if (input.controlMode === 'GESTURE') {
        syncGestureSuspension();
        const gSnap = gestureController.getSnapshot(performance.now());
        input.setGestureInput({ aimX: 0, aimY: 0, throttle: 0, firePrimary: false, fireSecondary: false, boost: false, snapshot: gSnap });
        upgradeUI.setGestureState?.(gSnap, 'GESTURE');
        const commitIdx = gSnap?.upgradeSelection?.committedIndex;
        const snapVer = gSnap?.upgradeSelection?.draftVersion;
        if (!shouldSuspendGesture() && Number.isInteger(commitIdx) && commitIdx >= 0
          && (snapVer === undefined || snapVer === upgradeUI.draftVersion)) {
          upgradeUI.pickIndex(commitIdx, upgradeUI.draftVersion);
        }
      }
    } else if (playMode === 'PLAYING') {
      if (input.consumeAction('starmap') || input.consumeJustPressed('Tab')) {
        setPlayMode('STARMAP');
        starMap.open();
      } else if (input.consumeAction('keybinds')) {
        openKeybinds();
      } else if (input.consumeAction('settings')) {
        openSettings();
      } else if (input.consumeJustPressed('Escape')) {
        openPauseModal();
      } else {
        if (input.consumeAction('camera')) cameraRig.cycleMode();
        if (input.consumeAction('help')) hud.toggleHelp();
        if (input.consumeAction('aimAssist')) toggleAssistMode();
        if (input.consumeAction('gestureToggle')) {
          if (input.controlMode === 'GESTURE') exitGestureMode();
          else void enterGestureMode();
        }
        if (input.consumeAction('gestureCalibrate') && input.controlMode === 'GESTURE') {
          recalibrateGesture();
        }
        if (input.consumeAction('overdrive')) {
          upgradeSystem.triggerOverdrive(ship);
        }
        if (input.consumeAction('autoTrack') && !weaponSystem.aimAssistTarget) {
          weaponSystem.cycleManualTarget(ship, enemyManager);
        }
        if (input.controlMode === 'GESTURE' && input.consumeAction('gestureWarp')) {
          if (ship.warpState === 'IDLE') {
            const targetId = input.gestureSnapshot?.warpTargetId ?? null;
            if (targetId && targetId === explicitWarpTargetId && isShipAwayFromBody(targetId)) {
              const body = solarSystem.bodies.get(targetId)?.def;
              if (body) {
                hud.showTacticalHint(`捏合跃迁 · 目标「${body.name}」充能中...`, '#4ce8ff', 2.4);
              }
              initiateWarp(targetId);
            } else if (!explicitWarpTargetId) {
              hud.showTacticalHint(
                `请先瞄准目标行星或在 [${keybinds.getLabel('starmap')}] 星图选定航点后再捏合跃迁`,
                '#ffd95e',
                3.2
              );
            }
          }
        }
        if (input.consumeAction('warp')) {
          if (ship.warpState !== 'IDLE') {
            ship.cancelWarp();
            input.clearGestureInput();
            syncGestureSuspension();
            hud.addComm('曲率导航核心', '曲率引擎已紧急脱离。');
          } else {
            const targetId = hud.aimedWarpBodyId || starMap.getLockedTargetId?.() || missionManager.activeTargetSectorId || 'earth';
            initiateWarp(targetId);
          }
        }
      }
    } else if (playMode === 'STARMAP') {
      if (input.consumeAction('starmap') || input.consumeJustPressed('Tab') || input.consumeJustPressed('Escape')) {
        starMap.close();
        setPlayMode('PLAYING');
        input.requestLock();
      }
    } else if (playMode === 'PAUSED') {
      if (input.consumeJustPressed('Escape')) {
        closeModal();
        setPlayMode('PLAYING');
        input.requestLock();
      } else if (input.consumeAction('gestureToggle') && (input.controlMode === 'GESTURE' || gestureDesired)) {
        exitGestureMode({ silent: true });
      } else if (input.consumeAction('settings')) {
        openSettings();
      } else if (input.consumeAction('keybinds')) {
        openKeybinds();
      }
    } else if (playMode === 'TITLE') {
      if (input.consumeAction('settings')) {
        openSettings();
      }
    }

    // Update world & ship simulation
    if (playMode === 'TITLE' || playMode === 'PLAYING') {
      solarSystem.update(simDt, simTime, ship.root.position);
      landmarks.update(simDt, solarSystem);

      let assistOptions = null;
      if (playMode === 'PLAYING' && ship.warpState === 'IDLE' && input.isActionDown('autoTrack')) {
        const trackPos = weaponSystem.getManualTrackPoint?.(ship, enemyManager);
        if (trackPos) {
          assistOptions = { leadPos: trackPos, strength: 3.1, rate: 2.0 };
        }
      } else if (
        playMode === 'PLAYING'
        && ship.warpState === 'IDLE'
        && input.controlMode === 'GESTURE'
        && weaponSystem.aimAssistMode !== 'OFF'
        && weaponSystem.hasAimAssistLock
        && weaponSystem.aimAssistTarget?.hp > 0
      ) {
        const steerMag = Math.hypot(input.gestureAimX, input.gestureAimY);
        if (steerMag < 0.42) {
          const fade = 1 - steerMag / 0.42;
          const inPoint = input.gestureSnapshot?.flightPose === 'POINT_ROTATE';
          const firing = input.isActionDown('firePrimary') || input.isActionDown('fireSecondary');
          const modeMult = weaponSystem.aimAssistMode === 'STRONG' ? 1.15 : 0.85;
          assistOptions = {
            leadPos: weaponSystem.aimAssistLeadPos,
            strength: (inPoint ? 2.4 : firing ? 2.1 : 1.55) * modeMult * fade,
            rate: inPoint ? 1.35 : 1.10,
          };
        }
      }

      if (ship.warpState !== 'IDLE' && ship.warpTargetId) {
        const liveDest = solarSystem.getWarpTargetPosition(ship.warpTargetId);
        if (liveDest) {
          ship.updateWarpTarget?.(liveDest);
          const lastAnchor = ship.warpWaypoints.length > 1
            ? ship.warpWaypoints[ship.warpWaypoints.length - 2]
            : ship.root.position;
          if (!solarSystem.isWarpSegmentClear(lastAnchor, liveDest)) {
            ship.replaceWarpWaypoints?.(solarSystem.computeSafeWarpWaypoints(ship.root.position, liveDest));
          }
        }
      }

      ship.update(simDt, simTime, input, playMode, (arrivedId) => {
        audio.playWarpArrival();
        cameraRig.addShake(0.18);
        vfx.spawnWarpExitRipple(ship.root.position);
        // Preserve pilot approach orientation seamlessly rather than violently snapping camera onto planet center
        ship.velocity.multiplyScalar(0.35);
        ship.yawVel = 0;
        ship.pitchVel = 0;
        input.resetAim();
        if (input.controlMode === 'GESTURE') {
          syncGestureSuspension();
          input.clearGestureInput();
        }
        if (starMap?.getLockedTargetId?.() === arrivedId) {
          starMap.clearLockedTarget();
        }
        missionManager.onSectorArrived(arrivedId);
      }, assistOptions, (a, b) => solarSystem.isWarpSegmentClear(a, b));

      if (playMode === 'PLAYING') {
        const wasWarping = ship.warpState !== 'IDLE';
        const col = solarSystem.resolveShipCollisions(
          ship.root.position,
          ship.velocity,
          4.2,
          ship.prevPosition,
          simDt,
          ship.warpState === 'WARPING'
        );
        if (wasWarping && (col === 'SOLAR_CORONA' || col === 'ATMOSPHERE')) {
          ship.cancelWarp();
          input.clearGestureInput();
          syncGestureSuspension();
          hud.addComm('曲率导航核心', '航道临近大质量天体引力边界，已安全退出超巡航。');
        }
        if (col === 'SOLAR_CORONA') {
          ship.takeDamage(120 * simDt, null);
          cameraRig.addShake(0.20);
        } else if (col === 'ASTEROID') {
          ship.takeDamage(32, null);
          audio.playShieldImpact();
          cameraRig.addShake(0.32);
        } else if (col === 'MOON') {
          ship.takeDamage(14, null);
          audio.playShieldImpact();
          cameraRig.addShake(0.18);
        } else if (col === 'RING_ICE') {
          cameraRig.addShake(0.08);
        }

        weaponSystem.update(simDt, ship, input, enemyManager, cameraRig, playMode, camera, simTime);
        enemyManager.update(simDt, simTime, ship, cameraRig, playMode);
        upgradeSystem.update(simDt, simTime, ship, enemyManager, playMode);

        // Strict terminal outcome precedence: check lethal hull failure FIRST before stage reward/victory
        if (ship.hull <= 0) {
          vfx.spawnExplosion(ship.root.position, 24, '#4ce8ff');
          audio.playExplosion('capital');
          openDefeatModal();
        } else {
          if (ship.hull < 300) {
            audio.playLowHullBeep();
          }
          evaluateTacticalHints();
          missionManager.update(simDt, ship, openVictoryModal);

          if (playMode === 'PLAYING' && pendingUpgradeOpen && !upgradeUI.isOpen) {
            pendingUpgradeOpen = false;
            if (upgradeUI.open()) setPlayMode('UPGRADE');
          }
        }
      }

      vfx.update(simDt);
      cameraRig.update(dt, simTime, ship, playMode, input);
      const nearestBody = solarSystem.getNearestBody(ship.root.position);
      const inCockpit = playMode === 'PLAYING' && cameraRig.mode === 'FIRST_PERSON';
      ship.setFirstPersonMode?.(inCockpit);
      audio.setCockpitMuffle?.(inCockpit);
      cockpit3D.setVisible(inCockpit);
      hud.setCockpitLayout(inCockpit);
      if (inCockpit) {
        cockpit3D.update(dt, simTime, ship, weaponSystem, upgradeSystem, nearestBody?.rec?.def?.enName, enemyManager);
      }
      starfield.update(simDt, simTime, camera.position, ship.velocity, ship.warpState === 'WARPING', nearestBody?.rec?.def?.id);

      if (playMode === 'TITLE') {
        audio.dampMenuAudio?.(dt, false);
      } else if (playMode === 'PLAYING') {
        const primaryDroplet =
          enemyManager.getNearestDroplet?.(ship.root.position, 2200) ||
          enemyManager.enemies.find((e) => e.type === 'droplet' && e.hp > 0 && e.mesh.position.distanceTo(ship.root.position) < 2200) ||
          null;
        const isDropletPhase2 = Boolean(primaryDroplet && primaryDroplet.phase === 2);
        audio.updateContinuous(
          ship.throttle,
          ship.isBoosting,
          ship.warpState === 'WARPING',
          enemyManager.enemies.some((e) => e.mesh.position.distanceTo(ship.root.position) < 900),
          Boolean(primaryDroplet),
          dt,
          isDropletPhase2
        );
      } else {
        audio.dampMenuAudio?.(dt, true);
      }
    } else {
      audio.dampMenuAudio?.(dt, true);
    }

    if (playMode === 'STARMAP') {
      starMap.render(ship);
    }

    hud.update(dt, {
      ship,
      camera,
      cameraRig,
      input,
      keybinds,
      solarSystem,
      enemyManager,
      weaponSystem,
      missionManager,
      upgradeSystem,
      playMode,
      elapsed: simTime,
      rawFps,
      reduceMotion: settings.reduceMotion,
      starMapLockedTargetId: starMap.getLockedTargetId?.() || null,
      gestureFlightHand: settings.gestureFlightHand,
    });

    post.render(dt, {
      speedRatio: Math.min(1, ship.velocity.length() / 340),
      isWarping: ship.warpState === 'WARPING',
      isChargingWarp: ship.warpState === 'CHARGING',
      damagePulse: ship.damagePulse,
      hullRatio: Math.max(0, ship.hull / 1000),
      reduceMotion: settings.reduceMotion,
    });

    input.endFrame(dt);
  }

  requestAnimationFrame(tick);
}

bootstrap().catch((err) => {
  console.error('[SOLARIS] Fatal init error:', err);
  const lt = document.getElementById('loading-text');
  if (lt) lt.textContent = `初始化失败: ${err?.message || err}`;
});
