import { KEYBIND_META } from '../core/KeybindManager.js';

export class KeybindUI {
  constructor(keybinds, input, onClose) {
    this.keybinds = keybinds;
    this.input = input;
    this.onClose = onClose;

    this.overlay = document.getElementById('keybinds-overlay');
    this.listEl = document.getElementById('keybinds-list');
    this.btnReset = document.getElementById('btn-reset-keys');
    this.btnClose = document.getElementById('btn-close-keys');

    this.isOpen = false;
    this.listeningAction = null;

    this._bindEvents();
    this.render();
    this.syncDynamicHints();
    this.keybinds.onChange(() => {
      this.render();
      this.syncDynamicHints();
    });
  }

  _bindEvents() {
    this.btnClose.addEventListener('click', () => {
      this.input.stopKeyCapture();
      this.listeningAction = null;
      this.onClose?.();
    });

    this.btnReset.addEventListener('click', () => {
      this.input.stopKeyCapture();
      this.listeningAction = null;
      this.keybinds.resetDefaults();
    });
  }

  open() {
    this.isOpen = true;
    this.listeningAction = null;
    this.overlay.classList.remove('hidden');
    this.render();
  }

  close() {
    this.isOpen = false;
    this.listeningAction = null;
    this.input.stopKeyCapture();
    this.overlay.classList.add('hidden');
  }

  render() {
    this.listEl.innerHTML = '';
    const groups = ['飞行机动', '武器火控', '导航与系统'];

    for (const gName of groups) {
      const groupWrap = document.createElement('div');
      groupWrap.className = 'kb-group';
      groupWrap.innerHTML = `<div class="kb-group-title">${gName}</div>`;

      for (const item of KEYBIND_META.filter((m) => m.group === gName)) {
        const row = document.createElement('div');
        row.className = 'kb-row';

        const lbl = document.createElement('span');
        lbl.textContent = item.label;

        const btn = document.createElement('button');
        btn.className = 'kb-key-btn';
        btn.dataset.action = item.action;
        if (this.listeningAction === item.action) {
          btn.classList.add('listening');
          btn.textContent = '请按下新按键...';
        } else {
          btn.textContent = this.keybinds.getLabel(item.action);
        }

        btn.addEventListener('click', () => {
          this.listeningAction = item.action;
          this.render();
          this.input.startKeyCapture(
            (newCode) => {
              this.listeningAction = null;
              this.keybinds.setBinding(item.action, newCode);
            },
            () => {
              this.listeningAction = null;
              this.render();
            }
          );
        });

        row.appendChild(lbl);
        row.appendChild(btn);
        groupWrap.appendChild(row);
      }

      this.listEl.appendChild(groupWrap);
    }
  }

