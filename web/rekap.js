// rekap.js - VERSION 1.1
// Fitur Rekap Absensi per Siswa
// Mendukung periode: Minggu, Bulan, Semester, dan Custom Range
// Mendukung status: Hadir, Sakit, Izin, Alpha
// By: Sistem Absensi Terintegrasi

let currentRekapData = [];
let rekapInitDone = false;

// ======================= INISIALISASI =======================

function initRekap() {
    if (rekapInitDone) return;
    console.log("📊 Initializing rekap system...");
    
    // Cek apakah elemen rekap sudah ada di DOM
    const periodSelect = document.getElementById('rekapPeriod');
    if (!periodSelect) {
        console.log("⏳ Menunggu DOM ready untuk rekap...");
        setTimeout(initRekap, 500);
        return;
    }
    
    // Event listener untuk period select
    periodSelect.addEventListener('change', function() {
        const customGroup = document.getElementById('customRangeGroup');
        if (customGroup) {
            customGroup.style.display = this.value === 'custom' ? 'flex' : 'none';
        }
        loadRekap();
    });
    
    // Event listener untuk custom date inputs
    const startInput = document.getElementById('rekapStartDate');
    const endInput = document.getElementById('rekapEndDate');
    if (startInput) {
        startInput.addEventListener('change', function() {
            if (periodSelect.value === 'custom') loadRekap();
        });
    }
    if (endInput) {
        endInput.addEventListener('change', function() {
            if (periodSelect.value === 'custom') loadRekap();
        });
    }
    
    // Set default date untuk custom range (30 hari terakhir)
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - 30);
    
    if (startInput && !startInput.value) startInput.value = formatDateForInput(startDate);
    if (endInput && !endInput.value) endInput.value = formatDateForInput(today);
    
    // Set default periode
    const defaultPeriod = localStorage.getItem('rekapLastPeriod') || 'minggu';
    if (periodSelect) periodSelect.value = defaultPeriod;
    
    // Sembunyikan custom range jika bukan custom
    const customRangeGroup = document.getElementById('customRangeGroup');
    if (customRangeGroup) {
        customRangeGroup.style.display = defaultPeriod === 'custom' ? 'flex' : 'none';
    }
    
    rekapInitDone = true;
    
    // Load data awal dengan sedikit delay
    setTimeout(() => {
        loadRekap();
    }, 500);
}

function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
}

// ======================= PERIODE HELPER =======================

function getDateRange(period, startDate = null, endDate = null) {
    const now = new Date();
    let start = new Date();
    let end = new Date();
    
    switch(period) {
        case 'minggu':
            // Minggu ini (Senin - Minggu)
            const day = now.getDay();
            const diffToMonday = (day === 0 ? 6 : day - 1);
            start.setDate(now.getDate() - diffToMonday);
            start.setHours(0, 0, 0, 0);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            break;
            
        case 'bulan':
            // Bulan ini
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            end.setHours(23, 59, 59, 999);
            break;
            
        case 'semester':
            // Semester: Jan-Jun atau Jul-Des
            const semester = now.getMonth() < 6 ? 1 : 2;
            if (semester === 1) {
                start = new Date(now.getFullYear(), 0, 1);
                end = new Date(now.getFullYear(), 5, 30);
            } else {
                start = new Date(now.getFullYear(), 6, 1);
                end = new Date(now.getFullYear(), 11, 31);
            }
            end.setHours(23, 59, 59, 999);
            break;
            
        case 'custom':
            if (startDate && endDate) {
                start = new Date(startDate);
                end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
            }
            break;
            
        default:
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date();
    }
    
    return { start, end };
}

function formatDateRangeDisplay(start, end) {
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    return `${start.toLocaleDateString('id-ID', options)} - ${end.toLocaleDateString('id-ID', options)}`;
}

// ======================= HITUNG TOTAL HARI SEKOLAH =======================

function countSchoolDays(startDate, endDate) {
    let count = 0;
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        // Senin=1, Selasa=2, Rabu=3, Kamis=4, Jumat=5 (hari sekolah)
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            count++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return count > 0 ? count : 1; // Minimal 1 untuk menghindari division by zero
}

