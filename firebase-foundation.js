import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  deleteField,
  doc,
  getDoc,
  getFirestore,
  connectFirestoreEmulator,
  runTransaction,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  deleteObject,
  getBytes,
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const config = window.CAMPUSBOARD_FIREBASE_CONFIG;
const authStatus = document.getElementById("firebaseAuthStatus");
const signedOutPanel = document.getElementById("firebaseSignedOut");
const signedInPanel = document.getElementById("firebaseSignedIn");
const accountIdentity = document.getElementById("firebaseAccountIdentity");
const profileSetup = document.getElementById("firebaseProfileSetup");
const usernameInput = document.getElementById("firebaseUsername");
const displayNameInput = document.getElementById("firebaseDisplayName");
const emailInput = document.getElementById("firebaseEmail");
const passwordInput = document.getElementById("firebasePassword");
const profileUsernameInput = document.getElementById("communityUsernameSetting");
const accountError = "Firebase could not be initialized.";
const usernamePattern = /^[a-z0-9_]{3,24}$/;
const profileImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024;

let auth;
let db;
let storage;
let activeProfile = null;
let authActionPending = false;
let redirectStarted = false;
const profileObjectUrls = new Map();

function setStatus(message, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.dataset.error = String(isError);
}

function getLocalProfile() {
  try {
    const raw = localStorage.getItem("campusboard_community_v1")
      || localStorage.getItem("classconnector_v1");
    const data = raw ? JSON.parse(raw) : null;
    const activeId = data?.activeProfileId || data?.profile?.id;
    return (data?.profiles || []).find(profile => profile.id === activeId)
      || data?.profile
      || null;
  } catch (error) {
    console.warn("Could not read the existing local CampusBoard profile.", error);
    return null;
  }
}

function setIdentityFields(profile = getLocalProfile()) {
  if (usernameInput && !usernameInput.value && profile?.username) {
    usernameInput.value = String(profile.username).replace(/^@/, "").toLowerCase();
  }
  if (displayNameInput && !displayNameInput.value) {
    displayNameInput.value = profile?.name || localStorage.getItem("campusBoardName") || "";
  }
}

function normalizeUsername(value) {
  const username = String(value || "").trim().replace(/^@/, "").toLowerCase();
  if (!usernamePattern.test(username)) {
    throw new Error("Username must contain 3–24 lowercase letters, numbers, or underscores.");
  }
  return username;
}

function localCommunityData() {
  const raw = localStorage.getItem("campusboard_community_v1")
    || localStorage.getItem("classconnector_v1");
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data;
}

function applyCloudIdentity(profile) {
  try {
    const displayName = String(profile.displayName || "Student").trim() || "Student";
    localStorage.setItem("campusBoardName", displayName);
    localStorage.setItem("campusBoardStudentName", displayName);
    localStorage.setItem("campusBoardSetupDone", "true");
    localStorage.setItem("campusBoardFirebaseUsername", profile.username);

    const communityProfile = {
      ...getLocalProfile(),
      id: getLocalProfile()?.id || profile.uid,
      firebaseUid: profile.uid,
      name: displayName,
      username: profile.username,
      bio: profile.bio || "",
      interests: profile.interests || "",
      photoPath: profile.photoPath || "",
      bannerPath: profile.bannerPath || "",
      initials: displayName.trim().split(/\s+/).slice(0, 2)
        .map(part => part[0] || "").join("").toUpperCase()
    };
    const communityApplied = window.campusBoardCommunityApplyIdentity?.(communityProfile) || false;
    if (!communityApplied) {
      const data = localCommunityData();
      if (data) {
        const activeId = data.activeProfileId || data.profile?.id;
        const profiles = Array.isArray(data.profiles) ? data.profiles : [];
        const current = profiles.find(item => item.id === activeId) || data.profile || {};
        const updated = { ...current, ...communityProfile, id: activeId || communityProfile.id };
        data.profiles = profiles.some(item => item.id === updated.id)
          ? profiles.map(item => item.id === updated.id ? updated : item)
          : [...profiles, updated];
        data.profile = { ...updated };
        data.activeProfileId = updated.id;
        localStorage.setItem("campusboard_community_v1", JSON.stringify(data));
      }
    }

    const profileName = document.getElementById("profileNameSetting");
    if (profileName) profileName.value = displayName;
    if (profileUsernameInput) {
      profileUsernameInput.value = profile.username;
      profileUsernameInput.disabled = true;
      profileUsernameInput.title = "Your CampusBoard username is shared across services and cannot be changed here.";
    }
    const communityUsernameInput = document.getElementById("cc_profileUsername");
    if (communityUsernameInput) {
      communityUsernameInput.value = profile.username;
      communityUsernameInput.disabled = true;
    }
    const greeting = document.getElementById("greetingText");
    if (greeting) greeting.textContent = `Welcome back, ${displayName} 👋`;
    window.dispatchEvent(new CustomEvent("campusboard:identity-updated", { detail: profile }));
    void hydrateProfileImages(profile);
  } catch (error) {
    console.error("Firebase identity was loaded, but local profile sync failed.", error);
    setStatus("Signed in, but the local profile could not be updated. Check browser storage.", true);
  }
}

