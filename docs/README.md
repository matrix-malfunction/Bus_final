# 🚍 V-Bus Tracking System

Real-time bus tracking system using GPS + mobile fallback.

## 📦 Tech Stack

* Backend: Node.js + Express + Socket.IO
* Passenger App: React Native (Expo) + WebView + Leaflet
* Driver App: React Native (Expo)
* Maps: Leaflet

## 🚀 Features

* Real-time bus tracking
* SOS emergency system
* Driver-based location updates
* Fallback GPS tracking (mobile)

## 📂 Project Structure

* `/backend` → API + Socket server
* `/driver-app` → Driver tracking app
* `/passenger-app` → Passenger tracking app

## ⚙️ Setup

### Backend

```bash
cd backend
npm install
npm start
```

### Passenger App

```bash
cd passenger-app
npm install
npx expo start
```

### Driver App

```bash
cd driver-app
npm install
npx expo start
```

## 🔥 Architecture

Single socket connection → shared state → WebView updates via postMessage.

## 📌 Status

Production-ready tracking with SOS support.
