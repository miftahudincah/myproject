async function syncUserToFirebase(user) {
    const url = `${DATABASE_URL}users/${user.id}.json`;
    const firebaseData = {
        id: parseInt(user.id),
        nama: user.nama,
        kelas: user.kelas,
        jurusan: user.jurusan,
        delayOut: user.delayOut || "60"
    };
    try {
        await fetch(url, { method: 'PUT', body: JSON.stringify(firebaseData) });
        console.log("Firebase synced for user", user.id);
    } catch(e) { console.log("Firebase Sync Error: ", e); }
}

async function syncAttendanceToFirebase(log, user) {
    const dateStr = new Date(log.timestamp).toISOString().split('T')[0];
    const timeStr = new Date(log.timestamp).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'});
    const url = `${DATABASE_URL}absensi/${dateStr}/${log.studentId}.json`;
    
    const firebaseData = {
        nama: user.nama,
        kelas: user.kelas,
        jurusan: user.jurusan,
        in: timeStr,
        out: "" 
    };
    try {
        await fetch(url, { method: 'PUT', body: JSON.stringify(firebaseData) });
    } catch(e) { console.log("Firebase Sync Error: ", e); }
}