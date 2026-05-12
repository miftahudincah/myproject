// attendance.js - VERSION 2.0
// Mengelola data absensi, filter, validasi delay pulang, dan real-time updates

// ======================== GLOBAL VARIABLES ========================
let lastAttendanceCount = 0;
let attendanceRefreshInterval = null;
let notificationSound = null;

// ======================== INITIALIZATION ========================

/**
 * Inisialisasi fitur real-time absensi
 */
function initRealtimeAttendance() {
    console.log("🔄 Initializing real-time attendance system...");
    
    // Preload notification sound (opsional)
    if (typeof Audio !== 'undefined') {
        notificationSound = new Audio();
        // Gunakan suara beep sederhana via Web Audio API jika diperlukan
    }
    
    // Setup real-time listener untuk absensi baru
    setupRealtimeAttendanceListener();
    
    // Start periodic refresh sebagai fallback
    startAttendancePeriodicRefresh();
}

/**
 * Setup real-time listener untuk perubahan data absensi
 */
function setupRealtimeAttendanceListener() {
    if (typeof db === 'undefined' || !db) {
        console.warn("Firebase not available for attendance listener");
        return;
    }
    
    // Listener untuk data absensi dengan real-time
    db.ref('absensi').on('value', (snapshot) => {
        const data = snapshot.val();
        const newCount = data ? Object.keys(data).reduce((count, date) => {
            return count + (data[date] ? Object.keys(data[date]).length : 0);
        }, 0) : 0;
        
        // Cek apakah ada data baru
        if (lastAttendanceCount > 0 && newCount > lastAttendanceCount) {
            const newRecords = newCount - lastAttendanceCount;
            showRealtimeAttendanceAlert(`📢 ${newRecords} absensi baru masuk!`);
            
            // Update badge di tab
            updateAttendanceTabBadge(true);
        } else if (lastAttendanceCount > 0 && newCount !== lastAttendanceCount) {
            // Data berubah (update atau delete)
            updateAttendanceTabBadge(false);
        }
        
        lastAttendanceCount = newCount;
        
        // Render tabel otomatis (akan dipanggil juga oleh db.js)
        if (typeof renderTable === 'function') {
            requestAnimationFrame(() => renderTable());
        }
    });
    
    // Listener khusus untuk child_added (deteksi absensi baru)
    db.ref('absensi').on('child_added', (snapshot) => {
        const date = snapshot.key;
        console.log(`📋 New attendance record added for date: ${date}`);
        
        // Tampilkan notifikasi toast
        showToast("📢 Ada absensi baru masuk!", "info");
        
        // Flash effect pada tabel absensi
        flashAttendanceTable();
    });
    
    // Listener untuk child_changed (update pulang)
    db.ref('absensi').on('child_changed', (snapshot) => {
        const date = snapshot.key;
        console.log(`📝 Attendance record updated for date: ${date}`);
        showToast("📝 Data absensi diperbarui (pulang)", "info");
    });
}

/**
 * Mulai periodic refresh sebagai fallback (setiap 10 detik)
 */
function startAttendancePeriodicRefresh() {
    if (attendanceRefreshInterval) {
        clearInterval(attendanceRefreshInterval);
    }
    
    attendanceRefreshInterval = setInterval(() => {
        if (currentUser && typeof db !== 'undefined') {
            // Force refresh data absensi
            db.ref('absensi').once('value').then(() => {
                console.log("🔄 Attendance periodic refresh completed");
            }).catch(err => console.warn("Periodic refresh error:", err));
        }
    }, 10000); // Refresh setiap 10 detik
}

/**
 * Hentikan periodic refresh
 */
function stopAttendancePeriodicRefresh() {
    if (attendanceRefreshInterval) {
        clearInterval(attendanceRefreshInterval);
        attendanceRefreshInterval = null;
    }
}

// ======================== UI NOTIFICATIONS ========================

