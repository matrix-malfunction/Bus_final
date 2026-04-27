# Hybrid Real-Time Bus Tracking System (MVP)

This project is being built step-by-step with strict verification gates before moving to the next feature.

## Current structure

- `backend`
- `admin-web`
- `driver-app`
- `passenger-app`

## MVP progress

Completed and verified in order:
1. Backend setup with single MongoDB connection
2. Auth (admin/driver register and login)
3. Latest-location upsert API with hybrid GPS selection rule
4. Socket.IO real-time location broadcast
5. Passenger nearby buses API (`2km` radius)
6. Driver Expo app (login + send GPS every 5s while trip active)
7. Passenger Expo app (nearby fetch + live bus updates)
8. Admin web app basic CRUD (drivers, buses, routes/stops/schedules)

## Backend quick start

1. Copy `backend/.env.example` to `backend/.env`
2. Set your real MongoDB Atlas URI in `MONGODB_URI`
3. Set `JWT_SECRET`
4. Run:
   - `cd backend`
   - `npm install`
   - `npm run dev`

## Run admin panel

- `cd admin-web`
- `npm install`
- `npm run dev`

## Run driver app (Expo)

- `cd driver-app`
- `npm install`
- `npm run start`

## Run passenger app (Expo)

- `cd passenger-app`
- `npm install`
- `npm run start`

## Important mobile note

- In `driver-app/App.js` and `passenger-app/App.js`, replace `API_BASE_URL` with your machine LAN IP when testing on a physical phone (not `127.0.0.1`).

## Core backend endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/location/update`
- `GET /api/passenger/nearby-buses?lat=<lat>&lng=<lng>&radiusKm=2`
- `GET /api/admin/drivers` / `POST /api/admin/drivers`
- `GET /api/admin/buses` / `POST /api/admin/buses`
- `GET /api/admin/routes` / `POST /api/admin/routes`

## Verification summary

- Backend API and realtime smoke-tested with live requests and socket event checks.
- Admin CRUD endpoints tested end-to-end (create/list/update/delete).
- Driver and passenger apps compiled successfully via Expo web export.
- Admin web app compiled successfully with Vite production build.