function setSignedOutState() {
  activeProfile = null;
  if (signedOutPanel) signedOutPanel.hidden = false;
  if (signedInPanel) signedInPanel.hidden = true;
  const authActions = document.getElementById("firebaseAuthActions");
  if (authActions) authActions.hidden = false;
  if (profileUsernameInput) {
    profileUsernameInput.disabled = false;
    profileUsernameInput.title = "";
  }
  document.getElementById("cc_profileUsername")?.removeAttribute("disabled");
  if (authStatus) setStatus("Not signed in. Local dashboard features remain available.");
  setIdentityFields();
}

async function createOrLoadProfile(user, usernameValue, displayNameValue) {
  const username = normalizeUsername(usernameValue);
  const displayName = String(displayNameValue || user.displayName || "").trim();
  if (!displayName || displayName.length > 50) {
    throw new Error("Enter a display name between 1 and 50 characters.");
  }

  const userRef = doc(db, "users", user.uid);
  const usernameRef = doc(db, "usernames", username);
  const localProfile = getLocalProfile();
  await runTransaction(db, async transaction => {
    const existingUser = await transaction.get(userRef);
    if (existingUser.exists()) return;

    const existingUsername = await transaction.get(usernameRef);
    if (existingUsername.exists() && existingUsername.data().uid !== user.uid) {
      throw new Error("That CampusBoard username is already taken. Choose another one.");
    }

    const now = serverTimestamp();
    if (!existingUsername.exists()) {
      transaction.set(usernameRef, { uid: user.uid, createdAt: now });
    }
    transaction.set(userRef, {
      username,
      displayName,
      bio: String(localProfile?.bio || "").slice(0, 500),
      interests: String(localProfile?.interests || "").slice(0, 200),
      createdAt: now,
      updatedAt: now
    });
  });

  const profileSnapshot = await getDoc(userRef);
  if (!profileSnapshot.exists()) {
    throw new Error("Your CampusBoard profile could not be created. Try again.");
  }
  return { uid: user.uid, ...profileSnapshot.data() };
}

async function hydrateProfileImages(profile) {
  for (const [field, contentTypeField, elementId, kind] of [
    ["photoPath", "photoContentType", "communityAvatarPreview", "avatar"],
    ["bannerPath", "bannerContentType", "communityBannerPreview", "banner"]
  ]) {
    const path = profile[field];
    if (typeof path !== "string" || !path) continue;
    try {
      const bytes = await getBytes(ref(storage, path));
      const contentType = profile[contentTypeField];
      if (!profileImageTypes.has(contentType)) {
        throw new Error("Unsupported profile image metadata.");
      }
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      const oldUrl = profileObjectUrls.get(kind);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      profileObjectUrls.set(kind, objectUrl);

      if (kind === "avatar") {
        const preview = document.getElementById(elementId);
        if (preview) {
          preview.replaceChildren();
          const image = document.createElement("img");
          image.src = objectUrl;
          image.alt = "Profile picture";
          preview.append(image);
        }
      } else {
        const preview = document.getElementById(elementId);
        if (preview) {
          preview.style.backgroundImage = `url("${objectUrl}")`;
          preview.style.backgroundColor = "transparent";
        }
      }
      window.campusBoardCommunitySetProfileImage?.(kind, objectUrl);
    } catch (error) {
      console.error(`Could not load the saved ${kind} from Firebase Storage.`, error);
      setStatus(`Profile loaded, but the saved ${kind} could not be downloaded. Check Storage rules.`, true);
    }
  }
}

