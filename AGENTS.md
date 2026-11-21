# AGENTS.md — 《自然选择号：太阳系防线》多 Agent 协同开发与交接指南

> 本文件直接置于 `natural-selection-solar` 项目根目录，供 Codex 及各类多智能体（Multi-Agent）协同开发时自动读取与对齐架构、文件所有权与技术红线。

---

## 1. 项目总览

- **项目名称**：《自然选择号：太阳系防线》（*NATURAL SELECTION · SOLARIS PROTOCOL*）
- **项目根目录**：`c:\Users\LCB\Desktop\gpt、Gemini、ds\natural-selection-solar`
- **上游参考文件**（位于上一级工作区目录）：
  - `..\总工程书.md`（v3.0 3A 质量级架构与协同契约规范）
  - `..\worklogs\BOARD_STATUS.md` & `REPORT_*.md`（协同看板与三方验证日志）
- **技术栈**：纯原生 ES Modules + **Three.js `^0.174.0`** + **Vite `^6.2.0`**（零前端框架）+ **Electron `^45.4.1`**（跨平台离线桌面应用壳）；全息 DOM/CSS 界面 + Canvas 2D 仪表盘/雷达/星图 + 纯 Web Audio API DSP 2-op FM/谐波音效与自适应配乐。
- **代码与资产规模（v4.2 实测）**：
  - `src/` 含 **24 个 `.js` 模块共 13,419 行** + `styles.css`，外加 `electron/main.cjs` 离线主进程、`index.html`、`vite.config.js` 与 `scripts/` 2 个 Python 工具脚本
  - `public/assets/` 含 Draco 压缩舰船模型 `natural_selection.glb` 与 **16 张 2K–6K WebP 贴图**（NASA/ESO 实拍行星/太阳/银河等）+ `public/draco/gltf/` 解码器
- **当前 v4.2 AAA 交付状态**：
  - 在 v4.0 全链路玩法与 3A 全息 UI/座舱基础上，v4.2 完成了 Stage 5 **纯激光零穿模与全武器特效升级**（前向十字光带/聚能星芒、双螺旋光矛+灼点、16 段三维导弹网格尾迹、六边形 EMP 穹顶与 8 电弧、恒星超载脉冲）、**AudioEngine 2-op FM+滤波谐波重构**（彻底消除高频白噪“喷水/尿尿”感与 WaveShaper 直流偏置、四档命中反馈零白噪），并封装为 **跨电脑免浏览器离线桌面应用**（Windows 单文件便携版 `release/NaturalSelectionSolar-Portable-x64.exe` 实机 `app://solaris/index.html` 跑通 `p50 163.9 FPS` / 0 报错，同时内置 macOS 构建配置与 GitHub Actions 工作流）。

---

## 2. 目录结构与模块清单

### 2.1 根目录与工具脚本
| 路径 | 说明 |
| :--- | :--- |
| `index.html` | 页面骨架（373 行）：内联深空矢量 Favicon、`#fp-transition-veil` 切镜遮罩、标题页/装备构型选择器、模式/画质切换、`.top-left-stack` 全息战斗 HUD、操作抽屉、星图、升级三选一、自定义键位、操控与体验设置 `#settings-overlay`（含 `#setting-volume` / `#setting-reduce-motion`）及 `#modal-breakdown` |
| `package.json` | 依赖 `three: ^0.174.0`，开发依赖 `vite: ^6.2.0`、`electron: ^45.4.1`、`electron-builder: ^26.18.0`（`type: "module"`，`main: "electron/main.cjs"`），含 Win/Mac 桌面打包脚本与配置 |
| `electron/main.cjs` | Electron 离线桌面主进程（`app://solaris` 自定义特权协议直读 `dist/`、WebGL/自动播放开关、单实例锁、`F11` / Mac `Ctrl+Cmd+F` 全屏、Pointer Lock 授权） |
| `.github/workflows/build-desktop.yml` | GitHub Actions 双端自动构建工作流（云端同步产出 Windows `.exe` 与 macOS `arm64`/`x64` `.dmg`/`.zip`） |
| `vite.config.js` | `base: './'`、`preserveSymlinks: true`、固定端口 `127.0.0.1:4173`（`strictPort: true`）、`target: 'esnext'`、`assetsInlineLimit: 0` |
| `start_game.bat` | Windows 一键启动脚本 |
| `scripts/export_natural_selection.py` | 从 Blender 导出 Draco 压缩 `natural_selection.glb` 并校准 `SHIP_HARDPOINTS` 坐标 |
| `scripts/fetch_nasa_textures.py` | 通过 Wikimedia Commons / NASA 数据源抓取行星与 6K 银河贴图并转换为 WebP |