// ======================= HITUNG REKAP PER SISWA =======================

function calculateStudentRekap(attendanceData, studentsData, startDate, endDate) {
    const studentMap = new Map();
    
    // Filter absensi berdasarkan tanggal
    const filteredAttendance = attendanceData.filter(a => {
        const recordDate = new Date(a.date);
        return recordDate >= startDate && recordDate <= endDate;
    });
    
    // Hitung total hari sekolah dalam rentang
    const totalSchoolDays = countSchoolDays(startDate, endDate);
    
    console.log(`📊 Periode: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`);
    console.log(`📊 Total hari sekolah: ${totalSchoolDays}`);
    console.log(`📊 Total data absensi: ${filteredAttendance.length}`);
    
    // Inisialisasi data per siswa (dari data siswa yang ada)
    studentsData.forEach(student => {
        if (student && student.id) {
            studentMap.set(student.id.toString(), {
                id: student.id,
                nama: student.nama || 'Tidak Diketahui',
                kelas: student.kelas || '-',
                jurusan: student.jurusan || '-',
                hadir: 0,
                sakit: 0,
                izin: 0,
                alpha: 0,
                totalDays: totalSchoolDays
            });
        }
    });
    
    // Proses absensi - hitung status kehadiran dengan dukungan multi status
    filteredAttendance.forEach(record => {
        const studentId = record.studentId.toString();
        const studentData = studentMap.get(studentId);
        
        if (studentData) {
            // Ambil status dari record (bisa dari properti status atau infer dari data)
            let status = record.status || '';
            
            // Jika tidak ada status explicit, cek berdasarkan ada tidaknya timeOut
            if (!status) {
                status = record.timeOut ? 'Pulang' : 'Hadir';
            }
            
            // Normalisasi status
            if (status === 'Hadir' || status === 'Pulang') {
                studentData.hadir++;
            } else if (status === 'Sakit') {
                studentData.sakit++;
                // Sakit tetap dihitung sebagai hadir untuk persentase? 
                // Jika ya, uncomment baris di bawah
                // studentData.hadir++;
            } else if (status === 'Izin') {
                studentData.izin++;
                // Izin juga bisa dianggap hadir jika kebijakan sekolah mengizinkan
                // studentData.hadir++;
            } else if (status === 'Alpha') {
                studentData.alpha++;
                // Alpha tidak dihitung sebagai hadir
            } else {
                // Default unknown: anggap hadir
                studentData.hadir++;
            }
        }
    });
    
    // Hitung persentase dan status (hanya berdasarkan hadir)
    const results = [];
    for (const [id, data] of studentMap) {
        // Persentase hanya berdasarkan kehadiran (hadir)
        const totalKehadiran = data.hadir;
        const percentage = (totalKehadiran / data.totalDays) * 100;
        
        let status = '';
        let statusClass = '';
        
        if (percentage >= 90) {
            status = 'Sangat Baik';
            statusClass = 'rekap-status-sangat-baik';
        } else if (percentage >= 75) {
            status = 'Baik';
            statusClass = 'rekap-status-baik';
        } else if (percentage >= 60) {
            status = 'Cukup';
            statusClass = 'rekap-status-cukup';
        } else if (percentage >= 40) {
            status = 'Kurang';
            statusClass = 'rekap-status-kurang';
        } else {
            status = 'Buruk';
            statusClass = 'rekap-status-buruk';
        }
        
        results.push({
            ...data,
            percentage: percentage.toFixed(1),
            status,
            statusClass
        });
    }
    
    // Urutkan berdasarkan persentase tertinggi
    results.sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage));
    
    return results;
}

// ======================= RENDER REKAP TABLE =======================