async function loadAuthenticatedProfile(user) {
  const profileRef = doc(db, "users", user.uid);
  const profileSnapshot = await getDoc(profileRef);
  if (profileSnapshot.exists()) {
    return { uid: user.uid, ...profileSnapshot.data() };
  }
  return null;
}

function showAuthenticatedProfile(user, profile) {
  activeProfile = profile;
  if (signedOutPanel) signedOutPanel.hidden = true;
  if (signedInPanel) signedInPanel.hidden = false;
  if (accountIdentity) {
    accountIdentity.textContent = `Signed in as @${profile.username} · ${user.email || "Google account"}`;
  }
  if (profileSetup) profileSetup.hidden = true;
  applyCloudIdentity(profile);
  setStatus("Firebase Authentication, Firestore profile, and Storage are connected.");
  redirectAfterAuthentication();
}

function redirectAfterAuthentication() {
  const redirectTarget = document.getElementById("firebaseAuthPanel")?.dataset.redirectOnAuth;
  if (!authActionPending && !redirectStarted && redirectTarget && auth?.currentUser && activeProfile) {
    redirectStarted = true;
    window.location.replace(redirectTarget);
  }
}

function showProfileSetup(user) {
  if (signedOutPanel) signedOutPanel.hidden = false;
  if (signedInPanel) signedInPanel.hidden = false;
  const authActions = document.getElementById("firebaseAuthActions");
  if (authActions) authActions.hidden = true;
  if (accountIdentity) accountIdentity.textContent = `Signed in as ${user.email || "Google account"}.`;
  if (profileSetup) profileSetup.hidden = false;
  if (profileUsernameInput) profileUsernameInput.disabled = false;
  setIdentityFields();
  setStatus("Choose your shared CampusBoard username to finish account setup.");
}

function getEmailPassword() {
  const email = String(emailInput?.value || "").trim();
  const password = String(passwordInput?.value || "");
  if (!email || !password) throw new Error("Enter your email and password.");
  return { email, password };
}

function setBusy(isBusy) {
  document.querySelectorAll(
    "#firebaseEmailSignup, #firebaseEmailSignin, #firebaseGoogleSignin, #firebasePasswordReset, #firebaseCompleteProfile, #firebaseSignOut"
  ).forEach(button => {
    button.disabled = isBusy;
  });
}

async function withStatus(action) {
  authActionPending = true;
  setBusy(true);
  try {
    await action();
  } catch (error) {
    console.error("CampusBoard Firebase action failed.", error);
    setStatus(error?.message || "The Firebase request failed. Try again.", true);
  } finally {
    authActionPending = false;
    setBusy(false);
    redirectAfterAuthentication();
  }
}

async function createEmailAccount() {
  const username = normalizeUsername(usernameInput?.value);
  const displayName = String(displayNameInput?.value || "").trim();
  if (!displayName) throw new Error("Enter your display name.");
  const { email, password } = getEmailPassword();
  if (password.length < 8) throw new Error("Password must contain at least 8 characters.");

  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const profile = await createOrLoadProfile(credential.user, username, displayName);
  showAuthenticatedProfile(credential.user, profile);
  try {
    await sendEmailVerification(credential.user);
    setStatus(`Account created. A verification email was sent to ${email}.`);
  } catch (error) {
    console.warn("Account created, but verification email could not be sent.", error);
    setStatus("Account created. Email verification could not be sent; check Firebase email settings.", true);
  }
}

async function signInEmail() {
  const { email, password } = getEmailPassword();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const profile = await loadAuthenticatedProfile(credential.user);
  if (profile) showAuthenticatedProfile(credential.user, profile);
  else showProfileSetup(credential.user);
}

async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  const existingProfile = await loadAuthenticatedProfile(result.user);
  if (existingProfile) {
    showAuthenticatedProfile(result.user, existingProfile);
    return;
  }

  const username = String(usernameInput?.value || "").trim();
  const displayName = String(displayNameInput?.value || result.user.displayName || "").trim();
  if (username && displayName) {
    const profile = await createOrLoadProfile(result.user, username, displayName);
    showAuthenticatedProfile(result.user, profile);
  } else {
    showProfileSetup(result.user);
  }
}