### 2.2 源码清单（`src/` 全部 25 个文件）
| 目录 | 文件 | 行数 | 核心职责 |
| :--- | :--- | ---: | :--- |
| **入口与样式** | `src/main.js` | 1024 | 9 态主状态机、独立模拟时钟 `simTime`、死亡优先终局裁决、Hitstop 慢动作、完美闪避回能、操控设置/生涯持久化、`window.__SOLARIS__` |
| | `src/styles.css` | 1759 | 3D 曲面透视全息面板（`.hud-panel`）、`.top-left-stack`、模块徽章滚动条、弹窗分布条、768–1600px 全断点零重叠、`.fp-cockpit-active` 隐藏与 `tactical-hint` 避让规则 |
| **核心底座** | `src/core/Constants.js` | 402 | `SHIP_HARDPOINTS`、`SHIP_CONFIG`、`WEAPON_CONFIG`、`SOLAR_BODIES`、`CAMPAIGN_STAGES`、`QUALITY_PRESETS`、`DEFAULT_SETTINGS`、`SHIP_LOADOUTS`、`LANDMARK_SECTORS`、`DROPLET_PHASE2_HP_RATIO` |
| | `src/core/InputManager.js` | 410 | Pointer Lock 与拒绝提示 `onLockDenied`、条件 `captureTab`、独立鼠标/Gamepad 手柄轴态与归零、右键防手势保护 |
| | `src/core/KeybindManager.js` | 222 | 默认键位表（含 `settings: KeyO`）、`Tab`/`Escape` 系统保留与菜单安全键守卫、确定性旧档迁移与去重持久化 |
| | `src/core/PostProcessing.js` | 119 | `EffectComposer` 同源 DPR 缩放（`setPixelRatio`）+ `UnrealBloomPass` + 曲率蓄能色散与低血量红警脉冲 |
| | `src/core/ProceduralTextures.js` | 455 | 程序化舰体装甲法线/粗糙度贴图、光晕精灵、土星/天王星环纹理、PMREM 深空环境反射贴图（用完释放源资产） |
| **飞船与机位** | `src/ship/NaturalSelectionShip.js` | 827 | Draco GLB 载入、6DoF 惯性飞控、`applyLoadout`（构型涂装与护盾上限实时刷新）、`triggerPerfectDodge()`、护盾上线提示、全状态 `resetAt` |
| | `src/ship/CameraRig.js` | 220 | 4 机位 `CAMERA_MODES`、全局 `shakeScale`、第一人称 G 力惯性视差摆动、`Alt+鼠标` 360° 观舰 |
| | `src/ship/BridgeCockpit3D.js` | 387 | 真 3D 第一人称舰桥座舱（3 块 `depthTest:false/renderOrder=5` 全息 MFD + 2D 扇区小雷达、低血量挡风微裂纹 Shader 与角灯红警脉冲） |
| **世界与着色器** | `src/world/SolarSystem.js` | 661 | 太阳系公转/自转、4K/2K 贴图、解析二次式线段-球面扫掠与脱离容差碰撞、全卫星 `'MOON'` 与 `dt` 归一化土星冰环 `'RING_ICE'`、阳面晨昏线跃迁落点 |
| | `src/world/PlanetShaders.js` | 644 | 太阳日冕/黑子、地球昼夜城市灯/云层/瑞利散射大气、实拍岩石与气态巨行星着色器、土星环本影投射着色器 |
| | `src/world/Starfield.js` | 336 | 6K 银河天空盒（`milkyway_8k.webp`）+ 8,500 光谱星 + 700 速度尘埃/星区微尘色偏自适应（静止跳过矩阵上传） |
| | `src/world/Landmarks.js` | 369 | 6 战区地标奇观：地球太空电梯光柱、火星扫描雷达光锥、木星舰队墓场、水星红外哨站、土星采冰站、海王星深空灯塔 |
| **战斗与肉鸽** | `src/combat/WeaponSystem.js` | 918 | 双联轨道炮、伽马粒子光矛（75ms 反馈节流）、蜂群导弹、EMP（打断水滴进 `VENT`），统一最小球面入射 `t` 与易爆晶体联动、`reset()` |
| | `src/combat/VFXManager.js` | 917 | 3D 护盾受击穹顶、`NormalBlending` 火球、水滴高频残影池与散热蒸汽、电弧连线、`clearAll()` 全池清理不伤共享几何 |
| | `src/combat/EnemyFactory.js` | 257 | 5 类敌方单元建模与高对比度点光源/热散口轮廓 |
| | `src/combat/EnemyManager.js` | 713 | 敌舰 AI、水滴二阶段折线突袭与 `staggerDropletFromEmp`、武器分项伤害统计、`getNearestDroplet`、`onMajorKill` 慢动作联动 |
| | `src/combat/MissionManager.js` | 230 | 4 阶段主线与无尽模式实例部署防护、通讯队列、`getObjectiveRemaining`、死亡禁治防线 |
| | `src/combat/UpgradeSystem.js` | 431 | 7 核心 + 3 项双核羁绊（`SYNERGY_CATALOG`）、3D AI 僚机（含扫掠与涂装伤害倍率）、`[Z]` 恒星超载 |
| **音频引擎** | `src/audio/AudioEngine.js` | 897 | 纯 Web Audio DSP：水滴预警/热散音、羁绊和弦、低血警报（1.25s 节流）、完美闪避/护盾音、二阶段配乐层、`dampMenuAudio` |
| **UI 交互层** | `src/ui/HUDManager.js` | 1320 | 全息 HUD、`reset()`、`_setText` 文本缓存、25Hz 雷达节流、动态准星扩散与桶滚弧、`.tactical-hint`、真 FPS 与模块/羁绊徽章条 |
| | `src/ui/StarMapUI.js` | 569 | Canvas 2D 星图、残敌菱形/地标 `◈` 标记、`ResizeObserver` 宽高 DPR 自适应、`SHIP_CONFIG` 常量 ETA |
| | `src/ui/KeybindUI.js` | 169 | 键位自定义矩阵与动态快捷键提示同步（含 `#btn-settings` / `#btn-mute`） |
| | `src/ui/UpgradeUI.js` | 81 | 肉鸽三选一卡片（含三态羁绊提示槽）与防连点守卫 |

