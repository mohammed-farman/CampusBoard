import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  collection,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getBytes,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const API_BASE = `${(window.CAMPUSBOARD_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/v1`;
const statusNode = document.getElementById("cloudStatus");
const identityNode = document.getElementById("cloudIdentity");
let currentUser = null;
let currentConversation = null;
let currentChatUid = null;
let stopMessages = null;
let selectedCommunityId = null;
let mediaRecorder = null;
let audioChunks = [];
const chatObjectUrls = new Set();

function setStatus(message, isError = false) {
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.dataset.error = String(isError);
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function clear(id) {
  document.getElementById(id)?.replaceChildren();
}

function appendCard(targetId, heading, detail, actions = []) {
  const target = document.getElementById(targetId);
  if (!target) return null;
  const card = node("div", undefined, "card1");
  card.style.margin = "8px 0";
  if (heading) card.append(node("strong", heading));
  if (detail) {
    const paragraph = node("p", detail);
    paragraph.style.margin = "6px 0";
    card.append(paragraph);
  }
  for (const action of actions) {
    const button = node("button", action.label, `btn${action.danger ? " danger" : ""}`);
    button.type = "button";
    button.addEventListener("click", action.onClick);
    card.append(button);
  }
  target.append(card);
  return card;
}

function value(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function setValue(id, next) {
  const input = document.getElementById(id);
  if (input) input.value = next;
}

function ensureSignedIn() {
  if (!currentUser) {
    throw new Error("Sign in with your Firebase account to use cloud services.");
  }
  return currentUser;
}

async function api(path, options = {}) {
  const user = ensureSignedIn();
  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    let detail = `CampusBoard API returned HTTP ${response.status}.`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch (error) {
      console.warn("The CampusBoard API returned a non-JSON error response.", error);
    }
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

function jsonBody(data) {
  return { method: "POST", body: JSON.stringify(data) };
}

async function run(action, successMessage) {
  try {
    setStatus("Working…");
    const result = await action();
    if (successMessage) setStatus(successMessage);
    return result;
  } catch (error) {
    console.error("CampusBoard cloud action failed.", error);
    setStatus(error.message || "The cloud request failed.", true);
    return null;
  }
}

async function refreshClasses() {
  const data = await api("/classes");
  clear("cloudClasses");
  for (const classroom of data.classes) {
    appendCard("cloudClasses", classroom.name, `Grade ${classroom.grade}, ${classroom.section || "no section"} · ID ${classroom.id}`);
  }
  if (!data.classes.length) appendCard("cloudClasses", "No classes assigned", "A school administrator must enroll you or assign your teacher account.");
}

async function refreshHomework() {
  const classId = value("cloudHomeworkClassId");
  const data = await api(`/homework${classId ? `?class_id=${encodeURIComponent(classId)}` : ""}`);
  clear("cloudHomework");
  for (const item of data.homework) {
    const card = appendCard("cloudHomework", item.title, `${item.description || "No instructions"} · Due ${item.dueAt}`);
    if (currentUser && item.teacherUid !== currentUser.uid) {
      const submission = document.createElement("textarea");
      submission.className = "input";
      submission.maxLength = 5000;
      submission.placeholder = "Write your submission";
      const button = node("button", "Submit homework", "btn primary");
      button.type = "button";
      button.addEventListener("click", () => void run(async () => {
        await api(`/homework/${encodeURIComponent(item.id)}/submissions`, jsonBody({ text: submission.value }));
        await refreshHomework();
      }, "Homework submitted."));
      card?.append(submission, button);
    } else if (currentUser && item.teacherUid === currentUser.uid) {
      const reviewButton = node("button", "Review submissions", "btn");
      reviewButton.type = "button";
      reviewButton.addEventListener("click", () => void run(async () => {
        const result = await api(`/homework/${encodeURIComponent(item.id)}/submissions`);
        for (const submission of result.submissions) {
          const review = appendCard("cloudHomework", `Submission · ${submission.student?.username ? `@${submission.student.username}` : submission.studentUid}`, submission.text || submission.attachmentPath || "No text submission");
          if (submission.feedback) review?.append(node("p", `Feedback: ${submission.feedback} · Grade: ${submission.grade || "not graded"}`));
          const feedbackInput = document.createElement("input");
          feedbackInput.className = "input";
          feedbackInput.maxLength = 2000;
          feedbackInput.placeholder = "Teacher feedback";
          const gradeInput = document.createElement("input");
          gradeInput.className = "input";
          gradeInput.maxLength = 40;
          gradeInput.placeholder = "Grade (optional)";
          const save = node("button", "Save feedback", "btn");
          save.type = "button";
          save.addEventListener("click", () => void run(async () => {
            await api(`/homework/${encodeURIComponent(item.id)}/submissions/${encodeURIComponent(submission.studentUid)}`, {
              method: "PATCH",
              body: JSON.stringify({ feedback: feedbackInput.value, grade: gradeInput.value }),
              headers: { "Content-Type": "application/json" }
            });
            setStatus("Teacher feedback saved.");
          }));
          review?.append(feedbackInput, gradeInput, save);
        }
      }));
      card?.append(reviewButton);
    }
  }
  if (!data.homework.length) appendCard("cloudHomework", "No cloud homework", "Assigned homework appears here.");
}

async function refreshParentLinks() {
  const data = await api("/parent/link-requests");
  clear("cloudParentLinks");
  for (const link of data.requests) {
    const incoming = link.childUid === currentUser.uid;
    const otherUid = incoming ? link.parentUid : link.childUid;
    const profile = link.other || await api(`/users/${encodeURIComponent(otherUid)}`).catch(() => null);
    const actions = incoming && link.status === "pending"
      ? [{ label: "Approve parent link", onClick: () => void run(async () => {
          await api(`/parent/link-requests/${encodeURIComponent(link.parentUid)}/accept`, { method: "POST" });
          await refreshParentLinks();
        }, "Parent link approved.") }]
      : [];
    appendCard("cloudParentLinks", `${incoming ? "Parent request" : "Child link"} · ${link.status}`, profile ? `@${profile.username}` : otherUid, actions);
    if (!incoming && link.status === "approved") {
      const button = node("button", "View academic dashboard", "btn");
      button.type = "button";
      button.addEventListener("click", () => void run(async () => {
        const academic = await api(`/parent/children/${encodeURIComponent(otherUid)}/academic`);
        clear("cloudParentAcademic");
        appendCard("cloudParentAcademic", `Academic view for @${academic.child.username}`, `${academic.classes.length} class(es) · ${academic.homework.length} homework item(s) · ${academic.submissions.length} submission(s)`);
        for (const item of academic.homework) {
          appendCard("cloudParentAcademic", item.title, `Due ${item.dueAt}`);
        }
      }));
      document.getElementById("cloudParentLinks")?.append(button);
    }
  }
  if (!data.requests.length) appendCard("cloudParentLinks", "No parent link requests", "A student must approve each parent link before academic records are visible.");
}

function disconnectMessages() {
  if (stopMessages) stopMessages();
  stopMessages = null;
  currentConversation = null;
  currentChatUid = null;
  clear("cloudMessages");
  for (const objectUrl of chatObjectUrls) URL.revokeObjectURL(objectUrl);
  chatObjectUrls.clear();
}

async function downloadChatFile(path, filename) {
  const bytes = await getBytes(ref(window.campusBoardFirebase.storage, path));
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function previewChatAsset(message, card, filename) {
  const bytes = await getBytes(ref(window.campusBoardFirebase.storage, message.storagePath));
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: message.contentType || "application/octet-stream" }));
  chatObjectUrls.add(objectUrl);
  if (message.kind === "image") {
    const image = document.createElement("img");
    image.src = objectUrl;
    image.alt = "Shared chat image";
    image.style.maxWidth = "min(100%, 320px)";
    image.style.borderRadius = "12px";
    card?.append(image);
    return;
  }
  if (message.kind === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = objectUrl;
    audio.setAttribute("aria-label", `Audio message ${filename}`);
    audio.addEventListener("ended", () => URL.revokeObjectURL(objectUrl), { once: true });
    card?.append(audio);
  }
}

function openConversation(conversation, otherUid, displayName = otherUid) {
  disconnectMessages();
  currentConversation = conversation;
  currentChatUid = conversation.group ? null : otherUid;
  const participantSelect = document.getElementById("cloudChatParticipant");
  if (participantSelect) {
    participantSelect.hidden = !conversation.group;
    participantSelect.replaceChildren();
    if (conversation.group) {
      participantSelect.append(new Option("Select group participant", ""));
      for (const participant of conversation.participants || []) {
        if (participant.uid === currentUser.uid) continue;
        participantSelect.append(new Option(`@${participant.username}`, participant.uid));
      }
    }
  }
  setStatus(`Live chat connected · ${conversation.group ? "group chat" : `@${displayName}`}`);
  const messagesQuery = query(
    collection(window.campusBoardFirebase.db, "conversations", conversation.id, "messages"),
    orderBy("createdAt", "asc")
  );
  stopMessages = onSnapshot(messagesQuery, snapshot => {
    for (const objectUrl of chatObjectUrls) URL.revokeObjectURL(objectUrl);
    chatObjectUrls.clear();
    clear("cloudMessages");
    for (const documentSnapshot of snapshot.docs) {
      const message = documentSnapshot.data();
      const who = message.senderUid === currentUser.uid ? "You" : `@${message.senderUsername || otherUid}`;
      const card = appendCard("cloudMessages", who, message.text || `${message.kind} message`);
      if (message.storagePath) {
        if (message.kind === "image" || message.kind === "audio") {
          const preview = node("button", message.kind === "audio" ? "Play audio" : "Preview image", "btn");
          preview.type = "button";
          preview.addEventListener("click", () => void run(
            () => previewChatAsset(message, card, documentSnapshot.id)
          ));
          card?.append(preview);
        }
        const button = node("button", "Download shared file", "btn");
        button.type = "button";
        button.addEventListener("click", () => void run(
          () => downloadChatFile(message.storagePath, `${message.kind}-${documentSnapshot.id}`)
        ));
        card?.append(button);
      }
    }
  }, error => {
    console.error("Realtime chat listener failed.", error);
    setStatus("Chat could not be opened. Check Firestore rules and conversation membership.", true);
  });
}

async function refreshChat() {
  const [requests, conversations] = await Promise.all([
    api("/chat/requests"),
    api("/chat/conversations")
  ]);
  clear("cloudChatRequests");
  for (const request of requests.incoming) {
    appendCard("cloudChatRequests", `Chat request from @${request.sender?.username || request.senderUid}`, request.message, [
      { label: "Accept", onClick: () => void run(async () => {
        const accepted = await api(`/chat/requests/${encodeURIComponent(request.id)}/accept`, { method: "POST" });
        await refreshChat();
        const conversation = conversations.conversations.find(item => item.id === accepted.conversationId)
          || { id: accepted.conversationId };
        openConversation(conversation, request.senderUid, request.sender?.username || request.senderUid);
      }, "Chat request accepted.") },
      { label: "Decline", onClick: () => void run(async () => {
        await api(`/chat/requests/${encodeURIComponent(request.id)}/decline`, { method: "POST" });
        await refreshChat();
      }, "Chat request declined.") }
    ]);
  }
  for (const request of requests.outgoing) {
    appendCard("cloudChatRequests", `Request sent to @${request.recipient?.username || request.recipientUid}`, "Waiting for recipient approval.");
  }
  clear("cloudConversations");
  for (const conversation of conversations.conversations) {
    const otherUid = conversation.participantUids.find(uid => uid !== currentUser.uid);
    if (!otherUid && !conversation.group) continue;
    const label = conversation.group
      ? `Group chat · ${conversation.participants.map(participant => `@${participant.username}`).join(", ")}`
      : `Conversation · @${conversation.participants[0]?.username || otherUid}`;
    appendCard("cloudConversations", label, conversation.lastMessageAt ? "Recent activity" : "No messages yet", [
      { label: "Open live chat", onClick: () => openConversation(
        conversation,
        conversation.group ? null : otherUid,
        conversation.group ? "group" : conversation.participants[0]?.username || otherUid
      ) }
    ]);
  }
}

async function refreshCommunities() {
  const result = await api("/communities");
  clear("cloudCommunities");
  for (const community of result.communities) {
    appendCard("cloudCommunities", community.name, `${community.description || ""} · ${community.memberCount || 0} member(s)`, [
      { label: "Join and open", onClick: () => void run(async () => {
        await api(`/communities/${encodeURIComponent(community.id)}/join`, { method: "POST" });
        selectedCommunityId = community.id;
        setValue("cloudCommunityName", community.name);
        await refreshPosts();
      }, "Community joined.") }
    ]);
  }
}

async function refreshPosts() {
  if (!selectedCommunityId) {
    setStatus("Join or create a community before viewing its posts.");
    return;
  }
  const result = await api(`/communities/${encodeURIComponent(selectedCommunityId)}/posts`);
  clear("cloudPosts");
  for (const post of result.posts) {
    const card = appendCard("cloudPosts", `${post.kind}: ${post.title || "Untitled"}`, `${post.body} · by @${post.author?.username || post.authorUid}`);
    if (post.kind === "poll") {
      for (let index = 0; index < post.pollOptions.length; index += 1) {
        const button = node("button", `${post.pollOptions[index]} · ${post.voteCounts?.[index] || 0} vote(s)`, "btn");
        button.type = "button";
        button.addEventListener("click", () => void run(async () => {
          await api(`/posts/${encodeURIComponent(post.id)}/votes/${index}`, { method: "POST" });
          await refreshPosts();
        }, "Your poll vote was saved."));
        card?.append(button);
      }
    }
    for (const comment of post.comments || []) appendCard("cloudPosts", `Comment by @${comment.author?.username || comment.authorUid}`, comment.body);
    const commentInput = document.createElement("input");
    commentInput.className = "input";
    commentInput.maxLength = 3000;
    commentInput.placeholder = "Add a comment";
    const commentButton = node("button", "Comment", "btn");
    commentButton.type = "button";
    commentButton.addEventListener("click", () => void run(async () => {
      await api(`/posts/${encodeURIComponent(post.id)}/comments`, jsonBody({ body: commentInput.value }));
      await refreshPosts();
    }, "Comment added."));
    card?.append(commentInput, commentButton);
  }
}

async function uploadFile(file, path, limit, allowed) {
  if (!file || !allowed(file)) throw new Error("Choose a supported file type.");
  if (file.size < 1 || file.size > limit) throw new Error(`File must be smaller than ${Math.round(limit / 1024 / 1024)} MB.`);
  await uploadBytes(ref(window.campusBoardFirebase.storage, path), file, { contentType: file.type });
  return path;
}

async function refreshResources() {
  const classId = value("cloudResourceClassId");
  if (!classId) throw new Error("Enter the class ID first.");
  const result = await api(`/resources?class_id=${encodeURIComponent(classId)}`);
  clear("cloudResources");
  for (const resource of result.resources) {
    const card = appendCard("cloudResources", resource.title, `${resource.contentType} · ${(resource.size / 1024).toFixed(0)} KB`);
    const button = node("button", "Download resource", "btn");
    button.type = "button";
    button.addEventListener("click", () => void run(() => downloadChatFile(resource.storagePath, resource.title)));
    card?.append(button);
  }
}

async function refreshCalendar() {
  const result = await api("/calendar");
  clear("cloudCalendar");
  for (const event of result.events) {
    appendCard("cloudCalendar", `${event.kind}: ${event.title}`, `${event.startsAt}${event.classId ? ` · class ${event.classId}` : " · personal"}`);
  }
}

async function refreshNotifications() {
  const result = await api("/notifications");
  clear("cloudNotifications");
  for (const notification of result.notifications) {
    appendCard(
      "cloudNotifications",
      notification.kind.replaceAll("_", " "),
      `${notification.read ? "Read" : "Unread"} · ${notification.createdAt?.toDate?.()?.toLocaleString?.() || "New"}`
    );
    if (!notification.read) {
      const button = node("button", "Mark read", "btn");
      button.type = "button";
      button.addEventListener("click", () => void run(async () => {
        await api(`/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
        await refreshNotifications();
      }));
      document.getElementById("cloudNotifications")?.append(button);
    }
  }
}

function bind(id, action) {
  document.getElementById(id)?.addEventListener("click", () => void run(action));
}

function bindControls() {
  bind("cloudCreateSchool", async () => {
    const result = await api("/admin/schools", jsonBody({ name: value("cloudSchoolName"), region: value("cloudSchoolRegion") }));
    setValue("cloudSchoolId", result.id);
    setStatus(`School created. ID: ${result.id}`);
  });
  bind("cloudCreateClass", async () => {
    const result = await api("/admin/classes", jsonBody({
      schoolId: value("cloudSchoolId"), name: value("cloudClassName"),
      grade: Number(value("cloudClassGrade")), section: value("cloudClassSection")
    }));
    setValue("cloudClassId", result.id);
    setStatus(`Class created. ID: ${result.id}`);
    await refreshClasses();
  });
  bind("cloudAssignSchoolAdmin", async () => {
    const result = await api(
      `/admin/schools/${encodeURIComponent(value("cloudSchoolId"))}/admins/${encodeURIComponent(value("cloudSchoolAdminUid"))}`,
      { method: "POST" }
    );
    setStatus(`School administrator assigned to ${result.schoolId}.`);
  });
  bind("cloudAddStudent", async () => {
    await api(`/admin/classes/${encodeURIComponent(value("cloudClassId"))}/members/${encodeURIComponent(value("cloudTargetUid"))}`, { method: "POST" });
    setStatus("Student enrolled.");
  });
  bind("cloudAssignTeacher", async () => {
    await api(`/admin/classes/${encodeURIComponent(value("cloudClassId"))}/teachers/${encodeURIComponent(value("cloudTargetUid"))}`, { method: "POST" });
    setStatus("Teacher assigned.");
  });
  bind("cloudSetRole", async () => {
    const uid = value("cloudRoleUid");
    const role = value("cloudRoleName");
    await api(`/admin/users/${encodeURIComponent(uid)}/role`, jsonBody({ role }));
    setStatus(`Verified ${role} role provisioned. The user must refresh their sign-in token.`);
  });
  bind("cloudRefreshClasses", refreshClasses);
  bind("cloudCreateHomework", async () => {
    await api("/homework", jsonBody({
      classId: value("cloudHomeworkClassId"), title: value("cloudHomeworkTitle"),
      description: value("cloudHomeworkDescription"), dueAt: value("cloudHomeworkDue")
    }));
    await refreshHomework();
    setStatus("Homework published.");
  });
  bind("cloudRefreshHomework", refreshHomework);
  bind("cloudCreateAnnouncement", async () => {
    await api("/announcements", jsonBody({
      classId: value("cloudAnnouncementClassId"), title: value("cloudAnnouncementTitle"),
      body: value("cloudAnnouncementBody")
    }));
    await refreshAnnouncements();
    setStatus("Class announcement published.");
  });
  bind("cloudRefreshAnnouncements", refreshAnnouncements);
  bind("cloudRequestParentLink", async () => {
    await api("/parent/link-requests", jsonBody({ childUsername: value("cloudChildUsername") }));
    setStatus("Parent link request sent. The student must approve it.");
    await refreshParentLinks();
  });
  bind("cloudRefreshParentLinks", refreshParentLinks);
  bind("cloudSendChatRequest", async () => {
    await api("/chat/requests", jsonBody({
      recipientUsername: value("cloudChatUsername"), message: value("cloudChatRequestMessage")
    }));
    setStatus("Chat request sent. The recipient must accept it.");
    await refreshChat();
  });
  bind("cloudRefreshChat", refreshChat);
  bind("cloudCreateGroup", async () => {
    const memberUsernames = value("cloudGroupMemberUids").split(",").map(username => username.trim()).filter(Boolean);
    const result = await api("/chat/groups", jsonBody({ memberUsernames }));
    await refreshChat();
    setStatus(`Group chat created; invitations sent. Conversation ID: ${result.id}`);
  });
  bind("cloudRefreshGroupInvites", refreshGroupInvitations);
  bind("cloudSendChatMessage", async () => {
    if (!currentConversation) throw new Error("Open an accepted conversation first.");
    const text = value("cloudChatText");
    const fileInput = document.getElementById("cloudChatFile");
    const file = fileInput?.files?.[0];
    let kind = "text";
    let storagePath = null;
    let contentType = null;
    if (file) {
      const type = file.type.toLowerCase();
      if (["image/jpeg", "image/png", "image/webp"].includes(type)) kind = "image";
      else if (["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4"].includes(type)) kind = "audio";
      else if (type === "application/pdf") kind = "file";
      else throw new Error("Chat supports images, PDF files, and audio messages.");
      contentType = file.type;
      storagePath = `conversations/${currentConversation.id}/${currentUser.uid}/${Date.now()}_${crypto.randomUUID()}`;
      await uploadFile(file, storagePath, 15 * 1024 * 1024, selected => [
        "image/jpeg", "image/png", "image/webp", "application/pdf",
        "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4"
      ].includes(selected.type));
    }
    await api(`/chat/conversations/${encodeURIComponent(currentConversation.id)}/messages`, jsonBody({
      kind, text, storagePath, contentType
    }));
    setValue("cloudChatText", "");
    if (fileInput) fileInput.value = "";
  });
  bind("cloudBlockChatUser", async () => {
    const targetUid = currentChatUid || value("cloudChatParticipant");
    if (!targetUid) throw new Error("Open a conversation and select a participant first.");
    await api(`/chat/blocks/${encodeURIComponent(targetUid)}`, { method: "POST" });
    disconnectMessages();
    await refreshChat();
    setStatus("Participant blocked.");
  });
  bind("cloudReportChatUser", async () => {
    const targetUid = currentChatUid || value("cloudChatParticipant");
    if (!targetUid) throw new Error("Open a conversation and select a participant first.");
    await api("/reports", jsonBody({
      targetUid, category: "chat_safety", details: "Reported from the CampusBoard chat controls."
    }));
    setStatus("Safety report sent to CampusBoard moderation.");
  });
  bind("cloudCreateCommunity", async () => {
    const result = await api("/communities", jsonBody({
      name: value("cloudCommunityName"), description: value("cloudCommunityDescription")
    }));
    selectedCommunityId = result.id;
    await refreshCommunities();
    await refreshPosts();
    setStatus("Community created.");
  });
  bind("cloudRefreshCommunities", refreshCommunities);
  bind("cloudCreatePost", async () => {
    if (!selectedCommunityId) throw new Error("Create or join a community first.");
    const kind = value("cloudPostKind");
    const pollOptions = value("cloudPollOptions").split(/\r?\n/).map(option => option.trim()).filter(Boolean);
    await api(`/communities/${encodeURIComponent(selectedCommunityId)}/posts`, jsonBody({
      communityId: selectedCommunityId, kind, title: value("cloudPostTitle"),
      body: value("cloudPostBody"), pollOptions: kind === "poll" ? pollOptions : []
    }));
    await refreshPosts();
    setStatus(`${kind} published.`);
  });
  bind("cloudUploadResource", async () => {
    const classId = value("cloudResourceClassId");
    const file = document.getElementById("cloudResourceFile")?.files?.[0];
    if (!file) throw new Error("Choose a resource file.");
    const storagePath = `resources/${classId}/${currentUser.uid}/${Date.now()}_${crypto.randomUUID()}`;
    await uploadFile(file, storagePath, 25 * 1024 * 1024, selected => {
      const type = selected.type;
      return type === "application/pdf" || type === "text/plain"
        || ["image/jpeg", "image/png", "image/webp"].includes(type)
        || ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm"].includes(type)
        || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        || type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        || type === "application/msword";
    });
    await api("/resources", jsonBody({
      classId, title: value("cloudResourceTitle") || file.name, storagePath,
      contentType: file.type, size: file.size
    }));
    await refreshResources();
    setStatus("Resource uploaded to Storage and catalogued.");
  });
  bind("cloudRefreshResources", refreshResources);
  bind("cloudCreateCalendar", async () => {
    const toIso = input => input ? new Date(input).toISOString() : null;
    await api("/calendar", jsonBody({
      title: value("cloudCalendarTitle"), classId: value("cloudCalendarClassId") || null,
      startsAt: toIso(value("cloudCalendarStart")),
      endsAt: toIso(value("cloudCalendarEnd")),
      kind: value("cloudCalendarKind")
    }));
    await refreshCalendar();
  });
  bind("cloudRefreshCalendar", refreshCalendar);
  bind("cloudRefreshNotifications", refreshNotifications);
  bind("cloudRefreshReports", refreshReports);
  bind("cloudAskAi", async () => {
    const prompt = value("cloudAiPrompt");
    const grade = Number(value("cloudAiGrade"));
    const result = await api(`/ai/study-help?grade=${grade}&prompt=${encodeURIComponent(prompt)}`, { method: "POST" });
    clear("cloudAiAnswer");
    appendCard("cloudAiAnswer", "Study tutor", result.answer);
  });
  bind("cloudRecordAudio", async () => {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error("This browser does not support secure audio recording.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener("dataavailable", event => {
      if (event.data.size) audioChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      const recordedType = audioChunks[0]?.type.split(";")[0] || mediaRecorder.mimeType.split(";")[0] || "audio/webm";
      const blob = new Blob(audioChunks, { type: recordedType });
      const file = new File([blob], `voice-${Date.now()}`, { type: recordedType });
      stream.getTracks().forEach(track => track.stop());
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.getElementById("cloudChatFile");
      if (input) input.files = transfer.files;
      setStatus("Audio recorded. Press Send to share it in the selected conversation.");
    });
    mediaRecorder.start();
    setStatus("Recording audio… Press Record audio again to stop.");
  });
}

async function refreshAnnouncements() {
  const classId = value("cloudAnnouncementClassId");
  if (!classId) throw new Error("Enter the class ID first.");
  const result = await api(`/announcements?class_id=${encodeURIComponent(classId)}`);
  clear("cloudAnnouncements");
  for (const item of result.announcements) {
    appendCard("cloudAnnouncements", item.title, item.body);
  }
  if (!result.announcements.length) appendCard("cloudAnnouncements", "No announcements", "Teacher announcements will appear here.");
}

async function refreshGroupInvitations() {
  const result = await api("/chat/group-invitations");
  clear("cloudGroupInvitations");
  for (const invitation of result.invitations) {
    const sender = invitation.sender;
    appendCard("cloudGroupInvitations", `Group invitation from @${sender?.username || invitation.senderUid}`, "Accept to join the live group chat.", [
      { label: "Accept group invitation", onClick: () => void run(async () => {
        await api(`/chat/groups/${encodeURIComponent(invitation.conversationId)}/accept`, { method: "POST" });
        await refreshGroupInvitations();
        await refreshChat();
      }, "Group invitation accepted.") }
    ]);
  }
}

async function refreshReports() {
  const result = await api("/admin/reports");
  clear("cloudReports");
  for (const report of result.reports) {
    appendCard("cloudReports", `${report.category} · @${report.target?.username || "student"}`, report.details || "No additional details", [
      { label: "Resolve report", onClick: () => void run(async () => {
        await api(`/admin/reports/${encodeURIComponent(report.id)}/resolve`, { method: "PATCH" });
        await refreshReports();
      }, "Report marked resolved.") }
    ]);
  }
  if (!result.reports.length) appendCard("cloudReports", "No open safety reports", "New reports will be listed for administrators.");
}

async function handleAuth(user) {
  currentUser = user;
  disconnectMessages();
  if (!user) {
    identityNode.textContent = "Not signed in";
    setStatus("Sign in to your Firebase account to use cloud services.");
    return;
  }
  try {
    const profile = await api("/me");
    identityNode.textContent = `@${profile.username} · ${profile.role}`;
    setStatus("Connected to CampusBoard cloud services.");
    await Promise.all([refreshClasses(), refreshHomework(), refreshNotifications()]);
  } catch (error) {
    console.error("CampusBoard cloud services could not load the signed-in account.", error);
    identityNode.textContent = "Signed in; finish profile setup or configure the CampusBoard API.";
    setStatus(error.message || "CampusBoard API is unavailable.", true);
  }
}

bindControls();
if (window.campusBoardFirebase?.auth) {
  onAuthStateChanged(window.campusBoardFirebase.auth, user => void handleAuth(user));
} else {
  window.addEventListener("campusboard:firebase-ready", () => {
    if (window.campusBoardFirebase?.auth) {
      onAuthStateChanged(window.campusBoardFirebase.auth, user => void handleAuth(user));
    }
  }, { once: true });
}