async function finishProfileSetup() {
  if (!auth.currentUser) throw new Error("Sign in before setting up your profile.");
  const profile = await createOrLoadProfile(
    auth.currentUser,
    usernameInput?.value,
    displayNameInput?.value || auth.currentUser.displayName
  );
  showAuthenticatedProfile(auth.currentUser, profile);
}

async function resetPassword() {
  const email = String(emailInput?.value || "").trim();
  if (!email) throw new Error("Enter your email address first.");
  await sendPasswordResetEmail(auth, email);
  setStatus(`If a CampusBoard account exists for ${email}, a reset email has been sent.`);
}

async function syncProfileChanges(event) {
  if (!auth.currentUser || !activeProfile || !event.detail) return;
  const updates = {};
  if (typeof event.detail.displayName === "string" && event.detail.displayName.trim()) {
    updates.displayName = event.detail.displayName.trim().slice(0, 50);
  }
  if (typeof event.detail.bio === "string") updates.bio = event.detail.bio.slice(0, 500);
  if (typeof event.detail.interests === "string") updates.interests = event.detail.interests.slice(0, 200);
  if (event.detail.username && event.detail.username !== activeProfile.username) {
    setStatus("Your Firebase username is the shared identity and cannot be changed in local profile settings.", true);
    if (profileUsernameInput) profileUsernameInput.value = activeProfile.username;
    const communityUsernameInput = document.getElementById("cc_profileUsername");
    if (communityUsernameInput) communityUsernameInput.value = activeProfile.username;
  }
  if (!Object.keys(updates).length) return;

  updates.updatedAt = serverTimestamp();
  try {
    await updateDoc(doc(db, "users", auth.currentUser.uid), updates);
    activeProfile = { ...activeProfile, ...updates };
    if (updates.displayName) {
      const identity = { ...activeProfile, displayName: updates.displayName };
      applyCloudIdentity(identity);
    }
    setStatus("CampusBoard profile saved to Firebase.");
  } catch (error) {
    console.error("Could not sync the profile to Firestore.", error);
    setStatus(`Profile saved locally, but Firebase sync failed: ${error.message || "Check your connection."}`, true);
  }
}

