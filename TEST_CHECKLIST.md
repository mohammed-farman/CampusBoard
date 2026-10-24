# CampusBoard test checklist

Status labels: **FUNCTIONAL** means implemented and exercised; **PARTIALLY CONFIGURED** means code exists but the live Firebase setup or end-to-end test remains; **NOT IMPLEMENTED** means this phase has not been built.

## Phase 1 — Firebase and authentication

- [x] **FUNCTIONAL:** Existing dashboard and login page load from a local HTTP server.
- [x] **FUNCTIONAL:** Firebase modules initialize and the browser reports signed-out state.
- [x] **FUNCTIONAL:** Local-only continuation remains available and existing dashboard data stays in localStorage.
- [ ] **PARTIALLY CONFIGURED:** Email/password signup and sign-in (requires Firebase provider enabled and real/emulated account test).
- [ ] **PARTIALLY CONFIGURED:** Google sign-in (requires provider, consent screen, and authorized domain).
- [ ] **PARTIALLY CONFIGURED:** Password reset and verification email (requires provider/email configuration).
- [ ] **PARTIALLY CONFIGURED:** Persistent session, logout, and auth state across refresh (requires signed-in test).
- [ ] **CONFIGURATION REQUIRED:** Custom-claim role provisioning/admin changes are implemented; a trusted first administrator must be bootstrapped before testing.

## Phase 2 — UID and username/profile

- [ ] **PARTIALLY CONFIGURED:** Firebase UID is the Firestore profile document ID.
- [ ] **PARTIALLY CONFIGURED:** Globally reserved, case-normalized CampusBoard username.
- [ ] **PARTIALLY CONFIGURED:** Existing local display name, bio, and interests seed the Firebase profile.
- [ ] **PARTIALLY CONFIGURED:** Local profile edits sync back to the Firebase profile.
- [ ] **PARTIALLY CONFIGURED:** One profile picture and banner upload/download/removal per account.
- [x] **IMPLEMENTED, NOT LIVE-TESTED:** School/class records, teacher/parent role claims, class assignments, and approved parent links are in the API.
- [ ] **NOT IMPLEMENTED:** Verified student IDs and configurable profile privacy controls.

## Phase 3 — Firestore, Storage, and rules

- [x] **FUNCTIONAL:** Unauthenticated Storage upload was rejected by the local emulator with HTTP 403.
- [x] **FUNCTIONAL:** Storage rules loaded in the local emulator; the emulator emitted a shutdown runtime warning.
- [ ] **PARTIALLY CONFIGURED:** Firestore rules: emulator startup fails in this Windows environment before the final rule test can run.
- [ ] **PARTIALLY CONFIGURED:** Authenticated upload, download, removal, and profile data rules (require enabled Firebase services and signed-in tests).
- [ ] **PARTIALLY CONFIGURED:** Deploy rules to the `campusboard-20-11` Firebase project.
- [x] **FUNCTIONAL:** No permissive catch-all reads/writes; unspecified Firestore data paths are denied.

## Cloud systems added; external setup and end-to-end validation pending

- [x] **IMPLEMENTED, NOT LIVE-TESTED:** Role-checked FastAPI routes for schools, classes, teacher assignments, and student enrollment. New accounts default to student; elevated claims require trusted provisioning.
- [x] **IMPLEMENTED, NOT LIVE-TESTED:** Cloud homework, student text submissions, teacher feedback, class announcements, and parent-approved child academic views.
- [x] **IMPLEMENTED, NOT LIVE-TESTED:** One-to-one/group chat requests and invitations, Firebase realtime message reads, Storage file/audio upload and download, blocking, reports, and in-app notifications.
- [x] **IMPLEMENTED, NOT LIVE-TESTED:** Firebase-backed communities, posts/articles, comments, polls, and class-scoped resource metadata/files.
- [x] **IMPLEMENTED, NOT LIVE-TESTED:** Cloud events/exams/timetable entries. Recurring weekly timetable editing is not implemented.
- [x] **IMPLEMENTED, CONFIGURATION REQUIRED:** FastAPI API and backend-only AI study proxy. AI returns HTTP 503 until its backend provider URL, key, and model are configured.
- [ ] **CONFIGURATION REQUIRED:** Host the API over HTTPS with Firebase Admin credentials, CORS allowlist, Firestore/Storage IAM, and the Vercel API URL.
- [ ] **CONFIGURATION REQUIRED:** Enable Auth providers, create Firestore/Storage, deploy expanded rules, provision an initial admin, then set verified teacher/parent roles.
- [ ] **NOT IMPLEMENTED:** Web push/FCM delivery, recurring timetable management, homework attachment submissions, message retention controls, and abuse rate limiting.
- [ ] **NOT VERIFIED:** Firestore/Storage emulator tests, signed-in multi-account E2E tests, Vercel deployment, and regression tests of all existing dashboard interactions.

## Browser regression checks

- [x] Dashboard navigation and task section still render.
- [x] CampusBoard account panel renders in settings without removing study preferences.
- [x] Login page exposes email/password, Google, reset, and local-only options.
- [ ] Test task creation, editing, completion, backup/import, and profile edits after Firebase sign-in.
- [ ] Test responsive layout at phone, tablet, and desktop sizes after Firebase sign-in.
- [ ] Test role boundaries, class membership, parent approval, chat requests/blocks, and community membership with separate accounts before real student use.
- [ ] Restore `index1.html` from OneDrive before running its regression tests; it was not recreated in this change.
