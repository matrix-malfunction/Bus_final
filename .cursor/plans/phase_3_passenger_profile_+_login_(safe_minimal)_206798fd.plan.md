---
name: "Phase 3: Passenger Profile + Login (Safe Minimal)"
overview: Implement Phase 3 safely by adding backend passenger-auth endpoint files and a standalone frontend PassengerLoginScreen file, while keeping current `/api/auth/login` app flow unchanged to avoid breaking protected APIs.
todos:
  - id: phase3-add-passenger-auth-controller
    content: Create backend passenger auth controller for find-or-create login flow.
    status: pending
  - id: phase3-add-passenger-auth-route
    content: Create backend passenger auth route file exposing POST /login.
    status: pending
  - id: phase3-mount-passenger-auth-route
    content: Register passenger auth route in backend app mounting without altering existing routes behavior.
    status: pending
  - id: phase3-add-passenger-login-screen
    content: Create standalone passenger-app/screens/PassengerLoginScreen.js file using /api/passenger/login.
    status: pending
  - id: phase3-verify-safe-scope
    content: Run lint/static checks on changed files and confirm no HomeScreen/socket/business logic changes.
    status: pending
isProject: false
---



