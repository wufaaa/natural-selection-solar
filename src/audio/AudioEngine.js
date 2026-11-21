/**
 * Unity-slope soft-clip saturator curve.
 *
 * tanh(drive * x) / drive  has slope 1.0 at the origin, so working-level signals pass
 * through at exactly unity gain (the mix balance is preserved), while the extremes are
 * gently compressed: with drive = 2.0 full scale maps to tanh(2)/2 = 0.482 (-6.34 dB).
 *
 * NOTE: the previous implementation multiplied the classic arctan curve by a stray
 * (Math.PI / 180) factor, which collapsed the origin slope to 0.083 (-21.62 dB) and the
 * whole chain to -24.71 dB once the 0.70 master gain was applied. That is why every
 * effect sounded ~25 dB too quiet.
 */
function makeSoftClipCurve(drive = 2.0) {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Bin-centred sampling: x_i = (i + 0.5) * 2/n - 1.
    //
    // The obvious x_i = i*2/n - 1 leaves the curve with no sample at x = 0 at all.
    // Chrome reads a WaveShaper's curve by interpolating between the two bins that
    // straddle the input, so an idle shaper (input exactly 0) reads the midpoint between
    // curve[1023] and curve[1024] —and with the old mapping those two values are
    // asymmetric (-0.001953 and 0.0). The result was a permanent -0.000488 DC offset
    // (-66 dBFS) on the master bus the moment Web Audio initialised, with no cue playing.
    // Bin-centre sampling makes that pair exactly antipodal, so the interpolated output at
    // x = 0 is exactly 0 while the 2048-point count, the tanh(2x)/2 shape and the unity
    // origin slope are all preserved.
    const x = ((i + 0.5) * 2) / n - 1;
    curve[i] = Math.tanh(drive * x) / drive;
  }
  return curve;
}

