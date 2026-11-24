const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

// =====================================================================
// BẠN TỰ KHAI BÁO TÊN VÀ ĐƯỜNG DẪN ẢNH MẪU TẠI ĐÂY
// Có thể cho 1 người nhiều ảnh để AI nhận diện chính xác hơn
// =====================================================================
const REFERENCE_FACES = [
  {
    name: 'Huy',
    images: ['faces/huy.jpg']
  },
  {
    name: 'khang',
    images: ['faces/khang.jpg']
  },
  {
    name: 'long',
    images: ['faces/long.jpg']
  },
  {
    name: 'hùng',
    images: ['faces/hùng.jpg']
  },
  {
    name: 'văn',
    images: ['faces/văn.jpg']
  },
  {
    name: 'tuấn',
    images: ['faces/tuấn.jpg']
  },
  {
    name: 'giao',
    images: ['faces/giao.jpg']
  },
  {
    name: 'chương',
    images: ['faces/chương.jpg']
  },
  {
    name: 'thùy',
    images: ['faces/thùy.jpg']
  },
   {
    name: 'JohnWeak',
    images: ['faces/JohnWeak.jpg']
  },
];

let labeledDescriptors = {}; // Lưu vector đặc trưng theo tên (viết thường)
let stream = null;
let scanInterval = null;

async function initSystem() {
  const statusEl = document.getElementById('model-status');
  try {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);

    // Đọc từng ảnh mẫu bạn đã cung cấp và trích xuất đặc trưng
    for (const person of REFERENCE_FACES) {
      const descriptors = [];
      for (const imgPath of person.images) {
        try {
          const img = await faceapi.fetchImage(imgPath);
          const detection = await faceapi.detectSingleFace(img)
            .withFaceLandmarks()
            .withFaceDescriptor();

          if (detection) {
            descriptors.push(detection.descriptor);
          } else {
            console.warn(`Không thấy mặt rõ trong ảnh: ${imgPath}`);
          }
        } catch (imgErr) {
          console.warn(`Không tải được ảnh: ${imgPath}`, imgErr);
          alert(`Lỗi tải ảnh ${imgPath}: ` + (imgErr.message || imgErr));
        }
      }

      if (descriptors.length > 0) {
        labeledDescriptors[person.name.trim().toLowerCase()] = {
          displayName: person.name.trim(),
          descriptors
        };
      } else {
        alert(`Không phát hiện khuôn mặt trong ảnh của: ${person.name}`);
      }
    }

    statusEl.textContent = `Sẵn sàng `;
    statusEl.className = 'status-ready';
    document.getElementById('start-scan-btn').disabled = false;
  } catch (err) {
    statusEl.textContent = 'Lỗi khởi tạo hệ thống!';
    console.error(err);
  }
}

window.addEventListener('DOMContentLoaded', initSystem);

document.getElementById('start-scan-btn').addEventListener('click', startVerification);
document.getElementById('rescan-btn').addEventListener('click', startVerification);

// Tính khoảng cách nhỏ nhất giữa khuôn mặt hiện tại và các ảnh mẫu của người đó
function getBestDistance(targetDescriptors, currentDescriptor) {
  let minDistance = Infinity;
  for (const desc of targetDescriptors) {
    const dist = faceapi.euclideanDistance(desc, currentDescriptor);
    if (dist < minDistance) minDistance = dist;
  }
  return minDistance;
}
function distanceToPercent(distance) {
  const raw = 100 / (1 + Math.exp((distance - 0.52) * 11));
  return Math.max(5, Math.min(99, Math.round(raw)));
}
async function startVerification() {
  const inputName = document.getElementById('search-name').value.trim().toLowerCase();
  if (!inputName) {
    showModal('Vui lòng nhập tên người cần kiểm tra!');
    return;
  }

  const targetPerson = labeledDescriptors[inputName];
  if (!targetPerson) {
    showModal(`Không có dữ liệu ảnh cho tên "${inputName}". Kiểm tra lại danh sách  `);
    return;
  }

  stopCamera();

  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  const laser = document.getElementById('laser-beam');
  const hud = document.getElementById('hud-text');
  const resultPanel = document.getElementById('result-panel');

  resultPanel.classList.add('hidden');
  laser.classList.add('scanning');
  hud.textContent = `ĐANG QUÉT: ${targetPerson.displayName.toUpperCase()}...`;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
  } catch (err) {
    showModal('Không mở được camera. Hãy cấp quyền camera cho trình duyệt!');
    laser.classList.remove('scanning');
    return;
  }

  video.onloadedmetadata = () => {
    const displaySize = { width: video.clientWidth, height: video.clientHeight };
    faceapi.matchDimensions(canvas, displaySize);

    let sampleScores = [];
    const ctx = canvas.getContext('2d');

    scanInterval = setInterval(async () => {
      const detection = await faceapi.detectSingleFace(video)
        .withFaceLandmarks()
        .withFaceDescriptor();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (detection) {
        const resized = faceapi.resizeResults(detection, displaySize);
        drawSciFiBox(ctx, resized.detection.box);
        const distance = getBestDistance(targetPerson.descriptors, detection.descriptor);
        const similarity = distanceToPercent(distance);
        sampleScores.push(similarity);
        hud.textContent = `ĐANG PHÂN TÍCH... ${similarity}%`;

        if (sampleScores.length >= 12) {
          clearInterval(scanInterval);
          laser.classList.remove('scanning');

          const validScores = sampleScores.slice(3).sort((a, b) => b - a);
          const topScores = validScores.slice(0, 3);
          const finalScore = Math.round(topScores.reduce((a, b) => a + b, 0) / topScores.length);

          showFinalResult(finalScore, targetPerson.displayName);
        }
      }
    }, 200);
  };
}

