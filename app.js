/**
 * 르샤틀리에의 원리 미션형 시뮬레이터 - app.js
 * 
 * 1. 입자 기반 무작위 2D 물리 엔진 (Canvas)
 * 2. 가역 반응 농도 평형 엔진 (Fe³⁺ + SCN⁻ ⇌ [Fe(SCN)]²⁺)
 * 3. 시간에 따른 농도 실시간 선형 차트 렌더링
 * 4. 3단계 미션 성공 검증 루프
 */

// --- 1. 전역 상태 및 환경 설정 ---
const config = {
  beaker: {
    width: 0,
    height: 0,
    maxParticles: 150
  },
  physics: {
    particleRadius: 7,
    speedScale: 1.2,
    reactionRadius: 20, // 입자 간 충돌/반응 임계 반지름
    kf: 0.12,           // 정반응 속도 상수 (결합 확률 가속 인자)
    kr: 0.015           // 역반응 속도 상수 (자연 해리 확률)
  }
};

const state = {
  currentMission: 1,
  particles: [],
  history: {
    time: [],
    fe: [],
    scn: [],
    fescn: []
  },
  counts: {
    fe: 0,
    scn: 0,
    fescn: 0
  },
  missionProgress: 0,
  equilibriumStableTime: 0, // 미션 3용 카운터
  isStable: false,
  rates: {
    vf: 0,
    vr: 0
  }
};

// Canvas 레퍼런스
let beakerCanvas, beakerCtx;
let graphCanvas, graphCtx;
let animationFrameId;
let graphTimer = 0;

// --- 2. 초기화 및 이벤트 바인딩 ---
window.addEventListener('DOMContentLoaded', () => {
  beakerCanvas = document.getElementById('beaker-canvas');
  beakerCtx = beakerCanvas.getContext('2d');
  
  graphCanvas = document.getElementById('graph-canvas');
  graphCtx = graphCanvas.getContext('2d');
  
  // 사이즈 리사이징 및 설정
  resizeCanvases();
  window.addEventListener('resize', resizeCanvases);
  
  // 초기 입자 생성 및 시뮬레이션 루프 작동
  resetSimulator();
  gameLoop();
});

function resizeCanvases() {
  const bRect = beakerCanvas.parentElement.getBoundingClientRect();
  beakerCanvas.width = bRect.width;
  beakerCanvas.height = bRect.height;
  config.beaker.width = bRect.width;
  config.beaker.height = bRect.height;
  
  const gRect = graphCanvas.parentElement.getBoundingClientRect();
  graphCanvas.width = gRect.width;
  graphCanvas.height = gRect.height;
}

// --- 3. 입자 클래스 정의 (Fe³⁺, SCN⁻, [Fe(SCN)]²⁺) ---
class Particle {
  constructor(type, x, y) {
    this.type = type; // 'Fe', 'SCN', 'FeSCN'
    this.x = x || Math.random() * (config.beaker.width - 40) + 20;
    this.y = y || Math.random() * (config.beaker.height - 40) + 20;
    
    // 무작위 속도 벡터 생성
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.5 + Math.random() * 1.0) * config.physics.speedScale;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    
    this.radius = config.physics.particleRadius;
    this.id = Math.random().toString(36).substr(2, 9);
    
    // 결합용 파트너 및 활성 정보
    this.joinedPartner = null;
    
    // [Fe(SCN)]²⁺ 입자의 경우 더 크게 표현
    if (this.type === 'FeSCN') {
      this.radius = config.physics.particleRadius * 1.4;
    }
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    
    // 벽면 탄성 충돌
    if (this.x - this.radius < 0) {
      this.x = this.radius;
      this.vx *= -1;
    }
    if (this.x + this.radius > config.beaker.width) {
      this.x = config.beaker.width - this.radius;
      this.vx *= -1;
    }
    if (this.y - this.radius < 0) {
      this.y = this.radius;
      this.vy *= -1;
    }
    if (this.y + this.radius > config.beaker.height) {
      this.y = config.beaker.height - this.radius;
      this.vy *= -1;
    }
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    
    let color = '';
    let shadowColor = '';
    
    if (this.type === 'Fe') {
      color = '#e2a03f'; // 갈색
      shadowColor = 'rgba(226, 160, 63, 0.4)';
    } else if (this.type === 'SCN') {
      color = '#4da6ff'; // 하늘색
      shadowColor = 'rgba(77, 166, 255, 0.4)';
    } else {
      color = '#ff3344'; // 적갈색
      shadowColor = 'rgba(255, 51, 68, 0.6)';
    }
    
    ctx.fillStyle = color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = shadowColor;
    ctx.fill();
    ctx.shadowBlur = 0; // 초기화
    
