export class UpgradeUI {
  constructor(upgradeSystem, onPicked) {
    this.upgradeSystem = upgradeSystem;
    this.onPicked = onPicked;

    this.overlay = document.getElementById('upgrade-overlay');
    this.cardsEl = document.getElementById('upgrade-cards');
    this.subtitleEl = document.getElementById('upgrade-subtitle');

    this.isOpen = false;
    this.choices = [];
  }

  open() {
    this.choices = this.upgradeSystem.rollChoices(3);
    if (this.choices.length === 0) {
      this.upgradeSystem.pendingDrafts = 0;
      return false;
    }
    this.isOpen = true;
    this.subtitleEl.textContent = `自然选择号战舰等级 LV.${this.upgradeSystem.level} — 请选择一项聚变与火控强化模块（按 [1] [2] [3] 或点击部署）`;
    this.cardsEl.innerHTML = '';

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
      `;
      card.addEventListener('click', () => this.pickIndex(idx));
      this.cardsEl.appendChild(card);
    });

    this.overlay.classList.remove('hidden');
    return true;
  }

  pickIndex(idx) {
    if (!this.isOpen || idx < 0 || idx >= this.choices.length) return;
    const picked = this.choices[idx];
    this.close();
    this.upgradeSystem.pendingDrafts = Math.max(0, this.upgradeSystem.pendingDrafts - 1);
    this.onPicked?.(picked);
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
    this.overlay.classList.add('hidden');
  }
}
