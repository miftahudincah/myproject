// main.js - VERSION 2.0
// Fitur: Real-time data refresh & Session persistence

// ======================== GLOBAL VARIABLES ========================
let refreshInterval = null;
let isInitialized = false;

// ======================== SESSION PERSISTENCE ========================

/**
 * Menyimpan data user ke localStorage
 */
function saveUserToLocalStorage(userData) {
    if (!userData) {
        localStorage.removeItem('currentUser');
        return;
    }
    
    const storageData = {
        uid: userData.uid,
        email: userData.email,
        nama: userData.nama,
        role: userData.role,
        kelas: userData.kelas || '',
        jurusan: userData.jurusan || '',
        fpId: userData.fpId || null,
        photoUrl: userData.photoUrl || '',
        subject: userData.subject || '',
        registeredAt: userData.registeredAt
    };
    localStorage.setItem('currentUser', JSON.stringify(storageData));
}

/**
 * Memuat data user dari localStorage
 */
function loadUserFromLocalStorage() {
    const savedData = localStorage.getItem('currentUser');
    if (savedData) {
        try {
            return JSON.parse(savedData);
        } catch (e) {
            console.error("Error parsing localStorage data:", e);
            localStorage.removeItem('currentUser');
        }
    }
    return null;
}

/**
 * Membersihkan session
 */