function drawSciFiBox(ctx, box) {
  const { x, y, width, height } = box;
  const lineLen = 25;
  ctx.strokeStyle = '#00f2fe';
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(x, y + lineLen); ctx.lineTo(x, y); ctx.lineTo(x + lineLen, y);
  ctx.moveTo(x + width - lineLen, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + lineLen);
  ctx.moveTo(x + width, y + height - lineLen); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width - lineLen, y + height);
  ctx.moveTo(x + lineLen, y + height); ctx.lineTo(x, y + height); ctx.lineTo(x, y + height - lineLen);
  ctx.stroke();
}

function showFinalResult(score, name) {
  const resultPanel = document.getElementById('result-panel');
  const statusEl = document.getElementById('match-status');
  const scoreEl = document.getElementById('similarity-score');
  const fillEl = document.getElementById('similarity-fill');
  const hud = document.getElementById('hud-text');

  const isMatch = score >= 65;

  resultPanel.classList.remove('hidden');
  scoreEl.textContent = `${score}%`;
  fillEl.style.width = `${score}%`;

  if (isMatch) {
    statusEl.textContent = `ĐÚNG LÀ ${name.toUpperCase()}`;
    statusEl.style.color = '#4ade80';
    fillEl.style.background = '#4ade80';
    hud.textContent = 'KHỚP KHUÔN MẶT';
  } else {
    statusEl.textContent = `KHÔNG PHẢI ${name.toUpperCase()}`;
    statusEl.style.color = '#f87171';
    fillEl.style.background = '#f87171';
    hud.textContent = 'KHÔNG KHỚP';
  }
}

function stopCamera() {
  if (scanInterval) clearInterval(scanInterval);
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}
// Hàm bật màn thông báo nhỏ
function showModal(message, title = 'CẢNH BÁO') {
  const modal = document.getElementById('custom-modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  modal.classList.remove('hidden');
}

// Bấm nút OK hoặc bấm ra vùng tối bên ngoài hoặc nhấn Enter/Esc đều đóng được ngay
document.getElementById('modal-ok-btn').addEventListener('click', () => {
  document.getElementById('custom-modal').classList.add('hidden');
});

document.getElementById('custom-modal').addEventListener('click', (e) => {
  if (e.target.id === 'custom-modal') {
    e.currentTarget.classList.add('hidden');
  }
});
document.getElementById('stop-cam-btn').addEventListener('click', () => {
  stopCamera();

  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  const laser = document.getElementById('laser-beam');
  const hud = document.getElementById('hud-text');

  video.srcObject = null;
  laser.classList.remove('scanning');
  hud.textContent = 'ĐÃ TẮT CAMERA';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});
function drawFullFaceFilter(ctx, resized) {
  const pts = resized.landmarks.positions;
  if (!pts || pts.length < 68) return;

  // Điểm mốc chuẩn: cằm (8), hai bên thái dương/má (0, 16), sống mũi/giữa trán (27)
  const leftCheek = pts[1];
  const chin = pts[8];
  const rightCheek = pts[15];
  const browLeft = pts[17];
  const browRight = pts[26];
  const noseBridge = pts[27];

  const foreheadTopY = Math.min(browLeft.y, browRight.y) - (chin.y - noseBridge.y) * 0.58;
  const centerX = noseBridge.x;
  const faceWidth = Math.hypot(rightCheek.x - leftCheek.x, rightCheek.y - leftCheek.y) * 1.12;
  const faceHeight = chin.y - foreheadTopY + 12;

  const box = resized.detection.box;
  const sweepProgress = (Math.sin(Date.now() * 0.0045) * 0.5 + 0.5);
  const sweepY = foreheadTopY + sweepProgress * faceHeight;

  ctx.save();

  // Dựng khung hình elip/trái xoan mềm mại ôm trọn khuôn mặt
  ctx.beginPath();
  ctx.ellipse(
    centerX,
    foreheadTopY + faceHeight * 0.52,
    faceWidth * 0.52,
    faceHeight * 0.54,
    0,
    0,
    Math.PI * 2
  );

  // Lớp nền trong mờ dịu mắt
  const bgGrad = ctx.createRadialGradient(
    centerX,
    foreheadTopY + faceHeight * 0.45,
    faceWidth * 0.1,
    centerX,
    foreheadTopY + faceHeight * 0.5,
    faceHeight * 0.65
  );
  bgGrad.addColorStop(0, 'rgba(56, 189, 248, 0.06)');
  bgGrad.addColorStop(0.75, 'rgba(0, 242, 254, 0.14)');
  bgGrad.addColorStop(1, 'rgba(0, 242, 254, 0.25)');
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Viền sáng mảnh, dịu
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cắt bên trong khuôn mặt để vẽ dải quét có đuôi mờ
  ctx.clip();

  const bandGrad = ctx.createLinearGradient(0, sweepY - 24, 0, sweepY + 24);
  bandGrad.addColorStop(0, 'rgba(0, 242, 254, 0)');
  bandGrad.addColorStop(0.5, 'rgba(186, 230, 253, 0.45)');
  bandGrad.addColorStop(1, 'rgba(0, 242, 254, 0)');

  ctx.fillStyle = bandGrad;
  ctx.fillRect(box.x, sweepY - 24, box.width, 48);

  // Đường quét mảnh ở giữa dải sáng
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.75)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(box.x, sweepY);
  ctx.lineTo(box.x + box.width, sweepY);
  ctx.stroke();

  ctx.restore();
}