### 2.3 `public/` 静态资源
- **3D 模型与解码器**：`public/assets/natural_selection.glb`（4.6 MB Draco GLB）及 `public/draco/gltf/`（`draco_decoder.js` / `draco_decoder.wasm` / `draco_encoder.js` / `draco_wasm_wrapper.js`）。
- **天体与星空贴图**：`earth_day.webp`、`earth_night.webp`、`earth_clouds.webp`、`sun.webp`、`mercury.webp`、`venus.webp`、`mars.webp`、`jupiter.webp`、`saturn.webp`、`saturn_ring.webp`、`uranus.webp`、`neptune.webp`、`moon.webp`、`milkyway_8k.webp`、`galaxy.webp`、`sky.webp`。

---

## 3. 核心架构与跨模块契约

### 3.1 游戏主状态机（`src/main.js`）
`playMode` 共 9 个状态：`TITLE` | `PLAYING` | `STARMAP` | `UPGRADE` | `PAUSED` | `KEYBINDS` | `SETTINGS` | `VICTORY` | `DEFEAT`。
- `setPlayMode(next)` 控制 `input.enabled = (next === 'PLAYING')` 与 `input.captureTab = (next === 'PLAYING' || next === 'STARMAP')`（恢复菜单弹窗 `Tab` 焦点遍历）；切入 `PLAYING` 时 `input.resetAim()`，切出 `PLAYING` 时 `input.releaseLock()` 并强制停用伽马光矛音效与光束网格。
- 仅 `TITLE` 和 `PLAYING` 推进独立模拟时钟 `simTime`（`PLAYING` 叠加 `Hitstop` 时标缩放）；非 `PLAYING` 菜单状态通过 `audio.dampMenuAudio()` 平稳压低引擎/环境底音。
- 终局优先级：`ship.hull <= 0` 的失败裁决严格先于 `missionManager.update()` 清场回血/胜利判定及帧末延迟选卡 `pendingUpgradeOpen`。

