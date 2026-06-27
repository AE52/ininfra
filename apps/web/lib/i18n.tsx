"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Lang = "tr" | "en";

type Translations = typeof tr;

// ─────────────────────────────────────────────────────────────────────────────
// Turkish dictionary (also selectable; English is the default — see `en` below)
// ─────────────────────────────────────────────────────────────────────────────

const tr = {
  // ── Global chrome ──────────────────────────────────────────────────────────
  nav: {
    home: "Ana Sayfa",
    overview: "Genel Bakış",
    search: "Ara",
    favorites: "Favoriler",
    status: "Durum",
    events: "Olaylar",
    workloads: "İş Yükleri",
    services: "Servisler",
    stateful: "Stateful",
    jobs: "İşler",
    autoscaling: "Otomatik Ölçekleme",
    gateway: "Ağ Geçidi",
    builds: "Build'ler",
    branches: "Branch'ler",
    storage: "Depolama",
    secrets: "Secret Sağlığı",
    compute: "Hesaplama",
    nodes: "Node'lar",
    rightsizing: "Boyutlandırma",
    administration: "Yönetim",
    auditLog: "Audit Log",
    users: "Kullanıcılar",
    rbac: "Yetkiler",
    errors: "Hatalar",
  },

  masthead: {
    toggleNav: "Navigasyonu aç/kapat",
    search: "Ara…",
    searchShortcut: "⌘K",
    searchLabel: "Ara (Cmd+K)",
    signedInAs: "Giriş yapıldı",
    logout: "Çıkış yap",
  },

  // ── Login page ─────────────────────────────────────────────────────────────
  login: {
    title: "Hesabınıza giriş yapın",
    clusterConsole: "cluster konsolu",
    username: "Kullanıcı adı",
    password: "Şifre",
    submit: "Giriş yap",
    submitting: "Giriş yapılıyor…",
    errorBadCreds: "Hatalı kullanıcı adı veya şifre.",
    errorGeneric: (status: number) => `Giriş başarısız (${status}).`,
    errorNetwork: "Sunucuya ulaşılamadı.",
  },

  // ── Dashboard ──────────────────────────────────────────────────────────────
  dashboard: {
    kicker: "Cluster genel bakış",
    defaultSubtitle: "Yönetilen namespace'lerdeki iş yükleri.",
    namespaceSubtitle: (nss: string) => `İş yükleri: ${nss}.`,
    statServices: "Servisler",
    statDegraded: "Hatalı",
    statNodes: "Node'lar",
    statCpu: "vCPU kapasitesi",
    statMemory: "Bellek",
    statHintHealthy: (n: number) => `${n} sağlıklı`,
    statHintAllStable: "hepsi kararlı",
    statHintProgressing: (n: number) => `${n} ilerliyor`,
    statHintReady: "hazır",
    statHintAllocatable: (v: string) => `${v} atanabilir`,
    statHintPodsScheduled: (n: number) => `${n} pod zamanlandı`,
    nodeCapacity: "Node kapasitesi",
    viewAllNodes: "Tüm node'ları gör →",
    cpuReserved: "CPU rezerve",
    memReserved: "Bellek rezerve",
    servicesSection: "Servisler",
    noServicesTitle: "Servis bulunamadı",
    noServicesBody:
      "Yönetilen namespace'lerde henüz Deployment bulunmuyor.",
    ready: "Hazır",
    notReady: "Hazır Değil",
    pods: "pod",
  },

  // ── Branches page ─────────────────────────────────────────────────────────
  branches: {
    kicker: "CI/CD",
    title: "Deploy Branch'leri",
    subtitle:
      "Her servisin hangi branch'ten build alınacağını değiştir. Değişiklik bir sonraki build'de geçerli olur (webhook veya manuel tetikleme).",
    colService: "Servis",
    colCurrentBranch: "Mevcut branch",
    colNewBranch: "Yeni branch",
    disabled: "(devre dışı)",
    changeBtn: "Değiştir",
    changeBtnSaving: "…",
    noServices: "Katalogda servis yok",
    loading: "Yükleniyor…",
    toastSuccess: (svc: string, branch: string) =>
      `${svc} → ${branch} (sonraki build bu branch'ten)`,
  },

  // ── HPA page ──────────────────────────────────────────────────────────────
  hpa: {
    kicker: "Autoscaling",
    title: "HorizontalPodAutoscalers",
    subtitle:
      "Min/max replica ve hedef CPU yüzdesini düzenle. Değişiklik anında uygulanır.",
    labelMinReplica: "Min replica",
    labelMaxReplica: "Max replica",
    labelTargetCpu: "Hedef CPU %",
    saveBtn: "Kaydet",
    saveBtnSaving: "Kaydediliyor…",
    noHpa: "Bu namespace'te HPA yok",
    loading: "Yükleniyor…",
    currentReplicas: (n: number) => `şu an ${n} replica`,
    toastSuccess: (name: string, min: number, max: number, cpu: string | number) =>
      `${name} HPA güncellendi (min ${min} / max ${max} / cpu ${cpu}%)`,
  },

  // ── Stateful page ─────────────────────────────────────────────────────────
  stateful: {
    kicker: "Stateful tier",
    title: "StatefulSets",
    subtitle:
      "Kafka, ZooKeeper, Redis, Elasticsearch, Neo4j, Chroma, Mongo-ffmpeg. Scale ve restart kritik etkilidir — her işlem audit'lenir.",
    noStateful: "Bu namespace'te StatefulSet yok",
    loading: "Yükleniyor…",
    restartBtn: "Restart",
    restartBtnBusy: "…",
    confirmScale: (name: string, n: number) =>
      `${name} → ${n} replica olarak ölçeklensin mi?\n\nDİKKAT: Bu stateful bir sistem (veri tutar). Scale-down veri/kuorum kaybına yol açabilir.`,
    confirmRestart: (name: string) => `${name} rolling restart edilsin mi?`,
    toastScaleSuccess: (name: string, n: number) => `${name} → ${n} replica`,
    toastRestartSuccess: (name: string) =>
      `${name} rolling restart başlatıldı`,
    ready: "hazır",
  },

  // ── Jobs & CronJobs page ────────────────────────────────────────────────────
  jobs: {
    kicker: "Batch tier",
    title: "Jobs & CronJobs",
    subtitle:
      "Zamanlanmış CronJob'lar ve son Job çalışmaları. Suspend/resume ve şimdi çalıştır audit'lenir.",
    loading: "Yükleniyor…",
    allNamespaces: "Tüm namespace'ler",
    // CronJobs section
    cronjobsTitle: "CronJob'lar",
    noCronjobs: "Bu namespace'te CronJob yok",
    schedule: "Zamanlama",
    suspended: "Askıda",
    active: "aktif",
    lastRun: "Son çalışma",
    never: "hiç",
    suspendBtn: "Askıya al",
    resumeBtn: "Devam ettir",
    runNowBtn: "Şimdi çalıştır",
    busy: "…",
    confirmSuspend: (name: string) =>
      `${name} CronJob'u askıya alınsın mı? Yeni Job'lar zamanlanmayacak.`,
    confirmResume: (name: string) => `${name} CronJob'u devam ettirilsin mi?`,
    confirmTrigger: (name: string) =>
      `${name} şablonundan şimdi bir Job oluşturulsun mu?`,
    toastSuspendSuccess: (name: string) => `${name} askıya alındı`,
    toastResumeSuccess: (name: string) => `${name} devam ettirildi`,
    toastTriggerSuccess: (jobName: string) => `Job oluşturuldu: ${jobName}`,
    // Jobs section
    recentJobsTitle: "Son Job'lar",
    noJobs: "Bu namespace'te Job yok",
    colJob: "Job",
    colStatus: "Durum",
    colCompletions: "Tamamlanma",
    colDuration: "Süre",
    colOwner: "CronJob",
    colStarted: "Başladı",
    statusComplete: "Tamamlandı",
    statusFailed: "Başarısız",
    statusRunning: "Çalışıyor",
    statusUnknown: "Bilinmiyor",
  },

  // ── Storage page ──────────────────────────────────────────────────────────
  storage: {
    kicker: "Depolama",
    title: "PersistentVolumeClaims",
    subtitle:
      "EBS-backed kalıcı diskler: kapasite, durum, storage class ve kullanan pod'lar.",
    colPvc: "PVC",
    colStatus: "Durum",
    colCapacity: "Kapasite",
    colStorageClass: "Storage class",
    colAccess: "Erişim",
    colUsedBy: "Kullanan pod",
    browseLinkText: "Dosyaları gör →",
    noPvc: "Bu namespace'te PVC yok",
    idle: "boşta",
    loading: "Yükleniyor…",
  },

  // ── Secrets health page ───────────────────────────────────────────────────
  secrets: {
    kicker: "Güvenlik",
    title: "Secret Sağlığı",
    subtitle:
      "kubernetes.io/tls secret'larındaki sertifikaların son kullanma tarihleri. Yalnızca metadata gösterilir — secret değerleri asla okunmaz.",
    allNamespaces: "Tüm namespace'ler",
    colNamespace: "Namespace",
    colSecret: "Secret",
    colCommonName: "Common name",
    colIssuer: "Veren (Issuer)",
    colExpires: "Bitiş",
    colDaysLeft: "Kalan gün",
    statTotal: "TLS secret",
    statExpiringSoon: "30 günden az",
    statExpired: "Süresi dolmuş",
    badgeExpired: "Süresi dolmuş",
    badgeDays: (n: number) => `${n} gün`,
    parseErrorLabel: "ayrıştırılamadı",
    noSecrets: "TLS secret bulunamadı",
    noSecretsBody:
      "Seçili kapsamda kubernetes.io/tls türünde secret yok.",
    loading: "Yükleniyor…",
  },

  // ── Events page ───────────────────────────────────────────────────────────
  events: {
    kicker: "Sorun Giderme",
    title: "Olaylar",
    subtitle:
      "Namespace olay akışı (en yeni üstte). FailedScheduling, BackOff, Unhealthy gibi sorunları yakala.",
    refreshBtn: "Yenile",
    onlyWarnings: "Sadece Uyarı",
    noEvents: "Olay yok",
    loading: "Yükleniyor…",
  },

  // ── Audit page ────────────────────────────────────────────────────────────
  audit: {
    kicker: "Hesap verebilirlik",
    title: "Audit Log",
    subtitle:
      "Her mutasyon işlemi — ölçek, restart, env düzenleme, build, pod silme — buraya kaydedilir.",
    colWhen: "Ne zaman",
    colActor: "Aktör",
    colAction: "İşlem",
    colKind: "Tür",
    colTargetName: "Hedef",
    colNamespace: "Namespace",
    colTarget: "Hedef",
    noEntries: "Henüz audit kaydı yok.",
    noEntriesFiltered: "Bu filtrelere uyan audit kaydı yok.",
    loadMore: "Daha fazla yükle",
    loading: "Yükleniyor…",
    endOfHistory: "— geçmişin sonu —",
    filterActor: "aktör…",
    filterAllActions: "Tüm işlemler",
    filterAllNamespaces: "Tüm namespace'ler",
    filterAllRoles: "Tüm roller",
    clearFilters: "Filtreleri temizle",
    detail: "detay",
    hide: "gizle",
    // Search & timespan
    searchPlaceholder: "ara…",
    regexToggleLabel: "Regex",
    regexToggleTitle: "Regex moduna geç (Postgres ~*)",
    regexInvalid: "Geçersiz regex",
    timespanLabel: "Zaman aralığı",
    sinceAll: "Tüm zamanlar",
    since1h: "Son 1 saat",
    since24h: "Son 24 saat",
    since7d: "Son 7 gün",
    since30d: "Son 30 gün",
    customRange: "Özel aralık",
    fromLabel: "Başlangıç",
    toLabel: "Bitiş",
  },

  // ── Users page ────────────────────────────────────────────────────────────
  users: {
    kicker: "Yönetim",
    title: "Kullanıcılar",
    subtitle:
      "Konsol hesapları — admin'ler cluster'ı değiştirebilir, viewer'lar salt-okunur erişime sahiptir.",
    addUserBtn: "Kullanıcı ekle",
    colUsername: "Kullanıcı adı",
    colRole: "Rol",
    colCreated: "Oluşturuldu",
    colLastLogin: "Son giriş",
    colActions: "İşlemler",
    makeDeveloper: "Developer yap",
    makeAdmin: "Admin yap",
    resetPassword: "Şifre sıfırla",
    deleteBtn: "Sil",
    never: "hiç",
    loading: "Yükleniyor…",
    noUsers: "Kullanıcı yok",
    noUsersBody: "Henüz konsol hesabı yok.",
    adminsOnly: "Yalnızca adminler",
    adminsOnlyBody: "Konsol kullanıcılarını yönetmek için admin rolü gereklidir.",
    cannotVerifyRole: (e: string) => `Rolünüz doğrulanamadı: ${e}`,
    usersTotal: (n: number) => `toplam ${n} kullanıcı`,
    usersShown: (n: number) => `${n} gösteriliyor`,
    prev: "Önceki",
    next: "Sonraki",
    // Create user dialog
    createDialogTitle: "Kullanıcı ekle",
    createUsername: "Kullanıcı adı",
    createPassword: "Şifre",
    createPasswordHint: "En az 8 karakter.",
    createRole: "Rol",
    createCancelBtn: "İptal",
    createSubmitBtn: "Kullanıcı oluştur",
    createSubmittingBtn: "Oluşturuluyor…",
    // Prompts / confirms
    promptNewPassword: (u: string) =>
      `"${u}" için yeni şifre (en az 8 karakter):`,
    passwordMinLength: "Şifre en az 8 karakter olmalıdır.",
    confirmDeleteUser: (u: string) =>
      `"${u}" kullanıcısı silinsin mi? Bu işlem geri alınamaz.`,
    toastCreated: (u: string) => `"${u}" kullanıcısı oluşturuldu`,
    toastRoleChanged: (u: string, role: string) =>
      `"${u}" artık ${role}`,
    toastPasswordReset: (u: string) => `"${u}" şifresi sıfırlandı`,
    toastDeleted: (u: string) => `"${u}" silindi`,
  },

  // ── Status page ───────────────────────────────────────────────────────────
  status: {
    kicker: "Güvenilirlik",
    title: "Durum",
    subtitle:
      "Cluster genelinde tüm yönetilen iş yüklerinin canlı sağlık durumu.",
    loading: "Yükleniyor…",
    loadError: (e: string) => `Durum yüklenemedi: ${e}`,
    updatedAgo: (t: string) => `Güncellendi ${t}`,
    showingLastKnown: (e: string) =>
      `Son bilinen durum gösteriliyor — yenileme başarısız: ${e}`,
    allOperational: "Tüm sistemler çalışıyor",
    partialDegradation: "Kısmi bozulma",
    majorOutage: "Büyük kesinti",
    healthySummary: (h: number, total: number) =>
      `${h}/${total} bileşen sağlıklı`,
    degradedCount: (n: number) => `${n} bozuk`,
    uptimeWindow: (h: number) => `son ${h} saatte uptime`,
    activeIncidents: (n: number) => `Aktif olaylar · ${n}`,
    colComponent: "Bileşen",
    colStatus: "Durum",
    colReplicas: "Replica",
    colUptime: (h: number) => `Uptime (${h}s)`,
    incidentHistory: "Olay geçmişi",
    noIncidents: "Olay yok",
    noIncidentsBody: (h: number) =>
      `Tüm bileşenler son ${h} saatte çalışır durumdaydı.`,
    downFor: (d: string) => `${d} süredir düşük`,
    since: (t: string) => `${t} önce`,
    colStarted: "Başlangıç",
    colDuration: "Süre",
    ongoing: "devam ediyor",
    components: (n: number) => `${n} bileşen`,
    statusOperational: "Çalışıyor",
    statusProgressing: "İlerliyor",
    statusDegraded: "Bozuk",
    statusUnknown: "Bilinmiyor",
    services: "Servisler",
    statefulSets: "Stateful",
  },

  // ── Log Viewer ────────────────────────────────────────────────────────────
  logs: {
    searchPlaceholder: "log ara…",
    searchBtn: "Ara",
    regexToggleLabel: "Regex",
    regexToggleTitle: "Regex moduna geç (LogQL |~ \"...\")",
    regexInvalid: "Geçersiz regex",
    timespanLabel: "Zaman aralığı",
    last5m: "Son 5 dk",
    last15m: "Son 15 dk",
    last1h: "Son 1 saat",
    last6h: "Son 6 saat",
    last24h: "Son 24 saat",
    last3d: "Son 3 gün",
    last7d: "Son 7 gün",
    customRange: "Özel aralık",
    fromLabel: "Başlangıç",
    toLabel: "Bitiş",
    liveBtn: "Canlı",
    historicalBtn: "Geçmiş",
    clearBtn: "Temizle",
    followLabel: "takip et",
    lineCount: (n: number) => `${n} satır`,
    matchCount: (n: number) => `${n} eşleşme`,
    waitingOutput: "Log çıktısı bekleniyor…",
    noLines: "Log satırı yok.",
    streamDropped: "stream kesildi — canlı/geçmiş ikonuna tıkla",
    lokiError: "Loki hatası — konsolu kontrol et",
    // ── Grafana-benzeri ek özellikler ──
    levelError: "Hata",
    levelWarn: "Uyarı",
    levelInfo: "Bilgi",
    levelDebug: "Debug",
    levelOther: "Diğer",
    allPods: (n: number) => `Tüm pod'lar (${n})`,
    podsSelected: (n: number) => `${n} pod`,
    histogramToggle: "Histogramı göster/gizle",
    histogramBucket: (start: string, end: string, total: number) =>
      `${start} – ${end}\nToplam: ${total}`,
    copyBtn: "Kopyala",
    copied: "Kopyalandı",
    exportTxt: "Metin (.txt) indir",
    exportJson: "JSON (.json) indir",
    exportLabel: "Dışa aktar",
  },

  // ── Shared / misc ─────────────────────────────────────────────────────────
  common: {
    loading: "Yükleniyor…",
    refresh: "Yenile",
    save: "Kaydet",
    cancel: "İptal",
    delete: "Sil",
    prev: "Önceki",
    next: "Sonraki",
    unknown: "—",
  },

  // ── RBAC page ─────────────────────────────────────────────────────────────
  rbac: {
    kicker: "Güvenlik",
    title: "Yetki Yönetimi",
    subtitle:
      "Her rol için izin matrisini yönet. Super admin izinleri değiştirilemez.",
    colPermission: "İzin",
    colDeveloper: "Developer",
    colAdmin: "Admin",
    colSuperAdmin: "Super Admin",
    colDefault: "varsayılan",
    colOverride: "özel",
    resetToDefault: "Varsayılana dön",
    accessDenied: "Yetkiniz yok — bu sayfa yalnızca super admin için.",
    loading: "Yükleniyor…",
    toastSaved: (key: string, role: string, v: string) =>
      `${role} / ${key} → ${v}`,
    toastReset: (key: string, role: string) =>
      `${role} / ${key} varsayılana döndürüldü`,
    categoryWorkloads: "İş Yükleri",
    categoryInfrastructure: "Altyapı",
    categoryCiCd: "CI/CD",
    categoryStorage: "Depolama",
    categoryAdministration: "Yönetim",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// English dictionary (primary/default)
// ─────────────────────────────────────────────────────────────────────────────

const en: Translations = {
  nav: {
    home: "Home",
    overview: "Overview",
    search: "Search",
    favorites: "Favorites",
    status: "Status",
    events: "Events",
    workloads: "Workloads",
    services: "Services",
    stateful: "Stateful",
    jobs: "Jobs",
    autoscaling: "Autoscaling",
    gateway: "Gateway",
    builds: "Builds",
    branches: "Branches",
    storage: "Storage",
    secrets: "Secrets health",
    compute: "Compute",
    nodes: "Nodes",
    rightsizing: "Right-sizing",
    administration: "Administration",
    auditLog: "Audit log",
    users: "Users",
    rbac: "Permissions",
    errors: "Errors",
  },

  masthead: {
    toggleNav: "Toggle navigation",
    search: "Search…",
    searchShortcut: "⌘K",
    searchLabel: "Search (Cmd+K)",
    signedInAs: "Signed in as",
    logout: "Log out",
  },

  login: {
    title: "Log in to your account",
    clusterConsole: "cluster console",
    username: "Username",
    password: "Password",
    submit: "Log in",
    submitting: "Logging in…",
    errorBadCreds: "Incorrect username or password.",
    errorGeneric: (status: number) => `Login failed (${status}).`,
    errorNetwork: "Could not reach the server.",
  },

  dashboard: {
    kicker: "Cluster overview",
    defaultSubtitle: "Workloads across the managed namespaces.",
    namespaceSubtitle: (nss: string) => `Workloads across ${nss}.`,
    statServices: "Services",
    statDegraded: "Degraded",
    statNodes: "Nodes",
    statCpu: "vCPU capacity",
    statMemory: "Memory",
    statHintHealthy: (n: number) => `${n} healthy`,
    statHintAllStable: "all stable",
    statHintProgressing: (n: number) => `${n} progressing`,
    statHintReady: "ready",
    statHintAllocatable: (v: string) => `${v} allocatable`,
    statHintPodsScheduled: (n: number) => `${n} pods scheduled`,
    nodeCapacity: "Node capacity",
    viewAllNodes: "View all nodes →",
    cpuReserved: "CPU reserved",
    memReserved: "MEM reserved",
    servicesSection: "Services",
    noServicesTitle: "No services found",
    noServicesBody:
      "No Deployments are exposed in the managed namespaces yet.",
    ready: "Ready",
    notReady: "NotReady",
    pods: "pods",
  },

  branches: {
    kicker: "CI/CD",
    title: "Deploy Branches",
    subtitle:
      "Change which branch each service builds from. The change takes effect on the next build (webhook or manual trigger).",
    colService: "Service",
    colCurrentBranch: "Current branch",
    colNewBranch: "New branch",
    disabled: "(disabled)",
    changeBtn: "Change",
    changeBtnSaving: "…",
    noServices: "No services in catalog",
    loading: "Loading…",
    toastSuccess: (svc: string, branch: string) =>
      `${svc} → ${branch} (next build from this branch)`,
  },

  hpa: {
    kicker: "Autoscaling",
    title: "HorizontalPodAutoscalers",
    subtitle:
      "Edit min/max replicas and target CPU percentage. Changes apply immediately.",
    labelMinReplica: "Min replicas",
    labelMaxReplica: "Max replicas",
    labelTargetCpu: "Target CPU %",
    saveBtn: "Save",
    saveBtnSaving: "Saving…",
    noHpa: "No HPAs in this namespace",
    loading: "Loading…",
    currentReplicas: (n: number) => `currently ${n} replicas`,
    toastSuccess: (name: string, min: number, max: number, cpu: string | number) =>
      `${name} HPA updated (min ${min} / max ${max} / cpu ${cpu}%)`,
  },

  stateful: {
    kicker: "Stateful tier",
    title: "StatefulSets",
    subtitle:
      "Kafka, ZooKeeper, Redis, Elasticsearch, Neo4j, Chroma, Mongo-ffmpeg. Scale and restart have critical impact — every action is audited.",
    noStateful: "No StatefulSets in this namespace",
    loading: "Loading…",
    restartBtn: "Restart",
    restartBtnBusy: "…",
    confirmScale: (name: string, n: number) =>
      `Scale ${name} to ${n} replica(s)?\n\nWARNING: This is a stateful system (holds data). Scale-down may cause data loss or quorum issues.`,
    confirmRestart: (name: string) => `Rolling restart ${name}?`,
    toastScaleSuccess: (name: string, n: number) => `${name} → ${n} replicas`,
    toastRestartSuccess: (name: string) =>
      `${name} rolling restart initiated`,
    ready: "ready",
  },

  jobs: {
    kicker: "Batch tier",
    title: "Jobs & CronJobs",
    subtitle:
      "Scheduled CronJobs and recent Job runs. Suspend/resume and run-now are audited.",
    loading: "Loading…",
    allNamespaces: "All namespaces",
    // CronJobs section
    cronjobsTitle: "CronJobs",
    noCronjobs: "No CronJobs in this namespace",
    schedule: "Schedule",
    suspended: "Suspended",
    active: "active",
    lastRun: "Last run",
    never: "never",
    suspendBtn: "Suspend",
    resumeBtn: "Resume",
    runNowBtn: "Run now",
    busy: "…",
    confirmSuspend: (name: string) =>
      `Suspend CronJob ${name}? No new Jobs will be scheduled.`,
    confirmResume: (name: string) => `Resume CronJob ${name}?`,
    confirmTrigger: (name: string) =>
      `Create a Job now from the ${name} template?`,
    toastSuspendSuccess: (name: string) => `${name} suspended`,
    toastResumeSuccess: (name: string) => `${name} resumed`,
    toastTriggerSuccess: (jobName: string) => `Created job ${jobName}`,
    // Jobs section
    recentJobsTitle: "Recent Jobs",
    noJobs: "No Jobs in this namespace",
    colJob: "Job",
    colStatus: "Status",
    colCompletions: "Completions",
    colDuration: "Duration",
    colOwner: "CronJob",
    colStarted: "Started",
    statusComplete: "Complete",
    statusFailed: "Failed",
    statusRunning: "Running",
    statusUnknown: "Unknown",
  },

  storage: {
    kicker: "Storage",
    title: "PersistentVolumeClaims",
    subtitle:
      "EBS-backed persistent disks: capacity, status, storage class, and consuming pods.",
    colPvc: "PVC",
    colStatus: "Status",
    colCapacity: "Capacity",
    colStorageClass: "Storage class",
    colAccess: "Access",
    colUsedBy: "Used by",
    browseLinkText: "Browse files →",
    noPvc: "No PVCs in this namespace",
    idle: "idle",
    loading: "Loading…",
  },

  secrets: {
    kicker: "Security",
    title: "Secrets health",
    subtitle:
      "Expiry of certificates in kubernetes.io/tls secrets. Metadata only — secret values are never read.",
    allNamespaces: "All namespaces",
    colNamespace: "Namespace",
    colSecret: "Secret",
    colCommonName: "Common name",
    colIssuer: "Issuer",
    colExpires: "Expires",
    colDaysLeft: "Days left",
    statTotal: "TLS secrets",
    statExpiringSoon: "Under 30 days",
    statExpired: "Expired",
    badgeExpired: "Expired",
    badgeDays: (n: number) => `${n}d`,
    parseErrorLabel: "parse error",
    noSecrets: "No TLS secrets found",
    noSecretsBody:
      "No kubernetes.io/tls secrets in the selected scope.",
    loading: "Loading…",
  },

  events: {
    kicker: "Troubleshooting",
    title: "Events",
    subtitle:
      "Namespace event stream (newest first). Catch issues like FailedScheduling, BackOff, Unhealthy.",
    refreshBtn: "Refresh",
    onlyWarnings: "Warnings only",
    noEvents: "No events",
    loading: "Loading…",
  },

  audit: {
    kicker: "Accountability",
    title: "Audit Log",
    subtitle:
      "Every mutating action — scale, restart, env edit, build, pod delete — is recorded here.",
    colWhen: "When",
    colActor: "Actor",
    colAction: "Action",
    colKind: "Kind",
    colTargetName: "Target",
    colNamespace: "Namespace",
    colTarget: "Target",
    noEntries: "No audit entries recorded yet.",
    noEntriesFiltered: "No audit entries match these filters.",
    loadMore: "Load more",
    loading: "Loading…",
    endOfHistory: "— end of history —",
    filterActor: "actor…",
    filterAllActions: "All actions",
    filterAllNamespaces: "All namespaces",
    filterAllRoles: "All roles",
    clearFilters: "Clear filters",
    detail: "detail",
    hide: "hide",
    // Search & timespan
    searchPlaceholder: "search…",
    regexToggleLabel: "Regex",
    regexToggleTitle: "Switch to regex mode (Postgres ~*)",
    regexInvalid: "Invalid regex",
    timespanLabel: "Time range",
    sinceAll: "All time",
    since1h: "Last 1 hour",
    since24h: "Last 24 hours",
    since7d: "Last 7 days",
    since30d: "Last 30 days",
    customRange: "Custom range",
    fromLabel: "From",
    toLabel: "To",
  },

  users: {
    kicker: "Administration",
    title: "Users",
    subtitle:
      "Console accounts — admins may mutate the cluster, viewers are read-only.",
    addUserBtn: "Add user",
    colUsername: "Username",
    colRole: "Role",
    colCreated: "Created",
    colLastLogin: "Last login",
    colActions: "Actions",
    makeDeveloper: "Make developer",
    makeAdmin: "Make admin",
    resetPassword: "Reset password",
    deleteBtn: "Delete",
    never: "never",
    loading: "Loading…",
    noUsers: "No users",
    noUsersBody: "No console accounts exist yet.",
    adminsOnly: "Admins only",
    adminsOnlyBody: "You need the admin role to manage console users.",
    cannotVerifyRole: (e: string) => `Could not verify your role: ${e}`,
    usersTotal: (n: number) => `${n} user${n === 1 ? "" : "s"} total`,
    usersShown: (n: number) => `${n} shown`,
    prev: "Prev",
    next: "Next",
    createDialogTitle: "Add user",
    createUsername: "Username",
    createPassword: "Password",
    createPasswordHint: "At least 8 characters.",
    createRole: "Role",
    createCancelBtn: "Cancel",
    createSubmitBtn: "Create user",
    createSubmittingBtn: "Creating…",
    promptNewPassword: (u: string) =>
      `New password for "${u}" (min 8 chars):`,
    passwordMinLength: "Password must be at least 8 characters.",
    confirmDeleteUser: (u: string) =>
      `Delete user "${u}"? This cannot be undone.`,
    toastCreated: (u: string) => `Created user "${u}"`,
    toastRoleChanged: (u: string, role: string) =>
      `"${u}" is now ${role}`,
    toastPasswordReset: (u: string) => `Password reset for "${u}"`,
    toastDeleted: (u: string) => `Deleted user "${u}"`,
  },

  status: {
    kicker: "Reliability",
    title: "Status",
    subtitle:
      "Live health of every managed workload across the cluster.",
    loading: "Loading…",
    loadError: (e: string) => `Could not load status: ${e}`,
    updatedAgo: (t: string) => `Updated ${t}`,
    showingLastKnown: (e: string) =>
      `Showing last known status — refresh failed: ${e}`,
    allOperational: "All systems operational",
    partialDegradation: "Partial degradation",
    majorOutage: "Major outage",
    healthySummary: (h: number, total: number) =>
      `${h}/${total} components healthy`,
    degradedCount: (n: number) => `${n} degraded`,
    uptimeWindow: (h: number) => `uptime over last ${h}h`,
    activeIncidents: (n: number) => `Active incidents · ${n}`,
    colComponent: "Component",
    colStatus: "Status",
    colReplicas: "Replicas",
    colUptime: (h: number) => `Uptime (${h}h)`,
    incidentHistory: "Incident history",
    noIncidents: "No incidents",
    noIncidentsBody: (h: number) =>
      `Every component stayed operational over the last ${h}h.`,
    downFor: (d: string) => `down for ${d}`,
    since: (t: string) => `since ${t}`,
    colStarted: "Started",
    colDuration: "Duration",
    ongoing: "ongoing",
    components: (n: number) => `${n} component${n === 1 ? "" : "s"}`,
    statusOperational: "Operational",
    statusProgressing: "Progressing",
    statusDegraded: "Degraded",
    statusUnknown: "Unknown",
    services: "Services",
    statefulSets: "Stateful",
  },

  logs: {
    searchPlaceholder: "search logs…",
    searchBtn: "Search",
    regexToggleLabel: "Regex",
    regexToggleTitle: "Switch to regex mode (LogQL |~ \"...\")",
    regexInvalid: "Invalid regex",
    timespanLabel: "Time range",
    last5m: "Last 5 min",
    last15m: "Last 15 min",
    last1h: "Last 1 hour",
    last6h: "Last 6 hours",
    last24h: "Last 24 hours",
    last3d: "Last 3 days",
    last7d: "Last 7 days",
    customRange: "Custom range",
    fromLabel: "From",
    toLabel: "To",
    liveBtn: "Live",
    historicalBtn: "Historical",
    clearBtn: "Clear",
    followLabel: "follow",
    lineCount: (n: number) => `${n} line${n === 1 ? "" : "s"}`,
    matchCount: (n: number) => `${n} match${n === 1 ? "" : "es"}`,
    waitingOutput: "Waiting for log output…",
    noLines: "No log lines.",
    streamDropped: "stream dropped — toggle live/historical to retry",
    lokiError: "Loki error — check console",
    // ── Grafana-like extras ──
    levelError: "Error",
    levelWarn: "Warn",
    levelInfo: "Info",
    levelDebug: "Debug",
    levelOther: "Other",
    allPods: (n: number) => `All pods (${n})`,
    podsSelected: (n: number) => `${n} pods`,
    histogramToggle: "Toggle histogram",
    histogramBucket: (start: string, end: string, total: number) =>
      `${start} – ${end}\nTotal: ${total}`,
    copyBtn: "Copy",
    copied: "Copied",
    exportTxt: "Download text (.txt)",
    exportJson: "Download JSON (.json)",
    exportLabel: "Export",
  },

  common: {
    loading: "Loading…",
    refresh: "Refresh",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    prev: "Prev",
    next: "Next",
    unknown: "—",
  },

  // ── RBAC page ─────────────────────────────────────────────────────────────
  rbac: {
    kicker: "Security",
    title: "Permission Management",
    subtitle:
      "Manage the permission matrix per role. Super admin permissions are locked.",
    colPermission: "Permission",
    colDeveloper: "Developer",
    colAdmin: "Admin",
    colSuperAdmin: "Super Admin",
    colDefault: "default",
    colOverride: "override",
    resetToDefault: "Reset to default",
    accessDenied: "Access denied — this page is for super admins only.",
    loading: "Loading…",
    toastSaved: (key: string, role: string, v: string) =>
      `${role} / ${key} → ${v}`,
    toastReset: (key: string, role: string) =>
      `${role} / ${key} reset to default`,
    categoryWorkloads: "Workloads",
    categoryInfrastructure: "Infrastructure",
    categoryCiCd: "CI/CD",
    categoryStorage: "Storage",
    categoryAdministration: "Administration",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Dictionary map
// ─────────────────────────────────────────────────────────────────────────────

const DICT: Record<Lang, Translations> = { tr, en };

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "lang";

type LangCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
};

const LangContext = createContext<LangCtx>({
  lang: "en",
  setLang: () => {},
  t: en,
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Hydrate from localStorage on mount (client-only).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (stored === "tr" || stored === "en") {
        setLangState(stored);
      }
    } catch {
      /* localStorage blocked */
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* localStorage blocked */
    }
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang, t: DICT[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the full translation object for the active language. */
export function useT(): Translations {
  return useContext(LangContext).t;
}

/** Returns { lang, setLang }. */
export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const { lang, setLang } = useContext(LangContext);
  return { lang, setLang };
}
