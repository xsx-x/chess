// --- הגדרות משתנים גלובליים ---
let board = null;
let game = new Chess();
let peer = null;
let conn = null;
let playerColor = 'w';
let stats = { w: 0, l: 0, d: 0 }; // סטטיסטיקה
let gameEnded = false;

// --- מנוע סאונד עצמאי ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'move') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    } 
    else if (type === 'capture') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    }
    else if (type === 'check') {
        osc.type = 'square'; osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        osc.frequency.setValueAtTime(400, audioCtx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
        osc.start(); osc.stop(audioCtx.currentTime + 0.6);
    }
    else if (type === 'chat') { // צליל הודעה חדשה
        osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    }
}

// --- אנימציות ---
function triggerCaptureAnimation() {
    const wrapper = document.getElementById('board-wrapper');
    wrapper.classList.remove('shake-effect');
    void wrapper.offsetWidth; 
    wrapper.classList.add('shake-effect');
}

function highlightMove(source, target) {
    $('.square-55d63').removeClass('highlight-square'); 
    $('.square-' + source).addClass('highlight-square');
    $('.square-' + target).addClass('highlight-square');
}

// --- טעינת סטטיסטיקה אישית ---
function loadStats() {
    const saved = localStorage.getItem('chessStats');
    if (saved) stats = JSON.parse(saved);
    document.getElementById('stat-w').innerText = stats.w;
    document.getElementById('stat-l').innerText = stats.l;
    document.getElementById('stat-d').innerText = stats.d;
}

function saveStats(result) {
    if (gameEnded) return; // מונע ספירה כפולה
    stats[result]++;
    localStorage.setItem('chessStats', JSON.stringify(stats));
    gameEnded = true;
}

// --- אתחול ---
window.onload = () => {
    loadStats(); // טעינת נתונים
    document.body.addEventListener('click', () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });

    const hash = window.location.hash.substring(1); 
    let roomHash = hash.split('?')[0];
    let urlParams = new URLSearchParams(hash.substring(roomHash.length + 1));
    let loadedFen = urlParams.get('fen');
    let opponentColor = urlParams.get('color');

    if (roomHash) {
        playerColor = opponentColor || 'b'; 
        if (loadedFen) game.load(decodeURIComponent(loadedFen)); 
        initJoiner(roomHash);
    } else {
        document.getElementById('create-btn').addEventListener('click', () => initCreator());
        document.getElementById('resume-btn').addEventListener('click', resumeGame);
    }
};

// --- WebRTC ---
function initCreator(startingFen = null, myColor = 'w') {
    const createBtn = document.getElementById('create-btn');
    createBtn.innerText = "מייצר חדר קרב... ⏳"; 
    createBtn.disabled = true;
    
    playerColor = myColor;
    const gameId = Math.random().toString(36).substring(2, 8);
    peer = new Peer(gameId);
    
    peer.on('open', (id) => {
        createBtn.style.display = 'none';
        document.getElementById('resume-btn').parentElement.style.display = 'none';
        
        let link = window.location.href.split('#')[0] + '#' + id;
        if (startingFen && typeof startingFen === 'string') {
            const oppColor = myColor === 'w' ? 'b' : 'w';
            link += `?fen=${encodeURIComponent(startingFen)}&color=${oppColor}`;
        }
        document.getElementById('invite-link').value = link;
        document.getElementById('invite-container').style.display = 'block';
    });

    peer.on('error', (err) => {
        alert("שגיאה ביצירת חדר: " + err);
        createBtn.innerText = "צור משחק קרב חדש";
        createBtn.disabled = false;
    });

    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
    });
}

function initJoiner(hostId) {
    document.getElementById('menu').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    peer = new Peer(); 
    peer.on('open', () => {
        document.getElementById('status').innerText = "מתחבר לשדה הקרב...";
        conn = peer.connect(hostId); 
        setupConnection();
    });
}

function setupConnection() {
    conn.on('open', () => {
        document.getElementById('menu').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initChessboard();
        updateStatus();
        appendChatMessage("מערכת", "החיבור נוצר! המשחק התחיל. ⚔️");
    });

    conn.on('data', (data) => {
        if (data.type === 'move') {
            const moveResult = game.move({ from: data.from, to: data.to, promotion: 'q' });
            board.position(game.fen());
            
            highlightMove(data.from, data.to);
            if (moveResult && moveResult.captured) {
                playSound('capture'); triggerCaptureAnimation();
            } else {
                playSound('move');
            }
            updateStatus();
        } 
        else if (data.type === 'restart') {
            game.reset(); board.start(); gameEnded = false;
            $('.square-55d63').removeClass('highlight-square');
            updateStatus();
            appendChatMessage("מערכת", "היריב התחיל משחק חדש!");
        }
        else if (data.type === 'chat') {
            playSound('chat');
            appendChatMessage("יריב", data.text, false);
        }
    });

    conn.on('close', () => {
        document.getElementById('status').innerText = "היריב ברח מהמערכה! 🏳️";
        appendChatMessage("מערכת", "היריב התנתק.");
    });
}

