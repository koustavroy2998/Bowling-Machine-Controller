class BowlingMachineController {
  constructor() {
    this.jsonData = null;
    this.isDataLoaded = false;
    this.loadingPromise = null;

    // Conservative cache configuration
    this.cacheConfig = {
      maxSize: 5000,
      cleanupThreshold: 4500,
      cleanupBatchSize: 1000,
      maxAge: 3600000, // 1h
    };

    // Accuracy zones
    this.accuracyZones = {
      ULTRA_PRECISION: { yMin: 5, yMax: 15, tolerance: 12 },
      HIGH_PRECISION: { yMin: 15, yMax: 35, tolerance: 16 },
      MEDIUM_PRECISION: { yMin: 35, yMax: 60, tolerance: 22 },
      STANDARD_PRECISION: { yMin: 60, yMax: 80, tolerance: 20 },
    };

    // Speed-dependent RPM tolerance profile
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
        160: { rpmTolerance: 45, interpolationWeight: 0.5, patternMultiplier: 1.8 }
      }
    };

    // Safety limits
    this.safety = {
      leftRightTilt: { min: 400, max: 2700 },
      pan: { min: 2500, max: 3500 },
      tilt: { min: 500, max: 3900 },
    };

    // Speed groups with PRESET CONFIGS (matching generator)
    // Current grouping: 60–70, 80, 90–100, 110–120, 130–140, 150–160
    this.speedGroups = [
      { name: 'G1_60_70',   speeds: new Set([60, 70]),
        params: { swingPanBase: 25, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: -500, tiltSpinMultiplier: 1.15, lrTiltBias: 0 } },
      { name: 'G2_80',      speeds: new Set([80]),
        params: { swingPanBase: 25, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: -350, tiltSpinMultiplier: 1.08, lrTiltBias: 0 } },
      { name: 'G3_90_100',  speeds: new Set([90, 100]),
        params: { swingPanBase: 25, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 } },
      { name: 'G4_110_120', speeds: new Set([110, 120]),
        params: { swingPanBase: 13, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 50, tiltSpinMultiplier: 1.0, lrTiltBias: -120 } },
      { name: 'G5_130_140', speeds: new Set([130, 140]),
        params: { swingPanBase: 20, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 50, tiltSpinMultiplier: 1.0, lrTiltBias: -160 } },
      { name: 'G6_150_160', speeds: new Set([150, 160]),
        params: { swingPanBase: 15, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 50, tiltSpinMultiplier: 1.0, lrTiltBias: -200 } },
    ];

    // Caches
    this.interpolationCache = new Map();
    this.cacheTimestamps = new Map();
    this.cacheAccessCount = new Map();

    // Metrics
    this.metrics = {
      cacheHits: 0,
      interpolations: 0,
      exactMatches: 0,
      cacheCleanups: 0,
      expiredEntries: 0,
      totalMemoryUsage: 0, // approx bytes
      lastCleanupRemoved: 0,
    };

    // Kick off JSON load
    this.loadJsonData();
  }

  // ============== Utilities ==============
  round1(n) { return Math.round(n * 10) / 10; }

  clampRange(key, v) {
    const r = this.safety[key];
    return Math.max(r.min, Math.min(r.max, v));
  }

  clampLRTilt(v) {
    const r = this.safety.leftRightTilt;
    return Math.max(r.min, Math.min(r.max, v));
  }

  // Small 3x3 linear solver (Cramer) for plane fit
  det3(a,b,c,d,e,f,g,h,i){ return a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g); }

  solvePlaneWeighted(points) {
    // points: [{x,y,z,w}]
    let Sxx=0,Sxy=0,Syy=0,Sx=0,Sy=0,Sw=0,Szx=0,Szy=0,Sz=0;
    for (const p of points) {
      const {x,y,z,w} = p;
      Sxx += w*x*x;
      Sxy += w*x*y;
      Syy += w*y*y;
      Sx  += w*x;
      Sy  += w*y;
      Sw  += w;
      Szx += w*x*z;
      Szy += w*y*z;
      Sz  += w*z;
    }
    const A11=Sxx, A12=Sxy, A13=Sx;
    const A21=Sxy, A22=Syy, A23=Sy;
    const A31=Sx,  A32=Sy,  A33=Sw;
    const B1=Szx,  B2=Szy,  B3=Sz;

    const detA = this.det3(A11,A12,A13,A21,A22,A23,A31,A32,A33);
    if (Math.abs(detA) < 1e-6) return { ok:false };

    const detAx = this.det3(B1,A12,A13,B2,A22,A23,B3,A32,A33);
    const detAy = this.det3(A11,B1,A13,A21,B2,A23,A31,B3,A33);
    const detAc = this.det3(A11,A12,B1,A21,A22,B2,A31,A32,B3);
    const a = detAx/detA, b = detAy/detA, c = detAc/detA;
    return { ok:true, a,b,c };
  }

  predictPlane(points, x, y) {
    const s = this.solvePlaneWeighted(points);
    if (!s.ok) return { ok:false, z:null };
    return { ok:true, z: s.a*x + s.b*y + s.c };
  }

  // ============== Speed-group helpers ==============
  getGroupParams(speed) {
    for (const g of this.speedGroups) if (g.speeds.has(speed)) return g.params;
    return { swingPanBase: 25, swingPanThreshold: 3, swingPanExtraPerLevel: 5, tiltBias: 0, tiltSpinMultiplier: 1.0, lrTiltBias: 0 };
  }

  setGroupParams(groupName, newParams) {
    const g = this.speedGroups.find(x => x.name === groupName);
    if (!g) return false;
    g.params = { ...g.params, ...newParams };
    return true;
  }

  setGroupParamsBySpeed(speed, newParams) {
    const g = this.speedGroups.find(x => x.speeds.has(speed));
    if (!g) return false;
    g.params = { ...g.params, ...newParams };
    return true;
  }

  getSpeedGroupsSnapshot() {
    return this.speedGroups.map(g => ({
      name: g.name,
      speeds: Array.from(g.speeds),
      params: { ...g.params },
    }));
  }

  // Import generator speed-group params (maps JSON -> controller fields)
  importSpeedGroupsFromJson(metadata) {
    const sg = metadata?.speed_groups;
    if (!sg) return;

    const mapKeys = {
      swingPanBase: 'swing_pan_base',
      swingPanThreshold: 'swing_pan_threshold',
      swingPanExtraPerLevel: 'swing_pan_extra_per_level',
      tiltBias: 'tilt_additive_bias',
      tiltSpinMultiplier: 'tilt_spin_multiplier',
      lrTiltBias: 'lr_tilt_additive_bias',
    };

    for (const g of this.speedGroups) {
      const src = sg[g.name];
      if (!src) continue;
      const newParams = {
        swingPanBase: src[mapKeys.swingPanBase] ?? g.params.swingPanBase,
        swingPanThreshold: src[mapKeys.swingPanThreshold] ?? g.params.swingPanThreshold,
        swingPanExtraPerLevel: src[mapKeys.swingPanExtraPerLevel] ?? g.params.swingPanExtraPerLevel,
        tiltBias: src[mapKeys.tiltBias] ?? g.params.tiltBias,
        tiltSpinMultiplier: src[mapKeys.tiltSpinMultiplier] ?? g.params.tiltSpinMultiplier,
        lrTiltBias: src[mapKeys.lrTiltBias] ?? g.params.lrTiltBias,
      };
      this.setGroupParams(g.name, newParams);
    }
  }

  // ============== Overlays ==============
  applyPanSwingOverlay(pan, swingLevel, p) {
    // ΔPan_swing = s * (b + max(0, |s|-T)*E)
    const a = Math.abs(swingLevel);
    let base = p.swingPanBase;
    if (a >= p.swingPanThreshold) base += (a - p.swingPanThreshold) * p.swingPanExtraPerLevel;
    const out = pan + (swingLevel * base);
    return this.clampRange('pan', out);
  }

  applyLowSpeedTiltOverlay(tilt, spinLevel, p) {
    const spinAdj = spinLevel === 0 ? 0 : (p.tiltSpinMultiplier - 1) * 5 * spinLevel;
    const out = tilt + p.tiltBias + spinAdj;
    return this.clampRange('tilt', out);
  }

  applyLRTiltOverlay(left, right, p) {
    const bias = p.lrTiltBias || 0;
    return {
      left: this.clampLRTilt(left + bias),
      right: this.clampLRTilt(right + bias),
    };
  }

  // ============== JSON I/O ==============
  async loadJsonData() {
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = new Promise(async (resolve, reject) => {
      try {
        const response = await fetch("bowling_data.json");
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        this.jsonData = await response.json();
        // Import generator speed-group params for overlays
        this.importSpeedGroupsFromJson(this.jsonData.generation_metadata);
        this.isDataLoaded = true;
        console.log("JSON data loaded successfully:", this.jsonData.generation_metadata, this.getSpeedGroupsSnapshot());
        resolve(this.jsonData);
      } catch (error) {
        console.error("Error loading JSON data:", error);
        this.isDataLoaded = false;
        reject(error);
      }
    });

    return this.loadingPromise;
  }

  async ensureDataLoaded() {
    if (this.isDataLoaded) return this.jsonData;
    return await this.loadJsonData();
  }

  // ============== Region/tolerance helpers ==============
  getRegionTolerance(y) {
    if (y <= 15) return 12;
    if (y <= 35) return 16;
    if (y <= 60) return 22;
    return 20;
  }

  getAnchoredWeight(y) {
    if (y <= 25) return 0.6;   // stronger top anchoring
    if (y <= 35) return 0.45;
    if (y <= 60) return 0.25;
    return 0.1;
  }

  calculateRegionMultiplier(targetY, point) {
    let m = 1.0;
    if (targetY <= 30) {
      if (point.name.includes("top")) m = 1.6;
      else if (point.name.includes("mid")) m = 1.35;
    } else if (targetY <= 60) {
      if (point.name.includes("centre")) m = 1.45;
      else if (point.name.includes("left") || point.name.includes("right")) m = 1.3;
    } else {
      if (point.name.includes("bottom")) m = 1.9;
      else if (point.name.includes("centre")) m = 1.4;
    }
    return m;
  }

  calculateConfidenceScore(points, tolerance) {
    const avgDistance = points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const maxWeight = Math.max(...points.map((p) => p.weight));
    const distanceScore = Math.max(0, 100 - (avgDistance / tolerance) * 30);
    const weightScore = Math.min(100, maxWeight * 20);
    return Math.round((distanceScore + weightScore) / 2);
  }

  calculateAccuracyScore(points, targetX, targetY) {
    const avgDistance = points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const regionTolerance = this.getRegionTolerance(targetY);
    const baseAccuracy = Math.max(0, 100 - (avgDistance / regionTolerance) * 15);
    const pointBonus = Math.min(10, points.length * 2);
    return Math.min(100, baseAccuracy + pointBonus);
  }

  getRegionName(y) {
    if (y <= 15) return "ULTRA_PRECISION_TOP_EDGE";
    if (y <= 35) return "HIGH_PRECISION_TOP";
    if (y <= 60) return "MEDIUM_PRECISION_MIDDLE";
    return "STANDARD_PRECISION_BOTTOM";
  }

  // Piecewise-linear mid tilt anchor from Y
  midTiltAnchor(y) {
    const pts = [
      { y: 5,  m: 1500 },
      { y: 25, m: 1400 },
      { y: 40, m: 1200 },
      { y: 80, m: 800  },
    ];
    if (y <= pts[0].y) return pts[0].m;
    if (y >= pts[pts.length - 1].y) return pts[pts.length - 1].m;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (y >= a.y && y <= b.y) {
        const t = (y - a.y) / (b.y - a.y);
        return a.m + t * (b.m - a.m);
      }
    }
    return 1200;
  }

  // Anisotropic distance
  anisotropicDistance(ax, ay, bx, by) {
    const yAvg = (ay + by) / 2;
    const yScale = yAvg >= 60 ? 1.5 : (yAvg >= 35 ? 1.2 : 1.0);
    const dx = ax - bx;
    const dy = (ay - by) * yScale;
    return Math.hypot(dx, dy);
  }

  // L/R from mid using ±20 per spin level
  lrFromMid(mid, spinLevel) {
    const step = 20;
    const delta = step * Math.abs(spinLevel);
    if (spinLevel > 0) return { left: mid + delta, right: mid - delta };
    if (spinLevel < 0) return { left: mid - delta, right: mid + delta };
    return { left: mid, right: mid };
  }

  // ============== Interpolation core (reworked) ==============
  calculateInterpolationFromJson(speed, targetX, targetY, swingLevel, spinLevel) {
    const cacheKey = `${speed}-${targetX}-${targetY}-${swingLevel}-${spinLevel}`;

    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) return cachedResult;

    const speedData = this.jsonData.data[`${speed}_kmph`];
    const swingKey = `swing_level_${swingLevel}`;
    const spinKey = `spin_level_${spinLevel}`;
    const levelData = speedData.swing_levels[swingKey].spin_levels[spinKey];

    const tolerance = this.getRegionTolerance(targetY);
    const positions = levelData.positions;

    const speedProfile = this.getSpeedRpmProfile(speed);

    // Collect relevant points with weights
    const relevantPoints = Object.entries(positions).map(
      ([positionName, positionData]) => {
        const distance = this.anisotropicDistance(
          positionData.X, positionData.Y, targetX, targetY
        );
        let regionMultiplier = this.calculateRegionMultiplier(targetY, { name: positionName });
        let proximityBonus = distance < tolerance ? 1.2 : 1.0;
        regionMultiplier *= speedProfile.patternMultiplier;

        const invDist = 1.0 / (distance + 0.1);
        const w = (regionMultiplier * proximityBonus) * invDist;

        return {
          name: positionName,
          distance,
          data: positionData,
          w,
          w2: w * invDist, // slightly sharper decay for plane fit
        };
      }
    );

    const pointCount = Math.min(6, relevantPoints.length);
    const bestPoints = relevantPoints.sort((a, b) => a.distance - b.distance).slice(0, pointCount);

    // Prepare fields for plane fits
    const mkPts = (field) =>
      bestPoints.map(p => ({ x: p.data.X, y: p.data.Y, z: p.data[field], w: p.w2 }));

    const mkMidPts = () =>
      bestPoints.map(p => {
        const mid = (p.data.Left_Tilt + p.data.Right_Tilt) / 2;
        return { x: p.data.X, y: p.data.Y, z: mid, w: p.w2 };
      });

    // Fit planes
    const panFit = this.predictPlane(mkPts('Pan'), targetX, targetY);
    const tiltFit = this.predictPlane(mkPts('Tilt'), targetX, targetY);
    const midFit  = this.predictPlane(mkMidPts(), targetX, targetY);

    // Fallback to weighted average if fit fails
    const safeAvg = (arr) => {
      let tw=0, s=0;
      for (const p of bestPoints) { tw += p.w; s += p.data[arr]*p.w; }
      return s / Math.max(1e-6, tw);
    };

    let panBase  = panFit.ok  ? panFit.z  : safeAvg('Pan');
    let tiltBase = tiltFit.ok ? tiltFit.z : safeAvg('Tilt');

    // Mid tilt anchored: blend with anchor and never below anchor in top region
    const anchoredMid = this.midTiltAnchor(targetY);
    const anchoredWeight = this.getAnchoredWeight(targetY);
    const midBaseRaw = midFit.ok ? midFit.z : (() => {
      // weighted average of mid if plane failed
      let tw=0, s=0;
      for (const p of bestPoints) {
        const mid = (p.data.Left_Tilt + p.data.Right_Tilt) / 2;
        tw += p.w; s += mid * p.w;
      }
      return s / Math.max(1e-6, tw);
    })();

    let finalMid = (1 - anchoredWeight) * midBaseRaw + anchoredWeight * anchoredMid;
    // Guarantee: near top-mid cannot have less tilt than anchor
    if (targetY <= 35) finalMid = Math.max(finalMid, anchoredMid);

    // Use raw Left_Tilt and Right_Tilt from JSON (weighted average from bestPoints)
    const calcLeft = (() => {
      let tw=0, s=0;
      for (const p of bestPoints) {
        tw += p.w;
        s += p.data.Left_Tilt * p.w;
      }
      return s / Math.max(1e-6, tw);
    })();
    const calcRight = (() => {
      let tw=0, s=0;
      for (const p of bestPoints) {
        tw += p.w;
        s += p.data.Right_Tilt * p.w;
      }
      return s / Math.max(1e-6, tw);
    })();

    // RPMs: reuse existing logic
    const baseLeftRPM = (() => {
      let tw=0, s=0; for (const pt of bestPoints){ tw += pt.w; s += pt.data.L_RPM * pt.w; }
      return s / Math.max(1e-6, tw);
    })();
    const baseRightRPM = (() => {
      let tw=0, s=0; for (const pt of bestPoints){ tw += pt.w; s += pt.data.R_RPM * pt.w; }
      return s / Math.max(1e-6, tw);
    })();

    const speedProfileOut = this.getSpeedRpmProfile(speed);
    const zeroSS = swingLevel === 0 && spinLevel === 0;
    const adjustedLeftRPM = zeroSS
      ? Math.round(baseLeftRPM)
      : this.applyRealisticSpeedRpmPattern(baseLeftRPM, speed, speedProfileOut, targetX, targetY);
    const adjustedRightRPM = zeroSS
      ? Math.round(baseRightRPM)
      : this.applyRealisticSpeedRpmPattern(baseRightRPM, speed, speedProfileOut, targetX, targetY);

    // Pan/Tilt overlays already baked into JSON, just round and clamp
    panBase  = this.clampRange('pan', this.round1(panBase));
    tiltBase = this.clampRange('tilt', Math.round(tiltBase));

    const result = {
      pan: panBase,
      panActual: panBase,
      tilt: tiltBase,
      tiltActual: tiltBase,
      leftTilt: Math.round(this.clampLRTilt(calcLeft)),
      leftTiltActual: Math.round(this.clampLRTilt(calcLeft)),
      rightTilt: Math.round(this.clampLRTilt(calcRight)),
      rightTiltActual: Math.round(this.clampLRTilt(calcRight)),
      leftRPM: adjustedLeftRPM,
      rightRPM: adjustedRightRPM,
      usedPoints: bestPoints.length,
      accuracy: this.calculateAccuracyScore(bestPoints, targetX, targetY),
      confidence: this.calculateConfidenceScore(bestPoints, this.getRegionTolerance(targetY)),
      avgDistance: bestPoints.reduce((sum, p) => sum + p.distance, 0) / bestPoints.length,
      speedProfile: speedProfileOut,
      rpmVariance: Math.abs(adjustedLeftRPM - adjustedRightRPM),
    };

    this.setCachedResult(cacheKey, result);
    return result;
  }

  getSpeedRpmProfile(speed) {
    const profile = this.speedRpmProfile.toleranceProfile[speed];
    if (profile) return profile;


    const referenceSpeed = this.speedRpmProfile.referenceSpeed;
    const distanceFromReference = Math.abs(speed - referenceSpeed);


    const rpmTolerance = 5 + Math.pow(distanceFromReference / 8, 1.8);
    const interpolationWeight = Math.max(0.3, 1.0 - (distanceFromReference / 80));
    const patternMultiplier = 1.0 + (distanceFromReference / 50);


    return {
      rpmTolerance: Math.min(50, rpmTolerance),
      interpolationWeight,
      patternMultiplier
    };
  }

  // ============== RPM pattern (unchanged except <= reference guard) ==============
  applyRealisticSpeedRpmPattern(baseRPM, speed, speedProfile, targetX, targetY) {
    const SAFETY_LIMITS = { min: 150, max: 550 };
    const referenceSpeed = this.speedRpmProfile.referenceSpeed;

    if (speed <= referenceSpeed) {
      let finalRPM = baseRPM;
      finalRPM = Math.max(SAFETY_LIMITS.min, Math.min(SAFETY_LIMITS.max, finalRPM));
      return Math.round(finalRPM);
    }

    let rpmAdjustment = 0;

    const highSpeedBoost = {
      120: 15, 130: 35, 140: 55, 150: 75, 160: 95
    };

    const speedDeviation = speed - referenceSpeed;
    let speedBoost = highSpeedBoost[speed];
    if (!speedBoost) {
      const boostFactor = (speed - referenceSpeed) / 10;
      speedBoost = Math.pow(boostFactor, 1.4) * 20;
    }

    const deviationFactor = Math.abs(speedDeviation) / 25;
    const patternMultiplier = 1 + Math.pow(deviationFactor, 1.5) * speedProfile.patternMultiplier;

    let positionVariance = 1.0;
    if (targetX < 75 || targetX > 225) positionVariance = 1.3;
    if (targetY < 20 || targetY > 60) positionVariance *= 1.2;

    rpmAdjustment = speedBoost + (speedDeviation * 0.8 * patternMultiplier * positionVariance);

    const toleranceVariance = (Math.random() - 0.5) * speedProfile.rpmTolerance;
    rpmAdjustment += toleranceVariance;

    const patternNoise = (Math.random() - 0.5) * 10 * speedProfile.patternMultiplier;
    rpmAdjustment += patternNoise;

    let finalRPM = baseRPM + rpmAdjustment;

    if (speedProfile.interpolationWeight < 1.0) {
      const confidenceAdjustment = rpmAdjustment * speedProfile.interpolationWeight;
      const variancePreservation = rpmAdjustment * (1 - speedProfile.interpolationWeight) * 0.5;
      finalRPM = baseRPM + confidenceAdjustment + variancePreservation;
    }

    finalRPM = Math.max(SAFETY_LIMITS.min, Math.min(SAFETY_LIMITS.max, finalRPM));

    const distanceFromReference = Math.abs(speed - referenceSpeed);
    if (distanceFromReference <= 10) {
      return Math.round(finalRPM * 2) / 2;
    } else if (distanceFromReference <= 30) {
      return Math.round(finalRPM);
    } else {
      return Math.round(finalRPM / 2) * 2;
    }
  }

  // ============== Main entry ==============
  async getMachineConfig(speed, x, y, swingLevel, spinLevel) {
    // Validation
    if (
      !Number.isFinite(speed) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(swingLevel) ||
      !Number.isFinite(spinLevel)
    ) {
      return { error: `Invalid input parameters. Speed: ${speed}, X: ${x}, Y: ${y}, Swing: ${swingLevel}, Spin: ${spinLevel}` };
    }

    if (x < 0 || x > 300 || y < 5 || y > 80) {
      return { error: `Coordinates out of bounds. X: ${x} (0-300), Y: ${y} (5-80)` };
    }

    if (swingLevel < -5 || swingLevel > 5 || spinLevel < -5 || spinLevel > 5) {
      return { error: `Levels out of bounds. Swing: ${swingLevel} (-5 to +5), Spin: ${spinLevel} (-5 to +5)` };
    }

    try {
      await this.ensureDataLoaded();
    } catch (error) {
      return { error: `Failed to load data: ${error.message}` };
    }

    if (!this.jsonData.data[`${speed}_kmph`]) {
      const availableSpeeds = Object.keys(this.jsonData.data).map(key => key.replace('_kmph', '')).join(", ");
      return { error: `Speed ${speed} km/h not supported. Available: ${availableSpeeds}` };
    }

    const speedData = this.jsonData.data[`${speed}_kmph`];
    const swingKey = `swing_level_${swingLevel}`;
    const spinKey = `spin_level_${spinLevel}`;

    if (!speedData.swing_levels[swingKey]) {
      return { error: `Swing level ${swingLevel} not supported` };
    }
    if (!speedData.swing_levels[swingKey].spin_levels[spinKey]) {
      return { error: `Spin level ${spinLevel} not supported` };
    }

    const levelData = speedData.swing_levels[swingKey].spin_levels[spinKey];

    // Nearest position
    const positions = levelData.positions;
    let closestPosition = null;
    let minDistance = Infinity;

    for (const [positionName, positionData] of Object.entries(positions)) {
      const distance = Math.sqrt(
        Math.pow(positionData.X - x, 2) + Math.pow(positionData.Y - y, 2)
      );
      if (distance < minDistance) {
        minDistance = distance;
        closestPosition = { name: positionName, data: positionData };
      }
    }

    const speedProfile = this.getSpeedRpmProfile(speed);
    const exactMatchThreshold = speed === 110 ? 3 : 5;

    if (minDistance < exactMatchThreshold) {
      this.metrics.exactMatches++;

      // Zero swing/spin preserves dataset RPMs
      const zeroSS = swingLevel === 0 && spinLevel === 0;
      const adjustedLeftRPM = zeroSS
        ? Math.round(closestPosition.data.L_RPM)
        : this.applyRealisticSpeedRpmPattern(closestPosition.data.L_RPM, speed, speedProfile, x, y);
      const adjustedRightRPM = zeroSS
        ? Math.round(closestPosition.data.R_RPM)
        : this.applyRealisticSpeedRpmPattern(closestPosition.data.R_RPM, speed, speedProfile, x, y);

      // Use raw Left_Tilt and Right_Tilt from JSON directly
      let leftTilt = Math.round(closestPosition.data.Left_Tilt);
      let rightTilt = Math.round(closestPosition.data.Right_Tilt);

      // All overlays already baked into JSON, just use raw values and clamp
      let panOut   = this.clampRange('pan', this.round1(closestPosition.data.Pan));
      let panAct   = this.clampRange('pan', this.round1(closestPosition.data.Pan_actual));
      let tiltOut  = this.clampRange('tilt', Math.round(closestPosition.data.Tilt));
      let tiltAct  = this.clampRange('tilt', Math.round(closestPosition.data.Tilt_actual));

      // LR tilt bias is already baked into the JSON values, so just clamp
      leftTilt = this.clampLRTilt(leftTilt);
      rightTilt = this.clampLRTilt(rightTilt);

      return {
        speed, swingLevel, spinLevel,
        coordinates: { x, y },
        machineSettings: {
          pan: panOut,
          panActual: panAct,
          tilt: tiltOut,
          tiltActual: tiltAct,
          leftTilt,
          leftTiltActual: leftTilt,
          rightTilt,
          rightTiltActual: rightTilt,
          leftRPM: adjustedLeftRPM,
          rightRPM: adjustedRightRPM,
        },
        matchType: "exact",
        referencePoint: closestPosition.name,
        accuracy: 100,
        confidence: 100,
        distance: minDistance,
        speedProfile,
        rpmVariance: Math.abs(adjustedLeftRPM - adjustedRightRPM),
      };
    }

    const interpolated = this.calculateInterpolationFromJson(speed, x, y, swingLevel, spinLevel);

    return {
      speed, swingLevel, spinLevel,
      coordinates: { x, y },
      machineSettings: {
        pan: interpolated.pan,
        panActual: interpolated.panActual,
        tilt: interpolated.tilt,
        tiltActual: interpolated.tiltActual,
        leftTilt: interpolated.leftTilt,
        leftTiltActual: interpolated.leftTiltActual,
        rightTilt: interpolated.rightTilt,
        rightTiltActual: interpolated.rightTiltActual,
        leftRPM: interpolated.leftRPM,
        rightRPM: interpolated.rightRPM,
      },
      matchType: "interpolated",
      interpolationData: {
        usedPoints: interpolated.usedPoints,
        accuracy: Math.round(interpolated.accuracy),
        confidence: interpolated.confidence,
        region: this.getRegionName(y),
        tolerance: this.getRegionTolerance(y),
        avgDistance: Math.round(interpolated.avgDistance * 10) / 10,
        speedProfile: interpolated.speedProfile,
        rpmVariance: interpolated.rpmVariance,
      },
    };
  }

  // ============== Metrics and maintenance helpers ==============
  manageCacheSize() {
    const now = Date.now();
    let removedCount = 0;
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.cacheConfig.maxAge) {
        this.interpolationCache.delete(key);
        this.cacheTimestamps.delete(key);
        this.cacheAccessCount.delete(key);
        removedCount++;
        this.metrics.expiredEntries++;
      }
    }
    if (this.interpolationCache.size >= this.cacheConfig.cleanupThreshold) {
      const sortedByUsage = Array.from(this.cacheAccessCount.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, this.cacheConfig.cleanupBatchSize);
      sortedByUsage.forEach(([key]) => {
        this.interpolationCache.delete(key);
        this.cacheTimestamps.delete(key);
        this.cacheAccessCount.delete(key);
        removedCount++;
      });
      this.metrics.cacheCleanups++;
    }
    this.metrics.lastCleanupRemoved = removedCount;
    this.metrics.totalMemoryUsage = this.interpolationCache.size * 200;
    return removedCount;
  }

  getCachedResult(cacheKey) {
    if (this.interpolationCache.has(cacheKey)) {
      const currentCount = this.cacheAccessCount.get(cacheKey) || 0;
      this.cacheAccessCount.set(cacheKey, currentCount + 1);
      this.metrics.cacheHits++;
      return this.interpolationCache.get(cacheKey);
    }
    return null;
  }

  setCachedResult(cacheKey, result) {
    if (this.interpolationCache.size >= this.cacheConfig.maxSize) {
      this.manageCacheSize();
    }
    const now = Date.now();
    this.interpolationCache.set(cacheKey, result);
    this.cacheTimestamps.set(cacheKey, now);
    this.cacheAccessCount.set(cacheKey, 1);
    this.metrics.interpolations++;
    this.metrics.totalMemoryUsage = this.interpolationCache.size * 200;
  }

  makeCacheKey(speed, x, y, swingLevel, spinLevel) {
    return `${speed}-${Math.round(x)}-${Math.round(y)}-${swingLevel}-${spinLevel}`;
  }

  clearCache() {
    const size = this.interpolationCache.size;
    this.interpolationCache.clear();
    this.cacheTimestamps.clear();
    this.cacheAccessCount.clear();
    this.metrics.totalMemoryUsage = 0;
    return size;
  }

  evictExpiredNow() {
    return this.manageCacheSize();
  }

  getCacheStats() {
    return {
      size: this.interpolationCache.size,
      expiredEntries: this.metrics.expiredEntries,
      lastCleanupRemoved: this.metrics.lastCleanupRemoved,
      totalMemoryUsage: this.metrics.totalMemoryUsage,
    };
  }

  // Preload convenience (ensures JSON is ready)
  async preload() {
    await this.ensureDataLoaded();
    return true;
  }

  // Optional grid warmup to populate cache (coarse grid)
  async warmCacheGrid(speed, swingLevel = 0, spinLevel = 0, stepX = 30, stepY = 10) {
    await this.ensureDataLoaded();
    let count = 0;
    for (let x = 0; x <= 300; x += stepX) {
      for (let y = 5; y <= 80; y += stepY) {
        const res = this.calculateInterpolationFromJson(speed, x, y, swingLevel, spinLevel);
        const cacheKey = this.makeCacheKey(speed, x, y, swingLevel, spinLevel);
        this.setCachedResult(cacheKey, res);
        count++;
      }
    }
    return { warmed: count, cacheSize: this.interpolationCache.size };
  }
}
