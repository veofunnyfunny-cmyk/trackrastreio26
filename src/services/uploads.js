// Upload de imagens (logo da loja) usando multer.
// As imagens são salvas no disco persistente (DATA_DIR/uploads), então
// sobrevivem a reinícios/deploys no Render.

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const m = (file.originalname || '').toLowerCase().match(/\.(png|jpg|jpeg|webp|gif|svg)$/);
    const ext = m ? m[0] : '.png';
    cb(null, `logo_${req.user.id}${ext}`);
  },
});

const uploadLogo = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Envie um arquivo de imagem.'));
  },
}).single('logo');

module.exports = { UPLOAD_DIR, uploadLogo };
