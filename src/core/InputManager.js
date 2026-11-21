export class InputManager {
  constructor(domElement, keybinds = null) {
    this.domElement = domElement;
    this.keybinds = keybinds;
    this.keys = new Set();
    this.justPressed = new Set();

    // Virtual flight stick [-1, 1] separated cleanly between mouse and gamepad sources
    this.mouseAimX = 0;
    this.mouseAimY = 0;
    this.gpAimX = 0;
    this.gpAimY = 0;
    this.aimX = 0;
    this.aimY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.camZoomDelta = 0;
    this.pointerLocked = false;
    this.captureTab = false;
    this.onLockDenied = null;

    this.mouseButtons = {
      left: false,
      right: false,
    };

    this.enabled = false;
    this._captureCallback = null;
    this._captureCancel = null;
    this._captureArmed = false;

    this._gpDown = new Set();
    this._gpPrevDown = new Set();
    this._gpJustPressed = new Set();

    this._bindEvents();
  }

  _syncAim() {
    this.aimX = Math.max(-1, Math.min(1, this.mouseAimX + this.gpAimX));
    this.aimY = Math.max(-1, Math.min(1, this.mouseAimY + this.gpAimY));
  }

  startKeyCapture(onCaptured, onCancel) {
    this._captureCallback = onCaptured;
    this._captureCancel = onCancel;
    this._captureArmed = false;
    setTimeout(() => {
      if (this._captureCallback === onCaptured) {
        this._captureArmed = true;
      }
    }, 30);
  }

  stopKeyCapture() {
    this._captureCallback = null;
    this._captureCancel = null;
    this._captureArmed = false;
  }

  _finishCapture(code) {
    const cb = this._captureCallback;
    this.stopKeyCapture();
    cb?.(code);
  }

  _bindEvents() {
    window.addEventListener('keydown', (e) => {
      if (this._captureCallback) {
        e.preventDefault();
        e.stopPropagation();
        const cancel = this._captureCancel;
        if (e.code === 'Escape') {
          this.stopKeyCapture();
          cancel?.();
        } else if (this._captureArmed) {
          this._finishCapture(e.code);
        }
        return;
      }

      if ((e.code === 'Tab' && (this.enabled || this.captureTab)) || (this.enabled && (e.code === 'AltLeft' || e.code === 'AltRight'))) {
        e.preventDefault();
      }
      if (!this.keys.has(e.code)) {
        this.justPressed.add(e.code);
      }
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this._gpDown.clear();
      this._gpPrevDown.clear();
      this._gpJustPressed.clear();
      this.mouseButtons.left = false;
      this.mouseButtons.right = false;
      this.mouseAimX = 0;
      this.mouseAimY = 0;
      this.gpAimX = 0;
      this.gpAimY = 0;
      this.aimX = 0;
      this.aimY = 0;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
      // Always discard queued delta/aim residue across lock transitions to prevent 1-frame camera spins
      this.deltaX = 0;
      this.deltaY = 0;
      this.mouseAimX = 0;
      this.mouseAimY = 0;
      this._syncAim();
    });

    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
      this.onLockDenied?.();
    });

    // Global capture-phase mouse handler for middle click, side buttons (Mouse3/Mouse4), and keybind capture
    window.addEventListener(
      'mousedown',
      (e) => {
        if (this._captureCallback) {
          if (this._captureArmed) {
            e.preventDefault();
            e.stopPropagation();
            this._finishCapture(`Mouse${e.button}`);
          }
          return;
        }

        if (!this.enabled) return;

        // Prevent browser side-button back/forward navigation, middle-click autoscroll, and right-drag gestures
        if (e.button === 1 || e.button === 2 || e.button === 3 || e.button === 4) {
          e.preventDefault();
        }

        const mCode = `Mouse${e.button}`;
        if (!this.keys.has(mCode)) {
          this.justPressed.add(mCode);
        }
        this.keys.add(mCode);

        if (e.button === 0) {
          this.mouseButtons.left = true;
          if (!this.pointerLocked && this.domElement.requestPointerLock && e.target === this.domElement) {
            this.requestLock();
          }
        } else if (e.button === 2) {
          this.mouseButtons.right = true;
          if (!this.pointerLocked && this.domElement.requestPointerLock && e.target === this.domElement) {
            this.requestLock();
          }
        }
      },
      { capture: true }
    );

    window.addEventListener(
      'mouseup',
      (e) => {
        if (e.button === 1 || e.button === 2 || e.button === 3 || e.button === 4) {
          if (this.enabled || this._captureCallback) e.preventDefault();
        }
        this.keys.delete(`Mouse${e.button}`);
        if (e.button === 0) this.mouseButtons.left = false;
        if (e.button === 2) this.mouseButtons.right = false;
      },
      { capture: true }
    );

    window.addEventListener(
      'auxclick',
      (e) => {
        if (this.enabled || this._captureCallback) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true }
    );

    window.addEventListener(
      'contextmenu',
      (e) => {
        if (this.enabled || this._captureCallback) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true }
    );

    window.addEventListener(
      'dragstart',
      (e) => {
        if (this.enabled || this._captureCallback) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true }
    );

    window.addEventListener(
      'wheel',
      (e) => {
        if (this._captureCallback && this._captureArmed) {
          e.preventDefault();
          e.stopPropagation();
          this._finishCapture(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
          return;
        }
        if (this.enabled && Math.abs(e.deltaY) > 1) {
          const wheelDir = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
          this.justPressed.add(wheelDir);
          const wheelBound =
            this.keybinds &&
            Object.values(this.keybinds.bindings).some((c) => c === 'WheelUp' || c === 'WheelDown');
          if (!wheelBound) {
            this.camZoomDelta += Math.sign(e.deltaY) * 1.4;
          }
        }
      },
      { passive: false, capture: true }
    );

    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked) {
        // Filter out Chromium Windows Pointer Lock cursor-warp outlier spikes (>260px in a single event)
        if (Math.abs(e.movementX) > 260 || Math.abs(e.movementY) > 260) return;
        const mx = Math.max(-120, Math.min(120, e.movementX));
        const my = Math.max(-120, Math.min(120, e.movementY));
        this.deltaX += mx;
        this.deltaY += my;
        this.mouseAimX = Math.max(-1, Math.min(1, this.mouseAimX + mx * 0.0028));
        this.mouseAimY = Math.max(-1, Math.min(1, this.mouseAimY + my * 0.0028));
      } else {
        if (e.target !== this.domElement) return;
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        const nx = (e.clientX / w) * 2 - 1;
        const ny = (e.clientY / h) * 2 - 1;
        this.mouseAimX = Math.max(-1, Math.min(1, nx * 1.15));
        this.mouseAimY = Math.max(-1, Math.min(1, ny * 1.15));
      }
      this._syncAim();
    });
  }

  resetAim() {
    this.mouseAimX = 0;
    this.mouseAimY = 0;
    this.gpAimX = 0;
    this.gpAimY = 0;
    this.aimX = 0;
    this.aimY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
  }

  get orbitLookActive() {
    return this.keys.has('AltLeft') || this.keys.has('AltRight');
  }

  requestLock() {
    if (this.domElement.requestPointerLock) {
      try {
        const p = this.domElement.requestPointerLock();
        if (p && typeof p.catch === 'function') {
          p.catch(() => this.onLockDenied?.());
        }
      } catch (_) {
        this.onLockDenied?.();
      }
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.domElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
    this.mouseButtons.left = false;
    this.mouseButtons.right = false;
    this.gpAimX = 0;
    this.gpAimY = 0;
    this._syncAim();
    for (let b = 0; b <= 5; b++) this.keys.delete(`Mouse${b}`);
  }

  consumeJustPressed(code) {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  isActionDown(action) {
    if (this._gpDown.has(action)) return true;
    const code = this.keybinds ? this.keybinds.getCode(action) : null;
    if (!code) return false;
    if (code === 'ShiftLeft' && this.keys.has('ShiftRight')) return true;
    return this.keys.has(code);
  }

  consumeAction(action) {
    if (this._gpJustPressed.has(action)) {
      this._gpJustPressed.delete(action);
      return true;
    }
    const code = this.keybinds ? this.keybinds.getCode(action) : null;
    if (!code) return false;
    if (code === 'ShiftLeft' && this.consumeJustPressed('ShiftRight')) return true;
    return this.consumeJustPressed(code);
  }

  pollGamepad(dt) {
    this._gpDown.clear();
    if (!this.enabled || typeof navigator === 'undefined' || !navigator.getGamepads) {
      this._gpPrevDown.clear();
      this._gpJustPressed.clear();
      if (this.gpAimX !== 0 || this.gpAimY !== 0) {
        this.gpAimX = 0;
        this.gpAimY = 0;
        this._syncAim();
      }
      return;
    }
    const pads = navigator.getGamepads();
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    if (!gp) {
      this._gpPrevDown.clear();
      this._gpJustPressed.clear();
      if (this.gpAimX !== 0 || this.gpAimY !== 0) {
        this.gpAimX = 0;
        this.gpAimY = 0;
        this._syncAim();
      }
      return;
    }

    const dead = 0.16;
    const ax0 = Math.abs(gp.axes[0] || 0) > dead ? gp.axes[0] : 0;
    const ax1 = Math.abs(gp.axes[1] || 0) > dead ? gp.axes[1] : 0;
    const ax2 = Math.abs(gp.axes[2] || 0) > dead ? gp.axes[2] : 0;
    const ax3 = Math.abs(gp.axes[3] || 0) > dead ? gp.axes[3] : 0;

    if (ax0 < -0.32) this._gpDown.add('strafeLeft');
    if (ax0 > 0.32) this._gpDown.add('strafeRight');
    if (ax1 < -0.32) this._gpDown.add('thrustFwd');
    if (ax1 > 0.32) this._gpDown.add('thrustBack');

    if (ax2 !== 0 || ax3 !== 0) {
      const rate = 680 * dt;
      this.deltaX += ax2 * rate;
      this.deltaY += ax3 * rate;
      this.gpAimX = Math.max(-1, Math.min(1, ax2));
      this.gpAimY = Math.max(-1, Math.min(1, ax3));
    } else {
      this.gpAimX = 0;
      this.gpAimY = 0;
    }
    this._syncAim();

    const btnMap = [
      [7, 'firePrimary'],
      [6, 'fireSecondary'],
      [0, 'boost'],
      [1, 'missiles'],
      [2, 'emp'],
      [3, 'overdrive'],
      [4, 'rollLeft'],
      [5, 'rollRight'],
    ];
    for (const [idx, act] of btnMap) {
      const b = gp.buttons[idx];
      if (b && (b.pressed || b.value > 0.35)) {
        this._gpDown.add(act);
        if (!this._gpPrevDown.has(act)) {
          this._gpJustPressed.add(act);
        }
      }
    }
    this._gpPrevDown = new Set(this._gpDown);
  }

  endFrame(dt) {
    this.justPressed.clear();
    this._gpJustPressed.clear();
    this.deltaX = 0;
    this.deltaY = 0;
    this.camZoomDelta = 0;
    if (this.pointerLocked) {
      const decay = Math.exp(-5.0 * dt);
      this.mouseAimX *= decay;
      this.mouseAimY *= decay;
      this._syncAim();
    }
  }

  isDown(code) {
    return this.keys.has(code);
  }
}