### 3.2 关键跨模块事件链路
- **武器击中与击杀**：`weaponSystem.onHitFeedback(kind)` → HUD 准星反馈 + `audio.playHitmarker`（光矛受 75ms 节流）；`enemyManager.onDamageDealt(worldPos, dmg, kind)` → 3D 投影伤害飘字与 `damageByWeapon` 统计；`enemyManager.onEnemyKilled(enemy)` → `upgradeSystem.registerKill(enemy, weaponSystem, enemyManager, ship)` 与 `solaris_high_score_v1`；`enemyManager.onMajorKill(enemy)` → Hitstop 慢动作时标震荡；`enemyManager.getNearestDroplet(ship.root.position, 2200)` → 统一驱动 HUD Boss 血条与二阶段配乐层。
- **受击、闪避与护盾**：`enemyManager.onPlayerHit(dmg, fromPos)` → HUD 受击方向提示；`ship.onPerfectDodge` → 超载 +18% / 完美闪避音效 / 金色战术提示；`ship.onShieldRestore` → 护盾脱离耗尽时播报恢复音效；`ship.onShieldBreak` → 若持有 `phase_shield` 则触发 EMP 反震荡波。
- **第一人称座舱联动**：`inCockpit = (playMode === 'PLAYING' && cameraRig.mode === 'FIRST_PERSON')` → 同步控制 `cockpit3D.setVisible(inCockpit)` 与 `hud.setCockpitLayout(inCockpit)`（隐藏左下条与底部主面板并上移 `.tactical-hint` 至 `top: 102px` / `≤1240px` `178px` 避让 3D MFD）。
- **调试与验收钩子（`window.__SOLARIS__`）**：
  - `window.__SOLARIS__.state`：只读读取 `{ playMode, mode, stage, wave, loadout, hull, shield, pos, enemies, objectiveLeft, warpState, camMode, synergies, stats, settings, simTime }`
  - `window.__SOLARIS__.warpTo(sectorId)`：直接触发向指定天体（如 `'mars'`、`'jupiter'`、`'saturn'`）曲率跃迁

---

## 4. 多 Agent 协同分工建议（按文件所有权解耦）

为避免多人/多 Agent 并发改写同一文件造成冲突，推荐采用 **「1 总控协调者 + 5 领域轨道 + 1 实机 QA」** 拆分：

