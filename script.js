const canvas = document.getElementById("game");
const context = canvas.getContext("2d");

const modeSelect = document.getElementById("mode");
const difficultySelect = document.getElementById("difficulty");
const difficultyWrapper = document.getElementById("difficulty-wrapper");
const restartButton = document.getElementById("restart");
const leftScoreElement = document.getElementById("left-score");
const rightScoreElement = document.getElementById("right-score");
const rightLabel = document.getElementById("right-label");
const winnerElement = document.getElementById("winner");

const paddleHeight = 90;
const paddleWidth = 12;
const paddleMargin = 20;
const maxScore = 10;
const difficultySpeed = {
  easy: 3.2,
  medium: 4.5,
  hard: 6,
};

const state = {
  leftScore: 0,
  rightScore: 0,
  keys: new Set(),
  finished: false,
  paddles: {
    left: { x: paddleMargin, y: canvas.height / 2 - paddleHeight / 2, speed: 6 },
    right: {
      x: canvas.width - paddleMargin - paddleWidth,
      y: canvas.height / 2 - paddleHeight / 2,
      speed: 6,
    },
  },
  ball: { x: canvas.width / 2, y: canvas.height / 2, radius: 8, speedX: 5, speedY: 4 },
};

function getMode() {
  return modeSelect.value;
}

function getDifficulty() {
  return difficultySelect.value;
}

function setDifficultyVisibility() {
  const isCpu = getMode() === "cpu";
  difficultyWrapper.hidden = !isCpu;
  rightLabel.firstChild.nodeValue = isCpu ? "Máquina: " : "Jugador 2: ";
}

function clampPaddle(paddle) {
  paddle.y = Math.max(0, Math.min(canvas.height - paddleHeight, paddle.y));
}

function resetBall(toLeft) {
  state.ball.x = canvas.width / 2;
  state.ball.y = canvas.height / 2;
  state.ball.speedX = (toLeft ? -1 : 1) * 5;
  state.ball.speedY = (Math.random() * 4 + 2) * (Math.random() > 0.5 ? 1 : -1);
}

function resetMatch() {
  state.leftScore = 0;
  state.rightScore = 0;
  state.finished = false;
  winnerElement.textContent = "";
  state.paddles.left.y = canvas.height / 2 - paddleHeight / 2;
  state.paddles.right.y = canvas.height / 2 - paddleHeight / 2;
  resetBall(Math.random() > 0.5);
  syncScore();
}

function syncScore() {
  leftScoreElement.textContent = String(state.leftScore);
  rightScoreElement.textContent = String(state.rightScore);
}

function scorePoint(leftPlayer) {
  if (leftPlayer) {
    state.leftScore += 1;
  } else {
    state.rightScore += 1;
  }
  syncScore();

  if (state.leftScore >= maxScore || state.rightScore >= maxScore) {
    state.finished = true;
    const leftWins = state.leftScore > state.rightScore;
    const cpuMode = getMode() === "cpu";
    winnerElement.textContent = leftWins
      ? "¡Ganó el Jugador 1!"
      : cpuMode
        ? "¡Ganó la máquina!"
        : "¡Ganó el Jugador 2!";
    return;
  }

  resetBall(!leftPlayer);
}

function intersects(paddle) {
  return (
    state.ball.x - state.ball.radius < paddle.x + paddleWidth &&
    state.ball.x + state.ball.radius > paddle.x &&
    state.ball.y + state.ball.radius > paddle.y &&
    state.ball.y - state.ball.radius < paddle.y + paddleHeight
  );
}

function updatePaddles() {
  if (state.keys.has("w")) {
    state.paddles.left.y -= state.paddles.left.speed;
  }
  if (state.keys.has("s")) {
    state.paddles.left.y += state.paddles.left.speed;
  }

  if (getMode() === "pvp") {
    if (state.keys.has("ArrowUp")) {
      state.paddles.right.y -= state.paddles.right.speed;
    }
    if (state.keys.has("ArrowDown")) {
      state.paddles.right.y += state.paddles.right.speed;
    }
  } else {
    const center = state.paddles.right.y + paddleHeight / 2;
    const aiSpeed = difficultySpeed[getDifficulty()] ?? difficultySpeed.medium;
    if (center < state.ball.y - 10) {
      state.paddles.right.y += aiSpeed;
    } else if (center > state.ball.y + 10) {
      state.paddles.right.y -= aiSpeed;
    }
  }

  clampPaddle(state.paddles.left);
  clampPaddle(state.paddles.right);
}

function updateBall() {
  state.ball.x += state.ball.speedX;
  state.ball.y += state.ball.speedY;

  if (state.ball.y - state.ball.radius <= 0 || state.ball.y + state.ball.radius >= canvas.height) {
    state.ball.speedY *= -1;
  }

  if (intersects(state.paddles.left) && state.ball.speedX < 0) {
    state.ball.speedX *= -1.04;
    const relative = (state.ball.y - (state.paddles.left.y + paddleHeight / 2)) / (paddleHeight / 2);
    state.ball.speedY = relative * 6;
  }

  if (intersects(state.paddles.right) && state.ball.speedX > 0) {
    state.ball.speedX *= -1.04;
    const relative = (state.ball.y - (state.paddles.right.y + paddleHeight / 2)) / (paddleHeight / 2);
    state.ball.speedY = relative * 6;
  }

  if (state.ball.x + state.ball.radius < 0) {
    scorePoint(false);
  } else if (state.ball.x - state.ball.radius > canvas.width) {
    scorePoint(true);
  }
}

function drawNet() {
  context.fillStyle = "#41537f";
  const segment = 18;
  for (let y = 8; y < canvas.height; y += segment + 8) {
    context.fillRect(canvas.width / 2 - 2, y, 4, segment);
  }
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#d5def3";

  drawNet();

  context.fillRect(state.paddles.left.x, state.paddles.left.y, paddleWidth, paddleHeight);
  context.fillRect(state.paddles.right.x, state.paddles.right.y, paddleWidth, paddleHeight);

  context.beginPath();
  context.arc(state.ball.x, state.ball.y, state.ball.radius, 0, Math.PI * 2);
  context.fill();
}

function loop() {
  if (!state.finished) {
    updatePaddles();
    updateBall();
  }
  draw();
  requestAnimationFrame(loop);
}

document.addEventListener("keydown", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  state.keys.add(key);
});

document.addEventListener("keyup", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  state.keys.delete(key);
});

modeSelect.addEventListener("change", () => {
  setDifficultyVisibility();
  winnerElement.textContent = "";
  state.finished = false;
  resetBall(Math.random() > 0.5);
});
difficultySelect.addEventListener("change", () => {
  winnerElement.textContent = "";
});
restartButton.addEventListener("click", resetMatch);

setDifficultyVisibility();
resetMatch();
loop();
