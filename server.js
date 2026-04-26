require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const { db, seedIfEmpty }         = require('./db');
const { authMiddleware, adminOnly } = require('./middleware');

const app    = express();
const SECRET = process.env.JWT_SECRET || 'act4earth_secret';

// ── Multer (in-memory, store as base64 in DB) ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, file.mimetype.startsWith('image/'))
});

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/register', async (req, res) => {
  try {
    const { name, username, password } = req.body;
    const role = 'student'; // semua registrasi baru adalah siswa
    if (!name || !username || !password) return res.status(400).json({ error: 'Semua field wajib diisi' });
    const existing = await db.users.findOne({ username });
    if (existing) return res.status(409).json({ error: 'Username sudah digunakan' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await db.users.insert({
      name, username, role: role || 'student',
      password: hashed, points: 0, exp: 0, level: 1,
      batchHistory: [], createdAt: new Date().toISOString()
    });
    res.json({ message: 'Registrasi berhasil' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.users.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Username tidak ditemukan' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Password salah' });
    const token = jwt.sign({ _id: user._id, name: user.name, role: user.role }, SECRET, { expiresIn: '7d' });
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET current user ──
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: req.user._id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Upload / update foto profil ──
app.put('/api/me/avatar', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    let avatarDataUrl = null;
    if (req.file) {
      avatarDataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    } else if (req.body.avatarDataUrl) {
      avatarDataUrl = req.body.avatarDataUrl;
    } else {
      return res.status(400).json({ error: 'Tidak ada foto yang dikirim' });
    }
    await db.users.update({ _id: req.user._id }, { $set: { avatarDataUrl } });
    res.json({ avatarDataUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ACTIVITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/activities', authMiddleware, async (req, res) => {
  try {
    const acts = await db.activities.find({}).sort({ date: -1 });
    res.json(acts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/activities', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { title, desc, date, points, exp, category } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Judul dan tanggal wajib diisi' });
    const act = await db.activities.insert({ title, desc: desc||'', date, points: +points||10, exp: +exp||50, category: category||'lainnya', createdAt: new Date().toISOString() });
    res.json(act);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/activities/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { title, desc, date, points, exp, category } = req.body;
    await db.activities.update({ _id: req.params.id }, { $set: { title, desc: desc||'', date, points: +points, exp: +exp, category: category||'lainnya' } });
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/activities/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.activities.remove({ _id: req.params.id });
    await db.reports.remove({ activityId: req.params.id }, { multi: true });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  REPORTS (Laporan Aktivitas)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/reports', authMiddleware, async (req, res) => {
  try {
    const query = req.user.role === 'student' ? { userId: req.user._id } : {};
    const reports = await db.reports.find(query).sort({ date: -1 });
    res.json(reports);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reports', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    const { activityId, notes } = req.body;
    if (!notes?.trim()) return res.status(400).json({ error: 'Catatan wajib diisi' });
    const existing = await db.reports.findOne({ activityId, userId: req.user._id });
    if (existing) return res.status(409).json({ error: 'Sudah melaporkan aktivitas ini' });
    const photoDataUrl = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    const report = await db.reports.insert({
      userId: req.user._id, userName: req.user.name,
      activityId, notes, photoDataUrl,
      status: 'pending', teacherMsg: '', date: new Date().toISOString()
    });
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/reports/:id/verify', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { action, msg } = req.body; // action: 'approve'|'reject'
    const report = await db.reports.findOne({ _id: req.params.id });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const act    = await db.activities.findOne({ _id: report.activityId });
    const status = (action === 'approve' || action === 'approved') ? 'approved' : 'rejected';
    await db.reports.update({ _id: req.params.id }, { $set: { status, teacherMsg: msg||'' } });

    if ((action === 'approve' || action === 'approved') && act) {
      const student = await db.users.findOne({ _id: report.userId });
      if (student) {
        const newExp    = student.exp + act.exp;
        const expPtsBonus = Math.floor(newExp / 100) - Math.floor(student.exp / 100); // +1 pt per 100 EXP crossed
        const newPoints = student.points + act.points + expPtsBonus;
        const newLevel  = Math.floor(newExp / 500) + 1; // 500 EXP per level
        const levelUpPts = Math.max(0, newLevel - student.level); // bonus point on level up
        const finalPoints = newPoints + levelUpPts;
        await db.users.update({ _id: student._id }, { $set: { exp: newExp, points: finalPoints, level: newLevel } });
      }
      await db.notifications.insert({
        userId: report.userId, type: 'report_approved',
        title: 'Laporan Disetujui!',
        body: `Laporanmu untuk "${act.title}" disetujui. +${act.points} poin & +${act.exp} EXP!${msg ? '\nPesan: ' + msg : ''}`,
        read: false, createdAt: new Date().toISOString()
      });
    } else {
      await db.notifications.insert({
        userId: report.userId, type: 'report_rejected',
        title: 'Laporan Ditolak',
        body: `Laporanmu untuk "${act?.title}" ditolak.${msg ? '\nPesan: ' + msg : ''}`,
        read: false, createdAt: new Date().toISOString()
      });
    }
    res.json({ message: 'Verified' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  REWARDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/rewards', authMiddleware, async (req, res) => {
  try {
    const rewards = await db.rewards.find({});
    res.json(rewards);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rewards', authMiddleware, adminOnly, upload.single('photo'), async (req, res) => {
  try {
    const { name, desc, cost, stock, category, icon } = req.body;
    if (!name || !cost) return res.status(400).json({ error: 'Nama dan biaya wajib diisi' });
    const photoDataUrl = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : (req.body.photoDataUrl || null);
    const reward = await db.rewards.insert({ name, desc: desc||'', cost: +cost, stock: +stock||0, category: category||'hiburan', icon: icon||'🎁', photoDataUrl, createdAt: new Date().toISOString() });
    res.json(reward);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/rewards/:id', authMiddleware, adminOnly, upload.single('photo'), async (req, res) => {
  try {
    const { name, desc, cost, stock, category, icon } = req.body;
    const update = { name, desc: desc||'', cost: +cost, stock: +stock||0, category: category||'hiburan', icon: icon||'🎁' };
    if (req.file) update.photoDataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    else if (req.body.photoDataUrl) update.photoDataUrl = req.body.photoDataUrl;
    await db.rewards.update({ _id: req.params.id }, { $set: update });
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/rewards/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.rewards.remove({ _id: req.params.id });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  REWARD CLAIMS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/claims', authMiddleware, async (req, res) => {
  try {
    const query = req.user.role === 'student' ? { userId: req.user._id } : {};
    const claims = await db.rewardClaims.find(query).sort({ date: -1 });
    res.json(claims);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/claims', authMiddleware, async (req, res) => {
  try {
    const { rewardId } = req.body;
    const reward  = await db.rewards.findOne({ _id: rewardId });
    if (!reward) return res.status(404).json({ error: 'Reward not found' });
    const student = await db.users.findOne({ _id: req.user._id });
    if (student.points < reward.cost) return res.status(400).json({ error: 'Poin tidak cukup' });
    await db.users.update({ _id: student._id }, { $set: { points: student.points - reward.cost } });
    const claim = await db.rewardClaims.insert({
      userId: req.user._id, userName: req.user.name,
      rewardId, rewardName: reward.name,
      status: 'pending', adminMsg: '', date: new Date().toISOString()
    });
    res.json(claim);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/claims/:id/verify', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { action, msg } = req.body;
    const claim  = await db.rewardClaims.findOne({ _id: req.params.id });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    const reward = await db.rewards.findOne({ _id: claim.rewardId });
    const status = (action === 'approve' || action === 'approved') ? 'approved' : 'rejected';
    await db.rewardClaims.update({ _id: req.params.id }, { $set: { status, adminMsg: msg||'' } });

    if (action === 'approve' || action === 'approved') {
      if (reward && reward.stock > 0) await db.rewards.update({ _id: reward._id }, { $set: { stock: reward.stock - 1 } });
      await db.notifications.insert({
        userId: claim.userId, type: 'claim_approved',
        title: 'Klaim Hadiah Disetujui!',
        body: `Klaim "${claim.rewardName}" dikonfirmasi!${msg ? '\n' + msg : '\nHubungi guru untuk mengambil.'}`,
        read: false, createdAt: new Date().toISOString()
      });
    } else {
      // Refund
      const stu = await db.users.findOne({ _id: claim.userId });
      if (stu && reward) await db.users.update({ _id: stu._id }, { $set: { points: stu.points + reward.cost } });
      await db.notifications.insert({
        userId: claim.userId, type: 'claim_rejected',
        title: 'Klaim Hadiah Ditolak',
        body: `Klaim "${claim.rewardName}" ditolak. Poin dikembalikan.${msg ? '\nAlasan: ' + msg : ''}`,
        read: false, createdAt: new Date().toISOString()
      });
    }
    res.json({ message: 'Verified' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BATCH LEVEL UP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/batches', authMiddleware, adminOnly, async (req, res) => {
  try {
    const batches = await db.levelUpBatches.find({}).sort({ createdAt: -1 });
    res.json(batches);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/batches', authMiddleware, adminOnly, upload.single('photo'), async (req, res) => {
  try {
    const { expBonus, pointsBonus, msg, studentIds } = req.body;
    const ids = typeof studentIds === 'string' ? JSON.parse(studentIds) : studentIds;
    const photoDataUrl = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : (req.body.photoDataUrl||null);
    const batch = await db.levelUpBatches.insert({
      photoDataUrl, expBonus: +expBonus||0, pointsBonus: +pointsBonus||0,
      msg: msg||'', studentIds: ids||[], processed: false,
      createdAt: new Date().toISOString()
    });
    res.json(batch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/batches/:id', authMiddleware, adminOnly, upload.single('photo'), async (req, res) => {
  try {
    const batch = await db.levelUpBatches.findOne({ _id: req.params.id });
    if (!batch || batch.processed) return res.status(400).json({ error: 'Tidak bisa edit batch yang sudah diproses' });
    const { expBonus, pointsBonus, msg, studentIds } = req.body;
    const ids = typeof studentIds === 'string' ? JSON.parse(studentIds) : studentIds;
    const update = { expBonus: +expBonus||0, pointsBonus: +pointsBonus||0, msg: msg||'', studentIds: ids||[] };
    if (req.file) update.photoDataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    else if (req.body.photoDataUrl) update.photoDataUrl = req.body.photoDataUrl;
    await db.levelUpBatches.update({ _id: req.params.id }, { $set: update });
    res.json({ message: 'Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/batches/:id/process', authMiddleware, adminOnly, async (req, res) => {
  try {
    const batch = await db.levelUpBatches.findOne({ _id: req.params.id });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (batch.processed) return res.status(400).json({ error: 'Sudah diproses' });

    let count = 0;
    for (const sid of (batch.studentIds || [])) {
      const stu = await db.users.findOne({ _id: sid });
      if (!stu) continue;
      const oldLevel  = stu.level;
      const newExp    = stu.exp + batch.expBonus;
      const newPoints = stu.points + batch.pointsBonus;
      const newLevel  = Math.floor(newExp / 500) + 1; // 500 EXP per level
      if (newLevel > oldLevel) count++;
      const historyEntry = {
        batchId: batch._id, date: new Date().toISOString(),
        expBonus: batch.expBonus, pointsBonus: batch.pointsBonus,
        photoDataUrl: batch.photoDataUrl || null, msg: batch.msg || '',
        levelBefore: oldLevel, levelAfter: newLevel
      };
      await db.users.update({ _id: sid }, {
        $set: { exp: newExp, points: newPoints, level: newLevel },
        $push: { batchHistory: historyEntry }
      });
      const lc = newLevel > oldLevel;
      await db.notifications.insert({
        userId: sid, type: 'level_up_batch',
        title: lc ? `Naik Level! (Lv.${oldLevel} ke Lv.${newLevel})` : 'Bonus EXP & Poin Diterima!',
        body: `${batch.msg ? batch.msg + '\n\n' : ''}+${batch.expBonus} EXP & +${batch.pointsBonus} poin.${lc ? '\nLevel naik dari ' + oldLevel + ' ke ' + newLevel + '!' : ''}`,
        read: false, createdAt: new Date().toISOString()
      });
    }
    await db.levelUpBatches.update({ _id: req.params.id }, { $set: { processed: true, processedAt: new Date().toISOString() } });
    res.json({ message: `Batch diproses. ${batch.studentIds.length} siswa, ${count} naik level.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/batches/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.levelUpBatches.remove({ _id: req.params.id });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NOTIFICATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const notifs = await db.notifications.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(notifs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    await db.notifications.update({ userId: req.user._id, read: false }, { $set: { read: true } }, { multi: true });
    res.json({ message: 'All read' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  STUDENTS LIST (admin)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/students', authMiddleware, adminOnly, async (req, res) => {
  try {
    const students = await db.users.find({ role: 'student' });
    res.json(students.map(({ password: _, ...s }) => s));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPA fallback ──
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──
const PORT = process.env.PORT || 3000;

seedIfEmpty().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌿 Act4Earth running on port ${PORT}`);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GAME POINTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/game/points', authMiddleware, async (req, res) => {
  try {
    const { score } = req.body;
    const earnedPts = Math.floor(score / 100) * 1;   // 100 score = 1 poin
    const earnedExp = Math.floor(score / 100) * 10;   // 100 score = 10 EXP
    if (earnedPts <= 0 && earnedExp <= 0) return res.status(400).json({ error: 'Skor belum cukup' });
    const user = await db.users.findOne({ _id: req.user._id });
    const newExp = user.exp + earnedExp;
    const expPtsBonus = Math.floor(newExp / 100) - Math.floor(user.exp / 100);
    const newPoints = user.points + earnedPts + expPtsBonus;
    const newLevel  = Math.floor(newExp / 500) + 1;
    const levelUpPts = Math.max(0, newLevel - user.level);
    const finalPoints = newPoints + levelUpPts;
    await db.users.update({ _id: req.user._id }, { $set: { points: finalPoints, exp: newExp, level: newLevel } });
    await db.notifications.insert({
      userId: req.user._id, type: 'game_points',
      title: '🎮 Reward Game Diterima!',
      body: `Skor ${score} → +${earnedPts} poin & +${earnedExp} EXP!${levelUpPts > 0 ? '\n🎉 Level up! +' + levelUpPts + ' bonus poin.' : ''}`,
      read: false, createdAt: new Date().toISOString()
    });
    res.json({ earnedPts, earnedExp, finalPoints, newLevel });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

