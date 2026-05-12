// friends.js - VERSION 1.1 (DENGAN TOMBOL CHAT)
// Fitur Pertemanan (Friendship System)
// Mengirim request, menerima/menolak, dan daftar teman
// Dengan integrasi Chat System

let friendsRealtimeListener = null;
let friendRequestsListener = null;

// ======================= DATA STRUCTURE =======================
// Database structure:
// friendships/requests/{requestId} = {
//   from: uid,
//   to: uid,
//   fromName: nama,
//   toName: nama,
//   fromEmail: email,
//   toEmail: email,
//   status: 'pending' | 'accepted' | 'rejected',
//   createdAt: timestamp,
//   updatedAt: timestamp
// }
//
// friendships/list/{uid}/{friendUid} = {
//   friendUid: uid,
//   friendName: nama,
//   friendEmail: email,
//   friendPhoto: photoUrl,
//   createdAt: timestamp
// }

// ======================= INISIALISASI =======================

function initFriendsSystem() {
    console.log("👥 Initializing friends system...");
    
    if (!currentUser) {
        console.log("No user logged in, skipping friends init");
        return;
    }
    
    // Setup realtime listener untuk request pertemanan
    setupFriendRequestsListener();
    
    // Setup realtime listener untuk daftar teman
    setupFriendsListListener();
    
    // Render panel friends
    renderFriendsPanel();
}

function setupFriendRequestsListener() {
    if (friendRequestsListener) {
        db.ref(`friendships/requests`).off('value', friendRequestsListener);
    }
    
    // Listener untuk request yang ditujukan ke user saat ini
    friendRequestsListener = db.ref(`friendships/requests`).on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            // Filter request untuk current user (sebagai penerima) yang masih pending
            const pendingRequests = Object.keys(data)
                .filter(key => data[key].to === currentUser.uid && data[key].status === 'pending')
                .map(key => ({ id: key, ...data[key] }));
            
            updateFriendRequestBadge(pendingRequests.length);
            renderFriendRequestsList(pendingRequests);
        } else {
            updateFriendRequestBadge(0);
            renderFriendRequestsList([]);
        }
    });
}

function setupFriendsListListener() {
    if (friendsRealtimeListener) {
        db.ref(`friendships/list/${currentUser.uid}`).off('value', friendsRealtimeListener);
    }
    
    friendsRealtimeListener = db.ref(`friendships/list/${currentUser.uid}`).on('value', (snapshot) => {
        const data = snapshot.val();
        const friendsList = data ? Object.values(data) : [];
        renderFriendsList(friendsList);
        updateFriendsCount(friendsList.length);
    });
}

// ======================= UI RENDER =======================

function renderFriendsPanel() {
    const container = document.getElementById('friendsPanel');
    if (!container) return;
    
    container.innerHTML = `
        <div class="friends-container">
            <!-- Search Friend -->
            <div class="friends-search-section">
                <h4>🔍 Cari Teman</h4>
                <div class="search-box" style="display: flex; gap: 10px;">
                    <input type="email" id="searchFriendEmail" placeholder="Cari berdasarkan email..." style="flex: 1;">
                    <button class="btn-action btn-primary" onclick="searchUserByEmail()">Cari</button>
                </div>
                <div id="searchResult" style="margin-top: 10px; display: none;"></div>
            </div>
            
            <hr>
            
            <!-- Friend Requests -->
            <div class="friends-requests-section">
                <h4>📨 Permintaan Pertemanan 
                    <span id="friendRequestBadge" class="request-badge" style="display: none;">0</span>
                </h4>
                <div id="friendRequestsList" class="friends-list">
                    <p class="text-small" style="color: var(--text-muted);">Tidak ada permintaan pertemanan</p>
                </div>
            </div>
            
            <hr>
            
            <!-- Friends List -->
            <div class="friends-list-section">
                <h4>👥 Daftar Teman 
                    <span id="friendsCount" class="count-badge">0</span>
                </h4>
                <div id="friendsList" class="friends-list">
                    <p class="text-small" style="color: var(--text-muted);">Belum ada teman. Cari dan tambahkan teman!</p>
                </div>
            </div>
        </div>
    `;
    
    // Load data awal
    if (currentUser) {
        loadFriendRequests();
        loadFriendsList();
    }
}

