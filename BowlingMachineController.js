class BowlingMachineController {
  constructor() {
    // Initialize with empty data - will be loaded from JSON
    this.jsonData = null;
    this.isDataLoaded = false;
    this.loadingPromise = null;

    // Smart cache configuration with limits
    this.cacheConfig = {
      maxSize: 5000, // Maximum 5000 cached calculations
      cleanupThreshold: 4500, // Start cleanup when cache reaches 4500
      cleanupBatchSize: 1000, // Remove 1000 oldest entries during cleanup
      maxAge: 3600000, // Cache entries expire after 1 hour (in milliseconds)
    };

    // Enhanced accuracy zones based on higher RPM requirements
    this.accuracyZones = {
      ULTRA_PRECISION: { yMin: 5, yMax: 15, tolerance: 3 }, // Top edge - ultra precision
      HIGH_PRECISION: { yMin: 15, yMax: 35, tolerance: 5 }, // Top-mid region
      MEDIUM_PRECISION: { yMin: 35, yMax: 60, tolerance: 8 }, // Middle region
      STANDARD_PRECISION: { yMin: 60, yMax: 80, tolerance: 10 }, // Bottom region
    };

    // Enhanced cache with timestamps for age-based cleanup
    this.interpolationCache = new Map();
    this.cacheTimestamps = new Map(); // Track when each entry was created
    this.cacheAccessCount = new Map(); // Track how often each entry is used

    // Performance metrics tracking
    this.metrics = {
      cacheHits: 0,
      interpolations: 0,
      exactMatches: 0,
      cacheCleanups: 0, // Track cleanup operations
      expiredEntries: 0, // Track expired entries removed
      totalMemoryUsage: 0, // Estimate memory usage
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
        const response = await fetch("FINAL_Complete_Algorithm_Dataset.json");
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        this.jsonData = await response.json();
        this.isDataLoaded = true;
        console.log("JSON data loaded successfully:", this.jsonData.metadata);
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

  // Smart cache management with multiple strategies
  manageCacheSize() {
    const currentSize = this.interpolationCache.size;
    const now = Date.now();
    let removedCount = 0;

    // Strategy 1: Remove expired entries first
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.cacheConfig.maxAge) {
        this.interpolationCache.delete(key);
        this.cacheTimestamps.delete(key);
        this.cacheAccessCount.delete(key);
        removedCount++;
        this.metrics.expiredEntries++;
      }
    }

    // Strategy 2: If still over threshold, remove least frequently used entries
    if (this.interpolationCache.size >= this.cacheConfig.cleanupThreshold) {
      // Sort by access count (ascending) - least used first
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

    // Update memory usage estimate (rough calculation)
    this.metrics.totalMemoryUsage = this.interpolationCache.size * 200; // ~200 bytes per entry

    return removedCount;
  }

  // Cache retrieval with access tracking
  getCachedResult(cacheKey) {
    if (this.interpolationCache.has(cacheKey)) {
      // Update access count for LFU (Least Frequently Used) algorithm
      const currentCount = this.cacheAccessCount.get(cacheKey) || 0;
      this.cacheAccessCount.set(cacheKey, currentCount + 1);

      this.metrics.cacheHits++;
      return this.interpolationCache.get(cacheKey);
    }
    return null;
  }

  // Cache storage with smart management
  setCachedResult(cacheKey, result) {
    // Check if we need to clean up before adding new entry
    if (this.interpolationCache.size >= this.cacheConfig.maxSize) {
      this.manageCacheSize();
    }

    const now = Date.now();
    this.interpolationCache.set(cacheKey, result);
    this.cacheTimestamps.set(cacheKey, now);
    this.cacheAccessCount.set(cacheKey, 1); // Initial access count

    this.metrics.interpolations++;
  }

  // Multi-tier tolerance system
  getRegionTolerance(y) {
    for (const [region, zone] of Object.entries(this.accuracyZones)) {
      if (y >= zone.yMin && y <= zone.yMax) {
        return zone.tolerance;
      }
    }
    return 12; // default for edge cases
  }

  // Region-specific multiplier calculation
  calculateRegionMultiplier(targetY, point) {
    let multiplier = 1.0;

    // Top region preferences
    if (targetY <= 30) {
      if (point.name.includes("top")) multiplier = 2.5;
      else if (point.name.includes("mid")) multiplier = 1.8;
    }

    // Middle region preferences
    if (targetY > 30 && targetY <= 60) {
      if (point.name === "centre") multiplier = 2.0;
      else if (point.name.includes("left") || point.name.includes("right"))
        multiplier = 1.5;
    }

    // Bottom region preferences
    if (targetY > 60) {
      if (point.name === "bottom") multiplier = 2.5;
      else if (point.name === "centre") multiplier = 1.5;
    }

    return multiplier;
  }

  // Confidence scoring for interpolation quality
  calculateConfidenceScore(points, tolerance) {
    const avgDistance =
      points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const maxWeight = Math.max(...points.map((p) => p.weight));

    // Higher confidence with closer points and higher max weight
    const distanceScore = Math.max(0, 100 - (avgDistance / tolerance) * 30);
    const weightScore = Math.min(100, maxWeight * 20);

    return Math.round((distanceScore + weightScore) / 2);
  }

  // Accuracy scoring with confidence integration
  calculateAccuracyScore(points, targetX, targetY) {
    const avgDistance =
      points.reduce((sum, p) => sum + p.distance, 0) / points.length;
    const regionTolerance = this.getRegionTolerance(targetY);
    const baseAccuracy = Math.max(
      0,
      100 - (avgDistance / regionTolerance) * 15
    );

    // Bonus for having multiple relevant points
    const pointBonus = Math.min(10, points.length * 2);

    return Math.min(100, baseAccuracy + pointBonus);
  }

  // Enhanced interpolation with smart caching
  calculateAdvancedInterpolation(rpm, targetX, targetY) {
    // Create cache key
    const cacheKey = `${rpm}-${targetX}-${targetY}`;

    // Check cache first with access tracking
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const rpmConfig = this.config.rpmConfigs[rpm];
    const tolerance = this.getRegionTolerance(targetY);

    // Enhanced: Dynamic relevance scoring
    const relevantPoints = rpmConfig.positions.map((point) => {
      const distance = Math.sqrt(
        Math.pow(point.ui.x - targetX, 2) + Math.pow(point.ui.y - targetY, 2)
      );

      // Advanced: Multi-factor weighting system
      let regionMultiplier = this.calculateRegionMultiplier(targetY, point);
      let proximityBonus = distance < tolerance ? 1.5 : 1.0;

      return {
        ...point,
        distance: distance,
        weight: (regionMultiplier * proximityBonus) / (distance + 0.1),
        isRelevant: distance <= tolerance * 2.5,
      };
    });

    // Use top 4-6 points based on target precision requirements
    const pointCount = targetY <= 30 ? 6 : 4; // More points for high precision areas
    const bestPoints = relevantPoints
      .sort((a, b) => b.weight - a.weight)
      .slice(0, pointCount);

    // Enhanced: Weighted interpolation with distance decay
    let totalWeight = 0;
    const weightedSums = { pan: 0, tilt: 0, leftTilt: 0, rightTilt: 0 };

    bestPoints.forEach((point) => {
      // Apply exponential distance decay for better accuracy
      const adjustedWeight =
        point.weight * Math.exp(-point.distance / tolerance);
      totalWeight += adjustedWeight;

      weightedSums.pan += point.machine.pan * adjustedWeight;
      weightedSums.tilt += point.machine.tilt * adjustedWeight;
      weightedSums.leftTilt += point.machine.leftTilt * adjustedWeight;
      weightedSums.rightTilt += point.machine.rightTilt * adjustedWeight;
    });

    const result = {
      pan: Math.round(weightedSums.pan / totalWeight),
      tilt: Math.round(weightedSums.tilt / totalWeight),
      leftTilt: Math.round(weightedSums.leftTilt / totalWeight),
      rightTilt: Math.round(weightedSums.rightTilt / totalWeight),
      usedPoints: bestPoints.length,
      accuracy: this.calculateAccuracyScore(bestPoints, targetX, targetY),
      confidence: this.calculateConfidenceScore(bestPoints, tolerance),
    };

    // Cache with smart management
    this.setCachedResult(cacheKey, result);

    return result;
  }

  // Enhanced region naming
  getRegionName(y) {
    if (y <= 15) return "ULTRA_PRECISION_TOP_EDGE";
    if (y <= 35) return "HIGH_PRECISION_TOP";
    if (y <= 60) return "MEDIUM_PRECISION_MIDDLE";
    return "STANDARD_PRECISION_BOTTOM";
  }

  // Interpolation method for JSON data
  calculateInterpolationFromJson(
    speed,
    targetX,
    targetY,
    swingLevel,
    spinLevel
  ) {
    const cacheKey = `${speed}-${targetX}-${targetY}-${swingLevel}-${spinLevel}`;

    // Check cache first
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

    // Calculate distances and weights for all positions
    const relevantPoints = Object.entries(positions).map(
      ([positionName, positionData]) => {
        const distance = Math.sqrt(
          Math.pow(positionData.X - targetX, 2) +
            Math.pow(positionData.Y - targetY, 2)
        );

        let regionMultiplier = this.calculateRegionMultiplier(targetY, {
          name: positionName,
        });
        let proximityBonus = distance < tolerance ? 1.5 : 1.0;

        return {
          name: positionName,
          distance: distance,
          weight: (regionMultiplier * proximityBonus) / (distance + 0.1),
          isRelevant: distance <= tolerance * 2.5,
          data: positionData,
        };
      }
    );

    // Use top 4-6 points based on target precision requirements
    const pointCount = targetY <= 30 ? 6 : 4;
    const bestPoints = relevantPoints
      .sort((a, b) => b.weight - a.weight)
      .slice(0, pointCount);

    // Weighted interpolation
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
      const adjustedWeight =
        point.weight * Math.exp(-point.distance / tolerance);
      totalWeight += adjustedWeight;

      weightedSums.pan += point.data.Pan * adjustedWeight;
      weightedSums.panActual += point.data.Pan_actual * adjustedWeight;
      weightedSums.tilt += point.data.Tilt * adjustedWeight;
      weightedSums.tiltActual += point.data.Tilt_actual * adjustedWeight;
      weightedSums.leftTilt += point.data.Left_Tilt * adjustedWeight;
      weightedSums.leftTiltActual +=
        point.data.Left_Tilt_Actual * adjustedWeight;
      weightedSums.rightTilt += point.data.Right_Tilt * adjustedWeight;
      weightedSums.rightTiltActual +=
        point.data.Right_Tilt_Actual * adjustedWeight;
      weightedSums.leftRPM += point.data.L_RPM * adjustedWeight;
      weightedSums.rightRPM += point.data.R_RPM * adjustedWeight;
    });

    const result = {
      pan: Math.round(weightedSums.pan / totalWeight),
      panActual: Math.round(weightedSums.panActual / totalWeight),
      tilt: Math.round(weightedSums.tilt / totalWeight),
      tiltActual: Math.round(weightedSums.tiltActual / totalWeight),
      leftTilt: Math.round(weightedSums.leftTilt / totalWeight),
      leftTiltActual: Math.round(weightedSums.leftTiltActual / totalWeight),
      rightTilt: Math.round(weightedSums.rightTilt / totalWeight),
      rightTiltActual: Math.round(weightedSums.rightTiltActual / totalWeight),
      leftRPM: Math.round(weightedSums.leftRPM / totalWeight),
      rightRPM: Math.round(weightedSums.rightRPM / totalWeight),
      usedPoints: bestPoints.length,
      accuracy: this.calculateAccuracyScore(bestPoints, targetX, targetY),
      confidence: this.calculateConfidenceScore(bestPoints, tolerance),
    };

    // Cache the result
    this.setCachedResult(cacheKey, result);
    return result;
  }

  // Main configuration method with new parameters
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
      const availableSpeeds = this.jsonData.metadata.speeds.join(", ");
      return {
        error: `Speed ${speed} km/h not supported. Available: ${availableSpeeds}`,
      };
    }

    // Get the exact data for the specified parameters
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

    // Check for exact match (within 5 units)
    if (minDistance < 5) {
      this.metrics.exactMatches++;
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
          leftRPM: Math.round(closestPosition.data.L_RPM),
          rightRPM: Math.round(closestPosition.data.R_RPM),
        },
        matchType: "exact",
        referencePoint: closestPosition.name,
        accuracy: 100,
        confidence: 100,
        distance: minDistance,
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
      },
    };
  }

  // Enhanced performance metrics with cache statistics
  getPerformanceMetrics() {
    const cacheSize = this.interpolationCache.size;
    const totalOperations =
      this.metrics.cacheHits +
      this.metrics.interpolations +
      this.metrics.exactMatches;

    // Calculate top 10 most accessed entries
    const topEntries = Array.from(this.cacheAccessCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      cache: {
        size: cacheSize,
        maxSize: this.cacheConfig.maxSize,
        utilizationRate: ((cacheSize / this.cacheConfig.maxSize) * 100).toFixed(
          2
        ),
        memoryEstimate: `${(this.metrics.totalMemoryUsage / 1024).toFixed(
          2
        )} KB`,
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
    };
  }

  // Manual cache cleanup
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

  // Get cache health status
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

  // Get all supported configurations from JSON data
  getSupportedConfigurations() {
    if (!this.isDataLoaded) {
      return { error: "Data not loaded yet" };
    }

    return {
      speeds: this.jsonData.metadata.speeds,
      swingLevels: this.jsonData.metadata.swing_levels,
      spinLevels: this.jsonData.metadata.spin_levels,
      positions: this.jsonData.metadata.positions,
      totalCombinations: this.jsonData.metadata.total_combinations,
      description: this.jsonData.metadata.description,
    };
  }

  // Cache configuration getter/setter
  getCacheConfig() {
    return { ...this.cacheConfig };
  }

  setCacheConfig(newConfig) {
    this.cacheConfig = { ...this.cacheConfig, ...newConfig };

    // If maxSize was reduced, trigger cleanup if needed
    if (this.interpolationCache.size > this.cacheConfig.maxSize) {
      this.manageCacheSize();
    }

    return this.getCacheConfig();
  }
}