function renderRekapTable(data) {
    const tbody = document.getElementById('rekapTbody');
    if (!tbody) return;
    
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:40px;">
            📭 Tidak ada data siswa dalam periode yang dipilih.
        </td></tr>`;
        return;
    }
    
    // Filter data yang memiliki nama (valid)
    const validData = data.filter(item => item.nama && item.nama !== 'Tidak Diketahui');
    
    if (validData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:40px;">
            📭 Tidak ada data absensi dalam periode yang dipilih.
        </td></tr>`;
        return;
    }
    
    tbody.innerHTML = '';
    
    validData.forEach((item, index) => {
        let persenColor = '#4caf50';
        if (item.percentage < 75) persenColor = '#ffc107';
        if (item.percentage < 60) persenColor = '#ff9800';
        if (item.percentage < 40) persenColor = '#f44336';
        
        // Tooltip detail
        const tooltip = `${item.hadir} hadir dari ${item.totalDays} hari sekolah`;
        
        tbody.innerHTML += `
            <tr>
                <td>${index + 1}</td>
                <td><strong>#${item.id}</strong></td>
                <td>${escapeHtml(item.nama)}</td>
                <td>${item.kelas}</td>
                <td>${item.jurusan}</td>
                <td style="text-align:center;">${item.totalDays}</td>
                <td style="color:#4caf50; font-weight:bold; text-align:center;">${item.hadir}</td>
                <td style="color:#ff9800; text-align:center;">${item.sakit}</td>
                <td style="color:#2196f3; text-align:center;">${item.izin}</td>
                <td style="color:#f44336; text-align:center;">${item.alpha}</td>
                <td style="text-align:center;">
                    <span class="rekap-percentage" style="color:${persenColor}; font-weight:bold; cursor:help;" title="${tooltip}">
                        ${item.percentage}%
                    </span>
                </td>
                <td style="text-align:center;">
                    <span class="rekap-badge ${item.statusClass}">${item.status}</span>
                </td>
            </tr>
        `;
    });
    
    // Update info periode di title (opsional)
    const periodSelect = document.getElementById('rekapPeriod');
    if (periodSelect) {
        const periodText = periodSelect.options[periodSelect.selectedIndex]?.text || '';
        console.log(`📊 Rekap ditampilkan: ${periodText}, Total: ${validData.length} siswa`);
    }
    
    // Update ringkasan statistik
    updateRekapSummary(validData);
}

/**
 * Update ringkasan statistik di UI
 */
function updateRekapSummary(data) {
    const summaryContainer = document.getElementById('rekapSummary');
    if (!summaryContainer) {
        createRekapSummaryContainer();
        return;
    }
    
    const totalSiswa = data.length;
    const totalHadir = data.reduce((sum, s) => sum + s.hadir, 0);
    const totalSakit = data.reduce((sum, s) => sum + s.sakit, 0);
    const totalIzin = data.reduce((sum, s) => sum + s.izin, 0);
    const totalAlpha = data.reduce((sum, s) => sum + s.alpha, 0);
    const rataRata = data.reduce((sum, s) => sum + parseFloat(s.percentage), 0) / totalSiswa || 0;
    
    const sangatBaik = data.filter(s => s.status === 'Sangat Baik').length;
    const baik = data.filter(s => s.status === 'Baik').length;
    const cukup = data.filter(s => s.status === 'Cukup').length;
    const kurang = data.filter(s => s.status === 'Kurang').length;
    const buruk = data.filter(s => s.status === 'Buruk').length;
    
    summaryContainer.innerHTML = `
        <div style="display: flex; gap: 20px; flex-wrap: wrap; justify-content: space-between;">
            <div style="display: flex; gap: 30px; flex-wrap: wrap;">
                <div><span style="color: #4a90e2;">👥 Total Siswa:</span> <strong>${totalSiswa}</strong></div>
                <div><span style="color: #4caf50;">✅ Total Hadir:</span> <strong>${totalHadir}</strong></div>
                <div><span style="color: #ff9800;">🤒 Total Sakit:</span> <strong>${totalSakit}</strong></div>
                <div><span style="color: #2196f3;">📝 Total Izin:</span> <strong>${totalIzin}</strong></div>
                <div><span style="color: #f44336;">❌ Total Alpha:</span> <strong>${totalAlpha}</strong></div>
                <div><span style="color: #4a90e2;">📊 Rata-rata:</span> <strong>${rataRata.toFixed(1)}%</strong></div>
            </div>
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                <span class="badge" style="background:#4caf50;">🏆 Sangat Baik: ${sangatBaik}</span>
                <span class="badge" style="background:#8bc34a; color:#333;">👍 Baik: ${baik}</span>
                <span class="badge" style="background:#ffc107; color:#333;">📊 Cukup: ${cukup}</span>
                <span class="badge" style="background:#ff9800;">⚠️ Kurang: ${kurang}</span>
                <span class="badge" style="background:#f44336;">❗ Buruk: ${buruk}</span>
            </div>
        </div>
    `;
}