function clearUserSession() {
    localStorage.removeItem('currentUser');
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

// ======================== REAL-TIME DATA WATCHERS ========================

/**
 * Memulai real-time watchers untuk semua data
 * Data akan otomatis refresh saat ada perubahan di Firebase
 */
function initRealtimeWatchers() {
    console.log("🔄 Initializing real-time watchers...");
    
    // Watcher untuk data siswa (users)
    if (typeof db !== 'undefined' && db) {
        db.ref('users').on('value', (snapshot) => {
            const data = snapshot.val();
            if (typeof dbData !== 'undefined') {
                dbData.users = [];
                if (data) {
                    Object.keys(data).forEach(key => {
                        dbData.users.push({ id: key, ...data[key] });
                    });
                }
                console.log(`📊 Data siswa diperbarui: ${dbData.users.length} siswa`);
                
                // Render tabel siswa
                if (typeof renderStudentsTable === 'function') {
                    requestAnimationFrame(() => renderStudentsTable());
                }
                if (typeof populateStudentFilters === 'function') {
                    requestAnimationFrame(() => populateStudentFilters());
                }
                if (typeof populateFilters === 'function') {
                    requestAnimationFrame(() => populateFilters());
                }
                if (typeof populateStudentSelectForCode === 'function') {
                    requestAnimationFrame(() => populateStudentSelectForCode());
                }
            }
        });
        
        // Watcher untuk data user auth
        db.ref('users_auth').on('value', (snapshot) => {
            const data = snapshot.val();
            if (typeof dbData !== 'undefined') {
                dbData.users_auth = [];
                if (data) {
                    Object.keys(data).forEach(uid => {
                        dbData.users_auth.push({ uid: uid, ...data[uid] });
                    });
                }
                console.log(`👥 Data pengguna diperbarui: ${dbData.users_auth.length} users`);
                
                if (typeof renderUsersTable === 'function') {
                    requestAnimationFrame(() => renderUsersTable());
                }
                
                // Update currentUser jika data berubah
                if (currentUser && currentUser.uid) {
                    const updatedUser = dbData.users_auth.find(u => u.uid === currentUser.uid);
                    if (updatedUser) {
                        const oldRole = currentUser.role;
                        currentUser = { ...currentUser, ...updatedUser };
                        saveUserToLocalStorage(currentUser);
                        
                        // Update UI jika role berubah
                        if (oldRole !== currentUser.role && typeof applyRolePermissions === 'function') {
                            applyRolePermissions();
                        }
                        
                        // Update display name jika berubah
                        const nameDisplay = document.getElementById('userProfileDisplay');
                        if (nameDisplay) nameDisplay.textContent = currentUser.nama;
                        
                        const roleDisplay = document.getElementById('userRoleDisplay');
                        if (roleDisplay) {
                            roleDisplay.textContent = currentUser.role.toUpperCase();
                            roleDisplay.className = `role-badge role-${currentUser.role}`;
                        }
                    }
                }
            }
        });
        
        // Watcher untuk data absensi
        db.ref('absensi').on('value', (snapshot) => {
            const data = snapshot.val();
            if (typeof dbData !== 'undefined') {
                dbData.attendance = [];
                if (data) {
                    Object.keys(data).forEach(date => {
                        const dailyRecords = data[date];
                        if (dailyRecords) {
                            Object.keys(dailyRecords).forEach(id => {
                                const record = dailyRecords[id];
                                if (record) {
                                    dbData.attendance.push({
                                        id: date + "-" + id,
                                        studentId: id,
                                        timestamp: date + "T" + (record.in || "00:00"),
                                        date: date,
                                        timeIn: record.in,
                                        timeOut: record.out,
                                        nama: record.nama,
                                        kelas: record.kelas,
                                        jurusan: record.jurusan,
                                        status: (record.out) ? "Pulang" : "Hadir"
                                    });
                                }
                            });
                        }
                    });
                }
                dbData.attendance.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                console.log(`📋 Data absensi diperbarui: ${dbData.attendance.length} records`);
                
                if (typeof renderTable === 'function') {
                    requestAnimationFrame(() => renderTable());
                }
                
                // Tampilkan notifikasi untuk absensi baru
                showRealtimeNotification();
            }
        });
        
        // Watcher untuk kode registrasi
        db.ref('codes').on('value', (snapshot) => {
            const data = snapshot.val();
            if (typeof dbData !== 'undefined') {
                // Cleanup expired codes
                const now = Date.now();
                const fiveHoursInMs = 5 * 60 * 60 * 1000;
                if (data) {
                    Object.keys(data).forEach(key => {
                        const item = data[key];
                        if (item && item.createdAt && (now - item.createdAt > fiveHoursInMs)) {
                            db.ref('codes/' + key).remove();
                        }
                    });
                }
                
                dbData.codes = [];
                if (data) {
                    Object.keys(data).forEach(key => {
                        dbData.codes.push({ code: key, ...data[key] });
                    });
                }
                
                if (typeof renderCodesTable === 'function') {
                    requestAnimationFrame(() => renderCodesTable());
                }
            }
        });
        
        // Watcher untuk pengaturan sekolah
        db.ref('school_config').on('value', (snapshot) => {
            const data = snapshot.val();
            if (typeof currentSchoolConfig !== 'undefined') {
                if (data) {
                    currentSchoolConfig.type = data.type || 'smp';
                    currentSchoolConfig.majors = data.majors || [];
                }
                
                // Update UI sekolah
                const typeSelect = document.getElementById('schoolTypeSelect');
                if (typeSelect && typeSelect.value !== currentSchoolConfig.type) {
                    typeSelect.value = currentSchoolConfig.type;
                }
                
                const majorsDiv = document.getElementById('majorsManager');
                if (majorsDiv) {
                    majorsDiv.style.display = (currentSchoolConfig.type === 'smk' || currentSchoolConfig.type === 'both') ? 'block' : 'none';
                }
                
                if (typeof renderMajorsList === 'function') {
                    renderMajorsList();
                }
                if (typeof populateKelasOptions === 'function') {
                    populateKelasOptions();
                }
                if (typeof populateJurusanOptions === 'function') {
                    populateJurusanOptions();
                }
                if (typeof populateStudentFilters === 'function') {
                    populateStudentFilters();
                }
            }
        });
        
        // Watcher untuk delay global
        db.ref('settings/delayOut').on('value', (snapshot) => {
            const delay = snapshot.val();
            if (delay && delay > 0) {
                const displaySpan = document.getElementById('globalDelayDisplay');
                if (displaySpan && typeof formatDelayText === 'function') {
                    displaySpan.textContent = formatDelayText(delay);
                }
                if (typeof setGlobalDelayFormValue === 'function') {
                    setGlobalDelayFormValue(delay);
                }
            }
        });
        
        // Watcher untuk nama sekolah
        db.ref('system_config/schoolName').on('value', (snapshot) => {
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
    
    console.log("✅ Real-time watchers initialized");
}

/**
 * Menampilkan notifikasi realtime untuk perubahan data
 */
let lastNotificationTime = 0;
function showRealtimeNotification() {
    const now = Date.now();
    // Batasi notifikasi maksimal 1 kali per 3 detik
    if (now - lastNotificationTime < 3000) return;
    lastNotificationTime = now;
    
    const toast = document.getElementById('toast');
    if (toast) {
        const originalText = toast.textContent;
        toast.textContent = "🔄 Data telah diperbarui!";
        toast.style.borderLeftColor = "#4a90e2";
        toast.className = "toast show";
        setTimeout(() => {
            if (toast.textContent === "🔄 Data telah diperbarui!") {
                toast.textContent = originalText;
            }
            toast.className = toast.className.replace('show', '');
        }, 2000);
    }
}

/**
 * Memulai periodic refresh (fallback jika websocket bermasalah)
 */
function startPeriodicRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    
    // Refresh setiap 30 detik sebagai fallback
    refreshInterval = setInterval(() => {
        if (currentUser) {
            console.log("🔄 Periodic refresh check...");
            // Force refresh data jika diperlukan
            if (typeof db !== 'undefined' && db) {
                db.ref('users').once('value');
                db.ref('users_auth').once('value');
                db.ref('absensi').once('value');
            }
        }
    }, 30000);
}

// ======================== LOAD COMPONENTS ========================

/**
 * Memuat semua komponen dashboard
 */
async function loadDashboardComponents() {
    return new Promise((resolve) => {
        // Inisialisasi listener delay
        if (typeof initDelayEventListeners === 'function') {
            initDelayEventListeners();
        } else if (typeof initManualDelayListeners === 'function') {
            initManualDelayListeners();
        }
        
        // Inisialisasi listener global delay
        if (typeof initGlobalDelayListeners === 'function') {
            initGlobalDelayListeners();
        }
        
        resolve();
    });
}

/**
 * Memuat semua komponen auth
 */
async function loadAllComponents() {
    return new Promise((resolve) => {
        resolve();
    });
}

// ======================== AUTH STATE HANDLER ========================

/**
 * Handler untuk perubahan state autentikasi
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Main.js initialized - Waiting for auth state...");
    
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log("👤 User found:", user.email);
            
            // Cek data user di database
            const snapshot = await db.ref('users_auth/' + user.uid).once('value');
            
            if (snapshot.exists()) {
                const userData = snapshot.val();
                currentUser = { 
                    uid: user.uid, 
                    email: user.email, 
                    ...userData 
                };
                
                // Normalisasi kelas
                if (currentUser.kelas) currentUser.kelas = currentUser.kelas.toUpperCase();
                
                // Simpan ke localStorage
                saveUserToLocalStorage(currentUser);
                
                // Inisialisasi real-time watchers (hanya sekali)
                if (!isInitialized) {
                    initRealtimeWatchers();
                    startPeriodicRefresh();
                    isInitialized = true;
                }
                
                // Muat dashboard components
                await loadDashboardComponents();
                
                // Inisialisasi app
                if (typeof initApp === 'function') {
                    initApp();
                } else {
                    console.error("initApp function not found!");
                    document.getElementById('auth-section').style.display = 'none';
                    document.getElementById('dashboard-section').style.display = 'block';
                }
                
                console.log("✅ Login successful for:", currentUser.nama);
            } else {
                console.warn("⚠️ User data not found in database!");
                clearUserSession();
                await auth.signOut();
                await loadAllComponents();
                
                const authSection = document.getElementById('auth-section');
                const dashboardSection = document.getElementById('dashboard-section');
                if (authSection) authSection.style.display = 'flex';
                if (dashboardSection) dashboardSection.style.display = 'none';
                
                if (typeof showToast === 'function') {
                    showToast("Akun Anda telah dihapus oleh Admin.", "error");
                }
            }
        } else {
            console.log("👤 No user logged in");
            
            // Cek apakah ada session tersimpan di localStorage
            const savedUser = loadUserFromLocalStorage();
            if (savedUser && savedUser.uid) {
                console.log("📱 Found saved session, attempting to restore...");
                // Session tersimpan tapi Firebase tidak memiliki user active
                // Hapus session yang tidak valid
                clearUserSession();
            }
            
            await loadAllComponents();
            
            const authSection = document.getElementById('auth-section');
            const dashboardSection = document.getElementById('dashboard-section');
            if (authSection) authSection.style.display = 'flex';
            if (dashboardSection) dashboardSection.style.display = 'none';
        }
    });
});

// ======================== HELPER FUNCTIONS ========================

/**
 * Force refresh semua data (manual)
 */
function forceRefreshAllData() {
    console.log("🔄 Manual force refresh triggered...");
    if (typeof db !== 'undefined' && db) {
        db.ref('users').once('value');
        db.ref('users_auth').once('value');
        db.ref('absensi').once('value');
        db.ref('codes').once('value');
        db.ref('school_config').once('value');
        db.ref('settings/delayOut').once('value');
    }
    if (typeof showToast === 'function') {
        showToast("🔄 Data berhasil direfresh!", "success");
    }
}

// Export fungsi ke global scope
window.forceRefreshAllData = forceRefreshAllData;
window.saveUserToLocalStorage = saveUserToLocalStorage;
window.clearUserSession = clearUserSession;