/**
 * Tampilkan alert realtime untuk absensi baru
 */
function showRealtimeAttendanceAlert(message) {
    // Tampilkan toast
    showToast(message, "success");
    
    // Update title dengan notifikasi
    const originalTitle = document.title;
    let dotCount = 0;
    const interval = setInterval(() => {
        if (dotCount >= 3) {
            document.title = originalTitle;
            clearInterval(interval);
        } else {
            document.title = `🔔 ${message.substring(0, 20)}...`;
            dotCount++;
        }
    }, 500);
    
    setTimeout(() => {
        document.title = originalTitle;
        clearInterval(interval);
    }, 3000);
}

/**
 * Update badge pada tab absensi
 */
function updateAttendanceTabBadge(hasNew = true) {
    const attendanceTabBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => 
        b.textContent.includes('Data Absensi') || b.getAttribute('onclick')?.includes('attendance')
    );
    
    if (attendanceTabBtn) {
        if (hasNew) {
            if (!attendanceTabBtn.querySelector('.badge-new')) {
                const badge = document.createElement('span');
                badge.className = 'badge-new';
                badge.textContent = '●';
                badge.style.cssText = 'color: #f44336; margin-left: 5px; font-size: 10px; animation: pulse 1s infinite;';
                attendanceTabBtn.appendChild(badge);
            }
        } else {
            const badge = attendanceTabBtn.querySelector('.badge-new');
            if (badge) badge.remove();
        }
    }
}

/**
 * Efek flash pada tabel absensi
 */
function flashAttendanceTable() {
    const table = document.querySelector('#tab-attendance .table-container');
    if (table) {
        table.style.transition = 'background-color 0.3s';
        table.style.backgroundColor = 'rgba(74, 144, 226, 0.2)';
        setTimeout(() => {
            table.style.backgroundColor = '';
        }, 500);
    }
}

// ======================== RENDER TABLE ========================

function renderTable() {
    console.log("📊 renderTable dipanggil - Total attendance:", dbData.attendance?.length || 0);
    
    const tbody = document.getElementById('tbody-attendance');
    if (!tbody) {
        console.warn("tbody-attendance not found");
        return;
    }
    
    const fDate = document.getElementById('filterDate') ? document.getElementById('filterDate').value : 'all';
    const fKelas = document.getElementById('filterKelas') ? document.getElementById('filterKelas').value : 'all';
    const fJurusan = document.getElementById('filterJurusan') ? document.getElementById('filterJurusan').value : 'all';

    let data = dbData.attendance ? [...dbData.attendance] : [];
    
    // Filter berdasarkan role user
    if (currentUser && currentUser.role === 'siswa') {
        if (currentUser.kelas && currentUser.jurusan) {
            data = data.filter(r => 
                r.kelas === currentUser.kelas && 
                r.jurusan === currentUser.jurusan
            );
        } else {
            data = []; 
        }
        
        if (fDate === 'today') {
            const todayStr = new Date().toISOString().split('T')[0];
            data = data.filter(r => r.date === todayStr);
        }
    } else {
        // Admin atau Guru
        if (fDate === 'today') {
            const todayStr = new Date().toISOString().split('T')[0];
            data = data.filter(r => r.date === todayStr);
        } else if (fDate !== 'all') {
            // Filter berdasarkan rentang tanggal jika diperlukan
            data = data.filter(r => r.date === fDate);
        }
        
        if (fKelas !== 'all') {
            data = data.filter(r => r.kelas === fKelas);
        }
        if (fJurusan !== 'all') {
            data = data.filter(r => r.jurusan === fJurusan);
        }
    }

    // Sort by date descending (terbaru di atas)
    data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    tbody.innerHTML = '';
    
    if (data.length === 0) { 
        tbody.innerHTML = `<td><td colspan="7" style="text-align:center; padding:20px; color:#888;">
            📭 Data absensi tidak ditemukan.
            ${currentUser?.role === 'siswa' ? '<br><small>Hubungi guru untuk informasi lebih lanjut.</small>' : ''}
        </td></tr>`; 
        return; 
    }
    
    data.forEach((row, index) => {
        const timeDisplay = row.timeIn || '-';
        const outDisplay = row.timeOut ? `<br><span class="text-small" style="color:var(--danger)">🏠 Pulang: ${row.timeOut}</span>` : '';
        const statusColor = row.status === 'Pulang' ? 'var(--danger)' : 'var(--success)';
        const statusIcon = row.status === 'Pulang' ? '🏠' : '✅';
        const isNew = index < 3 && (Date.now() - new Date(row.timestamp).getTime() < 60000); // Baru dalam 1 menit
        
        tbody.innerHTML += `
            <tr class="${isNew ? 'attendance-new-row' : ''}">
                <td>
                    ⏰ ${timeDisplay}<br>
                    <span class="text-small">📅 ${row.date}</span>
                    ${outDisplay}
                </td>
                <td><strong>#${row.studentId}</strong></td>
                <td>${escapeHtml(row.nama)}</td>
                <td>${row.kelas || '-'}</td>
                <td>${row.jurusan || '-'}</td>
                <td>
                    <span style="color:${statusColor}; font-weight:500;">
                        ${statusIcon} ${row.status}
                    </span>
                </td>
                <td class="role-guru role-admin">
                    <button class="btn-icon delete" onclick="deleteAttendance('${row.id}')" title="Hapus Data">🗑️</button>
                </td>
            </tr>
        `;
    });
    
    // Update statistik
    updateAttendanceStatistics(data);
}

