// FILE: ui.js - VERSION 2.6 (DENGAN DUKUNGAN CHAT & STATUS)
// Berisi fungsi-fungsi antarmuka pengguna, modal, profil, dan inisialisasi dashboard
// Dengan dukungan real-time data refresh & session persistence
// Mendukung filter kelas dari pengaturan sekolah (kelas kustom)
// Mendukung upload logo sekolah (hanya admin)
// Mendukung tab Rekap Absensi
// Mendukung Friends System (pertemanan)
// Mendukung Chat System & Status System

// ======================== GLOBAL UI STATE ========================
let clockInterval = null;
let uiInitialized = false;

// ======================== INISIALISASI DASHBOARD ========================

function initApp() {
    console.log("🚀 initApp dipanggil - Current user:", currentUser?.nama);
    
    if (!currentUser) {
        console.log("❌ No currentUser, showing auth section");
        const authSection = document.getElementById('auth-section');
        const dashboardSection = document.getElementById('dashboard-section');
        if (authSection) authSection.style.display = 'flex';
        if (dashboardSection) dashboardSection.style.display = 'none';
        return;
    }
    
    // Tampilkan dashboard
    const authSection = document.getElementById('auth-section');
    const dashboardSection = document.getElementById('dashboard-section');
    if (authSection) authSection.style.display = 'none';
    if (dashboardSection) dashboardSection.style.display = 'block';
    
    // Update user info di UI
    updateUserInterface();
    
    // Apply role permissions
    applyRolePermissions();
    
    // ========== LOAD LOGO SEKOLAH ==========
    loadSchoolLogo();
    updateSchoolLogoUI();
    
    // Populate filters dengan guard
    try {
        if (typeof populateFilters === 'function') {
            populateFilters();
        } else {
            console.warn("populateFilters not available yet, will retry");
            setTimeout(() => {
                if (typeof populateFilters === 'function') populateFilters();
            }, 500);
        }
    } catch (err) {
        console.error("Error in populateFilters:", err);
    }
    
    // Start clock (hanya sekali)
    try {
        if (clockInterval) clearInterval(clockInterval);
        clockInterval = setInterval(updateClock, 1000);
        updateClock();
        console.log("✅ Clock started");
    } catch (err) {
        console.error("Clock initialization error:", err);
    }
    
    // ========== INISIALISASI SISTEM PENGUMUMAN ==========
    if (typeof initAnnouncementSystem === 'function') {
        setTimeout(function() {
            initAnnouncementSystem();
        }, 500);
    }
    
    // ========== INISIALISASI REAL-TIME WATCHERS ==========
    if (typeof initRealtimeWatchers === 'function' && !uiInitialized) {
        initRealtimeWatchers();
        uiInitialized = true;
    }
    
    // Muat konfigurasi nama sekolah
    if (typeof initSystemConfig === 'function') {
        initSystemConfig();
    } else {
        initSystemConfigManual();
    }
    
    // Muat konfigurasi tipe sekolah & jurusan
    if (typeof loadSchoolConfig === 'function') {
        loadSchoolConfig();
    }
    
    // Inisialisasi event listener untuk delay input
    if (typeof initDelayEventListeners === 'function') {
        initDelayEventListeners();
    } else {
        initManualDelayListeners();
    }
    
    // Inisialisasi event listener untuk global delay
    if (typeof initGlobalDelayListeners === 'function') {
        initGlobalDelayListeners();
    }
    
    // Render semua tabel
    setTimeout(() => {
        if (typeof renderTable === 'function') renderTable();
        if (typeof renderStudentsTable === 'function') renderStudentsTable();
        if (typeof renderCodesTable === 'function') renderCodesTable();
        if (typeof renderUsersTable === 'function') renderUsersTable();
    }, 100);
    
    // Switch ke tab default
    switchTab('attendance');
    
    // Tampilkan floating button
    setTimeout(function() {
        // Floating button untuk pengumuman (hanya admin/guru)
        if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'guru')) {
            const floatingBtn = document.getElementById('floatingAnnouncementBtn');
            if (floatingBtn) floatingBtn.style.display = 'flex';
        }
        
        // Floating button untuk teman (semua user)
        const floatingFriendsBtn = document.getElementById('floatingFriendsBtn');
        if (floatingFriendsBtn) {
            floatingFriendsBtn.style.display = 'flex';
        }
        
        // Floating button untuk chat (semua user)
        const floatingChatBtn = document.getElementById('floatingChatBtn');
        if (floatingChatBtn) {
            floatingChatBtn.style.display = 'flex';
        }
    }, 1000);
    
    // Inisialisasi rekap system
    setTimeout(function() {
        if (typeof initRekap === 'function') {
            initRekap();
            console.log("📊 Rekap system initialized from initApp");
        }
    }, 800);
    
    // ========== INISIALISASI FRIENDS SYSTEM ==========
    setTimeout(function() {
        if (typeof initFriendsSystem === 'function') {
            initFriendsSystem();
            console.log("👥 Friends system initialized from initApp");
        } else {
            console.warn("⚠️ initFriendsSystem not found - pastikan friends.js sudah di-load");
        }
    }, 1200);
    
    // ========== INISIALISASI CHAT SYSTEM ==========
    setTimeout(function() {
        if (typeof initChatSystem === 'function') {
            initChatSystem();
            console.log("💬 Chat system initialized from initApp");
        } else {
            console.warn("⚠️ initChatSystem not found - pastikan chat.js sudah di-load");
        }
    }, 1500);
    
    // ========== INISIALISASI STATUS SYSTEM ==========
    setTimeout(function() {
        if (typeof initStatusSystem === 'function') {
            initStatusSystem();
            console.log("📸 Status system initialized from initApp");
        } else {
            console.warn("⚠️ initStatusSystem not found - pastikan status.js sudah di-load");
        }
    }, 1800);
    
    console.log("✅ initApp completed successfully");
}

