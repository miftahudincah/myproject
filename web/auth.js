function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;

    const btn = document.getElementById('btnLoginSubmit');
    btn.innerText = "Memproses...";
    btn.disabled = true;

    auth.signInWithEmailAndPassword(email, pass)
        .then((userCredential) => {
            const user = userCredential.user;
            // Ambil data role dan detail user dari database
            db.ref('users_auth/' + user.uid).once('value').then((snapshot) => {
                const userData = snapshot.val();
                if (userData) {
                    // Normalisasi Kelas di local agar format konsisten
                    if(userData.kelas) userData.kelas = userData.kelas.toUpperCase();

                    currentUser = { uid: user.uid, email: user.email, ...userData };
                    initApp();
                    showToast(`Selamat datang, ${userData.nama}`);
                } else {
                    showToast("Data user tidak ditemukan di Database!", "error");
                    auth.signOut();
                }
            });
        })
        .catch((error) => {
            showToast(error.message, "error");
        })
        .finally(() => {
            btn.innerText = "MASUK";
            btn.disabled = false;
        });
}

function handleRegister(e) {
    e.preventDefault();
    
    // 1. Ambil Tipe Role (Siswa atau Guru)
    const regType = document.querySelector('input[name="regRoleType"]:checked').value;
    
    const codeInput = document.getElementById('regCode').value.toUpperCase();
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPassword').value;

    // 2. Cek Kode Terlebih Dahulu di Database
    db.ref('codes/' + codeInput).once('value').then((snapshot) => {
        const codeData = snapshot.val();
        
        // Validasi Kode Umum
        if (!codeData) {
            showToast("Kode Pendaftaran tidak valid!", "error");
            return;
        }
        if (codeData.used) {
            showToast("Kode Pendaftaran sudah dipakai!", "error");
            return;
        }

        // 3. Validasi Berdasarkan Tipe (SISWA vs GURU)
        if (regType === 'siswa') {
            // --- FLOW SISWA (Data Otomatis dari FP) ---
            if (codeData.type !== 'siswa') {
                showToast("Kode ini bukan untuk Siswa!", "error");
                return;
            }
            
            const inputId = document.getElementById('regGeneratedId').value.trim();
            if (!inputId) {
                showToast("Masukkan ID Siswa (Generated ID)!", "error");
                return;
            }

            // Cek apakah ID Input cocok dengan Linked ID di Kode
            if (codeData.linkedId != inputId) {
                showToast("ID Siswa tidak cocok dengan Kode!", "error");
                return;
            }

            // 4. AMBIL DATA SISWA DARI NODE 'users' (DATA FINGERPRINT)
            db.ref('users/' + inputId).once('value').then((snapUser) => {
                const studentFpData = snapUser.val();

                if (!studentFpData) {
                    showToast("ID Siswa tidak ditemukan di Database Fingerprint!", "error");
                    return;
                }

                // Data Nama, Kelas, Jurusan DIAMBIL OTOMATIS dari Data Fingerprint
                // TAMBAHKAN fpId UNTUK TRACKING DUPLIKASI
                createUserAccount(email, pass, {
                    nama: studentFpData.nama,        // Ambil dari FP
                    kelas: studentFpData.kelas,      // Ambil dari FP
                    jurusan: studentFpData.jurusan,  // Ambil dari FP
                    fpId: inputId,                   // <--- PENTING: Simpan ID Fingerprint
                    email: email,
                    role: "siswa",
                    subject: "",                    // Siswa kosong
                    photoUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(studentFpData.nama)}&background=random`,
                    registeredAt: firebase.database.ServerValue.TIMESTAMP
                }, codeInput);
            });

        } else {
            // --- FLOW GURU (Input Manual) ---
            if (codeData.type !== 'guru') {
                showToast("Kode ini bukan untuk Guru!", "error");
                return;
            }

            const namaGuru = document.getElementById('regNama').value;
            const subjectGuru = document.getElementById('regSubject').value; // AMBIL MATA PELAJARAN

            if(!namaGuru) {
                showToast("Nama Guru wajib diisi!", "error");
                return;
            }

            // Proses Buat User Guru
            // Guru tidak mengisi kelas/jurusan di form ini, di-set kosong
            // TAMBAHKAN fpId: null
            createUserAccount(email, pass, {
                nama: namaGuru, 
                email: email, 
                role: "guru",
                fpId: null, // <--- PENTING: Guru tidak punya ID Fingerprint
                kelas: "", 
                jurusan: "",
                subject: subjectGuru,          // <--- PENTING: Simpan Mata Pelajaran
                photoUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(namaGuru)}&background=random`,
                registeredAt: firebase.database.ServerValue.TIMESTAMP
            }, codeInput);
        }
    });
}

// Helper Function untuk membuat akun agar kode tidak berulang
function createUserAccount(email, pass, userData, codeInput) {
    auth.createUserWithEmailAndPassword(email, pass)
        .then((userCredential) => {
            const user = userCredential.user;
            
            // Simpan data user ke Database (node users_auth)
            db.ref('users_auth/' + user.uid).set(userData);

            // Tandai kode sebagai terpakai
            db.ref('codes/' + codeInput).update({ used: true, userId: user.uid });

            showToast("Pendaftaran Berhasil! Silakan Login.");
            toggleAuth('login');
            document.getElementById('registerForm').reset();
            
            // Reset tampilan radio button ke default (Siswa)
            if(typeof toggleRegisterInput === 'function') toggleRegisterInput();
        })
        .catch((err) => {
            showToast(err.message, "error");
        });
}

function handleLogout() {
    auth.signOut().then(() => { location.reload(); });
}

function toggleAuth(mode) {
    if(mode === 'register') {
        document.getElementById('login-card').style.display = 'none';
        document.getElementById('register-card').style.display = 'block';
    } else {
        document.getElementById('login-card').style.display = 'block';
        document.getElementById('register-card').style.display = 'none';
    }
}

function togglePassword(id, icon) {
    const input = document.getElementById(id);
    input.type = input.type === "password" ? "text" : "password";
    icon.style.color = input.type === "text" ? "var(--primary)" : "#aaa";
}