/**
 * AKKOÇ LOJİSTİK - SUPABASE CLIENT (PRODUCTION READY)
 * Özellikler:
 * - Environment Variable Desteği
 * - Otomatik ve Zorunlu Senkronizasyon (ForceSync)
 * - Conflict Resolution (Last Write Wins)
 * - Offline Queue Yönetimi
 * - DOM Hooking (Otomatik Sync Tetikleme)
 */

// Environment Variables veya Fallback (Kullanıcı Tanımlı) Değerler
const SUPABASE_URL = (typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL)
    || (window.ENV && window.ENV.SUPABASE_URL)
    || 'https://murxmdxtjqhsrlgjqply.supabase.co';

const SUPABASE_KEY = (typeof process !== 'undefined' && process.env && process.env.SUPABASE_KEY)
    || (window.ENV && window.ENV.SUPABASE_KEY)
    || 'sb_publishable_nQdtBaDFLNUPGnkIzNfqog_UF2Nd8Zu';

let supabase = null;
let isSyncing = false;

// 1. BAŞLATMA
function initSupabase() {
    try {
        if (!window.supabase) {
            console.error('❌ Supabase SDK bulunamadı! <script> tagını kontrol edin.');
            return false;
        }
        const { createClient } = window.supabase;
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true
            }
        });
        console.log('✅ Akkoç Bulut Bağlantısı Hazır.');
        return true;
    } catch (e) {
        console.error('❌ Supabase Init Hatası:', e);
        return false;
    }
}

