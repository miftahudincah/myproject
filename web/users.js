// users.js - VERSION 2.1 (FIXED - Manajemen Pengguna)
// Fungsi untuk mengelola user, kode registrasi, dan role management
// Dengan real-time updates dan enhanced UI

let usersRealtimeListener = null;
let codesRealtimeListener = null;
let lastCodeCount = 0;

// ======================= REAL-TIME INITIALIZATION =======================

/**
 * Inisialisasi real-time listener untuk users dan codes
 */
function initRealtimeUsers() {
    console.log("🔄 Initializing real-time users system...");
    
    // Listener untuk perubahan data users_auth
    if (usersRealtimeListener) {
        db.ref('users_auth').off('value', usersRealtimeListener);
    }
    
    usersRealtimeListener = db.ref('users_auth').on('value', (snapshot) => {
        const data = snapshot.val();
        if (typeof dbData !== 'undefined') {
            const oldCount = dbData.users_auth?.length || 0;
            dbData.users_auth = [];
            if (data) {
                Object.keys(data).forEach(uid => {
                    dbData.users_auth.push({ uid: uid, ...data[uid] });
                });
            }
            const newCount = dbData.users_auth.length;
            
            if (oldCount !== newCount) {
                console.log(`👥 Users data updated: ${oldCount} -> ${newCount} users`);
                showUserUpdateNotification(newCount - oldCount);
            }
            
            // Render ulang tabel users
            if (typeof renderUsersTable === 'function') {
                requestAnimationFrame(() => renderUsersTable());
            }
        }
    });
    
    // Listener untuk kode registrasi
    if (codesRealtimeListener) {
        db.ref('codes').off('value', codesRealtimeListener);
    }
    
    codesRealtimeListener = db.ref('codes').on('value', (snapshot) => {
        const data = snapshot.val();
        if (typeof dbData !== 'undefined') {
            // Cleanup expired codes (5 jam)
            const now = Date.now();
            const fiveHoursInMs = 5 * 60 * 60 * 1000;
            let hasExpired = false;
            
            if (data) {
                Object.keys(data).forEach(key => {
                    const item = data[key];
                    if (item && item.createdAt && (now - item.createdAt > fiveHoursInMs)) {
                        db.ref('codes/' + key).remove();
                        hasExpired = true;
                    }
                });
            }
            
            dbData.codes = [];
            if (data) {
                Object.keys(data).forEach(key => {
                    dbData.codes.push({ code: key, ...data[key] });
                });
            }
            
            const newCount = dbData.codes.length;
            if (lastCodeCount !== newCount) {
                if (newCount > lastCodeCount) {
                    showToast(`🔑 Kode registrasi baru telah dibuat!`, "success");
                    playNotificationSound();
                }
                lastCodeCount = newCount;
            }
            
            if (typeof renderCodesTable === 'function') {
                requestAnimationFrame(() => renderCodesTable());
            }
            
            // Update statistik kode
            updateCodesStatistics();
        }
    });
}

/**
 * Tampilkan notifikasi untuk update user
 */
function showUserUpdateNotification(changeCount) {
    if (changeCount > 0) {
        showToast(`👥 ${changeCount} pengguna baru terdaftar!`, "success");
        flashUsersTab();
    } else if (changeCount < 0) {
        showToast(`👤 ${Math.abs(changeCount)} pengguna telah dihapus`, "info");
    }
}

/**
 * Flash effect pada tab users
 */
function flashUsersTab() {
    const usersTab = document.getElementById('tab-users');
    if (usersTab && usersTab.classList.contains('active')) {
        const container = document.querySelector('#tab-users .table-container:last-child');
        if (container) {
            container.style.transition = 'background-color 0.3s';
            container.style.backgroundColor = 'rgba(74, 144, 226, 0.1)';
            setTimeout(() => {
                container.style.backgroundColor = '';
            }, 500);
        }
    }
}

/**
 * Update statistik kode registrasi
 */