    // 외곽선
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// --- 4. 반응 및 시뮬레이터 엔진 로직 ---
function injectParticle(type) {
  if (state.particles.length >= config.beaker.maxParticles) return;
  
  // 한 번에 5개씩 주입하여 반응 가속
  for (let i = 0; i < 5; i++) {
    state.particles.push(new Particle(type));
  }
  updateCounts();
}

function removeProduct() {
  // [Fe(SCN)]²⁺ 분자를 골라내 최대 6개 제거
  let removedCount = 0;
  state.particles = state.particles.filter(p => {
    if (p.type === 'FeSCN' && removedCount < 6) {
      removedCount++;
      return false; // 필터링하여 제거
    }
    return true;
  });
  updateCounts();
}

function updateCounts() {
  let fe = 0, scn = 0, fescn = 0;
  state.particles.forEach(p => {
    if (p.type === 'Fe') fe++;
    else if (p.type === 'SCN') scn++;
    else if (p.type === 'FeSCN') fescn++;
  });
  
  state.counts.fe = fe;
  state.counts.scn = scn;
  state.counts.fescn = fescn;
  
  document.getElementById('count-fe').innerText = fe;
  document.getElementById('count-scn').innerText = scn;
  document.getElementById('count-fescn').innerText = fescn;
}

// 가역 평형 반응 계산 로직
function handleChemicalReactions() {
  // 1. 정반응 ($Fe^{3+} + SCN^- \rightarrow [Fe(SCN)]^{2+}$)
  // 서로 다른 반응성 입자가 만났을 때 반응 확률에 의해 결합함
  for (let i = 0; i < state.particles.length; i++) {
    for (let j = i + 1; j < state.particles.length; j++) {
      const p1 = state.particles[i];
      const p2 = state.particles[j];
      
      if (
        ((p1.type === 'Fe' && p2.type === 'SCN') || (p1.type === 'SCN' && p2.type === 'Fe')) &&
        !p1.joinedPartner && !p2.joinedPartner
      ) {
        // 거리 계산
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < config.physics.reactionRadius) {
          // 정반응 속도(kf) 확률 적용
          if (Math.random() < config.physics.kf) {
            // 반응물 두 개를 지우고 중앙에 생성물 생성
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            
            state.particles = state.particles.filter(p => p.id !== p1.id && p.id !== p2.id);
            state.particles.push(new Particle('FeSCN', midX, midY));
            updateCounts();
            break;
          }
        }
      }
    }
  }

  // 2. 역반응 ($[Fe(SCN)]^{2+} \rightarrow Fe^{3+} + SCN^-$)
  // 생성된 착이온이 분해 확률(kr)에 따라 자연 분해됨
  state.particles.forEach(p => {
    if (p.type === 'FeSCN') {
      if (Math.random() < config.physics.kr) {
        // 해리하여 Fe3+와 SCN-로 쪼갬
        p.type = 'Fe'; // 현재 입자는 Fe로 복원
        p.radius = config.physics.particleRadius;
        
        // 반대 방향으로 방출할 SCN- 입자 생성
        const spawnSCN = new Particle('SCN', p.x + 10, p.y + 10);
        spawnSCN.vx = -p.vx;
        spawnSCN.vy = -p.vy;
        state.particles.push(spawnSCN);
        
        updateCounts();
      }
    }
  });
}

// 실시간 정/역반응 속도(v_f, v_r) 갱신
function updateEquilibriumRates() {
  // 실제 속도 계산 법칙: v_f = k_f * [Fe] * [SCN] / volume, v_r = k_r * [FeSCN]
  const volumeFactor = 1000;
  const rawVf = (config.physics.kf * 3.5 * state.counts.fe * state.counts.scn) / volumeFactor;
  const rawVr = (config.physics.kr * 12.0 * state.counts.fescn);
  
  // 관성에 따른 부드러운 수치 변화 보간(LERP)
  state.rates.vf += (rawVf - state.rates.vf) * 0.1;
  state.rates.vr += (rawVr - state.rates.vr) * 0.1;
  
  document.getElementById('vf-val').innerText = state.rates.vf.toFixed(2);
  document.getElementById('vr-val').innerText = state.rates.vr.toFixed(2);
  
  // 속도 밸런스 이퀄라이저 바 조절
  const balanceBar = document.getElementById('rate-glow');
  const delta = state.rates.vf - state.rates.vr;
  const glowTranslate = Math.max(-50, Math.min(50, delta * 8));
  balanceBar.style.transform = `translateX(${glowTranslate}px)`;
  
  if (Math.abs(delta) < 0.35 && state.particles.length > 5) {
    state.isStable = true;
    const badge = document.getElementById('equilibrium-status-badge');
    badge.innerText = "동적 평형 도달";
    badge.className = "badge stable";
  } else {
    state.isStable = false;
    const badge = document.getElementById('equilibrium-status-badge');
    badge.innerText = "평형 교란 발생 (이동중)";
    badge.className = "badge";
  }
}