/**
 * Update semua elemen UI yang menampilkan data user
 */
function updateUserInterface() {
    if (!currentUser) return;
    
    // Update nama user
    const userProfileDisplay = document.getElementById('userProfileDisplay');
    if (userProfileDisplay) userProfileDisplay.textContent = currentUser.nama;
    
    // Update email di profil
    const profileEmail = document.getElementById('profileEmail');
    if (profileEmail) profileEmail.textContent = currentUser.email;
    
    // Update role badge
    const userRoleDisplay = document.getElementById('userRoleDisplay');
    if (userRoleDisplay) {
        userRoleDisplay.textContent = currentUser.role.toUpperCase();
        userRoleDisplay.className = `role-badge role-${currentUser.role}`;
    }
    
    // Update avatar
    const photo = currentUser.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.nama || 'User')}&background=random`;
    const headerAvatar = document.getElementById('headerAvatar');
    if (headerAvatar) headerAvatar.src = photo;
    
    const profileImg = document.getElementById('profileImg');
    if (profileImg) profileImg.src = photo;
}

// Fallback inisialisasi manual untuk delay listeners
function initManualDelayListeners() {
    console.log("🔧 initManualDelayListeners dipanggil");
    
    const delayMinutesInput = document.getElementById('delayMinutesValue');
    const delayHoursSelect = document.getElementById('delayHoursValue');
    const delayUnitSelect = document.getElementById('delayUnit');
    
    if (delayMinutesInput) {
        delayMinutesInput.removeEventListener('input', updateDelayFromMinutes);
        delayMinutesInput.addEventListener('input', updateDelayFromMinutes);
    }
    if (delayHoursSelect) {
        delayHoursSelect.removeEventListener('change', updateDelayFromHours);
        delayHoursSelect.addEventListener('change', updateDelayFromHours);
    }
    if (delayUnitSelect) {
        delayUnitSelect.removeEventListener('change', toggleDelayInput);
        delayUnitSelect.addEventListener('change', toggleDelayInput);
    }
    
    setTimeout(() => {
        if (typeof toggleDelayInput === 'function') toggleDelayInput();
    }, 100);
}

// Fallback inisialisasi system config manual
function initSystemConfigManual() {
    console.log("🔧 initSystemConfigManual dipanggil");
    
    if (typeof db !== 'undefined' && db) {
        db.ref('system_config/schoolName').on('value', snapshot => {
            const name = snapshot.val();
            const display = name || 'Sistem Absensi';
            const headerTitle = document.getElementById('schoolNameDisplay');
            if (headerTitle) headerTitle.textContent = display;
            const inputField = document.getElementById('inputSchoolName');
            if (inputField) inputField.value = name || '';
        });
    } else {
        console.warn("Firebase db not available for system config");
        const headerTitle = document.getElementById('schoolNameDisplay');
        if (headerTitle) headerTitle.textContent = 'Sistem Absensi';
    }
}

// ======================== FUNGSI FORMAT DELAY ========================

function formatDelayText(delayMinutes) {
    if (!delayMinutes && delayMinutes !== 0) return '-';
    
    const hours = Math.floor(delayMinutes / 60);
    const minutes = delayMinutes % 60;
    
    if (hours > 0 && minutes > 0) {
        return `${hours} jam ${minutes} menit`;
    } else if (hours > 0) {
        return `${hours} jam`;
    } else {
        return `${minutes} menit`;
    }
}

// ======================== LOGO SEKOLAH ========================

function loadSchoolLogo() {
    if (typeof db === 'undefined' || !db) {
        console.warn("Firebase db not available for loading logo");
        return;
    }
    
    const headerLogo = document.getElementById('headerSchoolLogo');
    const previewLogo = document.getElementById('schoolLogoPreview');
    const btnRemove = document.getElementById('btnRemoveLogo');
    
    db.ref('system_config/schoolLogo').on('value', (snapshot) => {
        const logoUrl = snapshot.val();
        
        if (logoUrl && logoUrl !== '') {
            if (headerLogo) {
                headerLogo.src = logoUrl;
                headerLogo.style.display = 'block';
                headerLogo.classList.remove('skeleton');
            }
            if (previewLogo) {
                previewLogo.src = logoUrl;
                previewLogo.classList.remove('skeleton');
            }
            if (btnRemove && currentUser && currentUser.role === 'admin') {
                btnRemove.style.display = 'inline-block';
            }
            console.log("🏫 Logo sekolah loaded:", logoUrl);
        } else {
            const defaultIcon = 'https://ui-avatars.com/api/?name=S&background=00bcd4&color=fff&size=80';
            if (headerLogo) {
                headerLogo.src = defaultIcon;
                headerLogo.style.display = 'block';
            }
            if (previewLogo) previewLogo.src = defaultIcon;
            if (btnRemove) btnRemove.style.display = 'none';
        }
    });
}

async function uploadSchoolLogo(input) {
    if (!currentUser) {
        showToast('Anda harus login!', 'error');
        return;
    }
    
    if (currentUser.role !== 'admin') {
        showToast('⛔ Hanya Admin yang dapat mengubah logo sekolah!', 'error');
        return;
    }
    
    if (!input.files || !input.files[0]) return;
    
    const file = input.files[0];
    if (!file.type.match('image.*')) {
        showToast('❌ Hanya file gambar yang diperbolehkan!', 'error');
        return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
        showToast('❌ Ukuran gambar maksimal 2MB!', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);
    
    const previewImg = document.getElementById('schoolLogoPreview');
    const headerImg = document.getElementById('headerSchoolLogo');
    
    if (previewImg) {
        previewImg.classList.add('skeleton');
        previewImg.style.opacity = '0.5';
    }
    if (headerImg) headerImg.classList.add('skeleton');
    
    showToast('📤 Mengunggah logo sekolah ke ImgBB...', 'neutral');

    try {
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { 
            method: 'POST', 
            body: formData 
        });
        const data = await res.json();
        
        if (data.success) {
            const urlProxy = `https://wsrv.nl/?url=${encodeURIComponent(data.data.image.url)}&w=200&h=200&fit=cover`;
            await db.ref('system_config/schoolLogo').set(urlProxy);
            
            if (previewImg) {
                previewImg.src = urlProxy;
                previewImg.classList.remove('skeleton');
                previewImg.style.opacity = '1';
            }
            if (headerImg) {
                headerImg.src = urlProxy;
                headerImg.classList.remove('skeleton');
            }
            
            const btnRemove = document.getElementById('btnRemoveLogo');
            if (btnRemove) btnRemove.style.display = 'inline-block';
            
            showToast('✅ Logo sekolah berhasil diperbarui!', 'success');
        } else {
            console.error('ImgBB upload failed:', data);
            showToast('❌ Gagal upload ke ImgBB', 'error');
            if (previewImg) {
                previewImg.classList.remove('skeleton');
                previewImg.style.opacity = '1';
            }
            if (headerImg) headerImg.classList.remove('skeleton');
        }
    } catch (e) {
        console.error('Upload error:', e);
        showToast('❌ Koneksi Error: ' + e.message, 'error');
        if (previewImg) {
            previewImg.classList.remove('skeleton');
            previewImg.style.opacity = '1';
        }
        if (headerImg) headerImg.classList.remove('skeleton');
    } finally {
        input.value = '';
    }
}