function createRekapSummaryContainer() {
    const container = document.querySelector('#tab-rekap .table-container');
    if (container && !document.getElementById('rekapSummary')) {
        const summaryDiv = document.createElement('div');
        summaryDiv.id = 'rekapSummary';
        summaryDiv.style.marginBottom = '15px';
        summaryDiv.style.padding = '10px';
        summaryDiv.style.background = '#1e1e1e';
        summaryDiv.style.borderRadius = '8px';
        container.insertAdjacentElement('beforebegin', summaryDiv);
    }
}

// ======================= LOAD REKAP =======================

function loadRekap() {
    // Tunggu data absensi dan siswa tersedia
    if (!dbData || !dbData.attendance || !dbData.users) {
        console.log("⏳ Menunggu data siap...");
        setTimeout(loadRekap, 500);
        return;
    }
    
    const periodSelect = document.getElementById('rekapPeriod');
    if (!periodSelect) {
        console.log("⏳ Menunggu elemen rekap...");
        setTimeout(loadRekap, 500);
        return;
    }
    
    const period = periodSelect.value;
    let startDate, endDate;
    
    if (period === 'custom') {
        const startInput = document.getElementById('rekapStartDate').value;
        const endInput = document.getElementById('rekapEndDate').value;
        
        if (!startInput || !endInput) {
            if (typeof showToast === 'function') {
                showToast("⚠️ Pilih tanggal mulai dan akhir!", "error");
            }
            return;
        }
        
        startDate = new Date(startInput);
        endDate = new Date(endInput);
        endDate.setHours(23, 59, 59, 999);
    } else {
        const range = getDateRange(period);
        startDate = range.start;
        endDate = range.end;
    }
    
    // Validasi tanggal
    if (startDate > endDate) {
        if (typeof showToast === 'function') {
            showToast("⚠️ Tanggal mulai harus lebih kecil dari tanggal akhir!", "error");
        }
        return;
    }
    
    // Simpan periode terakhir
    localStorage.setItem('rekapLastPeriod', period);
    
    const periodDisplay = formatDateRangeDisplay(startDate, endDate);
    console.log(`📊 Load rekap: ${period} (${periodDisplay})`);
    if (typeof showToast === 'function') {
        showToast(`📊 Memuat rekap periode: ${periodDisplay}`, "info");
    }
    
    // Hitung rekap
    currentRekapData = calculateStudentRekap(dbData.attendance, dbData.users, startDate, endDate);
    
    // Render tabel
    renderRekapTable(currentRekapData);
    
    // Tampilkan ringkasan
    const totalSiswa = currentRekapData.filter(s => s.nama && s.nama !== 'Tidak Diketahui').length;
    const rataRata = currentRekapData.reduce((sum, s) => sum + parseFloat(s.percentage), 0) / totalSiswa || 0;
    
    console.log(`📊 Rekap selesai: ${totalSiswa} siswa, rata-rata kehadiran: ${rataRata.toFixed(1)}%`);
}

// ======================= EXPORT FUNCTIONS =======================