/**
 * Update statistik absensi di UI
 */
function updateAttendanceStatistics(data) {
    const statsContainer = document.getElementById('attendanceStats');
    if (!statsContainer) {
        // Buat stats container jika belum ada
        createStatsContainer();
        return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const todayData = data.filter(r => r.date === today);
    const hadirToday = todayData.filter(r => r.status === 'Hadir').length;
    const pulangToday = todayData.filter(r => r.status === 'Pulang').length;
    const totalUnique = [...new Set(data.map(r => r.studentId))].length;
    
    statsContainer.innerHTML = `
        <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 15px; padding: 10px; background: #1e1e1e; border-radius: 8px;">
            <div><span style="color: #4a90e2;">📅 Hari Ini:</span> <strong>${hadirToday}</strong> Hadir, <strong>${pulangToday}</strong> Pulang</div>
            <div><span style="color: #4a90e2;">👥 Total Hari Ini:</span> <strong>${todayData.length}</strong> Transaksi</div>
            <div><span style="color: #4a90e2;">📊 Total Unik:</span> <strong>${totalUnique}</strong> Siswa</div>
        </div>
    `;
}

function createStatsContainer() {
    const controlsBar = document.querySelector('#tab-attendance .controls-bar');
    if (controlsBar && !document.getElementById('attendanceStats')) {
        const statsDiv = document.createElement('div');
        statsDiv.id = 'attendanceStats';
        statsDiv.style.marginBottom = '10px';
        controlsBar.insertAdjacentElement('afterend', statsDiv);
    }
}

// ======================== DELETE ATTENDANCE ========================

function deleteAttendance(id) {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    if (currentUser.role === 'siswa') {
        showToast("⛔ Akses Ditolak: Siswa tidak diizinkan menghapus data!", "error");
        return;
    }

    if (!confirm("⚠️ Apakah Anda yakin ingin menghapus data absensi ini?\n\nTindakan ini tidak dapat dibatalkan!")) return;
    
    // Parse ID yang formatnya "date-id"
    const lastDashIndex = id.lastIndexOf('-');
    const date = id.substring(0, lastDashIndex);
    const fpId = id.substring(lastDashIndex + 1);
    
    console.log("🗑️ Menghapus absensi - Date:", date, "FP ID:", fpId);
    
    // Nonaktifkan tombol hapus sementara
    const btns = document.querySelectorAll(`button[onclick="deleteAttendance('${id}')"]`);
    btns.forEach(btn => {
        btn.disabled = true;
        btn.textContent = '⏳';
    });
    
    const deleteRef = db.ref(`absensi/${date}/${fpId}`);
    
    deleteRef.remove()
        .then(() => {
            showToast("✅ Data absensi berhasil dihapus", "success");
            // Data akan otomatis refresh karena listener db.js
        })
        .catch((error) => {
            console.error("Error menghapus:", error);
            showToast("❌ Gagal menghapus: " + error.message, "error");
        })
        .finally(() => {
            btns.forEach(btn => {
                btn.disabled = false;
                btn.textContent = '🗑️';
            });
        });
}

// ======================== SIMULATE ATTENDANCE ========================

function simulateAttendance() {
    if (!currentUser) {
        showToast("Anda harus login!", "error");
        return;
    }
    
    // Cek role untuk simulasi
    if (currentUser.role === 'siswa') {
        showToast("⛔ Simulasi hanya untuk Admin/Guru!", "error");
        return;
    }
    
    const students = dbData.users;
    if (!students || students.length === 0) {
        showToast("❌ Belum ada siswa di Database!", "error");
        return;
    }
    
    // Filter siswa yang valid
    const validStudents = students.filter(s => s.nama && s.id);
    if (validStudents.length === 0) {
        showToast("❌ Tidak ada data siswa yang valid!", "error");
        return;
    }
    
    const s = validStudents[Math.floor(Math.random() * validStudents.length)];
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'});
    const dateStr = now.toISOString().split('T')[0];
    
    // Cek apakah sudah absen masuk hari ini
    const existingAttendance = dbData.attendance.find(a => 
        a.studentId == s.id && a.date === dateStr && a.status === 'Hadir'
    );
    
    if (existingAttendance) {
        showToast(`⚠️ ${s.nama} sudah absen masuk hari ini!`, "warning");
        return;
    }
    
    // Tampilkan loading
    const btn = document.querySelector('button[onclick="simulateAttendance()"]');
    const originalText = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Memproses...';
    }
    
    const attendanceData = {
        id: parseInt(s.id),
        nama: s.nama, 
        kelas: s.kelas, 
        jurusan: s.jurusan, 
        in: timeStr,
        out: null,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    
    db.ref(`absensi/${dateStr}/${s.id}`).set(attendanceData)
        .then(() => {
            showToast(`✅ Simulasi Absen Masuk Berhasil: ${s.nama} (${timeStr})`, "success");
            // Refresh otomatis oleh listener
        })
        .catch((err) => {
            console.error("Simulasi error:", err);
            showToast("❌ Gagal simulasi: " + err.message, "error");
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText || '📷 Simulasi Scan FP';
            }
        });
}

