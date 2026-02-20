const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const wordsData = require('./words.json');
const { machine } = require('os');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(__dirname));
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["https://phoktbn.ovh", "https://www.phoktbn.ovh"],
        methods: ["GET", "POST"]
    }
});

let rooms = {};

const COLORS = ['#E74C3C', '#3498DB', '#2ECC71', '#F1C40F', '#9B59B6', '#E67E22', '#1ABC9C', '#000000', '#65410b', '#045c13'];

function nextTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const activePlayers = room.players.filter(p => !p.isSpectator);

    room.totalStrokesDone++;

    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % activePlayers.length;

    const maxStrokes = activePlayers.length * 2;

    if (room.totalStrokesDone >= maxStrokes) {
        io.to(roomCode).emit('game-over', { message: "Fin du dessin ! Qui a gâché ?" });
    } else {
        const activePlayer = activePlayers[room.currentPlayerIndex];
        io.to(roomCode).emit('next-turn', { activePlayerId: activePlayer.id, playerName: activePlayer.name });
    }
}

io.on('connection', (socket) => {

    socket.on('join-room', (data) => {
        const { roomCode, playerName } = data;
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                players: [],
                drawingHistory: [],
                gameStarted: false,
                currentWord: "",
                currentCategory: "",
                currentPlayerIndex: 0,
                roundCounter: 0,
                fakeId: "",
                votes: {}
            };
        }
        const room = rooms[roomCode];

        if (room.drawingHistory.length > 0) {
            socket.emit('draw-history', room.drawingHistory);
        }

        const color = COLORS[room.players.length % COLORS.length];
        const isSpectator = room.gameStarted;
        const newPlayer = { id: socket.id, name: playerName, color: color, isSpectator: isSpectator };
        room.players.push(newPlayer);

        io.to(roomCode).emit('update-players', room.players);
        socket.emit('init-player', { color, roomCode, id: socket.id, isSpectator });

        if (isSpectator) {
            socket.emit('message', { user: "SYSTÈME", color: "#000", text: "Partie en cours... Vous jouerez à la prochaine !" });
        }

    });

    socket.on('submit-vote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        const activePlayers = room.players.filter(p => !p.isSpectator);

        if (!room) return;

        room.votes[socket.id] = targetId;

        if (Object.keys(room.votes).length === activePlayers.length) {

            const counts = {};
            Object.values(room.votes).forEach(id => { counts[id] = (counts[id] || 0) + 1; });

            const suspectId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            const suspect = room.players.find(p => p.id === suspectId);

            const isCaught = (suspectId === room.fakeId);
            const fakePlayer = activePlayers.find(p => p.id === room.fakeId);

            io.to(roomCode).emit('reveal-result', {
                isCaught,
                suspectName: suspect.name,
                fakeName: fakePlayer.name
            });
        }
    });

    socket.on('draw-line', (data) => {
        const room = rooms[data.roomCode];
        if (room) {
            room.drawingHistory.push(data);
        }
        socket.to(data.roomCode).emit('draw-line', data);
    });

    socket.on('start-game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.players.length < 3) {
            socket.emit('message', {
                user: "SYSTÈME",
                color: "#000",
                text: "Il faut au moins 3 artistes pour commencer !"
            });
            return;
        }

        initNewRound(roomCode);
    });

    socket.on('fake-guess', ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        const success = guess.toLowerCase() === room.currentWord.toLowerCase();
        io.to(roomCode).emit('final-outcome', { success, word: room.currentWord });
    });

    socket.on('mouse-move', (data) => {
        socket.broadcast.emit('mouse-move', { id: socket.id, x: data.x, y: data.y });
    });

    socket.on('finish-stroke', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        const activePlayers = room.players.filter(p => !p.isSpectator);
        const activePlayer = activePlayers[room.currentPlayerIndex];

        if (activePlayer && activePlayer.id === socket.id) {
            nextTurn(roomCode);
        }
    });
    socket.on('disconnect', () => {

        for (let roomCode in rooms) {
            const room = rooms[roomCode];

            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                delete rooms[roomCode];
                console.log(`Salle ${roomCode} supprimée (plus de joueurs).`);
            } else {
                io.to(roomCode).emit('update-players', room.players);
            }
        }
    });
});

socket.on('chatMessage', (text) => {
    const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);

    if (roomCode && rooms[roomCode]) {
        const room = rooms[roomCode];
        const player = room.players.find(p => p.id === socket.id);

        if (player) {
            io.to(roomCode).emit('message', {
                user: player.name,
                color: player.color,
                text: text
            });
        }
    }
});

function initNewRound(roomCode) {
    const room = rooms[roomCode];
    const randomEntry = wordsData[Math.floor(Math.random() * wordsData.length)];

    room.drawingHistory = [];
    room.gameStarted = true;
    room.players.forEach(p => p.isSpectator = false);

    io.to(roomCode).emit('update-players', room.players);

    const activePlayers = room.players;
    room.currentPlayerIndex = Math.floor(Math.random() * activePlayers.length);
    room.currentWord = randomEntry.word;
    room.currentCategory = randomEntry.category;
    room.roundCounter = 0;
    room.votes = {};
    room.totalStrokesDone = 0;

    const fakeArtistIndex = Math.floor(Math.random() * activePlayers.length);
    room.fakeId = activePlayers[fakeArtistIndex].id;

    activePlayers.forEach((player) => {
        const isFake = (player.id === room.fakeId);
        io.to(player.id).emit('role-assignment', {
            role: isFake ? 'fake' : 'artist',
            category: room.currentCategory,
            word: isFake ? '???' : room.currentWord
        });
    });

    const firstPlayer = activePlayers[room.currentPlayerIndex];
    io.to(roomCode).emit('next-turn', { activePlayerId: firstPlayer.id, playerName: firstPlayer.name });
}

socket.on('restart-game', (roomCode) => {
    if (rooms[roomCode]) {
        io.to(roomCode).emit('clear-canvas');
        initNewRound(roomCode);
    }
});
})

server.listen(PORT, '0.0.0.0', () => console.log(`Serv sur ${PORT}`));