export class UpgradeUI {
  constructor(upgradeSystem, onPicked) {
    this.upgradeSystem = upgradeSystem;
    this.onPicked = onPicked;

    this.overlay = document.getElementById('upgrade-overlay');
    this.cardsEl = document.getElementById('upgrade-cards');
    this.subtitleEl = document.getElementById('upgrade-subtitle');

    this.isOpen = false;
    this.choices = [];
    this.draftVersion = 0;
    this._cardEls = [];
    this._gestureBannerEl = document.getElementById('upgrade-gesture-banner');
  }

  open() {
    this.choices = this.upgradeSystem.rollChoices(3);
    if (this.choices.length === 0) {
      this.upgradeSystem.pendingDrafts = 0;
      return false;
    }
    this.isOpen = true;
    this.draftVersion += 1;
    this._cardEls = [];
    this.subtitleEl.textContent = `自然选择号战舰等级 LV.${this.upgradeSystem.level} — 请选择一项聚变与火控强化模块（按 [1] [2] [3] 或点击部署）`;
    this.cardsEl.innerHTML = '';
    this._gestureBannerEl?.classList.add('hidden');
    const version = this.draftVersion;

    this.choices.forEach((item, idx) => {
      const curLv = this.upgradeSystem.getLevel(item.id);
      const card = document.createElement('button');
      card.className = 'upgrade-card';
      card.style.setProperty('--u-accent', item.color);
      card.innerHTML = `
        <div class="upgrade-card-top">
          <span class="upgrade-tag">${item.tag}</span>
          <span class="upgrade-hotkey">[${idx + 1}]</span>
        </div>
        <h3 class="upgrade-name">${item.name}</h3>
        <div class="upgrade-lv">LV.${curLv} &rarr; <strong>LV.${curLv + 1}</strong></div>
        <p class="upgrade-desc">${item.desc}</p>
        ${this._renderSynergyHint(item)}
        <div class="upgrade-cta">部署此模块</div>
        <div class="upgrade-hold-track"><div class="upgrade-hold-fill"></div></div>
      `;
      card.addEventListener('click', () => this.pickIndex(idx, version));
      this.cardsEl.appendChild(card);
      this._cardEls.push(card);
    });

    this.overlay.classList.remove('hidden');
    return true;
  }

  pickIndex(idx, expectedVersion = null) {
    if (!this.isOpen || idx < 0 || idx >= this.choices.length) return false;
    if (expectedVersion !== null && expectedVersion !== this.draftVersion) return false;
    const picked = this.choices[idx];
    this.close();
    this.upgradeSystem.pendingDrafts = Math.max(0, this.upgradeSystem.pendingDrafts - 1);
    this.onPicked?.(picked);
    return true;
  }

  setGestureState(snapshot, controlMode = 'KBM') {
    const clearCards = () => {
      for (const card of this._cardEls) {
        card.classList.remove('gesture-candidate', 'gesture-committed');
        const fill = card.querySelector('.upgrade-hold-fill');
        if (fill) fill.style.width = '0%';
      }
    };

    if (controlMode !== 'GESTURE' || !this.isOpen) {
      clearCards();
      this._gestureBannerEl?.classList.add('hidden');
      return;
    }

    const sel = snapshot?.upgradeSelection || null;
    const candIdx = sel?.unlocked && Number.isInteger(sel.candidateIndex) ? sel.candidateIndex : -1;
    const commitIdx = Number.isInteger(sel?.committedIndex) ? sel.committedIndex : -1;
    const progressPct = Math.round(Math.max(0, Math.min(1, Number(sel?.holdProgress) || 0)) * 100);

    this._cardEls.forEach((card, idx) => {
      const isCand = idx === candIdx;
      const isCommit = idx === commitIdx;
      card.classList.toggle('gesture-candidate', isCand);
      card.classList.toggle('gesture-committed', isCommit);
      const fill = card.querySelector('.upgrade-hold-fill');
      if (fill) {
        fill.style.width = isCommit ? '100%' : isCand ? `${progressPct}%` : '0%';
      }
    });

    if (this._gestureBannerEl) {
      let msg;
      const opsLost = !snapshot || snapshot.phase === 'LOST' || snapshot.phase === 'LOST_GRACE'
        || (snapshot.opsStatus && !snapshot.opsStatus.tracked);
      if (snapshot?.crossingGuard) {
        msg = '双手交叉保护中：请分开双手，再由操作手张掌解锁选卡（鼠标点击 / [1][2][3] 仍可用）';
      } else if (opsLost) {
        msg = '未检测到操作手：请将操作手置于摄像头画面内并先张掌解锁（鼠标点击 / [1][2][3] 仍可用）';
      } else if (!sel?.unlocked) {
        msg = '双手选卡就绪：请先由操作手张掌解锁，再伸出 1 / 2 / 3 指确认部署（支持鼠标 / [1][2][3]）';
      } else if (candIdx >= 0 && candIdx < this.choices.length) {
        const pickedName = this.choices[candIdx]?.name || `模块 ${candIdx + 1}`;
        msg = `操作手已指向 [${candIdx + 1}]「${pickedName}」· 稳留确认 ${progressPct}%（张掌或换手势可撤销）`;
      } else {
        msg = '操作手已解锁：伸出 1 / 2 / 3 根手指选择对应模块（稳留 0.65s 部署，张掌撤销）';
      }
      this._gestureBannerEl.textContent = msg;
      this._gestureBannerEl.classList.remove('hidden');
    }
  }

  // Dual-core synergy hint badge under the card description (contract E-2 getCandidateSynergies)
  _renderSynergyHint(item) {
    const list = this.upgradeSystem.getCandidateSynergies?.(item.id);
    if (!Array.isArray(list) || list.length === 0) return '';
    return list
      .map((s) => {
        const accent = s.color || '#ffd95e';
        let label;
        if (s.unlocked) {
          label = `羁绊已激活 · ${s.name}`;
        } else if (s.readyToUnlock) {
          label = `◆ 选此卡即可解锁羁绊 · ${s.name}`;
        } else {
          const partners = Array.isArray(s.missing) && s.missing.length > 0 ? s.missing.join(' / ') : s.requires?.join(' + ') || '';
          label = `羁绊线索 · ${s.name}${partners ? `（需搭配 ${partners}）` : ''}`;
        }
        return `<div class="upgrade-synergy-hint${s.readyToUnlock && !s.unlocked ? ' is-ready' : ''}" style="--s-accent:${accent}">${label}</div>`;
      })
      .join('');
  }

  close() {
    this.isOpen = false;
    this._cardEls = [];
    this._gestureBannerEl?.classList.add('hidden');
    this.overlay.classList.add('hidden');
  }
}