function removeSchoolLogo() {
    if (!currentUser) {
        showToast('Anda harus login!', 'error');
        return;
    }
    
    if (currentUser.role !== 'admin') {
        showToast('⛔ Hanya Admin yang dapat menghapus logo sekolah!', 'error');
        return;
    }
    
    if (!confirm('⚠️ Yakin ingin menghapus logo sekolah?\n\nLogo akan kembali ke default.')) return;
    
    const btn = document.getElementById('btnRemoveLogo');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Menghapus...';
    }
    
    db.ref('system_config/schoolLogo').remove()
        .then(() => {
            showToast('✅ Logo sekolah berhasil dihapus', 'success');
            
            const defaultIcon = 'https://ui-avatars.com/api/?name=S&background=00bcd4&color=fff&size=80';
            const previewImg = document.getElementById('schoolLogoPreview');
            const headerImg = document.getElementById('headerSchoolLogo');
            
            if (previewImg) previewImg.src = defaultIcon;
            if (headerImg) headerImg.src = defaultIcon;
            
            if (btn) btn.style.display = 'none';
        })
        .catch(err => {
            console.error('Remove logo error:', err);
            showToast('❌ Gagal menghapus logo: ' + err.message, 'error');
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '🗑️ Hapus Logo';
            }
        });
}

function updateSchoolLogoUI() {
    const logoSettingGroup = document.getElementById('logoSettingGroup');
    if (logoSettingGroup && currentUser) {
        const uploadHint = logoSettingGroup.querySelector('.logo-upload-hint');
        const removeBtn = document.getElementById('btnRemoveLogo');
        const previewWrapper = logoSettingGroup.querySelector('.logo-preview-wrapper');
        
        if (currentUser.role !== 'admin') {
            if (uploadHint) uploadHint.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'none';
            if (previewWrapper) {
                previewWrapper.style.cursor = 'default';
                previewWrapper.removeAttribute('onclick');
            }
        } else {
            if (uploadHint) uploadHint.style.display = 'block';
            if (previewWrapper) {
                previewWrapper.style.cursor = 'pointer';
                previewWrapper.setAttribute('onclick', "document.getElementById('logoFileInput').click()");
            }
            db.ref('system_config/schoolLogo').once('value', (snapshot) => {
                if (removeBtn) {
                    if (snapshot.val()) {
                        removeBtn.style.display = 'inline-block';
                    } else {
                        removeBtn.style.display = 'none';
                    }
                }
            });
        }
    }
}

// ======================== FRIENDS SYSTEM UI ========================

function toggleFriendsModal() {
    const modal = document.getElementById('modal-friends');
    if (modal) {
        modal.classList.add('open');
        if (typeof renderFriendsPanel === 'function') {
            renderFriendsPanel();
        } else {
            console.warn("renderFriendsPanel not found");
        }
    }
}

// ======================== CHAT SYSTEM UI ========================

