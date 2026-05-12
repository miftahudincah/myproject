// chat.js - VERSION 2.0 (DENGAN DUKUNGAN MODAL & UPLOAD GAMBAR)
// Fitur Chat Pribadi antar teman
// Mendukung: kirim pesan, gambar, hapus pesan, real-time, notifikasi

let chatListeners = {};
let currentChatWith = null;
let chatMessagesListener = null;
let unreadCounts = {};

// ======================= INISIALISASI =======================

function initChatSystem() {
    console.log("💬 Initializing chat system...");
    
    if (!currentUser) {
        console.log("No user logged in, skipping chat init");
        return;
    }
    
    // Setup listener untuk pesan masuk (real-time)
    setupIncomingMessagesListener();
    
    // Setup listener untuk notifikasi chat
    setupChatNotifications();
    
    // Render chat interface
    renderChatInterface();
    
    // Load daftar chat terbaru
    loadChatList();
}

function setupIncomingMessagesListener() {
    if (chatListeners.incoming) {
        db.ref(`chats/${currentUser.uid}/inbox`).off('value', chatListeners.incoming);
    }
    
    chatListeners.incoming = db.ref(`chats/${currentUser.uid}/inbox`).on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            updateUnreadBadge(data);
            loadChatList();
            if (currentChatWith) {
                loadChatMessages(currentChatWith);
            }
            playChatNotification();
        }
    });
}

function setupChatNotifications() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function updateUnreadBadge(inboxData) {
    let totalUnread = 0;
    const unreadByUser = {};
    
    for (const [fromUid, data] of Object.entries(inboxData)) {
        if (data.unreadCount && data.unreadCount > 0) {
            totalUnread += data.unreadCount;
            unreadByUser[fromUid] = data.unreadCount;
        }
    }
    
    unreadCounts = unreadByUser;
    
    const chatTabBtn = document.querySelector('.tab-btn[onclick*="chat"]');
    if (chatTabBtn) {
        let badge = chatTabBtn.querySelector('.chat-badge');
        if (totalUnread > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'chat-badge';
                badge.style.cssText = 'background:#f44336; color:white; border-radius:50%; padding:2px 6px; font-size:10px; margin-left:5px;';
                chatTabBtn.appendChild(badge);
            }
            badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
        } else if (badge) {
            badge.remove();
        }
    }
    
    const floatingChatBtn = document.getElementById('floatingChatBtn');
    if (floatingChatBtn) {
        let badge = floatingChatBtn.querySelector('.chat-badge-count');
        if (totalUnread > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'chat-badge-count';
                badge.style.cssText = 'position:absolute; top:-5px; right:-5px; background:#f44336; color:white; border-radius:50%; width:18px; height:18px; font-size:10px; display:flex; align-items:center; justify-content:center;';
                floatingChatBtn.style.position = 'relative';
                floatingChatBtn.appendChild(badge);
            }
            badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
        } else if (badge) {
            badge.remove();
        }
    }
}

function playChatNotification() {
    if (document.hidden) {
        try {
            const beep = new Audio('data:audio/wav;base64,U3RlYWx0aCBzb3VuZA==');
            beep.volume = 0.3;
            beep.play().catch(() => {});
        } catch(e) {}
    }
}

// ======================= RENDER CHAT INTERFACE =======================