// 비커 액체의 거시적 붉은색 강도를 생성물 비율에 맞추어 갱신
function updateSolutionOverlay() {
  const total = state.counts.fe + state.counts.scn + state.counts.fescn;
  if (total === 0) return;
  const ratio = state.counts.fescn / total;
  
  const overlay = document.getElementById('solution-overlay');
  overlay.style.backgroundColor = `rgb(139, 0, 0)`; // 진한 적갈색
  overlay.style.opacity = Math.min(0.7, ratio * 0.95);
}

// --- 5. 실시간 농도 추이 그래프 엔진 ---
function pushGraphData() {
  state.history.time.push(graphTimer++);
  state.history.fe.push(state.counts.fe);
  state.history.scn.push(state.counts.scn);
  state.history.fescn.push(state.counts.fescn);
  
  // 그래프 기록 100포인트 제한 (넘어가면 쉬프트)
  if (state.history.time.length > 80) {
    state.history.time.shift();
    state.history.fe.shift();
    state.history.scn.shift();
    state.history.fescn.shift();
  }
}

function drawGraph() {
  if (!graphCtx) return;
  
  graphCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
  
  const w = graphCanvas.width;
  const h = graphCanvas.height;
  const padding = 30;
  
  // 그래프 그리드 드로잉
  graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  graphCtx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const yLine = padding + ((h - padding * 2) / 4) * i;
    graphCtx.beginPath();
    graphCtx.moveTo(padding, yLine);
    graphCtx.lineTo(w - padding, yLine);
    graphCtx.stroke();
  }
  
  const maxVal = Math.max(
    50,
    ...state.history.fe,
    ...state.history.scn,
    ...state.history.fescn
  ) * 1.1;
  
  const len = state.history.time.length;
  if (len < 2) return;
  
  const getX = (index) => padding + ((w - padding * 2) / (80 - 1)) * index;
  const getY = (val) => h - padding - ((h - padding * 2) / maxVal) * val;
  
  // 3개 라인 그리기
  const drawLine = (data, color) => {
    graphCtx.beginPath();
    graphCtx.strokeStyle = color;
    graphCtx.lineWidth = 2.5;
    
    for (let i = 0; i < data.length; i++) {
      const x = getX(i);
      const y = getY(data[i]);
      if (i === 0) graphCtx.moveTo(x, y);
      else graphCtx.lineTo(x, y);
    }
    graphCtx.stroke();
  };
  
  drawLine(state.history.fe, '#e2a03f');      // Fe
  drawLine(state.history.scn, '#4da6ff');     // SCN
  drawLine(state.history.fescn, '#ff3344');   // [Fe(SCN)]²⁺
}

// --- 6. 미션 유효성 판정 검사 루프 ---
function checkMissionProgress() {
  const pText = document.getElementById('mission-progress-text');
  const pFill = document.getElementById('mission-progress-fill');
  
  if (state.currentMission === 1) {
    // 미션 1: 적갈색 착이온 [Fe(SCN)]2+이 18개 이상이며 안정화된 평형 상태에 도달
    const target = 18;
    const progress = Math.min(target, state.counts.fescn);
    const pct = (progress / target) * 100;
    
    pText.innerText = `${progress} / ${target}`;
    pFill.style.width = `${pct}%`;
    
    if (state.counts.fescn >= target && state.isStable) {
      triggerSuccess("축하합니다! 반응 물질 농도를 높이자 평형이 정반응 쪽(우측)으로 이동하여 새로운 평형 농도에 도달했습니다. [Fe(SCN)]²⁺ 생성물이 크게 늘어났습니다.");
    }
  } 
  else if (state.currentMission === 2) {
    // 미션 2: 생성물을 제거하여 색을 원래의 연한 황갈색 투명 상태([Fe(SCN)]2+ 수 6개 이하)로 복구하기
    const target = 6;
    // 거꾸로 표기 (적을수록 달성률 증가)
    const progress = Math.max(0, 18 - state.counts.fescn);
    const pct = Math.min(100, (progress / 12) * 100);
    
    pText.innerText = `${state.counts.fescn} / ${target} 이하`;
    pFill.style.width = `${pct}%`;
    
    if (state.counts.fescn <= target && state.isStable) {
      triggerSuccess("성공입니다! 생성물을 가볍게 추출(제거)하자 르샤틀리에 원리에 따라 이를 채우는 정반응 평형 이동이 즉각 일어납니다. 생성물의 농도 교란을 통해 계가 어떻게 변하는지 확인하셨습니다.");
    }
  } 
  else if (state.currentMission === 3) {
    // 미션 3: 정반응과 역반응의 평형 밸런스(정밀 정속 상태)를 5초간 유지하기
    const targetTime = 5.0; // 5초
    
    if (state.isStable && state.particles.length > 25) {
      state.equilibriumStableTime += 1 / 60; // 60fps 보정
    } else {
      state.equilibriumStableTime = 0;
    }
    
    const sec = Math.min(targetTime, state.equilibriumStableTime).toFixed(1);
    const pct = (state.equilibriumStableTime / targetTime) * 100;
    
    pText.innerText = `${sec}s / ${targetTime}s`;
    pFill.style.width = `${pct}%`;
    
    if (state.equilibriumStableTime >= targetTime) {
      triggerSuccess("경이롭습니다! 분자의 끊임없는 충돌(미시) 속에서도 정반응 속도와 역반응 속도가 완벽히 균형을 이루는 '동적 평형(Dynamic Equilibrium)' 상태를 성공적으로 사수하였습니다!");
    }
  }
}

