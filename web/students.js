// students.js - VERSION 2.2 (DENGAN MANAJEMEN KELAS DINAMIS)
// ======================= DROPDOWN KELAS & JURUSAN DINAMIS =======================
// Dengan real-time update, auto-sync, dan fitur hapus sidik jari dari ESP32
// Mendukung kelas kustom dari pengaturan sekolah (VII A, VIII B, X RPL, dll)

let studentsRealtimeListener = null;
let studentFormResetTimer = null;

// ======================= REAL-TIME INITIALIZATION =======================

/**
 * Inisialisasi real-time listener untuk data siswa
 */
function initRealtimeStudents() {
    console.log("🔄 Initializing real-time students system...");
    
    if (studentsRealtimeListener) {
        db.ref('users').off('value', studentsRealtimeListener);
    }
    
    // Listener untuk perubahan data siswa
    studentsRealtimeListener = db.ref('users').on('value', (snapshot) => {
        const data = snapshot.val();
        if (typeof dbData !== 'undefined') {
            const oldCount = dbData.users?.length || 0;
            dbData.users = [];
            if (data) {
                Object.keys(data).forEach(key => {
                    dbData.users.push({ id: key, ...data[key] });
                });
            }
            const newCount = dbData.users.length;
            
            if (oldCount !== newCount) {
                console.log(`📊 Students data updated: ${oldCount} -> ${newCount} students`);
                showStudentUpdateNotification(newCount - oldCount);
            }
            
            // Render ulang tabel
            if (typeof renderStudentsTable === 'function') {
                requestAnimationFrame(() => renderStudentsTable());
            }
            
            // Update filter dropdowns
            if (typeof populateStudentFilters === 'function') {
                requestAnimationFrame(() => populateStudentFilters());
            }
            
            // Update dropdown untuk generate kode
            if (typeof populateStudentSelectForCode === 'function') {
                requestAnimationFrame(() => populateStudentSelectForCode());
            }
            
            // Update statistik
            updateStudentStatistics();
        }
    });
    
    // Listener untuk child_changed (update spesifik)
    db.ref('users').on('child_changed', (snapshot) => {
        const data = snapshot.val();
        console.log(`✏️ Student updated: ID ${snapshot.key} - ${data?.nama}`);
        showToast(`✏️ Data siswa ${data?.nama || snapshot.key} telah diperbarui`, "info");
        
        // Highlight row yang diupdate
        highlightStudentRow(snapshot.key);
    });
    
    // Listener untuk child_removed
    db.ref('users').on('child_removed', (snapshot) => {
        const data = snapshot.val();
        console.log(`🗑️ Student removed: ID ${snapshot.key} - ${data?.nama}`);
        showToast(`🗑️ Siswa ${data?.nama || snapshot.key} telah dihapus`, "warning");
    });
}

/**
 * Tampilkan notifikasi untuk update siswa
 */
function showStudentUpdateNotification(changeCount) {
    if (changeCount > 0) {
        showToast(`📢 ${changeCount} siswa baru ditambahkan!`, "success");
        flashStudentsTab();
    } else if (changeCount < 0) {
        showToast(`📢 ${Math.abs(changeCount)} siswa telah dihapus`, "info");
    }
}

/**
 * Flash effect pada tab siswa
 */
function flashStudentsTab() {
    const studentsTab = document.getElementById('tab-students');
    if (studentsTab && studentsTab.classList.contains('active')) {
        const container = document.querySelector('#tab-students .table-container');
        if (container) {
            container.style.transition = 'background-color 0.3s';
            container.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
            setTimeout(() => {
                container.style.backgroundColor = '';
            }, 500);
        }
    }
    
    const tabBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => 
        b.textContent.includes('Data Siswa')
    );
    if (tabBtn && !tabBtn.querySelector('.badge-update')) {
        const badge = document.createElement('span');
        badge.className = 'badge-update';
        badge.textContent = '●';
        badge.style.cssText = 'color: #4caf50; margin-left: 5px; font-size: 10px;';
        tabBtn.appendChild(badge);
        setTimeout(() => badge.remove(), 2000);
    }
}

/**
 * Highlight row siswa yang diupdate
 */
function highlightStudentRow(studentId) {
    const rows = document.querySelectorAll('#tbody-students tr');
    rows.forEach(row => {
        const firstCell = row.cells[0];
        if (firstCell && firstCell.textContent == studentId) {
            row.style.transition = 'background-color 0.3s';
            row.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
            setTimeout(() => {
                row.style.backgroundColor = '';
            }, 1000);
        }
    });
}