// ======================== EXPORT FUNCTIONS ========================

function exportToExcel() {
    if (!dbData.attendance || dbData.attendance.length === 0) {
        showToast("❌ Tidak ada data absensi untuk diekspor!", "error");
        return;
    }
    
    showToast("📊 Memproses ekspor data...", "info");
    
    // Header CSV
    let csv = "\uFEFFTanggal,Waktu Masuk,Waktu Pulang,ID,Nama,Kelas,Jurusan,Status\n";
    
    dbData.attendance.forEach(r => {
        const timeIn = r.timeIn || '-';
        const timeOut = r.timeOut || '-';
        const tanggal = r.date || '-';
        csv += `"${tanggal}","${timeIn}","${timeOut}","${r.studentId}","${escapeCsv(r.nama)}","${r.kelas || '-'}","${r.jurusan || '-'}","${r.status}"\n`;
    });
    
    // Buat blob dan download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `laporan_absensi_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showToast("📥 Laporan Excel berhasil diunduh", "success");
}

/**
 * Escape string untuk CSV
 */
function escapeCsv(str) {
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// ======================== FILTER FUNCTIONS ========================

/**
 * Reset semua filter
 */
function resetAttendanceFilters() {
    const filterDate = document.getElementById('filterDate');
    const filterKelas = document.getElementById('filterKelas');
    const filterJurusan = document.getElementById('filterJurusan');
    
    if (filterDate) filterDate.value = 'all';
    if (filterKelas) filterKelas.value = 'all';
    if (filterJurusan) filterJurusan.value = 'all';
    
    renderTable();
    showToast("🔄 Filter telah direset", "info");
}

/**
 * Filter berdasarkan rentang tanggal
 */
function filterByDateRange(startDate, endDate) {
    if (!startDate || !endDate) return;
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59);
    
    const filtered = dbData.attendance.filter(r => {
        const recordDate = new Date(r.date);
        return recordDate >= start && recordDate <= end;
    });
    
    renderFilteredTable(filtered);
}