function openChatModal() {
    const modal = document.getElementById('modal-chat');
    if (modal) {
        modal.classList.add('open');
        if (typeof renderChatInterface === 'function') {
            renderChatInterface();
        } else {
            console.warn("renderChatInterface not found");
        }
    }
}

// ======================== ROLE PERMISSIONS ========================

function applyRolePermissions() {
    if (!currentUser) return;
    
    const role = currentUser.role;
    console.log("🎭 Apply role permissions untuk role:", role);
    
    document.querySelectorAll('.role-admin').forEach(el => {
        if (role === 'admin') {
            el.style.display = '';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        } else {
            el.style.display = 'none';
        }
    });
    
    document.querySelectorAll('.role-guru').forEach(el => {
        if (role === 'admin' || role === 'guru') {
            el.style.display = '';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        } else {
            el.style.display = 'none';
        }
    });
    
    const btnAnnouncement = document.querySelector('.btn-announcement');
    if (btnAnnouncement) {
        if (role === 'admin' || role === 'guru') {
            btnAnnouncement.style.display = 'inline-flex';
            btnAnnouncement.style.visibility = 'visible';
        } else {
            btnAnnouncement.style.display = 'none';
        }
    }
    
    const floatingBtn = document.getElementById('floatingAnnouncementBtn');
    if (floatingBtn) {
        if (role === 'admin' || role === 'guru') {
            floatingBtn.style.display = 'flex';
        } else {
            floatingBtn.style.display = 'none';
        }
    }
    
    const floatingFriendsBtn = document.getElementById('floatingFriendsBtn');
    if (floatingFriendsBtn) {
        floatingFriendsBtn.style.display = 'flex';
    }
    
    const floatingChatBtn = document.getElementById('floatingChatBtn');
    if (floatingChatBtn) {
        floatingChatBtn.style.display = 'flex';
    }
    
    const navTabs = document.getElementById('nav-tabs-container');
    if (navTabs && role === 'siswa') {
        const configBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => 
            b.textContent.includes('Pengaturan') || b.textContent.includes('Config')
        );
        if (configBtn) configBtn.style.display = 'none';
        
        const usersBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => 
            b.textContent.includes('Manajemen Pengguna')
        );
        if (usersBtn) usersBtn.style.display = 'none';
    } else if (navTabs) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.style.display = '';
        });
    }
    
    updateSchoolLogoUI();
}

function updateClock() {
    const clockEl = document.getElementById('clock');
    if (clockEl) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('id-ID');
        const dateStr = now.toLocaleDateString('id-ID', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        clockEl.innerHTML = `${timeStr}<br><small>${dateStr}</small>`;
    } else {
        console.warn("Clock element not found");
    }
}

function switchTab(tabId) {
    console.log("📑 Switching to tab:", tabId);
    
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('active');
    });
    
    document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('active');
    });
    
    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) {
        targetTab.classList.add('active');
    } else {
        console.warn(`Tab content #tab-${tabId} not found`);
        const directTab = document.getElementById(tabId);
        if (directTab) directTab.classList.add('active');
    }
    
    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => {
        const onclick = b.getAttribute('onclick');
        return onclick && onclick.includes(tabId);
    });
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    setTimeout(() => {
        if (tabId === 'attendance' && typeof renderTable === 'function') {
            renderTable();
        } else if (tabId === 'students' && typeof renderStudentsTable === 'function') {
            renderStudentsTable();
        } else if (tabId === 'users' && typeof renderUsersTable === 'function') {
            renderUsersTable();
        } else if (tabId === 'rekap' && typeof loadRekap === 'function') {
            loadRekap();
        } else if (tabId === 'friends' && typeof loadFriendRequests === 'function') {
            loadFriendRequests();
            loadFriendsList();
        } else if (tabId === 'chat' && typeof loadChatList === 'function') {
            loadChatList();
        }
    }, 50);
}

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) {
        console.warn("Toast element not found, message:", msg);
        return;
    }
    
    toast.textContent = msg;
    toast.style.borderLeftColor = type === 'error' ? 'var(--danger)' : 
                                   type === 'warning' ? 'var(--warning)' : 'var(--primary)';
    toast.style.backgroundColor = type === 'error' ? 'rgba(244, 67, 54, 0.1)' : 
                                   type === 'warning' ? 'rgba(255, 152, 0, 0.1)' : 'rgba(76, 175, 80, 0.1)';
    toast.className = 'toast show';
    
    setTimeout(() => {
        toast.className = toast.className.replace('show', '');
    }, 3000);
}

