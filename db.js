require('./db')
const Datastore = require('nedb-promises');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_DIR = path.join(__dirname, 'data');
require('fs').mkdirSync(DB_DIR, { recursive: true });

const db = {
  users:         Datastore.create({ filename: path.join(DB_DIR, 'users.db'),         autoload: true }),
  activities:    Datastore.create({ filename: path.join(DB_DIR, 'activities.db'),    autoload: true }),
  reports:       Datastore.create({ filename: path.join(DB_DIR, 'reports.db'),       autoload: true }),
  rewards:       Datastore.create({ filename: path.join(DB_DIR, 'rewards.db'),       autoload: true }),
  rewardClaims:  Datastore.create({ filename: path.join(DB_DIR, 'rewardClaims.db'), autoload: true }),
  notifications: Datastore.create({ filename: path.join(DB_DIR, 'notifications.db'),autoload: true }),
  levelUpBatches:Datastore.create({ filename: path.join(DB_DIR, 'levelUpBatches.db'),autoload: true }),
};

async function seedIfEmpty() {
  const count = await db.users.count({});
  if (count > 0) return;

  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  // Seed admin
  await db.users.insert({
    name: 'Admin', username: 'admin', role: 'teacher',
    password: await bcrypt.hash('admin123', 10),
    points: 0, exp: 0, level: 1, batchHistory: [],
    createdAt: new Date().toISOString()
  });

  // Seed student
  await db.users.insert({
    name: 'Budi Santoso', username: 'budi', role: 'student',
    password: await bcrypt.hash('budi123', 10),
    points: 0, exp: 0, level: 1, batchHistory: [],
    createdAt: new Date().toISOString()
  });

  // Seed activities
  await db.activities.insert([
    { title: 'Menanam Kecambah', desc: 'Tanam benih kecambah dan foto hasilnya.',  date: today,    points: 20, exp: 80,  category: 'akademik' },
    { title: 'Menyiram Tanaman', desc: 'Siram tanaman di rumah minimal 3 pot.',     date: today,    points: 15, exp: 50,  category: 'olahraga' },
    { title: 'Buat Kompos Mini',  desc: 'Buat kompos dari sisa dapur keluarga.',    date: tomorrow, points: 25, exp: 100, category: 'sosial'   },
  ]);

  // Seed rewards
  await db.rewards.insert([
    { name: 'Sapu',     icon: '🧹', desc: 'Sapu lantai kelas.',       cost: 20, category: 'peralatan', stock: 5,  photoDataUrl: null },
    { name: 'Kelereng', icon: '⚪', desc: 'Kelereng warna-warni.',     cost: 20, category: 'mainan',    stock: 10, photoDataUrl: null },
    { name: 'Kompyeng', icon: '🎯', desc: 'Kompyeng tradisional.',     cost: 20, category: 'mainan',    stock: 8,  photoDataUrl: null },
    { name: 'Lap',      icon: '🧽', desc: 'Lap bersih untuk meja.',    cost: 20, category: 'peralatan', stock: 15, photoDataUrl: null },
  ]);

  console.log('✅ Database seeded with demo data');
  console.log('   Admin  → username: admin   / password: admin123');
  console.log('   Siswa  → username: budi    / password: budi123');
}

module.exports = { db, seedIfEmpty };
