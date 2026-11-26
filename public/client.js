const socket = io();

const usuario = JSON.parse(localStorage.getItem('orkut_usuario'));
if (!usuario) {
  window.location.href = 'index.html';
}

if (usuario.fotoFundo) {
  document.body.style.backgroundImage = `url('${usuario.fotoFundo}')`;
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundAttachment = 'fixed';
}

document.getElementById('profileName').textContent = usuario.nome;
document.getElementById('profileHumor').textContent = usuario.humor;
document.getElementById('topUserInfo').textContent = `@${usuario.username}`;

if (usuario.fotoPerfil) {
  const img = document.getElementById('profileImg');
  img.src = usuario.fotoPerfil;
  img.classList.remove('hidden');
  document.getElementById('avatarInitials').classList.add('hidden');
} else {
  document.getElementById('avatarInitials').textContent = usuario.nome.substring(0, 2).toUpperCase();
}

if (usuario.cargo === 'admin') {
  document.getElementById('adminLink').classList.remove('hidden');
  document.getElementById('adminBadge').classList.remove('hidden');
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('orkut_usuario');
  window.location.href = 'index.html';
});

let salaAtual = 'Geral';
let totalScraps = 0;

socket.emit('entrar_chat', { username: usuario.username, sala: salaAtual });

const figurinhasOrkut = [
  { emoji: '☕💖', texto: 'Pausa pro Café!' },
  { emoji: '💻🔥', texto: 'Compilou de primeira!' },
  { emoji: '🐛😱', texto: 'Achei um Bug!' },
  { emoji: '🚀🎉', texto: 'Deploy na Sexta!' },
  { emoji: '💎✨', texto: 'Você é 100% Confiável!' },
  { emoji: '🧊😎', texto: 'Super Legal!' },
  { emoji: '❤️‍🔥😍', texto: 'Sexy no Código!' },
  { emoji: '😴💤', texto: 'Sono pós-almoço' }
];

const stickerPicker = document.getElementById('stickerPicker');
const stickerGrid = document.getElementById('stickerGrid');

figurinhasOrkut.forEach((fig) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sticker-btn';
  btn.innerHTML = `<span style="font-size:22px;">${fig.emoji}</span><small>${fig.texto}</small>`;
  btn.onclick = () => {
    socket.emit('enviar_mensagem', {
      tipoConteudo: 'figurinha',
      texto: `${fig.emoji} ${fig.texto}`
    });
    stickerPicker.classList.add('hidden');
    incrementarScraps();
  };
  stickerGrid.appendChild(btn);
});

document.getElementById('toggleStickerBtn').addEventListener('click', () => {
  stickerPicker.classList.toggle('hidden');
});

document.getElementById('photoUpload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxWidth = 500;
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

      const base64 = canvas.toDataURL('image/jpeg', 0.8);
      socket.emit('enviar_mensagem', {
        tipoConteudo: 'foto',
        texto: document.getElementById('messageInput').value.trim(),
        imagem: base64
      });
      document.getElementById('messageInput').value = '';
      incrementarScraps();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  enviarTexto();
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    enviarTexto();
  }
});

function enviarTexto() {
  const texto = messageInput.value.trim();
  if (!texto) return;

  socket.emit('enviar_mensagem', { tipoConteudo: 'texto', texto });
  messageInput.value = '';
  incrementarScraps();
}

function incrementarScraps() {
  totalScraps++;
  document.getElementById('scrapCount').textContent = totalScraps;
}

document.getElementById('roomsList').addEventListener('click', (e) => {
  const item = e.target.closest('li');
  if (!item) return;

  const novaSala = item.getAttribute('data-sala');
  if (novaSala === salaAtual) return;

  salaAtual = novaSala;
  document.getElementById('currentRoomTitle').textContent = salaAtual;
  document.getElementById('roomBadge').textContent = salaAtual;

  document.querySelectorAll('#roomsList li').forEach((li) => {
    li.classList.toggle('active', li.getAttribute('data-sala') === salaAtual);
  });

  socket.emit('trocar_sala', salaAtual);
});

const messagesList = document.getElementById('messagesList');

socket.on('historico_mensagens', (mensagens) => {
  messagesList.innerHTML = '';
  mensagens.forEach(renderizarMensagem);
});

socket.on('nova_mensagem', renderizarMensagem);

socket.on('lista_usuarios', (usuarios) => {
  document.getElementById('onlineCount').textContent = usuarios.length;
  const usersList = document.getElementById('usersList');
  usersList.innerHTML = '';

  usuarios.forEach((u) => {
    const li = document.createElement('li');
    const miniFoto = u.fotoPerfil
      ? `<img src="${u.fotoPerfil}" class="mini-avatar" />`
      : '🟢';
    li.innerHTML = `${miniFoto} <span>${u.nome} ${u.cargo === 'admin' ? '👑' : ''}</span>`;
    usersList.appendChild(li);
  });
});

function renderizarMensagem(msg) {
  const div = document.createElement('div');

  if (msg.tipo === 'sistema') {
    div.className = 'system-msg';
    div.textContent = `[${msg.hora}] ${msg.texto}`;
  } else {
    const souEu = msg.username === usuario.username;
    div.className = `scrap-item ${souEu ? 'me' : ''}`;

    const avatarHtml = msg.fotoPerfil
      ? `<img src="${msg.fotoPerfil}" class="scrap-avatar" />`
      : `<div class="scrap-avatar-fallback">${msg.autor.substring(0, 2).toUpperCase()}</div>`;

    let conteudoHtml = '';
    if (msg.tipoConteudo === 'figurinha') {
      conteudoHtml = `<div class="sticker-bubble">${msg.texto}</div>`;
    } else if (msg.tipoConteudo === 'foto') {
      conteudoHtml = `
        ${msg.texto ? `<p style="margin-bottom:6px;">${msg.texto}</p>` : ''}
        <img src="${msg.imagem}" class="scrap-photo" alt="Foto enviada" />
      `;
    } else {
      conteudoHtml = `<div class="scrap-body">${msg.texto}</div>`;
    }

    div.innerHTML = `
      <div class="scrap-row">
        ${avatarHtml}
        <div class="scrap-content">
          <div class="scrap-header">
            <span class="scrap-author">
              ${msg.autor} ${msg.cargo === 'admin' ? '<span class="admin-mini">ADMIN</span>' : ''}
              <span class="scrap-humor">(${msg.humor})</span>
            </span>
            <span class="scrap-time">${msg.hora}</span>
          </div>
          ${conteudoHtml}
        </div>
      </div>
    `;
  }

  messagesList.appendChild(div);
  messagesList.scrollTop = messagesList.scrollHeight;
}