function populateFilters() {
    const filterKelas = document.getElementById('filterKelas');
    const filterJurusan = document.getElementById('filterJurusan');
    
    if (typeof currentSchoolConfig === 'undefined') {
        console.warn("populateFilters: currentSchoolConfig belum didefinisikan, coba lagi nanti");
        setTimeout(populateFilters, 500);
        return;
    }
    
    if (filterKelas) {
        const currentValue = filterKelas.value;
        let kelasOptions = [];
        
        if (currentSchoolConfig && currentSchoolConfig.classes && currentSchoolConfig.classes.length > 0) {
            kelasOptions = currentSchoolConfig.classes;
            console.log(`📚 Filter kelas: menggunakan ${kelasOptions.length} kelas dari pengaturan sekolah`);
        } else {
            if (dbData && dbData.users && dbData.users.length > 0) {
                kelasOptions = [...new Set(dbData.users.map(s => s.kelas).filter(Boolean))].sort();
                console.log(`📚 Filter kelas: fallback dari data siswa (${kelasOptions.length} kelas)`);
            }
        }
        
        if (kelasOptions.length === 0) {
            const schoolType = (currentSchoolConfig && currentSchoolConfig.type) ? currentSchoolConfig.type : 'smp';
            if (schoolType === 'smp') {
                kelasOptions = ['VII', 'VIII', 'IX'];
            } else if (schoolType === 'smk') {
                kelasOptions = ['X', 'XI', 'XII'];
            } else {
                kelasOptions = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
            }
            console.log(`📚 Filter kelas: menggunakan default (${kelasOptions.length} kelas)`);
        }
        
        filterKelas.innerHTML = '<option value="all">📚 Semua Kelas</option>' +
            kelasOptions.map(k => `<option value="${k}">${k}</option>`).join('');
        
        if (currentValue && kelasOptions.includes(currentValue)) {
            filterKelas.value = currentValue;
        }
    }
    
    if (filterJurusan) {
        const currentValue = filterJurusan.value;
        let jurusanOptions = [];
        
        if (currentSchoolConfig && currentSchoolConfig.majors && currentSchoolConfig.majors.length > 0) {
            jurusanOptions = currentSchoolConfig.majors;
            console.log(`🎓 Filter jurusan: menggunakan ${jurusanOptions.length} jurusan dari pengaturan sekolah`);
        } else {
            if (dbData && dbData.users && dbData.users.length > 0) {
                jurusanOptions = [...new Set(dbData.users.map(s => s.jurusan).filter(Boolean))].sort();
                console.log(`🎓 Filter jurusan: fallback dari data siswa (${jurusanOptions.length} jurusan)`);
            }
        }
        
        if (jurusanOptions.length === 0) {
            jurusanOptions = ['UMUM'];
        }
        
        filterJurusan.innerHTML = '<option value="all">🎓 Semua Jurusan</option>' +
            jurusanOptions.map(j => `<option value="${j}">${j}</option>`).join('');
        
        if (currentValue && jurusanOptions.includes(currentValue)) {
            filterJurusan.value = currentValue;
        }
    }
    
    console.log(`📊 populateFilters selesai`);
}

// ======================== PROFIL & MODALS ========================