async function uploadProfileAsset(file, kind) {
  if (!auth.currentUser) throw new Error("Sign in to upload profile images to Firebase Storage.");
  if (!["avatar", "banner"].includes(kind)) throw new Error("Unsupported profile image type.");
  const extension = profileImageTypes.get(file?.type);
  if (!extension || file.size <= 0 || file.size > MAX_PROFILE_IMAGE_SIZE) {
    throw new Error("Choose a JPG, PNG, or WebP image no larger than 5 MB.");
  }
  const path = `users/${auth.currentUser.uid}/profile/${kind}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  const field = kind === "avatar" ? "photoPath" : "bannerPath";
  const contentTypeField = kind === "avatar" ? "photoContentType" : "bannerContentType";
  await updateDoc(doc(db, "users", auth.currentUser.uid), {
    [field]: path,
    [contentTypeField]: file.type,
    updatedAt: serverTimestamp()
  });
  if (activeProfile) activeProfile = { ...activeProfile, [field]: path, [contentTypeField]: file.type };
  const objectUrl = URL.createObjectURL(file);
  const oldUrl = profileObjectUrls.get(kind);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  profileObjectUrls.set(kind, objectUrl);
  window.campusBoardCommunitySetProfileImage?.(kind, objectUrl);
  setStatus(`${kind === "avatar" ? "Profile picture" : "Profile banner"} uploaded securely to Firebase Storage.`);
  return path;
}

async function removeProfileAsset(kind) {
  if (!auth.currentUser) return;
  const pathField = kind === "avatar" ? "photoPath" : "bannerPath";
  const contentTypeField = kind === "avatar" ? "photoContentType" : "bannerContentType";
  const path = activeProfile?.[pathField];
  if (path) {
    try {
      await deleteObject(ref(storage, path));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") throw error;
    }
  }
  await updateDoc(doc(db, "users", auth.currentUser.uid), {
    [pathField]: deleteField(),
    [contentTypeField]: deleteField(),
    updatedAt: serverTimestamp()
  });
  if (activeProfile) {
    delete activeProfile[pathField];
    delete activeProfile[contentTypeField];
  }
  const objectUrl = profileObjectUrls.get(kind);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  profileObjectUrls.delete(kind);
  window.campusBoardCommunitySetProfileImage?.(kind, "");
  if (kind === "avatar") {
    const preview = document.getElementById("communityAvatarPreview");
    if (preview) preview.textContent = (activeProfile?.displayName || "Student").trim().slice(0, 1).toUpperCase();
  } else {
    const preview = document.getElementById("communityBannerPreview");
    if (preview) {
      preview.style.backgroundImage = "";
      preview.style.backgroundColor = "";
    }
  }
  setStatus(`${kind === "avatar" ? "Profile picture" : "Profile banner"} removed from Firebase Storage.`);
}

function bindControls() {
  setIdentityFields();
  document.getElementById("firebaseEmailSignup")?.addEventListener("click", () => {
    void withStatus(createEmailAccount);
  });
  document.getElementById("firebaseEmailSignin")?.addEventListener("click", () => {
    void withStatus(signInEmail);
  });
  document.getElementById("firebaseGoogleSignin")?.addEventListener("click", () => {
    void withStatus(signInGoogle);
  });
  document.getElementById("firebasePasswordReset")?.addEventListener("click", () => {
    void withStatus(resetPassword);
  });
  document.getElementById("firebaseCompleteProfile")?.addEventListener("click", () => {
    void withStatus(finishProfileSetup);
  });
  document.getElementById("firebaseSignOut")?.addEventListener("click", () => {
    void withStatus(async () => {
      await signOut(auth);
      for (const objectUrl of profileObjectUrls.values()) URL.revokeObjectURL(objectUrl);
      profileObjectUrls.clear();
      localStorage.removeItem("campusBoardFirebaseUsername");
      setStatus("Signed out. Your local dashboard remains available.");
    });
  });
  document.addEventListener("click", event => {
    if (event.target.closest("#communityRemovePfp, #cc_removeProfileImage")) {
      if (auth.currentUser) void withStatus(() => removeProfileAsset("avatar"));
    }
    if (event.target.closest("#communityRemoveBanner, #cc_removeBannerImage")) {
      if (auth.currentUser) void withStatus(() => removeProfileAsset("banner"));
    }
  });
  window.addEventListener("campusboard:local-profile-saved", event => {
    void syncProfileChanges(event);
  });
}

async function startFirebase() {
  if (!config?.apiKey || !config?.authDomain || !config?.projectId || !config?.appId) {
    throw new Error("Firebase Web App configuration is missing from firebase-config.js.");
  }

  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  const useEmulators = config.useEmulators === true
    || new URLSearchParams(window.location.search).get("firebaseEmulator") === "1";
  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
  window.campusBoardFirebase = {
    get currentUser() {
      return auth.currentUser;
    },
    auth,
    db,
    storage,
    uploadProfileAsset
  };
  window.dispatchEvent(new Event("campusboard:firebase-ready"));

  bindControls();
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, async user => {
    for (const objectUrl of profileObjectUrls.values()) URL.revokeObjectURL(objectUrl);
    profileObjectUrls.clear();
    if (!user) {
      setSignedOutState();
      return;
    }

    if (signedOutPanel) signedOutPanel.hidden = true;
    if (signedInPanel) signedInPanel.hidden = false;
    setStatus("Checking your Firebase profile…");
    try {
      const profile = await loadAuthenticatedProfile(user);
      if (profile) showAuthenticatedProfile(user, profile);
      else showProfileSetup(user);
    } catch (error) {
      console.error("Could not load the signed-in Firebase profile.", error);
      setStatus(`Signed in, but the profile could not be loaded: ${error.message || "Check Firestore setup."}`, true);
    }
  }, error => {
    console.error("Firebase auth state could not be read.", error);
    setStatus(`Could not detect your sign-in state: ${error.message}`, true);
  });
}

if (document.getElementById("firebaseAuthPanel")) {
  startFirebase().catch(error => {
    console.error(accountError, error);
    setStatus(`${accountError} ${error.message || ""}`.trim(), true);
  });
}