function updateFriendRequestBadge(count) {
    const badge = document.getElementById('friendRequestBadge');
    const floatingBtn = document.getElementById('floatingFriendsBtn');
    
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
    
    // Update floating button
    if (floatingBtn) {
        const existingBadge = floatingBtn.querySelector('.friends-badge-count');
        if (count > 0) {
            if (!existingBadge) {
                const newBadge = document.createElement('span');
                newBadge.className = 'friends-badge-count';
                newBadge.textContent = count;
                newBadge.style.cssText = `
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: #f44336;
                    color: white;
                    border-radius: 50%;
                    width: 18px;
                    height: 18px;
                    font-size: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                `;
                floatingBtn.style.position = 'relative';
                floatingBtn.appendChild(newBadge);
            } else {
                existingBadge.textContent = count;
            }
        } else if (existingBadge) {
            existingBadge.remove();
        }
    }
}

function updateFriendsCount(count) {
    const countSpan = document.getElementById('friendsCount');
    if (countSpan) {
        countSpan.textContent = count;
    }
}

function renderFriendRequestsList(requests) {
    const container = document.getElementById('friendRequestsList');
    if (!container) return;
    
    if (!requests || requests.length === 0) {
        container.innerHTML = '<p class="text-small" style="color: var(--text-muted);">📭 Tidak ada permintaan pertemanan</p>';
        return;
    }
    
    container.innerHTML = requests.map(req => `
        <div class="friend-request-item" data-request-id="${req.id}">
            <div class="friend-avatar">
                <img src="${req.fromPhoto || getAvatarUrl(req.fromName)}" alt="${escapeHtml(req.fromName)}">
            </div>
            <div class="friend-info">
                <div class="friend-name">${escapeHtml(req.fromName)}</div>
                <div class="friend-email">${escapeHtml(req.fromEmail)}</div>
                <div class="friend-request-time">${formatTimeAgo(req.createdAt)}</div>
            </div>
            <div class="friend-actions">
                <button class="btn-icon accept" onclick="acceptFriendRequest('${req.id}', '${req.from}')" title="Terima">✅</button>
                <button class="btn-icon reject" onclick="rejectFriendRequest('${req.id}', '${req.from}')" title="Tolak">❌</button>
            </div>
        </div>
    `).join('');
}

function renderFriendsList(friends) {
    const container = document.getElementById('friendsList');
    if (!container) return;
    
    if (!friends || friends.length === 0) {
        container.innerHTML = '<p class="text-small" style="color: var(--text-muted);">👥 Belum ada teman. Cari dan tambahkan teman!</p>';
        return;
    }
    
    // ========== UPDATE: TAMBAHKAN TOMBOL CHAT ==========
    container.innerHTML = friends.map(friend => `
        <div class="friend-item" data-friend-uid="${friend.friendUid}">
            <div class="friend-avatar">
                <img src="${friend.friendPhoto || getAvatarUrl(friend.friendName)}" alt="${escapeHtml(friend.friendName)}">
            </div>
            <div class="friend-info">
                <div class="friend-name">${escapeHtml(friend.friendName)}</div>
                <div class="friend-email">${escapeHtml(friend.friendEmail)}</div>
                <div class="friend-since">Teman sejak ${formatDate(friend.createdAt)}</div>
            </div>
            <div class="friend-actions">
                <button class="btn-icon chat" onclick="startChatWithFriend('${friend.friendUid}', '${escapeHtml(friend.friendName)}', '${escapeHtml(friend.friendEmail)}')" title="Chat">💬</button>
                <button class="btn-icon" onclick="viewFriendProfile('${friend.friendUid}')" title="Lihat Profil">👤</button>
                <button class="btn-icon delete" onclick="removeFriend('${friend.friendUid}', '${escapeHtml(friend.friendName)}')" title="Hapus Teman">🗑️</button>
            </div>
        </div>
    `).join('');
}