// 2. SENKRONİZASYON MOTORU
async function forceSyncAll() {
    // Bağlantı veya SDK yoksa veya zaten çalışıyorsa çık
    if (!supabase || isSyncing || !navigator.onLine) return;
    isSyncing = true;

    // Durum ikonunu güncelle (Varsa)
    const statusEl = document.getElementById('cloudStatus'); // Eğer UI'da varsa
    if (statusEl) statusEl.innerHTML = '<span class="text-yellow-400">🔄</span>';

    try {
        console.log('🔄 Sync Başlıyor...');

        // --- A. VEHICLE_RECORDS (ARAÇLAR) ---
        const { data: cloudData, error: rErr } = await supabase.from('vehicle_records').select('*');

        if (rErr) {
            throw new Error('Vehicle Records okunamadı: ' + rErr.message);
        }

        if (cloudData) {
            // 1. Yerel veriyi oku ve ID olmayanlara ID ata
            let localRecords = JSON.parse(localStorage.getItem('vehicle_records') || '[]');
            let hasLocalChanges = false;

            localRecords.forEach(r => {
                if (!r.__backendId) {
                    r.__backendId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                    if (!r.updated_at) r.updated_at = new Date().toISOString();
                    hasLocalChanges = true;
                }
            });

            if (hasLocalChanges) localStorage.setItem('vehicle_records', JSON.stringify(localRecords));

            // 2. Haritalama (Merge Logic)
            const recordMap = new Map();

            // Bulut verisini map'e işle
            cloudData.forEach(row => {
                const record = row.data || {};
                record.__backendId = row.id; // ID eşleşmesi
                record.updated_at = row.updated_at || record.updated_at;
                recordMap.set(row.id, record);
            });

            // Yerel veriyi karşılaştır ve gerekirse güncelle/ekle
            const upsertQueue = [];

            localRecords.forEach(localRec => {
                const cloudRec = recordMap.get(localRec.__backendId);

                if (!cloudRec) {
                    // Bulutta yok -> Yeni Kayıt -> Gönderilecek
                    recordMap.set(localRec.__backendId, localRec);
                    upsertQueue.push({
                        id: localRec.__backendId,
                        data: localRec,
                        updated_at: localRec.updated_at || new Date().toISOString()
                    });
                } else {
                    // Bulutta var -> Tarih Kıyasla
                    const localTime = new Date(localRec.updated_at || 0).getTime();
                    const cloudTime = new Date(cloudRec.updated_at || 0).getTime();

                    if (localTime > cloudTime) {
                        // Yerel daha güncel -> Bulutu güncelle
                        recordMap.set(localRec.__backendId, localRec);
                        upsertQueue.push({
                            id: localRec.__backendId,
                            data: localRec,
                            updated_at: localRec.updated_at
                        });
                    }
                    // Aksi halde Bulut verisi Map'te kalır (Overwrite local)
                }
            });

            // 3. Sonuçları Yerele Kaydet
            const finalRecords = Array.from(recordMap.values());
            // Tarihe göre sırala
            finalRecords.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

            localStorage.setItem('vehicle_records', JSON.stringify(finalRecords));

            // Global değişkeni ve UI'ı güncelle
            if (typeof window !== 'undefined') {
                window.records = finalRecords;
                if (typeof renderVehicles === 'function') renderVehicles(finalRecords);
                if (typeof renderHistory === 'function') renderHistory(finalRecords);
                if (typeof updateStats === 'function') updateStats();
            }

            // 4. Değişiklikleri Buluta Gönder (Batch Upsert)
            if (upsertQueue.length > 0) {
                if (typeof showToast === 'function') showToast(`☁️ ${upsertQueue.length} kayıt senkronize ediliyor...`, 'info');
                const { error: upErr } = await supabase.from('vehicle_records').upsert(upsertQueue);
                if (upErr) throw upErr;
            }
        }

        // --- B. PROFILES (KULLANICILAR) ---
        // Sadece okuma veya basit senkronizasyon
        const { data: usersData } = await supabase.from('profiles').select('*');
        if (usersData && usersData.length > 0) {
            localStorage.setItem('system_users', JSON.stringify(usersData));
            if (typeof window !== 'undefined') window.allUsers = usersData;
        }

        // --- C. SETTINGS (FOTOĞRAFLAR VB.) ---
        // Basit Key-Value Sync
        const settingsKeys = ['vehicle_statuses', 'vehicle_photos', 'deleted_vehicle_records'];
        for (const key of settingsKeys) {
            const { data: serverRow } = await supabase.from('vehicle_settings').select('*').eq('key', key).single();
            const localVal = localStorage.getItem(key);

            if (serverRow) {
                const serverTime = new Date(serverRow.updated_at).getTime();
                const localUpdated = localStorage.getItem(key + '_updated');
                const localTime = localUpdated ? new Date(localUpdated).getTime() : 0;

                if (serverTime > localTime) {
                    // İndir
                    localStorage.setItem(key, JSON.stringify(serverRow.value));
                    localStorage.setItem(key + '_updated', serverRow.updated_at);
                } else if (localTime > serverTime && localVal) {
                    // Yükle
                    await supabase.from('vehicle_settings').upsert({
                        key: key,
                        value: JSON.parse(localVal),
                        updated_at: new Date(localTime).toISOString()
                    });
                }
            } else if (localVal) {
                // Sunucuda yok, yükle
                await supabase.from('vehicle_settings').upsert({
                    key: key,
                    value: JSON.parse(localVal),
                    updated_at: new Date().toISOString()
                });
            }
        }

        if (statusEl) statusEl.innerHTML = '<span class="text-green-500">☁️</span>';
        console.log('✅ Sync Başarılı.');

    } catch (e) {
        console.error('❌ Sync Hatası:', e);
        if (typeof showToast === 'function') showToast('Sync Hatası: ' + e.message, 'error');
        if (statusEl) statusEl.innerHTML = '<span class="text-red-500">⚠️</span>';
    } finally {
        isSyncing = false;
    }
}

// 3. REALTIME LISTENER
function initRealtime() {
    if (!supabase) return;
    const channel = supabase.channel('public-db-changes');

    channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_records' }, (payload) => {
            console.log('🔔 Veri Değişti:', payload);
            forceSyncAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => forceSyncAll())
        .subscribe();
}

// 4. UI HOOKS (Otomatik Tetikleyiciler)
function attachHooks() {
    // Kritik fonksiyonları sarmala (wrap)
    const funcs = ['saveForm', 'deleteVehicleToTrash', 'permanentDeleteVehicle', 'restoreVehicle', 'toggleVehicleStatus'];

    funcs.forEach(fn => {
        if (typeof window[fn] === 'function') {
            const original = window[fn];
            window[fn] = async function (...args) {
                const result = await original.apply(this, args);
                // İşlem biter bitmez sync dene
                setTimeout(forceSyncAll, 100);
                return result;
            };
        }
    });
}

// 5. BAŞLATICI (Bootstrap)
document.addEventListener('DOMContentLoaded', () => {
    // 1 sn bekle ki diğer scriptler yüklensin
    setTimeout(() => {
        if (initSupabase()) {
            forceSyncAll(); // İlk açılışta sync
            initRealtime(); // Canlı dinleme
            attachHooks();  // UI bağlama

            // Periyodik Sync (her 30 sn)
            setInterval(forceSyncAll, 30000);
        }
    }, 500);
});