function openProfileModal() {
    const modal = document.getElementById('modal-profile');
    if (!modal) {
        console.warn("Modal profile not found");
        return;
    }
    modal.classList.add('open');
    
    if (!currentUser) {
        console.warn("No currentUser when opening profile");
        return;
    }
    
    document.getElementById('profileImg').src = currentUser.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.nama || 'User')}&background=random`;
    document.getElementById('profileNameInput').value = currentUser.nama || '';
    document.getElementById('profileEmail').textContent = currentUser.email || '';
    document.getElementById('profileKelas').value = currentUser.kelas || '';
    document.getElementById('profileJurusan').value = currentUser.jurusan || '';
    document.getElementById('profileSubject').value = currentUser.subject || '';

    const nameInput = document.getElementById('profileNameInput');
    const kelasInput = document.getElementById('profileKelas');
    const jurusanInput = document.getElementById('profileJurusan');
    const subjectGroup = document.getElementById('group-subject');
    const saveBtn = document.querySelector('#modal-profile .btn-save');
    
    let delayGroup = document.getElementById('group-profile-delay');
    if (!delayGroup) {
        const jurusanDiv = document.getElementById('profileJurusan')?.parentElement;
        if (jurusanDiv && currentUser.role === 'siswa') {
            const newDelayGroup = document.createElement('div');
            newDelayGroup.className = 'form-group';
            newDelayGroup.id = 'group-profile-delay';
            newDelayGroup.innerHTML = `
                <label>⏰ Delay Pulang</label>
                <input type="text" id="profileDelay" placeholder="60 menit" readonly style="background:#2c2c2c; color:#4a90e2; font-weight:bold;">
                <small class="text-small">*Waktu minimal untuk absen pulang</small>
            `;
            jurusanDiv.insertAdjacentElement('afterend', newDelayGroup);
            delayGroup = newDelayGroup;
        }
    }

    if (currentUser.role === 'siswa') {
        nameInput.readOnly = true;
        nameInput.style.border = 'none';
        nameInput.style.background = 'transparent';
        nameInput.style.color = '#888';
        kelasInput.readOnly = true;
        kelasInput.style.border = 'none';
        kelasInput.style.background = 'transparent';
        jurusanInput.readOnly = true;
        jurusanInput.style.border = 'none';
        jurusanInput.style.background = 'transparent';
        if (subjectGroup) subjectGroup.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'none';
        
        if (delayGroup) delayGroup.style.display = 'block';
        updateProfileDelayDisplay();
    } else {
        nameInput.readOnly = false;
        nameInput.style.border = '1px solid var(--border)';
        nameInput.style.background = '#2c2c2c';
        nameInput.style.color = '#fff';
        kelasInput.readOnly = false;
        kelasInput.style.border = '1px solid var(--border)';
        kelasInput.style.background = '#2c2c2c';
        jurusanInput.readOnly = false;
        jurusanInput.style.border = '1px solid var(--border)';
        jurusanInput.style.background = '#2c2c2c';
        if (subjectGroup) subjectGroup.style.display = 'block';
        if (saveBtn) saveBtn.style.display = 'block';
        if (delayGroup) delayGroup.style.display = 'none';
    }
}

function openForgotPasswordModal() {
    const modal = document.getElementById('modal-forgot');
    if (modal) {
        modal.classList.add('open');
        const emailInput = document.getElementById('forgotEmail');
        if (emailInput) emailInput.value = '';
        emailInput?.focus();
    }
}

function openChangePasswordModal() {
    const modal = document.getElementById('modal-change-pass');
    if (modal) {
        modal.classList.add('open');
        const oldPass = document.getElementById('cpOld');
        const newPass = document.getElementById('cpNew');
        const confirmPass = document.getElementById('cpConfirm');
        if (oldPass) oldPass.value = '';
        if (newPass) newPass.value = '';
        if (confirmPass) confirmPass.value = '';
        oldPass?.focus();
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('open');
}

function handleUpdateProfileInfo() {
    if (!currentUser) {
        showToast('Anda harus login terlebih dahulu!', 'error');
        return;
    }
    
    if (currentUser.role === 'siswa') {
        showToast('Siswa tidak dapat mengubah data profil. Hubungi Admin/Guru.', 'error');
        return;
    }

    const newNama = document.getElementById('profileNameInput').value.trim();
    const newKelas = document.getElementById('profileKelas').value.toUpperCase();
    const newJurusan = document.getElementById('profileJurusan').value;
    const newSubject = document.getElementById('profileSubject').value;

    if (!newNama) {
        showToast('Nama wajib diisi!', 'error');
        return;
    }

    const btn = document.querySelector('#modal-profile .btn-save');
    if (!btn) return;
    
    const originalText = btn.innerText;
    btn.innerText = '💾 Menyimpan...';
    btn.disabled = true;

    const updateData = { 
        nama: newNama, 
        kelas: newKelas, 
        jurusan: newJurusan, 
        subject: newSubject 
    };
    
    db.ref(`users_auth/${currentUser.uid}`).update(updateData)
        .then(() => {
            currentUser.nama = newNama;
            currentUser.kelas = newKelas;
            currentUser.jurusan = newJurusan;
            currentUser.subject = newSubject;
            
            if (typeof saveUserToLocalStorage === 'function') {
                saveUserToLocalStorage(currentUser);
            }
            
            showToast('✅ Profil berhasil diperbarui');
            document.getElementById('userProfileDisplay').textContent = newNama;
            
            if (currentUser.role === 'siswa' && currentUser.fpId) {
                db.ref(`users/${currentUser.fpId}`).update({
                    nama: newNama,
                    kelas: newKelas,
                    jurusan: newJurusan
                }).then(() => console.log('✅ Sinkronisasi FP berhasil'))
                  .catch(err => console.warn('Sinkronisasi FP gagal:', err));
            }
            
            closeModal('modal-profile');
            
            if (typeof populateFilters === 'function') populateFilters();
            if (typeof renderStudentsTable === 'function') renderStudentsTable();
            if (typeof renderUsersTable === 'function') renderUsersTable();
        })
        .catch(err => {
            console.error('Update profile error:', err);
            showToast('❌ Gagal update: ' + err.message, 'error');
        })
        .finally(() => {
            btn.innerText = originalText;
            btn.disabled = false;
        });
}

function handleChangePassword(e) {
    e.preventDefault();
    
    const newPass = document.getElementById('cpNew').value;
    const confirmPass = document.getElementById('cpConfirm').value;
    
    if (newPass !== confirmPass) {
        showToast('Password baru tidak cocok!', 'error');
        return;
    }
    
    if (newPass.length < 6) {
        showToast('Password minimal 6 karakter!', 'error');
        return;
    }
    
    const btn = document.querySelector('#modal-change-pass button[type="submit"]');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Menyimpan...';
    }
    
    auth.currentUser.updatePassword(newPass)
        .then(() => {
            showToast('✅ Password berhasil diubah');
            closeModal('modal-change-pass');
            document.getElementById('cpNew').value = '';
            document.getElementById('cpConfirm').value = '';
        })
        .catch(err => {
            console.error('Change password error:', err);
            if (err.code === 'auth/requires-recent-login') {
                showToast('⚠️ Silakan logout dan login kembali untuk ubah password.', 'error');
            } else if (err.code === 'auth/weak-password') {
                showToast('Password terlalu lemah. Gunakan minimal 6 karakter.', 'error');
            } else {
                showToast('❌ Gagal: ' + err.message, 'error');
            }
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Simpan';
            }
        });
}

async function uploadProfilePhoto(input) {
    if (!input.files || !input.files[0]) return;
    
    const file = input.files[0];
    if (!file.type.match('image.*')) {
        showToast('Hanya file gambar yang diperbolehkan!', 'error');
        return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
        showToast('Ukuran gambar maksimal 2MB!', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);
    
    const imgEl = document.getElementById('profileImg');
    const originalSrc = imgEl.src;
    imgEl.style.opacity = '0.5';
    showToast('📤 Mengunggah ke ImgBB...', 'neutral');

    try {
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { 
            method: 'POST', 
            body: formData 
        });
        const data = await res.json();
        
        if (data.success) {
            const urlProxy = `https://wsrv.nl/?url=${encodeURIComponent(data.data.image.url)}`;
            await db.ref(`users_auth/${currentUser.uid}`).update({ photoUrl: urlProxy });
            
            currentUser.photoUrl = urlProxy;
            if (typeof saveUserToLocalStorage === 'function') {
                saveUserToLocalStorage(currentUser);
            }
            
            document.getElementById('headerAvatar').src = urlProxy;
            imgEl.src = urlProxy;
            showToast('✅ Foto profil berhasil diperbarui!');
        } else {
            console.error('ImgBB upload failed:', data);
            showToast('❌ Gagal upload ke ImgBB', 'error');
            imgEl.src = originalSrc;
        }
    } catch (e) {
        console.error('Upload error:', e);
        showToast('❌ Koneksi Error: ' + e.message, 'error');
        imgEl.src = originalSrc;
    } finally {
        imgEl.style.opacity = '1';
        input.value = '';
    }
}

