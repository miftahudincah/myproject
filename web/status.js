// students.js - VERSION 2.3 (FINAL)
// ======================= MANAJEMEN DATA SISWA =======================
// Fitur: CRUD siswa, sinkronisasi dengan ESP32, delay per siswa,
//        dukungan kelas & jurusan dinamis dari pengaturan sekolah.
// ====================================================================

let studentsRealtimeListener = null;
let studentFormResetTimer = null;

// ======================= REAL-TIME INITIALIZATION =======================

function initRealtimeStudents() {
    if (typeof db === 'undefined' || !db) {
        console.warn("Firebase not ready, retrying in 1s");
        setTimeout(initRealtimeStudents, 1000);
        return;
    }
    console.log("🔄 Initializing real-time students system...");

    if (studentsRealtimeListener) {
        db.ref('users').off('value', studentsRealtimeListener);
    }

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
                console.log(`📊 Students: ${oldCount} → ${newCount}`);
                showStudentUpdateNotification(newCount - oldCount);
            }
            if (typeof renderStudentsTable === 'function') requestAnimationFrame(() => renderStudentsTable());
            if (typeof populateStudentFilters === 'function') requestAnimationFrame(() => populateStudentFilters());
            if (typeof populateStudentSelectForCode === 'function') requestAnimationFrame(() => populateStudentSelectForCode());
            updateStudentStatistics();
        }
    });

    db.ref('users').on('child_changed', (snapshot) => {
        const data = snapshot.val();
        if (data?.nama) {
            showToast(`✏️ Data siswa ${data.nama} diperbarui`, "info");
            highlightStudentRow(snapshot.key);
        }
    });

    db.ref('users').on('child_removed', (snapshot) => {
        const data = snapshot.val();
        showToast(`🗑️ Siswa ${data?.nama || snapshot.key} dihapus`, "warning");
    });
}

function showStudentUpdateNotification(changeCount) {
    if (changeCount > 0) {
        showToast(`📢 ${changeCount} siswa baru ditambahkan!`, "success");
        flashStudentsTab();
    } else if (changeCount < 0) {
        showToast(`📢 ${Math.abs(changeCount)} siswa dihapus`, "info");
    }
}

function flashStudentsTab() {
    const container = document.querySelector('#tab-students .table-container');
    if (container && document.getElementById('tab-students').classList.contains('active')) {
        container.style.transition = 'background-color 0.3s';
        container.style.backgroundColor = 'rgba(76,175,80,0.1)';
        setTimeout(() => container.style.backgroundColor = '', 500);
    }
    const tabBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.textContent.includes('Data Siswa'));
    if (tabBtn && !tabBtn.querySelector('.badge-update')) {
        const badge = document.createElement('span');
        badge.className = 'badge-update';
        badge.textContent = '●';
        badge.style.cssText = 'color:#4caf50;margin-left:5px;font-size:10px;';
        tabBtn.appendChild(badge);
        setTimeout(() => badge.remove(), 2000);
    }
}

function highlightStudentRow(studentId) {
    const rows = document.querySelectorAll('#tbody-students tr');
    rows.forEach(row => {
        if (row.cells[0]?.textContent == studentId) {
            row.style.backgroundColor = 'rgba(76,175,80,0.2)';
            setTimeout(() => row.style.backgroundColor = '', 1000);
        }
    });
}

function updateStudentStatistics() {
    let statsContainer = document.getElementById('studentsStats');
    if (!statsContainer) {
        const controlsBar = document.querySelector('#tab-students .controls-bar:first-child');
        if (controlsBar) {
            statsContainer = document.createElement('div');
            statsContainer.id = 'studentsStats';
            statsContainer.style.marginBottom = '10px';
            controlsBar.insertAdjacentElement('afterend', statsContainer);
        } else return;
    }

    const total = dbData.users.length;
    const kelasCount = {}, jurusanCount = {};
    dbData.users.forEach(s => {
        if (s.kelas) kelasCount[s.kelas] = (kelasCount[s.kelas] || 0) + 1;
        if (s.jurusan) jurusanCount[s.jurusan] = (jurusanCount[s.jurusan] || 0) + 1;
    });
    const topKelas = Object.entries(kelasCount).sort((a,b) => b[1]-a[1])[0];
    const topJurusan = Object.entries(jurusanCount).sort((a,b) => b[1]-a[1])[0];

    statsContainer.innerHTML = `
        <div style="display:flex;gap:20px;flex-wrap:wrap;padding:10px;background:#1e1e1e;border-radius:8px;margin-bottom:15px;">
            <div><span style="color:#4a90e2;">👥 Total Siswa:</span> <strong>${total}</strong></div>
            <div><span style="color:#4a90e2;">📚 Kelas Terbanyak:</span> <strong>${topKelas ? `${topKelas[0]} (${topKelas[1]})` : '-'}</strong></div>
            <div><span style="color:#4a90e2;">🎓 Jurusan Terbanyak:</span> <strong>${topJurusan ? `${topJurusan[0]} (${topJurusan[1]})` : '-'}</strong></div>
        </div>
    `;
}

