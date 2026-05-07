import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { useNavigation } from "@react-navigation/native";
import { fetchNearbyBuses, expandBusData } from "./api/busApi";
import { useBus } from "./BusContext";
import Speedometer from "./components/Speedometer";

const API_BASE_URL = "https://bus-tracking-backend-6htm.onrender.com";
const DEFAULT_CENTER = { latitude: 13.1044, longitude: 79.9079 };

// Nearest Bus Stop Card Component
const BusStopCard = ({ stopName, distance, nextBusTime, onPress }) => (
  <TouchableOpacity style={styles.stopCard} onPress={onPress}>
    <View style={styles.stopIconContainer}>
      <Text style={styles.stopIcon}>🚏</Text>
    </View>
    <View style={styles.stopInfo}>
      <Text style={styles.stopName}>{stopName}</Text>
      <Text style={styles.stopDistance}>{distance} away</Text>
      <Text style={styles.nextBus}>Next bus: {nextBusTime}</Text>
    </View>
    <Text style={styles.chevron}>›</Text>
  </TouchableOpacity>
);

// Mini Map Component - VIEW ONLY
const MiniMap = ({ webViewRef, setWebViewReady, onPress, buses, userLocation, followBusId, setFollowBusId, busStops, showNearestRoute, setShowNearestRoute }) => {
  const mapHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    html, body, #map { height: 100%; margin: 0; }

    /* Beacon pulse animation - Google Maps style */
    .beacon-container { position: relative; }
    .beacon-dot {
      width: 12px;
      height: 12px;
      background: #007AFF;
      border-radius: 50%;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 2;
    }
    .beacon-pulse {
      width: 40px;
      height: 40px;
      background: rgba(0,122,255,0.3);
      border-radius: 50%;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      animation: pulse-ring 1.5s ease-out infinite;
      z-index: 1;
    }
    @keyframes pulse-ring {
      0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }

    /* Modern Popup Styles */
    .bus-popup { padding: 12px; min-width: 160px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .bus-popup-header { font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #333; }
    .bus-popup-row { font-size: 12px; color: #666; margin: 4px 0; }

    /* Toggle Switch */
    .follow-toggle { display: flex; align-items: center; margin-top: 8px; cursor: pointer; }
    .follow-toggle input { display: none; }
    .toggle-slider {
      width: 40px; height: 20px; background: #ccc; border-radius: 10px;
      position: relative; transition: 0.3s; margin-right: 8px;
    }
    .toggle-slider::after {
      content: ''; position: absolute; width: 16px; height: 16px;
      background: white; border-radius: 50%; top: 2px; left: 2px;
      transition: 0.3s;
    }
    .follow-toggle input:checked + .toggle-slider { background: #007AFF; }
    .follow-toggle input:checked + .toggle-slider::after { left: 22px; }
    .toggle-label { font-size: 12px; color: #333; }

    /* Modern Bus Stop Marker */
    .bus-stop-marker {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .bus-stop-icon {
      width: 28px;
      height: 28px;
      background: white;
      border: 2px solid #333;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      font-size: 14px;
    }
    .bus-stop-label {
      background: white;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      margin-top: 4px;
      white-space: nowrap;
      max-width: 80px;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
      color: #333;
    }
    .bus-stop-highlighted {
      background: #007AFF;
      border-color: #0051D5;
      width: 36px;
      height: 36px;
      font-size: 18px;
      box-shadow: 0 4px 12px rgba(0,122,255,0.4);
    }
    .bus-stop-highlighted-label {
      background: #007AFF;
      color: white;
    }
  </style>
</head>
<body>
  <div id="map" style="height:100vh;"></div>
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    // Wrap ALL logic inside DOMContentLoaded to ensure Leaflet + DOM are ready
    document.addEventListener("DOMContentLoaded", function() {
      console.log("[WEBVIEW] DOMContentLoaded - Initializing map...");

      // 1. CREATE MAP FIRST (all default controls disabled)
      var map = L.map('map', {
        zoomControl: false,
        attributionControl: false
      }).setView([13.0827, 80.2707], 13);
      window.map = map; // Expose globally

      // 2. REMOVE ANY INJECTED LAYER CONTROLS (safeguard)
      setTimeout(function() {
        document.querySelectorAll('.leaflet-control-layers').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.leaflet-control-attribution').forEach(function(el) { el.remove(); });
      }, 0);

      // 3. ADD TILE LAYER
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      // 3a. CREATE PANES FOR PROPER Z-ORDERING
      // Bus stops below buses for clean layering
      map.createPane('busStopsPane');
      map.getPane('busStopsPane').style.zIndex = 400;
      
      map.createPane('busesPane');
      map.getPane('busesPane').style.zIndex = 500;
      
      // Popup panes (above markers)
      map.createPane('busStopsPopupPane');
      map.getPane('busStopsPopupPane').style.zIndex = 600;
      
      map.createPane('busPopupPane');
      map.getPane('busPopupPane').style.zIndex = 650;

      // 3b. CREATE GLOBALS AFTER MAP EXISTS
      window.__MAP_READY__ = false;
      window.__MAP_READY_SENT__ = false;
      window.__BUS_LISTENER_ATTACHED__ = false;
      window.__pendingBusStopRender = false;
      window.busMarkers = {};
      window.userMarker = null;
      window.userPulse = null;
      window.__busStops = [];
      window.__busStopMarkers = {};
      window.__stopBusMap = {}; // stopId → [busIds]
      window.__highlightedStopId = null; // Currently highlighted stop
      window.__lastNearestDistance = Infinity; // For hysteresis
      window.__nearestRouteLayer = null; // Polyline for nearest stop route
      window.__showNearestRoute = false; // Route toggle state

      // Bus stop icon
      function createStopIcon(name) {
        return L.divIcon({
          html: '<div class="bus-stop-marker">' +
            '<div class="bus-stop-icon">🛑</div>' +
            '<div class="bus-stop-label">' + (name || 'Stop') + '</div>' +
            '</div>',
          className: '',
          iconSize: [80, 60],
          iconAnchor: [40, 60]
        });
      }

      // Haversine distance in meters
      function haversine(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
      }

      // Compute nearest stop for each bus (50m threshold)
      function computeStopBusMapping(buses) {
        if (!buses || !window.__busStops) return;

        // Reset mapping
        window.__stopBusMap = {};

        buses.forEach(function(bus) {
          if (!bus || !bus.lat || !bus.lng || !bus.busId) return;

          let nearestStop = null;
          let minDistance = Infinity;

          window.__busStops.forEach(function(stop) {
            if (!stop.id || !stop.lat || !stop.lng) return;

            const distance = haversine(bus.lat, bus.lng, stop.lat, stop.lng);

            if (distance < minDistance && distance < 50) { // 50m threshold
              minDistance = distance;
              nearestStop = stop;
            }
          });

          if (nearestStop) {
            if (!window.__stopBusMap[nearestStop.id]) {
              window.__stopBusMap[nearestStop.id] = [];
            }
            window.__stopBusMap[nearestStop.id].push(bus.busId);
          }
        });
      }

      // Update stop popup with buses
      function updateStopPopups() {
        Object.keys(window.__busStopMarkers).forEach(function(stopId) {
          const marker = window.__busStopMarkers[stopId];
          if (!marker) return;

          const busIds = window.__stopBusMap[stopId] || [];
          const stopName = marker.__stopName || 'Bus Stop';

          let content = '<b>' + stopName + '</b><br>';

          if (busIds.length > 0) {
            content += '<span style="font-size:12px;color:#666;">Buses: ' + busIds.length + '</span>';
          } else {
            content += '<span style="font-size:12px;color:#999;">No buses nearby</span>';
          }

          if (marker.getPopup()) {
            marker.setPopupContent(content);
          }
        });
      }

      // Highlight nearest stop to user
      function highlightNearestStop(userLat, userLng) {
        if (!window.__busStops || !window.__busStops.length) return;

        let nearestStop = null;
        let minDistance = Infinity;

        window.__busStops.forEach(function(stop) {
          if (!stop.id || !stop.lat || !stop.lng) return;

          const distance = haversine(userLat, userLng, stop.lat, stop.lng);

          if (distance < minDistance && distance < 500) { // 500m threshold
            minDistance = distance;
            nearestStop = stop;
          }
        });

        // Hysteresis: only change if distance changed by >20m
        if (nearestStop) {
          const distanceChange = Math.abs(minDistance - window.__lastNearestDistance);

          if (nearestStop.id !== window.__highlightedStopId && distanceChange > 20) {
            // Reset previous highlight
            if (window.__highlightedStopId && window.__busStopMarkers[window.__highlightedStopId]) {
              const prevMarker = window.__busStopMarkers[window.__highlightedStopId];
              const prevStopName = prevMarker.__stopName || 'Stop';
              prevMarker.setIcon(createStopIcon(prevStopName));
            }

            // Highlight new stop
            if (window.__busStopMarkers[nearestStop.id]) {
              const marker = window.__busStopMarkers[nearestStop.id];
              marker.setIcon(L.divIcon({
                html: '<div class="bus-stop-marker">' +
                  '<div class="bus-stop-icon bus-stop-highlighted">🛑</div>' +
                  '<div class="bus-stop-label bus-stop-highlighted-label">' + nearestStop.name + '</div>' +
                  '</div>',
                className: '',
                iconSize: [80, 60],
                iconAnchor: [40, 60]
              }));
            }

            window.__highlightedStopId = nearestStop.id;
            window.__lastNearestDistance = minDistance;
            console.log("[WEBVIEW] Highlighted nearest stop:", nearestStop.name, "Distance:", minDistance.toFixed(0) + "m");
          }
        } else {
          // Reset highlight if no stop within 500m
          if (window.__highlightedStopId && window.__busStopMarkers[window.__highlightedStopId]) {
            const prevMarker = window.__busStopMarkers[window.__highlightedStopId];
            const prevStopName = prevMarker.__stopName || 'Stop';
            prevMarker.setIcon(createStopIcon(prevStopName));
            window.__highlightedStopId = null;
            window.__lastNearestDistance = Infinity;
          }
        }
      }

      // Update nearest route polyline
      function updateNearestRoute(lat, lng) {
        if (!window.map) return;

        if (!window.__busStops || window.__busStops.length === 0) {
          console.log("[WEBVIEW] No bus stops available");
          return;
        }

        let nearest = null;
        let minDist = Infinity;

        window.__busStops.forEach(stop => {
          if (!stop.lat || !stop.lng) return;

          const d = Math.sqrt(
            Math.pow(stop.lat - lat, 2) +
            Math.pow(stop.lng - lng, 2)
          );

          if (d < minDist) {
            minDist = d;
            nearest = stop;
          }
        });

        if (!nearest) {
          console.log("[WEBVIEW] No nearest stop found");
          return;
        }

        console.log("[WEBVIEW] Nearest stop:", nearest.name);

        if (window.__nearestRouteLayer) {
          window.map.removeLayer(window.__nearestRouteLayer);
        }

        window.__nearestRouteLayer = L.polyline(
          [[lat, lng], [nearest.lat, nearest.lng]],
          {
            color: '#007AFF',
            weight: 4,
            dashArray: '8, 8'
          }
        ).addTo(window.map);
      }

      // Render bus stops
      function renderBusStops() {
        if (!window.map || !window.__busStops) return;

        const zoom = window.map.getZoom();

        if (zoom < 14) {
          Object.values(window.__busStopMarkers).forEach(m => {
            if (window.map.hasLayer(m)) window.map.removeLayer(m);
          });
          return;
        }

        window.__busStops.forEach(stop => {
          if (!stop.id || !stop.lat || !stop.lng) return;

          let marker = window.__busStopMarkers[stop.id];

          if (!marker) {
            marker = L.marker([stop.lat, stop.lng], {
              icon: createStopIcon(stop.name),
              pane: 'busStopsPane'
            }).addTo(window.map);

            marker.__stopName = stop.name;
            marker.bindPopup(
              '<b>' + stop.name + '</b><br><span style="font-size:12px;color:#999;">Loading...</span>'
            );

            window.__busStopMarkers[stop.id] = marker;
          } else {
            marker.setLatLng([stop.lat, stop.lng]);
            if (!window.map.hasLayer(marker)) marker.addTo(window.map);
          }
        });
      }

      // Zoom handler
      window.map.on("zoomend", function() {
        renderBusStops();
      });

      // 4. MAP READY HANDLER
      function sendMapReady() {
        if (window.__MAP_READY_SENT__) return;
        if (!window.ReactNativeWebView) {
          console.log("[WEBVIEW] ReactNativeWebView not available");
          return;
        }
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: "MAP_READY" })
        );
        window.__MAP_READY_SENT__ = true;
        console.log("[WEBVIEW] MAP_READY sent");
      }

      // 5. WHEN MAP IS ACTUALLY READY
      map.whenReady(function() {
        window.__MAP_READY__ = true;
        console.log("[WEBVIEW] Map is ready");
        
        // Process any pending bus stop render
        if (window.__pendingBusStopRender && window.__busStops && window.__busStops.length) {
          console.log("[WEBVIEW] Processing pending bus stop render");
          window.__pendingBusStopRender = false;
          if (window.renderBusStops) window.renderBusStops();
        }
        
        sendMapReady();
      });

      // 6. FALLBACK TIMEOUT
      setTimeout(function() {
        if (!window.__MAP_READY_SENT__) {
          console.log("[WEBVIEW] Fallback timeout - forcing MAP_READY");
          window.__MAP_READY__ = true;
          sendMapReady();
        }
      }, 1500);

      // 7. MESSAGE HANDLER
      function handleMessage(event) {
        try {
          if (!event || !event.data) return;

          var data;
          try {
            data = JSON.parse(event.data);
          } catch (e) {
            console.log("[WEBVIEW] JSON parse error:", e.message);
            return;
          }

          console.log("[WEBVIEW] Received:", data.type);

          switch (data.type) {
            case "USER_LOCATION":
              if (!window.map) return;
              console.log("[WEBVIEW] USER_LOCATION received:", data.payload);
              const lat = data.payload?.lat;
              const lng = data.payload?.lng;
              if (lat != null && lng != null) {
                setUserLocation(Number(lat), Number(lng));
                highlightNearestStop(Number(lat), Number(lng));
                
                // Store user location for route drawing
                window.__lastUserLocation = {
                  lat: Number(lat),
                  lng: Number(lng)
                };
                
                if (window.__showNearestRoute) {
                  updateNearestRoute(Number(lat), Number(lng));
                }
              }
              break;

            case "TOGGLE_NEAREST_ROUTE":
              window.__showNearestRoute = data.enabled;
              console.log("[WEBVIEW] Toggle:", window.__showNearestRoute);
              console.log("[WEBVIEW] Stops:", window.__busStops?.length);
              console.log("[WEBVIEW] Last location:", window.__lastUserLocation);
              
              if (!data.enabled) {
                if (window.__nearestRouteLayer) {
                  window.map.removeLayer(window.__nearestRouteLayer);
                  window.__nearestRouteLayer = null;
                }
              } else {
                // CRITICAL: draw immediately using last location
                if (window.__lastUserLocation) {
                  updateNearestRoute(
                    window.__lastUserLocation.lat,
                    window.__lastUserLocation.lng
                  );
                }
              }
              break;

            case "FOLLOW_UPDATE":
              window.__followBusId = data.busId || null;
              console.log("[WEBVIEW] FOLLOW_UPDATE:", window.__followBusId);
              break;

            case "ZOOM_IN":
              if (window.map) window.map.zoomIn();
              break;

            case "ZOOM_OUT":
              if (window.map) window.map.zoomOut();
              break;

            case "RECENTER":
              if (window.map && window.userMarker) {
                window.__isProgrammaticMove = true;
                const pos = window.userMarker.getLatLng();
                window.map.flyTo(pos, 15, { duration: 0.5 });
              }
              break;

            case "INIT_BUS_STOPS":
              if (!Array.isArray(data.stops)) {
                console.log("[WEBVIEW] Invalid INIT_BUS_STOPS");
                return;
              }
              window.__busStops = data.stops;

              if (window.map) {
                renderBusStops();
              } else {
                setTimeout(function() {
                  if (window.map) renderBusStops();
                }, 300);
              }
              break;

            case "BUS_OFFLINE":
              if (data.busId && window.busMarkers[data.busId]) {
                if (window.map && window.map.removeLayer) {
                  window.map.removeLayer(window.busMarkers[data.busId]);
                }
                delete window.busMarkers[data.busId];
                if (window.followBusId === data.busId) {
                  window.followBusId = null;
                  if (window.userLocation && window.map && window.map.panTo) {
                    window.map.panTo([window.userLocation.lat, window.userLocation.lng], { animate: true });
                  }
                }
              }
              break;

            case "BUS_LOCATION_UPDATE":
              if (!data || !data.busId) return;
              updateBusMarker(data);
              break;

            case "BUS_UPDATE":
              if (!Array.isArray(data.buses)) {
                console.log("[WEBVIEW] Invalid BUS_UPDATE");
                return;
              }

              // Process buses
              data.buses.forEach(function(bus) {
                if (!bus || !bus.busId) return;
                if (!bus.lat || !bus.lng) return;

                var marker = window.busMarkers[bus.busId];
                if (marker) {
                  marker.setLatLng([bus.lat, bus.lng]);
                  if (bus.lastUpdate) marker._ts = bus.lastUpdate;
                } else {
                  var busIcon = L.divIcon({
                    className: "bus-marker",
                    html: '<div style="font-size:24px;">🚌</div>',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                  });
                  var newMarker = L.marker([bus.lat, bus.lng], { icon: busIcon, pane: 'busesPane' }).addTo(window.map);
                  if (bus.lastUpdate) newMarker._ts = bus.lastUpdate;
                  window.busMarkers[bus.busId] = newMarker;
                }
              });

              // Compute stop-bus mapping and update popups
              computeStopBusMapping(data.buses);
              updateStopPopups();

              // Cleanup stale markers (not in current update)
              // Skip cleanup when data is empty to prevent markers from disappearing
              if (data.buses.length > 0) {
                var currentIds = {};
                data.buses.forEach(function(b) { if (b && b.busId) currentIds[b.busId] = true; });
                Object.keys(window.busMarkers).forEach(function(id) {
                  if (!currentIds[id]) {
                    if (window.map && window.map.removeLayer) {
                      window.map.removeLayer(window.busMarkers[id]);
                    }
                    delete window.busMarkers[id];
                  }
                });
              }

              console.log("[WEBVIEW] Active buses:", Object.keys(window.busMarkers).length);
              break;

            default:
              console.log("[WEBVIEW] Unknown type:", data.type);
          }
        } catch (e) {
          console.log("[WEBVIEW] Handler error:", e.message);
        }
      }

      // 8. ATTACH LISTENERS
      if (!window.__BUS_LISTENER_ATTACHED__) {
        window.__BUS_LISTENER_ATTACHED__ = true;
        document.addEventListener("message", handleMessage);
        window.addEventListener("message", handleMessage);
        console.log("[WEBVIEW] Listeners attached");
      }

      // UNIFIED SET USER LOCATION (with CSS pulse - zoom independent)
      function setUserLocation(lat, lng) {
        if (!window.map) return;

        const pos = [lat, lng];
        window.userLocation = { lat, lng };

        // Marker (create once)
        if (!window.userMarker) {
          window.userMarker = L.circleMarker(pos, {
            radius: 6,
            color: "#007AFF",
            fillColor: "#007AFF",
            fillOpacity: 1,
          }).addTo(window.map);

          window.userMarker.bindPopup("📍 I am here");
        } else {
          window.userMarker.setLatLng(pos);
        }

        // CSS Pulse marker (create once) - zoom independent divIcon
        if (!window.userPulse) {
          const pulseIcon = L.divIcon({
            className: 'beacon-container',
            html: '<div class="beacon-dot"></div><div class="beacon-pulse"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });
          window.userPulse = L.marker(pos, { icon: pulseIcon, zIndexOffset: -100 }).addTo(window.map);
        } else {
          window.userPulse.setLatLng(pos);
        }
      }

      // SINGLE POPUP GENERATOR with toggle switch
      // NOTE: Speed removed - now shown in React Native Speedometer overlay only
      function getBusPopup(bus) {
        const isFollowing = window.__followBusId === bus.id;
        const checkedAttr = isFollowing ? 'checked' : '';
        const labelText = isFollowing ? 'Following' : 'Follow';
        return '<div class="bus-popup">' +
          '<div class="bus-popup-header">' + (bus.name || "Bus") + '</div>' +
          '<label class="follow-toggle">' +
            '<input type="checkbox" ' + checkedAttr + ' data-bus-id="' + bus.id + '">' +
            '<span class="toggle-slider"></span>' +
            '<span class="toggle-label">' + labelText + '</span>' +
          '</label>' +
        '</div>';
      }

      // UPDATE BUS POPUP (keeps popup in sync with bus data)
      function updateBusPopup(marker, bus) {
        if (!marker || !marker.getPopup()) return;
        
        // Update popup content with latest data
        marker.setPopupContent(getBusPopup(bus));
        
        // If following this bus, ensure popup stays open
        if (window.__followBusId === (bus.busId || bus.id)) {
          if (!marker.getPopup().isOpen()) {
            marker.openPopup();
          }
        }
      }

      // TOGGLE FOLLOW with optimistic UI update
      window.toggleFollow = function(busId) {
        // Optimistic update: toggle immediately
        const wasFollowing = window.__followBusId === busId;
        window.__followBusId = wasFollowing ? null : busId;

        // Update popup content immediately if open
        const marker = window.busMarkers[busId];
        if (marker && marker.getPopup()?.isOpen() && marker.__busData) {
          marker.setPopupContent(getBusPopup(marker.__busData));
        }

        // If unfollowing, close the popup
        if (wasFollowing && marker) {
          marker.closePopup();
        }

        // Send final follow state to React Native (not toggle)
        window.ReactNativeWebView.postMessage(
          JSON.stringify({
            type: "SET_FOLLOW",
            busId: window.__followBusId, // null if unfollowing, or busId if following
          })
        );
      };

      // RECENTER FUNCTION
      function recenterToUser() {
        if (!window.map || !window.userMarker) return;
        window.__isProgrammaticMove = true;
        const pos = window.userMarker.getLatLng();
        window.map.flyTo(pos, 15, { duration: 0.5 });
      }

      // DRAG DETECTION - only trigger for user-initiated drags, not programmatic flyTo
      window.__userDragging = false;
      window.__isProgrammaticMove = false;

      window.map.on("dragstart", () => {
        // Only send FOLLOW_STOPPED if this is a user-initiated drag
        if (!window.__isProgrammaticMove && window.__followBusId) {
          window.__userDragging = true;
          window.ReactNativeWebView.postMessage(
            JSON.stringify({
              type: "FOLLOW_STOPPED",
              reason: "USER_DRAG",
            })
          );
        }
      });

      window.map.on("moveend", () => {
        window.__isProgrammaticMove = false;
        setTimeout(() => {
          window.__userDragging = false;
        }, 100);
      });

      // POPUP EVENT DELEGATION - Handle checkbox clicks safely
      document.addEventListener('click', function(e) {
        const checkbox = e.target.closest('.bus-popup input[type="checkbox"]');
        if (checkbox) {
          const busId = checkbox.getAttribute('data-bus-id');
          if (busId) {
            window.toggleFollow(busId);
          }
        }
      });

      // MAP CLICK HANDLER - Close popup only if not following
      window.map.on("click", () => {
        // Only close popup if not following (follow mode keeps popup open)
        if (!window.__followBusId) {
          window.map.closePopup();
        }
      });

      // UPDATE BUS MARKER (no recreation)
      window.__followBusId = null;
      window.__userDragging = false;
      window.__lastFlyTo = 0;

      function updateBusMarker(data) {
        if (!window.map || !data.busId) return;
        if (!data.lat || !data.lng) return;

        const busId = data.busId;
        const lat = data.lat;
        const lng = data.lng;
        const speed = data.speed ?? 0;

        const busData = {
          id: busId,
          name: data.name || busId,
          speed: speed,
          eta: data.eta,
        };

        if (!window.busMarkers[busId]) {
          // CREATE NEW MARKER
          const marker = L.marker([lat, lng]).addTo(window.map);

          // Bind popup with persistent settings (autoClose: false, closeOnClick: false)
          marker.bindPopup(getBusPopup(busData), {
            autoClose: false,
            closeOnClick: false
          });
          window.busMarkers[busId] = marker;
        }

        // Store full bus data on marker for optimistic updates
        const marker = window.busMarkers[busId];
        marker.__busData = busData;

        // Update position
        marker.setLatLng([lat, lng]);

        // Update popup content (keeps popup in sync with moving bus)
        updateBusPopup(marker, busData);

        // CAMERA FOLLOW (throttled 1000ms for smooth following)
        if (
          window.__followBusId === busId &&
          !window.__userDragging &&
          Date.now() - window.__lastFlyTo > 1000
        ) {
          window.__lastFlyTo = Date.now();
          window.__isProgrammaticMove = true;

          window.map.flyTo([lat, lng], window.map.getZoom(), {
            duration: 0.5,
          });
        }
      }

      // BUS_UPDATE handler (batch update)
      window.__busUpdatePending = null;
      function handleBusUpdate(buses) {
        if (!Array.isArray(buses)) return;
        buses.forEach(function(bus) {
          if (!bus || !bus._id) return;
          updateBusMarker({
            busId: bus._id,
            latitude: bus.lat ?? bus.latitude,
            longitude: bus.lng ?? bus.longitude,
            speed: bus.speed ?? 0,
            name: bus.name,
          });
        });
      }

      console.log("[WEBVIEW] Initialization complete, waiting for map...");
    });
  </script>
</body>
</html>
  `;

  // Add ref for buses to resend on MAP_READY
  const busesRef = useRef(buses);

  // Keep ref in sync with props
  useEffect(() => {
    busesRef.current = buses;
  }, [buses]);

  // Send toggle state to WebView when it changes
  useEffect(() => {
    if (!webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: "TOGGLE_NEAREST_ROUTE",
      enabled: showNearestRoute
    }));
    console.log("[RN] Toggle state sent to WebView:", showNearestRoute);
  }, [showNearestRoute]);

  // Add refs for bounds debounce
  const boundsDebounceRef = useRef(null);
  const lastBoundsRef = useRef(null);

  // Fetch stops with bounds
  const fetchStopsWithBounds = async (bounds) => {
    try {
      const url = `${API_BASE_URL}/api/bus-stops?minLat=${bounds.minLat}&maxLat=${bounds.maxLat}&minLng=${bounds.minLng}&maxLng=${bounds.maxLng}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.success && webViewRef.current) {
        const mergedStops = mergeStops(data.stops);
        webViewRef.current.postMessage(JSON.stringify({
          type: "INIT_BUS_STOPS",
          stops: mergedStops
        }));
        console.log("[RN] Fetched stops with bounds:", data.count, "merged:", mergedStops.length);
      }
    } catch (error) {
      console.log("[RN] Bounds fetch error:", error.message);
    }
  };

  // Static bus stops (manual coordinates)
  const STATIC_STOPS = [
    // VELLORE DISTRICT
    { id: "vellore_1", name: "Vellore New Bus Station", lat: 12.9346, lng: 79.1366 },
    { id: "vellore_2", name: "Vellore Old Bus Stand", lat: 12.9223, lng: 79.1325 },
    { id: "vellore_3", name: "Vellore Smart City Bus Stand", lat: 12.9347, lng: 79.1376 },
    { id: "vellore_4", name: "CMC Jubilee Gate", lat: 12.9245, lng: 79.1376 },
    { id: "vellore_5", name: "Vallalar Bus Stop", lat: 12.9383, lng: 79.1669 },
    { id: "vellore_6", name: "Thottapalayam Bus Stand", lat: 12.9244, lng: 79.1273 },
    { id: "vellore_7", name: "TNSTC Depot Vellore", lat: 12.9245, lng: 79.1149 },
    { id: "vellore_8", name: "Sainathapuram Bus Stop", lat: 12.8970, lng: 79.1352 },
    { id: "vellore_9", name: "Katpadi Bus Stand", lat: 12.9672, lng: 79.1374 },
    // THIRUVALLUR DISTRICT
    { id: "tvlr_1", name: "Thiruvallur Bus Stand", lat: 13.1386, lng: 79.9076 },
    { id: "tvlr_2", name: "Thiruvallur Terminal", lat: 13.1405, lng: 79.9080 },
    { id: "tvlr_3", name: "Oil Mill Bus Stop", lat: 13.1227, lng: 79.9118 },
    { id: "tvlr_4", name: "Theradi Bus Stop", lat: 13.1433, lng: 79.9088 },
    { id: "tvlr_5", name: "Court Bus Stop", lat: 13.1370, lng: 79.9176 },
    { id: "tvlr_6", name: "Kakkalur Bus Stand", lat: 13.1227, lng: 79.9118 },
    { id: "tvlr_7", name: "Manavalanagar Bus Stop", lat: 13.1126, lng: 79.9133 },
    { id: "tvlr_8", name: "Ondikuppam Bus Stop", lat: 13.1104, lng: 79.9180 },
    { id: "tvlr_9", name: "SBI JN Road Bus Stop", lat: 13.1354, lng: 79.9087 }
  ];

  // Deduplicate stops by proximity (±0.0005)
  const mergeStops = (osmStops) => {
    if (!osmStops || !Array.isArray(osmStops)) return STATIC_STOPS;

    const merged = [...STATIC_STOPS];
    const proximityThreshold = 0.0005;

    osmStops.forEach(osmStop => {
      if (!osmStop || !osmStop.lat || !osmStop.lng) return;

      const isDuplicate = merged.some(staticStop => {
        const latDiff = Math.abs(staticStop.lat - osmStop.lat);
        const lngDiff = Math.abs(staticStop.lng - osmStop.lng);
        return latDiff < proximityThreshold && lngDiff < proximityThreshold;
      });

      if (!isDuplicate) {
        merged.push(osmStop);
      }
    });

    return merged;
  };

  // Handle MAP_READY from WebView - idempotent, always resend data
  const handleWebViewMessage = (event) => {
    try {
      if (!event || !event.nativeEvent || !event.nativeEvent.data) return;

      var data = JSON.parse(event.nativeEvent.data);
      if (!data || !data.type) return;

      // Idempotent MAP_READY handling - safe for duplicates
      if (data.type === "MAP_READY") {
        console.log("[RN MiniMap] MAP_READY received");

        // Always mark as ready (idempotent)
        setWebViewReady(true);

        // Send INIT_BUS_STOPS on MAP_READY
        if (busStops && webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "INIT_BUS_STOPS",
            stops: busStops
          }));
          console.log("[RN MiniMap] INIT_BUS_STOPS sent on MAP_READY:", busStops.length);
        }

        // Resend user location on MAP_READY (recovery mechanism)
        if (userLocation && webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "USER_LOCATION",
            payload: {
              lat: userLocation.latitude,
              lng: userLocation.longitude
            }
          }));
          console.log("[RN MiniMap] USER_LOCATION resent on MAP_READY");
        }

        // Resend FOLLOW_UPDATE on MAP_READY
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "FOLLOW_UPDATE",
            busId: followBusId
          }));
          console.log("[RN MiniMap] FOLLOW_UPDATE resent on MAP_READY:", followBusId);
        }

        // Resend BUS_UPDATE on MAP_READY
        const busesArray = busesRef.current ? Object.values(busesRef.current) : [];
        const activeBuses = busesArray.filter(bus =>
          bus && bus.busId && bus.lat && bus.lng
        );
        if (activeBuses.length > 0 && webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: "BUS_UPDATE",
            buses: activeBuses
          }));
          console.log("[RN MiniMap] BUS_UPDATE resent on MAP_READY:", activeBuses.length);
        }
      }
      
      // PING → MAP_READY recovery (optional handshake)
      if (data.type === "PING") {
        console.log("[RN MiniMap] PING received, responding with PONG");
        webViewRef.current?.postMessage(JSON.stringify({ type: "PONG" }));
      }

      // FOLLOW_STOPPED from WebView (user dragged map)
      if (data.type === "FOLLOW_STOPPED") {
        console.log("[RN MiniMap] FOLLOW_STOPPED from WebView");
        setFollowBusId(null);
        return;
      }

      // SET_FOLLOW from WebView (popup toggle - final state)
      if (data.type === "SET_FOLLOW") {
        console.log("[RN MiniMap] SET_FOLLOW from WebView:", data.busId);
        setFollowBusId(data.busId || null);
        return;
      }

      // MAP_BOUNDS from WebView (viewport changed)
      if (data.type === "MAP_BOUNDS" && data.bounds) {
        // Debounce to prevent rapid API calls
        clearTimeout(boundsDebounceRef.current);

        // Check if bounds changed significantly
        const bounds = data.bounds;
        const lastBounds = lastBoundsRef.current;
        const boundsChanged = !lastBounds ||
          Math.abs(lastBounds.minLat - bounds.minLat) > 0.01 ||
          Math.abs(lastBounds.maxLat - bounds.maxLat) > 0.01 ||
          Math.abs(lastBounds.minLng - bounds.minLng) > 0.01 ||
          Math.abs(lastBounds.maxLng - bounds.maxLng) > 0.01;

        if (boundsChanged) {
          lastBoundsRef.current = bounds;
          boundsDebounceRef.current = setTimeout(() => {
            fetchStopsWithBounds(bounds);
          }, 500); // 500ms debounce
        }
        return;
      }
    } catch (e) {
      console.log("[MiniMap] Invalid message:", event?.nativeEvent?.data, e.message);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHTML }}
        onMessage={handleWebViewMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        originWhitelist={["*"]}
        scrollEnabled={false}
        style={{ width: '100%', height: 200 }}
      />
      {/* Zoom Controls */}
      <View style={styles.zoomControls}>
        <TouchableOpacity
          style={styles.zoomButton}
          onPress={() => webViewRef.current?.postMessage(JSON.stringify({ type: "ZOOM_IN" }))}
        >
          <Text style={styles.zoomText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.zoomButton}
          onPress={() => webViewRef.current?.postMessage(JSON.stringify({ type: "ZOOM_OUT" }))}
        >
          <Text style={styles.zoomText}>−</Text>
        </TouchableOpacity>
      </View>
      {/* Recenter Button */}
      <TouchableOpacity
        style={[styles.zoomButton, { position: 'absolute', bottom: 10, left: 10, backgroundColor: '#007AFF' }]}
        onPress={() => webViewRef.current?.postMessage(JSON.stringify({ type: "RECENTER" }))}
      >
        <Text style={{ color: 'white', fontSize: 18 }}>⌖</Text>
      </TouchableOpacity>
      {/* Full Map Button */}
      <TouchableOpacity style={styles.fullMapButton} onPress={onPress}>
        <Text style={styles.fullMapText}>Full Map</Text>
      </TouchableOpacity>
      {/* Nearest Route Toggle Button - Bottom Overlay */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          right: 20,
          zIndex: 999,
          elevation: 10
        }}
      >
        <TouchableOpacity
          onPress={() => {
            setShowNearestRoute(prev => {
              const newValue = !prev;
              console.log("[RN] Toggle:", newValue);
              return newValue;
            });
          }}
          style={{
            backgroundColor: '#007AFF',
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: 'center'
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '600' }}>
            {showNearestRoute ? "Hide Nearest Stop" : "Show Nearest Stop"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const HomeScreen = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState("");
  const [userLocation, setUserLocation] = useState(DEFAULT_CENTER);
  const [showNearestRoute, setShowNearestRoute] = useState(false);
  const { buses, socket, busStops } = useBus();
  
  // Local follow state (single source of truth for this screen)
  const [followBusId, setFollowBusId] = useState(null);
  
  // Get followed bus data for speedometer
  const followedBus = followBusId ? buses[followBusId] : null;
  const [sosAlerts, setSosAlerts] = useState([]);
  const webViewRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const messageQueueRef = useRef({});
  const lastSentRef = useRef(null);
  const lastUserLocationRef = useRef(null); // Cache for resend on WebView load
  const busStopsRef = useRef(null); // Cache bus stops for resend
  const [webViewReady, setWebViewReady] = useState(false);

  // Track alerted SOS buses to prevent duplicate alerts
  const alertedSOS = useRef(new Set());

  // Send USER_LOCATION to MiniMap WebView when location changes
  useEffect(() => {
    if (!userLocation) return;

    // Cache in ref for resend on WebView load
    lastUserLocationRef.current = {
      lat: userLocation.latitude,
      lng: userLocation.longitude,
    };

    // Send to MiniMap WebView
    const msg = {
      type: "USER_LOCATION",
      payload: {
        lat: userLocation.latitude,
        lng: userLocation.longitude
      }
    };

    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(msg));
      console.log("[RN] Sent USER_LOCATION to MiniMap:", userLocation.latitude, userLocation.longitude);
    }
  }, [userLocation, webViewReady]);

  // Send FOLLOW_UPDATE to MiniMap WebView when followBusId changes
  useEffect(() => {
    const msg = {
      type: "FOLLOW_UPDATE",
      busId: followBusId,
    };

    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(msg));
      console.log("[RN] Sent FOLLOW_UPDATE to MiniMap:", followBusId);
    }
  }, [followBusId]);

  // Send BUS_UPDATE to WebView when buses change
  useEffect(() => {
    if (!webViewRef.current) {
      console.log("[RN] Skipping bus update - no WebView ref");
      return;
    }

    // Convert buses object to array and filter active buses with valid coordinates

    const busesArray = buses ? Object.values(buses) : [];

    console.log("[RN] Buses state raw:", buses);

    console.log("[RN] Buses array count:", busesArray.length);

    console.log("[RN] Buses sample:", busesArray.slice(0, 2));
    
    const activeBuses = busesArray.filter(bus =>
      bus &&
      bus.busId &&
      bus.lat &&
      bus.lng
    );
    
    console.log("[RN] Active buses for MiniMap:", activeBuses.length);

    // ORDER-INDEPENDENT + NOISE-REDUCED SIGNATURE
    const signature = activeBuses
      .slice()
      .sort((a, b) => (a.busId > b.busId ? 1 : -1))
      .map(b =>
        b.busId +
        "_" +
        b.lat.toFixed(5) +
        "_" +
        b.lng.toFixed(5)
      )
      .join("|");

    // Skip identical updates
    if (lastSentRef.current === signature) return;
    lastSentRef.current = signature;

    const payload = JSON.stringify({
      type: "BUS_UPDATE",
      buses: activeBuses,
    });

    console.log("[RN] Sending BUS_UPDATE - count:", activeBuses.length);
    console.log("[RN] Payload preview:", payload.substring(0, 200));

    // Primary send
    webViewRef.current.postMessage(payload);
    console.log("[RN] postMessage called for BUS_UPDATE");

    // Clear previous retry (prevents stacking under rapid updates)
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    // Retry with LATEST data (prevents stale resend)
    retryTimeoutRef.current = setTimeout(() => {
      const ref = webViewRef.current;
      if (!ref) return;

      const latestBusesArray = buses ? Object.values(buses) : [];
      const latestActiveBuses = latestBusesArray.filter(bus =>
        bus &&
        bus.busId &&
        bus.lat &&
        bus.lng
      );

      const latestPayload = JSON.stringify({
        type: "BUS_UPDATE",
        buses: latestActiveBuses,
      });

      ref.postMessage(latestPayload);
      console.log("[RN] Retry send active buses:", latestActiveBuses.length);
    }, 300);
  }, [buses]);

  // Socket listener for BUS_LOCATION_UPDATE with logging
  useEffect(() => {
    if (!socket) return;

    const handleBusLocationUpdate = (data) => {
      console.log("[RN HomeScreen] BUS_LOCATION_UPDATE received:", data);
    };

    socket.on("BUS_LOCATION_UPDATE", handleBusLocationUpdate);
    console.log("[RN HomeScreen] BUS_LOCATION_UPDATE listener registered");

    return () => {
      socket.off("BUS_LOCATION_UPDATE", handleBusLocationUpdate);
    };
  }, [socket]);

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Fetch bus stops once and send to WebView
  useEffect(() => {
    const fetchBusStops = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/bus-stops`);
        const data = await response.json();

        if (data.success && data.stops) {
          const mergedStops = mergeStops(data.stops);
          console.log("[RN] Fetched bus stops:", data.count, "merged:", mergedStops.length);

          // Store for resend on WebView reload
          busStopsRef.current = mergedStops;

          // Send to WebView if ready
          if (webViewRef.current && webViewReady) {
            webViewRef.current.postMessage(JSON.stringify({
              type: "INIT_BUS_STOPS",
              stops: mergedStops
            }));
          }
        }
      } catch (err) {
        console.log("[RN] Failed to fetch bus stops:", err.message);
      }
    };
    
    fetchBusStops();
  }, []); // Fetch only once on mount
  
  // Send bus stops when WebView becomes ready (if already fetched)
  useEffect(() => {
    if (webViewReady && webViewRef.current && busStopsRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: "INIT_BUS_STOPS",
        stops: busStopsRef.current
      }));
    }
  }, [webViewReady]);

  // Fetch user location
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    })();
  }, []);

  // Safe sender to WebView with deduplicated queue
  const sendToWebView = useCallback((msg) => {
    if (!webViewRef.current || !webViewReady) {
      // Store only latest per key (prevents stale replay)
      const key = msg.busId || msg.type || "default";
      messageQueueRef.current[key] = msg;
      console.log("[RN] WebView not ready, message queued:", msg.type, key);
      return;
    }
    webViewRef.current.postMessage(JSON.stringify(msg));
  }, [webViewReady]);

  // Flush queued messages when WebView becomes ready
  useEffect(() => {
    if (!webViewReady || !webViewRef.current) return;
    
    const queue = messageQueueRef.current;
    const keys = Object.keys(queue);
    if (keys.length > 0) {
      console.log("[RN] Flushing", keys.length, "queued messages");
      keys.forEach(key => {
        webViewRef.current.postMessage(JSON.stringify(queue[key]));
      });
      messageQueueRef.current = {};
    }
  }, [webViewReady]);

  // Socket listener for BUS_OFFLINE - instant marker removal
  useEffect(() => {
    if (!socket) return;

    const handleBusOffline = (busId) => {
      console.log("[RN] Bus offline:", busId);
      sendToWebView({ type: "BUS_OFFLINE", busId });
    };

    socket.on("BUS_OFFLINE", handleBusOffline);

    return () => {
      socket.off("BUS_OFFLINE", handleBusOffline);
    };
  }, [socket, sendToWebView]);

  // Convert buses object to array and filter active buses
  const busesArray = buses && typeof buses === 'object' && !Array.isArray(buses) 
    ? Object.values(buses) 
    : (buses || []);
  
  const filteredBuses = busesArray.filter(
    bus => bus && bus.trackingActive === true
  );

  // Navigate to full map
  const handleMapPress = () => {
    navigation.navigate("FullMap", {
      buses: filteredBuses,
      userLocation: userLocation
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>V-Bus</Text>
          <Text style={styles.subtitle}>Smart Campus Transport</Text>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search bus or route..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Nearest Bus Stop Card */}
        <BusStopCard
          stopName="VIT Main Gate"
          distance="200m"
          nextBusTime="2 min"
          onPress={() => console.log("Stop pressed")}
        />

        {/* Mini Map */}
        <View style={styles.mapSection}>
          <Text style={styles.sectionTitle}>Live Tracking</Text>
          <Text style={styles.busCount}>{filteredBuses.length} buses nearby</Text>
          <MiniMap
            webViewRef={webViewRef}
            setWebViewReady={setWebViewReady}
            onPress={handleMapPress}
            buses={filteredBuses}
            userLocation={userLocation}
            followBusId={followBusId}
            setFollowBusId={setFollowBusId}
            busStops={busStops}
            showNearestRoute={showNearestRoute}
            setShowNearestRoute={setShowNearestRoute}
          />
        </View>
      </ScrollView>
      
      {/* Speedometer Overlay - only visible when following a bus */}
      {followBusId && followedBus && (
        <Speedometer
          key={followBusId}
          speed={followedBus.speed}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5D7A1",
  },

  scrollView: {
    flex: 1,
  },

  header: {
    padding: 16,
    paddingTop: 40,
  },

  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#000",
  },

  subtitle: {
    fontSize: 12,
    color: "#333",
  },

  searchContainer: {
    margin: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  searchInput: {
    fontSize: 16,
  },

  stopCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  stopIconContainer: {
    marginRight: 10,
  },

  stopIcon: {                 
    fontSize: 18,
  },

  stopInfo: {
    flex: 1,
  },

  stopName: {
    fontWeight: "bold",
    fontSize: 14,
  },

  stopDistance: {
    fontSize: 12,
    color: "#666",
  },

  nextBus: {
    fontSize: 12,
    color: "#333",
  },

  chevron: {
    fontSize: 18,
  },

  mapSection: {
    marginTop: 10,
  },

  sectionTitle: {
    marginLeft: 16,
    marginBottom: 6,
    fontWeight: "bold",
    fontSize: 16,
  },

  busCount: {
    marginLeft: 16,
    fontSize: 12,
    color: "#666",
  },

  miniMap: {
    height: 180,
    margin: 16,
    borderRadius: 12,
    overflow: "hidden",
  },

  mapContainer: {
    height: 200,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },

  zoomControls: {
    position: "absolute",
    right: 8,
    top: 8,
    flexDirection: "column",
    gap: 4,
  },

  zoomButton: {
    width: 32,
    height: 32,
    backgroundColor: "white",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },

  zoomText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },

  fullMapButton: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },

  fullMapText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },

});

export default HomeScreen;
