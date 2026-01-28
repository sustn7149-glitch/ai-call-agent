const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 녹취 파일 저장 경로 설정 (프로젝트 루트의 recordings 폴더)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.RECORDINGS_PATH || path.join(__dirname, "../../recordings");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("audio/") || file.originalname.match(/\.(m4a|mp3|wav|amr|aac|3gp)$/)) {
    cb(null, true);
  } else {
    cb(new Error("오디오 파일만 업로드 가능합니다."), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }
});

module.exports = upload;
