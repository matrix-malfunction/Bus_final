import React, { useCallback, useState, useRef, useEffect } from "react";
import { Button, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { activateKeepAwake, deactivateKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { io } from "socket.io-client";

// PRODUCTION BACKEND URL
const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";

// BACKGROUND TASK NAME
const BACKGROUND_LOCATION_TASK = "background-location-task";

// BATTERY OPTIMIZATION: Minimum distance (meters) before sending update
const MIN_DISTANCE_METERS = 10;
// Minimum time (ms) between API calls - STRICT 5 SECOND THROTTLE
const MIN_API_INTERVAL_MS = 5000;
// Max retry attempts for failed requests
const MAX_RETRIES = 3;
// AsyncStorage keys
const QUEUE_STORAGE_KEY = "@driver_location_queue";
const LAST_SENT_KEY = "@driver_last_sent";
const LAST_LOCATION_KEY = "@driver_last_location";
const BUS_ID_KEY = "bus_id";
const TOKEN_KEY = "@auth_token";
// Global variables for background task (TaskManager cannot access AsyncStorage)
global.bgBusId = null;
global.bgToken = null;
global.bgLastLocation = null; // { latitude, longitude, timestamp }
// SOS freeze state - stops location updates when SOS is active
global.bgSosActive = false;
// Background task tracking flag - single source of truth
global.__trackingActive = false;

// Race-safety for SOS polling
let isCheckingSOS = false;
let lastRequestId = 0;

// Constants for GPS filtering
const DUPLICATE_THRESHOLD_METERS = 10; // Skip if moved less than 10m (prevents GPS drift noise)
const EXTREME_JUMP_THRESHOLD_METERS = 1000; // Skip if jumped more than 1km

// Helper: async delay (replaces setTimeout)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Haversine distance calculation (for GPS filtering)
const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Calculate speed using Haversine distance and time delta
// Replaces unreliable GPS speed when stationary
function calculateSpeed(prev, curr) {
  if (!prev || !prev.latitude || !prev.longitude || !prev.timestamp) {
    return null; // No previous location to compare
  }

  const distance = haversineMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
  const timeDiff = (curr.timestamp - prev.timestamp) / 1000; // seconds

  // STRICT: Need at least 1 second AND 10 meters movement (prevents GPS drift noise)
  if (timeDiff < 1 || distance < 10) {
    return 0;
  }

  // Speed in m/s
  const speedMps = distance / timeDiff;

  // Noise filter: if speed < 1 m/s (3.6 km/h), consider stationary
  if (speedMps < 1) {
    return 0;
  }

  // Clamp unrealistic speeds (>40 m/s = 144 km/h)
  return Math.min(speedMps, 40);
}

// Foreground last location store (for speed calculation)
let fgLastLocation = null;

// Define background location task - sends location to backend even when app is killed
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  try {
    if (error) {
      console.log("[BG TASK] Error:", error.message);
      return;
    }
    
    // BLOCK if tracking not active
    if (!global.__trackingActive) {
      console.log("[BG TASK] BLOCKED - tracking not active");
      return;
    }
    
    // Validate data before access
    if (!data || !data.locations || !Array.isArray(data.locations) || data.locations.length === 0) {
      console.log("[BG TASK] No valid locations data");
      return;
    }
    
    const location = data.locations[0];
    if (!location || !location.coords) return;

    // Extract coordinates safely from location.coords
    const rawLat = location.coords?.latitude;
    const rawLng = location.coords?.longitude;
    const accuracy = location.coords?.accuracy;
    const altitude = location.coords?.altitude;
    const heading = location.coords?.heading;
    // IGNORE GPS speed - compute using Haversine instead
    const gpsSpeed = location.coords?.speed;

    // Compute speed using Haversine (more reliable than GPS when stationary)
    const now = Date.now();
    const currLocation = { latitude: Number(rawLat), longitude: Number(rawLng), timestamp: now };
    const computedSpeedMps = calculateSpeed(global.bgLastLocation, currLocation);
    // Use computed speed if available, otherwise fall back to GPS speed
    const finalSpeed = computedSpeedMps !== null ? computedSpeedMps : (gpsSpeed || 0);

    // Safely parse to numbers
    const latitude = Number(rawLat);
    const longitude = Number(rawLng);

    // Skip if lat/lng invalid
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.log("[BG TASK] Invalid coordinates, skipping:", { rawLat, rawLng });
      return;
    }

    // Debug log
    console.log("[BG TASK] Location received:", latitude.toFixed(6), longitude.toFixed(6), "accuracy:", accuracy);

    // GPS DRIFT FILTER: Skip low accuracy locations (>50m)
    if (accuracy && accuracy > 50) {
      console.log("[BG TASK] Skipped - low accuracy:", accuracy.toFixed(1), "m");
      return;
    }

    // Skip duplicate coordinates (no significant movement)
    const lastLoc = global.bgLastLocation;
    if (lastLoc && Number.isFinite(lastLoc.latitude) && Number.isFinite(lastLoc.longitude)) {
      const distance = haversineMeters(lastLoc.latitude, lastLoc.longitude, latitude, longitude);
      if (distance < DUPLICATE_THRESHOLD_METERS) {
        console.log("[BG TASK] Duplicate coordinates (moved " + distance.toFixed(1) + "m), skipping");
        return;
      }
      // Filter extreme GPS jumps (>1km in one update)
      if (distance > EXTREME_JUMP_THRESHOLD_METERS) {
        console.log("[BG TASK] Extreme GPS jump (" + distance.toFixed(0) + "m), skipping");
        return;
      }
    }

    // Use global variables (set by foreground app)
    const busId = global.bgBusId;
    const token = global.bgToken;

    // Skip if missing busId or token
    if (!busId || !token) {
      console.log("[BG TASK] Missing busId or token, skipping");
      return;
    }

    // SOS FREEZE: Skip location updates when SOS is active
    if (global.bgSosActive) {
      console.log("[TRACKING] Paused due to active SOS");
      return;
    }

    // Build request body without fallbacks
    const requestBody = {
      busId,
      lat: Number(latitude),
      lng: Number(longitude),
      accuracy: accuracy || null,
      altitude: altitude || null,
      heading: heading || null,
      speed: finalSpeed, // Computed speed (Haversine), not GPS
      source: "background_task",
      timestamp: new Date().toISOString(),
      trackingActive: global.__trackingActive, // Dynamic tracking state
    };

    // Send with async retry (no stacked timeouts)
    const sendWithRetry = async () => {
      try {
        const headers = { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        };

        const response = await fetch(`${API_BASE_URL}/api/driver/location`, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });

        // Log each send attempt for debugging
        console.log("DRIVER LOCATION:", latitude.toFixed(6), longitude.toFixed(6));
      console.log("[BG TASK] Sending location:", latitude.toFixed(6), longitude.toFixed(6), "busId:", busId);

        if (response.ok) {
          console.log("[BG TASK] Sent successfully:", latitude.toFixed(6), longitude.toFixed(6));
          // Update last location after successful send
          global.bgLastLocation = { latitude, longitude, timestamp: Date.now() };
          return;
        } else if (response.status === 401) {
          // Handle 401 token expiry - log and skip (don't retry)
          console.log("[BG TASK] Token expired (401), skipping send");
          return;
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        console.log("[BG TASK] Send failed:", err.message);
        console.log("[BG TASK] Retrying once...");
        await sleep(3000);
        
        // One retry
        try {
          const headers = { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          };
          const response = await fetch(`${API_BASE_URL}/api/driver/location`, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
          });
          if (response.ok) {
            console.log("[BG TASK] Retry success:", latitude.toFixed(6), longitude.toFixed(6));
            // Update last location after successful retry
            global.bgLastLocation = { latitude, longitude, timestamp: Date.now() };
          } else if (response.status === 401) {
            console.log("[BG TASK] Retry failed: Token expired (401)");
          } else {
            console.log("[BG TASK] Retry failed: HTTP", response.status);
          }
        } catch (retryErr) {
          console.log("[BG TASK] Retry error:", retryErr.message);
        }
      }
    };

    await sendWithRetry();
  } catch (e) {
    console.log("[BG TASK] Unhandled error:", e.message);
  }
});