// --- הגדרות הלוח ---
function initChessboard() {
    const currentFen = game.fen();
    const isStartPos = currentFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    const config = {
        draggable: true,
        position: isStartPos ? 'start' : currentFen,
        orientation: playerColor === 'w' ? 'white' : 'black',
        pieceTheme: 'img/chesspieces/wikipedia/{piece}.png', 
        moveSpeed: 'slow', 
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    board = Chessboard('board', config);
}

function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
        (playerColor === 'b' && piece.search(/^w/) !== -1)) return false;
    if ((game.turn() === 'w' && playerColor === 'b') ||
        (game.turn() === 'b' && playerColor === 'w')) return false;
}

function onDrop(source, target) {
    let move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    highlightMove(source, target);
    if (move.captured) { playSound('capture'); triggerCaptureAnimation(); } 
    else { playSound('move'); }

    conn.send({ type: 'move', from: source, to: target });
    updateStatus();
}

function onSnapEnd() { board.position(game.fen()); }

// --- ניהול תצוגה, מצב וסטטיסטיקה ---
function updateStatus() {
    let statusHTML = '';
    let moveColor = game.turn() === 'w' ? 'לבן' : 'שחור';
    let isMyTurn = game.turn() === playerColor;

    document.body.classList.remove('in-check');

    // עדכון היסטוריית מהלכים (PGN)
    document.getElementById('move-history').innerText = game.pgn() || "עדיין אין מהלכים...";
    document.getElementById('move-history').scrollTop = document.getElementById('move-history').scrollHeight;

    if (game.in_checkmate()) {
        const iWon = (game.turn() !== playerColor); // אם התור של היריב ויש מט - ניצחתי!
        statusHTML = iWon ? '🏆 ניצחת! מכת מחץ ליריב!' : '💀 הפסדת... היריב נתן לך מט.';
        document.getElementById('restart-btn').style.display = 'block';
        
        saveStats(iWon ? 'w' : 'l'); // שמירת ניצחון/הפסד
        
        if (iWon && typeof confetti === 'function') {
            confetti({ particleCount: 200, spread: 90, origin: { y: 0.6 } });
        }
    } 
    else if (game.in_draw()) {
        statusHTML = '⚔️ תיקו! קרב צמוד.';
        document.getElementById('restart-btn').style.display = 'block';
        saveStats('d'); // שמירת תיקו
    } 
    else {
        statusHTML = isMyTurn ? '🟢 התור שלך לתקוף' : '🔴 ממתין למהלך היריב';
        if (game.in_check()) {
            statusHTML += ' <br> ⚠️ <b>שח! המלך בסכנה!</b> ⚠️';
            document.body.classList.add('in-check');
            playSound('check');
        }
        document.getElementById('restart-btn').style.display = 'none';
    }

    document.getElementById('status').innerHTML = statusHTML;
}

// --- מערכת צ'אט ---
function appendChatMessage(sender, text, isMine = true) {
    const chatDiv = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.classList.add('chat-msg');
    
    if (sender === "מערכת") {
        msgEl.style.color = "#0ff";
        msgEl.style.textAlign = "center";
        msgEl.style.alignSelf = "center";
        msgEl.style.fontSize = "12px";
    } else {
        msgEl.classList.add(isMine ? 'msg-mine' : 'msg-theirs');
    }
    
    msgEl.innerText = text;
    chatDiv.appendChild(msgEl);
    chatDiv.scrollTop = chatDiv.scrollHeight; // גלילה למטה
}

function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text && conn) {
        conn.send({ type: 'chat', text: text });
        appendChatMessage("אני", text, true);
        input.value = '';
    }
}

document.getElementById('send-chat-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});


// --- פונקציות עזר (שחזור ושמירה) ---
function resumeGame() {
    const fen = document.getElementById('fen-input').value.trim();
    const selectedColor = document.getElementById('resume-color').value;
    if (!fen) { alert("אנא הדבק קוד משחק (FEN)"); return; }
    if (!game.load(fen)) { alert("קוד המשחק לא תקין!"); return; }
    initCreator(fen, selectedColor);
}

document.getElementById('copy-btn').addEventListener('click', () => {
    document.getElementById('invite-link').select();
    document.execCommand('copy');
    document.getElementById('copy-btn').innerText = 'הועתק בהצלחה! ⚔️';
});

document.getElementById('restart-btn').addEventListener('click', () => {
    game.reset(); board.start(); gameEnded = false;
    $('.square-55d63').removeClass('highlight-square');
    conn.send({ type: 'restart' });
    updateStatus();
    appendChatMessage("מערכת", "התחלת משחק חדש!");
});

document.getElementById('save-btn').addEventListener('click', () => {
    const fen = game.fen();
    navigator.clipboard.writeText(fen).then(() => {
        const btn = document.getElementById('save-btn');
        btn.innerText = '✅ הקוד נשמר!';
        setTimeout(() => { btn.innerText = '💾 שמור משחק'; }, 3000);
    });
});