function updateCodesStatistics() {
    const statsContainer = document.getElementById('codesStats');
    if (!statsContainer) {
        createCodesStatsContainer();
        return;
    }
    
    const activeCodes = dbData.codes.filter(c => !c.used).length;
    const usedCodes = dbData.codes.filter(c => c.used).length;
    const studentCodes = dbData.codes.filter(c => c.type === 'siswa' && !c.used).length;
    const teacherCodes = dbData.codes.filter(c => c.type === 'guru' && !c.used).length;
    
    statsContainer.innerHTML = `
        <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 15px; padding: 10px; background: #1e1e1e; border-radius: 8px;">
            <div><span style="color: #4caf50;">🟢 Aktif:</span> <strong>${activeCodes}</strong></div>
            <div><span style="color: #888;">🔴 Terpakai:</span> <strong>${usedCodes}</strong></div>
            <div><span style="color: #4a90e2;">👨‍🎓 Siswa:</span> <strong>${studentCodes}</strong></div>
            <div><span style="color: #ff9800;">👨‍🏫 Guru:</span> <strong>${teacherCodes}</strong></div>
            <div><span style="color: #888;">📊 Total:</span> <strong>${dbData.codes.length}</strong></div>
        </div>
    `;
}

function createCodesStatsContainer() {
    const keyBox = document.querySelector('#tab-users .key-box');
    if (keyBox && !document.getElementById('codesStats')) {
        const statsDiv = document.createElement('div');
        statsDiv.id = 'codesStats';
        statsDiv.style.marginTop = '10px';
        keyBox.insertAdjacentElement('afterend', statsDiv);
    }
}

/**
 * Play notifikasi suara
 */
function playNotificationSound() {
    if (typeof Audio !== 'undefined') {
        try {
            const beep = new Audio('data:audio/wav;base64,U3RlYWx0aCBzb3VuZA==');
            beep.volume = 0.3;
            beep.play().catch(() => {});
        } catch(e) {}
    }
}

// ======================= DROPDOWN SISWA =======================

function populateStudentSelectForCode() {
    const select = document.getElementById('selectStudentForCode');
    if(!select) return;
    
    const currentVal = select.value;
    const currentSelectedText = select.options[select.selectedIndex]?.text;

    select.innerHTML = '<option value="">-- Pilih Siswa --</option>';
    
    const registeredUserIds = dbData.users_auth?.map(u => u.fpId) || [];
    const availableStudents = dbData.users.filter(s => !registeredUserIds.includes(s.id));
    
    if (availableStudents.length === 0) {
        select.innerHTML += '<option value="" disabled>✨ Semua siswa sudah memiliki akun</option>';
    } else {
        availableStudents.forEach(s => {
            select.innerHTML += `<option value="${s.id}">${escapeHtmlString(s.nama)} (ID: ${s.id}) | Kelas ${s.kelas || '-'}</option>`;
        });
    }
    
    if (currentVal && availableStudents.some(s => s.id == currentVal)) {
        select.value = currentVal;
    } else if (currentSelectedText && currentVal) {
        const match = availableStudents.find(s => 
            s.nama === currentSelectedText.split('(')[0].trim()
        );
        if (match) select.value = match.id;
    }
}

// ======================= GENERATE KODE REGISTRASI =======================