function processForgot() {
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) {
        showToast('Masukkan email terlebih dahulu!', 'error');
        return;
    }

    const btn = document.querySelector('#modal-forgot .btn-save');
    if (btn) {
        btn.innerText = '📧 Mengirim...';
        btn.disabled = true;
    }

    auth.sendPasswordResetEmail(email)
        .then(() => {
            showToast(`✅ Link reset password telah dikirim ke ${email}`);
            closeModal('modal-forgot');
        })
        .catch(error => {
            console.error('Forgot password error:', error);
            if (error.code === 'auth/user-not-found') {
                showToast('❌ Email tersebut belum terdaftar!', 'error');
            } else if (error.code === 'auth/invalid-email') {
                showToast('❌ Format email tidak valid!', 'error');
            } else {
                showToast('❌ Gagal mengirim: ' + error.message, 'error');
            }
        })
        .finally(() => {
            if (btn) {
                btn.innerText = 'Kirim Link';
                btn.disabled = false;
            }
        });
}

// ======================== REGISTER & GENERATE UI ========================

function toggleRegisterInput() {
    const typeRadio = document.querySelector('input[name="regRoleType"]:checked');
    if (!typeRadio) return;
    
    const type = typeRadio.value;
    const idGroup = document.getElementById('group-reg-id');
    const namaGroup = document.getElementById('group-reg-nama');
    const subjectGroup = document.getElementById('group-reg-subject');
    const detailsGroup = document.getElementById('group-siswa-details');
    const codeInput = document.getElementById('regCode');

    if (type === 'siswa') {
        if (idGroup) idGroup.style.display = 'block';
        if (detailsGroup) detailsGroup.style.display = 'block';
        if (namaGroup) namaGroup.style.display = 'none';
        if (subjectGroup) subjectGroup.style.display = 'none';
        if (codeInput) codeInput.placeholder = '🔑 Kode Unik (Siswa)';
        if (document.getElementById('regKelas')) document.getElementById('regKelas').required = true;
        if (document.getElementById('regJurusan')) document.getElementById('regJurusan').required = true;
    } else {
        if (idGroup) idGroup.style.display = 'none';
        if (detailsGroup) detailsGroup.style.display = 'none';
        if (namaGroup) namaGroup.style.display = 'block';
        if (subjectGroup) subjectGroup.style.display = 'block';
        if (document.getElementById('regKelas')) document.getElementById('regKelas').required = false;
        if (document.getElementById('regJurusan')) document.getElementById('regJurusan').required = false;
        if (codeInput) codeInput.placeholder = '🔑 Kode Unik (Guru)';
    }
}

function toggleGenerateInput() {
    const typeRadio = document.querySelector('input[name="genTarget"]:checked');
    if (!typeRadio) return;
    
    const type = typeRadio.value;
    const selectGroup = document.getElementById('group-select-siswa');
    const desc = document.getElementById('gen-desc');
    
    if (type === 'siswa') {
        if (selectGroup) selectGroup.style.display = 'block';
        if (desc) desc.innerText = '🔒 Kode akan dikunci ke ID Siswa terpilih.';
    } else {
        if (selectGroup) selectGroup.style.display = 'none';
        if (desc) desc.innerText = '🔓 Kode bebas digunakan oleh Guru mana saja.';
    }
}

// ======================== PENGATURAN NAMA SEKOLAH ========================

function saveSchoolName() {
    if (!currentUser) {
        showToast('Anda harus login!', 'error');
        return;
    }
    
    const newSchoolName = document.getElementById('inputSchoolName').value.trim();
    if (!newSchoolName) {
        showToast('Nama sekolah tidak boleh kosong!', 'error');
        return;
    }
    
    if (currentUser.role !== 'admin') {
        showToast('Hanya Admin yang bisa mengubah nama sekolah.', 'error');
        return;
    }
    
    const btn = event?.target;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Menyimpan...';
    }
    
    db.ref('system_config/schoolName').set(newSchoolName)
        .then(() => {
            showToast('✅ Nama sekolah berhasil diperbarui');
            const headerTitle = document.getElementById('schoolNameDisplay');
            if (headerTitle) headerTitle.textContent = newSchoolName;
        })
        .catch(err => {
            console.error('Save school name error:', err);
            showToast('❌ Gagal update: ' + err.message, 'error');
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Simpan';
            }
        });
}

function initSystemConfig() {
    if (typeof db === 'undefined' || !db) {
        console.warn("Firebase db not available for system config");
        initSystemConfigManual();
        return;
    }
    
    db.ref('system_config/schoolName').on('value', snapshot => {
        const name = snapshot.val();
        const display = name || 'Sistem Absensi';
        const headerTitle = document.getElementById('schoolNameDisplay');
        if (headerTitle) headerTitle.textContent = display;
        const inputField = document.getElementById('inputSchoolName');
        if (inputField && inputField.value !== name) {
            inputField.value = name || '';
        }
    });
}