| 角色轨道 | 独占可写文件 | 职责边界与协作规则 |
| :--- | :--- | :--- |
| **1. Architect / Integrator（总控协调者）** | `src/main.js`、`src/core/Constants.js`、`index.html`、`vite.config.js`、`AGENTS.md` | 负责状态机、模块实例化接线、全局数值常量与最终合并构建。其他 Agent 需要改接口或新增全局常量时，先提接口变更，由总控统一合入或在独立 worktree 合并。 |
| **2. World & Shaders Agent（世界与渲染）** | `src/world/*`、`src/core/PostProcessing.js`、`src/core/ProceduralTextures.js`、`scripts/fetch_nasa_textures.py` | 维护太阳系天体、行星/恒星/星环着色器、星空、轨道地标与后处理通道。需向外部提供清晰的坐标/碰撞/最近天体查询 API。 |
| **3. Ship, Cockpit & Input Agent（飞控与座舱）** | `src/ship/*`、`src/core/InputManager.js`、`scripts/export_natural_selection.py` | 维护舰船物理手感、4 机位镜头、3D 驾驶舱与 MFD 画布绘制、键鼠/手柄输入及防浏览器手势逻辑。 |
| **4. Combat, AI & VFX Agent（战斗与特效）** | `src/combat/*`（若并发度高可再拆为 **武器与 VFX**：`WeaponSystem.js` + `VFXManager.js`，以及 **敌舰/战役/肉鸽**：`Enemy*` + `MissionManager.js` + `UpgradeSystem.js`） | 维护武器火控、粒子/护盾/爆炸着色器、敌舰与水滴 Boss 行为、关卡波次、僚机与肉鸽词条。 |
| **5. UI & UX Agent（全息交互界面）** | `src/ui/*`、`src/styles.css`、`src/core/KeybindManager.js` | 维护 HUD 绘制、星图、升级三选一、键位设置弹窗与多分辨率响应式样式。新增 DOM 元素需与总控同步 `index.html`。 |
| **6. Audio Agent（音频工程）** | `src/audio/AudioEngine.js` | 与画面逻辑高度解耦，保持既有 `play*`、`setGammaActive`、`updateContinuous` 方法签名稳定即可完全并行迭代。 |
| **7. QA & Visual Verifier（构建与实机验收）** | 只读业务代码；执行构建与浏览器自动化检查 | 每次合入后运行 `vite build` 与 Chromium 实机巡检，用 `window.__SOLARIS__` 覆盖各天体与模式，核查控制台 0 报错、网络 0 404、UI 无遮挡与帧率表现。 |

---

## 5. 所有 Agent 必须遵守的技术红线（避坑清单）

1. **对数深度缓冲强制兼容**：
   `WebGLRenderer` 开启了 `logarithmicDepthBuffer: true`（`camera.near = 0.12`、`far = 120000`）。**任何新增或修改的自定义 `ShaderMaterial` 都必须完整包含以下 chunk，否则会出现近距/远距深度撕裂或黑屏**：
   - Vertex：`#include <common>`、`#include <logdepthbuf_pars_vertex>`、`#include <logdepthbuf_vertex>`
   - Fragment：`#include <common>`、`#include <logdepthbuf_pars_fragment>`、`#include <logdepthbuf_fragment>`
2. **WebGL2 GLSL 严格规范**：
   - **禁止在 Fragment Shader 中直接引用 `modelMatrix`**（会触发 `'modelMatrix' : undeclared identifier` 编译错误），世界空间基向量须在 Vertex Shader 计算并通过 `varying` 传递。
   - **禁止对 `THREE.SRGBColorSpace` 贴图手动 `pow(tex, 2.2)`**（WebGL2 采样时已自动线性化，重复伽马校正会导致暗部死黑）。
3. **面片特效边缘径向渐隐**：
   所有基于 `PlaneGeometry` 的广告牌特效（如 `Starburst`、`Shockwave` 等）在片元着色器中必须乘上径向衰减遮罩（例如 `1.0 - smoothstep(0.76, 0.99, r)`），严禁出现可见的半透明方形边框。
4. **帧率与着色器预算红线（目标 ≥ 90 FPS）**：
   - 常驻战斗 `.hud-panel` 面板**禁止添加 `backdrop-filter: blur(...)`**（目前仅全屏模态弹窗/标题卡等低频界面保留该属性），避免每帧全屏像素混合拖垮 WebGL 帧率。
   - 4K 行星表面着色器中避免叠加高倍多层 3D fBm，优先利用实拍贴图与轻量单层噪声。
