const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let currentRoom = null;
let myId = null;
let players = [];
let iAmFake = false;
let isDrawing = false;
let lastPos = { x: 0, y: 0 };
let myTurn = false;
let myAssignedColor = '#000';
let currentStrokeLength = 0;
const MAX_STROKE_LENGTH = 500;
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

function draw(x1, y1, x2, y2, color, emit = false) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.closePath();

    if (emit) {
        socket.emit('draw-line', { x1, y1, x2, y2, color: myAssignedColor, roomCode: currentRoom });
    }
}

function joinRoom() {
    const playerName = document.getElementById('playerName').value;
    const roomCodeInput = document.getElementById('roomCode').value;
    if (playerName && roomCodeInput) {
        currentRoom = roomCodeInput;
        socket.emit('join-room', { roomCode: currentRoom, playerName });
    }
}

socket.on('init-player', (data) => {
    myId = data.id;
    myAssignedColor = data.color;
    document.getElementById('lobby-screen').style.display = 'none';


    if (data.isSpectator) {
        document.getElementById('waiting-room').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';

        document.getElementById('status').innerHTML = "👀 PARTIE EN COURS - Vous rejoindrez au prochain tour";
        canvas.style.pointerEvents = "none";
        canvas.style.opacity = 1;
    } else {
        document.getElementById('waiting-room').style.display = 'block';
        document.getElementById('game-screen').style.display = 'none';
    }

    document.getElementById('displayRoomCode').innerText = data.roomCode;
});

socket.on('update-players', (updatedPlayers) => {
    players = updatedPlayers;

    const waitingList = document.getElementById('playerListWaiting');
    if (waitingList) {
        waitingList.innerHTML = players.map(p => `<div class="player-item">${p.name}</div>`).join('');
    }

    const waitMsg = document.getElementById('wait-message');
    if (waitMsg) {
        waitMsg.style.display = (players.length >= 3) ? 'none' : 'block';
    }

    const startBtn = document.getElementById('startBtn');
    const isHost = (players.length > 0 && players[0].id === socket.id);
    const isWaitingRoomVisible = document.getElementById('waiting-room').style.display !== 'none';

    if (startBtn) {
        startBtn.style.display = (isHost && isWaitingRoomVisible && players.length >= 3) ? 'block' : 'none';
    }

    renderPlayerList();
});

canvas.addEventListener('mousedown', (e) => {
    if (!myTurn) return;
    isDrawing = true;
    lastPos = { x: e.offsetX, y: e.offsetY };
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing || !myTurn) return;

    const newPos = { x: e.offsetX, y: e.offsetY };
    const dist = Math.sqrt(Math.pow(newPos.x - lastPos.x, 2) + Math.pow(newPos.y - lastPos.y, 2));
    currentStrokeLength += dist;

    if (currentStrokeLength < MAX_STROKE_LENGTH) {
        draw(lastPos.x, lastPos.y, newPos.x, newPos.y, myAssignedColor, true);
        lastPos = newPos;
    } else {
        finishMyTurn();
    }

    socket.emit('mouse-move', { x: e.offsetX, y: e.offsetY });
});


window.addEventListener('mouseup', () => {
    if (isDrawing && myTurn) {
        finishMyTurn();
    }
});

function getScribbleMask(index) {
    const pathData = SCRIBBLE_PATHS[index % SCRIBBLE_PATHS.length];

    const svgString = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="${pathData}" fill="black"/></svg>`;

    return `url('data:image/svg+xml;base64,${btoa(svgString)}')`;
}

function renderPlayerList(canVote = false) {
    const listContainer = document.getElementById('player-list');
    if (!listContainer) return;

    listContainer.innerHTML = "";

    const me = players.find(p => p.id === myId);
    const iAmSpectator = me ? me.isSpectator : false;

    listContainer.innerHTML = "";

    players.forEach((p, index) => {

        const div = document.createElement('div');
        div.className = "player-item";

        const scribble = document.createElement('div');
        scribble.className = "avatar-scribble";

        const mask = getScribbleMask(index);
        scribble.style.maskImage = mask;
        scribble.style.webkitMaskImage = mask;
        scribble.style.color = p.color;

        const nameSpan = document.createElement('span');
        let statusSuffix = p.id === myId ? " (TOI)" : "";
        if (p.isSpectator) statusSuffix += "👤";
        nameSpan.innerText = p.name + statusSuffix;
        nameSpan.style.fontSize = "10px";

        div.appendChild(scribble);
        div.appendChild(nameSpan);

        if (canVote && p.id !== myId && !p.isSpectator && !iAmSpectator) {
            div.style.cursor = "pointer";
            div.style.border = "3px solid #ff4654";
            div.onclick = () => {
                console.log("Vote envoyé pour :", p.name);
                sendVote(p.id);
            };

            div.onmouseover = () => div.style.background = "#ffebeb";
            div.onmouseout = () => div.style.background = "white";
        }

        listContainer.appendChild(div);
    });
}

function sendVote(targetId) {

    renderPlayerList(false);
    socket.emit('submit-vote', { roomCode: currentRoom, targetId });
}

socket.on('assign-color', (color) => {
    myAssignedColor = color;
    const tag = document.getElementById('player-tag');
    tag.innerHTML = `Vous êtes le <span style="color:${color}; font-weight:bold;">Joueur</span>`;
    document.getElementById('status').style.borderLeft = `10px solid ${color}`;
});


socket.on('draw-line', (data) => {
    draw(data.x1, data.y1, data.x2, data.y2, data.color);
});

socket.on('draw-history', (history) => {
    history.forEach(line => {
        draw(line.x1, line.y1, line.x2, line.y2, line.color, false);
    });
});

socket.on('next-turn', (data) => {
    const statusEl = document.getElementById('status');

    if (data.activePlayerId === socket.id) {
        myTurn = true;
        statusEl.innerHTML = `<b>À votre tour d'apporter votre contribution !</b>`;
        canvas.style.pointerEvents = "auto";
        canvas.style.opacity = 1;
    } else {
        myTurn = false;
        statusEl.innerHTML = `Chuuuut, <b>${data.playerName}</b> est en pleine création...`;
        canvas.style.pointerEvents = "none";
        canvas.style.opacity = 0.6;
    }
});

