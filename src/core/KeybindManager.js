const STORAGE_KEY = 'solaris_keybinds_v1';

export const DEFAULT_KEYBINDS = {
  thrustFwd: 'KeyW',
  thrustBack: 'KeyS',
  strafeLeft: 'KeyA',
  strafeRight: 'KeyD',
  thrustUp: 'Space',
  thrustDown: 'KeyC',
  rollLeft: 'KeyQ',
  rollRight: 'KeyE',
  boost: 'ShiftLeft',
  firePrimary: 'Mouse0',
  fireSecondary: 'Mouse2',
  missiles: 'KeyF',
  emp: 'KeyX',
  aimAssist: 'KeyB',
  autoTrack: 'KeyT',
  overdrive: 'KeyZ',
  warp: 'KeyG',
  starmap: 'KeyM',
  camera: 'KeyV',
  help: 'KeyH',
  mute: 'KeyU',
  keybinds: 'KeyK',
  settings: 'KeyO',
  gestureToggle: 'KeyN',
  gestureCalibrate: 'KeyJ',
};

export const KEYBIND_META = [
  { group: '飞行机动', action: 'thrustFwd', label: '主推进加速' },
  { group: '飞行机动', action: 'thrustBack', label: '减速 / 倒推' },
  { group: '飞行机动', action: 'strafeLeft', label: '左向平移' },
  { group: '飞行机动', action: 'strafeRight', label: '右向平移' },
  { group: '飞行机动', action: 'thrustUp', label: '垂直上升' },
  { group: '飞行机动', action: 'thrustDown', label: '垂直下降' },
  { group: '飞行机动', action: 'rollLeft', label: '左滚转' },
  { group: '飞行机动', action: 'rollRight', label: '右滚转' },
  { group: '飞行机动', action: 'boost', label: '聚变脉冲加速' },

  { group: '武器火控', action: 'firePrimary', label: '双联脉冲激光' },
  { group: '武器火控', action: 'fireSecondary', label: '舰首伽马粒子光矛' },
  { group: '武器火控', action: 'missiles', label: '发射蜂群导弹' },
  { group: '武器火控', action: 'emp', label: '释放 EMP 震荡波' },
  { group: '武器火控', action: 'aimAssist', label: '切换辅助瞄准强度' },
  { group: '武器火控', action: 'autoTrack', label: '按住跟瞄敌舰' },
  { group: '武器火控', action: 'overdrive', label: '启动恒星聚变超载' },

  { group: '导航与系统', action: 'warp', label: '启动 / 脱离曲率跃迁' },
  { group: '导航与系统', action: 'starmap', label: '打开太阳系星图' },
  { group: '导航与系统', action: 'camera', label: '切换机位视角' },
  { group: '导航与系统', action: 'help', label: '操作指南面板' },
  { group: '导航与系统', action: 'mute', label: '音效静音切换' },
  { group: '导航与系统', action: 'keybinds', label: '键位设置面板' },
  { group: '导航与系统', action: 'settings', label: '操控设置面板' },
  { group: '导航与系统', action: 'gestureToggle', label: '切换双手手势飞控' },
  { group: '导航与系统', action: 'gestureCalibrate', label: '手势中立位重新校准' },
];

