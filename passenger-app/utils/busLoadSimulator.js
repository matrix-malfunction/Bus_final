/**
 * Bus Load Simulator - Generate high-load scenarios for testing
 */

const SIMULATION_CENTER = { lat: 40.7128, lng: -74.0060 }; // NYC
const MOVEMENT_SPEED = 10; // m/s (~36 km/h)
const UPDATE_INTERVAL = 500; // ms

class BusLoadSimulator {
  constructor() {
    this.buses = new Map();
    this.isRunning = false;
    this.intervalId = null;
    this.callback = null;
    this.metrics = {
      totalUpdates: 0,
      avgProcessingTime: 0,
      maxProcessingTime: 0,
      droppedFrames: 0,
    };
  }

  /**
   * Generate random bus position around center
   */
  generateBus(id, distanceFromCenter = null) {
    const angle = Math.random() * Math.PI * 2;
    const distance = distanceFromCenter || Math.random() * 10000; // 0-10km
    
    // Convert to lat/lng offset
    const latOffset = (distance * Math.cos(angle)) / 111320; // meters to degrees
    const lngOffset = (distance * Math.sin(angle)) / (111320 * Math.cos(SIMULATION_CENTER.lat * Math.PI / 180));
    
    return {
      busId: `BUS_${id.toString().padStart(3, '0')}`,
      lat: SIMULATION_CENTER.lat + latOffset,
      lng: SIMULATION_CENTER.lng + lngOffset,
      calculatedSpeed: Math.random() * 15 + 5, // 5-20 m/s
      calculatedDistance: distance,
      calculatedEtaMinutes: Math.floor(distance / (MOVEMENT_SPEED * 60)),
      direction: angle,
    };
  }

  /**
   * Initialize N buses
   */
  initBuses(count = 100) {
    this.buses.clear();
    
    for (let i = 0; i < count; i++) {
      // Distribute buses: 30% near (0-2km), 40% medium (2-5km), 30% far (5-10km)
      let distance;
      const rand = Math.random();
      if (rand < 0.3) {
        distance = Math.random() * 2000; // 0-2km (high priority)
      } else if (rand < 0.7) {
        distance = 2000 + Math.random() * 3000; // 2-5km (medium)
      } else {
        distance = 5000 + Math.random() * 5000; // 5-10km (low)
      }
      
      const bus = this.generateBus(i, distance);
      this.buses.set(bus.busId, bus);
    }
    
    console.log(`[SIM] Initialized ${count} buses`);
    return Array.from(this.buses.values());
  }

  /**
   * Move all buses slightly
   */
  updatePositions() {
    const startTime = performance.now();
    
    this.buses.forEach((bus, id) => {
      // Move in current direction
      const moveDistance = bus.calculatedSpeed * (UPDATE_INTERVAL / 1000);
      const latOffset = (moveDistance * Math.cos(bus.direction)) / 111320;
      const lngOffset = (moveDistance * Math.sin(bus.direction)) / (111320 * Math.cos(bus.lat * Math.PI / 180));
      
      bus.lat += latOffset;
      bus.lng += lngOffset;
      bus.calculatedDistance = Math.sqrt(
        Math.pow((bus.lat - SIMULATION_CENTER.lat) * 111320, 2) +
        Math.pow((bus.lng - SIMULATION_CENTER.lng) * 111320 * Math.cos(SIMULATION_CENTER.lat * Math.PI / 180), 2)
      );
      
      // Slight direction change (simulating road turns)
      bus.direction += (Math.random() - 0.5) * 0.1;
    });

    const processingTime = performance.now() - startTime;
    this.metrics.totalUpdates++;
    this.metrics.avgProcessingTime = 
      (this.metrics.avgProcessingTime * (this.metrics.totalUpdates - 1) + processingTime) / this.metrics.totalUpdates;
    this.metrics.maxProcessingTime = Math.max(this.metrics.maxProcessingTime, processingTime);

    return Array.from(this.buses.values());
  }

  /**
   * Start simulation
   */
  start(onUpdate, intervalMs = UPDATE_INTERVAL) {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.callback = onUpdate;
    
    this.intervalId = setInterval(() => {
      const buses = this.updatePositions();
      if (this.callback) {
        this.callback(buses);
      }
    }, intervalMs);
    
    console.log(`[SIM] Started simulation: ${this.buses.size} buses, ${intervalMs}ms interval`);
  }

  /**
   * Stop simulation
   */
  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[SIM] Stopped simulation');
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      busCount: this.buses.size,
      updatesPerSecond: 1000 / UPDATE_INTERVAL,
    };
  }

  /**
   * Stress test: Gradually increase load
   */
  async runStressTest(onUpdate, maxBuses = 200, step = 20) {
    console.log('[STRESS] Starting stress test...');
    
    const results = [];
    
    for (let count = step; count <= maxBuses; count += step) {
      // Initialize buses
      this.initBuses(count);
      
      // Warm up
      await this.sleep(1000);
      
      // Measure for 5 seconds
      let frames = 0;
      let dropped = 0;
      let lastTime = performance.now();
      
      const measureInterval = setInterval(() => {
        const buses = this.updatePositions();
        onUpdate(buses);
        
        const now = performance.now();
        const delta = now - lastTime;
        
        // Check if we missed a frame (expecting ~16ms for 60fps)
        if (delta > 33) { // Missed 2+ frames
          dropped++;
        }
        
        frames++;
        lastTime = now;
      }, 16); // 60 FPS target

      await this.sleep(5000);
      clearInterval(measureInterval);
      
      const metrics = this.getMetrics();
      const fps = frames / 5;
      
      results.push({
        busCount: count,
        fps: Math.round(fps),
        droppedFrames: dropped,
        avgProcessingTime: Math.round(metrics.avgProcessingTime),
        maxProcessingTime: Math.round(metrics.maxProcessingTime),
        status: fps > 55 ? 'OK' : fps > 30 ? 'DEGRADED' : 'FAILED',
      });
      
      console.log(
        `[STRESS] ${count} buses: ${fps} FPS, ${dropped} dropped, ` +
        `${metrics.avgProcessingTime.toFixed(1)}ms avg processing`
      );
      
      // Stop if performance degraded
      if (fps < 30) {
        console.log('[STRESS] Breaking point reached!');
        break;
      }
    }
    
    this.stop();
    return results;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const busSimulator = new BusLoadSimulator();
export default busSimulator;