socket.on('role-assignment', (data) => {
    iAmFake = (data.role === "fake");
    document.getElementById('waiting-room').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';

    const infoDiv = document.getElementById('game-info');
    console.log("Rôle reçu :", data);

    if (data.role === "fake") {
        infoDiv.innerHTML = `
            <h2 style="color: #ff4654;">L'IMPOSTEUR</h2>
            <p>Catégorie : <strong>${data.category}</strong></p>
            <p>Le mot est secret...</p>
        `;
    } else {
        infoDiv.innerHTML = `
            <h2 style="color: #00bcd4;">ARTISTE</h2>
            <p>Catégorie : <strong>${data.category}</strong></p>
            <p>Mot : <strong style="font-size: 1.5em;">${data.word}</strong></p>
        `;
    }

    const frame = document.querySelector('.art-frame');
    if (frame) frame.classList.remove('exhibition-mode');

    document.getElementById('status').innerHTML = "";
});

socket.on('game-over', () => {
    const frame = document.querySelector('.art-frame');
    frame.classList.add('exhibition-mode');

    canvas.style.opacity = "1";
    canvas.style.pointerEvents = "none";

    const infoEl = document.getElementById('game-info');
    const statusEl = document.getElementById('status');

    statusEl.innerHTML = "";
    statusEl.style.border = "none";

    infoEl.innerHTML = "<h2 style='color:#ff4654; margin:0;'>L'ŒUVRE EST TERMINÉE. VOTEZ !</h2>";

    renderPlayerList(true);
})

function vote(targetId) {
    socket.emit('submit-vote', { roomCode: currentRoom, targetId });
}

socket.on('reveal-result', (data) => {
    const statusEl = document.getElementById('status');
    statusEl.innerHTML = "";

    const info = document.getElementById('game-info');
    if (data.isCaught) {
        info.innerHTML = `<h3>Démasqué ! C'était bien ${data.suspectName}</h3>
                          <p>Il peut encore s'innocenter en devinant le bon mot</p> `;
        if (iAmFake) {
            info.innerHTML += `
            <p>Vite ! Devine le mot pour gagner :</p>
            <div class="guess-container">
                <input type="text" id="guessInput" placeholder="...">
                <button id=guessBtn onclick="sendGuess()">Dernière chance</button>
            </div>
            `;
        }
    } else {
        info.innerHTML = `<h3> L'imposteur (${data.fakeName}) s'est échappé !</h3>
                          <p>Les artistes ont perdu...</p>
                          <br><button id="replayBtn" onclick="requestRestart()">REJOUER</button>`;
    }
});


chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value.trim()) {
        socket.emit('chatMessage', chatInput.value);
        chatInput.value = '';
    }
});

socket.on('message', (msg) => {
    const item = document.createElement('div');
    item.style.marginBottom = "5px";
    item.innerHTML = `<strong style="color: ${msg.color}">${msg.user}:</strong> ${msg.text}`;
    chatMessages.appendChild(item);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll vers le bas
});

function sendGuess() {
    const guess = document.getElementById('guessInput').value;
    socket.emit('fake-guess', { roomCode: currentRoom, guess });
}
function startGame() {
    socket.emit('start-game', currentRoom);
}

socket.on('final-outcome', (data) => {
    const info = document.getElementById('game-info');
    let outcomeHTML = "";

    if (data.success) {
        outcomeHTML = `<h1 style="color: #ff4654;">VICTOIRE DE L'IMPOSTEUR !</h1>
                       <p>Il a trouvé le mot : <strong>${data.word}</strong></p>`;
    } else {
        outcomeHTML = `<h1 style="color: #00bcd4;">VICTOIRE DES ARTISTES !</h1>
                       <p>L'imposteur s'est trompé. Le mot était : <strong>${data.word}</strong></p>`;
    }


    outcomeHTML += `<br><button id="replayBtn" onclick="requestRestart()">REJOUER</button>`;

    info.innerHTML = outcomeHTML;
});

function requestRestart() {
    socket.emit('restart-game', currentRoom);
}

socket.on('clear-canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

function finishMyTurn() {
    isDrawing = false;
    myTurn = false;
    currentStrokeLength = 0;
    socket.emit('finish-stroke', currentRoom);
}