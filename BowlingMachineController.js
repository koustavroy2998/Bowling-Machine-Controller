class BowlingMachineController {
  constructor() {
    this.jsonData = null;
    this.isDataLoaded = false;
    this.loadingPromise = null;

    this.cacheConfig = {
      maxSize: 5000, cleanupThreshold: 4500,
      cleanupBatchSize: 1000, maxAge: 3600000,
    };

    this.speedRpmProfile = {
      referenceSpeed: 110,
      toleranceProfile: {
        60: { rpmTolerance: 45, interpolationWeight: 0.5, patternMultiplier: 1.8 },
        70: { rpmTolerance: 35, interpolationWeight: 0.6, patternMultiplier: 1.5 },
        80: { rpmTolerance: 25, interpolationWeight: 0.75, patternMultiplier: 1.3 },
        90: { rpmTolerance: 15, interpolationWeight: 0.85, patternMultiplier: 1.15 },
        100: { rpmTolerance: 8, interpolationWeight: 0.95, patternMultiplier: 1.05 },
        110: { rpmTolerance: 5, interpolationWeight: 1.0, patternMultiplier: 1.0 },
        120: { rpmTolerance: 8, interpolationWeight: 0.95, patternMultiplier: 1.05 },
        130: { rpmTolerance: 15, interpolationWeight: 0.85, patternMultiplier: 1.15 },
        140: { rpmTolerance: 25, interpolationWeight: 0.75, patternMultiplier: 1.3 },
        150: { rpmTolerance: 35, interpolationWeight: 0.6, patternMultiplier: 1.5 },
        160: { rpmTolerance: 45, interpolationWeight: 0.5, patternMultiplier: 1.8 },
      },
    };

    this.safety = {
      leftRightTilt: { min: 890, max: 2000 },
      pan: { min: 2500, max: 3300 },
      tilt: { min: 2000, max: 3400 },
    };

    this.speedGroups = [
      {
        name: 'G1_60_70', speeds: new Set([60, 70]),
        params: { swingPanBase: 30, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: -300, tiltSpinMultiplier: 1.15, lrTiltBias: -200, lrTiltOffsetMultiplier: 1.4, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 },
      },
      {
        name: 'G2_80', speeds: new Set([80]),
        params: { swingPanBase: 25, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 0, tiltSpinMultiplier: 1.08, lrTiltBias: 0, lrTiltOffsetMultiplier: 1.5, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 },
      },
      {
        name: 'G3_90_100', speeds: new Set([90, 100]),
        params: { swingPanBase: 30, swingPanThreshold: 3, swingPanExtraPerLevel: 0, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0, lrTiltOffsetMultiplier: 1.5, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 },
      },
      {
        name: 'G4_110_120', speeds: new Set([110, 120]),
        params: { swingPanBase: 30, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0, lrTiltOffsetMultiplier: 1.5, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 },
      },
      {
        name: 'G5_130_140', speeds: new Set([130, 140]),
        params: { swingPanBase: 15, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 50, tiltSpinMultiplier: 1.0, lrTiltBias: -160, lrTiltOffsetMultiplier: 1.0, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 },
      },
      {
        name: 'G6_150_160', speeds: new Set([150, 160]),
        params: { swingPanBase: 15, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 50, tiltSpinMultiplier: 1.0, lrTiltBias: -200, lrTiltOffsetMultiplier: 1.0, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 },
      },
    ];

    this.interpolationCache = new Map();
    this.cacheTimestamps = new Map();
    this.cacheAccessCount = new Map();

    this.metrics = {
      cacheHits: 0, interpolations: 0, exactMatches: 0,
      cacheCleanups: 0, expiredEntries: 0, totalMemoryUsage: 0, lastCleanupRemoved: 0,
    };

    // ─────────────────────────────────────────────────────────────────────────
    //  CALIBRATION
    //
    //  Every drift/delta field has two layers:
    //    _default : { 1:{min,max,minGap}, 2:{…}, 3:{…} }   ← global fallback
    //    [speed]  : { 1:{min,max,minGap}, 2:{…}, 3:{…} }   ← per-speed override
    //
    //  _getCalRange(field, speed, level) picks the speed-specific entry first,
    //  then falls back to _default.
    //
    //  LEVEL RULES (variation balls only — default balls never come here):
    //    L1: up to 2 variation balls/over. Speed ±5–7. Length ±20 cm. Line ±20 cm (symmetric). Spin→0 only. Swing locked.
    //    L2: exactly 2.              Speed ±7–10. Length ±30 cm. Line ±30 cm (symmetric). Spin intensity swap. Swing locked.
    //    L3: 2 or 3.                 Speed ±10–15. Length ±50 cm. Line ±40 cm (symmetric). Full spin+swing changes.
    //
    //  X (line) shift is ALWAYS ±random magnitude:
    //    • min/max = MAGNITUDE only (always positive in calibration)
    //    • sign is chosen fresh randomly for every ball  → left OR right of default
    //    • higher level = wider magnitude range = more deflection
    //
    //  All values TBC — fill from machine tests, then call loadCalibrationData().
    // ─────────────────────────────────────────────────────────────────────────
    this.calibration = {
      // Unit scalars (set via machine measurement)
      X_UNITS_PER_CM: 1.15,   // TBC — lateral units per cm
      Y_UNITS_PER_CM: 0.5,  // TBC — longitudinal units per cm

      // ── Speed drift (km/h, variation balls only) ──────────────────────────
      speedDrift: {
        _default: {
          1: { min: 5, max: 7, minGap: 3 },
          2: { min: 7, max: 10, minGap: 4 },
          3: { min: 10, max: 15, minGap: 5 },
        },
        // Per-speed overrides (fill after testing):
        // 60:  { 1:{min:4, max:6,  minGap:3}, 2:{min:6,  max:9,  minGap:4}, 3:{min:9,  max:13, minGap:5} },
        // 160: { 1:{min:6, max:9,  minGap:3}, 2:{min:9,  max:12, minGap:4}, 3:{min:12, max:18, minGap:5} },
      },

      // ── Length shift in cm → Y coordinate (magnitude, sign random ±) ─────
      lengthDelta: {
        _default: {
          1: { min: 15, max: 25, minGap: 8 },
          2: { min: 25, max: 35, minGap: 10 },
          3: { min: 45, max: 55, minGap: 15 },
        },
      },

      // ── Line shift in cm → X coordinate (MAGNITUDE ONLY, sign random ±) ──
      //  Sign is always chosen independently per ball in _buildBallParams.
      //  null at L1 for ball types that have no line shift at all.
      lineDelta: {
        _default: {
          1: { min: 20, max: 32, minGap: 10},
          2: { min: 25, max: 35, minGap: 10 },
          3: { min: 35, max: 45, minGap: 12 },
        },
      },

      // ── Direct machine-value drift ranges ────────────────────────────────
      rpmDrift: {
        _default: {
          1: { min: 5, max: 15, minGap: 5 },
          2: { min: 10, max: 25, minGap: 8 },
          3: { min: 15, max: 40, minGap: 10 },
        },
      },

      tiltDrift: {
        _default: {
          1: { min: 10, max: 30, minGap: 10 },
          2: { min: 20, max: 60, minGap: 15 },
          3: { min: 40, max: 100, minGap: 20 },
        },
      },

      leftTiltDrift: {
        _default: {
          1: { min: 10, max: 40, minGap: 15 },
          2: { min: 30, max: 80, minGap: 20 },
          3: { min: 60, max: 150, minGap: 30 },
        },
      },

      rightTiltDrift: {
        _default: {
          1: { min: 10, max: 40, minGap: 15 },
          2: { min: 30, max: 80, minGap: 20 },
          3: { min: 60, max: 150, minGap: 30 },
        },
      },

      // ── Swing / spin level deltas (L3 only) ──────────────────────────────
      swingDelta: { min: 1, max: 2, minGap: 1 },
      spinDelta: { min: 1, max: 2, minGap: 1 },
    };

    this._lastVarValues = {
      speed: null, tilt: null, leftTilt: null, rightTilt: null,
      leftRPM: null, rightRPM: null,
    };

    this.SUPPORTED_SPEEDS = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];

    this.loadJsonData();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  _getCalRange(field, speed, level)
  //
  //  Returns { min, max, minGap } for a calibration drift field.
  //  Checks calibration[field][speed][level] first, then _default[level].
  // ═══════════════════════════════════════════════════════════════════════════
  _getCalRange(field, speed, level) {
    const entry = this.calibration[field];
    if (!entry) return null;
    return entry[speed]?.[level] ?? entry._default?.[level] ?? null;
  }

  loadCalibrationData(data) {
    const driftFields = [
      'speedDrift', 'lengthDelta', 'lineDelta',
      'rpmDrift', 'tiltDrift', 'leftTiltDrift', 'rightTiltDrift',
    ];

    if (data.X_UNITS_PER_CM !== undefined) this.calibration.X_UNITS_PER_CM = data.X_UNITS_PER_CM;
    if (data.Y_UNITS_PER_CM !== undefined) this.calibration.Y_UNITS_PER_CM = data.Y_UNITS_PER_CM;

    for (const field of driftFields) {
      if (!data[field]) continue;
      const incoming = data[field];
      // Detect full object (has _default or a speed key) vs legacy {1,2,3} shape
      const isFullObject = '_default' in incoming ||
        this.SUPPORTED_SPEEDS.some(s => s in incoming);

      if (isFullObject) {
        // Merge speed-by-speed so existing speed overrides aren't wiped
        for (const [k, v] of Object.entries(incoming)) {
          this.calibration[field][k] = { ...(this.calibration[field][k] ?? {}), ...v };
        }
      } else {
        // Legacy: treat as replacement _default
        this.calibration[field]._default = {
          ...this.calibration[field]._default,
          ...incoming,
        };
      }
    }

    if (data.swingDelta) this.calibration.swingDelta = data.swingDelta;
    if (data.spinDelta) this.calibration.spinDelta = data.spinDelta;

    console.log('[Controller] Calibration updated:', JSON.stringify(this.calibration, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  getSessionConfig  ←  PRIMARY ENTRY POINT (signature unchanged)
  // ═══════════════════════════════════════════════════════════════════════════
  async getSessionConfig(ballConfig, sessionOptions = {}) {
    const { speed, x, y, swingLevel, spinLevel } = ballConfig;
    const isAllRandom = sessionOptions.isAllRandom ?? false;
    const isRandom = (sessionOptions.isRandom ?? false) || isAllRandom;
    const randomLevel = sessionOptions.randomLevel ?? 1;
    const totalBalls = Math.min(135, Math.max(1, sessionOptions.totalBalls ?? 135));

    const validation = await this._validateAndLoad(speed, x, y, swingLevel, spinLevel);
    if (validation.error) return { error: validation.error };

    const sessionSeed = (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    const sessionId = `ses_${Date.now()}_${sessionSeed.toString(16)}`;
    const rng = this._createRNG(sessionSeed);
    const baseParams = { speed, x, y, swing: swingLevel, spin: spinLevel };

    // ── NON-RANDOM ──────────────────────────────────────────────────────────
    if (!isRandom) {
      const raw = await this.getMachineConfig(speed, x, y, swingLevel, spinLevel);
      if (raw.error) return { error: raw.error };
      const sharedConfig = raw.machineSettings ?? raw;
      const balls = Array.from({ length: totalBalls }, (_, i) => ({
        ballIndex: i + 1,
        overNum: Math.floor(i / 6) + 1,
        ballInOver: (i % 6) + 1,
        ballType: 'default',
        isVariation: false,
        params: { ...baseParams },
        machineConfig: sharedConfig,
        matchType: raw.matchType,
        accuracy: raw.accuracy,
        confidence: raw.confidence,
      }));
      return {
        sessionId, seed: sessionSeed, isRandom: false, randomLevel: null,
        totalBalls, overs: Math.ceil(totalBalls / 6), balls,
      };
    }

    // ── RANDOM ──────────────────────────────────────────────────────────────
    this._lastVarValues = {
      speed: null, tilt: null, leftTilt: null, rightTilt: null,
      leftRPM: null, rightRPM: null,
    };

    const baseRaw = await this.getMachineConfig(speed, x, y, swingLevel, spinLevel);
    if (baseRaw.error) return { error: baseRaw.error };
    const baseConfig = baseRaw.machineSettings ?? baseRaw;

    let overNum = 1, ballInOver = 0;
    let varTypeHistory = [], oversSinceHeavy = 0;
    let { overVarSlots, overVarTypes } =
      this._planOver(rng, randomLevel, spinLevel, oversSinceHeavy, varTypeHistory);

    const balls = [];

    for (let i = 0; i < totalBalls; i++) {
      const isVarBall = isAllRandom || overVarSlots.includes(ballInOver);
      const ballType = isAllRandom
        ? this._pickAllRandomType(rng, randomLevel, varTypeHistory)
        : (isVarBall ? overVarTypes[ballInOver] : 'default');

      let params, machineConfig, matchType, accuracy, confidence;

      if (!isVarBall) {
        params = { ...baseParams };
        machineConfig = baseConfig;
        matchType = baseRaw.matchType;
        accuracy = baseRaw.accuracy;
        confidence = baseRaw.confidence;
      } else {
        // _buildBallParams now produces symmetric X drift
        params = this._buildBallParams(ballType, baseParams, rng, randomLevel);
        params.x = Math.max(0, Math.min(300, params.x));
        params.y = Math.max(5, Math.min(80, params.y));
        params.spin = Math.max(-5, Math.min(5, params.spin));
        params.swing = Math.max(-5, Math.min(5, params.swing));

        const raw = await this.getMachineConfig(
          params.speed, params.x, params.y, params.swing, params.spin);
        const rawSettings = raw.machineSettings ?? raw;

        // Pass params.speed so drift uses speed-specific calibration
        machineConfig = this._applyMachineValueDrift(rawSettings, rng, randomLevel, params.speed);
        matchType = raw.matchType;
        accuracy = raw.accuracy;
        confidence = raw.confidence;
      }

      balls.push({
        ballIndex: i + 1, overNum, ballInOver: ballInOver + 1,
        ballType, isVariation: isVarBall,
        params, machineConfig, matchType, accuracy, confidence,
      });

      if (isVarBall) {
        varTypeHistory.push(ballType);
        if (varTypeHistory.length > 2) varTypeHistory.shift();
      }

      ballInOver++;
      if (ballInOver >= 6 && i < totalBalls - 1) {
        overNum++; ballInOver = 0; oversSinceHeavy++;
        const next = this._planOver(rng, randomLevel, spinLevel, oversSinceHeavy, varTypeHistory);
        overVarSlots = next.overVarSlots;
        overVarTypes = next.overVarTypes;
        if (Object.values(overVarTypes).includes('opp_turn_heavy')) oversSinceHeavy = 0;
      }
    }

    return {
      sessionId, seed: sessionSeed, isRandom: true, randomLevel, isAllRandom,
      totalBalls, overs: Math.ceil(totalBalls / 6), balls,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  RANDOMISATION – PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  _createRNG(seed) {
    let s = seed >>> 0;
    const rng = {
      next() { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; },
      int(a, b) { return a + Math.floor(rng.next() * (b - a + 1)); },
      float(a, b) { return a + rng.next() * (b - a); },
      pick(arr) { return arr[rng.int(0, arr.length - 1)]; },
      shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i);[a[i], a[j]] = [a[j], a[i]]; } return a; },
      sign() { return rng.next() < 0.5 ? 1 : -1; },  // ★ always fresh random sign
    };
    return rng;
  }

  _snapSpeed(speed) {
    return this.SUPPORTED_SPEEDS.reduce(
      (p, c) => Math.abs(c - speed) < Math.abs(p - speed) ? c : p);
  }

  // ── Over planner (unchanged) ──────────────────────────────────────────────
  _pickAllRandomType(rng, level, history) {
    const pools = {
      1: ['length_shift', 'straight_ball'],
      2: ['length_and_line', 'straight_and_line', 'length_spin_swap'],
      3: ['length_line_heavy', 'straight_and_line', 'opp_turn_light',
          'opp_turn_heavy_swing', 'swing_change', 'spin_intensity_shift'],
    };
    const pool = pools[level] ?? pools[1];
    const fresh = pool.filter(t => !history.slice(-2).includes(t));
    return rng.pick(fresh.length ? fresh : pool);
  }

  _planOver(rng, level, baseSpin, oversSinceHeavy, varTypeHistory) {
    const varCount = level === 1 ? rng.int(1, 2) : level === 2 ? 2 : rng.int(2, 3);

    const candidates = rng.shuffle([1, 2, 3, 4, 5]);
    const slots = [];
    for (const c of candidates) {
      if (slots.length >= varCount) break;
      if (slots.some(s => Math.abs(s - c) === 1)) continue;
      slots.push(c);
    }
    const finalSlots = slots.length >= varCount
      ? slots.sort((a, b) => a - b)
      : [1, 3, 5].slice(0, varCount);

    const types = {};

    if (level === 1) {
      const l1Pool = ['length_shift', 'straight_ball'];
      finalSlots.forEach((slot, idx) => {
        const avoid = idx > 0 ? [types[finalSlots[idx - 1]]] : varTypeHistory.slice(-1);
        const fresh = l1Pool.filter(t => !avoid.includes(t));
        types[slot] = rng.pick(fresh.length ? fresh : l1Pool);
      });
    }

    if (level === 2) {
      const l2Pool = ['length_and_line', 'straight_and_line', 'length_spin_swap'];
      const v2Fresh = l2Pool.filter(t => !varTypeHistory.slice(-2).includes(t));
      types[finalSlots[0]] = rng.pick(v2Fresh.length ? v2Fresh : l2Pool);
      const remaining = l2Pool.filter(t => t !== types[finalSlots[0]]);
      types[finalSlots[1]] = rng.pick(remaining);
    }

    if (level === 3) {
      types[finalSlots[0]] = 'length_line_heavy';
      const v3v2Pool = ['straight_and_line', 'opp_turn_light'];
      const v3v2Fresh = v3v2Pool.filter(t => !varTypeHistory.slice(-2).includes(t));
      types[finalSlots[1]] = rng.pick(v3v2Fresh.length ? v3v2Fresh : v3v2Pool);
      if (finalSlots[2] !== undefined) {
        types[finalSlots[2]] = oversSinceHeavy >= 2
          ? 'opp_turn_heavy_swing'
          : this._pickNonRepeat(rng, ['swing_change', 'spin_intensity_shift'], varTypeHistory);
      }
    }

    return { overVarSlots: finalSlots, overVarTypes: types };
  }

  _pickNonRepeat(rng, options, history) {
    const fresh = options.filter(t => !history.slice(-2).includes(t));
    return rng.pick(fresh.length ? fresh : options);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  _buildBallParams
  //
  //  ★ X DRIFT IS SYMMETRIC:
  //    - lineDelta.min/max are MAGNITUDES (always positive in calibration)
  //    - rng.sign() picks a fresh + or − for every X shift independently
  //    - The result:  x = base.x  ±  random_magnitude
  //    - Higher level → wider magnitude range → larger deflection left or right
  //
  //  Y drift also uses rng.sign() (unchanged behaviour, just explicit now).
  //  All other logic (speed drift, spin, swing) unchanged.
  // ═══════════════════════════════════════════════════════════════════════════
  _buildBallParams(ballType, base, rng, level) {
    let { speed, x, y, swing, spin } = { ...base };

    // ── Speed drift — every variation ball ────────────────────────────────
    const dr = this._getCalRange('speedDrift', speed, level) ?? { min: 5, max: 7 };
    const amt = rng.float(dr.min, dr.max) * rng.sign();
    speed = this._snapSpeed(Math.max(60, speed + amt));

    const X = this.calibration.X_UNITS_PER_CM;
    const Y = this.calibration.Y_UNITS_PER_CM;
    const ld = this._getCalRange('lengthDelta', speed, level) ?? { min: 15, max: 25 };
    const li = this._getCalRange('lineDelta', speed, level);  // null = no line shift

    // ★ Always fresh random sign for each axis independently
    const ySign = rng.sign();   // length direction: shorter or fuller
    const xSign = rng.sign();   // line direction: LEFT or RIGHT of default

    switch (ballType) {

      // ── Level 1 ─────────────────────────────────────────────────────────
      case 'length_shift':
        // Y shifts, X shifts if L1 has lineDelta (currently has it — symmetric)
        y += rng.float(ld.min, ld.max) * Y * ySign;
        if (li) x += rng.float(li.min, li.max) * X * xSign;
        break;

      case 'straight_ball':
        // Spin → 0, small Y drift, optional symmetric X
        spin = 0;
        y += rng.float(ld.min * 0.5, ld.max * 0.5) * Y * ySign;
        if (li) x += rng.float(li.min, li.max) * X * xSign;
        break;

      // ── Level 2 ─────────────────────────────────────────────────────────
      case 'length_and_line':
        y += rng.float(ld.min, ld.max) * Y * ySign;
        x += rng.float(li.min, li.max) * X * xSign;   // symmetric ±
        break;

      case 'straight_and_line':
        spin = 0;
        x += rng.float(li.min, li.max) * X * xSign;   // symmetric ±
        y += rng.float(ld.min * 0.5, ld.max * 0.5) * Y * ySign;
        break;

      case 'length_spin_swap':
        y += rng.float(ld.min, ld.max) * Y * ySign;
        if (li) x += rng.float(li.min, li.max) * X * xSign;
        spin = base.spin > 0
          ? Math.max(1, base.spin + (rng.next() < 0.5 ? -1 : 1))
          : base.spin < 0
            ? Math.min(-1, base.spin + (rng.next() < 0.5 ? 1 : -1))
            : 0;
        break;

      // ── Level 3 ─────────────────────────────────────────────────────────
      case 'length_line_heavy':
        y += rng.float(ld.min, ld.max) * Y * ySign;
        x += rng.float(li.min, li.max) * X * xSign;   // symmetric ±
        break;

      case 'opp_turn_light':
        spin = -(Math.min(Math.abs(base.spin), 1));
        x += rng.float(li.min, li.max) * X * xSign;   // symmetric ±
        y += rng.float(ld.min * 0.4, ld.max * 0.4) * Y * ySign;
        break;

      case 'opp_turn_heavy_swing': {
        const spd = this.calibration.spinDelta ?? { min: 1, max: 2 };
        const spAmt = rng.int(spd.min, spd.max);
        spin = base.spin >= 0
          ? -Math.min(5, Math.abs(base.spin) + spAmt)
          : Math.min(5, Math.abs(base.spin) + spAmt);
        const sd = this.calibration.swingDelta ?? { min: 1, max: 2 };
        const swD = rng.int(sd.min, sd.max);
        swing = base.swing >= 0
          ? Math.min(5, base.swing + swD)
          : Math.max(-5, base.swing - swD);
        x += rng.float(li.min, li.max) * X * xSign;   // symmetric ±
        y += rng.float(ld.min * 0.5, ld.max * 0.5) * Y * ySign;
        break;
      }

      case 'swing_change': {
        const sd = this.calibration.swingDelta;
        const swD = rng.float(sd.min, sd.max);
        swing = base.swing >= 0
          ? Math.min(5, base.swing + Math.round(swD) + 1)
          : Math.max(-5, base.swing - Math.round(swD) - 1);
        y += rng.float(ld.min, ld.max) * Y * ySign;
        x += rng.float(li.min, li.max) * X * xSign;   // symmetric ±
        break;
      }

      case 'spin_intensity_shift': {
        y += rng.float(ld.min, ld.max) * Y * ySign;
        x += rng.float(li.min, li.max) * X * xSign;
        const spd3 = this.calibration.spinDelta ?? { min: 1, max: 2 };
        const spAmt3 = rng.int(spd3.min, spd3.max) * rng.sign();
        spin = base.spin > 0
          ? Math.max(1, Math.min(5, base.spin + spAmt3))
          : base.spin < 0
            ? Math.max(-5, Math.min(-1, base.spin + spAmt3))
            : 0;
        break;
      }

      default:
        break;
    }

    return {
      speed: Math.round(speed),
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      swing,
      spin,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  _applyMachineValueDrift
  //
  //  Now accepts `ballSpeed` so it can resolve speed-specific drift ranges.
  //  All other behaviour unchanged (gap enforcement, safety clamps, tracker).
  // ═══════════════════════════════════════════════════════════════════════════
  _applyMachineValueDrift(settings, rng, level, ballSpeed) {
    const last = this._lastVarValues;
    const out = { ...settings };

    const driftField = (baseVal, range, lastVal, safeMin, safeMax) => {
      if (!range) return baseVal;
      const shift = rng.float(range.min, range.max);
      let sign = rng.sign();
      let newVal = baseVal + sign * shift;
      // Non-repetition: flip sign if too close to last variation ball's value
      if (lastVal !== null && Math.abs(newVal - lastVal) < (range.minGap ?? 0)) {
        sign = -sign;
        newVal = baseVal + sign * shift;
      }
      return Math.round(Math.max(safeMin, Math.min(safeMax, newVal)));
    };

    const PAN_MIN = this.safety.pan.min, PAN_MAX = this.safety.pan.max;
    const TLT_MIN = this.safety.tilt.min, TLT_MAX = this.safety.tilt.max;
    const LRT_MIN = this.safety.leftRightTilt.min, LRT_MAX = this.safety.leftRightTilt.max;
    const RPM_MIN = 150, RPM_MAX = 560;

    // Resolve speed-specific (or default) drift ranges
    const rpmR = this._getCalRange('rpmDrift', ballSpeed, level);
    const tltR = this._getCalRange('tiltDrift', ballSpeed, level);
    const ltrR = this._getCalRange('leftTiltDrift', ballSpeed, level);
    const rtrR = this._getCalRange('rightTiltDrift', ballSpeed, level);

    if (rpmR) {
      out.leftRPM = driftField(settings.leftRPM, rpmR, last.leftRPM, RPM_MIN, RPM_MAX);
      out.rightRPM = driftField(settings.rightRPM, rpmR, last.rightRPM, RPM_MIN, RPM_MAX);
    }
    if (tltR) {
      out.tilt = driftField(settings.tilt, tltR, last.tilt, TLT_MIN, TLT_MAX);
      out.tiltActual = out.tilt;
    }
    if (ltrR) {
      out.leftTilt = driftField(settings.leftTilt, ltrR, last.leftTilt, LRT_MIN, LRT_MAX);
      out.leftTiltActual = out.leftTilt;
    }
    if (rtrR) {
      out.rightTilt = driftField(settings.rightTilt, rtrR, last.rightTilt, LRT_MIN, LRT_MAX);
      out.rightTiltActual = out.rightTilt;
    }

    this._lastVarValues = {
      speed: null,           // speed tracked separately via params
      tilt: out.tilt,
      leftTilt: out.leftTilt,
      rightTilt: out.rightTilt,
      leftRPM: out.leftRPM,
      rightRPM: out.rightRPM,
    };

    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ALL ORIGINAL INTERNALS BELOW — UNCHANGED
  // ═══════════════════════════════════════════════════════════════════════════

  async _validateAndLoad(speed, x, y, swingLevel, spinLevel) {
    if (!Number.isFinite(speed) || !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(swingLevel) || !Number.isFinite(spinLevel))
      return { error: 'Invalid input parameters' };
    if (x < 0 || x > 300 || y < 5 || y > 80)
      return { error: 'Coordinates out of bounds (X: 0–300, Y: 5–80)' };
    if (swingLevel < -5 || swingLevel > 5 || spinLevel < -5 || spinLevel > 5)
      return { error: 'swingLevel and spinLevel must be -5 to +5' };
    try { await this.ensureDataLoaded(); } catch (e) { return { error: `Failed to load data: ${e.message}` }; }
    if (!this.jsonData.data[`${speed}_kmph`])
      return { error: `Speed ${speed} km/h not in dataset. Supported: ${this.SUPPORTED_SPEEDS.join(', ')}` };
    return { ok: true };
  }

  async getMachineConfig(speed, x, y, swingLevel, spinLevel) {
    if (!Number.isFinite(speed) || !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(swingLevel) || !Number.isFinite(spinLevel))
      return { error: 'Invalid input parameters' };
    if (x < 0 || x > 300 || y < 5 || y > 80) return { error: 'Coordinates out of bounds' };
    if (swingLevel < -5 || swingLevel > 5 || spinLevel < -5 || spinLevel > 5) return { error: 'Levels out of bounds' };
    try { await this.ensureDataLoaded(); } catch (e) { return { error: `Failed to load data: ${e.message}` }; }
    if (!this.jsonData.data[`${speed}_kmph`]) {
      const available = Object.keys(this.jsonData.data).map(k => k.replace('_kmph', '')).join(', ');
      return { error: `Speed ${speed} not supported. Available: ${available}` };
    }
    const speedData = this.jsonData.data[`${speed}_kmph`];
    const swingKey = `swing_level_${swingLevel}`;
    const spinKey = `spin_level_${spinLevel}`;
    if (!speedData.swing_levels[swingKey]) return { error: `Swing level ${swingLevel} not supported` };
    if (!speedData.swing_levels[swingKey].spin_levels[spinKey]) return { error: `Spin level ${spinLevel} not supported` };
    const levelData = speedData.swing_levels[swingKey].spin_levels[spinKey];
    const positions = levelData.positions;
    let closestPosition = null, minDistance = Infinity;
    for (const [name, data] of Object.entries(positions)) {
      const d = Math.sqrt(Math.pow(data.X - x, 2) + Math.pow(data.Y - y, 2));
      if (d < minDistance) { minDistance = d; closestPosition = { name, data }; }
    }
    const speedProfile = this.getSpeedRpmProfile(speed);
    const exactThreshold = speed === 110 ? 3 : 5;
    if (minDistance < exactThreshold) {
      this.metrics.exactMatches++;
      const zeroSS = swingLevel === 0 && spinLevel === 0;
      const lRPM = zeroSS ? Math.round(closestPosition.data.L_RPM) : this.applyRealisticSpeedRpmPattern(closestPosition.data.L_RPM, speed, speedProfile, x, y);
      const rRPM = zeroSS ? Math.round(closestPosition.data.R_RPM) : this.applyRealisticSpeedRpmPattern(closestPosition.data.R_RPM, speed, speedProfile, x, y);
      return {
        speed, swingLevel, spinLevel, coordinates: { x, y },
        machineSettings: {
          pan: this.clampRange('pan', this.round1(closestPosition.data.Pan)),
          panActual: this.clampRange('pan', this.round1(closestPosition.data.Pan_actual)),
          tilt: this.clampRange('tilt', Math.round(closestPosition.data.Tilt)),
          tiltActual: this.clampRange('tilt', Math.round(closestPosition.data.Tilt_actual)),
          leftTilt: this.clampLRTilt(Math.round(closestPosition.data.Left_Tilt)),
          leftTiltActual: this.clampLRTilt(Math.round(closestPosition.data.Left_Tilt)),
          rightTilt: this.clampLRTilt(Math.round(closestPosition.data.Right_Tilt)),
          rightTiltActual: this.clampLRTilt(Math.round(closestPosition.data.Right_Tilt)),
          leftRPM: lRPM, rightRPM: rRPM,
        },
        matchType: 'exact', referencePoint: closestPosition.name,
        accuracy: 100, confidence: 100, distance: minDistance,
      };
    }
    const interpolated = this.calculateInterpolationFromJson(speed, x, y, swingLevel, spinLevel);
    return {
      speed, swingLevel, spinLevel, coordinates: { x, y },
      machineSettings: {
        pan: interpolated.pan, panActual: interpolated.panActual,
        tilt: interpolated.tilt, tiltActual: interpolated.tiltActual,
        leftTilt: interpolated.leftTilt, leftTiltActual: interpolated.leftTiltActual,
        rightTilt: interpolated.rightTilt, rightTiltActual: interpolated.rightTiltActual,
        leftRPM: interpolated.leftRPM, rightRPM: interpolated.rightRPM,
      },
      matchType: 'interpolated',
      accuracy: Math.round(interpolated.accuracy),
      confidence: interpolated.confidence,
      distance: Math.round(interpolated.avgDistance * 10) / 10,
    };
  }

  round1(n) { return Math.round(n * 10) / 10; }
  clampRange(key, v) { const r = this.safety[key]; return Math.max(r.min, Math.min(r.max, v)); }
  clampLRTilt(v) { const r = this.safety.leftRightTilt; return Math.max(r.min, Math.min(r.max, v)); }
  det3(a, b, c, d, e, f, g, h, i) { return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g); }

  solvePlaneWeighted(points) {
    let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sw = 0, Szx = 0, Szy = 0, Sz = 0;
    for (const { x, y, z, w } of points) { Sxx += w * x * x; Sxy += w * x * y; Syy += w * y * y; Sx += w * x; Sy += w * y; Sw += w; Szx += w * x * z; Szy += w * y * z; Sz += w * z; }
    const detA = this.det3(Sxx, Sxy, Sx, Sxy, Syy, Sy, Sx, Sy, Sw);
    if (Math.abs(detA) < 1e-6) return { ok: false };
    return { ok: true, a: this.det3(Szx, Sxy, Sx, Szy, Syy, Sy, Sz, Sy, Sw) / detA, b: this.det3(Sxx, Szx, Sx, Sxy, Szy, Sy, Sx, Sz, Sw) / detA, c: this.det3(Sxx, Sxy, Szx, Sxy, Syy, Szy, Sx, Sy, Sz) / detA };
  }

  predictPlane(pts, x, y) { const s = this.solvePlaneWeighted(pts); if (!s.ok) return { ok: false, z: null }; return { ok: true, z: s.a * x + s.b * y + s.c }; }
  getGroupParams(speed) { for (const g of this.speedGroups) if (g.speeds.has(speed)) return g.params; return { swingPanBase: 25, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0, lrTiltOffsetMultiplier: 1.0, enhancedTiltPerLevel: 200, spinPanEffectMultiplier: 10 }; }

  importSpeedGroupsFromJson(metadata) {
    const sg = metadata?.speed_groups; if (!sg) return;
    const mk = { swingPanBase: 'swing_pan_base', swingPanThreshold: 'swing_pan_threshold', swingPanExtraPerLevel: 'swing_pan_extra_per_level', tiltBias: 'tilt_additive_bias', tiltSpinMultiplier: 'tilt_spin_multiplier', lrTiltBias: 'lr_tilt_additive_bias', lrTiltOffsetMultiplier: 'lr_tilt_offset_multiplier', enhancedTiltPerLevel: 'enhanced_tilt_per_level', spinPanEffectMultiplier: 'spin_pan_effect_multiplier' };
    for (const g of this.speedGroups) { const src = sg[g.name]; if (!src) continue; const np = {}; for (const [jk, jv] of Object.entries(mk)) np[jk] = src[jv] ?? g.params[jk]; g.params = { ...g.params, ...np }; }
  }

  async loadJsonData() {
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = new Promise(async (resolve, reject) => {
      try {
        const r = await fetch('bowling_data.json');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        this.jsonData = await r.json();
        this.importSpeedGroupsFromJson(this.jsonData.generation_metadata);
        this.isDataLoaded = true;
        resolve(this.jsonData);
      } catch (e) { this.isDataLoaded = false; reject(e); }
    });
    return this.loadingPromise;
  }

  async ensureDataLoaded() { if (this.isDataLoaded) return this.jsonData; return await this.loadJsonData(); }

  getRegionTolerance(y) { if (y <= 15) return 12; if (y <= 35) return 16; if (y <= 60) return 22; return 20; }
  getAnchoredWeight(y) { if (y <= 25) return 0.6; if (y <= 35) return 0.45; if (y <= 60) return 0.25; return 0.1; }

  calculateRegionMultiplier(targetY, point) {
    let m = 1.0;
    if (targetY <= 30) { if (point.name.includes('top')) m = 1.6; else if (point.name.includes('mid')) m = 1.35; }
    else if (targetY <= 60) { if (point.name.includes('centre')) m = 1.45; else if (point.name.includes('left') || point.name.includes('right')) m = 1.3; }
    else { if (point.name.includes('bottom')) m = 1.9; else if (point.name.includes('centre')) m = 1.4; }
    return m;
  }

  calculateConfidenceScore(points, tolerance) { const avg = points.reduce((s, p) => s + p.distance, 0) / points.length; const maxW = Math.max(...points.map(p => p.weight || p.w || 1)); return Math.round((Math.max(0, 100 - (avg / tolerance) * 30) + Math.min(100, maxW * 20)) / 2); }
  calculateAccuracyScore(points, tX, tY) { const avg = points.reduce((s, p) => s + p.distance, 0) / points.length; const rt = this.getRegionTolerance(tY); return Math.min(100, Math.max(0, 100 - (avg / rt) * 15) + Math.min(10, points.length * 2)); }
  getRegionName(y) { if (y <= 15) return 'ULTRA_PRECISION_TOP_EDGE'; if (y <= 35) return 'HIGH_PRECISION_TOP'; if (y <= 60) return 'MEDIUM_PRECISION_MIDDLE'; return 'STANDARD_PRECISION_BOTTOM'; }
  midTiltAnchor(y) { const pts = [{ y: 5, m: 1500 }, { y: 25, m: 1400 }, { y: 40, m: 1200 }, { y: 80, m: 800 }]; if (y <= pts[0].y) return pts[0].m; if (y >= pts[pts.length - 1].y) return pts[pts.length - 1].m; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (y >= a.y && y <= b.y) return a.m + (y - a.y) / (b.y - a.y) * (b.m - a.m); } return 1200; }
  getMaxLRTiltForY(y, speed, swingLevel, spinLevel) { if (y <= 40) return null; const ld = this.jsonData.data[`${speed}_kmph`].swing_levels[`swing_level_${swingLevel}`].spin_levels[`spin_level_${spinLevel}`]; const c = ld.positions['centre - 0'], bm = ld.positions['bottom - 4']; const t = (y - 40) / 40; return { maxLeft: c.Left_Tilt + t * (bm.Left_Tilt - c.Left_Tilt), maxRight: c.Right_Tilt + t * (bm.Right_Tilt - c.Right_Tilt) }; }
  anisotropicDistance(ax, ay, bx, by) { const yAvg = (ay + by) / 2; const yScale = yAvg >= 60 ? 1.5 : yAvg >= 35 ? 1.2 : 1.0; return Math.hypot(ax - bx, (ay - by) * yScale); }

  calculateInterpolationFromJson(speed, tX, tY, swingLevel, spinLevel) {
    const ck = `${speed}-${tX}-${tY}-${swingLevel}-${spinLevel}`; const cached = this.getCachedResult(ck); if (cached) return cached;
    const ld = this.jsonData.data[`${speed}_kmph`].swing_levels[`swing_level_${swingLevel}`].spin_levels[`spin_level_${spinLevel}`];
    const tol = this.getRegionTolerance(tY); const sp2 = this.getSpeedRpmProfile(speed);
    const rp = Object.entries(ld.positions).map(([name, data]) => { const dist = this.anisotropicDistance(data.X, data.Y, tX, tY); let rm = this.calculateRegionMultiplier(tY, { name }); const pb = dist < tol ? 1.2 : 1.0; rm *= sp2.patternMultiplier; const inv = 1 / (dist + 0.1); const w = rm * pb * inv; return { name, distance: dist, data, w, w2: w * inv }; });
    const best = rp.sort((a, b) => a.distance - b.distance).slice(0, Math.min(6, rp.length));
    const mkPts = (f) => best.map(p => ({ x: p.data.X, y: p.data.Y, z: p.data[f], w: p.w2 }));
    const mkMid = () => best.map(p => ({ x: p.data.X, y: p.data.Y, z: (p.data.Left_Tilt + p.data.Right_Tilt) / 2, w: p.w2 }));
    const pf = this.predictPlane(mkPts('Pan'), tX, tY); const tf = this.predictPlane(mkPts('Tilt'), tX, tY); const mf = this.predictPlane(mkMid(), tX, tY);
    const wAvg = (f) => { let tw = 0, s = 0; for (const p of best) { tw += p.w; s += p.data[f] * p.w; } return s / Math.max(1e-6, tw); };
    let panBase = pf.ok ? pf.z : wAvg('Pan'); let tiltBase = tf.ok ? tf.z : wAvg('Tilt');
    const anch = this.midTiltAnchor(tY); const aw = this.getAnchoredWeight(tY);
    const midRaw = mf.ok ? mf.z : best.reduce((s, p) => { const m = (p.data.Left_Tilt + p.data.Right_Tilt) / 2; return s + m * p.w; }, 0) / best.reduce((s, p) => s + p.w, 0);
    let finalMid = (1 - aw) * midRaw + aw * anch; if (tY <= 35) finalMid = Math.max(finalMid, anch);
    const yWAvg = (f) => { let tw = 0, s = 0; for (const p of best) { const w = 1 / (Math.abs(p.data.Y - tY) + 0.1); tw += w; s += p.data[f] * w; } return s / Math.max(1e-6, tw); };
    let cL = yWAvg('Left_Tilt'), cR = yWAvg('Right_Tilt');
    if (tY > 40) { const mx = this.getMaxLRTiltForY(tY, speed, swingLevel, spinLevel); if (mx) { cL = Math.min(cL, mx.maxLeft); cR = Math.min(cR, mx.maxRight); } }
    const bLR = (f) => { let tw = 0, s = 0; for (const p of best) { tw += p.w; s += p.data[f] * p.w; } return s / Math.max(1e-6, tw); };
    const bLRPM = bLR('L_RPM'), bRRPM = bLR('R_RPM'); const zeroSS = swingLevel === 0 && spinLevel === 0;
    const adjL = zeroSS ? Math.round(bLRPM) : this.applyRealisticSpeedRpmPattern(bLRPM, speed, sp2, tX, tY);
    const adjR = zeroSS ? Math.round(bRRPM) : this.applyRealisticSpeedRpmPattern(bRRPM, speed, sp2, tX, tY);
    panBase = this.clampRange('pan', this.round1(panBase)); tiltBase = this.clampRange('tilt', Math.round(tiltBase));
    const result = { pan: panBase, panActual: panBase, tilt: tiltBase, tiltActual: tiltBase, leftTilt: Math.round(this.clampLRTilt(cL)), leftTiltActual: Math.round(this.clampLRTilt(cL)), rightTilt: Math.round(this.clampLRTilt(cR)), rightTiltActual: Math.round(this.clampLRTilt(cR)), leftRPM: adjL, rightRPM: adjR, usedPoints: best.length, accuracy: this.calculateAccuracyScore(best, tX, tY), confidence: this.calculateConfidenceScore(best, tol), avgDistance: best.reduce((s, p) => s + p.distance, 0) / best.length };
    this.setCachedResult(ck, result); return result;
  }

  getSpeedRpmProfile(speed) { const p = this.speedRpmProfile.toleranceProfile[speed]; if (p) return p; const d = Math.abs(speed - this.speedRpmProfile.referenceSpeed); return { rpmTolerance: Math.min(50, 5 + Math.pow(d / 8, 1.8)), interpolationWeight: Math.max(0.3, 1 - (d / 80)), patternMultiplier: 1 + (d / 50) }; }

  applyRealisticSpeedRpmPattern(baseRPM, speed, speedProfile, tX, tY) {
    const LIMITS = { min: 150, max: 560 }; const ref = this.speedRpmProfile.referenceSpeed;
    if (speed <= ref) { return Math.round(Math.max(LIMITS.min, Math.min(LIMITS.max, baseRPM))); }
    const boosts = { 120: 15, 130: 35, 140: 55, 150: 75, 160: 95 }; const dev = speed - ref; let boost = boosts[speed];
    if (!boost) { const f = (speed - ref) / 10; boost = Math.pow(f, 1.4) * 20; }
    const df = Math.abs(dev) / 25; const pm = 1 + Math.pow(df, 1.5) * speedProfile.patternMultiplier;
    let pv = 1; if (tX < 75 || tX > 225) pv = 1.3; if (tY < 20 || tY > 60) pv *= 1.2;
    let adj = boost + (dev * 0.8 * pm * pv) + ((Math.random() - 0.5) * speedProfile.rpmTolerance) + ((Math.random() - 0.5) * 10 * speedProfile.patternMultiplier);
    let final = baseRPM + adj; if (speedProfile.interpolationWeight < 1) { final = baseRPM + adj * speedProfile.interpolationWeight + adj * (1 - speedProfile.interpolationWeight) * 0.5; }
    final = Math.max(LIMITS.min, Math.min(LIMITS.max, final));
    const d = Math.abs(speed - ref); return d <= 10 ? Math.round(final * 2) / 2 : d <= 30 ? Math.round(final) : Math.round(final / 2) * 2;
  }

  manageCacheSize() {
    const now = Date.now(); let rc = 0;
    for (const [k, ts] of this.cacheTimestamps.entries()) { if (now - ts > this.cacheConfig.maxAge) { this.interpolationCache.delete(k); this.cacheTimestamps.delete(k); this.cacheAccessCount.delete(k); rc++; this.metrics.expiredEntries++; } }
    if (this.interpolationCache.size >= this.cacheConfig.cleanupThreshold) { Array.from(this.cacheAccessCount.entries()).sort((a, b) => a[1] - b[1]).slice(0, this.cacheConfig.cleanupBatchSize).forEach(([k]) => { this.interpolationCache.delete(k); this.cacheTimestamps.delete(k); this.cacheAccessCount.delete(k); rc++; }); this.metrics.cacheCleanups++; }
    this.metrics.lastCleanupRemoved = rc; this.metrics.totalMemoryUsage = this.interpolationCache.size * 200; return rc;
  }

  getCachedResult(k) { if (this.interpolationCache.has(k)) { this.cacheAccessCount.set(k, (this.cacheAccessCount.get(k) || 0) + 1); this.metrics.cacheHits++; return this.interpolationCache.get(k); } return null; }
  setCachedResult(k, v) { if (this.interpolationCache.size >= this.cacheConfig.maxSize) this.manageCacheSize(); this.interpolationCache.set(k, v); this.cacheTimestamps.set(k, Date.now()); this.cacheAccessCount.set(k, 1); this.metrics.interpolations++; this.metrics.totalMemoryUsage = this.interpolationCache.size * 200; }
  clearCache() { const s = this.interpolationCache.size; this.interpolationCache.clear(); this.cacheTimestamps.clear(); this.cacheAccessCount.clear(); this.metrics.totalMemoryUsage = 0; return s; }
  getCacheStats() { return { size: this.interpolationCache.size, expiredEntries: this.metrics.expiredEntries, lastCleanupRemoved: this.metrics.lastCleanupRemoved, totalMemoryUsage: this.metrics.totalMemoryUsage }; }
  async preload() { await this.ensureDataLoaded(); return true; }
}