function renderChatInterface() {
    // Coba cari container di tab-chat dulu
    let container = document.getElementById('chatPanel');
    
    // Jika tidak ditemukan, coba di modal
    if (!container) {
        container = document.getElementById('chatModalPanel');
    }
    
    if (!container) {
        console.warn("Chat container not found");
        return;
    }
    
    container.innerHTML = `
        <div class="chat-container">
            <div class="chat-sidebar">
                <div class="chat-search">
                    <input type="text" id="chatSearchInput" placeholder="🔍 Cari chat..." oninput="filterChatList()">
                </div>
                <div id="chatList" class="chat-list">
                    <p class="text-small" style="color: var(--text-muted); text-align:center; padding:20px;">Memuat chat...</p>
                </div>
            </div>
            <div class="chat-main">
                <div class="chat-header" id="chatHeader">
                    <p class="text-small" style="color: var(--text-muted); text-align:center; padding:20px;">Pilih chat untuk memulai percakapan</p>
                </div>
                <div class="chat-messages" id="chatMessages">
                    <div class="chat-messages-empty">👈 Pilih chat di sebelah kiri</div>
                </div>
                <div class="chat-input-area" id="chatInputArea" style="display: none;">
                    <div class="chat-input-tools">
                        <label class="btn-icon" style="cursor:pointer; background:transparent;" title="Kirim Gambar">
                            📷 <input type="file" id="chatImageInput" accept="image/*" style="display:none;" onchange="sendChatMedia(this)">
                        </label>
                    </div>
                    <textarea id="chatMessageInput" placeholder="Tulis pesan... (Enter untuk kirim, Shift+Enter untuk new line)" rows="2" onkeydown="handleChatKeyPress(event)"></textarea>
                    <button class="btn-action btn-primary" onclick="sendChatMessage()">📤 Kirim</button>
                </div>
            </div>
        </div>
    `;
    
    loadChatList();
}

async function loadChatList() {
    // Coba cari container di beberapa tempat
    let container = document.getElementById('chatList');
    if (!container) {
        container = document.querySelector('#chatPanel #chatList');
    }
    if (!container) return;
    
    try {
        const snapshot = await db.ref(`chats/${currentUser.uid}/inbox`).once('value');
        const inbox = snapshot.val();
        
        if (!inbox || Object.keys(inbox).length === 0) {
            container.innerHTML = '<p class="text-small" style="color: var(--text-muted); text-align:center; padding:20px;">📭 Belum ada chat. Cari teman untuk memulai chat!</p>';
            return;
        }
        
        const chatList = [];
        for (const [friendUid, chatInfo] of Object.entries(inbox)) {
            const friendSnapshot = await db.ref(`users_auth/${friendUid}`).once('value');
            const friendData = friendSnapshot.val();
            if (friendData) {
                chatList.push({
                    uid: friendUid,
                    nama: friendData.nama,
                    email: friendData.email,
                    photoUrl: friendData.photoUrl,
                    lastMessage: chatInfo.lastMessage || '',
                    lastMessageType: chatInfo.lastMessageType || 'text',
                    lastMessageTime: chatInfo.lastMessageTime || 0,
                    unreadCount: chatInfo.unreadCount || 0
                });
            }
        }
        
        chatList.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
        
        container.innerHTML = chatList.map(chat => `
            <div class="chat-item ${currentChatWith === chat.uid ? 'active' : ''}" data-uid="${chat.uid}" onclick="selectChat('${chat.uid}')">
                <div class="chat-avatar">
                    <img src="${chat.photoUrl || getAvatarUrl(chat.nama)}" alt="${escapeHtml(chat.nama)}">
                    ${chat.unreadCount > 0 ? `<span class="chat-unread-badge">${chat.unreadCount}</span>` : ''}
                </div>
                <div class="chat-info">
                    <div class="chat-name">${escapeHtml(chat.nama)}</div>
                    <div class="chat-last-message">
                        ${chat.lastMessageType === 'image' ? '📷 Gambar' : escapeHtml(chat.lastMessage?.substring(0, 30) || '')}
                    </div>
                </div>
                <div class="chat-time">${formatChatTime(chat.lastMessageTime)}</div>
            </div>
        `).join('');
        
        const searchInput = document.getElementById('chatSearchInput');
        if (searchInput && searchInput.value) {
            filterChatList();
        }
        
    } catch (error) {
        console.error("Load chat list error:", error);
        container.innerHTML = '<p class="text-small" style="color: var(--text-muted); text-align:center; padding:20px;">❌ Gagal memuat chat</p>';
    }
}