function switchMission(num) {
  state.currentMission = num;
  
  // 버튼 활성화 클래스 토글
  for(let i=1; i<=3; i++) {
    const btn = document.getElementById(`btn-m${i}`);
    if (i === num) btn.classList.add('active');
    else btn.classList.remove('active');
  }
  
  const mTitle = document.getElementById('mission-title');
  const mDesc = document.getElementById('mission-desc');
  
  if (num === 1) {
    mTitle.innerText = "미션 1: 반응 물질 주입하기";
    mDesc.innerText = "용기 안에 Fe³⁺나 SCN⁻ 반응물을 추가하여 적갈색의 생성물 [Fe(SCN)]²⁺이 18개 이상 생성되도록 하고, 안정한 평형 상태를 도달시키세요.";
  } else if (num === 2) {
    mTitle.innerText = "미션 2: 평형 방해 및 복구";
    mDesc.innerText = "생성물 제거 버튼을 이용하여 비커 안의 [Fe(SCN)]²⁺ 입자를 신속히 지우고, 계가 평형 복구를 완료하여 생성물이 6개 이하인 연한 평형 단계에 도달시키세요.";
  } else if (num === 3) {
    mTitle.innerText = "미션 3: 완벽한 동적 평형 유지 (챌린지)";
    mDesc.innerText = "정반응과 역반응의 속도가 거의 일치하여 계가 고요한 상태(동적 평형)를 지속하는 균형을 5초 동안 견고하게 유지해 내세요. (입자가 최소 25개 이상 비커에 상주해야 합니다!)";
  }
  
  state.equilibriumStableTime = 0;
}

function triggerSuccess(msg) {
  document.getElementById('modal-success-desc').innerText = msg;
  document.getElementById('success-modal').classList.add('active');
  cancelAnimationFrame(animationFrameId);
}

function closeModal() {
  document.getElementById('success-modal').classList.remove('active');
  
  // 다음 미션 자동 전환
  if (state.currentMission < 3) {
    switchMission(state.currentMission + 1);
  } else {
    switchMission(1);
  }
  
  gameLoop();
}

// --- 7. 메인 게임 루프 및 리셋 ---
function gameLoop() {
  beakerCtx.clearRect(0, 0, config.beaker.width, config.beaker.height);
  
  // 1. 화학 반응 및 속도 연산
  handleChemicalReactions();
  updateEquilibriumRates();
  updateSolutionOverlay();
  
  // 2. 입자 위치 갱신 및 드로잉
  state.particles.forEach(p => {
    p.update();
    p.draw(beakerCtx);
  });
  
  // 3. 미션 상태 업데이트
  checkMissionProgress();
  
  // 4. 그래프용 주기적 데이터 수집 및 그리기
  if (graphTimer % 15 === 0) {
    pushGraphData();
  }
  drawGraph();
  
  graphTimer++;
  animationFrameId = requestAnimationFrame(gameLoop);
}

function resetSimulator() {
  state.particles = [];
  state.history = { time: [], fe: [], scn: [], fescn: [] };
  graphTimer = 0;
  state.equilibriumStableTime = 0;
  
  // 기본 평형 입자 구성 주입 (각각 15개씩 골고루)
  for (let i = 0; i < 15; i++) {
    state.particles.push(new Particle('Fe'));
    state.particles.push(new Particle('SCN'));
  }
  
  updateCounts();
}