export function formatKeyCode(code) {
  if (!code) return '-';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const map = {
    Mouse0: '鼠标左键',
    Mouse1: '鼠标中键',
    Mouse2: '鼠标右键',
    Mouse3: '鼠标侧键(后退)',
    Mouse4: '鼠标侧键(前进)',
    WheelUp: '滚轮上滚',
    WheelDown: '滚轮下滚',
    Space: 'Space',
    ShiftLeft: 'Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'Alt',
    AltRight: 'R-Alt',
    Tab: 'Tab',
    Enter: 'Enter',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  return map[code] || code;
}

const MENU_SAFE_ONLY_ACTIONS = new Set(['settings', 'keybinds', 'starmap', 'gestureToggle', 'gestureCalibrate']);
const RESERVED_CODES = new Set(['Escape', 'Tab']);
const MIGRATION_FALLBACK_KEYS = ['KeyO', 'F2', 'F3', 'F4', 'Backquote', 'BracketLeft', 'BracketRight', 'Semicolon', 'Comma', 'Period', 'Slash', 'KeyJ', 'KeyN', 'KeyL', 'KeyP', 'KeyY'];
const NEWLY_ADDED_ACTIONS = ['settings', 'gestureToggle', 'gestureCalibrate'];

export class KeybindManager {
  constructor() {
    this.bindings = { ...DEFAULT_KEYBINDS };
    this.listeners = new Set();
    this._load();
  }

  static isCodeAllowedForAction(action, code) {
    if (!code || RESERVED_CODES.has(code)) return false;
    if (MENU_SAFE_ONLY_ACTIONS.has(action)) {
      if (code.startsWith('Mouse') || code === 'WheelUp' || code === 'WheelDown') {
        return false;
      }
    }
    return true;
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      let migrated = false;

      // Legacy actions get precedence before newly introduced actions (such as settings / gesture controls)
      const newSet = new Set(NEWLY_ADDED_ACTIONS);
      const orderedActions = [
        ...Object.keys(DEFAULT_KEYBINDS).filter((k) => !newSet.has(k)),
        ...NEWLY_ADDED_ACTIONS.filter((k) => Object.hasOwn(DEFAULT_KEYBINDS, k)),
      ];
      const usedCodes = new Set();
      const pendingMigration = [];

      for (const action of orderedActions) {
        const candidate = parsed[action];
        if (
          typeof candidate === 'string' &&
          candidate.length > 0 &&
          KeybindManager.isCodeAllowedForAction(action, candidate) &&
          !usedCodes.has(candidate)
        ) {
          this.bindings[action] = candidate;
          usedCodes.add(candidate);
        } else {
          pendingMigration.push(action);
          if (candidate !== undefined) migrated = true;
        }
      }

      for (const action of pendingMigration) {
        const defCode = DEFAULT_KEYBINDS[action];
        if (KeybindManager.isCodeAllowedForAction(action, defCode) && !usedCodes.has(defCode)) {
          this.bindings[action] = defCode;
          usedCodes.add(defCode);
        } else {
          const free = MIGRATION_FALLBACK_KEYS.find(
            (c) => !usedCodes.has(c) && KeybindManager.isCodeAllowedForAction(action, c)
          );
          if (free) {
            this.bindings[action] = free;
            usedCodes.add(free);
            migrated = true;
          }
        }
      }

      if (migrated) this._save();
    } catch (_) {}
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (_) {}
  }

  getCode(action) {
    return this.bindings[action] || DEFAULT_KEYBINDS[action];
  }

  getLabel(action) {
    return formatKeyCode(this.getCode(action));
  }

  setBinding(action, newCode) {
    if (!DEFAULT_KEYBINDS[action] || !newCode) return false;
    if (!KeybindManager.isCodeAllowedForAction(action, newCode)) {
      this._notify();
      return false;
    }
    const prevCode = this.bindings[action];
    // Verify any swapped action would also accept prevCode cleanly
    for (const [otherAction, otherCode] of Object.entries(this.bindings)) {
      if (otherAction !== action && otherCode === newCode) {
        if (!KeybindManager.isCodeAllowedForAction(otherAction, prevCode)) {
          this._notify();
          return false;
        }
      }
    }
    for (const [otherAction, otherCode] of Object.entries(this.bindings)) {
      if (otherAction !== action && otherCode === newCode) {
        this.bindings[otherAction] = prevCode;
      }
    }
    this.bindings[action] = newCode;
    this._save();
    this._notify();
    return true;
  }

  resetDefaults() {
    this.bindings = { ...DEFAULT_KEYBINDS };
    this._save();
    this._notify();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  _notify() {
    for (const fn of this.listeners) fn(this);
  }
}