// ======================= DROPDOWN DINAMIS =======================

function populateKelasOptions() {
    const kelasSelect = document.getElementById('newKelas');
    if (!kelasSelect) return;
    let options = [];
    if (currentSchoolConfig?.classes?.length) {
        options = currentSchoolConfig.classes;
    } else {
        const type = currentSchoolConfig?.type || 'smp';
        if (type === 'smp') options = ['VII','VIII','IX'];
        else if (type === 'smk') options = ['X','XI','XII'];
        else options = ['VII','VIII','IX','X','XI','XII'];
    }
    const currentVal = kelasSelect.value;
    kelasSelect.innerHTML = '<option value="">-- Pilih Kelas --</option>' + options.map(k => `<option value="${k}">${k}</option>`).join('');
    if (currentVal && options.includes(currentVal)) kelasSelect.value = currentVal;
}

function populateJurusanOptions() {
    const jurusanSelect = document.getElementById('newJurusan');
    if (!jurusanSelect) return;
    const currentVal = jurusanSelect.value;
    jurusanSelect.innerHTML = '<option value="">-- Pilih Jurusan --</option>';
    if (currentSchoolConfig?.majors?.length) {
        currentSchoolConfig.majors.forEach(j => jurusanSelect.innerHTML += `<option value="${j}">${j}</option>`);
    } else {
        jurusanSelect.innerHTML += '<option value="UMUM">UMUM</option>';
    }
    if (currentVal && currentSchoolConfig?.majors?.includes(currentVal)) jurusanSelect.value = currentVal;
}

function populateStudentFilters() {
    const kSelect = document.getElementById('filterStudentKelas');
    const jSelect = document.getElementById('filterStudentJurusan');
    if (!kSelect || !jSelect) return;

    let kelasOptions = [];
    if (currentSchoolConfig?.classes?.length) kelasOptions = currentSchoolConfig.classes;
    else {
        const type = currentSchoolConfig?.type || 'smp';
        if (type === 'smp') kelasOptions = ['VII','VIII','IX'];
        else if (type === 'smk') kelasOptions = ['X','XI','XII'];
        else kelasOptions = ['VII','VIII','IX','X','XI','XII'];
    }
    const currentKelas = kSelect.value;
    kSelect.innerHTML = '<option value="all">📚 Semua Kelas</option>' + kelasOptions.map(k => `<option value="${k}">${k}</option>`).join('');
    if (currentKelas !== 'all' && kelasOptions.includes(currentKelas)) kSelect.value = currentKelas;

    const currentJurusan = jSelect.value;
    jSelect.innerHTML = '<option value="all">🎓 Semua Jurusan</option>';
    if (currentSchoolConfig?.majors?.length) {
        currentSchoolConfig.majors.forEach(j => jSelect.innerHTML += `<option value="${j}">${j}</option>`);
    } else {
        jSelect.innerHTML += '<option value="UMUM">UMUM</option>';
    }
    if (currentJurusan !== 'all' && currentSchoolConfig?.majors?.includes(currentJurusan)) jSelect.value = currentJurusan;
}

// ======================= DELAY INPUT HANDLERS =======================

function toggleDelayInput() {
    const unit = document.getElementById('delayUnit');
    if (!unit) return;
    const minutesGroup = document.getElementById('delayMinutesGroup');
    const hoursGroup = document.getElementById('delayHoursGroup');
    const hidden = document.getElementById('newDelay');
    if (unit.value === 'minutes') {
        if (minutesGroup) minutesGroup.style.display = 'flex';
        if (hoursGroup) hoursGroup.style.display = 'none';
        if (hidden) hidden.value = parseInt(document.getElementById('delayMinutesValue')?.value) || 60;
    } else {
        if (minutesGroup) minutesGroup.style.display = 'none';
        if (hoursGroup) hoursGroup.style.display = 'flex';
        if (hidden) hidden.value = (parseInt(document.getElementById('delayHoursValue')?.value) || 1) * 60;
    }
}

