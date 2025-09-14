/**
 * Backend: Express + Mongoose (Enhanced)
 * - Optional S3 uploads (USE_S3=true)
 * - Bulk ZIP upload endpoint: extracts files, creates Game entries (requires admin)
 * - Admin user management, comment moderation, analytics endpoints
 * - CSP and security via helmet and appropriate headers
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const AdmZip = require('adm-zip');
const AWS = require('aws-sdk');

const app = express();
app.use(helmet());
// Add CSP that allows iframes only from self (can be tweaked)
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'self';"); 
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(cors());

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/learning_games';
mongoose.connect(MONGODB_URI);

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const USE_S3 = process.env.USE_S3 === 'true';
let s3;
if (USE_S3) {
  s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
  });
}

// Multer config
const upload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// Rate limiter
const limiter = rateLimit({ windowMs: 15*60*1000, max: 300 });
app.use(limiter);

// Schemas
const UserSchema = new mongoose.Schema({ email: String, passwordHash: String, role: { type: String, default: 'user' }, favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Game' }] });
const User = mongoose.model('User', UserSchema);

const CommentSchema = new mongoose.Schema({ userId: mongoose.ObjectId, userEmail: String, text: String, createdAt: { type: Date, default: Date.now }, approved: { type: Boolean, default: false } });
const RatingSchema = new mongoose.Schema({ userId: mongoose.ObjectId, score: Number });
const QuizSchema = new mongoose.Schema({ question: String, options: [String], answerIndex: Number });

const GameSchema = new mongoose.Schema({
  title: String,
  description: String,
  category: String,
  tags: [String],
  filePath: String,
  lesson: { title: String, content: String },
  quizzes: [QuizSchema],
  ratings: [RatingSchema],
  comments: [CommentSchema],
  leaderboard: [{ userId: mongoose.ObjectId, name: String, score: Number, createdAt: Date }],
  createdAt: { type: Date, default: Date.now }
});
const Game = mongoose.model('Game', GameSchema);

// JWT
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
function createToken(user) { return jwt.sign({ id: user._id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' }); }
function authMiddleware(req,res,next){
  const auth = req.headers.authorization?.split(' ')[1];
  if(!auth) return res.status(401).send({ error: 'Unauthorized' });
  try { req.user = jwt.verify(auth, JWT_SECRET); next(); } catch(e){ res.status(401).send({ error: 'Invalid token' }); }
}

// Auth
app.post('/api/signup', async (req,res) => {
  const { email, password } = req.body;
  if(!email || !password) return res.status(400).send({ error: 'Missing' });
  const existing = await User.findOne({ email });
  if(existing) return res.status(400).send({ error: 'User exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, passwordHash });
  res.send({ token: createToken(user), role: user.role });
});

app.post('/api/login', async (req,res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if(!user) return res.status(400).send({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if(!ok) return res.status(400).send({ error: 'Invalid credentials' });
  res.send({ token: createToken(user), role: user.role });
});

// Serve uploaded game files (if not using S3)
if(!USE_S3){
  app.use('/games/files', express.static(uploadDir));
}

// Public: search + list
app.get('/api/games', async (req,res) => {
  const { q, tag, category, page=1, limit=30 } = req.query;
  const filter = {};
  if(tag) filter.tags = tag;
  if(category) filter.category = category;
  if(q) filter.$or = [{ title: new RegExp(q,'i') }, { description: new RegExp(q,'i') }, { 'lesson.content': new RegExp(q,'i') }];
  const games = await Game.find(filter).skip((page-1)*limit).limit(parseInt(limit)).sort({ createdAt: -1 });
  res.send(games);
});

app.get('/api/games/:id', async (req,res) => {
  const g = await Game.findById(req.params.id);
  if(!g) return res.status(404).send({ error: 'Not found' });
  res.send(g);
});

// Quiz submission
app.post('/api/games/:id/quiz', async (req,res) => {
  const { answers } = req.body;
  const g = await Game.findById(req.params.id);
  if(!g) return res.status(404).send({ error: 'Not found' });
  let score = 0;
  g.quizzes.forEach((q,i)=>{ if(answers[i] === q.answerIndex) score++; });
  res.send({ score, total: g.quizzes.length });
});

// Ratings
app.post('/api/games/:id/rate', authMiddleware, async (req,res) => {
  const { score } = req.body;
  const g = await Game.findById(req.params.id);
  if(!g) return res.status(404).send({ error: 'Not found' });
  g.ratings = g.ratings.filter(r => String(r.userId) !== String(req.user.id));
  g.ratings.push({ userId: req.user.id, score });
  await g.save();
  res.send({ ok: true, average: g.ratings.reduce((s,x)=>s+x.score,0)/g.ratings.length });
});

// Comments (moderated)
app.post('/api/games/:id/comment', authMiddleware, async (req,res) => {
  const { text } = req.body;
  const g = await Game.findById(req.params.id);
  if(!g) return res.status(404).send({ error: 'Not found' });
  g.comments.push({ userId: req.user.id, userEmail: req.user.email, text, approved: false });
  await g.save();
  res.send({ ok: true });
});

// Favorites
app.post('/api/games/:id/favorite', authMiddleware, async (req,res) => {
  const user = await User.findById(req.user.id);
  const gid = req.params.id;
  if(user.favorites.find(f => String(f) === gid)) {
    user.favorites = user.favorites.filter(f => String(f) !== gid);
  } else {
    user.favorites.push(gid);
  }
  await user.save();
  res.send({ favorites: user.favorites });
});

// Leaderboard submit
app.post('/api/games/:id/leaderboard', authMiddleware, async (req,res) => {
  const { name, score } = req.body;
  const g = await Game.findById(req.params.id);
  if(!g) return res.status(404).send({ error: 'Not found' });
  g.leaderboard.push({ userId: req.user.id, name, score, createdAt: new Date() });
  g.leaderboard = g.leaderboard.sort((a,b)=>b.score - a.score).slice(0,100);
  await g.save();
  res.send({ ok: true, leaderboard: g.leaderboard.slice(0,10) });
});

// Admin: upload single game or bulk (zip)
app.post('/api/admin/games', authMiddleware, upload.single('gameFile'), async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  const { title, description, category, tags, lessonTitle, lessonContent, quizzes } = req.body;
  const parsedTags = (tags||'').split(',').map(t=>t.trim()).filter(Boolean);
  const parsedQuizzes = quizzes ? JSON.parse(quizzes) : [];
  let filePath = '';
  if(req.file){
    if(USE_S3){
      // upload to s3 (simple example)
      const fileStream = fs.createReadStream(req.file.path);
      const params = { Bucket: process.env.AWS_BUCKET, Key: req.file.filename, Body: fileStream, ACL: 'public-read' };
      await s3.upload(params).promise();
      filePath = `https://${process.env.AWS_BUCKET}.s3.amazonaws.com/${req.file.filename}`;
      fs.unlinkSync(req.file.path);
    } else {
      filePath = `/games/files/${req.file.filename}`;
    }
  }
  const g = await Game.create({ title, description, category, tags: parsedTags, filePath, lesson: { title: lessonTitle, content: lessonContent }, quizzes: parsedQuizzes });
  res.send(g);
});

// Admin: bulk ZIP upload endpoint
app.post('/api/admin/bulk-upload', authMiddleware, upload.single('zipFile'), async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  if(!req.file) return res.status(400).send({ error: 'No file' });
  try{
    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries();
    // Expect structure: each game in folder with index.html and metadata.json (metadata.json includes title, description, etc.)
    const created = [];
    for(const entry of entries){
      if(entry.isDirectory) continue;
      const parts = entry.entryName.split('/');
      if(parts.length>=2 && parts[parts.length-1] === 'metadata.json'){
        const folder = parts.slice(0, -1).join('/');
        const metaRaw = zip.readAsText(entry);
        let meta;
        try{ meta = JSON.parse(metaRaw); } catch(e){ continue; }
        // extract all files for this folder
        const targetFolder = path.join(uploadDir, folder + '_' + Date.now());
        fs.mkdirSync(targetFolder, { recursive: true });
        entries.filter(en => en.entryName.startsWith(folder+'/')).forEach(en => {
          const rel = en.entryName.substring(folder.length+1);
          if(en.isDirectory) return;
          const outPath = path.join(targetFolder, rel);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, zip.readFile(en));
        });
        // find index.html file
        const indexPath = Object.keys(fs.readdirSync(targetFolder)).length ? path.join(targetFolder, 'index.html') : null;
        // make a simple filePath (serving folder)
        const serveUrl = `/games/files/${path.basename(targetFolder)}/index.html`;
        // move extracted files into uploads/<basename>
        const destDir = path.join(uploadDir, path.basename(targetFolder));
        fs.renameSync(targetFolder, destDir);
        // create game entry
        const g = await Game.create({
          title: meta.title || 'Untitled', description: meta.description || '', category: meta.category || '',
          tags: meta.tags || [], filePath: serveUrl, lesson: { title: meta.lessonTitle || '', content: meta.lessonContent || '' },
          quizzes: meta.quizzes || []
        });
        created.push(g);
      }
    }
    fs.unlinkSync(req.file.path);
    res.send({ created: created.length, items: created.slice(0,20) });
  } catch(e){
    console.error(e);
    res.status(500).send({ error: 'Failed processing zip' });
  }
});

// Admin: list games
app.get('/api/admin/games', authMiddleware, async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  const list = await Game.find().sort({ createdAt: -1 });
  res.send(list);
});

// Admin: user management (list, change role, delete)
app.get('/api/admin/users', authMiddleware, async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  const users = await User.find().select('-passwordHash').lean();
  res.send(users);
});
app.post('/api/admin/users/:id/role', authMiddleware, async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  const { role } = req.body;
  const u = await User.findById(req.params.id);
  if(!u) return res.status(404).send({ error: 'Not found' });
  u.role = role; await u.save();
  res.send({ ok:true, user: { id: u._id, email: u.email, role: u.role } });
});
app.delete('/api/admin/users/:id', authMiddleware, async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  await User.findByIdAndDelete(req.params.id);
  res.send({ ok:true });
});

// Admin: comments moderation
app.get('/api/admin/comments', authMiddleware, async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  const games = await Game.find({ 'comments.0': { $exists: true } });
  const items = [];
  games.forEach(g => g.comments.forEach(c => items.push({ gameId: g._id, gameTitle: g.title, comment: c })));
  res.send(items);
});
app.post('/api/admin/comments/:gameId/:commentIndex/approve', authMiddleware, async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  const g = await Game.findById(req.params.gameId);
  if(!g) return res.status(404).send({ error: 'Not found' });
  const idx = parseInt(req.params.commentIndex,10);
  if(!g.comments[idx]) return res.status(404).send({ error: 'Comment not found' });
  g.comments[idx].approved = true; await g.save();
  res.send({ ok:true });
});
app.delete('/api/admin/comments/:gameId/:commentIndex', authMiddleware, async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  const g = await Game.findById(req.params.gameId);
  const idx = parseInt(req.params.commentIndex,10);
  g.comments.splice(idx,1); await g.save();
  res.send({ ok:true });
});

// Admin: analytics (basic)
app.get('/api/admin/analytics', authMiddleware, async (req,res) => {
  if(req.user.role !== 'admin') return res.status(403).send({ error: 'Forbidden' });
  const totalGames = await Game.countDocuments();
  const totalUsers = await User.countDocuments();
  const topGames = await Game.find().sort({ 'leaderboard.0.score': -1 }).limit(10).select('title leaderboard');
  res.send({ totalGames, totalUsers, topGames });
});



// SECRET ACCESS: Unlock games by secret password or token stored in cookie/header/query
const GAME_SECRET = process.env.GAME_SECRET || 'skibidi123';
function hasGameAccess(req){
  const auth = req.headers.authorization?.split(' ')[1];
  if(auth){
    try{ const p = jwt.verify(auth, JWT_SECRET); if(p.role==='admin' || p.isPremium) return true; } catch(e){}
  }
  const accessToken = req.cookies?.game_access_token || req.query?.access || req.headers['x-game-access'];
  if(accessToken){
    if(accessToken === GAME_SECRET) return true;
    try{ const payload = jwt.verify(accessToken, JWT_SECRET); if(payload && payload.type === 'game_access') return true; } catch(e){}
  }
  return false;
}

// Unlock endpoint: exchange secret for signed token (also sets cookie)
app.post('/api/unlock', async (req,res) => {
  const { secret } = req.body;
  if(!secret) return res.status(400).send({ error: 'Missing secret' });
  if(secret === GAME_SECRET){
    const token = jwt.sign({ type: 'game_access' }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('game_access_token', token, { httpOnly: false, maxAge: 7*24*3600*1000 });
    res.send({ ok: true, token });
  } else {
    res.status(403).send({ error: 'Wrong secret' });
  }
});

// Modify games routes to check access (if present)
const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=>console.log('Backend listening on', PORT));
