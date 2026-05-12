// init.js - INISIALISASI TERURUT
// Tempatkan setelah file config.js, sebelum file lainnya
// VERSION 2.1 - Dengan dukungan Rekap Absensi

let appInitialized = false;
let dataReady = {
    users: false,
    users_auth: false,
    attendance: false,
    codes: false,
    schoolConfig: false,
    globalDelay: false
};

function checkAllDataReady() {
    // Semua data harus ready sebelum render
    const allReady = dataReady.users && dataReady.users_auth && 
                     dataReady.attendance && dataReady.schoolConfig && 
                     dataReady.globalDelay;
    
    if (allReady && currentUser && !appInitialized) {
        console.log("✅ Semua data siap, memulai render...");
        appInitialized = true;
        renderAllData();
    }
}

function renderAllData() {
    // Populate dropdowns terlebih dahulu
    if (typeof populateKelasOptions === 'function') populateKelasOptions();
    if (typeof populateJurusanOptions === 'function') populateJurusanOptions();
    if (typeof populateStudentFilters === 'function') populateStudentFilters();
    if (typeof populateFilters === 'function') populateFilters();
    if (typeof populateStudentSelectForCode === 'function') populateStudentSelectForCode();
    
    // Render semua tabel
    if (typeof renderStudentsTable === 'function') renderStudentsTable();
    if (typeof renderTable === 'function') renderTable();
    if (typeof renderUsersTable === 'function') renderUsersTable();
    if (typeof renderCodesTable === 'function') renderCodesTable();
    
    // System announcement
    if (typeof initAnnouncementSystem === 'function') {
        setTimeout(() => initAnnouncementSystem(), 300);
    }
    
    // ========== INISIALISASI REKAP ABSENSI ==========
    if (typeof initRekap === 'function') {
        setTimeout(() => {
            initRekap();
            console.log("📊 Rekap system initialized from renderAllData");
        }, 500);
    }
    
    // Update UI tambahan
    if (typeof updateProfileDelayDisplay === 'function') updateProfileDelayDisplay();
    
    // Floating button
    const floatingBtn = document.getElementById('floatingAnnouncementBtn');
    if (floatingBtn && currentUser && (currentUser.role === 'admin' || currentUser.role === 'guru')) {
        floatingBtn.style.display = 'flex';
    }
    
    // Set default date untuk rekap custom range (30 hari terakhir)
    setupRekapDefaultDates();
}

/**
 * Setup default dates untuk rekap custom range
 */
function setupRekapDefaultDates() {
    const startInput = document.getElementById('rekapStartDate');
    const endInput = document.getElementById('rekapEndDate');
    
    if (startInput && endInput) {
        // Hanya set jika belum ada value
        if (!startInput.value) {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
            startInput.value = startDate.toISOString().split('T')[0];
        }
        if (!endInput.value) {
            const endDate = new Date();
            endInput.value = endDate.toISOString().split('T')[0];
        }
    }
}

// Override listener di db.js untuk track data ready
// Hapus atau modifikasi listener yang ada di db.js, lalu tambahkan:

// Data Users (Siswa FP)
db.ref('users').on('value', (snapshot) => {
    const data = snapshot.val();
    dbData.users = [];
    if (data) {
        Object.keys(data).forEach(key => {
            dbData.users.push({ id: key, ...data[key] });
        });
    }
    dataReady.users = true;
    checkAllDataReady();
});

// Data Auth Users
db.ref('users_auth').on('value', (snapshot) => {
    const data = snapshot.val();
    dbData.users_auth = [];
    if (data) {
        Object.keys(data).forEach(uid => {
            dbData.users_auth.push({ uid: uid, ...data[uid] });
        });
    }
    dataReady.users_auth = true;
    checkAllDataReady();
});

// Data Absensi
db.ref('absensi').on('value', (snapshot) => {
    const data = snapshot.val();
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
    dataReady.attendance = true;
    checkAllDataReady();
    
    // Jika rekap sudah diinisialisasi, refresh data rekap
    if (typeof loadRekap === 'function' && document.getElementById('tab-rekap')?.classList.contains('active')) {
        setTimeout(() => loadRekap(), 100);
    }
});

// School Config
db.ref('school_config').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        currentSchoolConfig.type = data.type || 'smp';
        currentSchoolConfig.majors = data.majors || [];
        currentSchoolConfig.classes = data.classes || [];
    } else {
        currentSchoolConfig.type = 'smp';
        currentSchoolConfig.majors = [];
        currentSchoolConfig.classes = [];
    }
    dataReady.schoolConfig = true;
    checkAllDataReady();
    
    // Update UI langsung
    const typeSelect = document.getElementById('schoolTypeSelect');
    if (typeSelect) typeSelect.value = currentSchoolConfig.type;
    const majorsDiv = document.getElementById('majorsManager');
    if (majorsDiv) {
        majorsDiv.style.display = (currentSchoolConfig.type === 'smk' || currentSchoolConfig.type === 'both') ? 'block' : 'none';
    }
    if (typeof renderMajorsList === 'function') renderMajorsList();
    if (typeof renderClassesList === 'function') renderClassesList();
    
    // Refresh rekap jika perlu
    if (typeof loadRekap === 'function' && document.getElementById('tab-rekap')?.classList.contains('active')) {
        setTimeout(() => loadRekap(), 100);
    }
});

// Global Delay
db.ref('settings/delayOut').on('value', (snapshot) => {
    const delay = snapshot.val();
    const displaySpan = document.getElementById('globalDelayDisplay');
    if (displaySpan) {
        displaySpan.textContent = typeof formatDelayText === 'function' ? formatDelayText(delay) : (delay ? `${delay} menit` : '60 menit');
    }
    if (typeof setGlobalDelayFormValue === 'function') {
        setGlobalDelayFormValue(delay || 60);
    }
    dataReady.globalDelay = true;
    checkAllDataReady();
});

// Codes (tidak blocking untuk render awal)
db.ref('codes').on('value', (snapshot) => {
    const data = snapshot.val();
    if (typeof cleanupOldCodes === 'function') cleanupOldCodes(data);
    dbData.codes = [];
    if (data) {
        Object.keys(data).forEach(key => {
            dbData.codes.push({ code: key, ...data[key] });
        });
    }
    if (typeof renderCodesTable === 'function') renderCodesTable();
});

// ========== LISTENER UNTUK REKAP ==========
// Refresh rekap ketika ada perubahan data absensi
db.ref('absensi').on('child_added', (snapshot) => {
    // Jika tab rekap sedang aktif, refresh data
    if (document.getElementById('tab-rekap')?.classList.contains('active') && typeof loadRekap === 'function') {
        setTimeout(() => loadRekap(), 200);
    }
});

db.ref('absensi').on('child_changed', (snapshot) => {
    // Jika tab rekap sedang aktif, refresh data
    if (document.getElementById('tab-rekap')?.classList.contains('active') && typeof loadRekap === 'function') {
        setTimeout(() => loadRekap(), 200);
    }
});

// ========== LISTENER UNTUK SISWA ==========
// Refresh rekap ketika ada perubahan data siswa (nama, kelas, jurusan)
db.ref('users').on('child_changed', (snapshot) => {
    // Jika tab rekap sedang aktif, refresh data
    if (document.getElementById('tab-rekap')?.classList.contains('active') && typeof loadRekap === 'function') {
        setTimeout(() => loadRekap(), 200);
    }
});

console.log("✅ init.js loaded - Realtime listeners configured");