  syncDynamicHints() {
    const kb = this.keybinds;
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    set('btn-starmap', `[${kb.getLabel('starmap')}] 星图`);
    set('btn-help', `[${kb.getLabel('help')}] 操作`);
    set('btn-keybinds', `[${kb.getLabel('keybinds')}] 键位`);
    set('btn-settings', `[${kb.getLabel('settings')}] 设置`);

    // Mute button keeps its current muted / unmuted wording while refreshing the hotkey prefix
    const muteBtn = document.getElementById('btn-mute');
    if (muteBtn) {
      const wasMuted = muteBtn.textContent.includes('已静音');
      muteBtn.textContent = wasMuted
        ? `[${kb.getLabel('mute')}] 已静音`
        : `[${kb.getLabel('mute')}] 音效`;
    }

    const gestureBtn = document.getElementById('btn-gesture-mode');
    if (gestureBtn) {
      const active = gestureBtn.classList.contains('active-toggle');
      gestureBtn.textContent = active
        ? `[${kb.getLabel('gestureToggle')}] 手势: 开`
        : `[${kb.getLabel('gestureToggle')}] 手势飞控`;
    }
    set('btn-gesture-cal', `[${kb.getLabel('gestureCalibrate')}] 校准`);
    set('btn-gesture-exit', `[${kb.getLabel('gestureToggle')}] 退出`);

    const isGestureActive = Boolean(document.getElementById('hud-root')?.classList.contains('gesture-active'));
    if (!isGestureActive) {
      set('lbl-boost-key', `脉冲电容 BOOST [${kb.getLabel('boost')}]`);
      set('lbl-primary-key', `[${kb.getLabel('firePrimary')}] 双联脉冲激光`);
      set('lbl-secondary-key', `[${kb.getLabel('fireSecondary')} / R] 伽马粒子光矛`);
      set('lbl-missile-key', `[${kb.getLabel('missiles')}] 蜂群追踪导弹`);
      set('lbl-emp-key', `[${kb.getLabel('emp')}] EMP 震荡波`);
    }
    set('lbl-overdrive-key', `[${kb.getLabel('overdrive')}] 恒星超载`);

    const strip = document.getElementById('title-controls-strip');
    if (strip) {
      strip.innerHTML = `
        <div><kbd>鼠标</kbd> 航向俯仰</div>
        <div><kbd>${kb.getLabel('thrustFwd')} ${kb.getLabel('strafeLeft')} ${kb.getLabel('thrustBack')} ${kb.getLabel('strafeRight')}</kbd> 推进与平移</div>
        <div><kbd>${kb.getLabel('thrustUp')}</kbd>/<kbd>${kb.getLabel('thrustDown')}</kbd> 升降 · <kbd>${kb.getLabel('rollLeft')}</kbd>/<kbd>${kb.getLabel('rollRight')}</kbd> 滚转</div>
        <div><kbd>${kb.getLabel('boost')}</kbd> 聚变脉冲加速</div>
        <div><kbd>${kb.getLabel('firePrimary')}</kbd> 脉冲激光 · <kbd>${kb.getLabel('fireSecondary')}</kbd>/<kbd>R</kbd> 光矛</div>
        <div><kbd>${kb.getLabel('missiles')}</kbd> 蜂群导弹 · <kbd>${kb.getLabel('emp')}</kbd> EMP 震荡</div>
        <div><kbd>${kb.getLabel('aimAssist')}</kbd> 辅助瞄准 · <kbd>${kb.getLabel('autoTrack')}</kbd> 按住跟瞄</div>
        <div><kbd>${kb.getLabel('warp')}</kbd> 曲率跃迁 · <kbd>${kb.getLabel('starmap')}</kbd> 太阳系星图</div>
        <div><kbd>${kb.getLabel('camera')}</kbd> 切换视角 · <kbd>${kb.getLabel('gestureToggle')}</kbd> 手势飞控</div>
      `;
    }

    const helpGrid = document.getElementById('help-manual-grid');
    if (helpGrid) {
      helpGrid.innerHTML = `
        <div class="help-section-tag">飞行与姿态控制</div>
        <div class="help-kv"><kbd>鼠标移动</kbd><span>航向俯仰操控（点击画面锁定准星）</span></div>
        <div class="help-kv"><kbd>${kb.getLabel('thrustFwd')} ${kb.getLabel('strafeLeft')} ${kb.getLabel('thrustBack')} ${kb.getLabel('strafeRight')}</kbd><span>主推进悬停与侧向平移</span></div>
        <div class="help-kv"><kbd>${kb.getLabel('thrustUp')}</kbd> / <kbd>${kb.getLabel('thrustDown')}</kbd> · <kbd>${kb.getLabel('rollLeft')}</kbd> / <kbd>${kb.getLabel('rollRight')}</kbd><span>垂直升降 · 滚转机动</span></div>
        <div class="help-kv"><kbd>${kb.getLabel('boost')}</kbd><span>聚变脉冲加速（规避高速突刺）</span></div>

        <div class="help-section-tag">武器与火控系统</div>
        <div class="help-kv"><kbd>${kb.getLabel('firePrimary')}</kbd> · <kbd>${kb.getLabel('fireSecondary')}</kbd> / <kbd>R</kbd><span>双联脉冲激光 · 舰首伽马光矛</span></div>
        <div class="help-kv"><kbd>${kb.getLabel('aimAssist')}</kbd> · <kbd>${kb.getLabel('autoTrack')}</kbd><span>切换辅瞄 · 按住自动跟瞄</span></div>
        <div class="help-kv"><kbd>${kb.getLabel('missiles')}</kbd> · <kbd>${kb.getLabel('emp')}</kbd><span>蜂群导弹 · EMP 破防脉冲</span></div>
        <div class="help-kv"><kbd>${kb.getLabel('overdrive')}</kbd> · <kbd>双击 A/D</kbd><span>恒星超载 · 无敌相位翻滚</span></div>

        <div class="help-section-tag">导航与视界切换</div>
        <div class="help-kv"><kbd>${kb.getLabel('starmap')}</kbd> · <kbd>${kb.getLabel('warp')}</kbd><span>全息星图 · 启动曲率跃迁</span></div>
        <div class="help-kv"><kbd>${kb.getLabel('camera')}</kbd> · <kbd>${kb.getLabel('keybinds')}</kbd> · <kbd>${kb.getLabel('mute')}</kbd><span>切换视角 · 改键 · 静音</span></div>
        <div class="help-kv"><kbd>${kb.getLabel('gestureToggle')}</kbd> · <kbd>${kb.getLabel('gestureCalibrate')}</kbd><span>切换双手手势飞控 · 重校飞控手中立位</span></div>
        <div class="help-kv"><kbd>Alt+鼠标</kbd> / <kbd>滚轮</kbd><span>环绕观舰（松开回位）· 视距</span></div>

        <div class="help-section-tag">双手摄像头手势飞控（默认左手方向控，右手火控）</div>
        <div class="help-kv"><kbd>飞控手（默认左手）</kbd><span>张掌朝镜头停止 · 半握巡航(2000~3000速) · 越握越快 · 五指/拳头摆动控制方向 · 仅伸1指原地精瞄</span></div>
        <div class="help-kv"><kbd>全拳冲刺与翻滚</kbd><span>左手握紧全拳直接触发冲刺 · 伸拇指向左右转触发桶滚闪避（均与右手武器并行）</span></div>
        <div class="help-kv"><kbd>操作手（默认右手）</kbd><span>右手独立开火：握拳普攻 · 1指光矛 · 2指导弹 · 3指EMP</span></div>
        <div class="help-kv"><kbd>跃迁与升级选卡</kbd><span>右手拇指+食指捏住 0.45s 向锁定行星跃迁 · 升级三选一张掌解锁后 1/2/3 指部署（[O] 可切左右手）</span></div>
      `;
    }
  }
}