export default function DriverTrackingScreen({ token }) {
  const [busId, setBusId] = useState("BUS101");
  const [status, setStatus] = useState("Ready");
  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [lastSentLocation, setLastSentLocation] = useState(null);
  const [failedQueue, setFailedQueue] = useState([]);
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);

  // Refs for mutable state in callbacks
  const locationSubscriptionRef = useRef(null);
  const isSendingRef = useRef(false);
  const lastSendTimeRef = useRef(0);
  const pendingRetryRef = useRef(null);
  const networkCheckIntervalRef = useRef(null);
  const flushInProgressRef = useRef(false);
  const guaranteeTimeoutRef = useRef(null);

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  };

  // Load persistent queue from AsyncStorage on mount
  const loadQueueFromStorage = async () => {
    try {
      const storedQueue = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      if (storedQueue) {
        const parsed = JSON.parse(storedQueue);
        setFailedQueue(parsed);
        setQueueCount(parsed.length);
        console.log("[QUEUE] Loaded", parsed.length, "items from storage");
      }
      const storedLastSent = await AsyncStorage.getItem(LAST_SENT_KEY);
      if (storedLastSent) {
        setLastSentLocation(JSON.parse(storedLastSent));
      }
    } catch (error) {
      console.log("[STORAGE] Load error:", error.message);
    }
  };

  // Save queue to AsyncStorage
  const saveQueueToStorage = async (queue) => {
    try {
      await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
      setQueueCount(queue.length);
    } catch (error) {
      console.log("[STORAGE] Save error:", error.message);
    }
  };

  // Save last sent location
  const saveLastSent = async (location) => {
    try {
      await AsyncStorage.setItem(LAST_SENT_KEY, JSON.stringify(location));
    } catch (error) {
      console.log("[STORAGE] Save last sent error:", error.message);
    }
  };

  // Save busId for background task access (global + AsyncStorage backup)
  const saveBusId = async (id) => {
    global.bgBusId = id; // Set global for TaskManager
    try {
      await AsyncStorage.setItem(BUS_ID_KEY, id);
    } catch (error) {
      console.log("[STORAGE] Save busId error:", error.message);
    }
  };

  // Save token for background task access (global + AsyncStorage backup)
  const saveToken = async (authToken) => {
    global.bgToken = authToken; // Set global for TaskManager
    try {
      if (authToken) {
        await AsyncStorage.setItem(TOKEN_KEY, authToken);
      }
    } catch (error) {
      console.log("[STORAGE] Save token error:", error.message);
    }
  };

  // Start background location tracking - works even when app is killed
  const startBackgroundTracking = async () => {
    try {
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== "granted") {
        console.log("[BG TRACKING] Background permission denied");
        return false;
      }

      const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (isRunning) {
        console.log("[BG TRACKING] Already running");
        return true;
      }

      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 5,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Bus Tracking Active",
          notificationBody: "Sharing location with passengers",
        },
      });

      global.__trackingActive = true;
      console.log("[BG TRACKING] Started successfully");
      return true;
    } catch (err) {
      console.log("[BG TRACKING] Start error:", err.message);
      return false;
    }
  };

  // Stop background location tracking
  const stopBackgroundTracking = async () => {
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        console.log("[BG TRACKING] Stopped");
      }
    } catch (err) {
      console.log("[BG TRACKING] Stop error:", err.message);
    } finally {
      global.__trackingActive = false;
    }
  };

  // Stop background tracking function for cleanup useEffect (synchronous ref)
  const stopBackgroundTrackingRef = useRef(stopBackgroundTracking);

  // Network state monitoring
  useEffect(() => {
    // Load queue on mount
    loadQueueFromStorage();

    // Subscribe to network changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected && state.isInternetReachable;
      setIsOnline(online);
      console.log("[NET] Status:", online ? "ONLINE" : "OFFLINE");

      // When coming back online, flush queue
      if (online && failedQueue.length > 0 && !flushInProgressRef.current) {
        console.log("[NET] Back online - flushing queue");
        flushQueue();
      }
    });

    // Periodic network check
    networkCheckIntervalRef.current = setInterval(async () => {
      const state = await NetInfo.fetch();
      const online = state.isConnected && state.isInternetReachable;
      setIsOnline(online);
    }, 10000);

    return () => {
      unsubscribe();
      if (networkCheckIntervalRef.current) {
        clearInterval(networkCheckIntervalRef.current);
      }
    };
  }, []);

  // Update queue count when failedQueue changes
  useEffect(() => {
    setQueueCount(failedQueue.length);
    saveQueueToStorage(failedQueue);
  }, [failedQueue]);

  // Send location to backend with retry queue and network awareness
  const sendLocationToBackend = async (location, attempt = 1, isFromQueue = false) => {
    // Throttle: prevent rapid sends (4 second minimum)
    const now = Date.now();
    if (now - lastSendTimeRef.current < 4000) {
      console.log("[API] Throttled - too soon");
      return;
    }
    lastSendTimeRef.current = now;
    
    // BLOCK if tracking not active
    if (!global.__trackingActive) {
      console.log("[API] BLOCKED - tracking stopped");
      return;
    }

    const { latitude, longitude, accuracy, altitude, heading } = location;
    
    // GPS DRIFT FILTER: Skip low accuracy locations (>50m)
    if (accuracy && accuracy > 50) {
      console.log("[API] Skipped - low accuracy:", accuracy.toFixed(1), "m");
      return;
    }
    
    // IGNORE GPS speed - compute using Haversine instead (more reliable when stationary)
    const currLocation = { latitude, longitude, timestamp: now };
    const computedSpeedMps = calculateSpeed(fgLastLocation, currLocation);
    const finalSpeed = computedSpeedMps !== null ? computedSpeedMps : (location.speed || 0);

    const timeSinceLastSend = now - lastSendTimeRef.current;
    if (timeSinceLastSend < MIN_API_INTERVAL_MS) {
      console.log("[API] BLOCKED - throttled:", (MIN_API_INTERVAL_MS - timeSinceLastSend), "ms remaining");
      if (!isFromQueue) {
        // Add to queue for later processing
        setFailedQueue((prev) => {
          const newQueue = [...prev, { location, timestamp: now }];
          saveQueueToStorage(newQueue);
          return newQueue;
        });
        setStatus("Tracking • Queued (throttled)");
      }
      return;
    }

    // Check if we should send (distance filter) - but not for queued items
    if (!isFromQueue && lastSentLocation) {
      const distance = calculateDistance(
        lastSentLocation.latitude,
        lastSentLocation.longitude,
        latitude,
        longitude
      );
      if (distance < MIN_DISTANCE_METERS) {
        console.log("[API] Skipped - distance too small:", distance.toFixed(1), "m");
        return;
      }
    }

    // NETWORK CHECK: If offline, queue immediately
    const netInfo = await NetInfo.fetch();
    if (!netInfo.isConnected || !netInfo.isInternetReachable) {
      console.log("[API] OFFLINE - queuing location");
      if (!isFromQueue) {
        setFailedQueue((prev) => {
          const newQueue = [...prev, { location, timestamp: now }];
          saveQueueToStorage(newQueue);
          return newQueue;
        });
        setStatus("Tracking • Offline (queued)");
      }
      return;
    }

    // OVERLAP PREVENTION: Skip if request in progress
    if (isSendingRef.current) {
      console.log("[API] BLOCKED - request in progress");
      if (!isFromQueue) {
        setFailedQueue((prev) => {
          const newQueue = [...prev, { location, timestamp: now }];
          saveQueueToStorage(newQueue);
          return newQueue;
        });
      }
      return;
    }

    isSendingRef.current = true;
    lastSendTimeRef.current = now;
    setStatus(isFromQueue ? "Retrying updates..." : "Tracking • Online");

    try {
      const requestBody = {
        busId,
        lat: latitude,
        lng: longitude,
        accuracy: accuracy || null,
        altitude: altitude || null,
        heading: heading || null,
        speed: finalSpeed, // Computed speed (Haversine), not GPS
        source: isFromQueue ? "queue_retry" : "watch_position",
        timestamp: new Date().toISOString(),
        trackingActive: global.__trackingActive, // Dynamic tracking state
      };

      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${API_BASE_URL}/api/driver/location`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      console.log("DRIVER LOCATION:", latitude.toFixed(6), longitude.toFixed(6));
      console.log("[API] Success - location sent to backend");
      setLastSentLocation({ latitude, longitude });
      saveLastSent({ latitude, longitude });
      
      // Update last location for speed calculation ONLY after successful send
      // This prevents GPS drift from accumulating error
      fgLastLocation = { latitude, longitude, timestamp: Date.now() };

      // If this was from queue, remove it
      if (isFromQueue) {
        setFailedQueue((prev) => {
          const newQueue = prev.slice(1);
          saveQueueToStorage(newQueue);
          return newQueue;
        });
      }

      setStatus("Tracking • Online");
    } catch (error) {
      console.log("[API] Failed:", error.message, "attempt:", attempt);

      if (attempt < MAX_RETRIES) {
        // EXPONENTIAL BACKOFF: 2s, 4s, 8s
        const backoffDelay = Math.pow(2, attempt) * 1000;
        console.log("[API] Retrying in", backoffDelay, "ms");
        setStatus("Retrying in " + (backoffDelay / 1000) + "s...");

        setTimeout(() => {
          sendLocationToBackend(location, attempt + 1, isFromQueue);
        }, backoffDelay);
      } else {
        // Max retries reached - add to persistent queue
        if (!isFromQueue) {
          setFailedQueue((prev) => {
            const newQueue = [...prev, { location, timestamp: Date.now() }];
            saveQueueToStorage(newQueue);
            return newQueue;
          });
        }
        setStatus("Tracking • Queued (retry failed)");
      }
    } finally {
      isSendingRef.current = false;
    }
  };

  // FLUSH QUEUE: Process all queued items when online
  const flushQueue = async () => {
    // GUARD: Don't flush if tracking stopped
    if (!global.__trackingActive) {
      console.log("[QUEUE] Flush cancelled - tracking stopped");
      return;
    }
    
    if (failedQueue.length === 0 || flushInProgressRef.current) return;

    flushInProgressRef.current = true;
    setStatus("Flushing " + failedQueue.length + " queued updates...");
    console.log("[QUEUE] Flushing", failedQueue.length, "items");

    // Process one at a time with delay to respect rate limits
    for (let i = 0; i < failedQueue.length; i++) {
      // Check tracking state before each item
      if (!global.__trackingActive) {
        console.log("[QUEUE] Flush aborted - tracking stopped mid-flush");
        break;
      }
      
      const item = failedQueue[i];
      await sendLocationToBackend(item.location, 1, true);

      // Wait between items to respect 5s throttle
      if (i < failedQueue.length - 1) {
        await new Promise(resolve => setTimeout(resolve, MIN_API_INTERVAL_MS));
      }
    }

    flushInProgressRef.current = false;
    setStatus("Tracking • Online (queue flushed)");
  };

  // Socket for real-time location updates
  const socketRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    const socket = io(API_BASE_URL);
    socketRef.current = socket;
    return () => socket.disconnect();
  }, []);

  // Call backend to start tracking
  const callBackendStartTracking = async (latitude, longitude) => {
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      
      const response = await fetch(`${API_BASE_URL}/api/location/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          busId, 
          lat: latitude, 
          lng: longitude 
        }),
      });
      
      if (response.ok) {
        console.log("[BACKEND] Start tracking API success");
      } else {
        console.log("[BACKEND] Start tracking API failed:", response.status);
      }
    } catch (err) {
      console.log("[BACKEND] Start tracking API error:", err.message);
    }
  };

  // Call backend to stop tracking
  const callBackendStopTracking = async () => {
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      
      const response = await fetch(`${API_BASE_URL}/api/location/stop`, {
        method: "POST",
        headers,
        body: JSON.stringify({ busId }),
      });
      
      if (response.ok) {
        console.log("[BACKEND] Stop tracking API success");
      } else {
        console.log("[BACKEND] Stop tracking API failed:", response.status);
      }
    } catch (err) {
      console.log("[BACKEND] Stop tracking API error:", err.message);
    }
  };

  // Start tracking with watchPositionAsync
  const startTracking = async () => {
    if (locationSubscriptionRef.current) {
      console.log("[TRACKING] Already running");
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setStatus("Location permission required");
      return;
    }

    try {
      // Get current location immediately for backend start API
      const currentLoc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      const { latitude, longitude } = currentLoc.coords;
      setCurrentLocation({ latitude, longitude });
      
      // Call backend to start tracking (emits BUS_LOCATION_UPDATE immediately)
      await callBackendStartTracking(latitude, longitude);
      
      // BATTERY OPTIMIZED: Use watchPositionAsync for efficient GPS
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced, // Balanced = less battery drain
          timeInterval: 5000,                   // Minimum 5s between updates
          distanceInterval: MIN_DISTANCE_METERS, // Minimum 10m movement
        },
        (location) => {
          const { latitude, longitude } = location.coords;
          setCurrentLocation({ latitude, longitude });
          console.log("DRIVER LOCATION:", latitude.toFixed(6), longitude.toFixed(6));
          console.log("[GPS] Update:", latitude.toFixed(6), longitude.toFixed(6));

          // Send to backend (with locks and rate limiting)
          sendLocationToBackend(location.coords);
        }
      );

      locationSubscriptionRef.current = subscription;
      setIsTracking(true);
      global.__trackingActive = true;
      setStatus("Tracking active (optimized)");
      console.log("[TRACKING] watchPositionAsync started");

      // Guarantee update after START (avoids freeze when GPS is slow)
      guaranteeTimeoutRef.current = setTimeout(async () => {
        // GUARD: Don't send if tracking stopped
        if (!global.__trackingActive) {
          console.log("[TRACKING] Guaranteed update cancelled - tracking stopped");
          return;
        }
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High
          });
          
          await fetch(`${API_BASE_URL}/api/location/update`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              ...(token && { "Authorization": `Bearer ${token}` })
            },
            body: JSON.stringify({
              busId,
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              trackingActive: global.__trackingActive,
            }),
          });
          console.log("[TRACKING] Guaranteed update sent after start");
        } catch (e) {
          console.log("[TRACKING] Retry update failed:", e.message);
        }
      }, 3000);

      // Also start background tracking (works even when app is killed)
      await startBackgroundTracking();
      // Persist busId and token for background task access
      await saveBusId(busId);
      await saveToken(token);
    } catch (err) {
      console.log("[TRACKING] Start error:", err.message);
      setStatus("GPS error: " + err.message);
    }
  };

  // Stop tracking and cleanup
  const stopTracking = async () => {
    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
      console.log("[TRACKING] Subscription removed");
    }

    // Stop background tracking
    await stopBackgroundTracking();
    
    // Call backend to stop tracking (emits BUS_OFFLINE)
    try {
      const stopBody = {
        busId,
        trackingActive: false,
        timestamp: new Date().toISOString(),
      };
      const headers = { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      };
      await fetch(`${API_BASE_URL}/api/driver/location`, {
        method: "POST",
        headers,
        body: JSON.stringify(stopBody),
      });
      console.log("[STOP] Sent trackingActive: false to backend");
    } catch (err) {
      console.log("[STOP] Failed to notify backend:", err.message);
    }
    
    // CLEAR QUEUE: Prevent queued updates from reviving bus after STOP
    setFailedQueue([]);
    saveQueueToStorage([]);
    console.log("[STOP] Queue cleared");

    // Clear any pending retries
    if (pendingRetryRef.current) {
      clearTimeout(pendingRetryRef.current);
      pendingRetryRef.current = null;
    }
    
    // Clear guarantee timeout
    if (guaranteeTimeoutRef.current) {
      clearTimeout(guaranteeTimeoutRef.current);
      guaranteeTimeoutRef.current = null;
      console.log("[STOP] Guarantee timeout cleared");
    }

    setIsTracking(false);
    global.__trackingActive = false;
    setStatus("Tracking stopped");
  };

  // Cleanup on unmount - PRODUCTION SAFE
  useEffect(() => {
    return () => {
      console.log("[CLEANUP] Unmounting - removing subscriptions");

      // Remove location subscription
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }

      // Clear network check interval
      if (networkCheckIntervalRef.current) {
        clearInterval(networkCheckIntervalRef.current);
        networkCheckIntervalRef.current = null;
      }

      // Clear pending retry timeout
      if (pendingRetryRef.current) {
        clearTimeout(pendingRetryRef.current);
        pendingRetryRef.current = null;
      }

      // Stop background tracking
      stopBackgroundTracking();

      // Reset sending lock
      isSendingRef.current = false;
      flushInProgressRef.current = false;
    };
  }, []);

  // Persist busId when it changes (for background task)
  useEffect(() => {
    saveBusId(busId);
  }, [busId]);

  // Persist token when it changes (for background task)
  useEffect(() => {
    saveToken(token);
  }, [token]);

  // Restore globals from AsyncStorage and check background tracking on app start
  useEffect(() => {
    const restoreGlobalsAndCheckTracking = async () => {
      try {
        // Restore busId and token from AsyncStorage to globals
        const storedBusId = await AsyncStorage.getItem(BUS_ID_KEY);
        const storedToken = await AsyncStorage.getItem(TOKEN_KEY);
        if (storedBusId) global.bgBusId = storedBusId;
        if (storedToken) global.bgToken = storedToken;
        console.log("[APP START] Restored globals - busId:", storedBusId, "token:", storedToken ? "yes" : "no");

        // Restore last location for GPS filtering
        const storedLastLoc = await AsyncStorage.getItem(LAST_LOCATION_KEY);
        if (storedLastLoc) {
          try {
            lastLocationRef.current = JSON.parse(storedLastLoc);
            console.log("[APP START] Restored last location");
          } catch (parseErr) {
            console.log("[APP START] Failed to parse last location:", parseErr.message);
          }
        }
        
        // CLEAR QUEUE on app startup: Prevent stale updates
        await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify([]));
        console.log("[APP START] Queue cleared");
        
        // Check if background tracking is running and stop orphaned tasks
        try {
          const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          if (isRunning) {
            console.log("[APP START] Stopping orphaned background tracking");
            await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
            global.__trackingActive = false;
          }
        } catch (bgCheckErr) {
          console.log("[APP START] BG check error:", bgCheckErr.message);
        }
      } catch (err) {
        console.log("[APP START] Check error:", err.message);
      }
    };

    // Call directly (no setTimeout delay)
    restoreGlobalsAndCheckTracking();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => activateKeepAwake(), 500);
      return () => {
        clearTimeout(timer);
        deactivateKeepAwake();
      };
    }, [])
  );

  const sosSendingRef = useRef(false);
  const sosActiveRef = useRef(false);

  // Function to clear SOS state (for future use)
  const clearSOSState = useCallback(() => {
    sosActiveRef.current = false;
    global.bgSosActive = false;
    console.log("[SOS STATE] Cleared - resuming tracking");
  }, []);

  // Auto-resume tracking when SOS is acknowledged (polling fallback)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!busId || !global.bgSosActive) return;

      // Prevent overlapping requests
      if (isCheckingSOS) return;
      isCheckingSOS = true;

      // Track request for staleness check
      const requestId = ++lastRequestId;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const res = await fetch(
          `${API_BASE_URL}/api/sos/status?busId=${encodeURIComponent(busId)}&t=${Date.now()}`,
          {
            signal: controller.signal,
            headers: {
              "Cache-Control": "no-cache"
            }
          }
        );

        // Status guard
        if (!res.ok) {
          console.warn("[SOS CHECK] Request failed:", res.status);
          return;
        }

        // Safe parse
        const text = await res.text();

        let data;
        try {
          data = JSON.parse(text);
        } catch {
          console.warn("[SOS CHECK] Non-JSON response, skipping");
          return;
        }

        // Ignore stale responses
        if (requestId !== lastRequestId) {
          console.log("[SOS CHECK] Stale response ignored");
          return;
        }

        // Use single truth
        if (data.active) {
          console.log("[SOS CHECK] Active SOS detected");
        } else {
          console.log("[SOS CHECK] No active SOS");
        }

        // Use normalized schema ONLY
        if (!data.active && global.bgSosActive) {
          console.log("[SOS STATE] Backend cleared - resuming tracking");
          global.bgSosActive = false;
          sosActiveRef.current = false;
        }
      } catch (err) {
        console.warn("[SOS CHECK] Request timeout or failed");
      } finally {
        clearTimeout(timeout);
        // GUARANTEED reset (only place allowed)
        isCheckingSOS = false;
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [busId]);

  // Real-time SOS clear via Socket.IO (primary method)
  useEffect(() => {
    const socket = io(API_BASE_URL);

    socket.on("sos:cleared", () => {
      console.log("[SOS STATE] Realtime resume");

      global.bgSosActive = false;
      sosActiveRef.current = false;
    });

    return () => socket.disconnect();
  }, []);

  const sendEmergency = useCallback(async () => {
    // Prevent concurrent SOS calls
    if (sosSendingRef.current) {
      console.log("[EMERGENCY] Already sending, ignoring duplicate");
      return;
    }

    // Check location available
    if (!currentLocation) {
      console.log("[EMERGENCY] No location available");
      setStatus("Location not available");
      return;
    }

    sosSendingRef.current = true;
    console.log("[EMERGENCY] Starting SOS send...");

    const endpoint = `${API_BASE_URL}/api/sos`;
    let response = null;  // Track for finally block

    try {
      console.log("[EMERGENCY] Attempting endpoint:", endpoint);

      const requestBody = {
        busId,
        timestamp: new Date().toISOString(),
        type: "emergency",
        location: currentLocation || null,
      };

      console.log("[EMERGENCY] Request body:", JSON.stringify(requestBody, null, 2));

      const headers = {
        "Content-Type": "application/json",
      };

      // Only add Authorization if token exists
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        console.log("[EMERGENCY] Using token:", token.substring(0, 10) + "...");
      } else {
        console.log("[EMERGENCY] No token - sending without auth");
      }

      console.log("[EMERGENCY] Headers:", JSON.stringify(headers, null, 2));

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      console.log("[EMERGENCY] Response status:", response.status);
      console.log("[EMERGENCY] Response headers:", response.headers.get('content-type'));

      const raw = await response.text();
      console.log("[EMERGENCY] Raw response:", raw.substring(0, 500));

      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
        console.log("[EMERGENCY] Parsed response:", data);
      } catch (parseError) {
        console.log("[EMERGENCY] JSON parse error:", parseError.message);
      }

      if (response.ok) {
        console.log("[EMERGENCY] SUCCESS via:", endpoint);
        setStatus("Emergency reported successfully");
        
        // Activate SOS freeze state
        sosActiveRef.current = true;
        global.bgSosActive = true;
        console.log("[SOS STATE] Activated - stopping location updates");
        
        // Keep flag true briefly to prevent immediate re-trigger
        setTimeout(() => {
          sosSendingRef.current = false;
          console.log("[EMERGENCY] Ready for next SOS");
        }, 3000);
        return; // Success - exit function
      }

      // Not OK but got response
      console.log("[EMERGENCY] Endpoint failed:", endpoint, "Status:", response.status);
      setStatus("Network issue: " + (data?.message || `HTTP ${response.status}`));

    } catch (error) {
      console.log("[EMERGENCY] ERROR:", error);

      if (error && error.message) {
        console.log("[EMERGENCY] Message:", error.message);
        setStatus("Error: " + error.message);
      } else {
        console.log("[EMERGENCY] Unknown error");
        setStatus("Unexpected error occurred");
      }
    } finally {
      // Ensure flag is cleared on error path (success already has timeout)
      if (!response || !response.ok) {
        sosSendingRef.current = false;
      }
    }
  }, [token, busId, currentLocation]);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Driver Live Tracking</Text>
      <TextInput style={styles.input} value={busId} onChangeText={setBusId} placeholder="Bus ID" />
      <View style={styles.row}>
        <Pressable style={styles.startButton} onPress={startTracking}>
          <Text style={styles.actionText}>START TRACKING</Text>
        </Pressable>
        <View style={styles.stopButton}>
          <Button title="STOP" onPress={stopTracking} />
        </View>
      </View>
      <Pressable style={styles.emergencyButton} onPress={sendEmergency}>
        <Text style={styles.emergencyText}>[SOS] BUS BREAKDOWN</Text>
      </Pressable>
      <Text style={styles.note}>Tracking: {isTracking ? (isOnline ? "● Online" : "● Offline") : "Paused"}</Text>
      <Text style={styles.note}>Location: {currentLocation ? `${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}` : "No GPS yet"}</Text>
      {queueCount > 0 && (
        <Text style={styles.queueText}>Queued updates: {queueCount}</Text>
      )}
      <Text style={[styles.status, isOnline ? styles.online : styles.offline]}>{status}</Text>
      <Text style={styles.note}>Battery: Optimized (10m min distance)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    gap: 12,
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  startButton: {
    flex: 1,
    backgroundColor: "#16a34a",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  stopButton: {
    flex: 1,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  actionText: {
    color: "#fff",
    fontWeight: "700",
  },
  emergencyButton: {
    backgroundColor: "#991b1b",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  emergencyText: {
    color: "#fff",
    fontWeight: "700",
  },
  status: {
    marginTop: 8,
    fontWeight: "600",
  },
  online: {
    color: "#16a34a",
  },
  offline: {
    color: "#dc2626",
  },
  queueText: {
    color: "#f59e0b",
    fontWeight: "600",
    fontSize: 14,
  },
  note: {
    color: "#666",
  },
});