function updateDelayFromMinutes() {
    const val = parseInt(document.getElementById('delayMinutesValue')?.value) || 0;
    const hidden = document.getElementById('newDelay');
    if (hidden) hidden.value = val;
}

function updateDelayFromHours() {
    const val = parseInt(document.getElementById('delayHoursValue')?.value) || 0;
    const hidden = document.getElementById('newDelay');
    if (hidden) hidden.value = val * 60;
}

function getDelayInMinutes() {
    const unit = document.getElementById('delayUnit')?.value;
    if (unit === 'minutes') return parseInt(document.getElementById('delayMinutesValue')?.value) || 60;
    return (parseInt(document.getElementById('delayHoursValue')?.value) || 1) * 60;
}

function setDelayFormValue(delayMinutes) {
    if (!delayMinutes && delayMinutes !== 0) delayMinutes = 60;
    const hours = Math.floor(delayMinutes / 60);
    const minutes = delayMinutes % 60;
    const unit = document.getElementById('delayUnit');
    const hoursSelect = document.getElementById('delayHoursValue');
    const minutesInput = document.getElementById('delayMinutesValue');
    if (hours > 0 && minutes === 0) {
        if (unit) unit.value = 'hours';
        if (hoursSelect) hoursSelect.value = hours;
    } else {
        if (unit) unit.value = 'minutes';
        if (minutesInput) minutesInput.value = delayMinutes;
    }
    toggleDelayInput();
}

function formatDelayDisplay(delayMinutes) {
    if (!delayMinutes && delayMinutes !== 0) return '-';
    const jam = Math.floor(delayMinutes / 60);
    const menit = delayMinutes % 60;
    if (jam > 0 && menit > 0) return `${jam} jam ${menit} menit`;
    if (jam > 0) return `${jam} jam`;
    return `${menit} menit`;
}

// ======================= RENDER TABEL SISWA =======================

function renderStudentsTable() {
    const tbody = document.getElementById('tbody-students');
    if (!tbody) return;
    const search = document.getElementById('searchStudentName')?.value.toLowerCase() || '';
    const kelas = document.getElementById('filterStudentKelas')?.value || 'all';
    const jurusan = document.getElementById('filterStudentJurusan')?.value || 'all';

    let data = dbData.users.filter(u => u.nama && u.nama.toLowerCase().includes(search));
    if (kelas !== 'all') data = data.filter(u => u.kelas === kelas);
    if (jurusan !== 'all') data = data.filter(u => u.jurusan === jurusan);
    data.sort((a,b) => parseInt(a.id) - parseInt(b.id));

    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;">📭 Data siswa tidak ditemukan.</td></tr>`;
        return;
    }

    data.forEach(s => {
        const isNew = s.createdAt && (Date.now() - s.createdAt < 300000);
        tbody.innerHTML += `
            <tr data-id="${s.id}">
                <td><strong>${s.id}</strong>${isNew ? '<br><span class="badge-new-student">NEW</span>' : ''}</td>
                <td>${escapeHtml(s.nama)}</td>
                <td>${s.kelas || '-'}</td>
                <td>${s.jurusan || '-'}</td>
                <td><span class="delay-badge">⏱️ ${formatDelayDisplay(s.delayOut)}</span></td>
                <td>
                    <button class="btn-icon edit" onclick="editStudent('${s.id}')" title="Edit">✏️</button>
                    <button class="btn-icon delete" onclick="deleteStudentWithFP('${s.id}')" title="Hapus">🗑️</button>
                </td>
            </tr>
        `;
    });
    updateStudentStatistics();
}

// ======================= HAPUS SISWA + FP =======================