5. **第一人称 3D MFD 防遮挡与 GLSL 跨 GPU 防呆约定**：
   - `BridgeCockpit3D` 挂载于 `ship.cockpitMount`（直挂 `ship.root` 隔离桶滚）；3 块悬浮玻璃全息 MFD 材质设置 `depthTest: false` 且 `renderOrder = 5`，仪表台底座几何体 `dashBase` / `dashLip` 必须位于 MFD 下方；GLSL 高斯波前/冲击环严禁 `pow(signed, 2.0)`（统一显式自乘 `x * x`）。
   - `HUDManager.setCockpitLayout(true)` 会为 `#hud-root` 挂载 `.fp-cockpit-active`，彻底隐藏 `.status-panel`、`.weapons-panel`、`.radar-frame` 与 `.bottom-right-stack` 并解除左右面板透视（同时上移 `.tactical-hint`），严禁破坏该 CSS 联动导致第一人称下屏幕底部出现双雷达或重叠面板。
6. **右键防浏览器手势与误退保护**：
   - `InputManager.js` 在 `window` 捕获阶段拦截 `mousedown` / `mouseup` / `auxclick` / `contextmenu` / `dragstart` 并在左/右键点击画布时自动申请 Pointer Lock；同时 `WeaponSystem.js` 保留 `KeyR` 作为伽马粒子光矛备用按键；`main.js` 保留战斗中 `beforeunload` 守卫。重构输入逻辑时不可削弱这些保护。

---

## 6. 本地构建、预览与实机验收指南

### 6.1 构建与启动命令（Windows PowerShell）
部分 Windows 环境策略会拦截 `npm.ps1`，建议直接使用 Node 调用本地 Vite（工作目录为 `c:\Users\LCB\Desktop\gpt、Gemini、ds\natural-selection-solar`）：

```powershell
# 启动开发热更新服务器 (http://127.0.0.1:4173/)
node .\node_modules\vite\bin\vite.js

# 生产构建（输出至 dist/，必须通过后方可交付）
node .\node_modules\vite\bin\vite.js build

# 启动生产预览服务器 (http://127.0.0.1:4173/)
node .\node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 4173

# 启动桌面版测试 / 打包 Windows 便携版（release/）与 macOS 原生构建
npm.cmd run desktop:dev
npm.cmd run desktop:build
# 在 macOS 上执行: npm run desktop:mac
```

> 每次修改代码后，若以 `vite preview` 或 `electron` 进行验收，务必重新执行构建（`desktop:dev` / `desktop:build` 会自动先执行 `npm run build` 更新 `dist/`）。

### 6.2 验收检查清单
- [ ] `vite build` / `desktop:build` 零错误完成，静态资源路径保持相对路径（`./assets/...`、`./draco/...`）。
- [ ] 桌面端 `app://solaris/index.html` 与浏览器 Console **0 error**（尤其关注自定义 GLSL Shader 编译无报错）、Network **0 404/failed request**。
- [ ] 标题页（默认与宽窄屏）、近地战斗 VFX（脉冲激光无弹壳穿模）、侧翼视角、`[V]` 第一人称 3D MFD、星图 `[M]`（跃迁按钮完全处于视口内不裁切）、以及 `__SOLARIS__.warpTo('mars' | 'jupiter' | 'saturn')` 落点均处于阳面/晨昏线合理构图内。

---

## 7. v4.0 → v4.2 交付与核心契约增量