/**
 * Update statistik siswa di UI
 */
function updateStudentStatistics() {
    const statsContainer = document.getElementById('studentsStats');
    if (!statsContainer) {
        createStudentsStatsContainer();
        return;
    }
    
    const totalStudents = dbData.users.length;
    const kelasCount = {};
    const jurusanCount = {};
    
    dbData.users.forEach(s => {
        if (s.kelas) kelasCount[s.kelas] = (kelasCount[s.kelas] || 0) + 1;
        if (s.jurusan) jurusanCount[s.jurusan] = (jurusanCount[s.jurusan] || 0) + 1;
    });
    
    const topKelas = Object.entries(kelasCount).sort((a,b) => b[1] - a[1])[0];
    const topJurusan = Object.entries(jurusanCount).sort((a,b) => b[1] - a[1])[0];
    
    statsContainer.innerHTML = `
        <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 15px; padding: 10px; background: #1e1e1e; border-radius: 8px;">
            <div><span style="color: #4a90e2;">👥 Total Siswa:</span> <strong>${totalStudents}</strong></div>
            <div><span style="color: #4a90e2;">📚 Kelas Terbanyak:</span> <strong>${topKelas ? `${topKelas[0]} (${topKelas[1]})` : '-'}</strong></div>
            <div><span style="color: #4a90e2;">🎓 Jurusan Terbanyak:</span> <strong>${topJurusan ? `${topJurusan[0]} (${topJurusan[1]})` : '-'}</strong></div>
        </div>
    `;
}

function createStudentsStatsContainer() {
    const controlsBar = document.querySelector('#tab-students .controls-bar:first-child');
    if (controlsBar && !document.getElementById('studentsStats')) {
        const statsDiv = document.createElement('div');
        statsDiv.id = 'studentsStats';
        statsDiv.style.marginBottom = '10px';
        controlsBar.insertAdjacentElement('afterend', statsDiv);
    }
}

// ======================= DROPDOWN KELAS & JURUSAN DINAMIS =======================

/**
 * Populate dropdown kelas menggunakan daftar dari pengaturan sekolah
 * Mendukung kelas kustom seperti VII A, VIII B, X RPL, dll
 */
function populateKelasOptions() {
    const kelasSelect = document.getElementById('newKelas');
    if (!kelasSelect) return;

    // Ambil daftar kelas dari currentSchoolConfig (pengaturan sekolah)
    let options = [];
    
    if (currentSchoolConfig && currentSchoolConfig.classes && currentSchoolConfig.classes.length > 0) {
        // Gunakan daftar kelas dari database (sudah termasuk kelas kustom)
        options = currentSchoolConfig.classes;
        console.log(`📚 Menggunakan daftar kelas dari pengaturan: ${options.length} kelas`);
    } else {
        // Fallback ke default jika belum ada konfigurasi
        const schoolType = currentSchoolConfig?.type || 'smp';
        if (schoolType === 'smp') {
            options = ['VII', 'VIII', 'IX'];
        } else if (schoolType === 'smk') {
            options = ['X', 'XI', 'XII'];
        } else if (schoolType === 'both') {
            options = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
        }
        console.log(`📚 Menggunakan fallback kelas default: ${options.length} kelas`);
    }

    const currentValue = kelasSelect.value;
    kelasSelect.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
        options.map(k => `<option value="${k}">${k}</option>`).join('');
    
    if (currentValue && options.includes(currentValue)) {
        kelasSelect.value = currentValue;
    }
}

/**
 * Populate dropdown jurusan menggunakan daftar dari pengaturan sekolah
 */
function populateJurusanOptions() {
    const jurusanSelect = document.getElementById('newJurusan');
    if (!jurusanSelect) return;

    const currentValue = jurusanSelect.value;
    jurusanSelect.innerHTML = '<option value="">-- Pilih Jurusan --</option>';
    
    if (currentSchoolConfig?.majors && currentSchoolConfig.majors.length > 0) {
        currentSchoolConfig.majors.forEach(j => {
            jurusanSelect.innerHTML += `<option value="${j}">${j}</option>`;
        });
    } else {
        jurusanSelect.innerHTML += '<option value="UMUM">UMUM</option>';
    }
    
    if (currentValue && currentSchoolConfig?.majors?.includes(currentValue)) {
        jurusanSelect.value = currentValue;
    }
}