function renderFilteredTable(filteredData) {
    const tbody = document.getElementById('tbody-attendance');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#888;">📭 Tidak ada data dalam rentang tanggal tersebut.</td></tr>`;
        return;
    }
    
    filteredData.forEach(row => {
        const timeDisplay = row.timeIn || '-';
        const outDisplay = row.timeOut ? `<br><span class="text-small" style="color:var(--danger)">🏠 Pulang: ${row.timeOut}</span>` : '';
        
        tbody.innerHTML += `
            <tr>
                <td>⏰ ${timeDisplay}<br><span class="text-small">📅 ${row.date}</span>${outDisplay}</td>
                <td><strong>#${row.studentId}</strong></td>
                <td>${escapeHtml(row.nama)}</td>
                <td>${row.kelas || '-'}</td>
                <td>${row.jurusan || '-'}</td>
                <td><span style="color:${row.status === 'Pulang' ? 'var(--danger)' : 'var(--success)'}">${row.status === 'Pulang' ? '🏠' : '✅'} ${row.status}</span></td>
                <td class="role-guru role-admin"><button class="btn-icon delete" onclick="deleteAttendance('${row.id}')" title="Hapus Data">🗑️</button></td>
            </tr>
        `;
    });
}

// ======================== UTILITY ========================

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

/**
 * Get statistik absensi hari ini
 */
function getTodayAttendanceStats() {
    const today = new Date().toISOString().split('T')[0];
    const todayData = dbData.attendance.filter(r => r.date === today);
    
    return {
        hadir: todayData.filter(r => r.status === 'Hadir').length,
        pulang: todayData.filter(r => r.status === 'Pulang').length,
        total: todayData.length,
        uniqueStudents: [...new Set(todayData.map(r => r.studentId))].length
    };
}

/**
 * Cleanup attendance listeners
 */
function cleanupAttendanceListeners() {
    stopAttendancePeriodicRefresh();
    if (typeof db !== 'undefined' && db) {
        db.ref('absensi').off();
    }
    console.log("🧹 Attendance listeners cleaned up");
}

// ======================== AUTO INIT ========================

// Inisialisasi otomatis saat DOM siap
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (currentUser) {
                initRealtimeAttendance();
            }
        }, 1000);
    });
} else {
    setTimeout(() => {
        if (currentUser) {
            initRealtimeAttendance();
        }
    }, 1000);
}

// Export ke global scope
window.renderTable = renderTable;
window.deleteAttendance = deleteAttendance;
window.simulateAttendance = simulateAttendance;
window.exportToExcel = exportToExcel;
window.resetAttendanceFilters = resetAttendanceFilters;
window.filterByDateRange = filterByDateRange;
window.getTodayAttendanceStats = getTodayAttendanceStats;
window.cleanupAttendanceListeners = cleanupAttendanceListeners;
window.initRealtimeAttendance = initRealtimeAttendance;