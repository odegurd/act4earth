require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI tidak ditemukan di environment variables!');

let client;
let _db;

async function connectDB() {
  if (_db) return _db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  _db = client.db('act4earth');
  console.log('✅ Terhubung ke MongoDB Atlas');
  return _db;
}

// ─── Wrapper agar API tetap sama seperti NeDB ───────────────────────────────
// NeDB pakai _id string, MongoDB pakai ObjectId.
// Supaya kode server.js tidak perlu banyak diubah,
// kita buat wrapper ringan yang meniru API NeDB (find, findOne, insert, update, remove).

const { ObjectId } = require('mongodb');

function toObjectId(id) {
  try { return new ObjectId(id); } catch { return id; }
}

// Ganti _id string → ObjectId di query
function normalizeQuery(query) {
  if (!query) return {};
  const q = { ...query };
  if (q._id && typeof q._id === 'string') q._id = toObjectId(q._id);
  // handle nested fields seperti { userId: '...' } yang merupakan string biasa (bukan ObjectId)
  return q;
}

// Setelah insert/findOne/find, kembalikan _id sebagai string
function normalizeDoc(doc) {
  if (!doc) return null;
  return { ...doc, _id: doc._id?.toString() };
}

function makeCollection(name) {
  return {
    async find(query = {}, options = {}) {
      const mdb = await connectDB();
      let cursor = mdb.collection(name).find(normalizeQuery(query));
      if (options.sort) cursor = cursor.sort(options.sort);
      const docs = await cursor.toArray();
      return docs.map(normalizeDoc);
    },

    // Rantai .sort() seperti NeDB: db.users.find({}).sort({ date: -1 })
    findChain(query = {}) {
      let _sort = null;
      const chain = {
        sort(s) { _sort = s; return chain; },
        async then(resolve, reject) {
          try {
            const mdb = await connectDB();
            let cursor = mdb.collection(name).find(normalizeQuery(query));
            if (_sort) cursor = cursor.sort(_sort);
            const docs = await cursor.toArray();
            resolve(docs.map(normalizeDoc));
          } catch (e) { reject(e); }
        }
      };
      return chain;
    },

    async findOne(query = {}) {
      const mdb = await connectDB();
      const doc = await mdb.collection(name).findOne(normalizeQuery(query));
      return normalizeDoc(doc);
    },

    async insert(docOrDocs) {
      const mdb = await connectDB();
      if (Array.isArray(docOrDocs)) {
        const result = await mdb.collection(name).insertMany(docOrDocs);
        const ids = Object.values(result.insertedIds);
        return docOrDocs.map((d, i) => normalizeDoc({ ...d, _id: ids[i] }));
      }
      const result = await mdb.collection(name).insertOne(docOrDocs);
      return normalizeDoc({ ...docOrDocs, _id: result.insertedId });
    },

    async update(query, update, options = {}) {
      const mdb = await connectDB();
      const mongoUpdate = {};
      if (update.$set)  mongoUpdate.$set  = update.$set;
      if (update.$push) mongoUpdate.$push = update.$push;
      if (update.$inc)  mongoUpdate.$inc  = update.$inc;
      // Kalau update tidak punya operator, anggap full replace dengan $set
      if (!update.$set && !update.$push && !update.$inc) {
        mongoUpdate.$set = update;
      }
      if (options.multi) {
        return mdb.collection(name).updateMany(normalizeQuery(query), mongoUpdate);
      }
      return mdb.collection(name).updateOne(normalizeQuery(query), mongoUpdate);
    },

    async remove(query = {}, options = {}) {
      const mdb = await connectDB();
      if (options.multi) {
        return mdb.collection(name).deleteMany(normalizeQuery(query));
      }
      return mdb.collection(name).deleteOne(normalizeQuery(query));
    },

    async count(query = {}) {
      const mdb = await connectDB();
      return mdb.collection(name).countDocuments(normalizeQuery(query));
    }
  };
}

// Buat proxy agar db.users.find({}).sort() tetap berfungsi
function makeProxy(name) {
  const col = makeCollection(name);
  return new Proxy(col, {
    get(target, prop) {
      if (prop === 'find') {
        // Kembalikan fungsi yang hasilnya bisa di-.sort() atau di-await langsung
        return (query = {}) => {
          let _sort = null;
          const thenable = {
            sort(s) { _sort = s; return thenable; },
            then(resolve, reject) {
              (async () => {
                try {
                  const mdb = await connectDB();
                  let cursor = mdb.collection(name).find(normalizeQuery(query));
                  if (_sort) cursor = cursor.sort(_sort);
                  const docs = await cursor.toArray();
                  resolve(docs.map(normalizeDoc));
                } catch (e) { reject(e); }
              })();
            }
          };
          return thenable;
        };
      }
      return target[prop];
    }
  });
}

const db = {
  users:          makeProxy('users'),
  activities:     makeProxy('activities'),
  reports:        makeProxy('reports'),
  rewards:        makeProxy('rewards'),
  rewardClaims:   makeProxy('rewardClaims'),
  notifications:  makeProxy('notifications'),
  levelUpBatches: makeProxy('levelUpBatches'),
};

// ─── Seed data awal jika DB kosong ──────────────────────────────────────────
async function seedIfEmpty() {
  const count = await db.users.count({});
  if (count > 0) return;

  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  await db.users.insert({
    name: 'Admin', username: 'admin', role: 'teacher',
    password: await bcrypt.hash('admin123', 10),
    points: 0, exp: 0, level: 1, batchHistory: [],
    createdAt: new Date().toISOString()
  });

  await db.users.insert({
    name: 'Budi Santoso', username: 'budi', role: 'student',
    password: await bcrypt.hash('budi123', 10),
    points: 0, exp: 0, level: 1, batchHistory: [],
    createdAt: new Date().toISOString()
  });

  await db.activities.insert([
    { title: 'Menanam Kecambah', desc: 'Tanam benih kecambah dan foto hasilnya.',  date: today,    points: 20, exp: 80,  category: 'akademik' },
    { title: 'Menyiram Tanaman', desc: 'Siram tanaman di rumah minimal 3 pot.',     date: today,    points: 15, exp: 50,  category: 'olahraga' },
    { title: 'Buat Kompos Mini',  desc: 'Buat kompos dari sisa dapur keluarga.',    date: tomorrow, points: 25, exp: 100, category: 'sosial'   },
  ]);

  await db.rewards.insert([
    { name: 'Sapu',     icon: '🧹', desc: 'Sapu lantai kelas.',      cost: 20, category: 'peralatan', stock: 5,  photoDataUrl: null },
    { name: 'Kelereng', icon: '⚪', desc: 'Kelereng warna-warni.',    cost: 20, category: 'mainan',    stock: 10, photoDataUrl: null },
    { name: 'Kompyeng', icon: '🎯', desc: 'Kompyeng tradisional.',    cost: 20, category: 'mainan',    stock: 8,  photoDataUrl: null },
    { name: 'Lap',      icon: '🧽', desc: 'Lap bersih untuk meja.',   cost: 20, category: 'peralatan', stock: 15, photoDataUrl: null },
  ]);

  console.log('✅ Database seeded dengan data demo');
  console.log('   Admin  → username: admin  / password: admin123');
  console.log('   Siswa  → username: budi   / password: budi123');
}

module.exports = { db, seedIfEmpty, connectDB };