// ======================= FUNGSI DELAY (JAM/MENIT) =======================

function toggleDelayInput() {
    const unit = document.getElementById('delayUnit');
    if (!unit) return;
    
    const minutesGroup = document.getElementById('delayMinutesGroup');
    const hoursGroup = document.getElementById('delayHoursGroup');
    const hiddenDelay = document.getElementById('newDelay');
    
    if (unit.value === 'minutes') {
        if (minutesGroup) minutesGroup.style.display = 'flex';
        if (hoursGroup) hoursGroup.style.display = 'none';
        const minutesValue = parseInt(document.getElementById('delayMinutesValue')?.value) || 60;
        if (hiddenDelay) hiddenDelay.value = minutesValue;
    } else {
        if (minutesGroup) minutesGroup.style.display = 'none';
        if (hoursGroup) hoursGroup.style.display = 'flex';
        const hoursValue = parseInt(document.getElementById('delayHoursValue')?.value) || 1;
        if (hiddenDelay) hiddenDelay.value = hoursValue * 60;
    }
}

function updateDelayFromMinutes() {
    const minutesValue = parseInt(document.getElementById('delayMinutesValue')?.value) || 0;
    const hiddenDelay = document.getElementById('newDelay');
    if (hiddenDelay) hiddenDelay.value = minutesValue;
}

function updateDelayFromHours() {
    const hoursValue = parseInt(document.getElementById('delayHoursValue')?.value) || 0;
    const hiddenDelay = document.getElementById('newDelay');
    if (hiddenDelay) hiddenDelay.value = hoursValue * 60;
}

function getDelayInMinutes() {
    const unit = document.getElementById('delayUnit')?.value;
    if (unit === 'minutes') {
        return parseInt(document.getElementById('delayMinutesValue')?.value) || 60;
    } else {
        const hours = parseInt(document.getElementById('delayHoursValue')?.value) || 1;
        return hours * 60;
    }
}

function setDelayFormValue(delayMinutes) {
    if (!delayMinutes && delayMinutes !== 0) {
        delayMinutes = 60;
    }
    
    const hours = Math.floor(delayMinutes / 60);
    const minutes = delayMinutes % 60;
    
    const delayUnit = document.getElementById('delayUnit');
    const delayHoursValue = document.getElementById('delayHoursValue');
    const delayMinutesValue = document.getElementById('delayMinutesValue');
    
    if (hours > 0 && minutes === 0) {
        if (delayUnit) delayUnit.value = 'hours';
        if (delayHoursValue) delayHoursValue.value = hours;
    } else {
        if (delayUnit) delayUnit.value = 'minutes';
        if (delayMinutesValue) delayMinutesValue.value = delayMinutes;
    }
    toggleDelayInput();
}