function exportRekapToExcel() {
    if (!currentRekapData || currentRekapData.length === 0) {
        if (typeof showToast === 'function') showToast("❌ Tidak ada data untuk diekspor!", "error");
        return;
    }
    
    const periodSelect = document.getElementById('rekapPeriod');
    const periodText = periodSelect ? periodSelect.options[periodSelect.selectedIndex]?.text : 'Rekap';
    const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
    const dateNow = new Date().toLocaleDateString('id-ID');
    
    let csv = "\uFEFF";
    csv += `"LAPORAN REKAP ABSENSI SISWA"\n`;
    csv += `"${schoolName}"\n`;
    csv += `"Periode: ${periodText}"\n`;
    csv += `"Tanggal cetak: ${dateNow}"\n`;
    csv += `\n`;
    csv += `No,ID FP,Nama Siswa,Kelas,Jurusan,Total Hari,Hadir,Sakit,Izin,Alpha,Persentase,Status\n`;
    
    let no = 1;
    currentRekapData.forEach(item => {
        if (item.nama && item.nama !== 'Tidak Diketahui') {
            csv += `${no},${item.id},"${item.nama}",${item.kelas},${item.jurusan},${item.totalDays},${item.hadir},${item.sakit},${item.izin},${item.alpha},${item.percentage}%,${item.status}\n`;
            no++;
        }
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `rekap_absensi_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    if (typeof showToast === 'function') showToast("📥 Rekap berhasil diekspor ke Excel!", "success");
}

function exportRekapToPDF() {
    if (!currentRekapData || currentRekapData.length === 0) {
        if (typeof showToast === 'function') showToast("❌ Tidak ada data untuk diekspor!", "error");
        return;
    }
    
    const periodSelect = document.getElementById('rekapPeriod');
    const periodText = periodSelect ? periodSelect.options[periodSelect.selectedIndex]?.text : 'Rekap';
    const schoolName = document.getElementById('schoolNameDisplay')?.innerText || 'Sistem Absensi';
    const dateNow = new Date().toLocaleDateString('id-ID');
    const timeNow = new Date().toLocaleTimeString('id-ID');
    
    // Filter data valid
    const validData = currentRekapData.filter(item => item.nama && item.nama !== 'Tidak Diketahui');
    
    // Buat window baru untuk print
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Rekap Absensi - ${schoolName}</title>
            <meta charset="UTF-8">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: 'Segoe UI', Arial, sans-serif;
                    padding: 20px;
                    margin: 0;
                    background: white;
                }
                .header {
                    text-align: center;
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 2px solid #00bcd4;
                }
                .header h1 {
                    color: #00bcd4;
                    margin-bottom: 5px;
                }
                .header h3 {
                    color: #555;
                    margin-top: 5px;
                    font-weight: normal;
                }
                .info {
                    margin-bottom: 20px;
                    padding: 10px;
                    background: #f5f5f5;
                    border-radius: 8px;
                    font-size: 12px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 10px;
                    font-size: 11px;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px 6px;
                    text-align: center;
                }
                th {
                    background-color: #00bcd4;
                    color: white;
                    font-weight: bold;
                }
                td {
                    text-align: center;
                }
                .text-left {
                    text-align: left;
                }
                .footer {
                    text-align: center;
                    margin-top: 20px;
                    padding-top: 10px;
                    font-size: 10px;
                    color: #888;
                    border-top: 1px solid #ddd;
                }
                .badge-sangat-baik { background: #4caf50; color: white; padding: 2px 8px; border-radius: 12px; display: inline-block; }
                .badge-baik { background: #8bc34a; color: #333; padding: 2px 8px; border-radius: 12px; display: inline-block; }
                .badge-cukup { background: #ffc107; color: #333; padding: 2px 8px; border-radius: 12px; display: inline-block; }
                .badge-kurang { background: #ff9800; color: white; padding: 2px 8px; border-radius: 12px; display: inline-block; }
                .badge-buruk { background: #f44336; color: white; padding: 2px 8px; border-radius: 12px; display: inline-block; }
                @media print {
                    body { padding: 0; margin: 0; }
                    .no-print { display: none; }
                    button { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${escapeHtml(schoolName)}</h1>
                <h3>LAPORAN REKAP ABSENSI SISWA</h3>
                <p>Periode: ${escapeHtml(periodText)}</p>
            </div>
            
            <div class="info">
                <strong>📅 Tanggal Cetak:</strong> ${dateNow} | ${timeNow}<br>
                <strong>👥 Total Siswa:</strong> ${validData.length} orang<br>
                <strong>📊 Rata-rata Kehadiran:</strong> ${(validData.reduce((sum, s) => sum + parseFloat(s.percentage), 0) / validData.length || 0).toFixed(1)}%
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>No</th>
                        <th>ID FP</th>
                        <th>Nama Siswa</th>
                        <th>Kelas</th>
                        <th>Jurusan</th>
                        <th>Total Hari</th>
                        <th>Hadir</th>
                        <th>Sakit</th>
                        <th>Izin</th>
                        <th>Alpha</th>
                        <th>Persentase</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
    `);
    
    let no = 1;
    validData.forEach(item => {
        let badgeClass = '';
        if (item.status === 'Sangat Baik') badgeClass = 'badge-sangat-baik';
        else if (item.status === 'Baik') badgeClass = 'badge-baik';
        else if (item.status === 'Cukup') badgeClass = 'badge-cukup';
        else if (item.status === 'Kurang') badgeClass = 'badge-kurang';
        else badgeClass = 'badge-buruk';
        
        printWindow.document.write(`
            <tr>
                <td>${no}</td>
                <td>${item.id}</td>
                <td class="text-left">${escapeHtml(item.nama)}</td>
                <td>${item.kelas}</td>
                <td>${item.jurusan}</td>
                <td>${item.totalDays}</td>
                <td>${item.hadir}</td>
                <td>${item.sakit}</td>
                <td>${item.izin}</td>
                <td>${item.alpha}</td>
                <td>${item.percentage}%</td>
                <td><span class="${badgeClass}">${item.status}</span></td>
            </tr>
        `);
        no++;
    });
    
    printWindow.document.write(`
                </tbody>
            </table>
            
            <div class="footer">
                <p>Dicetak oleh: ${escapeHtml(currentUser?.nama || 'Admin')} | Sistem Absensi Terintegrasi - ESP32 Fingerprint</p>
                <p>* Laporan ini dihasilkan secara otomatis oleh sistem</p>
            </div>
            
            <div class="no-print" style="text-align:center; margin-top:20px;">
                <button onclick="window.print()" style="padding:10px 20px; background:#00bcd4; color:white; border:none; border-radius:5px; cursor:pointer;">🖨️ Cetak / Simpan PDF</button>
                <button onclick="window.close()" style="padding:10px 20px; background:#666; color:white; border:none; border-radius:5px; cursor:pointer; margin-left:10px;">✖ Tutup</button>
            </div>
            
            <script>
                console.log("PDF siap dicetak");
            <\/script>
        </body>
        </html>
    `);
    
    printWindow.document.close();
    if (typeof showToast === 'function') showToast("📄 Membuka halaman print...", "info");
}

// ======================= UTILITY =======================

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ======================= CLEANUP =======================

function cleanupRekap() {
    rekapInitDone = false;
    currentRekapData = [];
    console.log("🧹 Rekap system cleaned up");
}

// ======================= AUTO INIT =======================

// Tunggu DOM dan data siap
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (typeof currentUser !== 'undefined' && currentUser) {
                initRekap();
            } else {
                // Tunggu currentUser
                const checkUser = setInterval(() => {
                    if (typeof currentUser !== 'undefined' && currentUser) {
                        clearInterval(checkUser);
                        initRekap();
                    }
                }, 500);
            }
        }, 1000);
    });
} else {
    setTimeout(() => {
        if (typeof currentUser !== 'undefined' && currentUser) {
            initRekap();
        }
    }, 1000);
}

// Export ke global scope
window.loadRekap = loadRekap;
window.exportRekapToExcel = exportRekapToExcel;
window.exportRekapToPDF = exportRekapToPDF;
window.initRekap = initRekap;
window.cleanupRekap = cleanupRekap;