function generateRegistrationCode() {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    if (currentUser.role !== 'admin' && currentUser.role !== 'guru') {
        showToast("⛔ Hanya Admin dan Guru yang dapat generate kode!", "error");
        return;
    }
    
    const targetType = document.querySelector('input[name="genTarget"]:checked')?.value;
    if (!targetType) {
        showToast("Pilih target kode (Siswa/Guru)!", "error");
        return;
    }
    
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `REG-${timestamp.slice(-3)}${random}`;
    
    const codeData = {
        used: false, 
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        type: targetType,
        createdBy: currentUser.nama || currentUser.email
    };

    const btn = document.querySelector('button[onclick="generateRegistrationCode()"]');
    const originalText = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Generating...';
    }

    if (targetType === 'siswa') {
        const selectedId = document.getElementById('selectStudentForCode').value;
        if (!selectedId) {
            showToast("⚠️ Harap pilih Siswa terlebih dahulu!", "error");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
            return;
        }

        const existingUser = dbData.users_auth?.find(u => u.fpId == selectedId);
        if (existingUser) {
            showToast(`❌ GAGAL: ID Siswa (${selectedId}) sudah terdaftar pada akun (${existingUser.email}).`, "error");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
            return;
        }

        const existingCode = dbData.codes?.find(c => 
            c.linkedId == selectedId && !c.used && c.type === 'siswa'
        );
        if (existingCode) {
            showToast(`❌ GAGAL: Siswa ini masih memiliki kode aktif (${existingCode.code}). Tunggu expired!`, "error");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
            return;
        }

        codeData.linkedId = selectedId;
        const student = dbData.users.find(s => s.id == selectedId);
        const studentName = student?.nama || selectedId;

        db.ref('codes/' + code).set(codeData).then(() => {
            const display = document.getElementById('generatedKeyDisplay');
            display.style.display = 'block';
            display.innerHTML = `
                <div style="background: #1a1a2e; border-radius: 8px; padding: 15px; margin: 10px 0; border-left: 4px solid #4a90e2;">
                    <div style="font-size: 12px; color: #888;">✨ KODE REGISTRASI BERHASIL DIGENERATE ✨</div>
                    <div style="font-size: 20px; font-family: monospace; font-weight: bold; color: #4a90e2; margin: 10px 0;">${code}</div>
                    <div>Tipe: <strong>${targetType.toUpperCase()}</strong></div>
                    <div>Terkunci ID: <strong>${selectedId}</strong> - ${studentName}</div>
                    <div>Dibuat oleh: <strong>${currentUser.nama || currentUser.email}</strong></div>
                    <div style="margin-top: 10px;"><small>⏰ Kode akan expired dalam 5 jam</small></div>
                    <button class="btn-action btn-success" onclick="copyToClipboard('${code}')" style="margin-top: 10px;">📋 Copy Kode</button>
                </div>
            `;
            showToast(`✅ Kode untuk ${studentName} berhasil dibuat!`, "success");
        }).catch(err => {
            console.error("Generate code error:", err);
            showToast("❌ Gagal membuat kode: " + err.message, "error");
        }).finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });

    } else {
        db.ref('codes/' + code).set(codeData).then(() => {
            const display = document.getElementById('generatedKeyDisplay');
            display.style.display = 'block';
            display.innerHTML = `
                <div style="background: #1a1a2e; border-radius: 8px; padding: 15px; margin: 10px 0; border-left: 4px solid #ff9800;">
                    <div style="font-size: 12px; color: #888;">✨ KODE REGISTRASI GURU ✨</div>
                    <div style="font-size: 20px; font-family: monospace; font-weight: bold; color: #ff9800; margin: 10px 0;">${code}</div>
                    <div>Tipe: <strong>${targetType.toUpperCase()}</strong></div>
                    <div>Dibuat oleh: <strong>${currentUser.nama || currentUser.email}</strong></div>
                    <div style="margin-top: 10px;"><small>⏰ Kode akan expired dalam 5 jam</small></div>
                    <button class="btn-action btn-success" onclick="copyToClipboard('${code}')" style="margin-top: 10px;">📋 Copy Kode</button>
                </div>
            `;
            showToast(`✅ Kode registrasi Guru berhasil dibuat!`, "success");
        }).catch(err => {
            console.error("Generate code error:", err);
            showToast("❌ Gagal membuat kode: " + err.message, "error");
        }).finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast("📋 Kode berhasil disalin!", "success");
    }).catch(() => {
        showToast("❌ Gagal menyalin kode", "error");
    });
}

// ======================= DELETE CODE =======================

function deleteCode(code) {
    const codeData = dbData.codes.find(c => c.code === code);
    const codeInfo = codeData?.type ? `${codeData.type.toUpperCase()} - ${code}` : code;
    
    if(!confirm(`⚠️ Yakin ingin menghapus kode: ${codeInfo}?\n\nKode yang sudah dihapus tidak dapat digunakan lagi.`)) return;
    
    db.ref('codes/' + code).remove()
        .then(() => {
            showToast(`✅ Kode ${code} berhasil dihapus`, "success");
        })
        .catch((err) => {
            console.error("Delete code error:", err);
            showToast("❌ Gagal menghapus kode: " + err.message, "error");
        });
}

// ======================= RENDER CODES TABLE =======================

