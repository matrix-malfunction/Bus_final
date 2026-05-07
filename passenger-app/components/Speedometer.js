import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * Speedometer Component
 * 
 * Pure React Native component - no socket, no WebView
 * Receives speed as prop from parent (HomeScreen)
 * Visible only when followBusId is active (controlled by parent)
 * 
 * @param {number} speed - Current speed in km/h
 * @param {string} busId - Bus ID for key (ensures correct updates when switching buses)
 */
const Speedometer = ({ speed }) => {
  // Return null if speed is undefined/null
  if (speed === undefined || speed === null) {
    return null;
  }

  // Round speed to nearest integer
  const roundedSpeed = Math.round(speed);

  return (
    <View style={styles.container}>
      <View style={styles.speedContainer}>
        <Text style={styles.speedValue}>{roundedSpeed}</Text>
        <Text style={styles.speedUnit}>km/h</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100, // Position above any bottom UI elements
    left: '50%',
    transform: [{ translateX: -50 }], // Center horizontally
    zIndex: 1000,
  },
  speedContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  speedValue: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 'bold',
    marginRight: 4,
  },
  speedUnit: {
    color: '#CCCCCC',
    fontSize: 14,
    fontWeight: '500',
  },
});

export default Speedometer;