function filterChatList() {
    const searchInput = document.getElementById('chatSearchInput');
    const searchValue = searchInput?.value.toLowerCase() || '';
    const chatItems = document.querySelectorAll('.chat-item');
    
    chatItems.forEach(item => {
        const name = item.querySelector('.chat-name')?.textContent.toLowerCase() || '';
        if (searchValue === '' || name.includes(searchValue)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function formatChatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / 3600000);
    
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return minutes === 0 ? 'Baru saja' : `${minutes} m`;
    } else if (diff < 86400000) {
        return `${hours} jam`;
    } else if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days} h`;
    } else {
        return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    }
}

// ======================= FUNGSI CHAT =======================

async function selectChat(friendUid) {
    currentChatWith = friendUid;
    
    await markMessagesAsRead(friendUid);
    
    const friendSnapshot = await db.ref(`users_auth/${friendUid}`).once('value');
    const friendData = friendSnapshot.val();
    
    const header = document.getElementById('chatHeader');
    const messagesContainer = document.getElementById('chatMessages');
    const inputArea = document.getElementById('chatInputArea');
    
    if (header && friendData) {
        header.innerHTML = `
            <div class="chat-header-info">
                <img src="${friendData.photoUrl || getAvatarUrl(friendData.nama)}" alt="${escapeHtml(friendData.nama)}" style="width:40px; height:40px; border-radius:50%;">
                <div>
                    <div class="chat-header-name">${escapeHtml(friendData.nama)}</div>
                    <div class="chat-header-email">${escapeHtml(friendData.email)}</div>
                </div>
                <div class="chat-header-actions">
                    <button class="btn-icon" onclick="clearChat('${friendUid}')" title="Hapus semua pesan">🗑️</button>
                </div>
            </div>
        `;
    }
    
    if (inputArea) inputArea.style.display = 'flex';
    
    loadChatMessages(friendUid);
}

async function markMessagesAsRead(friendUid) {
    await db.ref(`chats/${currentUser.uid}/inbox/${friendUid}/unreadCount`).set(0);
    loadChatList();
}

async function loadChatMessages(friendUid) {
    if (chatMessagesListener) {
        db.ref(`chats/${currentUser.uid}/messages/${friendUid}`).off('value', chatMessagesListener);
    }
    
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = '<div class="chat-messages-loading">Memuat pesan...</div>';
    
    chatMessagesListener = db.ref(`chats/${currentUser.uid}/messages/${friendUid}`).on('value', (snapshot) => {
        const data = snapshot.val();
        const messages = [];
        
        if (data) {
            Object.entries(data).forEach(([msgId, msg]) => {
                messages.push({ id: msgId, ...msg });
            });
            messages.sort((a, b) => a.timestamp - b.timestamp);
        }
        
        renderChatMessages(messages, friendUid);
        
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    });
}

function renderChatMessages(messages, friendUid) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="chat-messages-empty">💬 Belum ada pesan. Kirim pesan pertama!</div>';
        return;
    }
    
    container.innerHTML = messages.map(msg => {
        const isMe = msg.from === currentUser.uid;
        const time = new Date(msg.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(msg.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        
        let contentHtml = '';
        if (msg.type === 'image') {
            contentHtml = `<a href="${msg.mediaUrl}" target="_blank"><img src="${msg.mediaUrl}" style="max-width:200px; max-height:150px; border-radius:8px; cursor:pointer;"></a>`;
        } else {
            contentHtml = `<div class="chat-message-text">${escapeHtml(msg.message)}</div>`;
        }
        
        return `
            <div class="chat-message ${isMe ? 'me' : 'friend'}" data-msg-id="${msg.id}">
                <div class="chat-message-bubble">
                    ${contentHtml}
                    <div class="chat-message-time">${date} ${time}</div>
                    ${isMe ? `<span class="chat-message-delete" onclick="deleteChatMessage('${friendUid}', '${msg.id}')" title="Hapus pesan">🗑️</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function sendChatMessage() {
    const input = document.getElementById('chatMessageInput');
    const message = input.value.trim();
    
    if (!message) return;
    if (!currentChatWith) {
        showToast("Pilih chat terlebih dahulu!", "error");
        return;
    }
    
    const isFriend = await checkIsFriend(currentChatWith);
    if (!isFriend) {
        showToast("Anda tidak bisa chat dengan orang yang bukan teman!", "error");
        return;
    }
    
    input.disabled = true;
    
    const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const timestamp = firebase.database.ServerValue.TIMESTAMP;
    
    const messageData = {
        id: messageId,
        from: currentUser.uid,
        to: currentChatWith,
        message: message,
        type: 'text',
        timestamp: timestamp,
        read: false
    };
    
    try {
        await Promise.all([
            db.ref(`chats/${currentUser.uid}/messages/${currentChatWith}/${messageId}`).set(messageData),
            db.ref(`chats/${currentChatWith}/messages/${currentUser.uid}/${messageId}`).set(messageData),
            db.ref(`chats/${currentChatWith}/inbox/${currentUser.uid}`).update({
                lastMessage: message,
                lastMessageType: 'text',
                lastMessageTime: timestamp,
                unreadCount: firebase.database.ServerValue.increment(1)
            }),
            db.ref(`chats/${currentUser.uid}/inbox/${currentChatWith}`).update({
                lastMessage: message,
                lastMessageType: 'text',
                lastMessageTime: timestamp,
                unreadCount: 0
            })
        ]);
        
        input.value = '';
        input.disabled = false;
        input.focus();
        
    } catch (error) {
        console.error("Send message error:", error);
        showToast("❌ Gagal mengirim pesan", "error");
        input.disabled = false;
    }
}

async function sendChatMedia(input) {
    const file = input.files[0];
    if (!file) return;
    if (!currentChatWith) {
        showToast("Pilih chat terlebih dahulu!", "error");
        return;
    }
    
    const isFriend = await checkIsFriend(currentChatWith);
    if (!isFriend) {
        showToast("Anda tidak bisa chat dengan orang yang bukan teman!", "error");
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showToast("❌ Ukuran gambar maksimal 5MB!", "error");
        input.value = '';
        return;
    }
    
    showToast("📤 Mengunggah gambar...", "info");
    
    const formData = new FormData();
    formData.append('image', file);
    
    try {
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        if (data.success) {
            const mediaUrl = data.data.image.url;
            const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const timestamp = firebase.database.ServerValue.TIMESTAMP;
            
            const messageData = {
                id: messageId,
                from: currentUser.uid,
                to: currentChatWith,
                message: '📷 Mengirim gambar',
                type: 'image',
                mediaUrl: mediaUrl,
                timestamp: timestamp,
                read: false
            };
            
            await Promise.all([
                db.ref(`chats/${currentUser.uid}/messages/${currentChatWith}/${messageId}`).set(messageData),
                db.ref(`chats/${currentChatWith}/messages/${currentUser.uid}/${messageId}`).set(messageData),
                db.ref(`chats/${currentChatWith}/inbox/${currentUser.uid}`).update({
                    lastMessage: '📷 Gambar',
                    lastMessageType: 'image',
                    lastMessageTime: timestamp,
                    unreadCount: firebase.database.ServerValue.increment(1)
                }),
                db.ref(`chats/${currentUser.uid}/inbox/${currentChatWith}`).update({
                    lastMessage: '📷 Gambar',
                    lastMessageType: 'image',
                    lastMessageTime: timestamp,
                    unreadCount: 0
                })
            ]);
            
            showToast("✅ Gambar berhasil dikirim!", "success");
        } else {
            throw new Error("Upload failed");
        }
    } catch (err) {
        console.error("Upload error:", err);
        showToast("❌ Gagal mengirim gambar", "error");
    } finally {
        input.value = '';
    }
}

async function deleteChatMessage(friendUid, messageId) {
    if (!confirm("Hapus pesan ini?")) return;
    
    try {
        await Promise.all([
            db.ref(`chats/${currentUser.uid}/messages/${friendUid}/${messageId}`).remove(),
            db.ref(`chats/${friendUid}/messages/${currentUser.uid}/${messageId}`).remove()
        ]);
        showToast("✅ Pesan dihapus", "success");
    } catch (error) {
        console.error("Delete message error:", error);
        showToast("❌ Gagal menghapus pesan", "error");
    }
}

async function clearChat(friendUid) {
    if (!confirm(`Hapus SEMUA pesan dengan teman ini?\n\nTindakan ini tidak dapat dibatalkan!`)) return;
    
    try {
        await Promise.all([
            db.ref(`chats/${currentUser.uid}/messages/${friendUid}`).remove(),
            db.ref(`chats/${friendUid}/messages/${currentUser.uid}`).remove(),
            db.ref(`chats/${currentUser.uid}/inbox/${friendUid}`).remove(),
            db.ref(`chats/${friendUid}/inbox/${currentUser.uid}`).remove()
        ]);
        
        showToast("✅ Chat berhasil dibersihkan", "success");
        
        if (currentChatWith === friendUid) {
            currentChatWith = null;
            const header = document.getElementById('chatHeader');
            const messagesContainer = document.getElementById('chatMessages');
            const inputArea = document.getElementById('chatInputArea');
            if (header) header.innerHTML = '<p class="text-small" style="color: var(--text-muted); text-align:center; padding:20px;">Pilih chat untuk memulai percakapan</p>';
            if (messagesContainer) messagesContainer.innerHTML = '<div class="chat-messages-empty">👈 Pilih chat di sebelah kiri</div>';
            if (inputArea) inputArea.style.display = 'none';
        }
        
        loadChatList();
        
    } catch (error) {
        console.error("Clear chat error:", error);
        showToast("❌ Gagal membersihkan chat", "error");
    }
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

// ======================= START CHAT FROM FRIENDS =======================

async function startChatWithFriend(friendUid, friendName, friendEmail) {
    const isFriend = await checkIsFriend(friendUid);
    if (!isFriend) {
        showToast("Anda tidak bisa chat dengan orang yang bukan teman!", "error");
        return;
    }
    
    if (typeof switchTab === 'function') {
        switchTab('chat');
    }
    
    setTimeout(() => {
        selectChat(friendUid);
    }, 500);
}

function openChatModal() {
    const modal = document.getElementById('modal-chat');
    if (modal) {
        modal.classList.add('open');
        renderChatInterface();
        loadChatList();
    }
}

// ======================= UTILITY =======================

function getAvatarUrl(name) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=00bcd4&color=fff&size=100`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

async function checkIsFriend(friendUid) {
    const snapshot = await db.ref(`friendships/list/${currentUser.uid}/${friendUid}`).once('value');
    return snapshot.exists();
}

// ======================= CLEANUP =======================

function cleanupChatSystem() {
    if (chatMessagesListener) {
        if (currentChatWith) {
            db.ref(`chats/${currentUser.uid}/messages/${currentChatWith}`).off('value', chatMessagesListener);
        }
        chatMessagesListener = null;
    }
    if (chatListeners.incoming) {
        db.ref(`chats/${currentUser.uid}/inbox`).off('value', chatListeners.incoming);
        chatListeners.incoming = null;
    }
    console.log("🧹 Chat system cleaned up");
}

// ======================= EXPORT KE GLOBAL =======================
window.initChatSystem = initChatSystem;
window.selectChat = selectChat;
window.sendChatMessage = sendChatMessage;
window.sendChatMedia = sendChatMedia;
window.deleteChatMessage = deleteChatMessage;
window.clearChat = clearChat;
window.startChatWithFriend = startChatWithFriend;
window.openChatModal = openChatModal;
window.filterChatList = filterChatList;
window.handleChatKeyPress = handleChatKeyPress;
window.cleanupChatSystem = cleanupChatSystem;