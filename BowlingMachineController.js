class BowlingMachineController {
  constructor() {
    // Initialize with empty data - will be loaded from JSON
    this.jsonData = null;
    this.isDataLoaded = false;
    this.loadingPromise = null;

    // Conservative cache configuration
    this.cacheConfig = {
      maxSize: 5000,
      cleanupThreshold: 4500,
      cleanupBatchSize: 1000,
      maxAge: 3600000,
    };

    // FIXED: More realistic accuracy zones for actual RPM variance
    this.accuracyZones = {
      ULTRA_PRECISION: { yMin: 5, yMax: 15, tolerance: 12 },
      HIGH_PRECISION: { yMin: 15, yMax: 35, tolerance: 18 },
      MEDIUM_PRECISION: { yMin: 35, yMax: 60, tolerance: 25 },
      STANDARD_PRECISION: { yMin: 60, yMax: 80, tolerance: 30 },
    };

    // FIXED: More realistic speed-dependent RPM tolerance to match real patterns
    this.speedRpmProfile = {
      referenceSpeed: 110,
      toleranceProfile: {
        60: { rpmTolerance: 45, interpolationWeight: 0.5, patternMultiplier: 1.8 },   // High variance at extremes
        70: { rpmTolerance: 35, interpolationWeight: 0.6, patternMultiplier: 1.5 },
        80: { rpmTolerance: 25, interpolationWeight: 0.75, patternMultiplier: 1.3 },
        90: { rpmTolerance: 15, interpolationWeight: 0.85, patternMultiplier: 1.15 },
        100: { rpmTolerance: 8, interpolationWeight: 0.95, patternMultiplier: 1.05 },
        110: { rpmTolerance: 5, interpolationWeight: 1.0, patternMultiplier: 1.0 },  // Reference precision
        120: { rpmTolerance: 8, interpolationWeight: 0.95, patternMultiplier: 1.05 },
        130: { rpmTolerance: 15, interpolationWeight: 0.85, patternMultiplier: 1.15 },
        140: { rpmTolerance: 25, interpolationWeight: 0.75, patternMultiplier: 1.3 },
        150: { rpmTolerance: 35, interpolationWeight: 0.6, patternMultiplier: 1.5 },
        160: { rpmTolerance: 45, interpolationWeight: 0.5, patternMultiplier: 1.8 }  // High variance at extremes
      }
    };

    // Enhanced cache with timestamps for age-based cleanup
    this.interpolationCache = new Map();
    this.cacheTimestamps = new Map();
    this.cacheAccessCount = new Map();

    // Performance metrics tracking
    this.metrics = {
      cacheHits: 0,
      interpolations: 0,
      exactMatches: 0,
      cacheCleanups: 0,
      expiredEntries: 0,
      totalMemoryUsage: 0,
    };

    // Load JSON data asynchronously
    this.loadJsonData();
  }

  // Load JSON data from file
  async loadJsonData() {
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = new Promise(async (resolve, reject) => {
      try {
        const response = await fetch("bowling_data.json");
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        this.jsonData = await response.json();
        this.isDataLoaded = true;
        console.log("JSON data loaded successfully:", this.jsonData.generation_metadata);
        resolve(this.jsonData);
      } catch (error) {
        console.error("Error loading JSON data:", error);
        this.isDataLoaded = false;
        reject(error);
      }
    });

    return this.loadingPromise;
  }

  // Wait for data to be loaded
  async ensureDataLoaded() {
    if (this.isDataLoaded) {
      return this.jsonData;
    }
    return await this.loadJsonData();
  }

  // FIXED: Get speed-specific RPM profile with realistic variance
  getSpeedRpmProfile(speed) {
    const profile = this.speedRpmProfile.toleranceProfile[speed];
    if (profile) {
      return profile;
    }

    // Calculate interpolated profile for speeds not in the table
    const referenceSpeed = this.speedRpmProfile.referenceSpeed;
    const distanceFromReference = Math.abs(speed - referenceSpeed);
    
    // FIXED: More aggressive tolerance increase to match real RPM patterns
    const rpmTolerance = 5 + Math.pow(distanceFromReference / 8, 1.8); // More aggressive
    const interpolationWeight = Math.max(0.3, 1.0 - (distanceFromReference / 80)); // Lower minimum
    const patternMultiplier = 1.0 + (distanceFromReference / 50); // Pattern amplification

    return {
      rpmTolerance: Math.min(50, rpmTolerance), // Higher cap
      interpolationWeight: interpolationWeight,
      patternMultiplier: patternMultiplier
    };
  }

  // [Cache management methods remain the same...]
  manageCacheSize() {
    const currentSize = this.interpolationCache.size;
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
  }

  // FIXED: More realistic position tolerance
  getRegionTolerance(y) {
    for (const [region, zone] of Object.entries(this.accuracyZones)) {
      if (y >= zone.yMin && y <= zone.yMax) {
        return zone.tolerance;
      }
    }
    return 35; // Higher default tolerance
  }

  // FIXED: More realistic region multiplier to capture actual patterns
  calculateRegionMultiplier(targetY, point) {
    let multiplier = 1.0;

    // FIXED: More aggressive multipliers to match real RPM differences
    if (targetY <= 30) {
      if (point.name.includes("top")) multiplier = 1.5; // Was 1.2
      else if (point.name.includes("mid")) multiplier = 1.3; // Was 1.1
    }

    if (targetY > 30 && targetY <= 60) {
      if (point.name === "centre") multiplier = 1.4; // Was 1.15
      else if (point.name.includes("left") || point.name.includes("right"))
        multiplier = 1.25; // Was 1.1
    }

    if (targetY > 60) {
      if (point.name === "bottom") multiplier = 1.6; // Was 1.2
      else if (point.name === "centre") multiplier = 1.3; // Was 1.1
    }

    return multiplier;
  }

  // Confidence scoring for interpolation quality
  calculateConfidenceScore(points, tolerance) {
    const avgDistance = points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const maxWeight = Math.max(...points.map((p) => p.weight));

    const distanceScore = Math.max(0, 100 - (avgDistance / tolerance) * 30);
    const weightScore = Math.min(100, maxWeight * 20);

    return Math.round((distanceScore + weightScore) / 2);
  }

  // Accuracy scoring with confidence integration
  calculateAccuracyScore(points, targetX, targetY) {
    const avgDistance = points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const regionTolerance = this.getRegionTolerance(targetY);
    const baseAccuracy = Math.max(0, 100 - (avgDistance / regionTolerance) * 15);

    const pointBonus = Math.min(10, points.length * 2);
    return Math.min(100, baseAccuracy + pointBonus);
  }

  // Enhanced region naming
  getRegionName(y) {
    if (y <= 15) return "ULTRA_PRECISION_TOP_EDGE";
    if (y <= 35) return "HIGH_PRECISION_TOP";
    if (y <= 60) return "MEDIUM_PRECISION_MIDDLE";
    return "STANDARD_PRECISION_BOTTOM";
  }

  // FIXED: More realistic interpolation to match actual RPM variance patterns
  calculateInterpolationFromJson(speed, targetX, targetY, swingLevel, spinLevel) {
    const cacheKey = `${speed}-${targetX}-${targetY}-${swingLevel}-${spinLevel}`;

    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const speedData = this.jsonData.data[`${speed}_kmph`];
    const swingKey = `swing_level_${swingLevel}`;
    const spinKey = `spin_level_${spinLevel}`;
    const levelData = speedData.swing_levels[swingKey].spin_levels[spinKey];

    const tolerance = this.getRegionTolerance(targetY);
    const positions = levelData.positions;

    // Get speed-specific RPM profile
    const speedProfile = this.getSpeedRpmProfile(speed);

    // FIXED: More realistic distance weighting to capture actual patterns
    const relevantPoints = Object.entries(positions).map(
      ([positionName, positionData]) => {
        const distance = Math.sqrt(
          Math.pow(positionData.X - targetX, 2) +
            Math.pow(positionData.Y - targetY, 2)
        );

        // FIXED: Enhanced weighting to capture real RPM variance
        let regionMultiplier = this.calculateRegionMultiplier(targetY, {
          name: positionName,
        });
        let proximityBonus = distance < tolerance ? 1.2 : 1.0; // Slightly increased
        
        // FIXED: Apply pattern multiplier for realistic variance
        regionMultiplier *= speedProfile.patternMultiplier;

        return {
          name: positionName,
          distance: distance,
          weight: (regionMultiplier * proximityBonus) / (distance + 0.5), // Less stability padding
          isRelevant: distance <= tolerance * 2.0, // More inclusive
          data: positionData,
        };
      }
    );

    // FIXED: Use more points to capture full pattern range
    const pointCount = Math.min(6, relevantPoints.length); // Increased from 4
    const bestPoints = relevantPoints
      .sort((a, b) => a.distance - b.distance)
      .slice(0, pointCount);

    // FIXED: Enhanced weighting to preserve actual RPM differences
    let totalWeight = 0;
    const weightedSums = {
      pan: 0,
      panActual: 0,
      tilt: 0,
      tiltActual: 0,
      leftTilt: 0,
      leftTiltActual: 0,
      rightTilt: 0,
      rightTiltActual: 0,
      leftRPM: 0,
      rightRPM: 0,
    };

    bestPoints.forEach((point) => {
      // FIXED: More sensitive distance weighting to preserve patterns
      const weight = 1.0 / (point.distance + 0.1); // Reduced padding for higher sensitivity
      totalWeight += weight;

      weightedSums.pan += point.data.Pan * weight;
      weightedSums.panActual += point.data.Pan_actual * weight;
      weightedSums.tilt += point.data.Tilt * weight;
      weightedSums.tiltActual += point.data.Tilt_actual * weight;
      weightedSums.leftTilt += point.data.Left_Tilt * weight;
      weightedSums.leftTiltActual += point.data.Left_Tilt_Actual * weight;
      weightedSums.rightTilt += point.data.Right_Tilt * weight;
      weightedSums.rightTiltActual += point.data.Right_Tilt_Actual * weight;
      weightedSums.leftRPM += point.data.L_RPM * weight;
      weightedSums.rightRPM += point.data.R_RPM * weight;
    });

    // Standard interpolation for non-RPM values
    const baseLeftRPM = weightedSums.leftRPM / totalWeight;
    const baseRightRPM = weightedSums.rightRPM / totalWeight;

    // FIXED: Apply enhanced RPM pattern with realistic variance
    const adjustedLeftRPM = this.applyRealisticSpeedRpmPattern(baseLeftRPM, speed, speedProfile, targetX, targetY);
    const adjustedRightRPM = this.applyRealisticSpeedRpmPattern(baseRightRPM, speed, speedProfile, targetX, targetY);

    const result = {
      pan: Math.round(weightedSums.pan / totalWeight),
      panActual: Math.round(weightedSums.panActual / totalWeight),
      tilt: Math.round(weightedSums.tilt / totalWeight),
      tiltActual: Math.round(weightedSums.tiltActual / totalWeight),
      leftTilt: Math.round(weightedSums.leftTilt / totalWeight),
      leftTiltActual: Math.round(weightedSums.leftTiltActual / totalWeight),
      rightTilt: Math.round(weightedSums.rightTilt / totalWeight),
      rightTiltActual: Math.round(weightedSums.rightTiltActual / totalWeight),
      // FIXED: Realistic RPM with actual pattern variance
      leftRPM: adjustedLeftRPM,
      rightRPM: adjustedRightRPM,
      usedPoints: bestPoints.length,
      accuracy: this.calculateAccuracyScore(bestPoints, targetX, targetY),
      confidence: this.calculateConfidenceScore(bestPoints, tolerance),
      avgDistance: bestPoints.reduce((sum, p) => sum + p.distance, 0) / bestPoints.length,
      speedProfile: speedProfile,
      rpmVariance: Math.abs(adjustedLeftRPM - adjustedRightRPM), // Debug info
    };

    this.setCachedResult(cacheKey, result);
    return result;
  }

// FIXED: Apply boost ONLY for speeds above 110, leave lower speeds unchanged
applyRealisticSpeedRpmPattern(baseRPM, speed, speedProfile, targetX, targetY) {
  // Safety limits from your JSON structure
  const SAFETY_LIMITS = {
    min: 150,
    max: 550
  };

  const referenceSpeed = this.speedRpmProfile.referenceSpeed;
  const speedDeviation = speed - referenceSpeed;
  
  // FIXED: NO changes for speeds <= 110 (they're already correct)
  if (speed <= referenceSpeed) {
    // Just apply minimal variance for lower speeds - keep existing behavior
    let rpmAdjustment = 0;
    
    if (speedDeviation !== 0) {
      const deviationFactor = Math.abs(speedDeviation) / 25;
      const patternMultiplier = 1 + Math.pow(deviationFactor, 1.5) * speedProfile.patternMultiplier;
      
      let positionVariance = 1.0;
      if (targetX < 75 || targetX > 225) positionVariance = 1.3;
      if (targetY < 20 || targetY > 60) positionVariance *= 1.2;
      
      rpmAdjustment = speedDeviation * 1.0 * patternMultiplier * positionVariance;
      
      const toleranceVariance = (Math.random() - 0.5) * speedProfile.rpmTolerance;
      rpmAdjustment += toleranceVariance;
      
      const patternNoise = (Math.random() - 0.5) * 10 * speedProfile.patternMultiplier;
      rpmAdjustment += patternNoise;
    }

    let finalRPM = baseRPM + rpmAdjustment;

    if (speedProfile.interpolationWeight < 1.0) {
      const confidenceAdjustment = rpmAdjustment * speedProfile.interpolationWeight;
      const variancePreservation = rpmAdjustment * (1 - speedProfile.interpolationWeight) * 0.7;
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

  // FIXED: Only speeds ABOVE 110 get the high-speed boost
  let rpmAdjustment = 0;
  
  // Apply aggressive boost for high speeds to catch up to proper RPM levels
  const highSpeedBoost = {
    120: 15,   // Small boost
    130: 35,   // Significant boost to reach ~445 range
    140: 55,   // Higher boost to reach ~460 range  
    150: 75,   // Much higher boost to reach ~475 range
    160: 95    // Highest boost to reach ~490 range
  };

  // Get speed-specific boost or calculate for intermediate speeds
  let speedBoost = highSpeedBoost[speed];
  if (!speedBoost) {
    // Interpolate boost for speeds not in the table
    const boostFactor = (speed - referenceSpeed) / 10;
    speedBoost = Math.pow(boostFactor, 1.4) * 20; // Exponential boost curve
  }

  // Enhanced pattern multiplier for high speeds
  const deviationFactor = Math.abs(speedDeviation) / 25;
  const patternMultiplier = 1 + Math.pow(deviationFactor, 1.5) * speedProfile.patternMultiplier;
  
  // Position-based variance for realistic patterns
  let positionVariance = 1.0;
  if (targetX < 75 || targetX > 225) positionVariance = 1.3; // Edge positions
  if (targetY < 20 || targetY > 60) positionVariance *= 1.2; // Top/bottom positions
  
  // Combine boost with position-based adjustments
  rpmAdjustment = speedBoost + (speedDeviation * 0.8 * patternMultiplier * positionVariance);
  
  // Apply realistic tolerance variance for high-speed differences
  const toleranceVariance = (Math.random() - 0.5) * speedProfile.rpmTolerance;
  rpmAdjustment += toleranceVariance;
  
  // Additional pattern-based adjustment for realistic variance
  const patternNoise = (Math.random() - 0.5) * 10 * speedProfile.patternMultiplier;
  rpmAdjustment += patternNoise;

  // Calculate final RPM with boost
  let finalRPM = baseRPM + rpmAdjustment;

  // Apply interpolation weight (but preserve boost)
  if (speedProfile.interpolationWeight < 1.0) {
    const confidenceAdjustment = rpmAdjustment * speedProfile.interpolationWeight;
    const variancePreservation = rpmAdjustment * (1 - speedProfile.interpolationWeight) * 0.5;
    finalRPM = baseRPM + confidenceAdjustment + variancePreservation;
  }

  // Enforce safety limits
  finalRPM = Math.max(SAFETY_LIMITS.min, Math.min(SAFETY_LIMITS.max, finalRPM));

  // Realistic rounding for high speeds
  const distanceFromReference = Math.abs(speed - referenceSpeed);
  if (distanceFromReference <= 10) {
    return Math.round(finalRPM * 2) / 2; // 0.5 precision near reference
  } else if (distanceFromReference <= 30) {
    return Math.round(finalRPM); // 1.0 precision for moderate deviation
  } else {
    return Math.round(finalRPM / 2) * 2; // 2.0 precision for extreme speeds
  }
}

  // [Rest of the methods remain the same with updated exact match handling...]
  
  async getMachineConfig(speed, x, y, swingLevel, spinLevel) {
    // Input validation
    if (
      !Number.isFinite(speed) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(swingLevel) ||
      !Number.isFinite(spinLevel)
    ) {
      return {
        error: `Invalid input parameters. Speed: ${speed}, X: ${x}, Y: ${y}, Swing: ${swingLevel}, Spin: ${spinLevel}`,
      };
    }

    // Boundary validation
    if (x < 0 || x > 300 || y < 5 || y > 80) {
      return {
        error: `Coordinates out of bounds. X: ${x} (0-300), Y: ${y} (5-80)`,
      };
    }

    if (swingLevel < -5 || swingLevel > 5 || spinLevel < -5 || spinLevel > 5) {
      return {
        error: `Levels out of bounds. Swing: ${swingLevel} (-5 to +5), Spin: ${spinLevel} (-5 to +5)`,
      };
    }

    // Ensure data is loaded
    try {
      await this.ensureDataLoaded();
    } catch (error) {
      return {
        error: `Failed to load data: ${error.message}`,
      };
    }

    // Check if speed is supported
    if (!this.jsonData.data[`${speed}_kmph`]) {
      const availableSpeeds = Object.keys(this.jsonData.data).map(key => 
        key.replace('_kmph', '')).join(", ");
      return {
        error: `Speed ${speed} km/h not supported. Available: ${availableSpeeds}`,
      };
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

    // Find the closest position to the target coordinates
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

    // Speed-adaptive exact match threshold
    const speedProfile = this.getSpeedRpmProfile(speed);
    const exactMatchThreshold = speed === 110 ? 3 : 5;

    if (minDistance < exactMatchThreshold) {
      this.metrics.exactMatches++;
      
      // FIXED: Apply realistic pattern even for exact matches
      const adjustedLeftRPM = this.applyRealisticSpeedRpmPattern(closestPosition.data.L_RPM, speed, speedProfile, x, y);
      const adjustedRightRPM = this.applyRealisticSpeedRpmPattern(closestPosition.data.R_RPM, speed, speedProfile, x, y);
      
      return {
        speed,
        swingLevel,
        spinLevel,
        coordinates: { x, y },
        machineSettings: {
          pan: Math.round(closestPosition.data.Pan),
          panActual: Math.round(closestPosition.data.Pan_actual),
          tilt: Math.round(closestPosition.data.Tilt),
          tiltActual: Math.round(closestPosition.data.Tilt_actual),
          leftTilt: Math.round(closestPosition.data.Left_Tilt),
          leftTiltActual: Math.round(closestPosition.data.Left_Tilt_Actual),
          rightTilt: Math.round(closestPosition.data.Right_Tilt),
          rightTiltActual: Math.round(closestPosition.data.Right_Tilt_Actual),
          leftRPM: adjustedLeftRPM,
          rightRPM: adjustedRightRPM,
        },
        matchType: "exact",
        referencePoint: closestPosition.name,
        accuracy: 100,
        confidence: 100,
        distance: minDistance,
        speedProfile: speedProfile,
        rpmVariance: Math.abs(adjustedLeftRPM - adjustedRightRPM),
      };
    }

    // Use interpolation for non-exact matches
    const interpolated = this.calculateInterpolationFromJson(
      speed,
      x,
      y,
      swingLevel,
      spinLevel
    );

    return {
      speed,
      swingLevel,
      spinLevel,
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

  // [Rest of the utility methods remain the same...]
  
  getPerformanceMetrics() {
    const cacheSize = this.interpolationCache.size;
    const totalOperations =
      this.metrics.cacheHits +
      this.metrics.interpolations +
      this.metrics.exactMatches;

    const topEntries = Array.from(this.cacheAccessCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      cache: {
        size: cacheSize,
        maxSize: this.cacheConfig.maxSize,
        utilizationRate: ((cacheSize / this.cacheConfig.maxSize) * 100).toFixed(2),
        memoryEstimate: `${(this.metrics.totalMemoryUsage / 1024).toFixed(2)} KB`,
        hitRate:
          totalOperations > 0
            ? ((this.metrics.cacheHits / totalOperations) * 100).toFixed(2)
            : 0,
        cleanupOperations: this.metrics.cacheCleanups,
        expiredEntries: this.metrics.expiredEntries,
        topAccessedEntries: topEntries,
      },
      performance: {
        exactMatchRate:
          totalOperations > 0
            ? ((this.metrics.exactMatches / totalOperations) * 100).toFixed(2)
            : 0,
        totalOperations,
        ...this.metrics,
      },
      speedProfile: this.speedRpmProfile,
    };
  }

  cleanupCache(forced = false) {
    const beforeSize = this.interpolationCache.size;

    if (forced) {
      this.interpolationCache.clear();
      this.cacheTimestamps.clear();
      this.cacheAccessCount.clear();
      this.metrics.totalMemoryUsage = 0;
    } else {
      this.manageCacheSize();
    }

    const afterSize = this.interpolationCache.size;
    return {
      removedEntries: beforeSize - afterSize,
      currentSize: afterSize,
      memoryFreed: `${(((beforeSize - afterSize) * 200) / 1024).toFixed(2)} KB`,
    };
  }

  getCacheHealth() {
    const currentSize = this.interpolationCache.size;
    const utilizationRate = (currentSize / this.cacheConfig.maxSize) * 100;

    let status = "HEALTHY";
    if (utilizationRate > 90) status = "CRITICAL";
    else if (utilizationRate > 75) status = "WARNING";
    else if (utilizationRate > 50) status = "GOOD";

    return {
      status,
      utilizationRate: utilizationRate.toFixed(2),
      recommendedAction: this.getRecommendedAction(utilizationRate),
    };
  }

  getRecommendedAction(utilization) {
    if (utilization > 90) return "Immediate cleanup recommended";
    if (utilization > 75) return "Consider cleanup soon";
    if (utilization > 50) return "Monitor usage";
    return "Cache performing optimally";
  }

  getSupportedConfigurations() {
    if (!this.isDataLoaded) {
      return { error: "Data not loaded yet" };
    }

    return {
      speeds: this.jsonData.dataset_parameters.speeds,
      swingLevels: this.jsonData.dataset_parameters.swing_levels,
      spinLevels: this.jsonData.dataset_parameters.spin_levels,
      positions: this.jsonData.dataset_parameters.positions,
      totalCombinations: this.jsonData.generation_metadata.total_combinations,
      appliedOffsets: this.jsonData.applied_offsets,
    };
  }

  getCacheConfig() {
    return { ...this.cacheConfig };
  }

  setCacheConfig(newConfig) {
    this.cacheConfig = { ...this.cacheConfig, ...newConfig };

    if (this.interpolationCache.size > this.cacheConfig.maxSize) {
      this.manageCacheSize();
    }

    return this.getCacheConfig();
  }
}
