// Variabel Global untuk State Lokal
let dbData = {
    users: [],     // Data Siswa (Node: users) -> Untuk ESP32
    users_auth: [], // Data User Auth (Node: users_auth) -> Untuk Login Web
    attendance: [], // Data Absensi (Node: absensi)
    codes: []      // Kode Pendaftaran (Node: codes)
};

let currentUser = null;

// Listener: Data Siswa (Untuk Tab Students & ESP32)
db.ref('users').on('value', (snapshot) => {
    const data = snapshot.val();
    dbData.users = [];
    if (data) {
        Object.keys(data).forEach(key => {
            dbData.users.push({ id: key, ...data[key] });
        });
    }
    
    // Render tabel siswa
    if(typeof renderStudentsTable === 'function') renderStudentsTable();
    
    // Panggil fungsi untuk mengisi filter Kelas & Jurusan di tab Siswa
    if(typeof populateStudentFilters === 'function') populateStudentFilters();
    
    // Render filter untuk tab Absensi
    if(typeof populateFilters === 'function') populateFilters();

    // UPDATE: Panggil fungsi untuk mengisi Dropdown Siswa di tab Users (Generate Kode)
    if(typeof populateStudentSelectForCode === 'function') populateStudentSelectForCode();
});

// Listener: Data Auth Users (Untuk Tab Users Management)
db.ref('users_auth').on('value', (snapshot) => {
    const data = snapshot.val();
    dbData.users_auth = [];
    if (data) {
        Object.keys(data).forEach(uid => {
            dbData.users_auth.push({ uid: uid, ...data[uid] });
        });
    }
    if(typeof renderUsersTable === 'function') renderUsersTable();
});

// Listener: Data Absensi
db.ref('absensi').on('value', (snapshot) => {
    const data = snapshot.val();
    dbData.attendance = [];
    if (data) {
        Object.keys(data).forEach(date => {
            const dailyRecords = data[date];
            Object.keys(dailyRecords).forEach(id => {
                const record = dailyRecords[id];
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
            });
        });
    }
    dbData.attendance.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if(typeof renderTable === 'function') renderTable();
});

// --- FUNGSI BERSIH-BERSIH KODE (HAPUS LEBIH DARI 5 JAM) ---
function cleanupOldCodes(data) {
    const now = Date.now();
    const fiveHoursInMs = 5 * 60 * 60 * 1000; // 5 jam dalam milidetik

    if (!data) return;

    Object.keys(data).forEach(key => {
        const item = data[key];
        // Cek jika ada createdAt dan selisih waktu sekarang lebih dari 5 jam
        if (item.createdAt && (now - item.createdAt > fiveHoursInMs)) {
            // Hapus kode kadaluarsa dari Firebase
            db.ref('codes/' + key).remove()
                .then(() => console.log(`Kode ${key} kadaluarsa dan dihapus otomatis.`))
                .catch(err => console.error("Gagal hapus kode kadaluarsa:", err));
        }
    });
}

// Listener: Kode Pendaftaran
db.ref('codes').on('value', (snapshot) => {
    const data = snapshot.val();
    
    // 1. PANGGIL FUNGSI CLEANUP SEBELUM RENDER
    // Fungsi ini akan mengecek dan menghapus kode yang lewat 5 jam
    cleanupOldCodes(data);

    dbData.codes = [];
    if(data) {
        Object.keys(data).forEach(key => {
            dbData.codes.push({ code: key, ...data[key] });
        });
    }
    if(typeof renderCodesTable === 'function') renderCodesTable();
});