// ======================= FUNGSI PENCARIAN =======================

async function searchUserByEmail() {
    const emailInput = document.getElementById('searchFriendEmail');
    const email = emailInput.value.trim().toLowerCase();
    
    if (!email) {
        showToast("Masukkan email yang ingin dicari!", "error");
        return;
    }
    
    if (email === currentUser.email.toLowerCase()) {
        showToast("❌ Anda tidak bisa berteman dengan diri sendiri!", "error");
        return;
    }
    
    showToast("🔍 Mencari pengguna...", "info");
    
    try {
        const snapshot = await db.ref('users_auth').once('value');
        const users = snapshot.val();
        
        let foundUser = null;
        let foundUid = null;
        
        if (users) {
            for (const [uid, userData] of Object.entries(users)) {
                if (userData.email && userData.email.toLowerCase() === email) {
                    foundUser = userData;
                    foundUid = uid;
                    break;
                }
            }
        }
        
        const resultContainer = document.getElementById('searchResult');
        
        if (foundUser && foundUid) {
            const isFriend = await checkIsFriend(foundUid);
            const hasPendingRequest = await checkPendingRequest(foundUid);
            const hasIncomingRequest = await checkIncomingRequest(foundUid);
            
            let actionButton = '';
            let statusMessage = '';
            
            if (isFriend) {
                actionButton = `<button class="btn-action" disabled style="background:#4caf50;">✓ Sudah Teman</button>`;
                statusMessage = '<small style="color:#4caf50;">Anda sudah berteman</small>';
            } else if (hasPendingRequest) {
                actionButton = `<button class="btn-action" disabled style="background:#ff9800;">⏳ Menunggu Konfirmasi</button>`;
                statusMessage = '<small style="color:#ff9800;">Permintaan sudah dikirim, menunggu konfirmasi</small>';
            } else if (hasIncomingRequest) {
                actionButton = `<button class="btn-action btn-success" onclick="acceptFriendRequestByEmail('${foundUid}')">✅ Terima Permintaan</button>`;
                statusMessage = '<small style="color:#2196f3;">Pengguna ini mengirimkan permintaan pertemanan</small>';
            } else {
                actionButton = `<button class="btn-action btn-primary" onclick="sendFriendRequest('${foundUid}', '${escapeHtml(foundUser.nama)}', '${escapeHtml(foundUser.email)}')">➕ Kirim Permintaan</button>`;
            }
            
            resultContainer.style.display = 'block';
            resultContainer.innerHTML = `
                <div class="search-result-item">
                    <div class="friend-avatar">
                        <img src="${foundUser.photoUrl || getAvatarUrl(foundUser.nama)}" alt="${escapeHtml(foundUser.nama)}">
                    </div>
                    <div class="friend-info">
                        <div class="friend-name">${escapeHtml(foundUser.nama)}</div>
                        <div class="friend-email">${escapeHtml(foundUser.email)}</div>
                        <div class="friend-role">${foundUser.role === 'admin' ? '👑 Admin' : (foundUser.role === 'guru' ? '👨‍🏫 Guru' : '👨‍🎓 Siswa')}</div>
                        ${statusMessage}
                    </div>
                    <div class="friend-actions">
                        ${actionButton}
                    </div>
                </div>
            `;
        } else {
            resultContainer.style.display = 'block';
            resultContainer.innerHTML = `
                <div class="search-result-item error">
                    <div class="friend-info">
                        <div class="friend-name">❌ Pengguna tidak ditemukan</div>
                        <div class="friend-email">Email "${escapeHtml(email)}" tidak terdaftar di sistem</div>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error("Search error:", error);
        showToast("❌ Gagal mencari pengguna", "error");
    }
}

// ======================= FUNGSI PERTEMANAN =======================

async function checkIsFriend(friendUid) {
    const snapshot = await db.ref(`friendships/list/${currentUser.uid}/${friendUid}`).once('value');
    return snapshot.exists();
}

async function checkPendingRequest(friendUid) {
    const snapshot = await db.ref('friendships/requests').once('value');
    const requests = snapshot.val();
    
    if (!requests) return false;
    
    return Object.values(requests).some(req => 
        req.from === currentUser.uid && req.to === friendUid && req.status === 'pending'
    );
}

async function checkIncomingRequest(friendUid) {
    const snapshot = await db.ref('friendships/requests').once('value');
    const requests = snapshot.val();
    
    if (!requests) return false;
    
    return Object.values(requests).some(req => 
        req.from === friendUid && req.to === currentUser.uid && req.status === 'pending'
    );
}

async function sendFriendRequest(toUid, toName, toEmail) {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    if (toUid === currentUser.uid) {
        showToast("❌ Anda tidak bisa mengirim request ke diri sendiri!", "error");
        return;
    }
    
    const isFriend = await checkIsFriend(toUid);
    if (isFriend) {
        showToast("👥 Anda sudah berteman dengan pengguna ini!", "info");
        return;
    }
    
    const hasPending = await checkPendingRequest(toUid);
    if (hasPending) {
        showToast("⏳ Permintaan pertemanan sudah dikirim sebelumnya!", "info");
        return;
    }
    
    const hasIncoming = await checkIncomingRequest(toUid);
    if (hasIncoming) {
        const incomingReq = await findIncomingRequest(toUid);
        if (incomingReq) {
            await acceptFriendRequest(incomingReq.id, toUid);
            return;
        }
    }
    
    const requestId = `${currentUser.uid}_${toUid}_${Date.now()}`;
    
    const requestData = {
        from: currentUser.uid,
        to: toUid,
        fromName: currentUser.nama,
        toName: toName,
        fromEmail: currentUser.email,
        toEmail: toEmail,
        fromPhoto: currentUser.photoUrl || null,
        toPhoto: null,
        status: 'pending',
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    
    try {
        await db.ref(`friendships/requests/${requestId}`).set(requestData);
        showToast(`✅ Permintaan pertemanan dikirim ke ${toName}`, "success");
        
        const resultContainer = document.getElementById('searchResult');
        if (resultContainer) {
            resultContainer.style.display = 'none';
            resultContainer.innerHTML = '';
        }
        
        const emailInput = document.getElementById('searchFriendEmail');
        if (emailInput) emailInput.value = '';
        
    } catch (error) {
        console.error("Send friend request error:", error);
        showToast("❌ Gagal mengirim permintaan", "error");
    }
}

async function findIncomingRequest(fromUid) {
    const snapshot = await db.ref('friendships/requests').once('value');
    const requests = snapshot.val();
    
    if (!requests) return null;
    
    for (const [id, req] of Object.entries(requests)) {
        if (req.from === fromUid && req.to === currentUser.uid && req.status === 'pending') {
            return { id, ...req };
        }
    }
    return null;
}

async function acceptFriendRequest(requestId, fromUid) {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    showToast("⏳ Memproses...", "info");
    
    try {
        await db.ref(`friendships/requests/${requestId}`).update({
            status: 'accepted',
            updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        const now = firebase.database.ServerValue.TIMESTAMP;
        
        const friendData1 = {
            friendUid: fromUid,
            friendName: currentUser.nama,
            friendEmail: currentUser.email,
            friendPhoto: currentUser.photoUrl || null,
            createdAt: now
        };
        
        const friendData2 = {
            friendUid: currentUser.uid,
            friendName: currentUser.nama,
            friendEmail: currentUser.email,
            friendPhoto: currentUser.photoUrl || null,
            createdAt: now
        };
        
        const senderSnapshot = await db.ref(`users_auth/${fromUid}`).once('value');
        const senderData = senderSnapshot.val();
        
        if (senderData) {
            friendData2.friendName = senderData.nama;
            friendData2.friendEmail = senderData.email;
            friendData2.friendPhoto = senderData.photoUrl || null;
        }
        
        await Promise.all([
            db.ref(`friendships/list/${currentUser.uid}/${fromUid}`).set(friendData1),
            db.ref(`friendships/list/${fromUid}/${currentUser.uid}`).set(friendData2)
        ]);
        
        showToast(`✅ Anda sekarang berteman!`, "success");
        
    } catch (error) {
        console.error("Accept friend request error:", error);
        showToast("❌ Gagal menerima permintaan", "error");
    }
}

async function acceptFriendRequestByEmail(fromUid) {
    const request = await findIncomingRequest(fromUid);
    if (request) {
        await acceptFriendRequest(request.id, fromUid);
        searchUserByEmail();
    }
}

async function rejectFriendRequest(requestId, fromUid) {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    if (!confirm("❌ Tolak permintaan pertemanan ini?")) return;
    
    try {
        await db.ref(`friendships/requests/${requestId}`).update({
            status: 'rejected',
            updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        showToast(`✅ Permintaan pertemanan ditolak`, "info");
        
        setTimeout(() => {
            db.ref(`friendships/requests/${requestId}`).remove();
        }, 2000);
        
    } catch (error) {
        console.error("Reject friend request error:", error);
        showToast("❌ Gagal menolak permintaan", "error");
    }
}

async function removeFriend(friendUid, friendName) {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    if (!confirm(`⚠️ Hapus ${friendName} dari daftar teman?\n\nAnda tidak akan bisa melihat profil dan chat dengannya.`)) return;
    
    try {
        await Promise.all([
            db.ref(`friendships/list/${currentUser.uid}/${friendUid}`).remove(),
            db.ref(`friendships/list/${friendUid}/${currentUser.uid}`).remove()
        ]);
        
        showToast(`✅ ${friendName} telah dihapus dari daftar teman`, "success");
        
    } catch (error) {
        console.error("Remove friend error:", error);
        showToast("❌ Gagal menghapus teman", "error");
    }
}

// ======================= FUNGSI CHAT INTEGRATION =======================

async function startChatWithFriend(friendUid, friendName, friendEmail) {
    // Cek apakah masih teman
    const isFriend = await checkIsFriend(friendUid);
    if (!isFriend) {
        showToast("Anda tidak bisa chat dengan orang yang bukan teman!", "error");
        return;
    }
    
    // Cek apakah fungsi switchTab dan selectChat tersedia
    if (typeof switchTab === 'function') {
        // Switch ke tab chat
        switchTab('chat');
    } else {
        console.warn("switchTab not found, opening modal instead");
        if (typeof openChatModal === 'function') {
            openChatModal();
        }
    }
    
    // Tunggu DOM chat siap, lalu select chat
    setTimeout(() => {
        if (typeof selectChat === 'function') {
            selectChat(friendUid);
        } else {
            console.warn("selectChat not found");
            showToast("⚠️ Fitur chat sedang dimuat, coba lagi nanti", "warning");
        }
    }, 500);
}

// ======================= LOAD DATA =======================

async function loadFriendRequests() {
    if (!currentUser) return;
    
    const snapshot = await db.ref('friendships/requests').once('value');
    const data = snapshot.val();
    
    if (data) {
        const pendingRequests = Object.keys(data)
            .filter(key => data[key].to === currentUser.uid && data[key].status === 'pending')
            .map(key => ({ id: key, ...data[key] }));
        
        updateFriendRequestBadge(pendingRequests.length);
        renderFriendRequestsList(pendingRequests);
    }
}

async function loadFriendsList() {
    if (!currentUser) return;
    
    const snapshot = await db.ref(`friendships/list/${currentUser.uid}`).once('value');
    const data = snapshot.val();
    const friendsList = data ? Object.values(data) : [];
    renderFriendsList(friendsList);
    updateFriendsCount(friendsList.length);
}

// ======================= UTILITY =======================

function getAvatarUrl(name) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=00bcd4&color=fff&size=100`;
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (days > 0) return `${days} hari yang lalu`;
    if (hours > 0) return `${hours} jam yang lalu`;
    if (minutes > 0) return `${minutes} menit yang lalu`;
    return 'baru saja';
}

function formatDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

function viewFriendProfile(friendUid) {
    openFriendProfileModal(friendUid);
}

async function openFriendProfileModal(friendUid) {
    try {
        const snapshot = await db.ref(`users_auth/${friendUid}`).once('value');
        const friendData = snapshot.val();
        
        if (!friendData) {
            showToast("❌ Data teman tidak ditemukan", "error");
            return;
        }
        
        let modalHtml = `
            <div id="modal-friend-profile" class="modal-overlay open">
                <div class="modal-box">
                    <div class="modal-title">
                        <span>👤 Profil ${escapeHtml(friendData.nama)}</span>
                        <span onclick="closeModal('modal-friend-profile')">✖</span>
                    </div>
                    <div style="text-align: center; padding: 20px;">
                        <img src="${friendData.photoUrl || getAvatarUrl(friendData.nama)}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 3px solid var(--primary);">
                        <h3 style="margin-top: 10px;">${escapeHtml(friendData.nama)}</h3>
                        <p style="color: var(--text-muted);">${escapeHtml(friendData.email)}</p>
                        <div class="role-badge role-${friendData.role || 'siswa'}">${(friendData.role || 'siswa').toUpperCase()}</div>
                    </div>
                    <div class="form-group" style="padding: 0 20px;">
                        <label>📚 Kelas</label>
                        <p>${friendData.kelas || '-'}</p>
                    </div>
                    <div class="form-group" style="padding: 0 20px;">
                        <label>🎓 Jurusan / Mata Pelajaran</label>
                        <p>${friendData.jurusan || friendData.subject || '-'}</p>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-cancel" onclick="closeModal('modal-friend-profile')">Tutup</button>
                        <button class="btn-primary" onclick="startChatFromProfile('${friendUid}', '${escapeHtml(friendData.nama)}', '${escapeHtml(friendData.email)}')">💬 Chat</button>
                        <button class="btn-danger" onclick="removeFriendAndClose('${friendUid}', '${escapeHtml(friendData.nama)}')">🗑️ Hapus Teman</button>
                    </div>
                </div>
            </div>
        `;
        
        const existingModal = document.getElementById('modal-friend-profile');
        if (existingModal) existingModal.remove();
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
    } catch (error) {
        console.error("Load friend profile error:", error);
        showToast("❌ Gagal memuat profil", "error");
    }
}

async function startChatFromProfile(friendUid, friendName, friendEmail) {
    closeModal('modal-friend-profile');
    await startChatWithFriend(friendUid, friendName, friendEmail);
}

async function removeFriendAndClose(friendUid, friendName) {
    await removeFriend(friendUid, friendName);
    closeModal('modal-friend-profile');
}

// ======================= CLEANUP =======================

function cleanupFriendsSystem() {
    if (friendRequestsListener) {
        db.ref('friendships/requests').off('value', friendRequestsListener);
        friendRequestsListener = null;
    }
    if (friendsRealtimeListener) {
        db.ref(`friendships/list/${currentUser?.uid}`).off('value', friendsRealtimeListener);
        friendsRealtimeListener = null;
    }
    console.log("🧹 Friends system cleaned up");
}

// ======================= EXPORT KE GLOBAL =======================
window.initFriendsSystem = initFriendsSystem;
window.searchUserByEmail = searchUserByEmail;
window.sendFriendRequest = sendFriendRequest;
window.acceptFriendRequest = acceptFriendRequest;
window.acceptFriendRequestByEmail = acceptFriendRequestByEmail;
window.rejectFriendRequest = rejectFriendRequest;
window.removeFriend = removeFriend;
window.viewFriendProfile = viewFriendProfile;
window.removeFriendAndClose = removeFriendAndClose;
window.startChatWithFriend = startChatWithFriend;
window.startChatFromProfile = startChatFromProfile;
window.cleanupFriendsSystem = cleanupFriendsSystem;

// Auto init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (currentUser) initFriendsSystem();
        }, 2000);
    });
}