function buildConvolutionIR(ctx, duration = 2.1, decay = 2.6) {
  const len = Math.floor(ctx.sampleRate * duration);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decay);
      const n = (Math.random() * 2 - 1) * env;
      lp = lp * 0.68 + n * 0.32;
      data[i] = lp;
    }
  }
  return ir;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.dryBus = null;
    this.wetBus = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.masterVolume = 0.85;
    this.muted = false;
    this.initialized = false;
    this._menuDamped = false;
    this._cockpitMuffled = false;
    this._cockpitTone = null;

    this.engineGain = null;
    this.engineFilter = null;
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.noiseBuffer = null;

    this.gammaGain = null;
    this.gammaOsc = null;
    this._gammaOn = false;

    this.padGain = null;
    this.padFilter = null;
    this.padVoices = [];

    // 118 BPM Adaptive Combat Sequencer
    this.seqTimer = 0;
    this.seqStep = 0;
    this.combatIntensity = 0;
  }

  ensureInit() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();

    // Master DSP chain:
    //   sfxBus    ---+    //                  +--> cockpitTone --> sat (unity-slope soft clip) --> comp (bus limiter) --> master --> out    //   musicBus  ---+
    // Splitting sfx from music means a loud explosion no longer ducks the score via the
    // shared compressor: the old single-bus layout caused audible "pumping" of the pad.
    const sat = this.ctx.createWaveShaper();
    sat.curve = makeSoftClipCurve(2.0);
    sat.oversample = '2x';

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -9;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVolume;

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.75;

    // Cockpit muffle filter lives permanently between the sfx bus and the saturator so
    // toggling it never has to re-patch the graph (avoids a click or an orphaned node).
    this._cockpitTone = this.ctx.createBiquadFilter();
    this._cockpitTone.type = 'lowpass';
    this._cockpitTone.frequency.value = 20000;
    this._cockpitTone.Q.value = 0.6;

    this.sfxBus.connect(this._cockpitTone);
    this._cockpitTone.connect(sat);
    this.musicBus.connect(sat);
    sat.connect(comp);
    comp.connect(this.master);
    this.master.connect(this.ctx.destination);

    this.dryBus = this.sfxBus;

    // Stereo Convolution Reverb Send Bus (shares the sfx path so music stays dry & clear)
    this.wetBus = this.ctx.createGain();
    this.wetBus.gain.value = 0.20;
    const conv = this.ctx.createConvolver();
    conv.buffer = buildConvolutionIR(this.ctx, 2.2, 2.7);
    const revLp = this.ctx.createBiquadFilter();
    revLp.type = 'lowpass';
    revLp.frequency.value = 2800;
    this.wetBus.connect(conv);
    conv.connect(revLp);
    revLp.connect(sat);

    // 2.5-second rich pink/white noise buffer
    const len = Math.floor(this.ctx.sampleRate * 2.5);
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.16) * 1.45));
    }

    this._setupEngineLoop();
    this._setupGammaLoop();
    this._setupAmbientPad();

    this.initialized = true;
  }

  _routeWithPan(node, pan = 0, wetAmt = 0.22) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-0.85, Math.min(0.85, pan));
      node.connect(p);
      p.connect(this.dryBus);
      if (wetAmt > 0) {
        const wg = this.ctx.createGain();
        wg.gain.value = wetAmt;
        p.connect(wg);
        wg.connect(this.wetBus);
      }
    } else {
      node.connect(this.dryBus);
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Shared transient toolkit
   * ---------------------------------------------------------------------------
   * Every hard-effect cue below is assembled from these two primitives so the whole
   * sound set shares one gain / pan / reverb discipline instead of each method
   * inventing its own. Two rules are baked in:
   *
   *  1. Envelopes start and end at 0.0001, never at 0. An exponential ramp to exactly
   *     zero throws RangeError in Web Audio and takes the rest of the call with it.
   *  2. Noise sources are looped slices of the single shared pink-noise buffer and are
   *     always stopped explicitly, so a 10 Hz weapon stream cannot leak nodes.
   */
  _blast(opts = {}) {
    const ctx = this.ctx;
    const t0 = (opts.now ?? ctx.currentTime) + (opts.at || 0);
    const dur = opts.dur ?? 0.05;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    if (opts.rate) src.playbackRate.value = opts.rate;

    let node = src;

    if (opts.hp) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = opts.hp;
      hp.Q.value = opts.hpQ ?? 0.7;
      node.connect(hp);
      node = hp;
    }

    if (opts.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.lp;
      lp.Q.value = opts.lpQ ?? 0.7;
      node.connect(lp);
      node = lp;
    }

    if (opts.freq) {
      const bp = ctx.createBiquadFilter();
      bp.type = opts.type || 'bandpass';
      bp.Q.value = opts.Q ?? 1.2;
      bp.frequency.setValueAtTime(opts.freq, t0);
      if (opts.freqEnd && opts.freqEnd !== opts.freq) {
        bp.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + (opts.sweep || dur));
      }
      node.connect(bp);
      node = bp;
    }

    const g = ctx.createGain();
    const peak = Math.max(0.0002, opts.gain ?? 0.05);
    const att = Math.min(Math.max(0.0004, opts.attack ?? 0.0015), dur * 0.9);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);

    this._routeWithPan(g, opts.pan || 0, opts.wet ?? 0.2);

    // Choose a read offset that cannot wrap the 2.5 s noise buffer mid-cue: a loop point
    // landing inside a long tail is an audible click at the join. `rate` shrinks the
    // buffer as it is consumed, so it is part of the budget.
    const rate = opts.rate || 1;
    const consumed = (dur + 0.03) * rate;
    const maxStart = Math.max(0, 2.40 - consumed);
    src.start(t0, Math.random() * Math.min(1.5, maxStart));
    src.stop(t0 + dur + 0.02);
    return g;
  }

  _tone(opts = {}) {
    const ctx = this.ctx;
    const t0 = (opts.now ?? ctx.currentTime) + (opts.at || 0);
    const dur = opts.dur ?? 0.1;

    const osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    const f0 = Math.max(8, opts.freq || 220);
    osc.frequency.setValueAtTime(f0, t0);
    if (opts.freqEnd && opts.freqEnd !== f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(8, opts.freqEnd), t0 + (opts.glide || dur));
    }
    if (opts.detune) osc.detune.value = opts.detune;

    let node = osc;
    if (opts.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = opts.lpQ ?? 0.7;
      lp.frequency.setValueAtTime(Math.max(20, opts.lp), t0);
      if (opts.lpEnd && opts.lpEnd !== opts.lp) {
        lp.frequency.exponentialRampToValueAtTime(Math.max(20, opts.lpEnd), t0 + (opts.lpSweep || dur));
      }
      node.connect(lp);
      node = lp;
    }
    if (opts.bp) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = opts.bp;
      bp.Q.value = opts.Q ?? 1.4;
      node.connect(bp);
      node = bp;
    }

    const g = ctx.createGain();
    const peak = Math.max(0.0002, opts.gain ?? 0.08);
    const att = Math.min(Math.max(0.0004, opts.attack ?? 0.004), dur * 0.9);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);

    this._routeWithPan(g, opts.pan || 0, opts.wet ?? 0.2);

    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    return g;
  }

  /**
   * 2-operator FM transient/body synth for punchy laser snaps, metallic armor hits,
   * and crystalline shield deflections without filtered-noise hiss.
   */
  _fm(opts = {}) {
    const ctx = this.ctx;
    const t0 = (opts.now ?? ctx.currentTime) + (opts.at || 0);
    const dur = opts.dur ?? 0.06;

    const car = ctx.createOscillator();
    car.type = opts.type || 'sine';
    const f0 = Math.max(12, opts.freq || 260);
    car.frequency.setValueAtTime(f0, t0);
    if (opts.freqEnd && opts.freqEnd !== f0) {
      car.frequency.exponentialRampToValueAtTime(Math.max(12, opts.freqEnd), t0 + (opts.glide || dur));
    }
    if (opts.detune) car.detune.value = opts.detune;

    const mod = ctx.createOscillator();
    mod.type = opts.modType || 'sine';
    const mf0 = Math.max(12, opts.modFreq || f0 * 2.1);
    mod.frequency.setValueAtTime(mf0, t0);
    if (opts.modFreqEnd && opts.modFreqEnd !== mf0) {
      mod.frequency.exponentialRampToValueAtTime(Math.max(12, opts.modFreqEnd), t0 + (opts.modDur || dur));
    }

    const modGain = ctx.createGain();
    const md = Math.max(1, opts.modDepth ?? f0 * 1.4);
    const mdur = Math.max(0.004, opts.modDur ?? dur * 0.55);
    modGain.gain.setValueAtTime(md, t0);
    modGain.gain.exponentialRampToValueAtTime(0.001, t0 + mdur);

    mod.connect(modGain);
    modGain.connect(car.frequency);

    let node = car;
    if (opts.hp) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = opts.hp;
      hp.Q.value = opts.hpQ ?? 0.7;
      node.connect(hp);
      node = hp;
    }
    if (opts.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = opts.lpQ ?? 0.9;
      lp.frequency.setValueAtTime(Math.max(20, opts.lp), t0);
      if (opts.lpEnd && opts.lpEnd !== opts.lp) {
        lp.frequency.exponentialRampToValueAtTime(Math.max(20, opts.lpEnd), t0 + (opts.lpSweep || dur));
      }
      node.connect(lp);
      node = lp;
    }
    if (opts.bp) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = opts.bp;
      bp.Q.value = opts.Q ?? 1.4;
      node.connect(bp);
      node = bp;
    }

    const g = ctx.createGain();
    const peak = Math.max(0.0002, opts.gain ?? 0.1);
    const att = Math.min(Math.max(0.0004, opts.attack ?? 0.0012), dur * 0.9);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);

    this._routeWithPan(g, opts.pan || 0, opts.wet ?? 0.2);

    mod.start(t0);
    car.start(t0);
    mod.stop(t0 + dur + 0.03);
    car.stop(t0 + dur + 0.03);
    return g;
  }

  _setupEngineLoop() {
    const ctx = this.ctx;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 140;
    this.engineFilter.Q.value = 1.6;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.035;

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 42;

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 84;

    const jetNoise = ctx.createBufferSource();
    jetNoise.buffer = this.noiseBuffer;
    jetNoise.loop = true;
    const jetBand = ctx.createBiquadFilter();
    jetBand.type = 'bandpass';
    jetBand.frequency.value = 260;
    jetBand.Q.value = 1.1;
    const jetGain = ctx.createGain();
    jetGain.gain.value = 0.34;

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    jetNoise.connect(jetBand);
    jetBand.connect(jetGain);
    jetGain.connect(this.engineFilter);

    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.dryBus);

    this.engineOsc1.start();
    this.engineOsc2.start();
    jetNoise.start();
  }

  /**
   * Gamma particle lance —sustained reactor resonance while the trigger is held.
   *
   * Sterile sawtooth -> detuned reactor stack:
   *   - 55 Hz (A1) and 82.5 Hz (E2, a pure fifth above it) held a few cents apart. The
   *     fifth beats slowly against itself and gives the "reactor core under load" weight
   *     without any harmonic buzz.
   *   - A third voice at 55.35 Hz adds a 0.35 Hz beat so the bed never sounds static.
   *   - Mid-band granular noise (1.1 kHz, Q 5.5) carries the plasma turbulence.
   *   - A 0.09 Hz LFO slowly opens and closes the plasma whine's band-pass. Two full
   *     cycles per ~22 s: it reads as breathing, not as vibrato.
   */
  _setupGammaLoop() {
    const ctx = this.ctx;
    this.gammaGain = ctx.createGain();
    this.gammaGain.gain.value = 0;

    // Resonant low-pass bus gives the particle lance rich harmonic growl without noise hiss.
    const beamLp = ctx.createBiquadFilter();
    beamLp.type = 'lowpass';
    beamLp.frequency.value = 480;
    beamLp.Q.value = 2.2;
    beamLp.connect(this.gammaGain);
    this._gammaBeamBp = beamLp;

    const reactorCfg = [
      { type: 'sine', f: 55.0, det: -4, g: 0.38 },
      { type: 'triangle', f: 110.0, det: 4, g: 0.26, primary: true },
      { type: 'sawtooth', f: 110.8, det: 0, g: 0.18 },
      { type: 'sawtooth', f: 165.0, det: 6, g: 0.13 },
    ];
    this.gammaOsc = null;
    for (const rc of reactorCfg) {
      const o = ctx.createOscillator();
      o.type = rc.type;
      o.frequency.value = rc.f;
      o.detune.value = rc.det;
      const og = ctx.createGain();
      og.gain.value = rc.g;
      o.connect(og);
      og.connect(beamLp);
      o.start();
      if (rc.primary || !this.gammaOsc) this.gammaOsc = o;
    }
    if (!this.gammaOsc) this.gammaOsc = ctx.createOscillator();
    this._gammaBeamOsc = this.gammaOsc;

    // Subtle low-band plasma air weight (down from 0.30 @ 1.1 kHz to avoid watery spray).
    const fizz = ctx.createBufferSource();
    fizz.buffer = this.noiseBuffer;
    fizz.loop = true;
    const fizzBp = ctx.createBiquadFilter();
    fizzBp.type = 'bandpass';
    fizzBp.frequency.value = 420;
    fizzBp.Q.value = 3.0;
    const fizzGain = ctx.createGain();
    fizzGain.gain.value = 0.045;
    fizz.connect(fizzBp);
    fizzBp.connect(fizzGain);
    fizzGain.connect(this.gammaGain);
    this._gammaFizz = fizzBp;

    // Slow breathing filter sweep + subtle 14 Hz magnetic ion tremor.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.28;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 190;
    lfo.connect(lfoAmt);
    lfoAmt.connect(beamLp.frequency);
    lfo.start();

    const tremorLfo = ctx.createOscillator();
    tremorLfo.type = 'sine';
    tremorLfo.frequency.value = 14.0;
    const tremorAmt = ctx.createGain();
    tremorAmt.gain.value = 32;
    tremorLfo.connect(tremorAmt);
    tremorAmt.connect(beamLp.frequency);
    tremorLfo.start();

    this.gammaGain.connect(this.dryBus);
    const revG = ctx.createGain();
    revG.gain.value = 0.35;
    this.gammaGain.connect(revG);
    revG.connect(this.wetBus);

    fizz.start();
  }

  _setupAmbientPad() {
    const ctx = this.ctx;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.040;

    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 380;
    this.padFilter = padFilter;

    // Deep D Dorian Interstellar harmony (D2, A2, F3, C4, E4)
    const freqs = [73.42, 110.0, 174.61, 261.63, 329.63];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'triangle' : 'sine';
      osc.frequency.value = freqs[i];
      osc.detune.value = (i - 2) * 5.5;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.28 : 0.14;
      osc.connect(g);
      g.connect(padFilter);
      osc.start();
      this.padVoices.push(osc);
    }

    padFilter.connect(this.padGain);
    this.padGain.connect(this.musicBus);
    const wetPad = ctx.createGain();
    wetPad.gain.value = 0.45;
    this.padGain.connect(wetPad);
    wetPad.connect(this.wetBus);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.04);
    }
    return this.muted;
  }

  /**
   * Master output volume, clamped to 0..1.5 so the player can push a quiet laptop
   * speaker above unity without being able to blow the graph up.
   */
  setMasterVolume(vol) {
    const v = Number(vol);
    this.masterVolume = Number.isFinite(v) ? Math.max(0, Math.min(1.5, v)) : 0.85;
    if (!this.muted && this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
    }
    return this.masterVolume;
  }

  /**
   * First-person cockpit acoustic muffle: rolls the extreme highs off the sfx path so the
   * bridge feels enclosed rather than like pure vacuum. The filter is inserted once at
   * init (sfxBus -> cockpitTone -> sat); this only retunes its cutoff.
   */
  setCockpitMuffle(isFP) {
    if (!this.initialized || !this.ctx || !this._cockpitTone) return;
    const want = !!isFP;
    if (this._cockpitMuffled === want) return;
    this._cockpitMuffled = want;
    this._cockpitTone.frequency.setTargetAtTime(want ? 7200 : 20000, this.ctx.currentTime, 0.12);
  }

  _triggerCombatPulse(step, isBoss, isBossPhase2 = false) {
    const now = this.ctx.currentTime;
    // D Dorian dark synthwave bassline (D2, D2, F2, G2, D2, A2, C3, G2)
    const bassPattern = [73.42, 73.42, 87.31, 98.0, 73.42, 110.0, 130.81, 98.0];
    const freq = bassPattern[(step >> 1) % bassPattern.length];
    const accent = step % 4 === 0 ? 1.0 : step % 2 === 0 ? 0.65 : 0.42;
    const gainLvl = (0.042 + 0.04 * this.combatIntensity) * accent;

    const osc = this.ctx.createOscillator();
    osc.type = isBoss ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(isBoss ? 680 : 480, now);
    lp.frequency.exponentialRampToValueAtTime(140, now + 0.14);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainLvl, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(lp);
    lp.connect(g);
    g.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + 0.17);

    // Sub-taiko downbeat hit on every 8th beat in active combat
    if (step % 8 === 0 && this.combatIntensity > 0.35) {
      const kOsc = this.ctx.createOscillator();
      kOsc.type = 'sine';
      kOsc.frequency.setValueAtTime(110, now);
      kOsc.frequency.exponentialRampToValueAtTime(34, now + 0.22);
      const kg = this.ctx.createGain();
      kg.gain.setValueAtTime(Math.max(0.0015, 0.09 * this.combatIntensity), now);
      kg.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      kOsc.connect(kg);
      kg.connect(this.musicBus);
      kOsc.start(now);
      kOsc.stop(now + 0.26);
    }

    // Sparse ethereal high arpeggio shimmer every 6 steps
    if (step % 6 === 0) {
      const arpNotes = [587.33, 659.25, 698.46, 880.0, 1046.5];
      const note = arpNotes[(step / 6) % arpNotes.length];
      const aOsc = this.ctx.createOscillator();
      aOsc.type = 'sine';
      aOsc.frequency.setValueAtTime(note, now);
      const ag = this.ctx.createGain();
      ag.gain.setValueAtTime(0.025, now);
      ag.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      aOsc.connect(ag);
      ag.connect(this.wetBus);
      aOsc.start(now);
      aOsc.stop(now + 0.48);
    }

    // Boss phase-2 escalation layer: tight high-register stabs on the off-beat
    if (isBossPhase2 && step % 4 === 2) {
      const phase2Notes = [587.33, 698.46, 880.0, 783.99];
      const p2Note = phase2Notes[(step >> 2) % phase2Notes.length];
      const p2Osc = this.ctx.createOscillator();
      p2Osc.type = 'sawtooth';
      p2Osc.frequency.setValueAtTime(p2Note, now);
      const p2Bp = this.ctx.createBiquadFilter();
      p2Bp.type = 'bandpass';
      p2Bp.frequency.value = 1650;
      p2Bp.Q.value = 2.6;
      const p2g = this.ctx.createGain();
      p2g.gain.setValueAtTime(0.035, now);
      p2g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      p2Osc.connect(p2Bp);
      p2Bp.connect(p2g);
      this._routeWithPan(p2g, (step % 8 === 2 ? -1 : 1) * 0.28, 0.3);
      p2Osc.start(now);
      p2Osc.stop(now + 0.09);
    }
  }

  updateContinuous(throttle, isBoosting, isWarping, inCombat, isBoss = false, dt = 0.016, isBossPhase2 = false) {
    if (!this.initialized || !this.ctx) return;
    // Back in live flight: re-arm the menu damp so the next pause re-equalises properly.
    //
    // This MUST happen before the mute gate. Conflating the two (the old
    // `|| this.muted` on the guard line) meant a muted return to PLAYING left
    // `_menuDamped` latched at 'paused', so the following pause skipped its equaliser
    // writes and the bed stayed at whatever the last flight state set.
    this._menuDamped = null;
    if (this.muted) return;
    const now = this.ctx.currentTime;
    const targetFreq = isWarping ? 96 : isBoosting ? 76 : 42 + throttle * 24;
    const targetCutoff = isWarping ? 960 : isBoosting ? 500 : 125 + throttle * 175;
    const targetGain = isWarping ? 0.13 : isBoosting ? 0.095 : 0.030 + throttle * 0.035;

    this.engineOsc1.frequency.setTargetAtTime(targetFreq, now, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(targetFreq * 2.0, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(targetCutoff, now, 0.1);
    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.1);

    const targetCombat = isBoss ? 1.0 : inCombat ? 0.72 : 0.0;
    this.combatIntensity += (targetCombat - this.combatIntensity) * Math.min(1, dt * 1.4);

    if (this.padFilter && this.padGain) {
      this.padFilter.frequency.setTargetAtTime(340 + this.combatIntensity * 380, now, 0.45);
      this.padGain.gain.setTargetAtTime(0.040 + this.combatIntensity * 0.020, now, 0.45);
    }

    // 118 BPM -> 16th note interval ~ 0.127s.
    // Catch-up loop (capped at 8 steps) so a frame hitch cannot leave the sequencer
    // permanently behind: the old single-step `if` made the score drift and audibly
    // desync from the SFX for seconds after any stall.
    const step = 0.127;
    this.seqTimer += dt;
    let catchUp = 0;
    while (this.seqTimer >= step && catchUp < 8) {
      this.seqTimer -= step;
      if (this.combatIntensity > 0.15 || this.seqStep % 6 === 0) {
        this._triggerCombatPulse(this.seqStep, isBoss, isBossPhase2);
      }
      this.seqStep++;
      catchUp++;
    }
    // If we are still far behind after the cap, drop the backlog instead of racing forever.
    if (this.seqTimer > step * 8) this.seqTimer = 0;
  }

  /**
   * Duck every continuous menu-facing bed back to an idle hush.
   * Called on PAUSED / TITLE entry so a thrust or warp roar can never stay stuck in the menu.
   * Safe no-op before Web Audio init.
   *
   * Mute must not short-circuit the equaliser writes. The engine bed is a *continuous
   * oscillator*: `master.gain = 0` silences it but does not retune it, so a mute during a
   * warp leaves engineGain at 0.13 with a 960 Hz cutoff sitting behind the master. Pressing
   * U inside the pause menu then restores master and the player is hit with a full-bore
   * warp roar in a menu that is supposed to be hushed (measured +22.3 dB over the idle bed).
   * So: gamma is always released, the bed is always retuned, and `muted` is checked only
   * where it actually matters — it is a master-gain concern, not a bed-target concern.
   */
  dampMenuAudio(dt = 0.016, isPaused = true) {
    if (!this.initialized || !this.ctx) return;

    // Always release the gamma bed, even when idempotent or muted: a beam left running
    // behind a pause menu is the one stuck-sound this function exists to prevent.
    this.setGammaActive(false);

    // Idempotent: main.js calls this every frame while a menu is open. Re-issuing the
    // same setTargetAtTime 60x/second is pure waste, so skip the equaliser writes once
    // the bed has already been damped for the current mode.
    const dampKey = isPaused ? 'paused' : 'menu';
    if (this._menuDamped === dampKey) {
      this.combatIntensity *= Math.exp(-3.5 * dt);
      if (this.combatIntensity < 0.001) this.combatIntensity = 0;
      return;
    }
    this._menuDamped = dampKey;

    const now = this.ctx.currentTime;
    const smooth = 0.12;

    if (this.engineOsc1) this.engineOsc1.frequency.setTargetAtTime(42, now, smooth);
    if (this.engineOsc2) this.engineOsc2.frequency.setTargetAtTime(84, now, smooth);
    if (this.engineFilter) this.engineFilter.frequency.setTargetAtTime(115, now, smooth);
    if (this.engineGain) this.engineGain.gain.setTargetAtTime(isPaused ? 0.010 : 0.020, now, smooth);

    // Decay the adaptive combat layer toward silence instead of snapping it.
    this.combatIntensity *= Math.exp(-3.5 * dt);
    if (this.combatIntensity < 0.001) this.combatIntensity = 0;

    if (this.padFilter) this.padFilter.frequency.setTargetAtTime(320, now, 0.45);
    if (this.padGain) this.padGain.gain.setTargetAtTime(0.030, now, 0.45);
  }

  /**
   * Gamma lance trigger in/out.
   *
   * Engagement gets a high-voltage arc strike ("hisss-woom"): a 60 ms ionised noise
   * burst sweeping down through the mid band, plus a rising reactor pitch bend, so the
   * beam feels like it is *charging into* the target rather than fading in.
   * Release gets a bleed-off tail: the bed sags and a short depressurised vent hisses out.
   *
   * Called every frame from WeaponSystem, so the transient is edge-triggered on the
   * `_gammaOn` flag instead of firing on every call.
   */
  setGammaActive(active) {
    if (!this.initialized || !this.ctx) return;
    const on = !!active;
    const now = this.ctx.currentTime;

    if (on === this._gammaOn) {
      // Gently drift the resonant harmonic pitch while held so long burns stay organic.
      if (on && this.gammaOsc && Math.random() < 0.02) {
        this.gammaOsc.frequency.setTargetAtTime(110 * (0.995 + Math.random() * 0.01), now, 0.25);
      }
      return;
    }
    this._gammaOn = on;

    this.gammaGain.gain.setTargetAtTime(on ? 0.16 : 0.0, now, on ? 0.022 : 0.075);

    if (on) {
      // Edge-triggered FM plasma ignition arc + magnetic lock thump.
      this._fm({
        now, wet: 0.35, type: 'triangle', modType: 'sine',
        freq: 780, freqEnd: 165, glide: 0.08,
        modFreq: 1340, modFreqEnd: 380, modDepth: 640, modDur: 0.05,
        lp: 2800, lpEnd: 650, lpSweep: 0.085, lpQ: 1.4,
        dur: 0.095, attack: 0.0015, gain: 0.11,
      });
      if (this.gammaOsc) {
        this.gammaOsc.frequency.cancelScheduledValues(now);
        this.gammaOsc.frequency.setValueAtTime(82, now);
        this.gammaOsc.frequency.exponentialRampToValueAtTime(110, now + 0.13);
      }
      this._tone({
        now, wet: 0.18, type: 'sine',
        freq: 120, freqEnd: 55, glide: 0.11,
        dur: 0.14, attack: 0.004, gain: 0.10,
      });
    } else {
      // Harmonic turbine spool-down on release without white-noise hiss.
      this._tone({
        now, wet: 0.4, type: 'triangle', at: 0.008,
        freq: 165, freqEnd: 48, glide: 0.26,
        lp: 650, lpEnd: 140, lpSweep: 0.26, lpQ: 1.5,
        dur: 0.28, attack: 0.015, gain: 0.075,
      });
      this._tone({
        now, wet: 0.3, type: 'sine', at: 0.01,
        freq: 82.5, freqEnd: 41, glide: 0.26,
        dur: 0.28, attack: 0.015, gain: 0.05,
      });
    }
  }

  /**
   * Main weapon: twin high-energy pulsed laser (~9.5 shots/sec).
   * Pure FM + harmonic low-pass cannon transient + chest kick finishing in <= 72 ms
   * so rapid fire punches crisply without watery noise spray.
   */
  playRailgun(barrel = 0, isOverclocked = false) {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const pan = barrel % 2 === 0 ? -0.26 : 0.26;
    const detune = 0.984 + Math.random() * 0.032;
    const jitter = 0.9 + Math.random() * 0.2;
    const ocK = isOverclocked ? 1.0 : 0.0;

    // 1. Ultra-short 3.8 ms mechanical breech click (non-hissy focus transient).
    this._blast({
      now, pan, wet: 0.10,
      freq: 1450 * detune, freqEnd: 580 * detune, sweep: 0.0038, Q: 1.8,
      dur: 0.0038, attack: 0.0005,
      gain: (0.042 + ocK * 0.01) * jitter,
    });

    // 2. FM laser coil snap (metallic laser chirp without raw sawtooth toy glide).
    this._fm({
      now, pan, wet: 0.20, type: 'sine', modType: 'sine',
      freq: (960 + ocK * 140) * detune, freqEnd: (240 + ocK * 30) * detune, glide: 0.032,
      modFreq: (1520 + ocK * 180) * detune, modFreqEnd: 420 * detune,
      modDepth: 680 + ocK * 160, modDur: 0.016,
      lp: 3400, lpEnd: 950, lpSweep: 0.034, lpQ: 1.5,
      dur: 0.038, attack: 0.0008,
      gain: (0.115 + ocK * 0.02) * jitter,
    });

    // 3. Warm mid-bass triangle body.
    this._tone({
      now, pan, wet: 0.14, type: 'triangle',
      freq: (230 + ocK * 22) * detune, freqEnd: 62 * detune, glide: 0.052,
      lp: 1550 + ocK * 300, lpEnd: 260, lpSweep: 0.056, lpQ: 2.2,
      dur: 0.064, attack: 0.001,
      gain: (0.145 + ocK * 0.02) * jitter,
    });

    // 4. Resonant sawtooth cannon crunch (filtered downward).
    this._tone({
      now, pan, wet: 0.16, type: 'sawtooth',
      freq: (345 + ocK * 35) * detune, freqEnd: 94 * detune, glide: 0.042,
      lp: 1950 + ocK * 350, lpEnd: 280, lpSweep: 0.045, lpQ: 1.8,
      dur: 0.050, attack: 0.001,
      gain: (0.068 + ocK * 0.015) * jitter,
    });

    // 5. Tight sub-bass recoil kick (tail-free at 72 ms).
    this._tone({
      now, pan, wet: 0.08, type: 'sine',
      freq: (108 + ocK * 8) * detune, freqEnd: 42 * detune, glide: 0.058,
      lp: 280, lpQ: 0.9,
      dur: 0.072, attack: 0.0015,
      gain: 0.17 + ocK * 0.018,
    });
  }

  /**
   * Missile seeker lock —cold military radar micro-clicks, not a wristwatch beep.
   *
   * The old cue was a sine stepping 920 -> 1085 Hz: that interval is precisely the
   * "digital watch" gesture. Replaced with two very short, very narrow band-passed
   * noise ticks (a real fire-control radar's PRF chirp reads as a click, not a note),
   * pitched upward by target count so the player can hear how many birds are tracking.
   * Underneath sits a sub-audible-band tick that only gives weight, never melody.
   */
  playMissileLock(count = 1) {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const n = Math.max(1, Math.min(8, count | 0));
    // Narrow-band click centres; higher count = higher PRF = reads as "more locked".
    const c0 = 2380 + n * 105;
    const c1 = c0 * 1.34;
    // The two ticks panned apart by target count: a multi-lock spreads across the ears.
    const spread = Math.min(0.42, n * 0.06);

    // Two micro-pulses 42 ms apart: the classic double-tick of a seeker confirming.
    for (let i = 0; i < 2; i++) {
      this._blast({
        now, wet: 0.22, at: i * 0.042, pan: (i === 0 ? -1 : 1) * spread,
        freq: i === 0 ? c0 : c1, Q: 14,
        dur: 0.011, attack: 0.0006,
        gain: i === 0 ? 0.054 : 0.040,
      });
      // Mechanical body of the click: a filtered low knock, not a beep.
      this._tone({
        now, wet: 0.12, at: i * 0.042, type: 'sine',
        freq: i === 0 ? 196 : 232, freqEnd: 150, glide: 0.02,
        lp: 900,
        dur: 0.024, attack: 0.0008,
        gain: 0.054,
      });
    }

    // Faint seeker-gimbal whirr under the ticks, so it is not sterile.
    this._blast({
      now, wet: 0.3, at: 0.006,
      freq: 680, freqEnd: 1040, sweep: 0.07, Q: 3.2,
      dur: 0.075, attack: 0.012,
      gain: 0.018,
    });
  }

  /**
   * Missile launch —cold-launch pneumatic ejection, then staggered rocket ignition.
   *
   * Layer 1: the canister kick. A 65 Hz body slamming out of the tube, plus the metal
   *          "clack" of the ejector, both inside 90 ms.
   * Layer 2: four ignition pops offset by 26-46 ms (the salvo leaves the tubes in
   *          sequence, so a single noise burst was always wrong). Each is a low-cut
   *          band-passed noise puff that rolls upward in brightness as the motors bite.
   * Layer 3: a long, low motor roar tail with a falling low-pass —this is the
   *          "departing ordnance" that sells distance, and it is the part the old
   *          cue was missing entirely.
   */
  playMissileLaunch() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const pan = (Math.random() - 0.5) * 0.34;

    // L1a — cold-launch pneumatic ram.
    this._tone({
      now, pan, wet: 0.14, type: 'sine',
      freq: 65, freqEnd: 34, glide: 0.085,
      lp: 220, lpEnd: 70, lpSweep: 0.085, lpQ: 0.9,
      dur: 0.10, attack: 0.002,
      gain: 0.20,
    });
    // L1b — FM mechanical breech clack (crisp latch, no bright hiss).
    this._fm({
      now, pan, wet: 0.18, type: 'triangle', modType: 'sine',
      freq: 940, freqEnd: 340, glide: 0.02,
      modFreq: 1620, modFreqEnd: 520, modDepth: 480, modDur: 0.015,
      lp: 2400, lpEnd: 580, lpSweep: 0.022, lpQ: 1.3,
      dur: 0.024, attack: 0.0008,
      gain: 0.095,
    });

    // L2 — staggered motor ignition: deep low-mid puffs + rocket kick thumps.
    const offsets = [0.026, 0.046, 0.072, 0.098];
    for (let i = 0; i < offsets.length; i++) {
      const t = offsets[i];
      const slotPan = pan + (i - 1.5) * 0.09;
      this._blast({
        now, pan: slotPan, wet: 0.24, at: t,
        lp: 950, lpQ: 1.0,
        freq: 260 + i * 60, freqEnd: 680 + i * 110, sweep: 0.048, Q: 1.2,
        dur: 0.056, attack: 0.0025,
        gain: 0.055 * (1 - i * 0.12),
      });
      this._tone({
        now, pan: slotPan, wet: 0.14, at: t, type: 'sine',
        freq: 145 + i * 15, freqEnd: 68, glide: 0.042,
        lp: 360,
        dur: 0.050, attack: 0.0012,
        gain: 0.08 * (1 - i * 0.10),
      });
    }

    // L3 — deep departing motor roar without harsh upper spray.
    this._blast({
      now, pan, wet: 0.36, at: 0.03,
      lp: 520, lpQ: 1.4, rate: 0.78,
      freq: 190, freqEnd: 440, sweep: 0.28, Q: 1.0,
      dur: 0.50, attack: 0.045,
      gain: 0.065,
    });
    this._tone({
      now, pan, wet: 0.3, at: 0.03, type: 'sine',
      freq: 58, freqEnd: 38, glide: 0.48,
      dur: 0.50, attack: 0.045, gain: 0.075,
    });
  }

  /**
   * EMP shockwave — Seismic Charge with vacuum suction, FM seismic metal shock-ring,
   * 72 -> 24 Hz step-drop slam, and inharmonic sub-bass hull resonance.
   */
  playEmp() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const T = 0.065;

    // --- Movement 1: inward suction -----------------------------------------
    this._blast({
      now, wet: 0.45,
      freq: 180, freqEnd: 1800, sweep: T, Q: 2.6,
      dur: T + 0.004, attack: T * 0.85,
      gain: 0.055,
    });
    this._tone({
      now, wet: 0.3, type: 'sine',
      freq: 30, freqEnd: 92, glide: T,
      dur: T + 0.004, attack: T * 0.8,
      gain: 0.08,
    });
    this._blast({
      now, wet: 0.3, at: T * 0.15,
      freq: 3600, freqEnd: 5800, sweep: T * 0.8, Q: 3.0,
      dur: T * 0.85, attack: T * 0.5,
      gain: 0.012,
    });

    // --- Movement 2: seismic slam + metallic shock-ring ----------------------
    this._tone({
      now, wet: 0.34, type: 'sine', at: T,
      freq: 72, freqEnd: 24, glide: 0.62,
      lp: 180, lpQ: 0.9,
      dur: 0.68, attack: 0.0035,
      gain: 0.30,
    });
    this._fm({
      now, wet: 0.48, at: T, type: 'triangle', modType: 'sine',
      freq: 280, freqEnd: 64, glide: 0.54,
      modFreq: 412, modFreqEnd: 118, modDepth: 420, modDur: 0.14,
      lp: 1200, lpEnd: 260, lpSweep: 0.52, lpQ: 1.5,
      dur: 0.65, attack: 0.003,
      gain: 0.18,
    });
    this._blast({
      now, wet: 0.4, at: T,
      hp: 2600, hpQ: 0.9,
      dur: 0.06, attack: 0.0008,
      gain: 0.065,
    });
    this._blast({
      now, wet: 0.38, at: T + 0.004,
      freq: 3400, freqEnd: 640, sweep: 0.20, Q: 1.4,
      dur: 0.24, attack: 0.002,
      gain: 0.045,
    });

    // --- Movement 3: deep-space metal resonance ------------------------------
    const partials = [
      { f: 43.6, g: 0.085, d: 0.95 },
      { f: 61.0, g: 0.055, d: 0.82 },
      { f: 88.0, g: 0.038, d: 0.70 },
      { f: 117.5, g: 0.020, d: 0.52 },
    ];
    for (const p of partials) {
      this._tone({
        now, wet: 0.75, at: T + 0.008, type: 'sine',
        freq: p.f, freqEnd: p.f * 0.985, glide: p.d,
        dur: p.d, attack: 0.012,
        gain: p.g,
      });
    }
    this._blast({
      now, wet: 0.55, at: T + 0.02,
      lp: 240, lpQ: 1.4, rate: 0.72,
      freq: 160, freqEnd: 70, sweep: 0.7, Q: 0.9,
      dur: 0.85, attack: 0.03,
      gain: 0.075,
    });
  }

  playExplosion(size = 'medium', pan = 0, distScale = 1.0) {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const isMajor = size === 'boss' || size === 'capital';
    const dur = size === 'boss' ? 2.1 : size === 'capital' ? 1.45 : size === 'medium' ? 0.68 : 0.38;
    const vol = (size === 'boss' ? 0.58 : size === 'capital' ? 0.44 : size === 'medium' ? 0.25 : 0.16) * Math.max(0.25, distScale);

    // Optional Seismic-Charge silence drop then colossal resonance for Capital / Boss kills
    const offset = isMajor ? 0.08 : 0.0;

    // 1. Tight focused crack transient (short 32 ms, no extended white-noise spray)
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    const crackBp = this.ctx.createBiquadFilter();
    crackBp.type = 'bandpass';
    crackBp.frequency.value = 1100;
    crackBp.Q.value = 1.5;
    const crackG = this.ctx.createGain();
    crackG.gain.setValueAtTime(vol * 0.62, now);
    crackG.gain.exponentialRampToValueAtTime(0.001, now + 0.032);
    crack.connect(crackBp);
    crackBp.connect(crackG);
    this._routeWithPan(crackG, pan, 0.35);
    crack.start(now);
    crack.stop(now + 0.04);

    // 2. Low-passed sawtooth pressure body for metallic detonation grit
    this._tone({
      now, pan, wet: 0.3, at: offset, type: 'sawtooth',
      freq: isMajor ? 120 : 145, freqEnd: 28, glide: dur * 0.55,
      lp: 420, lpEnd: 75, lpSweep: dur * 0.6, lpQ: 1.4,
      dur: Math.max(0.22, dur * 0.65), attack: 0.008,
      gain: vol * 0.45,
    });

    // 3. Deep chest-punch sub boom
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(isMajor ? 92 : 118, now + offset);
    sub.frequency.exponentialRampToValueAtTime(22, now + offset + dur * 0.85);
    const subG = this.ctx.createGain();
    subG.gain.setValueAtTime(0.001, now);
    subG.gain.linearRampToValueAtTime(vol, now + offset + 0.015);
    subG.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
    sub.connect(subG);
    this._routeWithPan(subG, pan, 0.35);
    sub.start(now);
    sub.stop(now + offset + dur + 0.02);

    // 4. Sweeping resonant pyroclastic rumble (deep low-pass sweep)
    const roar = this.ctx.createBufferSource();
    roar.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.6;
    lp.frequency.setValueAtTime(size === 'small' ? 960 : 880, now + offset);
    lp.frequency.exponentialRampToValueAtTime(70, now + offset + dur);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.001, now);
    ng.gain.linearRampToValueAtTime(vol * 0.78, now + offset + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
    roar.connect(lp);
    lp.connect(ng);
    this._routeWithPan(ng, pan, 0.55);
    roar.start(now + offset);
    roar.stop(now + offset + dur + 0.05);
  }

  /**
   * Kill confirmation —tactical confirmation, not a microwave chime.
   *
   * The old cue was two triangle-wave pings (880 / 1318 Hz) with a sine thump: the
   * "ding-dong" gesture. New shape:
   *
   *   normal kill  (a) an energy-collapse low thud —210 -> 58 Hz, 0.22 s, filtered so
   *                    the transient reads as mass being extinguished;
   *                (b) two tight military micro-pulses 60 ms apart, narrow high band-pass,
   *                    the exact shape of a fire-control "solution valid" acknowledgement.
   *   major kill   the same two movements, then a low brass-quality fallaway —three
   *                detuned sine partials resolving 196 -> 147 -> 98 Hz (G3 - D3 - G2),
   *                behind a 900 Hz low-pass so it reads as a horn section under stress
   *                rather than as a synth chord. A long sub tail underneath it, and the
   *                whole thing is spread wide across the stereo field with reverb.
   *
   * Everything stays inside the musical key of the pad (D Dorian) so the sting lands
   * inside the score instead of on top of it.
   *
   * Levels: the normal-kill path is tuned so its peak lands within 1.5 dB of the old
   * cue's (-24.3 vs -23.0 dBFS) while the spectral mass moves from 0.41 mid / 0.0007
   * low-mid to 0.66 low-mid / 0.0016 mid. That is the whole point of the rewrite: same
   * loudness, no bell.
   */
  playKillConfirm(isMajor = false) {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const big = !!isMajor;

    // (a) Energy collapse: the target's field giving out.
    this._tone({
      now, wet: 0.28, type: 'sine',
      freq: big ? 210 : 186, freqEnd: big ? 46 : 58, glide: big ? 0.42 : 0.2,
      lp: 420, lpQ: 0.9,
      dur: big ? 0.46 : 0.24, attack: 0.003,
      gain: big ? 0.24 : 0.28,
    });
    this._blast({
      now, wet: 0.24,
      lp: 420, lpQ: 1.0,
      freq: big ? 420 : 380, freqEnd: 140, sweep: big ? 0.22 : 0.11, Q: 1.1,
      dur: big ? 0.22 : 0.11, attack: 0.002,
      gain: big ? 0.040 : 0.045,
    });

    // (b) Twin razor-clean FM tactical pings (zero Q=26 noise hiss).
    for (let i = 0; i < 2; i++) {
      const f0 = i === 0 ? 880 : 1240;
      const f1 = i === 0 ? 640 : 960;
      this._fm({
        now, wet: 0.34, at: 0.018 + i * 0.058, type: 'sine', modType: 'sine',
        freq: f0, freqEnd: f1, glide: i === 0 ? 0.022 : 0.030,
        modFreq: f0 * 2.0, modFreqEnd: f1 * 1.5, modDepth: 280, modDur: 0.014,
        lp: 2600, lpEnd: 1400, lpSweep: 0.028, lpQ: 1.1,
        dur: i === 0 ? 0.028 : 0.036, attack: 0.0008,
        gain: (big ? 0.068 : 0.092) * (i === 0 ? 1 : 0.85),
      });
    }

    // (c) Major only: low brass fallaway + long sub tail.
    if (big) {
      const horn = [
        { f: 196.0, at: 0.075, dur: 0.85, g: 0.072 },   // G3
        { f: 147.0, at: 0.165, dur: 0.80, g: 0.062 },   // D3
        { f: 98.0, at: 0.255, dur: 0.95, g: 0.078 },    // G2
      ];
      for (let i = 0; i < horn.length; i++) {
        const h = horn[i];
        // Two voices per note, a few cents apart: horn-section width, no chorus effect.
        for (let v = 0; v < 2; v++) {
          this._tone({
            now, at: h.at, wet: 0.72, type: 'sine',
            freq: h.f * (v === 0 ? 0.9985 : 1.0015),
            freqEnd: h.f * 0.994, glide: h.dur,
            lp: 900, lpQ: 0.8,
            dur: h.dur, attack: 0.028,
            gain: h.g * 0.62,
            pan: (v === 0 ? -1 : 1) * (0.16 + i * 0.06),
          });
        }
      }
      // Sub tail: the hull-scale component of a capital ship dying.
      this._tone({
        now, wet: 0.5, type: 'sine', at: 0.05,
        freq: 58, freqEnd: 27, glide: 1.05,
        dur: 1.10, attack: 0.02, gain: 0.115,
      });
      // Debris settling: deep low-pass bed under everything.
      this._blast({
        now, wet: 0.75, at: 0.12,
        lp: 260, lpQ: 1.2, rate: 0.7,
        freq: 200, freqEnd: 95, sweep: 0.9, Q: 0.9,
        dur: 1.0, attack: 0.06,
        gain: 0.032,
      });
    }
  }

  /**
   * Impact confirmation — four tiers built cleanly from 2-op FM transients,
   * crisp triangles, and tight sub punches with ZERO filtered-noise spray.
   */
  playHitmarker(kind = 'hit') {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const k = kind === 'kill' || kind === 'crit' || kind === 'shield' ? kind : 'hit';
    const jitter = 0.92 + Math.random() * 0.16;

    if (k === 'shield') {
      // Crystalline forcefield deflection (FM crystal shimmer + pure chime + low bounce).
      this._fm({
        now, wet: 0.36, type: 'sine', modType: 'sine',
        freq: 1180 * jitter, freqEnd: 920 * jitter, glide: 0.045,
        modFreq: 2540 * jitter, modFreqEnd: 1920 * jitter, modDepth: 340, modDur: 0.024,
        lp: 3600, lpEnd: 1600, lpSweep: 0.048,
        dur: 0.052, attack: 0.0008,
        gain: 0.095,
      });
      this._tone({
        now, wet: 0.42, type: 'sine', at: 0.009,
        freq: 1760 * jitter, freqEnd: 1580 * jitter, glide: 0.048,
        dur: 0.055, attack: 0.001,
        gain: 0.068,
      });
      this._tone({
        now, wet: 0.14, type: 'triangle',
        freq: 240 * jitter, freqEnd: 130 * jitter, glide: 0.038,
        lp: 620,
        dur: 0.045, attack: 0.001,
        gain: 0.085,
      });
      return;
    }

    if (k === 'crit' || k === 'kill') {
      const lvl = k === 'crit' ? 1.15 : 1.05;
      // Heavy armor-piercing FM crunch + metallic triangle ping + deep sub punch.
      this._fm({
        now, wet: 0.24, type: 'triangle', modType: 'sine',
        freq: 620 * jitter, freqEnd: 155 * jitter, glide: 0.046,
        modFreq: 1680 * jitter, modFreqEnd: 520 * jitter, modDepth: 960, modDur: 0.022,
        lp: 3200, lpEnd: 550, lpSweep: 0.05, lpQ: 1.6,
        dur: 0.056, attack: 0.0008,
        gain: 0.13 * lvl,
      });
      this._tone({
        now, wet: 0.28, type: 'triangle',
        freq: 1960 * jitter, freqEnd: 1380 * jitter, glide: 0.024,
        lp: 3400,
        dur: 0.028, attack: 0.0006,
        gain: 0.068 * lvl,
      });
      this._tone({
        now, wet: 0.16, type: 'sine',
        freq: 118 * jitter, freqEnd: 46 * jitter, glide: 0.052,
        lp: 320,
        dur: 0.066, attack: 0.0012,
        gain: 0.145 * lvl,
      });
      return;
    }

    // 'hit' — crisp FM metallic hull thwack + tactile triangle tick + tight sub punch.
    this._fm({
      now, wet: 0.18, type: 'sine', modType: 'sine',
      freq: 440 * jitter, freqEnd: 135 * jitter, glide: 0.030,
      modFreq: 1120 * jitter, modFreqEnd: 480 * jitter, modDepth: 560, modDur: 0.011,
      lp: 2200, lpEnd: 420, lpSweep: 0.032, lpQ: 1.4,
      dur: 0.036, attack: 0.0006,
      gain: 0.125,
    });
    this._tone({
      now, wet: 0.16, type: 'triangle',
      freq: 1480 * jitter, freqEnd: 880 * jitter, glide: 0.012,
      dur: 0.014, attack: 0.0005,
      gain: 0.062,
    });
    this._tone({
      now, wet: 0.12, type: 'sine',
      freq: 145 * jitter, freqEnd: 68 * jitter, glide: 0.032,
      lp: 450,
      dur: 0.040, attack: 0.001,
      gain: 0.135,
    });
  }

  /**
   * Shield taking a hit: FM magnetic deflection shudder + hull thump without watery smear.
   */
  playShieldImpact() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const j = 0.94 + Math.random() * 0.12;

    this._blast({
      now, wet: 0.25,
      lp: 460, lpQ: 1.2,
      freq: 380 * j, freqEnd: 150 * j, sweep: 0.055, Q: 1.4,
      dur: 0.065, attack: 0.002,
      gain: 0.045,
    });
    this._fm({
      now, wet: 0.36, type: 'triangle', modType: 'sine',
      freq: 360 * j, freqEnd: 140 * j, glide: 0.16,
      modFreq: 540 * j, modFreqEnd: 210 * j, modDepth: 360, modDur: 0.09,
      lp: 1250, lpEnd: 340, lpSweep: 0.16, lpQ: 1.6,
      dur: 0.18, attack: 0.003,
      gain: 0.11,
    });
    this._tone({
      now, wet: 0.35, type: 'sine',
      freq: 396 * j, freqEnd: 268 * j, glide: 0.17,
      lp: 760,
      dur: 0.18, attack: 0.005,
      gain: 0.065,
    });
    this._tone({
      now, wet: 0.35, type: 'sine',
      freq: 452 * j, freqEnd: 302 * j, glide: 0.17,
      lp: 840,
      dur: 0.18, attack: 0.005,
      gain: 0.052,
    });
    // Hull-coupled sub thump.
    this._tone({
      now, wet: 0.18, type: 'sine',
      freq: 115, freqEnd: 42, glide: 0.15,
      lp: 220,
      dur: 0.18, attack: 0.002,
      gain: 0.15,
    });
  }

  /**
   * Warp charge —a drive spooling up, not a sawtooth siren.
   *
   * Three stacked perfect fifths (A1/E2, A2/E3, A3/E4) each *filtered* rather than
   * detuned, so the harmonic content opens as the drive loads: the top voice is a
   * band-pass whose centre climbs 300 -> 5200 Hz over 0.72 s, which is the classic
   * "turbine coming up to speed" gesture. A granular noise floor rises underneath it,
   * and a sub drops in at the very end as the field collapses into the jump.
   */
  playWarpCharge() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const D = 0.74;

    // Stacked fifths: root + fifth, three octaves.
    const fifths = [
      { f: 55.0, g: 0.05, bp: false },
      { f: 82.5, g: 0.038, bp: false },
      { f: 110.0, g: 0.032, bp: false },
      { f: 165.0, g: 0.026, bp: true },
      { f: 220.0, g: 0.020, bp: true },
      { f: 330.0, g: 0.014, bp: true },
    ];
    for (const v of fifths) {
      this._tone({
        now, wet: 0.5, type: v.bp ? 'triangle' : 'sine',
        freq: v.f, freqEnd: v.f * 1.5, glide: D,
        bp: v.bp ? 1400 : undefined, Q: v.bp ? 3.2 : undefined,
        lp: v.bp ? undefined : 520, lpQ: 0.8,
        dur: D + 0.05, attack: 0.12,
        gain: v.g,
      });
    }

    // Opening filter sweep —the drive note coming up through the mix.
    this._blast({
      now, wet: 0.35,
      freq: 300, freqEnd: 5200, sweep: D, Q: 4.5,
      dur: D, attack: 0.18,
      gain: 0.038,
    });
    // Turbine noise floor.
    this._blast({
      now, wet: 0.3,
      lp: 900, lpQ: 1.2, rate: 0.9,
      freq: 420, freqEnd: 2600, sweep: D, Q: 1.1,
      dur: D, attack: 0.15,
      gain: 0.030,
    });
    // Field collapse at the tail.
    this._tone({
      now, wet: 0.4, type: 'sine', at: D * 0.82,
      freq: 92, freqEnd: 34, glide: D * 0.35,
      dur: D * 0.42, attack: 0.02,
      gain: 0.09,
    });
  }

  /**
   * Warp arrival —the reverse gesture: the field letting go.
   * High band collapsing to nothing while a 42 Hz body lands, then a long diffuse
   * decompression tail. No triangle glide down from 540 Hz (that was a slide whistle).
   */
  playWarpArrival() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    // Inbound collapse: the noise band falling out of the top of the spectrum.
    this._blast({
      now, wet: 0.6,
      freq: 6800, freqEnd: 320, sweep: 0.30, Q: 2.4,
      dur: 0.34, attack: 0.004,
      gain: 0.115,
    });
    // Body landing.
    this._tone({
      now, wet: 0.42, type: 'sine',
      freq: 88, freqEnd: 38, glide: 0.38,
      lp: 240, lpQ: 0.9,
      dur: 0.42, attack: 0.003,
      gain: 0.185,
    });
    // Decompression tail: hull plates and atmosphere re-equalising.
    this._blast({
      now, wet: 0.8, at: 0.05,
      lp: 620, lpQ: 1.3, rate: 0.78,
      freq: 520, freqEnd: 180, sweep: 0.7, Q: 0.9,
      dur: 0.85, attack: 0.06,
      gain: 0.055,
    });
    // Two detuned low partials left ringing in the reverb.
    [61.0, 91.5].forEach((f, i) => {
      this._tone({
        now, wet: 0.85, at: 0.02 + i * 0.01, type: 'sine',
        freq: f, freqEnd: f * 0.99, glide: 0.75,
        dur: 0.78, attack: 0.03,
        gain: 0.045,
        pan: i === 0 ? -0.3 : 0.3,
      });
    });
  }

  /**
   * Barrel-roll / boost dodge: lateral manoeuvring thrusters venting.
   * Two-stage band-passed air movement (out, then the trailing draw-back) over a short
   * low body. No pitch sweep on a tone —the movement is all in the noise band.
   */
  playDodge() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    this._blast({
      now, wet: 0.26,
      freq: 420, freqEnd: 1650, sweep: 0.13, Q: 1.5,
      dur: 0.145, attack: 0.006,
      gain: 0.145,
    });
    this._blast({
      now, wet: 0.3, at: 0.115,
      freq: 1750, freqEnd: 300, sweep: 0.2, Q: 1.2,
      dur: 0.21, attack: 0.02,
      gain: 0.075,
    });
    this._tone({
      now, wet: 0.16, type: 'sine',
      freq: 112, freqEnd: 58, glide: 0.16,
      lp: 240,
      dur: 0.18, attack: 0.004,
      gain: 0.085,
    });
  }

  /**
   * [Z] Stellar overdrive —the reactor being pushed past its rating.
   *
   * A perfect-fifth stack rises 1.5x over 0.55 s through an opening low-pass (55 / 82.5 /
   * 110 / 165 Hz), a granular surge climbs 400 -> 4800 Hz behind it, and the whole thing
   * lands on a 68 -> 31 Hz field-collapse thud. There is deliberately no bright chord
   * here: the old sawtooth arpeggio announced a power-up like a coin pickup. This one
   * announces that something expensive is about to happen to the ship.
   */
  playOverdrive() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const D = 0.56;
    const stack = [
      { f: 55.0, g: 0.075, pan: -0.1 },
      { f: 82.5, g: 0.055, pan: 0.1 },
      { f: 110.0, g: 0.04, pan: -0.22 },
      { f: 165.0, g: 0.028, pan: 0.22 },
    ];
    for (const v of stack) {
      this._tone({
        now, wet: 0.55, type: 'triangle',
        freq: v.f, freqEnd: v.f * 1.5, glide: D,
        lp: 780, lpQ: 1.1,
        dur: D + 0.06, attack: 0.05,
        gain: v.g, pan: v.pan,
      });
    }
    // Granular surge: the drive core inhaling.
    this._blast({
      now, wet: 0.4,
      freq: 400, freqEnd: 4800, sweep: D, Q: 3.6,
      dur: D, attack: 0.14,
      gain: 0.048,
    });
    // Containment straining.
    this._blast({
      now, wet: 0.32,
      lp: 1100, lpQ: 1.4, rate: 0.88,
      freq: 380, freqEnd: 2100, sweep: D, Q: 1.0,
      dur: D, attack: 0.12,
      gain: 0.040,
    });
    // Landing: field collapse into the overdrive window opening.
    this._tone({
      now, wet: 0.4, type: 'sine', at: D * 0.88,
      freq: 68, freqEnd: 31, glide: 0.34,
      dur: 0.38, attack: 0.004,
      gain: 0.155,
    });
  }

  /**
   * Upgrade card pickup —a single restrained perfect fifth (G3 -> D4), heavily
   * band-passed and short, with one tiny metallic sparkle. The old cue walked
   * C-E-G-C (a do-mi-sol children's arpeggio); this is a bridge acknowledgement.
   */
  playUpgradePickup() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    this._tone({
      now, wet: 0.5, type: 'triangle',
      freq: 196.0, freqEnd: 196.0, glide: 0.3,
      lp: 900, lpQ: 0.9,
      dur: 0.30, attack: 0.012, gain: 0.20,
    });
    this._tone({
      now, wet: 0.55, type: 'triangle', at: 0.072,
      freq: 293.66, freqEnd: 293.66, glide: 0.34,
      bp: 620, Q: 2.4,
      dur: 0.36, attack: 0.014, gain: 0.165,
    });
    // One sparkle of the card's hologram switching off.
    this._blast({
      now, wet: 0.45, at: 0.06,
      freq: 4200, freqEnd: 3300, sweep: 0.09, Q: 18,
      dur: 0.075, attack: 0.003,
      gain: 0.040,
    });
    // Low foundation so it is felt in the cockpit as well as heard.
    this._tone({
      now, wet: 0.2, type: 'sine',
      freq: 98, freqEnd: 74, glide: 0.24,
      lp: 260,
      dur: 0.26, attack: 0.008, gain: 0.145,
    });
  }

  /**
   * Stage clear —a bridge fanfare, not a victory jingle.
   *
   * A slow-swelling A-minor-add-E stack (110 / 164.81 / 220 / 329.63 Hz) with 0.45-0.6 s
   * attacks, gently low-passed at 900 Hz so it reads as brass and hull rather than as a
   * synth pad, plus a distant 62 -> 36 Hz drum on the downbeat. Everything sits in the
   * same D Dorian/A territory as the ambient pad, so the cue lands *inside* the score.
   */
  playStageClear() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    const chord = [
      { f: 110.0, g: 0.070, at: 0.0, dur: 2.4, pan: 0.0 },
      { f: 164.81, g: 0.052, at: 0.06, dur: 2.3, pan: -0.16 },
      { f: 220.0, g: 0.046, at: 0.12, dur: 2.2, pan: 0.16 },
      { f: 329.63, g: 0.030, at: 0.20, dur: 2.0, pan: -0.3 },
    ];
    for (const c of chord) {
      this._tone({
        now, wet: 0.78, at: c.at, type: 'sine',
        freq: c.f, freqEnd: c.f * 0.997, glide: c.dur,
        lp: 900, lpQ: 0.8,
        dur: c.dur, attack: 0.45,
        gain: c.g, pan: c.pan,
      });
    }
    // Downbeat: a low drum felt more than heard.
    this._tone({
      now, wet: 0.35, type: 'sine',
      freq: 62, freqEnd: 36, glide: 0.5,
      lp: 160, lpQ: 0.9,
      dur: 0.56, attack: 0.005, gain: 0.14,
    });
    this._blast({
      now, wet: 0.5, at: 0.004,
      lp: 420, lpQ: 1.3, rate: 0.75,
      freq: 220, freqEnd: 90, sweep: 0.45, Q: 0.9,
      dur: 0.5, attack: 0.02, gain: 0.045,
    });
    // Air movement of the bay doors opening under the chord.
    this._blast({
      now, wet: 0.7, at: 0.3,
      lp: 1400, lpQ: 1.1, rate: 0.8,
      freq: 700, freqEnd: 240, sweep: 1.5, Q: 0.85,
      dur: 1.7, attack: 0.35, gain: 0.026,
    });
  }

  /**
   * Comms chime —a secure-channel notification, not a doorbell.
   * A narrow 2.1 kHz noise click (the channel keying open), a low 520 Hz body, and a
   * softer confirmation click 90 ms later. Level is deliberately tiny: this fires on
   * every campaign line and must never compete with the fight.
   */
  playCommsPing() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    this._blast({
      now, wet: 0.24,
      freq: 2100, Q: 24,
      dur: 0.008, attack: 0.0005,
      gain: 0.046,
    });
    this._tone({
      now, wet: 0.18, type: 'sine',
      freq: 520, freqEnd: 430, glide: 0.045,
      lp: 900,
      dur: 0.055, attack: 0.0015, gain: 0.058,
    });
    this._blast({
      now, wet: 0.3, at: 0.09,
      freq: 2780, Q: 24,
      dur: 0.0075, attack: 0.0005,
      gain: 0.031,
    });
  }

  /**
   * Droplet phase-1 telegraph —dread approaching, not a rising sine.
   *
   * The resonance climbs 620 -> 2350 Hz through a Q 9 band-pass with a *slow* attack
   * (reversed-envelope swell), while a 46 -> 63 Hz growl rises underneath and a granular
   * band widens. The intact sine rise of the old cue sounded like a kettle; the swell is
   * what makes the player look up.
   */
  playDropletTelegraph() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const D = 0.48;

    this._blast({
      now, wet: 0.55,
      freq: 620, freqEnd: 2350, sweep: D * 0.95, Q: 9,
      dur: D, attack: D * 0.8,
      gain: 0.075,
    });
    this._tone({
      now, wet: 0.4, type: 'sine',
      freq: 46, freqEnd: 63, glide: D,
      lp: 140, lpQ: 1.0,
      dur: D, attack: D * 0.85,
      gain: 0.075,
    });
    // Mirror-surface shimmer widening as the droplet accelerates.
    this._blast({
      now, wet: 0.6, at: D * 0.25,
      freq: 3400, freqEnd: 6400, sweep: D * 0.7, Q: 6,
      dur: D * 0.75, attack: D * 0.55,
      gain: 0.020,
    });
  }

  /**
   * Droplet thermal vent breach —pressurised coolant dumping into vacuum.
   * The hiss stays (it is the correct gesture), but gains two inharmonic metal-stress
   * partials and a firmer sub drop, so it reads as a hull venting rather than a leaky tap.
   */
  playDropletVent() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    this._blast({
      now, wet: 0.62,
      freq: 1800, freqEnd: 320, sweep: 0.52, Q: 1.55,
      dur: 0.55, attack: 0.004,
      gain: 0.205,
    });
    // The plates complaining as they cool.
    this._tone({
      now, wet: 0.55, type: 'sine',
      freq: 1730, freqEnd: 1210, glide: 0.42,
      bp: 1600, Q: 16,
      dur: 0.44, attack: 0.02, gain: 0.030,
    });
    this._tone({
      now, wet: 0.55, at: 0.03, type: 'sine',
      freq: 2410, freqEnd: 1680, glide: 0.38,
      bp: 2200, Q: 16,
      dur: 0.40, attack: 0.02, gain: 0.020,
    });
    this._tone({
      now, wet: 0.42, type: 'sine',
      freq: 178, freqEnd: 50, glide: 0.5,
      lp: 220,
      dur: 0.55, attack: 0.006, gain: 0.150,
    });
  }

  /**
   * Dual-core synergy unlock —a wide, slowly-built perfect-fifth stack announced over
   * the bridge PA. Staggered 45 ms attacks, 0.5 s swells, heavy reverb, one shimmer.
   * The old five-note pentatonic arpeggio is gone: a synergy is a systems event, not a
   * treasure chest.
   */
  playSynergyUnlock() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    const stack = [
      { f: 110.0, g: 0.062, at: 0.0, pan: 0.0 },
      { f: 164.81, g: 0.048, at: 0.045, pan: -0.2 },
      { f: 220.0, g: 0.040, at: 0.09, pan: 0.2 },
      { f: 329.63, g: 0.028, at: 0.135, pan: -0.32 },
      { f: 440.0, g: 0.020, at: 0.18, pan: 0.32 },
    ];
    for (const v of stack) {
      this._tone({
        now, wet: 0.72, at: v.at, type: 'sine',
        freq: v.f, freqEnd: v.f * 1.002, glide: 1.3,
        lp: 1200, lpQ: 0.8,
        dur: 1.35, attack: 0.5,
        gain: v.g, pan: v.pan,
      });
    }
    // Containment field shimmer sweeping across the top.
    this._blast({
      now, wet: 0.75, at: 0.1,
      freq: 3200, freqEnd: 5200, sweep: 0.9, Q: 8,
      dur: 1.0, attack: 0.55,
      gain: 0.019,
    });
    // Low confirmation so the event has weight at the bottom of the mix.
    this._tone({
      now, wet: 0.4, type: 'sine', at: 0.02,
      freq: 73, freqEnd: 55, glide: 1.1,
      dur: 1.2, attack: 0.18, gain: 0.070,
    });
  }

  /**
   * Low-hull klaxon (internal 1.25 s throttle).
   *
   * Two descending warning pulses through a Q 16 band-pass —700 Hz then 530 Hz —each
   * with a 130 Hz body underneath and a fast attack. It is a horn, not a beeper: no
   * square wave anywhere. Descending pitch is what makes it read as *alarm* rather than
   * as notification, and the tight band keeps it from ever sounding cheerful.
   */
  playLowHullBeep() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (this._lastLowHullTime !== undefined && now - this._lastLowHullTime < 1.25) return;
    this._lastLowHullTime = now;

    const pulses = [
      { t: 0.0, f: 700, g: 0.155 },
      { t: 0.155, f: 530, g: 0.130 },
    ];
    for (const p of pulses) {
      this._blast({
        now, wet: 0.2, at: p.t,
        freq: p.f, freqEnd: p.f * 0.96, sweep: 0.075, Q: 16,
        dur: 0.085, attack: 0.004,
        gain: p.g,
      });
      this._tone({
        now, wet: 0.14, at: p.t, type: 'triangle',
        freq: 130, freqEnd: 118, glide: 0.08,
        lp: 420, lpQ: 0.9,
        dur: 0.09, attack: 0.005,
        gain: 0.115,
      });
    }
  }

  /**
   * Perfect-dodge reward —a doppler swish past the canopy plus two tight metallic
   * acknowledgement pings (a fourth apart, Q 20 noise, 8 ms). Quick, dry, and it never
   * sings a melody: the old rising sine was a slide whistle.
   */
  playPerfectDodge() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    // Approach, then departure.
    this._blast({
      now, wet: 0.34,
      freq: 720, freqEnd: 3100, sweep: 0.11, Q: 2.2,
      dur: 0.12, attack: 0.006,
      gain: 0.165,
    });
    this._blast({
      now, wet: 0.42, at: 0.1,
      freq: 3000, freqEnd: 520, sweep: 0.2, Q: 1.9,
      dur: 0.22, attack: 0.015,
      gain: 0.100,
    });
    // Acknowledged: two narrow metal pings, a perfect fourth apart.
    this._blast({
      now, wet: 0.4, at: 0.03,
      freq: 2350, Q: 20,
      dur: 0.009, attack: 0.0006,
      gain: 0.070,
    });
    this._blast({
      now, wet: 0.45, at: 0.085,
      freq: 3130, Q: 20,
      dur: 0.010, attack: 0.0006,
      gain: 0.050,
    });
    // Sub so the evade has physical weight.
    this._tone({
      now, wet: 0.2, type: 'sine',
      freq: 96, freqEnd: 54, glide: 0.14,
      lp: 240,
      dur: 0.16, attack: 0.003,
      gain: 0.098,
    });
  }

  /**
   * Shield regeneration resumed —a soft rising shimmer, no audible melodic step.
   * Two band-passed noise bands lift (900 -> 2600, and 2400 -> 4600) under a barely-there
   * fifth stack, so the cue reads as plates re-energising. The old 440 -> 880 Hz sine
   * was an octave siren.
   */
  playShieldRestore() {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const D = 0.34;

    this._blast({
      now, wet: 0.5,
      freq: 900, freqEnd: 2600, sweep: D, Q: 4.5,
      dur: D, attack: 0.14,
      gain: 0.040,
    });
    this._blast({
      now, wet: 0.55, at: 0.03,
      freq: 2400, freqEnd: 4600, sweep: D * 0.85, Q: 9,
      dur: D * 0.9, attack: 0.16,
      gain: 0.020,
    });
    // Faint fifth stack: 110 / 165 Hz swelling in, so it has body without melody.
    this._tone({
      now, wet: 0.55, type: 'sine',
      freq: 110, freqEnd: 112, glide: D,
      lp: 400, lpQ: 0.8,
      dur: D + 0.04, attack: 0.1, gain: 0.050, pan: -0.12,
    });
    this._tone({
      now, wet: 0.55, type: 'sine',
      freq: 165, freqEnd: 168, glide: D,
      lp: 500, lpQ: 0.8,
      dur: D + 0.04, attack: 0.1, gain: 0.036, pan: 0.12,
    });
  }
}
