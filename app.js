// --- הגדרות משתנים גלובליים ---
let board = null;
let game = new Chess();
let peer = null;
let conn = null;
let playerColor = 'w'; // שחקן יוצר תמיד לבן, מצטרף תמיד שחור

// אלמנטים ב-DOM
const menuEl = document.getElementById('menu');
const gameContainerEl = document.getElementById('game-container');
const inviteContainerEl = document.getElementById('invite-container');
const inviteLinkEl = document.getElementById('invite-link');
const statusEl = document.getElementById('status');

// --- אתחול (בדיקה האם אנחנו יוצרים או מצטרפים) ---
const roomHash = window.location.hash.substring(1); // מזהה החדר מה-URL
if (roomHash) {
    // שלב ב: שחקן ב' מצטרף דרך לינק
    playerColor = 'b';
    initJoiner(roomHash);
} else {
    // שלב א: שחקן א' נכנס לאתר הראשי
    document.getElementById('create-btn').addEventListener('click', initCreator);
}

// --- פונקציות WebRTC ---

function initCreator() {
    document.getElementById('create-btn').style.display = 'none';
    
    // יוצר מזהה אקראי למשחק
    const gameId = Math.random().toString(36).substring(2, 8);
    peer = new Peer(gameId); // יצירת Peer
    
    peer.on('open', (id) => {
        const link = window.location.href.split('#')[0] + '#' + id;
        inviteLinkEl.value = link;
        inviteContainerEl.style.display = 'block';
    });

    // המתנה לחיבור משחקן ב'
    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
    });
}

function initJoiner(hostId) {
    menuEl.style.display = 'none';
    gameContainerEl.style.display = 'block';
    
    peer = new Peer(); // שחקן ב' לא צריך מזהה קבוע
    peer.on('open', () => {
        statusEl.innerText = "מתחבר לשחקן א'...";
        conn = peer.connect(hostId); // חיבור לשחקן א'
        setupConnection();
    });
}

function setupConnection() {
    conn.on('open', () => {
        // התחברות הצליחה!
        menuEl.style.display = 'none';
        gameContainerEl.style.display = 'block';
        initChessboard();
        updateStatus();
    });

    // האזנה להודעות מהצד השני
    conn.on('data', (data) => {
        if (data.type === 'move') {
            game.move({ from: data.from, to: data.to, promotion: 'q' });
            board.position(game.fen());
            updateStatus();
        } else if (data.type === 'restart') {
            game.reset();
            board.start();
            updateStatus();
        }
    });

    conn.on('close', () => {
        statusEl.innerText = "היריב התנתק!";
    });
}

// --- הגדרות לוח השחמט ---

function initChessboard() {
    const config = {
        draggable: true,
        // אם יש מצב שמור נטען אותו, אחרת נתחיל מחדש
        position: game.fen() === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' ? 'start' : game.fen(),
        orientation: playerColor === 'w' ? 'white' : 'black',
        
        // --- הפתרון לבעיית התמונות: משיכת הכלים משרת חיצוני ---
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    
    board = Chessboard('board', config);
}

// בדיקה האם מותר להרים כלי
function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    
    // שחקן יכול להזיז רק כלים בצבע שלו
    if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
        (playerColor === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
    
    // מותר להזיז רק אם זה התור שלך
    if ((game.turn() === 'w' && playerColor === 'b') ||
        (game.turn() === 'b' && playerColor === 'w')) {
        return false;
    }
}

// בדיקת חוקיות מהלך בזמן עזיבת העכבר
function onDrop(source, target) {
    let move = game.move({
        from: source,
        to: target,
        promotion: 'q' // אוטומטית מקדם למלכה לפשטות
    });

    // אם המהלך לא חוקי - הכלי יחזור למקום
    if (move === null) return 'snapback';

    // אם תקין - שולח ליריב דרך WebRTC
    conn.send({ type: 'move', from: source, to: target });
    updateStatus();
}

// עדכון אנימציה אחרי המהלך
function onSnapEnd() {
    board.position(game.fen());
}

// --- ניהול תצוגה ומצב ---

function updateStatus() {
    let statusHTML = '';
    let moveColor = game.turn() === 'w' ? 'לבן' : 'שחור';
    let isMyTurn = game.turn() === playerColor;

    if (game.in_checkmate()) {
        statusHTML = `מט! השחקן ה${moveColor === 'לבן' ? 'שחור' : 'לבן'} ניצח! 🎉`;
        document.getElementById('restart-btn').style.display = 'block';
    } 
    else if (game.in_draw()) {
        statusHTML = 'תיקו!';
        document.getElementById('restart-btn').style.display = 'block';
    } 
    else {
        statusHTML = isMyTurn ? '🟢 תור שלך' : '🔴 תור היריב';
        if (game.in_check()) {
            statusHTML += ' (שח!)';
        }
        document.getElementById('restart-btn').style.display = 'none';
    }

    statusEl.innerHTML = statusHTML;
}

// --- מאזינים נוספים ---

// העתקת קישור
document.getElementById('copy-btn').addEventListener('click', () => {
    inviteLinkEl.select();
    document.execCommand('copy');
    document.getElementById('copy-btn').innerText = 'הועתק!';
});

// בקשת משחק חדש
document.getElementById('restart-btn').addEventListener('click', () => {
    game.reset();
    board.start();
    conn.send({ type: 'restart' });
    updateStatus();
});
