# CampusBoard Firebase foundation

The available `index.html` and `login.html` use the Firebase Web SDK modules from Google's CDN. `index1.html` was present during the initial audit but became unavailable in the workspace; it has intentionally not been recreated or replaced. Restore it from OneDrive version history before integrating or testing it. `firebase-config.js` contains the public Web App configuration. Firebase Admin keys, service-account files, and other private credentials do not belong in this frontend.

## Services implemented

- **Authentication:** email/password and Google popup sign-in, local persistent sessions, auth-state detection, password reset, sign-out, and email verification messages after email signup. Anonymous sign-in is not enabled.
- **Cloud Firestore:** after account creation, `users/{firebaseUid}` stores the student's visible username and basic profile fields. `usernames/{username}` reserves that username so it is unique. The Firebase UID is the internal profile key. Existing community and dashboard features still retain their localStorage data.
- **Cloud Storage:** signed-in users can upload profile pictures and banners from the existing profile settings. Files are stored under `users/{firebaseUid}/profile/avatar` or `users/{firebaseUid}/profile/banner`. Firestore stores the Storage path, not the file data.
- **CampusBoard API:** a separate FastAPI service now provides role-checked schools/classes, homework/submissions, approved parent-child links, chat requests/conversations, communities, school resources, calendar records, notifications, reports, and an optional AI proxy. Setup is documented in [`backend/README.md`](./backend/README.md).

The existing dashboard remains available when signed out and keeps its existing local planner/task features. Cloud operations use the authenticated Firebase UID and the shared CampusBoard username; records are created as each workflow is used.

## Enable the Firebase project

In the Firebase Console for `campusboard-20-11`:

1. Under **Authentication → Sign-in method**, enable **Email/Password** and **Google**. Configure the Google consent screen and authorized domains.
2. Under **Authentication → Settings → Authorized domains**, ensure `localhost` and the production Vercel domain are listed.
3. Create the **Cloud Firestore** database.
4. Enable **Cloud Storage** and create its default bucket.
5. From the project root, after `firebase login`, deploy the checked-in rules with the Firebase CLI: `firebase deploy --project campusboard-20-11 --only firestore:rules,storage`.
6. Configure a separate FastAPI host with restricted Firebase Admin credentials stored outside this project. Follow [`backend/README.md`](./backend/README.md); never place the credential JSON or AI provider key in the browser or repository.
7. Set the backend CORS allowlist to the exact local and Vercel site origins. Set `window.CAMPUSBOARD_API_BASE_URL` in `firebase-config.js` to the API origin if it is not at `http://127.0.0.1:8000`.
8. Provision a trusted initial administrator with the backend script, then provision verified roles and class assignments.
9. For local testing, serve the workspace using an HTTP server such as VS Code Live Server. Do not open HTML files via `file://`.

The Firebase Web configuration is intended for client applications. Firestore and Storage access is governed by the included rules. The Admin SDK backend requires a separate HTTPS deployment, strict IAM, and private credentials; do not add service-account JSON to the project or share private credentials.

To use the local Firebase emulators instead of the live project, start them with `firebase emulators:start --project demo-campusboard --only auth,firestore,storage` and open the local app with `?firebaseEmulator=1`. The normal project configuration leaves emulator mode off. Emulator data is separate from the live Firebase project.

## Security boundaries

Firestore user profiles are readable only by their owner. Username claims are readable individually for unique-name checks, but cannot be listed, changed, or deleted by clients. Profile updates are limited to display name, bio, interests, and profile-image paths; each user can modify only their own profile. Service-owned records are denied to direct client writes; the API verifies signed Firebase ID tokens and uses server-provisioned custom claims and membership/link records. Chat reads are limited to active participants.

Storage allows each signed-in account to read, upload, replace, or delete its own avatar/banner, chat files/audio within a conversation, and class resources only when assigned to that class. File types and sizes are constrained by the rules.

The expanded rules and API still need Emulator Suite and signed-in multi-account validation before production use.

## Local data and rollout

Existing tasks, planner data, achievements, and the existing local community remain intact. The added cloud workspace uses the API, Firestore, and Storage; it does not substitute localStorage for its cloud records. Users can continue in the existing local-only mode from `login.html`.

## Phase 1–3 verification checklist

- [x] Load the existing dashboard and login page from a local HTTP server.
- [x] Initialize Firebase and detect signed-out auth state in the browser.
- [x] Reject an unauthenticated Storage upload in the Storage emulator.
- [x] Check JavaScript and Firebase JSON syntax and verify no duplicate HTML IDs.
- [ ] Enable Google and email/password providers in the Firebase Console.
- [ ] Create real email/Google accounts and verify sessions persist across refresh.
- [ ] Test reset, logout, duplicate usernames, and profile reservation in the project or Emulator Suite.
- [ ] Test authenticated avatar/banner upload, download, and removal.
- [ ] Deploy Firestore and Storage rules and check them in Emulator Suite tests.

The Firestore emulator exited unexpectedly in this Windows environment during the prior rules check, so the expanded rules still need Emulator Suite or Firebase Console deployment verification. Auth providers, databases, Storage, service account, custom roles, AI credentials, API hosting, and CORS are operator setup steps. No authenticated multi-account end-to-end test against the live project has been performed.

## Remaining phases

The systems above are implemented in code but are **not confirmed working against the live Firebase project** until backend hosting, provider/service setup, roles, rules deployment, and multi-account tests are completed. Browser push notifications, recurring weekly timetable editing, homework attachment submissions, abuse rate limiting, and full production security/E2E verification remain outstanding. No service-account credential is included.