async function deleteStudentWithFP(studentId) {
    if (!currentUser || currentUser.role === 'siswa') {
        showToast("⛔ Akses ditolak!", "error");
        return;
    }
    const student = dbData.users.find(u => u.id == studentId);
    const name = student?.nama || studentId;
    if (!confirm(`⚠️ Hapus siswa "${name}"? Data akan dihapus dari DB dan sidik jari dari semua sensor ESP32.\n\nTINDAKAN INI TIDAK DAPAT DIBATALKAN!`)) return;

    const registeredUser = dbData.users_auth?.find(u => u.fpId == studentId);
    if (registeredUser && !confirm(`⚠️ Siswa ini punya akun (${registeredUser.email}). Hapus juga akunnya?`)) return;

    const btns = document.querySelectorAll(`button[onclick*="deleteStudent"][onclick*="${studentId}"]`);
    btns.forEach(btn => { btn.disabled = true; btn.innerHTML = '⏳'; });

    showToast(`🗑️ Menghapus ${name}...`, "info");

    // Kirim perintah hapus ke ESP32
    try {
        await db.ref('commands/esp32/delete_fingerprint').set({
            studentId: parseInt(studentId),
            studentName: name,
            requestedBy: currentUser.nama || currentUser.email,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        const response = await new Promise(resolve => {
            const timeout = setTimeout(() => resolve(false), 15000);
            const ref = db.ref('commands/esp32/delete_fingerprint_response');
            const listener = ref.on('value', snap => {
                const val = snap.val();
                if (val && val.studentId == studentId && val.status === 'completed') {
                    clearTimeout(timeout);
                    ref.off('value', listener);
                    resolve(true);
                    showToast(`✅ Sidik jari ${name} dihapus dari sensor`, "success");
                } else if (val && val.studentId == studentId && val.status === 'failed') {
                    clearTimeout(timeout);
                    ref.off('value', listener);
                    resolve(false);
                    showToast(`⚠️ Gagal hapus sidik jari: ${val.error}`, "warning");
                }
            });
        });
        if (!response) showToast("⚠️ ESP32 tidak merespon", "warning");
        setTimeout(() => db.ref('commands/esp32/delete_fingerprint').remove().catch(()=>{}), 2000);
    } catch(e) { console.warn(e); }

    if (registeredUser) await db.ref(`users_auth/${registeredUser.uid}`).remove().catch(()=>{});
    await db.ref(`users/${studentId}`).remove();
    showToast(`✅ Siswa "${name}" dihapus`, "success");
    if (typeof renderStudentsTable === 'function') renderStudentsTable();
    btns.forEach(btn => { btn.disabled = false; btn.innerHTML = '🗑️'; });
}

function deleteStudent(id) {
    if (confirm("Hapus siswa ini beserta sidik jari dari semua sensor?")) deleteStudentWithFP(id);
}

// ======================= CRUD =======================

function saveStudent() {
    if (!currentUser || currentUser.role === 'siswa') {
        showToast("⛔ Anda tidak memiliki akses!", "error");
        return;
    }
    let idStr = document.getElementById('newId')?.value.trim();
    const nama = document.getElementById('newNama')?.value.trim();
    const kelas = document.getElementById('newKelas')?.value;
    const jurusan = document.getElementById('newJurusan')?.value;
    const delay = getDelayInMinutes();
    const mode = document.getElementById('editMode')?.value;

    if (!nama || !idStr) { showToast("⚠️ ID dan Nama wajib diisi!", "error"); return; }
    if (!kelas) { showToast("⚠️ Pilih Kelas!", "error"); return; }
    if (!jurusan) { showToast("⚠️ Pilih Jurusan!", "error"); return; }
    if (delay <= 0) { showToast("⚠️ Delay harus > 0!", "error"); return; }
    if (isNaN(parseInt(idStr))) { showToast("⚠️ ID harus angka!", "error"); return; }

    const studentData = {
        id: parseInt(idStr),
        nama: nama,
        kelas: kelas,
        jurusan: jurusan,
        delayOut: delay,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    if (mode === 'add') studentData.createdAt = firebase.database.ServerValue.TIMESTAMP;

    if (mode === 'add' && dbData.users.some(u => u.id == idStr)) {
        showToast("❌ ID sudah ada!", "error");
        return;
    }

    const btn = document.getElementById('btnSaveStudent');
    const originalText = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '💾 Menyimpan...'; }

    db.ref(`users/${idStr}`).set(studentData)
        .then(() => {
            showToast(mode === 'add' ? "✅ Siswa ditambahkan" : "✅ Siswa diupdate");
            resetStudentForm();
            const authUser = dbData.users_auth?.find(u => u.fpId == idStr);
            if (authUser) {
                db.ref(`users_auth/${authUser.uid}`).update({ nama, kelas, jurusan });
                if (currentUser.uid === authUser.uid) {
                    currentUser.nama = nama;
                    currentUser.kelas = kelas;
                    currentUser.jurusan = jurusan;
                    if (typeof saveUserToLocalStorage === 'function') saveUserToLocalStorage(currentUser);
                    if (typeof updateUserInterface === 'function') updateUserInterface();
                }
            }
        })
        .catch(err => showToast("❌ Gagal: " + err.message, "error"))
        .finally(() => {
            if (btn) { btn.disabled = false; btn.innerHTML = originalText || (mode === 'add' ? '➕ Simpan Siswa' : '💾 Update'); }
        });
}

function editStudent(id) {
    const s = dbData.users.find(u => u.id == id);
    if (!s) { showToast("❌ Data tidak ditemukan", "error"); return; }
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
    if (btnSave) { btnSave.innerHTML = '💾 Update Siswa'; btnSave.style.background = 'var(--warning)'; }
    if (btnCancel) btnCancel.classList.remove('hidden');
    showToast(`✏️ Edit mode: ${s.nama}`, "info");
}

function resetStudentForm() {
    if (studentFormResetTimer) clearTimeout(studentFormResetTimer);
    document.getElementById('newId').value = '';
    document.getElementById('newId').disabled = false;
    document.getElementById('newNama').value = '';
    document.getElementById('newKelas').value = '';
    document.getElementById('newJurusan').value = '';
    setDelayFormValue(60);
    document.getElementById('editMode').value = 'add';
    const btnSave = document.getElementById('btnSaveStudent');
    const btnCancel = document.getElementById('btnCancelStudent');
    if (btnSave) { btnSave.innerHTML = '➕ Simpan Siswa'; btnSave.style.background = ''; }
    if (btnCancel) btnCancel.classList.add('hidden');
    studentFormResetTimer = setTimeout(() => document.getElementById('newId')?.focus(), 100);
}

// ======================= BULK OPERATIONS =======================

function importStudentsFromCSV(csvText) {
    const lines = csvText.trim().split('\n');
    let success = 0, fail = 0;
    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 4) {
            const id = parts[0].trim();
            const nama = parts[1].trim();
            const kelas = parts[2].trim();
            const jurusan = parts[3].trim();
            const delay = parts[4] ? parseInt(parts[4].trim()) : 60;
            if (id && nama && kelas && jurusan) {
                db.ref(`users/${id}`).set({
                    id: parseInt(id), nama, kelas, jurusan, delayOut: delay,
                    createdAt: firebase.database.ServerValue.TIMESTAMP
                }).then(() => success++).catch(() => fail++);
            } else fail++;
        } else fail++;
    }
    setTimeout(() => showToast(`✅ Import: ${success} berhasil, ${fail} gagal`, fail ? "warning" : "success"), 1000);
}