function formatDelayDisplay(delayMinutes) {
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

// ======================= FUNGSI FILTER SISWA =======================

/**
 * Populate filter dropdown kelas menggunakan daftar dari pengaturan sekolah
 */
function populateStudentFilters() {
    const kSelect = document.getElementById('filterStudentKelas');
    const jSelect = document.getElementById('filterStudentJurusan');
    
    if (!kSelect || !jSelect) return;

    // Gunakan daftar kelas dari pengaturan sekolah
    let kelasOptions = [];
    
    if (currentSchoolConfig && currentSchoolConfig.classes && currentSchoolConfig.classes.length > 0) {
        kelasOptions = currentSchoolConfig.classes;
        console.log(`🔍 Filter kelas: menggunakan ${kelasOptions.length} kelas dari pengaturan`);
    } else {
        // Fallback ke default
        const schoolType = currentSchoolConfig?.type || 'smp';
        if (schoolType === 'smp') kelasOptions = ['VII', 'VIII', 'IX'];
        else if (schoolType === 'smk') kelasOptions = ['X', 'XI', 'XII'];
        else if (schoolType === 'both') kelasOptions = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    }

    const currentKelas = kSelect.value;
    kSelect.innerHTML = '<option value="all">📚 Semua Kelas</option>' +
        kelasOptions.map(k => `<option value="${k}">${k}</option>`).join('');
    if (currentKelas !== 'all' && kelasOptions.includes(currentKelas)) {
        kSelect.value = currentKelas;
    }

    // Jurusan options
    const currentJurusan = jSelect.value;
    jSelect.innerHTML = '<option value="all">🎓 Semua Jurusan</option>';
    if (currentSchoolConfig?.majors && currentSchoolConfig.majors.length > 0) {
        currentSchoolConfig.majors.forEach(j => {
            jSelect.innerHTML += `<option value="${j}">${j}</option>`;
        });
    } else {
        jSelect.innerHTML += '<option value="UMUM">UMUM</option>';
    }
    if (currentJurusan !== 'all' && currentSchoolConfig?.majors?.includes(currentJurusan)) {
        jSelect.value = currentJurusan;
    }
}

// ======================= RENDER TABEL SISWA =======================

function renderStudentsTable() {
    const tbody = document.getElementById('tbody-students');
    const search = document.getElementById('searchStudentName');
    const fKelas = document.getElementById('filterStudentKelas');
    const fJurusan = document.getElementById('filterStudentJurusan');
    
    if (!tbody) return;
    
    const searchValue = search?.value.toLowerCase() || '';
    const kelasValue = fKelas?.value || 'all';
    const jurusanValue = fJurusan?.value || 'all';

    let data = dbData.users.filter(u => u.nama && u.nama.toLowerCase().includes(searchValue));

    if (kelasValue !== 'all') data = data.filter(u => u.kelas === kelasValue);
    if (jurusanValue !== 'all') data = data.filter(u => u.jurusan === jurusanValue);
    
    data.sort((a, b) => parseInt(a.id) - parseInt(b.id));

    tbody.innerHTML = '';
    
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px;">
            📭 Data siswa tidak ditemukan.
            ${searchValue ? '<br><small>Coba kata kunci lain</small>' : '<br><small>Tambahkan siswa baru melalui form di atas</small>'}
        </td></tr>`;
        return;
    }

    data.forEach((s, index) => {
        const delayDisplay = formatDelayDisplay(s.delayOut);
        const isNew = s.createdAt && (Date.now() - s.createdAt < 5 * 60 * 1000);
        
        tbody.innerHTML += `
            <tr class="${isNew ? 'student-new-row' : ''}" data-id="${s.id}">
                <td><strong>${s.id}</strong>${isNew ? '<br><span class="badge-new-student">NEW</span>' : ''}</td>
                <td>${escapeHtml(s.nama)}</td>
                <td>${s.kelas || '-'}</td>
                <td>${s.jurusan || '-'}</td>
                <td><span class="delay-badge">⏱️ ${delayDisplay}</span></td>
                <td>
                    <button class="btn-icon edit" onclick="editStudent('${s.id}')" title="Edit Siswa">✏️</button>
                    <button class="btn-icon delete" onclick="deleteStudentWithFP('${s.id}')" title="Hapus Siswa (termasuk sidik jari)">🗑️</button>
                   </td>
               </tr>
        `;
    });
    
    updateStudentStatistics();
    console.log(`📊 renderStudentsTable: ${data.length} students displayed`);
}

// ======================= HAPUS SISWA + SIDIK JARI DARI ESP32 =======================

/**
 * Hapus siswa beserta sidik jari di semua sensor ESP32
 */
async function deleteStudentWithFP(studentId) {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    if (currentUser.role === 'siswa') {
        showToast("⛔ Siswa tidak dapat menghapus data!", "error");
        return;
    }
    
    const student = dbData.users.find(u => u.id == studentId);
    const studentName = student?.nama || studentId;
    
    if (!confirm(`⚠️ YIKIN HAPUS SISWA: "${studentName}"?\n\n✅ Data siswa akan dihapus dari database\n✅ Sidik jari akan dihapus dari SEMUA sensor fingerprint (16 sensor)\n✅ Akun pengguna (jika ada) juga akan dihapus\n\n⚠️ TINDAKAN INI TIDAK DAPAT DIBATALKAN!`)) {
        return;
    }
    
    // Cek apakah siswa sudah memiliki akun
    const registeredUser = dbData.users_auth?.find(u => u.fpId == studentId);
    if (registeredUser) {
        if (!confirm(`⚠️ Siswa ini sudah memiliki akun (${registeredUser.email}).\n\nHapus juga akun pengguna?`)) {
            return;
        }
    }
    
    // Nonaktifkan tombol
    const btns = document.querySelectorAll(`button[onclick*="deleteStudent"][onclick*="${studentId}"]`);
    btns.forEach(btn => {
        btn.disabled = true;
        btn.innerHTML = '⏳...';
    });
    
    showToast(`🗑️ Menghapus ${studentName}...`, "info");
    
    // ======================= 1. KIRIM PERINTAH HAPUS KE ESP32 =======================
    try {
        showToast(`📡 Mengirim perintah hapus sidik jari ke ESP32...`, "info");
        
        const commandRef = db.ref('commands/esp32/delete_fingerprint');
        await commandRef.set({
            studentId: parseInt(studentId),
            studentName: studentName,
            requestedBy: currentUser.nama || currentUser.email,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            status: 'pending'
        });
        
        let commandCompleted = false;
        let responseReceived = false;
        
        const responseRef = db.ref('commands/esp32/delete_fingerprint_response');
        
        const responsePromise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!responseReceived) {
                    console.log("Timeout menunggu response ESP32");
                    resolve(false);
                }
            }, 15000);
            
            const responseListener = responseRef.on('value', (snapshot) => {
                const data = snapshot.val();
                if (data && data.studentId == studentId && data.status === 'completed') {
                    responseReceived = true;
                    clearTimeout(timeout);
                    responseRef.off('value', responseListener);
                    commandCompleted = true;
                    resolve(true);
                    showToast(`✅ Sidik jari ${studentName} berhasil dihapus dari sensor`, "success");
                } else if (data && data.studentId == studentId && data.status === 'failed') {
                    responseReceived = true;
                    clearTimeout(timeout);
                    responseRef.off('value', responseListener);
                    commandCompleted = true;
                    resolve(false);
                    showToast(`⚠️ Gagal hapus sidik jari: ${data.error || 'unknown'}`, "warning");
                }
            });
        });
        
        await responsePromise;
        
        if (!commandCompleted) {
            showToast(`⚠️ ESP32 tidak merespon, sidik jari mungkin masih tersimpan`, "warning");
        }
        
        setTimeout(() => {
            db.ref('commands/esp32/delete_fingerprint').remove().catch(() => {});
            db.ref('commands/esp32/delete_fingerprint_response').remove().catch(() => {});
        }, 2000);
        
    } catch (err) {
        console.error("Error sending delete command:", err);
        showToast(`⚠️ Tidak dapat komunikasi dengan ESP32`, "warning");
    }
    
    // ======================= 2. HAPUS AKUN USER (JIKA ADA) =======================
    if (registeredUser) {
        try {
            await db.ref(`users_auth/${registeredUser.uid}`).remove();
            console.log("✅ User auth removed");
            showToast(`✅ Akun ${registeredUser.email} berhasil dihapus`, "success");
        } catch (err) {
            console.warn("Gagal hapus user auth:", err);
        }
    }
    
    // ======================= 3. HAPUS DATA SISWA DARI DATABASE =======================
    try {
        await db.ref(`users/${studentId}`).remove();
        showToast(`✅ Data siswa "${studentName}" berhasil dihapus dari database`, "success");
        
        setTimeout(() => {
            if (typeof renderStudentsTable === 'function') renderStudentsTable();
            if (typeof populateStudentSelectForCode === 'function') populateStudentSelectForCode();
            if (typeof populateFilters === 'function') populateFilters();
        }, 500);
        
    } catch (err) {
        console.error("Delete error:", err);
        showToast("❌ Gagal menghapus data siswa: " + err.message, "error");
    }
    
    btns.forEach(btn => {
        btn.disabled = false;
        btn.innerHTML = '🗑️';
    });
}

function deleteStudent(id) {
    if (confirm(`⚠️ Hapus siswa ini akan MENGHAPUS SIDIK JARI dari semua sensor.\n\nLanjutkan?`)) {
        deleteStudentWithFP(id);
    }
}

// ======================= CRUD SISWA LAINNYA =======================

function saveStudent() {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    if (currentUser.role === 'siswa') {
        showToast("⛔ Siswa tidak dapat menambah/mengedit data!", "error");
        return;
    }
    
    let idStr = document.getElementById('newId')?.value.trim();
    const nama = document.getElementById('newNama')?.value.trim();
    const kelas = document.getElementById('newKelas')?.value;
    const jurusan = document.getElementById('newJurusan')?.value;
    const delayInMinutes = getDelayInMinutes();
    const mode = document.getElementById('editMode')?.value;

    if (!nama || !idStr) {
        showToast("⚠️ ID & Nama wajib diisi!", "error");
        document.getElementById('newId')?.focus();
        return;
    }
    
    if (!kelas) {
        showToast("⚠️ Pilih Kelas!", "error");
        return;
    }
    
    if (!jurusan) {
        showToast("⚠️ Pilih Jurusan!", "error");
        return;
    }
    
    if (delayInMinutes <= 0) {
        showToast("⚠️ Delay harus lebih dari 0 menit!", "error");
        return;
    }
    
    if (isNaN(parseInt(idStr))) {
        showToast("⚠️ ID harus berupa angka!", "error");
        return;
    }

    const studentData = { 
        id: parseInt(idStr),
        nama: nama, 
        kelas: kelas, 
        jurusan: jurusan, 
        delayOut: delayInMinutes,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    
    if (mode === 'add') {
        studentData.createdAt = firebase.database.ServerValue.TIMESTAMP;
    }
    
    const path = `users/${idStr}`;

    if (mode === 'add' && dbData.users.find(u => u.id == idStr)) {
        showToast("❌ ID sudah ada! Gunakan ID lain.", "error");
        return;
    }

    const btn = document.getElementById('btnSaveStudent');
    const originalText = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '💾 Menyimpan...';
    }

    db.ref(path).set(studentData)
        .then(() => {
            showToast(mode === 'add' ? "✅ Data siswa berhasil ditambahkan" : "✅ Data siswa berhasil diupdate");
            resetStudentForm();

            const registeredUser = dbData.users_auth?.find(u => u.fpId == idStr);
            if (registeredUser) {
                db.ref(`users_auth/${registeredUser.uid}`).update({ 
                    nama: nama, 
                    kelas: kelas, 
                    jurusan: jurusan 
                }).then(() => {
                    console.log("✅ Profil siswa di users_auth juga diperbarui");
                    if (currentUser.uid === registeredUser.uid) {
                        currentUser.nama = nama;
                        currentUser.kelas = kelas;
                        currentUser.jurusan = jurusan;
                        if (typeof saveUserToLocalStorage === 'function') {
                            saveUserToLocalStorage(currentUser);
                        }
                        if (typeof updateUserInterface === 'function') {
                            updateUserInterface();
                        }
                    }
                }).catch(err => console.warn("Sinkronisasi users_auth gagal:", err));
            }
        })
        .catch((err) => {
            console.error("Save error:", err);
            showToast("❌ Gagal menyimpan: " + err.message, "error");
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText || (mode === 'add' ? '➕ Simpan Siswa' : '💾 Update');
            }
        });
}

function editStudent(id) {
    const s = dbData.users.find(u => u.id == id);
    if (s) {
        document.querySelector('#tab-students .controls-bar:first-child')?.scrollIntoView({ behavior: 'smooth' });
        
        document.getElementById('newId').value = s.id;
        document.getElementById('newId').disabled = true;
        document.getElementById('newNama').value = s.nama;
        document.getElementById('newKelas').value = s.kelas;
        document.getElementById('newJurusan').value = s.jurusan;
        
        setDelayFormValue(s.delayOut || 60);
        
        document.getElementById('editMode').value = 'edit';
        const btnSave = document.getElementById('btnSaveStudent');
        const btnCancel = document.getElementById('btnCancelStudent');
        if (btnSave) {
            btnSave.innerHTML = '💾 Update Siswa';
            btnSave.style.background = 'var(--warning)';
        }
        if (btnCancel) btnCancel.classList.remove('hidden');
        
        showToast(`✏️ Edit mode: ${s.nama}`, "info");
    } else {
        showToast("❌ Data siswa tidak ditemukan!", "error");
    }
}

function resetStudentForm() {
    if (studentFormResetTimer) clearTimeout(studentFormResetTimer);
    
    document.getElementById('newId').value = '';
    document.getElementById('newId').disabled = false;
    document.getElementById('newNama').value = '';
    document.getElementById('newKelas').value = '';
    document.getElementById('newJurusan').value = '';
    
    const delayUnit = document.getElementById('delayUnit');
    const delayMinutesValue = document.getElementById('delayMinutesValue');
    const delayHoursValue = document.getElementById('delayHoursValue');
    const hiddenDelay = document.getElementById('newDelay');
    
    if (delayUnit) delayUnit.value = 'minutes';
    if (delayMinutesValue) delayMinutesValue.value = '60';
    if (delayHoursValue) delayHoursValue.value = '1';
    if (hiddenDelay) hiddenDelay.value = '60';
    toggleDelayInput();
    
    document.getElementById('editMode').value = 'add';
    const btnSave = document.getElementById('btnSaveStudent');
    const btnCancel = document.getElementById('btnCancelStudent');
    if (btnSave) {
        btnSave.innerHTML = '➕ Simpan Siswa';
        btnSave.style.background = '';
    }
    if (btnCancel) btnCancel.classList.add('hidden');
    
    studentFormResetTimer = setTimeout(() => {
        document.getElementById('newId')?.focus();
    }, 100);
}

// ======================= BULK OPERATIONS =======================

function importStudentsFromCSV(csvText) {
    const lines = csvText.trim().split('\n');
    let successCount = 0;
    let errorCount = 0;
    
    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 4) {
            const id = parts[0].trim();
            const nama = parts[1].trim();
            const kelas = parts[2].trim();
            const jurusan = parts[3].trim();
            const delay = parts[4] ? parseInt(parts[4].trim()) : 60;
            
            if (id && nama && kelas && jurusan) {
                const studentData = {
                    id: parseInt(id),
                    nama: nama,
                    kelas: kelas,
                    jurusan: jurusan,
                    delayOut: delay,
                    createdAt: firebase.database.ServerValue.TIMESTAMP
                };
                
                db.ref(`users/${id}`).set(studentData)
                    .then(() => successCount++)
                    .catch(() => errorCount++);
            } else {
                errorCount++;
            }
        } else {
            errorCount++;
        }
    }
    
    setTimeout(() => {
        showToast(`✅ Import selesai: ${successCount} berhasil, ${errorCount} gagal`, 
                  errorCount > 0 ? "warning" : "success");
    }, 500);
}

function exportStudentsToCSV() {
    if (!dbData.users || dbData.users.length === 0) {
        showToast("❌ Tidak ada data siswa untuk diekspor!", "error");
        return;
    }
    
    let csv = "\uFEFFID,Nama,Kelas,Jurusan,Delay (menit)\n";
    
    dbData.users.forEach(s => {
        csv += `"${s.id}","${escapeCsv(s.nama)}","${s.kelas || '-'}","${s.jurusan || '-'}","${s.delayOut || 60}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `data_siswa_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showToast("📥 Data siswa berhasil diekspor", "success");
}

function escapeCsv(str) {
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// ======================= CLEANUP =======================

function cleanupStudentsSystem() {
    if (studentsRealtimeListener) {
        db.ref('users').off('value', studentsRealtimeListener);
        studentsRealtimeListener = null;
    }
    if (studentFormResetTimer) {
        clearTimeout(studentFormResetTimer);
    }
    console.log("🧹 Students system cleaned up");
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ======================= INISIALISASI =======================

function initDelayEventListeners() {
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
    
    setTimeout(() => toggleDelayInput(), 100);
}

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (currentUser) {
                initRealtimeStudents();
            }
        }, 1500);
    });
} else {
    setTimeout(() => {
        if (currentUser) {
            initRealtimeStudents();
        }
    }, 1500);
}

// Export ke global scope
window.populateKelasOptions = populateKelasOptions;
window.populateJurusanOptions = populateJurusanOptions;
window.toggleDelayInput = toggleDelayInput;
window.updateDelayFromMinutes = updateDelayFromMinutes;
window.updateDelayFromHours = updateDelayFromHours;
window.getDelayInMinutes = getDelayInMinutes;
window.setDelayFormValue = setDelayFormValue;
window.formatDelayDisplay = formatDelayDisplay;
window.populateStudentFilters = populateStudentFilters;
window.renderStudentsTable = renderStudentsTable;
window.saveStudent = saveStudent;
window.editStudent = editStudent;
window.resetStudentForm = resetStudentForm;
window.deleteStudent = deleteStudent;
window.deleteStudentWithFP = deleteStudentWithFP;
window.importStudentsFromCSV = importStudentsFromCSV;
window.exportStudentsToCSV = exportStudentsToCSV;
window.initRealtimeStudents = initRealtimeStudents;
window.cleanupStudentsSystem = cleanupStudentsSystem;
window.initDelayEventListeners = initDelayEventListeners;