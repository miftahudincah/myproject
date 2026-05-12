// Fungsi untuk memuat komponen HTML dari file partial
async function loadComponent(elementId, filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        document.getElementById(elementId).innerHTML = html;
        return true;
    } catch (error) {
        console.error(`Gagal memuat ${filePath}:`, error);
        return false;
    }
}

// Muat semua komponen untuk halaman utama
async function loadAllComponents() {
    // Urutan penting: auth dulu, lalu modal, dashboard
    await loadComponent('auth-section', 'partials/auth.html');
    await loadComponent('modal-container', 'partials/modals.html');
    
    // Setelah modal terpasang, inisialisasi event listener untuk toggle password
    // (fungsi togglePassword sudah ada di auth.js)
    
    // Dashboard akan dimuat setelah login berhasil
}

// Muat komponen dashboard (header + tabs)
async function loadDashboardComponents() {
    await loadComponent('dashboard-section', 'partials/dashboard-header.html');
    // Setelah header terpasang, muat masing-masing tab (bisa lazy load)
    await loadComponent('tab-attendance', 'partials/tab-attendance.html');
    await loadComponent('tab-students', 'partials/tab-students.html');
    await loadComponent('tab-users', 'partials/tab-users.html');
    await loadComponent('tab-config', 'partials/tab-config.html');
    await loadComponent('tab-guide', 'partials/tab-guide.html');
}