// ======================== RENDER TABEL USERS ========================

function renderUsersTable() {
    const tbody = document.getElementById('tbody-users');
    if (!tbody) {
        console.warn("tbody-users not found");
        return;
    }
    
    const searchInput = document.getElementById('searchUser');
    const search = searchInput ? searchInput.value.toLowerCase() : '';
    tbody.innerHTML = '';

    if (!dbData.users_auth || dbData.users_auth.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">📭 Tidak ada pengguna ditemukan.</td></tr>';
        return;
    }

    let data = dbData.users_auth.filter(u => 
        u.nama && u.nama.toLowerCase().includes(search)
    );

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">🔍 Tidak ada pengguna yang cocok dengan pencarian.</td></tr>';
        return;
    }

    data.forEach(u => {
        const isMe = (currentUser && currentUser.uid === u.uid);
        const avatar = u.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nama || 'User')}&background=random&color=fff&size=32`;
        
        let roleHtml = '';
        let actionsHtml = '-';

        if (currentUser && currentUser.role === 'admin' && !isMe) {
            roleHtml = `
                <select class="form-control" onchange="updateUserRole('${u.uid}', this.value)" 
                        style="background:#2c2c2c; color:white; border:1px solid #444; padding:5px; border-radius:4px; font-size:0.8rem;">
                    <option value="siswa" ${u.role === 'siswa' ? 'selected' : ''}>📚 Siswa</option>
                    <option value="guru" ${u.role === 'guru' ? 'selected' : ''}>👨‍🏫 Guru</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>👑 Admin</option>
                </select>
            `;
            actionsHtml = `
                <button class="btn-icon delete" onclick="deleteUser('${u.uid}', '${escapeHtmlString(u.nama)}')" 
                        title="Hapus User" style="background:transparent; border:none; cursor:pointer; color:#f44336; font-size:18px;">
                    🗑️
                </button>
            `;
        } else {
            let roleClass = 'role-siswa';
            let roleIcon = '📚';
            if (u.role === 'admin') {
                roleClass = 'role-admin';
                roleIcon = '👑';
            } else if (u.role === 'guru') {
                roleClass = 'role-guru';
                roleIcon = '👨‍🏫';
            }
            
            roleHtml = `<span class="role-badge ${roleClass}">${roleIcon} ${u.role.toUpperCase()}</span>`;
            if (isMe) roleHtml += ` <small style="color:#4a90e2;">(Anda)</small>`;
        }

        let detailText = '';
        if (u.role === 'siswa') {
            detailText = `${u.kelas || '-'} / ${u.jurusan || '-'}`;
        } else if (u.role === 'guru') {
            detailText = u.subject || '-';
        } else {
            detailText = '-';
        }

        tbody.innerHTML += `
            <tr>
                <td style="text-align:center;"><img src="${avatar}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;"></td>
                <td><strong>${escapeHtmlString(u.nama)}</strong></td>
                <td style="color:#aaa; font-size:0.9rem;">${u.email || '-'}</td>
                <td>${roleHtml}</td>
                <td style="color:#888; font-size:0.85rem;">${escapeHtmlString(detailText)}</td>
                <td style="text-align:center;">${actionsHtml}</td>
            </tr>
        `;
    });
    
    console.log(`📊 renderUsersTable: ${data.length} users displayed`);
}

function escapeHtmlString(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ======================== FUNGSI DELAY UNTUK PROFIL ========================

function updateProfileDelayDisplay() {
    if (!currentUser || currentUser.role !== 'siswa' || !currentUser.fpId) return;
    
    const studentData = dbData.users?.find(u => u.id == currentUser.fpId);
    const profileDelay = document.getElementById('profileDelay');
    
    if (profileDelay) {
        if (studentData && studentData.delayOut) {
            profileDelay.value = formatDelayText(studentData.delayOut);
            profileDelay.style.color = '#4a90e2';
        } else {
            const defaultDelay = 60;
            profileDelay.value = formatDelayText(defaultDelay);
            profileDelay.style.color = '#888';
        }
    }
}

// ======================== CLEANUP ========================

function cleanupUI() {
    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
    uiInitialized = false;
    console.log("🧹 UI cleanup completed");
}

// ======================== EXPORT KE GLOBAL ========================
window.initApp = initApp;
window.switchTab = switchTab;
window.showToast = showToast;
window.closeModal = closeModal;
window.openProfileModal = openProfileModal;
window.openForgotPasswordModal = openForgotPasswordModal;
window.openChangePasswordModal = openChangePasswordModal;
window.handleUpdateProfileInfo = handleUpdateProfileInfo;
window.handleChangePassword = handleChangePassword;
window.uploadProfilePhoto = uploadProfilePhoto;
window.processForgot = processForgot;
window.toggleRegisterInput = toggleRegisterInput;
window.toggleGenerateInput = toggleGenerateInput;
window.saveSchoolName = saveSchoolName;
window.renderUsersTable = renderUsersTable;
window.updateProfileDelayDisplay = updateProfileDelayDisplay;
window.cleanupUI = cleanupUI;
window.loadSchoolLogo = loadSchoolLogo;
window.uploadSchoolLogo = uploadSchoolLogo;
window.removeSchoolLogo = removeSchoolLogo;
window.updateSchoolLogoUI = updateSchoolLogoUI;
window.toggleFriendsModal = toggleFriendsModal;
window.openChatModal = openChatModal;