function renderCodesTable() {
    const tbody = document.getElementById('tbody-codes');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (!dbData.codes || dbData.codes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 30px; color:#888;">
            🔑 Belum ada kode registrasi. Generate kode di atas.
        </td></tr>`;
        return;
    }
    
    const sorted = [...dbData.codes].reverse();
    
    sorted.forEach(c => {
        const typeLabel = c.type ? c.type.toUpperCase() : 'UMUM';
        const typeIcon = c.type === 'siswa' ? '👨‍🎓' : (c.type === 'guru' ? '👨‍🏫' : '🔑');
        const linkedLabel = c.linkedId ? `<br><small style="color:#888">🔒 ID: ${c.linkedId}</small>` : '';
        const createdByName = c.createdBy ? `<br><small>👤 ${c.createdBy}</small>` : '';
        const timeRemaining = getCodeTimeRemaining(c.createdAt);
        
        tbody.innerHTML += `
            <tr class="${!c.used && timeRemaining?.includes('menit') ? 'code-expiring-soon' : ''}">
                <td style="font-family:monospace; font-weight:bold;">
                    <span style="color:${c.type === 'siswa' ? '#4a90e2' : '#ff9800'}">${typeIcon}</span>
                    <strong>${c.code}</strong>
                    <br>
                    <small style="font-weight:normal; color:#888">${typeLabel}${linkedLabel}${createdByName}</small>
                </td>
                <td>
                    ${c.used ? 
                        '<span style="color:#4caf50;">✅ Terpakai</span>' : 
                        `<span style="color:#ff9800;">🟢 Aktif</span>
                         ${timeRemaining ? `<br><small style="color:#888;">⏰ ${timeRemaining}</small>` : ''}`
                    }
                </td>
                <td style="font-size: 12px;">${new Date(c.createdAt).toLocaleString('id-ID')}</td>
                <td style="font-size: 12px;">${c.userId ? c.userId.substring(0, 20) + '...' : '-'}</td>
                <td>
                    ${!c.used ? `
                        <button class="btn-icon" onclick="copyToClipboard('${c.code}')" title="Salin Kode" style="background:transparent; border:none; cursor:pointer; color:#4a90e2;">📋</button>
                        <button class="btn-icon delete" onclick="deleteCode('${c.code}')" title="Hapus Kode">🗑️</button>
                    ` : '-'}
                </td>
            </tr>
        `;
    });
    
    updateCodesStatistics();
}

function getCodeTimeRemaining(createdAt) {
    if (!createdAt) return null;
    
    const now = Date.now();
    const expiredAt = createdAt + (5 * 60 * 60 * 1000);
    const remaining = expiredAt - now;
    
    if (remaining <= 0) return 'Expired';
    
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    
    if (hours > 0) return `${hours} jam ${minutes} menit`;
    else if (minutes > 0) return `${minutes} menit`;
    else return '< 1 menit';
}

// ======================= UPDATE USER ROLE =======================

function updateUserRole(uid, newRole) {
    if (!currentUser || currentUser.role !== 'admin') {
        showToast("⛔ Hanya Admin yang dapat mengubah role!", "error");
        return;
    }
    
    const user = dbData.users_auth.find(u => u.uid === uid);
    if (!user) {
        showToast("❌ User tidak ditemukan!", "error");
        return;
    }
    
    const roleNames = { siswa: 'Siswa', guru: 'Guru', admin: 'Admin' };
    
    if(!confirm(`⚠️ Yakin ingin mengubah role ${user.nama} dari ${roleNames[user.role]} menjadi ${roleNames[newRole]}?`)) return;
    
    const btn = document.querySelector(`select[onchange*="updateUserRole('${uid}']`);
    if (btn) btn.disabled = true;
    
    db.ref('users_auth/' + uid).update({
        role: newRole,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    }).then(() => {
        showToast(`✅ Role ${user.nama} berhasil diubah menjadi ${roleNames[newRole]}`, "success");
        
        if (currentUser.uid === uid) {
            currentUser.role = newRole;
            if (typeof saveUserToLocalStorage === 'function') saveUserToLocalStorage(currentUser);
            if (typeof applyRolePermissions === 'function') applyRolePermissions();
            if (typeof updateUserInterface === 'function') updateUserInterface();
        }
    }).catch((err) => {
        console.error("Update role error:", err);
        showToast("❌ Gagal mengubah role: " + err.message, "error");
    }).finally(() => {
        if (btn) btn.disabled = false;
    });
}

// ======================= RENDER USERS TABLE (DIPERBAIKI) =======================

function renderUsersTable() {
    console.log("🎨 renderUsersTable dipanggil");
    
    const tbody = document.getElementById('tbody-users');
    const searchInput = document.getElementById('searchUser');
    const search = searchInput?.value.toLowerCase() || '';
    
    if (!tbody) {
        console.warn("⚠️ tbody-users tidak ditemukan!");
        return;
    }
    
    tbody.innerHTML = '';

    if (!dbData.users_auth || dbData.users_auth.length === 0) {
        console.log("📭 Tidak ada data users_auth");
        tbody.innerHTML = `<td><td colspan="6" style="text-align:center; padding: 30px; color:#888;">
            👥 Belum ada pengguna terdaftar.
        </td></tr>`;
        return;
    }

    console.log(`📊 Memproses ${dbData.users_auth.length} user, filter: "${search}"`);
    
    // Filter user yang memiliki nama (abaikan yang tidak punya nama)
    let data = dbData.users_auth.filter(u => u.nama && u.nama.toLowerCase().includes(search));
    
    // Sort by role
    const roleOrder = { admin: 0, guru: 1, siswa: 2 };
    data.sort((a, b) => (roleOrder[a.role] || 3) - (roleOrder[b.role] || 3));

    if (data.length === 0) {
        tbody.innerHTML = `</table><td colspan="6" style="text-align:center; padding: 30px; color:#888;">
            🔍 Tidak ada pengguna yang cocok dengan pencarian.
        <\/td><\/tr>`;
        return;
    }

    data.forEach(u => {
        const isMe = (currentUser && currentUser.uid === u.uid);
        const avatar = u.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nama || 'User')}&background=random&color=fff&size=40`;
        
        let roleHtml = '';
        let actionsHtml = '-';

        if (currentUser && currentUser.role === 'admin' && !isMe) {
            roleHtml = `
                <select class="form-control" onchange="updateUserRole('${u.uid}', this.value)" 
                        style="background:#2c2c2c; color:white; border:1px solid #444; padding:5px; border-radius:4px; font-size:0.8rem;">
                    <option value="siswa" ${u.role === 'siswa' ? 'selected' : ''}>👨‍🎓 Siswa</option>
                    <option value="guru" ${u.role === 'guru' ? 'selected' : ''}>👨‍🏫 Guru</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>👑 Admin</option>
                </select>
            `;
            actionsHtml = `
                <button class="btn-icon delete" onclick="deleteUser('${u.uid}', '${escapeHtmlString(u.nama)}')" 
                        title="Hapus User" style="background:transparent; border:none; cursor:pointer; color:#f44336; font-size:18px;">
                    🗑️
                </button>
                <button class="btn-icon" onclick="resetUserPassword('${u.email}')" 
                        title="Reset Password" style="background:transparent; border:none; cursor:pointer; color:#ff9800; font-size:18px;">
                    🔑
                </button>
            `;
        } else {
            let roleIcon = '👨‍🎓';
            let roleClass = 'role-siswa';
            if (u.role === 'admin') {
                roleIcon = '👑';
                roleClass = 'role-admin';
            } else if (u.role === 'guru') {
                roleIcon = '👨‍🏫';
                roleClass = 'role-guru';
            }
            
            roleHtml = `<span class="role-badge ${roleClass}">${roleIcon} ${u.role.toUpperCase()}</span>`;
            if (isMe) roleHtml += ` <small style="color:#4a90e2;">(Anda)</small>`;
        }

        let detailText = '';
        let detailIcon = '';
        if (u.role === 'siswa') {
            detailIcon = '📚';
            detailText = `${u.kelas || '-'} / ${u.jurusan || '-'}`;
        } else if (u.role === 'guru') {
            detailIcon = '📖';
            detailText = u.subject || '-';
        } else {
            detailIcon = '⚙️';
            detailText = 'Administrator';
        }

        const registeredDate = u.registeredAt ? new Date(u.registeredAt).toLocaleDateString('id-ID') : '-';

        tbody.innerHTML += `
            <tr class="${isMe ? 'current-user-row' : ''}">
                <td style="text-align:center;">
                    <img src="${avatar}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">
                <\/td>
                <td>
                    <strong>${escapeHtmlString(u.nama)}</strong>
                    ${isMe ? '<br><small style="color:#4a90e2;">Akun Anda</small>' : ''}
                <\/td>
                <td style="color:#aaa; font-size:0.85rem;">${u.email || '-'}<\/td>
                <td>${roleHtml}<\/td>
                <td style="color:#888; font-size:0.8rem;">
                    ${detailIcon} ${escapeHtmlString(detailText)}<br>
                    <small>📅 ${registeredDate}</small>
                <\/td>
                <td style="text-align:center;">${actionsHtml}<\/td>
            <\/tr>
        `;
    });
    
    console.log(`✅ renderUsersTable: ${data.length} users ditampilkan`);
}

function resetUserPassword(email) {
    if (!email) {
        showToast("❌ Email tidak valid!", "error");
        return;
    }
    
    if (!confirm(`⚠️ Kirim link reset password ke ${email}?`)) return;
    
    auth.sendPasswordResetEmail(email)
        .then(() => {
            showToast(`✅ Link reset password telah dikirim ke ${email}`, "success");
        })
        .catch((err) => {
            console.error("Reset password error:", err);
            if (err.code === 'auth/user-not-found') {
                showToast("❌ Email tersebut tidak terdaftar di Firebase Auth!", "error");
            } else {
                showToast("❌ Gagal mengirim: " + err.message, "error");
            }
        });
}

function deleteUser(uid, nama) {
    if (!currentUser || currentUser.role !== 'admin') {
        showToast("⛔ Hanya Admin yang dapat menghapus user!", "error");
        return;
    }
    
    if (currentUser.uid === uid) {
        showToast("❌ Anda tidak dapat menghapus akun sendiri!", "error");
        return;
    }
    
    if(!confirm(`⚠️ Yakin ingin menghapus user: ${nama}?\n\nUser ini akan kehilangan akses login.\nData absensi yang terkait tidak akan terpengaruh.\n\nTINDAKAN INI TIDAK DAPAT DIBATALKAN!`)) return;
    
    const btn = document.querySelector(`button[onclick*="deleteUser('${uid}']`);
    if (btn) btn.disabled = true;
    
    db.ref('users_auth/' + uid).remove()
        .then(() => {
            showToast(`✅ User "${nama}" berhasil dihapus dari Database.`, "success");
        })
        .catch((err) => {
            console.error("Delete user error:", err);
            showToast("❌ Gagal menghapus: " + err.message, "error");
        })
        .finally(() => {
            if (btn) btn.disabled = false;
        });
}

function resetSystemData() {
    if (!currentUser || currentUser.role !== 'admin') {
        showToast("⛔ Hanya Admin yang dapat mereset sistem!", "error");
        return;
    }
    
    if(!confirm("🚨 PERINGATAN BERAT! 🚨\n\nSemua data akan dihapus:\n- Data siswa (users)\n- Data absensi\n- Kode registrasi\n- Data pengguna (users_auth)\n\nTINDAKAN INI TIDAK DAPAT DIBATALKAN!\n\nKetik 'RESET' untuk konfirmasi:")) return;
    
    const confirmation = prompt("Ketik 'RESET' untuk konfirmasi:");
    if (confirmation !== "RESET") {
        showToast("❌ Reset dibatalkan", "error");
        return;
    }
    
    showToast("⏳ Mereset data sistem...", "info");
    
    const promises = [
        db.ref('users').remove(),
        db.ref('absensi').remove(),
        db.ref('codes').remove(),
        db.ref('users_auth').remove()
    ];
    
    Promise.all(promises)
        .then(() => {
            showToast("✅ Semua data berhasil direset!", "success");
            setTimeout(() => {
                auth.signOut().then(() => {
                    location.reload();
                });
            }, 2000);
        })
        .catch((err) => {
            console.error("Reset error:", err);
            showToast("❌ Gagal mereset: " + err.message, "error");
        });
}

// ======================= CLEANUP =======================

function cleanupUsersSystem() {
    if (usersRealtimeListener) {
        db.ref('users_auth').off('value', usersRealtimeListener);
        usersRealtimeListener = null;
    }
    if (codesRealtimeListener) {
        db.ref('codes').off('value', codesRealtimeListener);
        codesRealtimeListener = null;
    }
    console.log("🧹 Users system cleaned up");
}

// ======================= UTILITY =======================

function escapeHtmlString(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ======================= AUTO INIT =======================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (currentUser) {
                initRealtimeUsers();
            }
        }, 1500);
    });
} else {
    setTimeout(() => {
        if (currentUser) {
            initRealtimeUsers();
        }
    }, 1500);
}

// Export ke global scope
window.populateStudentSelectForCode = populateStudentSelectForCode;
window.generateRegistrationCode = generateRegistrationCode;
window.deleteCode = deleteCode;
window.renderCodesTable = renderCodesTable;
window.updateUserRole = updateUserRole;
window.renderUsersTable = renderUsersTable;
window.deleteUser = deleteUser;
window.resetSystemData = resetSystemData;
window.copyToClipboard = copyToClipboard;
window.resetUserPassword = resetUserPassword;
window.initRealtimeUsers = initRealtimeUsers;
window.cleanupUsersSystem = cleanupUsersSystem;