function exportStudentsToCSV() {
    if (!dbData.users?.length) { showToast("❌ Tidak ada data", "error"); return; }
    let csv = "\uFEFFID,Nama,Kelas,Jurusan,Delay (menit)\n";
    dbData.users.forEach(s => {
        csv += `"${s.id}","${escapeCsv(s.nama)}","${s.kelas || '-'}","${s.jurusan || '-'}","${s.delayOut || 60}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `data_siswa_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("📥 Data siswa diekspor", "success");
}

function escapeCsv(str) {
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"';
    return str;
}

// ======================= CLEANUP =======================

function cleanupStudentsSystem() {
    if (studentsRealtimeListener) {
        db.ref('users').off('value', studentsRealtimeListener);
        studentsRealtimeListener = null;
    }
    if (studentFormResetTimer) clearTimeout(studentFormResetTimer);
    console.log("🧹 Students system cleaned up");
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

function initDelayEventListeners() {
    const minutes = document.getElementById('delayMinutesValue');
    const hours = document.getElementById('delayHoursValue');
    const unit = document.getElementById('delayUnit');
    if (minutes) minutes.addEventListener('input', updateDelayFromMinutes);
    if (hours) hours.addEventListener('change', updateDelayFromHours);
    if (unit) unit.addEventListener('change', toggleDelayInput);
    setTimeout(() => toggleDelayInput(), 100);
}

// Auto init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => { if (currentUser) initRealtimeStudents(); }, 1500));
} else {
    setTimeout(() => { if (currentUser) initRealtimeStudents(); }, 1500);
}

// Ekspor ke global
window.populateKelasOptions = populateKelasOptions;
window.populateJurusanOptions = populateJurusanOptions;
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