- **v4.2 Stage 5（武器特效、2-op FM 音效重塑与跨平台离线桌面应用）已交付**：
  - **纯激光去穿模与副武器特效升级 (`WeaponSystem.js` / `VFXManager.js` / `UpgradeSystem.js`)**：左键主武器改用仅从炮口前 `1.1u` 向前展开的十字交叉透明激光光带 + 聚能星芒（零“弹壳”倒插穿模，3 视角 `9/9` 命中 + `12u` 偏靶 `0/9` + `96/96/96` 射速 + 共享几何零 `dispose`）；伽马光矛加装双螺旋游丝/聚能环/灼斑；蜂群导弹改为 16 段索引三维网格尾迹 + 双环爆震；EMP 升级六边形穹顶 + 双电离环 + 8 电弧；`Z` 恒星超载独立接入金色爆发；UI 统一为「双联脉冲激光 / 脉冲激光」并保留内部 `dmg.railgun` 等遥测键。
  - **AudioEngine 2-op FM + 滤波谐波重塑 (`AudioEngine.js`)**：保留中心取样零直流偏置 WaveShaper（斜率 `1.0`）及静音进暂停 `dampMenuAudio` P1 闭环（`0.01 / 42 Hz`），新增 `_fm` 原语与动态 `_tone` 滤波包络，彻底淘汰开火/受击/光矛上高频过滤白噪喷水感（`playHitmarker` 四档 `hit`/`shield`/`crit`/`kill` 零白噪、`playRailgun` 5 层 FM+谐波紧致踢腿、`playEmp` FM 地震金属震环）。
  - **跨电脑离线桌面应用 (`electron/main.cjs` / `package.json` / `.github/workflows/build-desktop.yml`)**：内置 `app://solaris` 离线特权协议直读 `dist/`（零浏览器、零 Node 依赖、零本地端口），已打包 `release/NaturalSelectionSolar-Portable-x64.exe`（`131,721,144 B`）与 `release/win-unpacked/NaturalSelectionSolar.exe`（`249,978,368 B`），实机跑通 `app://solaris/index.html`（`p50 163.9 FPS`、0 报错）；同步配置 `desktop:mac` 与 GitHub Actions 双端云构建。
- **v4.0 Stage 4 已完成交付**：
  - **音频 DSP 基础 (`AudioEngine.js`)**：`tanh(2x)/2` 2048 点单位斜率软削波（修复 `-24.7 dB` 衰减，全链路恢复 `+23.30 dB`）、`sfxBus`/`musicBus` 分轨、`while` 音序追步、`setMasterVolume`（默认 `0.85`）、`toggleMute` 恢复存档增益、`setCockpitMuffle`（7200Hz/20000Hz）与 `playKillConfirm`。
  - **Star Citizen 第一人称透明玻璃座舱与相机稳态 (`BridgeCockpit3D.js` / `CameraRig.js` / `NaturalSelectionShip.js`)**：`cockpitMount` 直挂 `ship.root` 隔离桶滚；`CAMERA_MODES = ['TACTICAL', 'WIDE', 'FIRST_PERSON']`；3 块 `512×256` 2x Retina 径向羽化悬浮面板 + 44px 雷达（配合 `.fp-cockpit-active` 隐藏 `.radar-frame` / `.bottom-right-stack`）；`CameraRig.getStableAimRay` + `WeaponSystem._getStableAimRay` 保证三视角准星与无锁弹道在 100/250/500u 全汇聚、`shake=1.0` 及 `Alt` 自由视角保持稳态；`HUDManager` 保留 `this._maxPixelRatio` 上限并在自由观舰时渲染 `'FREE LOOK · 自由视角'`。
  - **操控防晕、安全航路与 GLSL 防呆 (`InputManager.js` / `SolarSystem.js` / `VFXManager.js` / `PlanetShaders.js`)**：默认 `DEFAULT_SETTINGS.reduceMotion = true`（可切换）；Pointer Lock 切换归零及单帧 `>260px` 突刺丢弃 + `±0.28` 单帧转向限幅；`SolarSystem.computeSafeWarpWaypoints` / `isWarpSegmentClear` 与 `ship.replaceWarpWaypoints` 实现近太阳肩部绕行及实时目的地重规划；所有 GLSL 高斯衰减禁用 `pow(signed, 2.0)`，统一改用显式差值自乘 `x * x`；`MissionManager` / `EnemyManager` 以 `deploymentKey` 隔离主线与巡逻计数。
- **未来可选演进（Backlog）**：战前独立 3D 船坞预览机位、外太阳系多阶段分支 Boss 部位破坏、动态多语言切换、以及拆分 `HUDManager.js` / `styles.css`。
